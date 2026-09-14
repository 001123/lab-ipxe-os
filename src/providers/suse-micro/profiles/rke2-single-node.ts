import type { HostConfig } from "../../../types.ts";
import type { SuseProfileSpec } from "./types.ts";

export function getRke2SingleNodeProfile(host: HostConfig, _baseUrl: string): SuseProfileSpec {
  const defaultUser = host.user || "homelab";
  const configuredRke2Version = host.custom?.rke2_version || "";
  const configuredRke2Token = host.custom?.rke2_token || "";
  const cni = host.custom?.rke2_cni || "canal";
  const ingress = host.custom?.rke2_ingress || "traefik";

  const sans = Array.from(
    new Set([
      host.hostname,
      "127.0.0.1",
      "localhost",
      ...(host.network?.ip ? [host.network.ip] : []),
    ])
  );
  const sanEntries = sans.map((san) => `  - "${san}"`).join("\n");
  const tokenEntry = configuredRke2Token ? `token: "${configuredRke2Token}"\n` : "";

  return {
    packages: [
      "curl",
      "ca-certificates",
      "tar",
      "gzip",
      "qemu-guest-agent",
      "htop",
      "nfs-client",
      "open-iscsi",
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

      `# 4. Configure Sysctl for Kubernetes networking`,
      `cat <<'EOF' > /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system || true`,

      `# 5. Pre-load required Kernel Modules`,
      `cat <<'EOF' > /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay || true
modprobe br_netfilter || true`,

      `# 6. Configure SELinux for RKE2 compatibility on Leap Micro 6.2`,
      `sed -i 's/^SELINUX=enforcing/SELINUX=permissive/' /etc/selinux/config 2>/dev/null || true`,
      `setenforce 0 2>/dev/null || true`,

      `# 7. Pre-create RKE2 declarative configuration`,
      `mkdir -p /etc/rancher/rke2`,
      `cat <<'EOF' > /etc/rancher/rke2/config.yaml
write-kubeconfig-mode: "0644"
selinux: false
cni: "${cni}"
ingress-controller:
  - "${ingress}"
${tokenEntry}tls-san:
${sanEntries}
EOF`,

      `# 7. Fallback runtime check: append active DHCP IP to tls-san if not already present`,
      `NODE_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}')
if [ -n "$NODE_IP" ] && ! grep -q "$NODE_IP" /etc/rancher/rke2/config.yaml; then
  echo "  - \\"$NODE_IP\\"" >> /etc/rancher/rke2/config.yaml
fi`,

      `# 8. Install RKE2 using official RPM method for openSUSE Leap Micro`,
      `echo "[Combustion RKE2] Installing RKE2 (${configuredRke2Version || "channel: stable"}) with RPM method..." | (tee -a /dev/console 2>/dev/null || cat)`,
      configuredRke2Version
        ? `curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=rpm INSTALL_RKE2_TYPE=server INSTALL_RKE2_VERSION="${configuredRke2Version}" sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`
        : `curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=rpm INSTALL_RKE2_TYPE=server INSTALL_RKE2_CHANNEL=stable sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`,

      `# 9. Enable RKE2 and QEMU guest agent systemd services`,
      `systemctl enable rke2-server.service || true`,
      `systemctl enable qemu-guest-agent || true`,

      `# 10. Configure CLI environment and PATH for homelab user and root`,
      `echo "KUBECONFIG=/etc/rancher/rke2/rke2.yaml" >> /etc/environment`,
      `cat <<'EOF' > /etc/profile.d/rke2.sh
export PATH=$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
EOF`,

      `# 11. Symlink ~/.kube/config for convenient kubectl access`,
      `mkdir -p "/home/${defaultUser}/.kube" /root/.kube`,
      `ln -sf /etc/rancher/rke2/rke2.yaml "/home/${defaultUser}/.kube/config"`,
      `ln -sf /etc/rancher/rke2/rke2.yaml /root/.kube/config`,
      `chown -R "${defaultUser}:${defaultUser}" "/home/${defaultUser}/.kube" || true`,
    ],
  };
}
