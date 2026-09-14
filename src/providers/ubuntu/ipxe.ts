import type { BootContext } from "../../types.ts";

export function renderUbuntuIpxe(ctx: BootContext): string {
  const { hostConfig, baseUrl, mac } = ctx;
  const version = hostConfig.version || "24.04";
  const isoName = `ubuntu-${version}-live-server-amd64.iso`;

  return `#!ipxe
echo ==========================================================
echo Starting Ubuntu Server ${version} Autoinstall
echo Hostname: ${hostConfig.hostname}
echo MAC:      ${mac}
echo Profile:  ${hostConfig.profile || "generic"}
echo ==========================================================

set base_url ${baseUrl}
echo Loading Linux Kernel...
kernel \${base_url}/assets/ubuntu/${version}/vmlinuz ip=dhcp url=\${base_url}/assets/ubuntu/${version}/${isoName} autoinstall ds=nocloud-net;s=\${base_url}/os/ubuntu/${mac}/
echo Loading Initrd...
initrd \${base_url}/assets/ubuntu/${version}/initrd
boot
`;
}
