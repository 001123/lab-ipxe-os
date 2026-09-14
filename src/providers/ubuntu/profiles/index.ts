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
    case "docker-host":
      return {
        packages: [
          "docker.io",
          "containerd",
          "docker-compose-v2",
          "curl",
          "qemu-guest-agent",
          "htop",
        ],
        lateCommands: [
          `curtin in-target --target=/target -- systemctl enable docker`,
          `curtin in-target --target=/target -- usermod -aG docker ${defaultUser} || true`,
          ...baseLateCommands,
        ],
      };

    case "k8s-node":
      return {
        packages: [
          "containerd",
          "curl",
          "apt-transport-https",
          "ca-certificates",
          "socat",
          "conntrack",
          "qemu-guest-agent",
        ],
        lateCommands: [
          // Disable swap in fstab
          `curtin in-target --target=/target -- sed -i '/ swap / s/^\\(.*\\)$/#\\1/g' /etc/fstab`,
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
          ...baseLateCommands,
        ],
      };

    case "generic":
    default:
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
  }
}
