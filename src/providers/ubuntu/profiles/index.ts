import type { HostConfig } from "../../../types.ts";

export interface ProfileSpec {
  packages: string[];
  lateCommands: string[];
  earlyCommands?: string[];
}

export function getUbuntuProfile(profileName: string, host: HostConfig, baseUrl: string): ProfileSpec {
  const defaultUser = host.user || "homelab";
  const baseLateCommands: string[] = [
    // Ensure network-online and curl available
    `curtin in-target --target=/target -- systemctl enable qemu-guest-agent || true`,
    // Phone-home webhook to Bun server to mark installation finished
    `curtin in-target --target=/target -- curl -s -X POST "${baseUrl}/api/installed?mac=${encodeURIComponent(
      host.mac
    )}&hostname=${encodeURIComponent(host.hostname)}&os=ubuntu" || true`,
  ];

  switch (profileName.toLowerCase()) {
    case "k3s-server":
    case "k3s":
      return {
        packages: [
          "curl",
          "qemu-guest-agent",
          "htop",
          "iotop",
          "net-tools",
          "open-iscsi",
          "nfs-common",
          "ca-certificates",
        ],
        lateCommands: [
          // Disable swap in fstab
          `curtin in-target --target=/target -- sed -i '/ swap / s/^\\(.*\\)$/#\\1/g' /etc/fstab || true`,
          // Configure sysctl for Kubernetes networking
          `curtin in-target --target=/target -- sh -c 'cat <<EOF > /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF'`,
          // Modules load
          `curtin in-target --target=/target -- sh -c 'cat <<EOF > /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF'`,
          // Pre-install K3s server binary & systemd service (skip start in chroot)
          `curtin in-target --target=/target -- sh -c 'curl -sfL https://get.k3s.io | INSTALL_K3S_SKIP_START=true INSTALL_K3S_EXEC="server --write-kubeconfig-mode 644" sh -'`,
          // Set system-wide KUBECONFIG for homelab and all users
          `curtin in-target --target=/target -- sh -c 'echo "KUBECONFIG=/etc/rancher/k3s/k3s.yaml" >> /etc/environment'`,
          `curtin in-target --target=/target -- sh -c 'echo "export KUBECONFIG=/etc/rancher/k3s/k3s.yaml" > /etc/profile.d/k3s.sh'`,
          ...baseLateCommands,
        ],
      };
    case "generic":
      return {
        packages: [
          "qemu-guest-agent",
          "curl",
          "htop",
          "vim",
          "tmux",
          "net-tools",
          "git",
        ],
        lateCommands: [...baseLateCommands],
      };

    default:
      console.warn(`[Ubuntu Profile] Unknown profile "${profileName}", falling back to "generic".`);
      return getUbuntuProfile("generic", host, baseUrl);
  }
}
