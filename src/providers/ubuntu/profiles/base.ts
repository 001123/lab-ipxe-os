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
    // Restore UEFI Network/PXE boot priority so iPXE StateManager retains control on bare-metal
    `curtin in-target --target=/target -- sh -c 'PXE_ID=$(efibootmgr 2>/dev/null | grep -Ei "IPv4|PXE|Network|Ethernet|IP4" | head -n 1 | sed -E "s/^Boot([0-9A-Fa-f]+).*/\\1/"); CURRENT_ORDER=$(efibootmgr 2>/dev/null | grep -i "^BootOrder:" | awk "{print \\$2}"); if [ -n "$PXE_ID" ] && [ -n "$CURRENT_ORDER" ]; then REST=$(echo "$CURRENT_ORDER" | tr "," "\\n" | grep -vi "^$PXE_ID$" | tr "\\n" "," | sed "s/,$//"); if [ -n "$REST" ]; then efibootmgr -o "$PXE_ID,$REST" || true; else efibootmgr -o "$PXE_ID" || true; fi; fi' || true`,
    // Phone-home webhook to Bun server to mark installation finished
    `curtin in-target --target=/target -- curl -s -X POST "${baseUrl}/api/installed?mac=${encodeURIComponent(
      host.mac
    )}&hostname=${encodeURIComponent(host.hostname)}&os=ubuntu" || true`,
  ];
}
