import type { BootContext } from "../../types.ts";

export function renderSuseMicroIpxe(ctx: BootContext): string {
  const { hostConfig, baseUrl, mac } = ctx;
  const version = hostConfig.version || "6.2";

  return `#!ipxe
echo ==========================================================
echo Starting openSUSE Leap Micro ${version} Provisioning
echo Hostname: ${hostConfig.hostname}
echo MAC:      ${mac}
echo ==========================================================

set base_url ${baseUrl}
echo Loading openSUSE Leap Micro Kernel...
kernel \${base_url}/assets/suse-micro/${version}/vmlinuz combustion.url=\${base_url}/os/suse-micro/${mac}/combustion/script ip=dhcp
echo Loading Initrd...
initrd \${base_url}/assets/suse-micro/${version}/initrd
boot
`;
}
