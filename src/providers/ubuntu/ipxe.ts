import type { BootContext } from "../../types.ts";

export function renderUbuntuIpxe(ctx: BootContext): string {
  const { hostConfig, baseUrl, mac } = ctx;
  const version = hostConfig.version || "24.04";
  const isoName = `ubuntu-${version}-live-server-amd64.iso`;

  // Resolve NFS root if specified in host config or environment variable
  const rawNfsRoot =
    hostConfig.custom?.nfs_root ||
    process.env.UBUNTU_NFS_ROOT;
  const nfsRoot = rawNfsRoot ? rawNfsRoot.replace(/\${version}/g, version) : undefined;

  // Boot method determination:
  // - "nfs": uses NFS share (best for low-RAM VMs or fast network install without downloading ISO into RAM)
  // - "http": downloads ISO into RAM via HTTP (default & recommended for bare-metal with >=8GB RAM)
  const bootMethod =
    hostConfig.custom?.boot_method ||
    (nfsRoot ? "nfs" : "http");

  let kernelBootArgs = "";
  if (bootMethod === "nfs" && nfsRoot) {
    kernelBootArgs = `boot=casper netboot=nfs nfsroot=${nfsRoot} ip=dhcp autoinstall ds=nocloud-net;s=\${base_url}/os/ubuntu/${mac}/`;
  } else {
    kernelBootArgs = `boot=casper url=\${base_url}/assets/ubuntu/${version}/${isoName} ip=dhcp autoinstall ds=nocloud-net;s=\${base_url}/os/ubuntu/${mac}/`;
  }

  return `#!ipxe
echo ==========================================================
echo Starting Ubuntu Server ${version} Autoinstall (${bootMethod.toUpperCase()})
echo Hostname: ${hostConfig.hostname}
echo MAC:      ${mac}
echo Profile:  ${hostConfig.profile || "generic"}
echo Method:   ${bootMethod.toUpperCase()}${bootMethod === "nfs" ? ` (${nfsRoot})` : ""}
echo ==========================================================

set base_url ${baseUrl}
echo Loading Linux Kernel...
kernel \${base_url}/assets/ubuntu/${version}/vmlinuz initrd=initrd ${kernelBootArgs}
echo Loading Initrd...
initrd \${base_url}/assets/ubuntu/${version}/initrd
boot
`;
}
