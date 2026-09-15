import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppState, StateRecord } from "../types.ts";

export class StateManager {
  private filePath: string;
  private state: AppState = { installed: {} };

  constructor(filePath: string = join(process.cwd(), "data", "state.json")) {
    this.filePath = filePath;
    this.load();
  }

  public normalizeMac(mac: string): string {
    return mac
      .trim()
      .toLowerCase()
      .replace(/[-]/g, ":")
      .replace(/^0x/, "");
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const content = readFileSync(this.filePath, "utf-8");
        this.state = JSON.parse(content);
        if (!this.state.installed) {
          this.state.installed = {};
        }
      } else {
        this.save();
      }
    } catch (err) {
      console.error(`[State] Error loading state from ${this.filePath}:`, err);
      this.state = { installed: {} };
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      console.error(`[State] Error saving state to ${this.filePath}:`, err);
    }
  }

  public isInstalled(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    return Boolean(this.state.installed[cleanMac]);
  }

  public markInstalled(
    mac: string,
    info: { hostname?: string; os?: string; clientIp?: string; note?: string } = {}
  ): StateRecord {
    const cleanMac = this.normalizeMac(mac);
    const record: StateRecord = {
      mac: cleanMac,
      hostname: info.hostname,
      os: info.os,
      client_ip: info.clientIp,
      note: info.note,
      installed_at: new Date().toISOString(),
    };
    this.state.installed[cleanMac] = record;
    this.save();
    console.log(`[State] Marked MAC ${cleanMac} (${info.hostname || "unknown"}) as INSTALLED.`);
    return record;
  }

  public updateNote(mac: string, note: string): StateRecord | null {
    const cleanMac = this.normalizeMac(mac);
    const existing = this.state.installed[cleanMac];
    if (existing) {
      existing.note = note;
      this.save();
      console.log(`[State] Updated note for MAC ${cleanMac}.`);
      return existing;
    }
    return null;
  }

  public getRecord(mac: string): StateRecord | undefined {
    const cleanMac = this.normalizeMac(mac);
    return this.state.installed[cleanMac];
  }

  public resetInstalled(mac: string): boolean {
    const cleanMac = this.normalizeMac(mac);
    if (this.state.installed[cleanMac]) {
      delete this.state.installed[cleanMac];
      this.save();
      console.log(`[State] Reset install state for MAC ${cleanMac}. Ready for re-install.`);
      return true;
    }
    return false;
  }

  public getAllInstalled(): Record<string, StateRecord> {
    return { ...this.state.installed };
  }
}
