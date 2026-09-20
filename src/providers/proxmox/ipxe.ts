import type { BootContext } from "../../types.ts";

export const PROXMOX_DEFAULT_VERSION = "9.2";

export function renderProxmoxIpxe(ctx: BootContext): string {
  const { hostConfig, baseUrl, mac } = ctx;
  const version = hostConfig.version || PROXMOX_DEFAULT_VERSION;

  return `#!ipxe
echo ==========================================================
echo Starting Proxmox VE ${version} Automated Installation
echo Hostname: ${hostConfig.hostname}
echo MAC:      ${mac}
echo Profile:  ${hostConfig.profile || "generic"}
echo ==========================================================

imgfree
set base_url ${baseUrl}
echo Loading Proxmox Kernel...
kernel \${base_url}/assets/proxmox/${version}/vmlinuz initrd=initrd.img ramdisk_size=16777216 rw quiet splash=silent proxmox-start-auto-installer
echo Loading Proxmox Initrd...
initrd \${base_url}/assets/proxmox/${version}/initrd.img
boot
`;
}
