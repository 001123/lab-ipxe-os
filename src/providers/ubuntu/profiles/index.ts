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
    // Restore UEFI Network/PXE boot priority so iPXE StateManager retains control on bare-metal
    `curtin in-target --target=/target -- sh -c 'PXE_ID=$(efibootmgr 2>/dev/null | grep -Ei "IPv4|PXE|Network|Ethernet|IP4" | head -n 1 | sed -E "s/^Boot([0-9A-Fa-f]+).*/\\1/"); CURRENT_ORDER=$(efibootmgr 2>/dev/null | grep -i "^BootOrder:" | awk "{print \\$2}"); if [ -n "$PXE_ID" ] && [ -n "$CURRENT_ORDER" ]; then REST=$(echo "$CURRENT_ORDER" | tr "," "\\n" | grep -vi "^$PXE_ID$" | tr "\\n" "," | sed "s/,$//"); if [ -n "$REST" ]; then efibootmgr -o "$PXE_ID,$REST" || true; else efibootmgr -o "$PXE_ID" || true; fi; fi' || true`,
    // Phone-home webhook to Bun server to mark installation finished
    `curtin in-target --target=/target -- curl -s -X POST "${baseUrl}/api/installed?mac=${encodeURIComponent(
      host.mac
    )}&hostname=${encodeURIComponent(host.hostname)}&os=ubuntu" || true`,
  ];

  switch (profileName.toLowerCase()) {
    case "k3s-single-node": {
      const sans = Array.from(
        new Set([
          host.hostname,
          "127.0.0.1",
          "localhost",
          ...(host.network?.ip ? [host.network.ip] : []),
        ])
      );
      const sanEntries = sans.map((san) => `  - "${san}"`).join("\n");
      const k3sVersionEnv = host.custom?.k3s_version
        ? `INSTALL_K3S_VERSION="${host.custom.k3s_version}" `
        : "";
      const configuredK3sVersion = host.custom?.k3s_version || "";

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
          "efibootmgr",
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
          // Pre-create K3s configuration directory and declarative config.yaml with dynamic TLS SAN
          `curtin in-target --target=/target -- mkdir -p /etc/rancher/k3s`,
          `curtin in-target --target=/target -- sh -c 'cat <<EOF > /etc/rancher/k3s/config.yaml
write-kubeconfig-mode: "0644"
tls-san:
${sanEntries}
EOF'`,
          // Fallback runtime script: dynamically append IP to tls-san if obtained via DHCP
          `curtin in-target --target=/target -- sh -c 'NODE_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk "{print \\$7}"); if [ -n "$NODE_IP" ] && ! grep -q "$NODE_IP" /etc/rancher/k3s/config.yaml; then echo "  - \\"$NODE_IP\\"" >> /etc/rancher/k3s/config.yaml; fi'`,
          // Pre-download K3s binary with progress bar and explicit versioning, then setup service & symlinks
          `curtin in-target --target=/target -- sh -c 'K3S_VER="${configuredK3sVersion}"; if [ -z "$K3S_VER" ]; then echo "[iPXE K3s] Querying latest stable K3s release from update.k3s.io..." | (tee -a /dev/console 2>/dev/null || cat); K3S_VER=$(curl -sL --connect-timeout 15 -w "%{url_effective}" https://update.k3s.io/v1-release/channels/stable -o /dev/null | sed -e "s|.*/||"); fi; [ -z "$K3S_VER" ] && K3S_VER="v1.31.5+k3s1"; ARCH=$(uname -m); SUFFIX=""; case "$ARCH" in aarch64|arm64) SUFFIX="-arm64" ;; *) SUFFIX="" ;; esac; BIN_URL="https://github.com/k3s-io/k3s/releases/download/$K3S_VER/k3s$SUFFIX"; echo "[iPXE K3s] Downloading binary: $BIN_URL ($K3S_VER, $ARCH)..." | (tee -a /dev/console 2>/dev/null || cat); mkdir -p /usr/local/bin; curl -# -fL --retry 3 --connect-timeout 30 -o /usr/local/bin/k3s "$BIN_URL" 2>&1 | (tee /dev/console 2>/dev/null || cat); chmod 755 /usr/local/bin/k3s; /usr/local/bin/k3s --version | (tee -a /dev/console 2>/dev/null || cat); echo "[iPXE K3s] Installing systemd service & symlinks via get.k3s.io..." | (tee -a /dev/console 2>/dev/null || cat); curl -sfL https://get.k3s.io | ${k3sVersionEnv}INSTALL_K3S_SKIP_DOWNLOAD=true INSTALL_K3S_SKIP_START=true sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)'`,
          // Ensure systemd service is enabled to start upon first real boot
          `curtin in-target --target=/target -- systemctl enable k3s || true`,
          // Set system-wide KUBECONFIG for homelab and all users
          `curtin in-target --target=/target -- sh -c 'echo "KUBECONFIG=/etc/rancher/k3s/k3s.yaml" >> /etc/environment'`,
          `curtin in-target --target=/target -- sh -c 'echo "export KUBECONFIG=/etc/rancher/k3s/k3s.yaml" > /etc/profile.d/k3s.sh'`,
          // Setup ~/.kube/config symlink for defaultUser and root
          `curtin in-target --target=/target -- mkdir -p /home/${defaultUser}/.kube /root/.kube`,
          `curtin in-target --target=/target -- ln -sf /etc/rancher/k3s/k3s.yaml /home/${defaultUser}/.kube/config`,
          `curtin in-target --target=/target -- ln -sf /etc/rancher/k3s/k3s.yaml /root/.kube/config`,
          `curtin in-target --target=/target -- chown -R ${defaultUser}:${defaultUser} /home/${defaultUser}/.kube || true`,
          ...baseLateCommands,
        ],
      };
    }
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
          "efibootmgr",
        ],
        lateCommands: [...baseLateCommands],
      };

    default:
      console.warn(`[Ubuntu Profile] Unknown profile "${profileName}", falling back to "generic".`);
      return getUbuntuProfile("generic", host, baseUrl);
  }
}
