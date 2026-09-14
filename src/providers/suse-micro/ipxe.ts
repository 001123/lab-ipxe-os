import type { BootContext } from "../../types.ts";

export function renderSuseMicroIpxe(ctx: BootContext): string {
  const { hostConfig, baseUrl, mac } = ctx;
  const version = hostConfig.version || "6.2";
  const targetDisk = hostConfig.storage?.target_disk || "/dev/sda";

  let ipParam = "ip=dhcp";
  if (hostConfig.network && hostConfig.network.dhcp === false && hostConfig.network.ip) {
    const ip = hostConfig.network.ip;
    const gw = hostConfig.network.gateway || "";
    const mask = hostConfig.network.netmask || "255.255.255.0";
    const hostname = hostConfig.hostname;
    const dns1 = hostConfig.network.nameservers?.[0] || "";
    const dns2 = hostConfig.network.nameservers?.[1] || "";
    const dnsPart = dns1 ? (dns2 ? `:${dns1}:${dns2}` : `:${dns1}`) : "";
    ipParam = `ip=${ip}::${gw}:${mask}:${hostname}::none${dnsPart}`;
  }

  return `#!ipxe
echo ==========================================================
echo Starting openSUSE Leap Micro ${version} Provisioning
echo Hostname: ${hostConfig.hostname}
echo MAC:      ${mac}
echo Target:   ${targetDisk}
echo ==========================================================

imgfree
set base_url ${baseUrl}
echo Loading openSUSE Leap Micro Kernel...
kernel \${base_url}/assets/suse-micro/${version}/vmlinuz rd.kiwi.install.pxe rd.kiwi.install.image=\${base_url}/assets/suse-micro/${version}/openSUSE-Leap-Micro.x86_64-${version}.xz rd.kiwi.oem.installdevice=${targetDisk} rd.kiwi.install.pass.bootparam combustion.firstboot combustion.url=\${base_url}/os/suse-micro/${mac}/combustion/script rd.neednet=1 ${ipParam} console=ttyS0,115200 console=tty0 systemd.show_status=1
echo Loading Initrd...
initrd \${base_url}/assets/suse-micro/${version}/initrd
boot
`;
}
