import { Database } from "bun:sqlite";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppState, StateRecord, NodeRecord, NodeStatus } from "../types.ts";

export class StateManager {
  private dbPath: string;
  private legacyJsonPath: string;
  private db: Database;

  constructor(filePath: string = join(process.cwd(), "data", "state.db")) {
    if (filePath.endsWith(".json")) {
      this.dbPath = filePath.replace(/\.json$/, ".db");
      this.legacyJsonPath = filePath;
    } else {
      this.dbPath = filePath;
      this.legacyJsonPath = join(dirname(filePath), "state.json");
    }

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initDb();
  }

  public normalizeMac(mac: string): string {
    return mac
      .trim()
      .toLowerCase()
      .replace(/[-]/g, ":")
      .replace(/^0x/, "");
  }

  private initDb(): void {
    try {
      this.db.run("PRAGMA journal_mode = WAL;");
      this.db.run(`
        CREATE TABLE IF NOT EXISTS nodes (
          mac TEXT PRIMARY KEY,
          hostname TEXT,
          ip TEXT,
          os TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          note TEXT,
          installed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      this.db.run("CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);");

      // Auto-migrate from state.json if nodes table is empty and legacy json exists
      const countRow = this.db.prepare("SELECT count(*) as count FROM nodes").get() as { count: number };
      if (countRow.count === 0 && existsSync(this.legacyJsonPath)) {
        this.migrateFromJson();
      }
    } catch (err) {
      console.error(`[State] Error initializing database at ${this.dbPath}:`, err);
    }
  }

  private migrateFromJson(): void {
    try {
      const content = readFileSync(this.legacyJsonPath, "utf-8");
      const json = JSON.parse(content);
      if (json.installed && typeof json.installed === "object") {
        const records = Object.entries<any>(json.installed);
        if (records.length > 0) {
          const insert = this.db.prepare(`
            INSERT OR REPLACE INTO nodes (mac, hostname, ip, os, status, note, installed_at, updated_at)
            VALUES ($mac, $hostname, $ip, $os, 'INSTALLED', $note, $installed_at, datetime('now'))
          `);
          this.db.transaction(() => {
            for (const [mac, rec] of records) {
              const cleanMac = this.normalizeMac(mac);
              insert.run({
                $mac: cleanMac,
                $hostname: rec.hostname ?? null,
                $ip: rec.client_ip ?? null,
                $os: rec.os ?? null,
                $note: rec.note ?? null,
                $installed_at: rec.installed_at ?? new Date().toISOString(),
              });
            }
          })();
          console.log(`[State] Successfully migrated ${records.length} records from ${this.legacyJsonPath} to SQLite.`);
        }
      }
    } catch (err) {
      console.error(`[State] Error migrating legacy JSON state:`, err);
    }
  }

  public isInstalled(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    const row = this.db.prepare("SELECT status FROM nodes WHERE mac = ?").get(cleanMac) as { status: string } | undefined;
    return row?.status === "INSTALLED";
  }

  public getStatus(mac: string): NodeStatus {
    const cleanMac = this.normalizeMac(mac);
    const row = this.db.prepare("SELECT status FROM nodes WHERE mac = ?").get(cleanMac) as { status: string } | undefined;
    return (row?.status as NodeStatus) ?? "PENDING";
  }

  public markProvisioning(
    mac: string,
    info: { hostname?: string; os?: string; clientIp?: string; note?: string } = {}
  ): NodeRecord {
    const cleanMac = this.normalizeMac(mac);
    const now = new Date().toISOString();
    const existing = this.getNodeRecord(cleanMac);

    const hostname = info.hostname ?? existing?.hostname ?? null;
    const ip = info.clientIp ?? existing?.ip ?? null;
    const os = info.os ?? existing?.os ?? null;
    const note = info.note ?? existing?.note ?? null;

    // Only transition to PROVISIONING if not already INSTALLED
    const status: NodeStatus = existing?.status === "INSTALLED" ? "INSTALLED" : "PROVISIONING";

    this.db.prepare(`
      INSERT INTO nodes (mac, hostname, ip, os, status, note, installed_at, updated_at)
      VALUES ($mac, $hostname, $ip, $os, $status, $note, $installed_at, $updated_at)
      ON CONFLICT(mac) DO UPDATE SET
        hostname = coalesce(excluded.hostname, nodes.hostname),
        ip = coalesce(excluded.ip, nodes.ip),
        os = coalesce(excluded.os, nodes.os),
        status = excluded.status,
        note = coalesce(excluded.note, nodes.note),
        updated_at = excluded.updated_at
    `).run({
      $mac: cleanMac,
      $hostname: hostname,
      $ip: ip,
      $os: os,
      $status: status,
      $note: note,
      $installed_at: existing?.installed_at ?? null,
      $updated_at: now,
    });

    console.log(`[State] Marked MAC ${cleanMac} (${hostname || "unknown"}) as ${status}.`);
    return this.getNodeRecord(cleanMac)!;
  }

  public markInstalled(
    mac: string,
    info: { hostname?: string; os?: string; clientIp?: string; note?: string } = {}
  ): StateRecord {
    const cleanMac = this.normalizeMac(mac);
    const now = new Date().toISOString();
    const existing = this.getNodeRecord(cleanMac);

    const hostname = info.hostname ?? existing?.hostname ?? undefined;
    const ip = info.clientIp ?? existing?.ip ?? undefined;
    const os = info.os ?? existing?.os ?? undefined;
    const note = info.note ?? existing?.note ?? undefined;

    this.db.prepare(`
      INSERT INTO nodes (mac, hostname, ip, os, status, note, installed_at, updated_at)
      VALUES ($mac, $hostname, $ip, $os, 'INSTALLED', $note, $installed_at, $updated_at)
      ON CONFLICT(mac) DO UPDATE SET
        hostname = coalesce(excluded.hostname, nodes.hostname),
        ip = coalesce(excluded.ip, nodes.ip),
        os = coalesce(excluded.os, nodes.os),
        status = 'INSTALLED',
        note = coalesce(excluded.note, nodes.note),
        installed_at = coalesce(nodes.installed_at, excluded.installed_at),
        updated_at = excluded.updated_at
    `).run({
      $mac: cleanMac,
      $hostname: hostname ?? null,
      $ip: ip ?? null,
      $os: os ?? null,
      $note: note ?? null,
      $installed_at: now,
      $updated_at: now,
    });

    console.log(`[State] Marked MAC ${cleanMac} (${hostname || "unknown"}) as INSTALLED.`);
    return {
      mac: cleanMac,
      hostname,
      os,
      client_ip: ip,
      note,
      status: "INSTALLED",
      installed_at: now,
    };
  }

  public updateNote(mac: string, note: string): StateRecord | null {
    const cleanMac = this.normalizeMac(mac);
    const now = new Date().toISOString();
    const existing = this.getNodeRecord(cleanMac);

    if (existing) {
      this.db.prepare(`
        UPDATE nodes SET note = $note, updated_at = $updated_at WHERE mac = $mac
      `).run({ $mac: cleanMac, $note: note, $updated_at: now });

      console.log(`[State] Updated note for MAC ${cleanMac}.`);
      return {
        mac: cleanMac,
        hostname: existing.hostname,
        os: existing.os,
        client_ip: existing.ip,
        note,
        status: existing.status,
        installed_at: existing.installed_at || now,
      };
    }
    return null;
  }

  public getRecord(mac: string): (StateRecord & NodeRecord) | undefined {
    return this.getNodeRecord(mac);
  }

  public getNodeRecord(mac: string): (StateRecord & NodeRecord) | undefined {
    const cleanMac = this.normalizeMac(mac);
    const row = this.db.prepare("SELECT * FROM nodes WHERE mac = ?").get(cleanMac) as any;
    if (!row) return undefined;
    return {
      mac: row.mac,
      hostname: row.hostname ?? undefined,
      os: row.os ?? undefined,
      client_ip: row.ip ?? undefined,
      ip: row.ip ?? undefined,
      status: row.status as NodeStatus,
      note: row.note ?? undefined,
      installed_at: row.installed_at ?? row.updated_at,
      updated_at: row.updated_at,
    };
  }

  public resetInstalled(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    const existing = this.getNodeRecord(cleanMac);
    if (existing && existing.status !== "PENDING") {
      this.db.prepare(`
        UPDATE nodes SET status = 'PENDING', updated_at = datetime('now') WHERE mac = ?
      `).run(cleanMac);
      console.log(`[State] Reset install state for MAC ${cleanMac}. Status changed to PENDING.`);
      return true;
    }
    return false;
  }

  public deleteNode(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    const res = this.db.prepare("DELETE FROM nodes WHERE mac = ?").run(cleanMac);
    return res.changes > 0;
  }

  public getAllInstalled(): Record<string, StateRecord> {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE status = 'INSTALLED'").all() as any[];
    const result: Record<string, StateRecord> = {};
    for (const row of rows) {
      result[row.mac] = {
        mac: row.mac,
        hostname: row.hostname ?? undefined,
        os: row.os ?? undefined,
        client_ip: row.ip ?? undefined,
        note: row.note ?? undefined,
        status: row.status as NodeStatus,
        installed_at: row.installed_at ?? row.updated_at,
      };
    }
    return result;
  }

  public getAllNodes(): NodeRecord[] {
    const rows = this.db.prepare("SELECT * FROM nodes ORDER BY updated_at DESC").all() as any[];
    return rows.map((row) => ({
      mac: row.mac,
      hostname: row.hostname ?? undefined,
      ip: row.ip ?? undefined,
      os: row.os ?? undefined,
      status: row.status as NodeStatus,
      note: row.note ?? undefined,
      installed_at: row.installed_at ?? undefined,
      updated_at: row.updated_at,
    }));
  }

  public close(): void {
    try {
      this.db.close();
    } catch {}
  }
}
