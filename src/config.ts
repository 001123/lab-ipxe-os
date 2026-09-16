import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import type { HostConfig, HostsFileStructure, SystemConfig } from "./types.ts";
import type { StateManager } from "./core/state.ts";

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
  private stateMgr?: StateManager;

  constructor(configPath?: string, stateMgr?: StateManager) {
    this.configPath = resolve(configPath || process.env.CONFIG_PATH || "./config/hosts.yaml");
    this.stateMgr = stateMgr;
    this.appConfig = {
      port: parseInt(process.env.PORT || "3000", 10),
      host: process.env.HOST || "0.0.0.0",
      baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || "3000"}`,
      ipxeMenuTimeout: parseInt(process.env.IPXE_MENU_TIMEOUT || "5", 10),
      configPath: this.configPath,
    };
    this.syncFromState();
  }

  public attachStateManager(stateMgr: StateManager): void {
    this.stateMgr = stateMgr;
    this.syncFromState();
  }

  public syncFromState(): void {
    if (this.stateMgr) {
      const sysConfig = this.stateMgr.getSystemConfig();
      if (sysConfig) {
        if (sysConfig.baseUrl) {
          this.appConfig.baseUrl = sysConfig.baseUrl.replace(/\/+$/, "");
        }
        if (typeof sysConfig.ipxeMenuTimeout === "number" && !Number.isNaN(sysConfig.ipxeMenuTimeout)) {
          this.appConfig.ipxeMenuTimeout = sysConfig.ipxeMenuTimeout;
        }
      }
    }
  }

  public updateSystemConfig(updates: Partial<SystemConfig>): AppConfig {
    if (updates.baseUrl) {
      this.appConfig.baseUrl = updates.baseUrl.trim().replace(/\/+$/, "");
    }
    if (typeof updates.ipxeMenuTimeout === "number" && !Number.isNaN(updates.ipxeMenuTimeout)) {
      this.appConfig.ipxeMenuTimeout = Math.max(0, Math.floor(updates.ipxeMenuTimeout));
    }

    if (this.stateMgr) {
      this.stateMgr.saveSystemConfig({
        baseUrl: this.appConfig.baseUrl,
        ipxeMenuTimeout: this.appConfig.ipxeMenuTimeout,
      });
    }

    return this.appConfig;
  }

  public normalizeMac(mac: string): string {
    return (mac || "")
      .trim()
      .toLowerCase()
      .replace(/[-]/g, ":")
      .replace(/^0x/, "");
  }

  public loadHostsConfig(): HostsFileStructure {
    // If StateManager is attached, SQLite is the Single Source of Truth
    if (this.stateMgr) {
      const defaults = this.stateMgr.getGlobalDefaultConfig();
      const hosts = this.stateMgr.getAllHosts(false);
      const hostsMap: Record<string, Partial<HostConfig>> = {};
      for (const h of hosts) {
        hostsMap[this.normalizeMac(h.mac)] = h;
      }
      return {
        default: defaults,
        hosts: hostsMap,
      };
    }

    let targetPath = this.configPath;

    if (!existsSync(targetPath)) {
      const dir = dirname(targetPath);
      const candidateExample = resolve(dir, "hosts.example.yaml");
      const rootExample = resolve("./config/hosts.example.yaml");

      const fallbackExample = existsSync(candidateExample)
        ? candidateExample
        : existsSync(rootExample)
          ? rootExample
          : existsSync(resolve("./config/hosts.yaml"))
            ? resolve("./config/hosts.yaml")
            : null;

      if (fallbackExample) {
        console.warn(`[Config] '${targetPath}' not found. Falling back to example config '${fallbackExample}'.`);
        targetPath = fallbackExample;
      } else {
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
    }

    try {
      const raw = readFileSync(targetPath, "utf-8");
      const parsed = YAML.parse(raw) as HostsFileStructure;
      return parsed || { default: { os: "ubuntu" }, hosts: {} };
    } catch (err) {
      console.error(`[Config] Failed to parse YAML from ${targetPath}:`, err);
      throw err;
    }
  }

  public getHost(mac: string): HostConfig {
    const cleanMac = this.normalizeMac(mac);

    if (this.stateMgr) {
      const dbHost = this.stateMgr.getHost(cleanMac, true);
      if (dbHost) return dbHost;

      // Unknown MAC fallback using global default config
      const defaults = this.stateMgr.getGlobalDefaultConfig();
      const shortMac = cleanMac.replace(/:/g, "").slice(-6) || "node";
      return {
        mac: cleanMac,
        hostname: `homelab-${shortMac}`,
        os: defaults.os || "ubuntu",
        version: defaults.version,
        profile: defaults.profile || "generic",
        role: defaults.role,
        user: defaults.user || "homelab",
        password_hash: defaults.password_hash,
        ssh_authorized_keys: defaults.ssh_authorized_keys || [],
        storage: { ...defaults.storage },
        network: { ...defaults.network, dhcp: true },
        extra_packages: defaults.extra_packages || [],
        force_install: false,
        note: defaults.note,
        custom: { ...defaults.custom },
        status: "PENDING",
      };
    }

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
