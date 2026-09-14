import YAML from "yaml";
import type { HostConfig } from "../../types.ts";
import { getUbuntuProfile } from "./profiles/index.ts";

export function renderUbuntuUserData(host: HostConfig, baseUrl: string): string {
  const profileSpec = getUbuntuProfile(host.profile || "generic", host, baseUrl);
  const username = host.user || "homelab";

  // Default fallback password hash for 'ubuntu' if no hash provided (SHA-512)
  // Password: "ubuntu"
  const passwordHash =
    host.password_hash ||
    "$6$rounds=4096$homelab$8v3vN6iG1tY9uF8J4Q0Gj0qUvF4/F1C/bXGzP1oJ4mK8Pq1R3w7e9t2y5u1i4o7p0";

  const packages = Array.from(
    new Set([...profileSpec.packages, ...(host.extra_packages || [])])
  );

  // Network configuration
  let networkConfig: any = {
    version: 2,
    ethernets: {
      default_eth: {
        match: {
          name: "*",
        },
        dhcp4: true,
      },
    },
  };

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
    const nameservers = host.network.nameservers || ["1.1.1.1", "8.8.8.8"];

    const ethConfig: any = {
      match: {
        macaddress: host.mac,
      },
      addresses: [`${host.network.ip}/${cidr}`],
      routes: host.network.gateway
        ? [{ to: "default", via: host.network.gateway }]
        : [],
      nameservers: {
        addresses: nameservers,
      },
    };

    if (host.network.interface) {
      ethConfig.set_name = host.network.interface;
    }

    networkConfig = {
      version: 2,
      ethernets: {
        static_eth: ethConfig,
      },
    };
  }

  // Storage configuration
  const storageConfig: any = {
    layout: {
      name: host.storage?.layout || "direct",
    },
  };

  if (host.storage?.target_disk) {
    // If target disk is explicitly specified
    storageConfig.layout.match = {
      path: host.storage.target_disk,
    };
  }

  const autoinstallConfig: any = {
    autoinstall: {
      version: 1,
      "interactive-sections": [],
      "refresh-installer": {
        update: false,
      },
      keyboard: {
        layout: "us",
      },
      locale: "en_US.UTF-8",
      identity: {
        hostname: host.hostname,
        username: username,
        password: passwordHash,
      },
      ssh: {
        "install-server": true,
        "allow-pw": true,
        "authorized-keys": host.ssh_authorized_keys || [],
      },
      storage: storageConfig,
      network: networkConfig,
      packages: packages,
      "late-commands": profileSpec.lateCommands,
    },
  };

  return `#cloud-config\n${YAML.stringify(autoinstallConfig, { lineWidth: 0 })}`;
}

export function renderUbuntuMetaData(host: HostConfig): string {
  const meta = {
    "instance-id": `i-${host.mac.replace(/:/g, "")}`,
    "local-hostname": host.hostname,
  };
  return YAML.stringify(meta);
}
