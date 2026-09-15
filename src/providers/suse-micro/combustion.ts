import type { HostConfig } from "../../types.ts";
import { getSuseMicroProfile } from "./profiles/index.ts";

function netmaskToCidr(mask?: string): number {
  if (!mask) return 24;
  return mask
    .split(".")
    .map(Number)
    .map((n) => n.toString(2).replace(/0/g, "").length)
    .reduce((a, b) => a + b, 0);
}

export function renderSuseCombustionScript(host: HostConfig, baseUrl: string): string {
  const username = host.user || "homelab";
  const sshKeys = host.ssh_authorized_keys || [];
  const sshKeysFormatted = sshKeys.map((k) => `echo "${k}" >> /root/.ssh/authorized_keys`).join("\n");
  const userSshFormatted = sshKeys.map((k) => `echo "${k}" >> /home/${username}/.ssh/authorized_keys`).join("\n");

  let networkSnippet = "";
  if (host.network && host.network.dhcp === false && host.network.ip) {
    const cidr = netmaskToCidr(host.network.netmask);
    const gateway = host.network.gateway ? `gateway=${host.network.gateway}\n` : "";
    const dns = host.network.nameservers && host.network.nameservers.length > 0
      ? `dns=${host.network.nameservers.join(";")};\n`
      : "";

    networkSnippet = `# 5. Configure Static Network via NetworkManager
mkdir -p /etc/NetworkManager/system-connections
cat <<'EOF' > /etc/NetworkManager/system-connections/static-default.nmconnection
[connection]
id=static-default
type=ethernet
autoconnect=true
autoconnect-priority=100

[ethernet]
mac-address=${host.mac.toLowerCase()}

[ipv4]
address1=${host.network.ip}/${cidr}
${gateway}${dns}method=manual

[ipv6]
method=auto
EOF
chmod 600 /etc/NetworkManager/system-connections/static-default.nmconnection
rm -rf /run/NetworkManager/system-connections/* 2>/dev/null || true
`;
  }

  const profile = getSuseMicroProfile(host.profile || "generic", host, baseUrl);
  const packageInstallSnippet = profile.packages && profile.packages.length > 0
    ? `echo "[Combustion] Installing profile packages via zypper..." | (tee -a /dev/console 2>/dev/null || cat)
for pkg in ${profile.packages.join(" ")}; do
  zypper --non-interactive --no-gpg-checks in -y "$pkg" || true
done`
    : "";

  const profileSnippets = profile.scriptSnippets.join("\n\n");

  return `#!/bin/bash
# combustion: network
set -euxo pipefail

# Redirect stdout/stderr to console for live debugging visibility if console device exists
if [ -c /dev/console ]; then
  exec > >(tee -a /dev/console) 2>&1
fi

echo "=================================================="
echo "Combustion script running for host: ${host.hostname}"
echo "Profile: ${host.profile || "generic"}"
echo "=================================================="

# 1. Set Hostname
echo "${host.hostname}" > /etc/hostname

# 2. Setup root SSH directory
mkdir -pm700 /root/.ssh
${sshKeysFormatted}
chmod 600 /root/.ssh/authorized_keys || true

# 3. Mount /home subvolume if not yet mounted, then create default homelab user
mount /home 2>/dev/null || true
useradd -m -U -G wheel "${username}" || true
mkdir -pm700 "/home/${username}/.ssh"
${userSshFormatted}
chmod 600 "/home/${username}/.ssh/authorized_keys" || true
chown -R "${username}:${username}" "/home/${username}/.ssh" || true

# 4. Enable passwordless sudo for wheel group
mkdir -p /etc/sudoers.d
echo "%wheel ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/wheel

# 5. Enable SSH daemon & disable interactive firstboot wizard
systemctl enable sshd || true
rm -f /var/lib/YaST2/reconfig_system || true
systemctl disable jeos-firstboot.service || true

${networkSnippet}

# 6. Install profile packages (if any)
${packageInstallSnippet}

# 7. Apply Profile-specific configurations
${profileSnippets}

# 8. Restore UEFI Network/PXE boot priority so iPXE StateManager retains control on bare-metal (safe check)
if command -v efibootmgr >/dev/null 2>&1; then
  set +e
  PXE_ID=$(efibootmgr 2>/dev/null | grep -Ei "IPv4|PXE|Network|Ethernet|IP4" | head -n 1 | sed -E "s/^Boot([0-9A-Fa-f]+).*/\\1/" || true)
  CURRENT_ORDER=$(efibootmgr 2>/dev/null | grep -i "^BootOrder:" | awk '{print $2}' || true)
  if [ -n "$PXE_ID" ] && [ -n "$CURRENT_ORDER" ]; then
    REST=$(echo "$CURRENT_ORDER" | tr "," "\\n" | grep -vi "^$PXE_ID$" | tr "\\n" "," | sed "s/,$//" || true)
    if [ -n "$REST" ]; then
      efibootmgr -o "$PXE_ID,$REST" 2>/dev/null || true
    else
      efibootmgr -o "$PXE_ID" 2>/dev/null || true
    fi
  fi
  set -e
fi

# 9. Notify Bun iPXE server of successful installation completion
curl -s --connect-timeout 5 --max-time 10 -X POST "${baseUrl}/api/installed?mac=${encodeURIComponent(
    host.mac
  )}&hostname=${encodeURIComponent(host.hostname)}&os=suse-micro" || true

echo "=================================================="
echo "Combustion configuration finished successfully!"
echo "=================================================="
`;
}
