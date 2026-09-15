import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { HostConfig, HostsFileStructure } from "./types.ts";

export interface AppConfig {
  port: number;
  host: string;
  baseUrl: string;
  ipxeMenuTimeout: number;
  configPath: string;
}

export class ConfigManager {
  private configPath: string;
  public appConfig: AppConfig;

  constructor(configPath?: string) {
    this.configPath = resolve(configPath || process.env.CONFIG_PATH || "./config/hosts.yaml");
    this.appConfig = {
      port: parseInt(process.env.PORT || "3000", 10),
      host: process.env.HOST || "0.0.0.0",
      baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || "3000"}`,
      ipxeMenuTimeout: parseInt(process.env.IPXE_MENU_TIMEOUT || "5", 10),
      configPath: this.configPath,
    };
  }

  public normalizeMac(mac: string): string {
    return mac
      .trim()
      .toLowerCase()
      .replace(/[-]/g, ":")
      .replace(/^0x/, "");
  }

  public loadHostsConfig(): HostsFileStructure {
    if (!existsSync(this.configPath)) {
      return {
        default: {
          os: "ubuntu",
          version: "24.04",
          profile: "generic",
          user: "homelab",
          storage: { layout: "direct" },
          network: { dhcp: true },
        },
        hosts: {},
      };
    }

    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const parsed = YAML.parse(raw) as HostsFileStructure;
      return parsed || { default: { os: "ubuntu" }, hosts: {} };
    } catch (err) {
      console.error(`[Config] Failed to parse YAML from ${this.configPath}:`, err);
      throw err;
    }
  }

  public getHost(mac: string): HostConfig {
    const cleanMac = this.normalizeMac(mac);
    const configData = this.loadHostsConfig();
    const defaults = configData.default || { os: "ubuntu", version: "24.04" };

    // Find host by normalized MAC
    let matchedHost: Partial<HostConfig> | undefined;
    if (configData.hosts) {
      for (const [key, value] of Object.entries(configData.hosts)) {
        if (this.normalizeMac(key) === cleanMac) {
          matchedHost = value;
          break;
        }
      }
    }

    const shortMac = cleanMac.replace(/:/g, "").slice(-6) || "node";
    const defaultHostname = `homelab-${shortMac}`;

    // Deep merge defaults with host specific config
    const finalHost: HostConfig = {
      mac: cleanMac,
      hostname: matchedHost?.hostname || defaultHostname,
      os: matchedHost?.os || defaults.os || "ubuntu",
      version: matchedHost?.version || defaults.version,
      profile: matchedHost?.profile || defaults.profile || "generic",
      role: matchedHost?.role || defaults.role,
      user: matchedHost?.user || defaults.user || "homelab",
      password_hash: matchedHost?.password_hash || defaults.password_hash,
      ssh_authorized_keys: [
        ...(defaults.ssh_authorized_keys || []),
        ...(matchedHost?.ssh_authorized_keys || []),
      ],
      storage: {
        ...defaults.storage,
        ...matchedHost?.storage,
      },
      network: {
        ...defaults.network,
        ...matchedHost?.network,
      },
      extra_packages: [
        ...(defaults.extra_packages || []),
        ...(matchedHost?.extra_packages || []),
      ],
      force_install: matchedHost?.force_install ?? false,
      note: matchedHost?.note || defaults.note || undefined,
      custom: {
        ...defaults.custom,
        ...matchedHost?.custom,
      },
    };

    return finalHost;
  }
}
