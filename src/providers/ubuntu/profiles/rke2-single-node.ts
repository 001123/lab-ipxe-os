import type { HostConfig } from "../../../types.ts";
import type { ProfileSpec } from "./types.ts";
import { buildRke2Common } from "../../../core/rke2.ts";

export function getRke2SingleNodeProfile(host: HostConfig, _baseUrl: string): ProfileSpec {
  const {
    defaultUser, clusterCidr, serviceCidr, clusterDns, configuredRke2Version,
    cni, ingress, sanEntries, tokenEntry, argocdSnippets, storageSnippets,
  } = buildRke2Common(host, "iPXE RKE2");

  const installEnv = configuredRke2Version
    ? `INSTALL_RKE2_VERSION="${configuredRke2Version}"`
    : `INSTALL_RKE2_CHANNEL=stable`;

  // Assemble a single setup script and ship it base64-encoded so heredocs and quotes
  // survive the autoinstall YAML + curtin `sh -c` layers untouched.
  const setupScript = [
    `#!/bin/sh`,
    `set -u`,

    `# 1. Disable swap for Kubernetes compliance`,
    `sed -i '/ swap / s/^\\(.*\\)$/#\\1/g' /etc/fstab || true`,

    `# 2. Sysctl for Kubernetes networking & workload limits`,
    `mkdir -p /etc/sysctl.d
cat <<'EOF' > /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
vm.max_map_count                    = 262144
fs.file-max                         = 2097152
fs.inotify.max_user_watches         = 524288
fs.inotify.max_user_instances       = 8192
EOF`,

    `# 3. Kernel modules`,
    `mkdir -p /etc/modules-load.d
cat <<'EOF' > /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF`,

    `# 4. RKE2 declarative configuration`,
    `mkdir -p /etc/rancher/rke2`,
    `cat <<'EOF' > /etc/rancher/rke2/config.yaml
write-kubeconfig-mode: "0644"
cni: "${cni}"
ingress-controller:
  - "${ingress}"
cluster-cidr: "${clusterCidr}"
service-cidr: "${serviceCidr}"
cluster-dns: "${clusterDns}"
${tokenEntry}tls-san:
${sanEntries}
EOF`,

    `# 5. Fallback: append active DHCP IP to tls-san if not already present`,
    `NODE_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}' || true)
if [ -n "\${NODE_IP:-}" ] && ! grep -q "\$NODE_IP" /etc/rancher/rke2/config.yaml; then
  echo "  - \\"\$NODE_IP\\"" >> /etc/rancher/rke2/config.yaml
fi`,

    `# 6. Install RKE2 server (tarball method)`,
    `echo "[iPXE RKE2] Installing RKE2 (${configuredRke2Version || "channel: stable"}) with tarball method..." | (tee -a /dev/console 2>/dev/null || cat)`,
    `curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=tar INSTALL_RKE2_TYPE=server ${installEnv} sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`,

    `# 7. Enable services for first boot`,
    `systemctl enable rke2-server.service || true`,
    `systemctl enable qemu-guest-agent || true`,

    `# 8. CLI environment, PATH and crictl`,
    `echo "KUBECONFIG=/etc/rancher/rke2/rke2.yaml" >> /etc/environment`,
    `mkdir -p /etc/profile.d
cat <<'EOF' > /etc/profile.d/rke2.sh
export PATH=$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
EOF`,
    `cat <<'EOF' > /etc/crictl.yaml
runtime-endpoint: unix:///run/k3s/containerd/containerd.sock
image-endpoint: unix:///run/k3s/containerd/containerd.sock
timeout: 10
debug: false
EOF`,

    `# 9. Symlink ~/.kube/config`,
    `mkdir -p "/home/${defaultUser}/.kube" /root/.kube`,
    `ln -sf /etc/rancher/rke2/rke2.yaml "/home/${defaultUser}/.kube/config"`,
    `ln -sf /etc/rancher/rke2/rke2.yaml /root/.kube/config`,
    `chown -R "${defaultUser}:${defaultUser}" "/home/${defaultUser}/.kube" || true`,
    ...storageSnippets,
    ...argocdSnippets,
  ].join("\n");

  const encoded = Buffer.from(setupScript, "utf-8").toString("base64");

  return {
    packages: [
      "curl",
      "ca-certificates",
      "tar",
      "gzip",
      "qemu-guest-agent",
      "htop",
      "net-tools",
      "open-iscsi",
      "nfs-common",
      "efibootmgr",
    ],
    lateCommands: [
      `curtin in-target --target=/target -- sh -c 'echo ${encoded} | base64 -d > /root/rke2-setup.sh && sh /root/rke2-setup.sh'`,
    ],
  };
}
