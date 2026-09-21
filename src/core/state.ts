import { Database } from "bun:sqlite";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import type {
  AppState,
  StateRecord,
  NodeRecord,
  NodeStatus,
  HostConfig,
  HostEntity,
  DefaultHostConfig,
  HostsFileStructure,
  ImportYamlOptions,
  ImportYamlResult,
  SystemConfig,
} from "../types.ts";

export class StateManager {
  private dbPath: string;
  private db: Database;
  private yamlSeedPath: string;

  constructor(filePath?: string, yamlSeedPath?: string, defaultSystemConfig?: Partial<SystemConfig>) {
    const envDbPath = process.env.DB_PATH;
    const isMemory = filePath === ":memory:" || (!filePath && envDbPath === ":memory:");

    if (isMemory) {
      this.dbPath = ":memory:";
    } else {
      const defaultDataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), "data");
      const defaultDbPath = envDbPath && envDbPath !== ":memory:" ? resolve(envDbPath) : join(defaultDataDir, "state.db");
      const targetPath = filePath || defaultDbPath;

      if (targetPath.endsWith(".json")) {
        this.dbPath = targetPath.replace(/\.json$/, ".db");
      } else {
        this.dbPath = targetPath;
      }

      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.yamlSeedPath = resolve(yamlSeedPath || process.env.CONFIG_PATH || "./config/hosts.yaml");
    this.db = new Database(this.dbPath);
    this.initDb(defaultSystemConfig);
  }

  public normalizeMac(mac: string): string {
    const raw = (mac || "")
      .trim()
      .toLowerCase()
      .replace(/^0x/, "");
    const cleanHex = raw.replace(/[^0-9a-f]/g, "");
    if (cleanHex.length === 12) {
      return cleanHex.match(/.{2}/g)!.join(":");
    }
    return raw.replace(/[-]/g, ":");
  }

  public isValidMac(mac: string): boolean {
    const clean = this.normalizeMac(mac);
    return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(clean);
  }

  private initDb(defaultSystemConfig?: Partial<SystemConfig>): void {
    try {
      if (this.dbPath !== ":memory:") {
        this.db.run("PRAGMA journal_mode = WAL;");
        this.db.run("PRAGMA busy_timeout = 5000;");
      }

      // Global configuration table for defaults & settings
      this.db.run(`
        CREATE TABLE IF NOT EXISTS global_config (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Comprehensive hosts table (Structured + JSON fields)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS hosts (
          mac TEXT PRIMARY KEY,
          hostname TEXT NOT NULL,
          os TEXT NOT NULL,
          version TEXT,
          profile TEXT,
          role TEXT,
          user TEXT,
          password_hash TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          ip TEXT,
          dhcp INTEGER DEFAULT 1,
          netmask TEXT,
          gateway TEXT,
          nameservers_json TEXT,
          interface TEXT,
          target_disk TEXT,
          storage_layout TEXT,
          swap_size TEXT,
          ssh_keys_json TEXT,
          extra_packages_json TEXT,
          force_install INTEGER DEFAULT 0,
          note TEXT,
          custom_json TEXT,
          installed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      this.db.run("CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);");
      this.db.run("CREATE INDEX IF NOT EXISTS idx_hosts_hostname ON hosts(hostname);");

      // Check if hosts table is empty; if so, seed from hosts.yaml
      const countRow = this.db.prepare("SELECT count(*) as count FROM hosts").get() as { count: number };
      if (countRow.count === 0) {
        this.seedFromYaml();
      }

      // Ensure system config is initialized in global_config
      const sysConfigRow = this.db.prepare("SELECT count(*) as count FROM global_config WHERE key = 'system_config'").get() as { count: number };
      if (sysConfigRow.count === 0) {
        const defaultPort = process.env.PORT || "3000";
        const defaultBaseUrl = defaultSystemConfig?.baseUrl || process.env.BASE_URL || `http://localhost:${defaultPort}`;
        const defaultTimeout = defaultSystemConfig?.ipxeMenuTimeout ?? parseInt(process.env.IPXE_MENU_TIMEOUT || "5", 10);
        this.saveSystemConfig({
          baseUrl: defaultBaseUrl,
          ipxeMenuTimeout: Number.isNaN(defaultTimeout) ? 5 : defaultTimeout,
        });
      }
    } catch (err) {
      console.error(`[State] Error initializing database at ${this.dbPath}:`, err);
    }
  }

  public seedFromYaml(): void {
    let targetYaml = this.yamlSeedPath;
    if (!existsSync(targetYaml)) {
      const example = resolve(dirname(targetYaml), "hosts.example.yaml");
      const rootExample = resolve("./config/hosts.example.yaml");
      targetYaml = existsSync(example) ? example : existsSync(rootExample) ? rootExample : "";
    }

    if (!targetYaml || !existsSync(targetYaml)) {
      console.log(`[State] No YAML seed file found. Initializing with empty default config.`);
      this.saveGlobalDefaultConfig({
        os: "ubuntu",
        version: "24.04",
        profile: "generic",
        user: "homelab",
        storage: { layout: "direct", target_disk: "/dev/sda" },
        network: { dhcp: true },
      });
      return;
    }

    try {
      const raw = readFileSync(targetYaml, "utf-8");
      const parsed = YAML.parse(raw) as HostsFileStructure;
      if (!parsed) return;

      if (parsed.default) {
        this.saveGlobalDefaultConfig(parsed.default);
      }

      if (parsed.hosts && typeof parsed.hosts === "object") {
        const entries = Object.entries(parsed.hosts);
        console.log(`[State] Seeding ${entries.length} hosts from ${targetYaml} into SQLite...`);

        // Check if legacy nodes table or legacy state.json had install records
        const installedMacs = new Set<string>();
        try {
          const legacyNodes = this.db.prepare("SELECT mac FROM nodes WHERE status = 'INSTALLED'").all() as any[];
          for (const row of legacyNodes) {
            installedMacs.add(this.normalizeMac(row.mac));
          }
        } catch {}

        this.db.transaction(() => {
          for (const [rawMac, spec] of entries) {
            const cleanMac = this.normalizeMac(rawMac);
            const status: NodeStatus = installedMacs.has(cleanMac) ? "INSTALLED" : "PENDING";
            this.createHostInternal({
              mac: cleanMac,
              hostname: spec.hostname || `homelab-${cleanMac.replace(/:/g, "").slice(-6)}`,
              os: spec.os || parsed.default?.os || "ubuntu",
              version: spec.version || parsed.default?.version,
              profile: spec.profile || parsed.default?.profile,
              role: spec.role || parsed.default?.role,
              user: spec.user || parsed.default?.user,
              password_hash: spec.password_hash || parsed.default?.password_hash,
              ssh_authorized_keys: spec.ssh_authorized_keys || parsed.default?.ssh_authorized_keys,
              storage: { ...parsed.default?.storage, ...spec.storage },
              network: { ...parsed.default?.network, ...spec.network },
              extra_packages: spec.extra_packages || parsed.default?.extra_packages,
              force_install: spec.force_install ?? false,
              note: spec.note || parsed.default?.note,
              custom: { ...parsed.default?.custom, ...spec.custom },
              status,
              installed_at: status === "INSTALLED" ? new Date().toISOString() : undefined,
            });
          }
        })();
        console.log(`[State] Successfully seeded hosts into SQLite database.`);
      }
    } catch (err) {
      console.error(`[State] Error seeding from YAML ${targetYaml}:`, err);
    }
  }

  public isSeedHost(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    try {
      let targetYaml = this.yamlSeedPath;
      if (!existsSync(targetYaml)) {
        const example = resolve(dirname(targetYaml), "hosts.example.yaml");
        const rootExample = resolve("./config/hosts.example.yaml");
        targetYaml = existsSync(example) ? example : existsSync(rootExample) ? rootExample : "";
      }
      if (targetYaml && existsSync(targetYaml)) {
        const raw = readFileSync(targetYaml, "utf-8");
        const parsed = YAML.parse(raw) as HostsFileStructure;
        if (parsed?.hosts) {
          for (const k of Object.keys(parsed.hosts)) {
            if (this.normalizeMac(k) === cleanMac) return true;
          }
        }
      }
    } catch {}
    return false;
  }

  // --- Global Default Configuration ---

  public getGlobalDefaultConfig(): DefaultHostConfig {
    try {
      const row = this.db.prepare("SELECT value_json FROM global_config WHERE key = 'default_host_config'").get() as any;
      if (row?.value_json) {
        return JSON.parse(row.value_json);
      }
    } catch (err) {
      console.error("[State] Error reading global default config:", err);
    }

    return {
      os: "ubuntu",
      version: "24.04",
      profile: "generic",
      user: "homelab",
      storage: { layout: "direct", target_disk: "/dev/sda" },
      network: { dhcp: true },
    };
  }

  public saveGlobalDefaultConfig(config: DefaultHostConfig): void {
    const json = JSON.stringify(config);
    this.db.prepare(`
      INSERT INTO global_config (key, value_json, updated_at)
      VALUES ('default_host_config', $json, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = datetime('now')
    `).run({ $json: json });
  }

  // --- System Configuration (Base URL & iPXE Menu Timeout) ---

  public getSystemConfig(): SystemConfig | null {
    try {
      const row = this.db.prepare("SELECT value_json FROM global_config WHERE key = 'system_config'").get() as any;
      if (row?.value_json) {
        const parsed = JSON.parse(row.value_json);
        if (parsed && typeof parsed.baseUrl === "string" && typeof parsed.ipxeMenuTimeout === "number") {
          return parsed as SystemConfig;
        }
      }
    } catch (err) {
      console.error("[State] Error reading system config:", err);
    }
    return null;
  }

  public saveSystemConfig(config: SystemConfig): void {
    const json = JSON.stringify({
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      ipxeMenuTimeout: Math.max(0, Math.floor(config.ipxeMenuTimeout)),
    });
    this.db.prepare(`
      INSERT INTO global_config (key, value_json, updated_at)
      VALUES ('system_config', $json, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = datetime('now')
    `).run({ $json: json });
  }

  // --- Host Entity Mapping ---

  private rowToHost(row: any, applyDefaults: boolean = true): HostConfig {
    let nameservers: string[] | undefined;
    try { nameservers = row.nameservers_json ? JSON.parse(row.nameservers_json) : undefined; } catch {}

    let ssh_keys: string[] | undefined;
    try { ssh_keys = row.ssh_keys_json ? JSON.parse(row.ssh_keys_json) : undefined; } catch {}

    let extra_packages: string[] | undefined;
    try { extra_packages = row.extra_packages_json ? JSON.parse(row.extra_packages_json) : undefined; } catch {}

    let custom: Record<string, any> | undefined;
    try { custom = row.custom_json ? JSON.parse(row.custom_json) : undefined; } catch {}

    const defaults = applyDefaults ? this.getGlobalDefaultConfig() : {};

    const host: HostConfig = {
      mac: row.mac,
      hostname: row.hostname || `homelab-${row.mac.replace(/:/g, "").slice(-6)}`,
      os: row.os || defaults.os || "ubuntu",
      version: row.version || defaults.version,
      profile: row.profile || defaults.profile || "generic",
      role: row.role || defaults.role,
      user: row.user || defaults.user || "homelab",
      password_hash: row.password_hash || defaults.password_hash,
      ssh_authorized_keys: [
        ...(defaults.ssh_authorized_keys || []),
        ...(ssh_keys || []),
      ],
      storage: {
        ...defaults.storage,
        target_disk: row.target_disk || defaults.storage?.target_disk,
        layout: (row.storage_layout || defaults.storage?.layout || "direct") as any,
        swap_size: row.swap_size || defaults.storage?.swap_size,
      },
      network: {
        dhcp: row.dhcp !== null && row.dhcp !== undefined ? Boolean(row.dhcp) : (defaults.network?.dhcp ?? true),
        ip: row.ip || defaults.network?.ip,
        netmask: row.netmask || defaults.network?.netmask,
        gateway: row.gateway || defaults.network?.gateway,
        nameservers: nameservers || defaults.network?.nameservers,
        interface: row.interface || defaults.network?.interface,
      },
      extra_packages: [
        ...(defaults.extra_packages || []),
        ...(extra_packages || []),
      ],
      force_install: Boolean(row.force_install),
      note: row.note || defaults.note,
      custom: {
        ...(defaults.custom || {}),
        ...(custom || {}),
      },
      status: (row.status as NodeStatus) || "PENDING",
      installed_at: row.installed_at || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    return host;
  }

  // --- CRUD Operations ---

  private createHostInternal(host: HostConfig): HostConfig {
    const cleanMac = this.normalizeMac(host.mac);
    const now = new Date().toISOString();

    const insertStmt = this.db.prepare(`
      INSERT INTO hosts (
        mac, hostname, os, version, profile, role, user, password_hash, status,
        ip, dhcp, netmask, gateway, nameservers_json, interface,
        target_disk, storage_layout, swap_size,
        ssh_keys_json, extra_packages_json, force_install, note, custom_json,
        installed_at, created_at, updated_at
      ) VALUES (
        $mac, $hostname, $os, $version, $profile, $role, $user, $password_hash, $status,
        $ip, $dhcp, $netmask, $gateway, $nameservers_json, $interface,
        $target_disk, $storage_layout, $swap_size,
        $ssh_keys_json, $extra_packages_json, $force_install, $note, $custom_json,
        $installed_at, $created_at, $updated_at
      )
      ON CONFLICT(mac) DO UPDATE SET
        hostname = excluded.hostname,
        os = excluded.os,
        version = excluded.version,
        profile = excluded.profile,
        role = excluded.role,
        user = excluded.user,
        password_hash = coalesce(excluded.password_hash, hosts.password_hash),
        status = excluded.status,
        ip = excluded.ip,
        dhcp = excluded.dhcp,
        netmask = excluded.netmask,
        gateway = excluded.gateway,
        nameservers_json = excluded.nameservers_json,
        interface = excluded.interface,
        target_disk = excluded.target_disk,
        storage_layout = excluded.storage_layout,
        swap_size = excluded.swap_size,
        ssh_keys_json = excluded.ssh_keys_json,
        extra_packages_json = excluded.extra_packages_json,
        force_install = excluded.force_install,
        note = excluded.note,
        custom_json = excluded.custom_json,
        installed_at = coalesce(excluded.installed_at, hosts.installed_at),
        updated_at = excluded.updated_at
    `);

    insertStmt.run({
      $mac: cleanMac,
      $hostname: host.hostname,
      $os: host.os || "ubuntu",
      $version: host.version || null,
      $profile: host.profile || "generic",
      $role: host.role || null,
      $user: host.user || null,
      $password_hash: host.password_hash || null,
      $status: host.status || "PENDING",
      $ip: host.network?.ip || null,
      $dhcp: host.network?.dhcp !== false ? 1 : 0,
      $netmask: host.network?.netmask || null,
      $gateway: host.network?.gateway || null,
      $nameservers_json: host.network?.nameservers ? JSON.stringify(host.network.nameservers) : null,
      $interface: host.network?.interface || null,
      $target_disk: host.storage?.target_disk || null,
      $storage_layout: host.storage?.layout || null,
      $swap_size: host.storage?.swap_size ? String(host.storage.swap_size) : null,
      $ssh_keys_json: host.ssh_authorized_keys ? JSON.stringify(host.ssh_authorized_keys) : null,
      $extra_packages_json: host.extra_packages ? JSON.stringify(host.extra_packages) : null,
      $force_install: host.force_install ? 1 : 0,
      $note: host.note || null,
      $custom_json: host.custom ? JSON.stringify(host.custom) : null,
      $installed_at: host.installed_at || null,
      $created_at: host.created_at || now,
      $updated_at: now,
    });

    return this.getHost(cleanMac)!;
  }

  public createHost(host: HostConfig): HostConfig {
    const cleanMac = this.normalizeMac(host.mac);
    if (!cleanMac) throw new Error("MAC address is required.");
    if (!host.hostname) throw new Error("Hostname is required.");
    return this.createHostInternal({ ...host, mac: cleanMac });
  }

  public getHost(mac: string, applyDefaults: boolean = true): HostConfig | null {
    const cleanMac = this.normalizeMac(mac);
    const row = this.db.prepare("SELECT * FROM hosts WHERE mac = ?").get(cleanMac);
    if (!row) return null;
    return this.rowToHost(row, applyDefaults);
  }

  public getHostByIdentifier(identifier: string): HostConfig | null {
    const trimmed = (identifier || "").trim();
    if (!trimmed) return null;

    // 1. Check MAC match
    const cleanMac = this.normalizeMac(trimmed);
    let host = this.getHost(cleanMac);
    if (host) return host;

    // 2. Check Hostname match (case-insensitive)
    const row = this.db.prepare("SELECT * FROM hosts WHERE lower(hostname) = ?").get(trimmed.toLowerCase());
    if (row) return this.rowToHost(row);

    return null;
  }

  public getAllHosts(applyDefaults: boolean = true): HostConfig[] {
    const rows = this.db.prepare("SELECT * FROM hosts ORDER BY updated_at DESC").all();
    return rows.map((r) => this.rowToHost(r, applyDefaults));
  }

  public updateHost(mac: string, patch: Partial<HostConfig>): HostConfig | null {
    const cleanMac = this.normalizeMac(mac);
    const existing = this.getHost(cleanMac, false);
    if (!existing) return null;

    const updated: HostConfig = {
      ...existing,
      ...patch,
      mac: cleanMac,
      storage: {
        ...existing.storage,
        ...patch.storage,
      },
      network: {
        ...existing.network,
        ...patch.network,
      },
      custom: patch.custom !== undefined ? patch.custom : existing.custom,
      updated_at: new Date().toISOString(),
    };

    return this.createHostInternal(updated);
  }

  public deleteHost(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    const res = this.db.prepare("DELETE FROM hosts WHERE mac = ?").run(cleanMac);
    return res.changes > 0;
  }

  public resetHostStatus(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    const host = this.getHost(cleanMac, false);
    if (host) {
      this.db.prepare(`
        UPDATE hosts SET status = 'PENDING', updated_at = datetime('now') WHERE mac = ?
      `).run(cleanMac);
      console.log(`[State] Reset install state for MAC ${cleanMac}. Status changed to PENDING.`);
      return true;
    }
    return false;
  }

  // --- Runtime Provisioning & Install Lifecycle ---

  public isInstalled(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    const host = this.getHost(cleanMac);
    return host?.status === "INSTALLED";
  }

  public getStatus(mac: string): NodeStatus {
    const cleanMac = this.normalizeMac(mac);
    const host = this.getHost(cleanMac);
    return host?.status ?? "PENDING";
  }

  public markProvisioning(
    mac: string,
    info: { hostname?: string; os?: string; clientIp?: string; note?: string } = {}
  ): HostConfig {
    const cleanMac = this.normalizeMac(mac);
    let existing = this.getHost(cleanMac, false);

    if (!existing) {
      // Create registered host with defaults
      const defaults = this.getGlobalDefaultConfig();
      existing = {
        mac: cleanMac,
        hostname: info.hostname || `homelab-${cleanMac.replace(/:/g, "").slice(-6)}`,
        os: info.os || defaults.os || "ubuntu",
        status: "PROVISIONING",
        network: { dhcp: true, ip: info.clientIp },
        note: info.note,
      };
      return this.createHostInternal(existing);
    }

    const nextStatus: NodeStatus = existing.status === "INSTALLED" ? "INSTALLED" : "PROVISIONING";
    return this.updateHost(cleanMac, {
      hostname: info.hostname || existing.hostname,
      os: info.os || existing.os,
      status: nextStatus,
      network: {
        ...existing.network,
        ip: info.clientIp || existing.network?.ip,
      },
      note: info.note ?? existing.note,
    })!;
  }

  public markInstalled(
    mac: string,
    info: { hostname?: string; os?: string; clientIp?: string; note?: string } = {}
  ): HostConfig {
    const cleanMac = this.normalizeMac(mac);
    const now = new Date().toISOString();
    let existing = this.getHost(cleanMac, false);

    if (!existing) {
      const defaults = this.getGlobalDefaultConfig();
      existing = {
        mac: cleanMac,
        hostname: info.hostname || `homelab-${cleanMac.replace(/:/g, "").slice(-6)}`,
        os: info.os || defaults.os || "ubuntu",
        status: "INSTALLED",
        installed_at: now,
        network: { dhcp: true, ip: info.clientIp },
        note: info.note,
      };
      return this.createHostInternal(existing);
    }

    return this.updateHost(cleanMac, {
      hostname: info.hostname || existing.hostname,
      os: info.os || existing.os,
      status: "INSTALLED",
      installed_at: now,
      network: {
        ...existing.network,
        ip: info.clientIp || existing.network?.ip,
      },
      note: info.note ?? existing.note,
    })!;
  }

  public updateNote(mac: string, note: string): HostConfig | null {
    return this.updateHost(mac, { note });
  }

  // --- YAML Export & Import ---

  public exportToYaml(): string {
    const defaults = this.getGlobalDefaultConfig();
    const allHosts = this.getAllHosts(false);

    const hostsObj: Record<string, any> = {};
    for (const h of allHosts) {
      const item: any = {
        hostname: h.hostname,
        os: h.os,
      };
      if (h.version) item.version = h.version;
      if (h.profile) item.profile = h.profile;
      if (h.role) item.role = h.role;
      if (h.note) item.note = h.note;
      if (h.custom && Object.keys(h.custom).length > 0) item.custom = h.custom;
      if (h.network) {
        item.network = {};
        if (h.network.dhcp !== undefined) item.network.dhcp = h.network.dhcp;
        if (h.network.ip) item.network.ip = h.network.ip;
        if (h.network.netmask) item.network.netmask = h.network.netmask;
        if (h.network.gateway) item.network.gateway = h.network.gateway;
        if (h.network.nameservers) item.network.nameservers = h.network.nameservers;
      }
      if (h.storage && (h.storage.target_disk || h.storage.layout)) {
        item.storage = {};
        if (h.storage.target_disk) item.storage.target_disk = h.storage.target_disk;
        if (h.storage.layout) item.storage.layout = h.storage.layout;
      }
      if (h.force_install) item.force_install = true;
      hostsObj[h.mac] = item;
    }

    const doc = {
      default: defaults,
      hosts: hostsObj,
    };

    return YAML.stringify(doc);
  }

  public importFromYaml(
    yamlContent: string,
    options: ImportYamlOptions = {}
  ): ImportYamlResult {
    const {
      replaceAll = false,
      updateDefaults = true,
      resetStatus = false,
    } = options;

    let parsed: HostsFileStructure;
    try {
      parsed = YAML.parse(yamlContent);
    } catch (err: any) {
      throw new Error(`YAML syntax error: ${err.message || String(err)}`);
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid YAML document: root element must be an object.");
    }

    const rawHosts = parsed.hosts;
    if (!rawHosts || typeof rawHosts !== "object") {
      throw new Error("Invalid YAML document: missing or invalid 'hosts' map.");
    }

    const hostEntries = Object.entries(rawHosts);
    if (hostEntries.length === 0 && !parsed.default) {
      throw new Error("YAML file contains no hosts and no default configuration.");
    }

    // Pre-validate all MAC addresses before starting transaction
    const validatedHosts: Array<{ cleanMac: string; spec: any }> = [];
    for (const [rawMac, spec] of hostEntries) {
      const cleanMac = this.normalizeMac(rawMac);
      if (!this.isValidMac(cleanMac)) {
        throw new Error(
          `Invalid MAC address format: "${rawMac}". Must be 6 pairs of hexadecimal digits (e.g., 00:11:22:33:44:55).`
        );
      }
      if (!spec || typeof spec !== "object") {
        throw new Error(`Invalid host configuration for MAC ${rawMac}: entry must be an object.`);
      }
      validatedHosts.push({ cleanMac, spec });
    }

    let addedCount = 0;
    let updatedCount = 0;

    // Run atomically inside SQLite transaction
    const runTransaction = this.db.transaction(() => {
      // 1. If replaceAll, delete all existing hosts
      if (replaceAll) {
        this.db.prepare("DELETE FROM hosts").run();
      }

      // 2. If updateDefaults is enabled and parsed.default is provided, update global_config
      if (updateDefaults && parsed.default && typeof parsed.default === "object") {
        this.saveGlobalDefaultConfig(parsed.default);
      }

      const activeDefaults = this.getGlobalDefaultConfig();

      // 3. Process validated hosts
      for (const { cleanMac, spec } of validatedHosts) {
        const existingHost = this.getHost(cleanMac, false);

        let status: NodeStatus = "PENDING";
        let installedAt: string | undefined = undefined;

        if (resetStatus) {
          status = "PENDING";
          installedAt = undefined;
        } else if (existingHost) {
          status = existingHost.status || "PENDING";
          installedAt = existingHost.installed_at;
        }

        if (existingHost && !replaceAll) {
          updatedCount++;
        } else {
          addedCount++;
        }

        const hostToSave: HostConfig = {
          mac: cleanMac,
          hostname: spec.hostname || (existingHost ? existingHost.hostname : `homelab-${cleanMac.replace(/:/g, "").slice(-6)}`),
          os: spec.os || activeDefaults.os || "ubuntu",
          version: spec.version !== undefined ? spec.version : (activeDefaults.version || existingHost?.version),
          profile: spec.profile !== undefined ? spec.profile : (activeDefaults.profile || existingHost?.profile || "generic"),
          role: spec.role !== undefined ? spec.role : (activeDefaults.role || existingHost?.role),
          user: spec.user !== undefined ? spec.user : (activeDefaults.user || existingHost?.user),
          password_hash: spec.password_hash !== undefined ? spec.password_hash : (activeDefaults.password_hash || existingHost?.password_hash),
          ssh_authorized_keys: spec.ssh_authorized_keys || activeDefaults.ssh_authorized_keys || existingHost?.ssh_authorized_keys,
          storage: { ...activeDefaults.storage, ...existingHost?.storage, ...spec.storage },
          network: { ...activeDefaults.network, ...existingHost?.network, ...spec.network },
          extra_packages: spec.extra_packages || activeDefaults.extra_packages || existingHost?.extra_packages,
          force_install: spec.force_install !== undefined ? Boolean(spec.force_install) : (existingHost?.force_install ?? false),
          note: spec.note !== undefined ? spec.note : (existingHost?.note || activeDefaults.note),
          custom: { ...activeDefaults.custom, ...existingHost?.custom, ...spec.custom },
          status,
          installed_at: installedAt,
        };

        this.createHostInternal(hostToSave);
      }
    });

    runTransaction();

    return {
      success: true,
      added: addedCount,
      updated: updatedCount,
      total: validatedHosts.length,
      message: `Successfully imported ${validatedHosts.length} hosts (${addedCount} added, ${updatedCount} updated).`,
    };
  }

  // --- Backwards Compatibility Helpers ---

  public getNodeRecord(mac: string): (StateRecord & NodeRecord) | undefined {
    const host = this.getHost(mac);
    if (!host) return undefined;
    return {
      mac: host.mac,
      hostname: host.hostname,
      os: host.os,
      client_ip: host.network?.ip,
      ip: host.network?.ip,
      status: host.status || "PENDING",
      note: host.note,
      installed_at: host.installed_at,
      updated_at: host.updated_at || new Date().toISOString(),
    };
  }

  public getRecord(mac: string): (StateRecord & NodeRecord) | undefined {
    return this.getNodeRecord(mac);
  }

  public resetInstalled(mac: string): boolean {
    return this.resetHostStatus(mac);
  }

  public deleteNode(mac: string): boolean {
    return this.deleteHost(mac);
  }

  public getAllInstalled(): Record<string, StateRecord> {
    const installedHosts = this.getAllHosts().filter((h) => h.status === "INSTALLED");
    const result: Record<string, StateRecord> = {};
    for (const h of installedHosts) {
      result[h.mac] = {
        mac: h.mac,
        hostname: h.hostname,
        os: h.os,
        client_ip: h.network?.ip,
        note: h.note,
        status: h.status,
        installed_at: h.installed_at || h.updated_at || new Date().toISOString(),
      };
    }
    return result;
  }

  public getAllNodes(): NodeRecord[] {
    return this.getAllHosts().map((h) => ({
      mac: h.mac,
      hostname: h.hostname,
      ip: h.network?.ip,
      os: h.os,
      status: h.status || "PENDING",
      note: h.note,
      installed_at: h.installed_at,
      updated_at: h.updated_at || new Date().toISOString(),
    }));
  }

  public close(): void {
    try {
      this.db.close();
    } catch {}
  }
}
