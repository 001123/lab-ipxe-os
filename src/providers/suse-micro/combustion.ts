import type { HostConfig } from "../../types.ts";

export function renderSuseCombustionScript(host: HostConfig, baseUrl: string): string {
  const username = host.user || "homelab";
  const sshKeys = host.ssh_authorized_keys || [];
  const sshKeysFormatted = sshKeys.map((k) => `echo "${k}" >> /root/.ssh/authorized_keys`).join("\n");
  const userSshFormatted = sshKeys.map((k) => `echo "${k}" >> /home/${username}/.ssh/authorized_keys`).join("\n");

  return `#!/bin/bash
# combustion: network
set -euxo pipefail

echo "=================================================="
echo "Combustion script running for host: ${host.hostname}"
echo "=================================================="

# Set Hostname
echo "${host.hostname}" > /etc/hostname

# Setup root SSH directory
mkdir -pm700 /root/.ssh
${sshKeysFormatted}
chmod 600 /root/.ssh/authorized_keys || true

# Create default homelab user
useradd -m -U -G wheel "${username}" || true
mkdir -pm700 "/home/${username}/.ssh"
${userSshFormatted}
chmod 600 "/home/${username}/.ssh/authorized_keys" || true
chown -R "${username}:${username}" "/home/${username}/.ssh" || true

# Enable passwordless sudo for wheel group
echo "%wheel ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/wheel

# Enable SSH daemon
systemctl enable sshd

# Notify Bun iPXE server of successful installation completion
curl -s -X POST "${baseUrl}/api/installed?mac=${encodeURIComponent(
    host.mac
  )}&hostname=${encodeURIComponent(host.hostname)}&os=suse-micro" || true

echo "Combustion configuration finished successfully!"
`;
}
