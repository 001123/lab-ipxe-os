import type { HostConfig } from "../../../types.ts";
import type { SuseProfileSpec } from "./types.ts";
import { buildRke2Common } from "../../../core/rke2.ts";

export function getRke2SingleNodeProfile(host: HostConfig, _baseUrl: string): SuseProfileSpec {
  const {
    defaultUser, clusterCidr, serviceCidr, clusterDns, configuredRke2Version,
    cni, ingress, sanEntries, tokenEntry, argocdSnippets, storageSnippets,
  } = buildRke2Common(host, "Combustion RKE2");

  return {
    packages: [
      "curl",
      "ca-certificates",
      "tar",
      "gzip",
      "qemu-guest-agent",
      "nfs-client",
      "open-iscsi",
      "efibootmgr",
    ],
    scriptSnippets: [
      `# 1. Expand Btrfs root filesystem to full disk capacity`,
      `echo "[Combustion RKE2] Resizing Btrfs root filesystem..." | (tee -a /dev/console 2>/dev/null || cat)`,
      `btrfs filesystem resize max / || true`,

      `# 2. Disable Swap for Kubernetes compliance`,
      `sed -i '/ swap / s/^\\(.*\\)$/#\\1/g' /etc/fstab || true`,
      `swapoff -a || true`,

      `# 3. Disable Firewalld to prevent port & CNI packet filtering conflicts`,
      `echo "[Combustion RKE2] Disabling firewalld for clean CNI networking..." | (tee -a /dev/console 2>/dev/null || cat)`,
      `systemctl disable firewalld || true`,
      `systemctl stop firewalld || true`,

      `# 4. Configure Sysctl for Kubernetes networking & workload limits`,
      `mkdir -p /etc/sysctl.d
cat <<'EOF' > /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
vm.max_map_count                    = 262144
fs.file-max                         = 2097152
fs.inotify.max_user_watches         = 524288
fs.inotify.max_user_instances       = 8192
EOF
sysctl --system || true`,

      `# 5. Disable automatic reboot in rebootmgr (manual maintenance control for Kubernetes nodes)`,
      `cat <<'EOF' > /etc/rebootmgr.conf
[rebootmgr]
strategy=off
EOF
systemctl try-restart rebootmgr || true`,

      `# 6. Pre-load required Kernel Modules`,
      `mkdir -p /etc/modules-load.d
cat <<'EOF' > /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay || true
modprobe br_netfilter || true`,

      `# 7. Configure SELinux for RKE2 compatibility on Leap Micro 6.2`,
      `sed -i 's/^SELINUX=enforcing/SELINUX=permissive/' /etc/selinux/config 2>/dev/null || true`,
      `setenforce 0 2>/dev/null || true`,

      `# 8. Pre-create RKE2 declarative configuration`,
      `mkdir -p /etc/rancher/rke2`,
      `cat <<'EOF' > /etc/rancher/rke2/config.yaml
write-kubeconfig-mode: "0644"
selinux: false
cni: "${cni}"
ingress-controller:
  - "${ingress}"
cluster-cidr: "${clusterCidr}"
service-cidr: "${serviceCidr}"
cluster-dns: "${clusterDns}"
${tokenEntry}tls-san:
${sanEntries}
EOF`,

      `# 8. Fallback runtime check: append active DHCP IP to tls-san if not already present`,
      `NODE_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}' || true)
if [ -n "\${NODE_IP:-}" ] && ! grep -q "\$NODE_IP" /etc/rancher/rke2/config.yaml; then
  echo "  - \\"\$NODE_IP\\"" >> /etc/rancher/rke2/config.yaml
fi`,

      `# 9. Install RKE2 using official RPM method for openSUSE Leap Micro`,
      `echo "[Combustion RKE2] Installing RKE2 (${configuredRke2Version || "channel: v1.36"}) with RPM method..." | (tee -a /dev/console 2>/dev/null || cat)`,
      configuredRke2Version
        ? `export TRANSACTIONAL_UPDATE=true; curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=rpm INSTALL_RKE2_TYPE=server INSTALL_RKE2_VERSION="${configuredRke2Version}" sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`
        : `export TRANSACTIONAL_UPDATE=true; curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=rpm INSTALL_RKE2_TYPE=server INSTALL_RKE2_CHANNEL=v1.36 sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`,

      `# 10. Enable RKE2 and QEMU guest agent systemd services`,
      `systemctl enable rke2-server.service || true`,
      `systemctl enable qemu-guest-agent || true`,

      `# 11. Configure CLI environment, PATH, and crictl for homelab user and root`,
      `echo "KUBECONFIG=/etc/rancher/rke2/rke2.yaml" >> /etc/environment`,
      `mkdir -p /etc/profile.d
cat <<'EOF' > /etc/profile.d/rke2.sh
export PATH=$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin:/sbin:/usr/sbin
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
EOF`,
      `cat <<'EOF' > /etc/crictl.yaml
runtime-endpoint: unix:///run/k3s/containerd/containerd.sock
image-endpoint: unix:///run/k3s/containerd/containerd.sock
timeout: 10
debug: false
EOF`,

      `# 12. Symlink ~/.kube/config for convenient kubectl access`,
      `mkdir -p "/home/${defaultUser}/.kube" /root/.kube`,
      `ln -sf /etc/rancher/rke2/rke2.yaml "/home/${defaultUser}/.kube/config"`,
      `ln -sf /etc/rancher/rke2/rke2.yaml /root/.kube/config`,
      `chown -R "${defaultUser}:${defaultUser}" "/home/${defaultUser}/.kube" || true`,
      ...storageSnippets,
      ...argocdSnippets,
    ],
  };
}
