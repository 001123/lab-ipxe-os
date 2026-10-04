import type { HostConfig } from "../../../types.ts";

/**
 * Returns core lateCommands that must run on all Ubuntu installations:
 * 1. Enable qemu-guest-agent service
 * 2. Restore UEFI PXE boot order priority so iPXE StateManager retains control on bare-metal
 * 3. Phone-home webhook to Bun server to mark installation finished
 */
export function getBaseLateCommands(host: HostConfig, baseUrl: string): string[] {
  return [
    // Ensure network-online and curl available
    `curtin in-target --target=/target -- systemctl enable qemu-guest-agent || true`,
    // Install persistent boot order script that preserves PXE priority and protects NVRAM flash wear
    `curtin in-target --target=/target -- sh -c 'cat << "EOF" > /usr/local/bin/ensure-pxe-boot-order.sh
#!/bin/sh
set -e
if ! command -v efibootmgr >/dev/null 2>&1; then
  exit 0
fi

PXE_ID=$(efibootmgr 2>/dev/null | grep -i "^BootCurrent:" | awk "{print \\$2}")
if [ -z "$PXE_ID" ] || ! efibootmgr 2>/dev/null | grep -q "^Boot\${PXE_ID}"; then
  PXE_ID=""
fi

if [ -z "$PXE_ID" ]; then
  PXE_ID=$(efibootmgr 2>/dev/null | grep -Ei "IPv4|PXE|Network|Ethernet|IP4|Realtek|Intel" | head -n 1 | sed -E "s/^Boot([0-9A-Fa-f]+).*/\\1/")
fi

if [ -z "$PXE_ID" ]; then
  exit 0
fi

CURRENT_ORDER=$(efibootmgr 2>/dev/null | grep -i "^BootOrder:" | awk "{print \\$2}")
if [ -z "$CURRENT_ORDER" ]; then
  exit 0
fi

FIRST_ID=$(echo "$CURRENT_ORDER" | cut -d"," -f1)
if [ "$FIRST_ID" = "$PXE_ID" ]; then
  exit 0
fi

REST=$(echo "$CURRENT_ORDER" | tr "," "\\n" | grep -vi "^$PXE_ID$" | tr "\\n" "," | sed "s/,$//")
if [ -n "$REST" ]; then
  efibootmgr -o "$PXE_ID,$REST" >/dev/null 2>&1 || true
else
  efibootmgr -o "$PXE_ID" >/dev/null 2>&1 || true
fi
EOF
chmod +x /usr/local/bin/ensure-pxe-boot-order.sh'`,
    // Install and enable systemd service to enforce PXE priority on every boot
    `curtin in-target --target=/target -- sh -c 'cat << "EOF" > /etc/systemd/system/ipxe-boot-order.service
[Unit]
Description=Ensure UEFI PXE Network Boot remains first priority for ZTP
After=local-fs.target
DefaultDependencies=no

[Service]
Type=oneshot
ExecStart=/usr/local/bin/ensure-pxe-boot-order.sh
RemainAfterExit=true

[Install]
WantedBy=basic.target
EOF
systemctl enable ipxe-boot-order.service || true'`,
    // Run it immediately in late-commands to ensure first reboot boots to PXE
    `curtin in-target --target=/target -- /usr/local/bin/ensure-pxe-boot-order.sh || true`,
    // Phone-home webhook to Bun server to mark installation finished
    `curtin in-target --target=/target -- curl -s -X POST "${baseUrl}/api/installed?mac=${encodeURIComponent(
      host.mac
    )}&hostname=${encodeURIComponent(host.hostname)}&os=ubuntu" || true`,
  ];
}

