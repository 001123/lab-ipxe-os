import YAML from "yaml";
import type { HostConfig } from "../../types.ts";

export function renderTalosMachineConfig(host: HostConfig): string {
  const version = host.version || "v1.14.0";
  const role = host.role?.toLowerCase() === "controlplane" ? "controlplane" : "worker";
  const disk = host.storage?.target_disk || "/dev/sda";

  // Base machine config
  const machineConfig: any = {
    version: "v1alpha1",
    kind: "MachineConfig",
    machine: {
      type: role,
      network: {
        hostname: host.hostname,
      },
      install: {
        disk: disk,
        image: `ghcr.io/siderolabs/installer:${version}`,
        bootloader: true,
        wipe: true,
      },
    },
    cluster: {
      clusterName: host.custom?.clusterName || "talos-homelab",
      network: {
        cni: {
          name: host.custom?.cni || "flannel",
        },
      },
    },
  };

  // Static network if configured
  if (host.network && host.network.dhcp === false && host.network.ip) {
    const netmaskToCidr = (mask?: string): number => {
      if (!mask) return 24;
      return mask
        .split(".")
        .map(Number)
        .map((n) => n.toString(2).replace(/0/g, "").length)
        .reduce((a, b) => a + b, 0);
    };

    const cidr = netmaskToCidr(host.network.netmask);
    const ifaceName = host.network.interface || "eth0";

    machineConfig.machine.network.interfaces = [
      {
        interface: ifaceName,
        dhcp: false,
        addresses: [`${host.network.ip}/${cidr}`],
        routes: host.network.gateway
          ? [{ network: "0.0.0.0/0", gateway: host.network.gateway }]
          : [],
        nameservers: host.network.nameservers || ["1.1.1.1", "8.8.8.8"],
      },
    ];
  }

  return YAML.stringify(machineConfig);
}
