import type { BootContext } from "../../types.ts";

export function renderTalosIpxe(ctx: BootContext): string {
  const { hostConfig, baseUrl, mac } = ctx;
  const version = hostConfig.version || "v1.14.0";
  const role = hostConfig.role?.toLowerCase() === "controlplane" ? "controlplane" : "worker";

  return `#!ipxe
echo ==========================================================
echo Starting Talos Linux ${version} Boot (${role})
echo Hostname: ${hostConfig.hostname}
echo MAC:      ${mac}
echo ==========================================================

set base_url ${baseUrl}
echo Loading Talos Kernel...
kernel \${base_url}/assets/talos/${version}/vmlinuz-amd64 talos.platform=metal talos.config=\${base_url}/os/talos/${mac}/config.yaml init_on_alloc=1 slab_nomerge pti=on console=tty0 console=ttyS0 printk.devkmsg=on ip=dhcp
echo Loading Talos Initramfs...
initrd \${base_url}/assets/talos/${version}/initramfs-amd64.xz
boot
`;
}
