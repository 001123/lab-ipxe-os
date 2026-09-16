import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

export interface LogEntry {
  id: number;
  timestamp: string;
  timeShort: string;
  level: "INFO" | "WARN" | "ERROR" | "HTTP";
  raw: string;
  ansi: string;
}

export class ServerLogger {
  private logDir: string;
  private logFilePath: string;
  private maxRingBufferSize = 1000;
  private ringBuffer: LogEntry[] = [];
  private nextId = 1;
  private subscribers = new Set<any>();
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
  };
  private isHooked = false;

  constructor(customLogDir?: string) {
    this.logDir = customLogDir || process.env.LOG_DIR || join(process.cwd(), "logs");
    this.logFilePath = join(this.logDir, "server.log");
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }

  public stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  }

  public formatTimestamp(d = new Date()): { full: string; short: string } {
    const pad = (n: number, s = 2) => String(n).padStart(s, "0");
    const Y = d.getFullYear();
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    const ms = pad(d.getMilliseconds(), 3);
    return {
      full: `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`,
      short: `${h}:${m}:${s}`,
    };
  }

  private detectLevel(rawText: string, defaultLevel: LogEntry["level"]): LogEntry["level"] {
    const textUpper = rawText.toUpperCase();
    if (textUpper.includes("[HTTP]")) return "HTTP";
    if (textUpper.includes("ERROR") || textUpper.includes("[ERR]")) return "ERROR";
    if (textUpper.includes("WARN")) return "WARN";
    return defaultLevel;
  }

  private colorizeLevel(level: LogEntry["level"]): string {
    switch (level) {
      case "HTTP":
        return "\x1b[36m[HTTP]\x1b[0m"; // Cyan
      case "ERROR":
        return "\x1b[31m[ERROR]\x1b[0m"; // Red
      case "WARN":
        return "\x1b[33m[WARN]\x1b[0m"; // Yellow
      case "INFO":
      default:
        return "\x1b[32m[INFO]\x1b[0m"; // Green
    }
  }

  public record(level: LogEntry["level"], ...args: any[]): void {
    const message = format(...args);
    const { full, short } = this.formatTimestamp();
    const detectedLevel = this.detectLevel(message, level);

    // Clean text without existing level tag if duplicated
    let cleanMessage = this.stripAnsi(message);
    if (cleanMessage.startsWith(`[${detectedLevel}]`)) {
      cleanMessage = cleanMessage.replace(`[${detectedLevel}]`, "").trimStart();
    }

    const fileLine = `[${full}] [${detectedLevel}] ${cleanMessage}\n`;
    try {
      this.ensureLogDir();
      appendFileSync(this.logFilePath, fileLine, "utf-8");
    } catch (err) {
      this.originalConsole.error("Failed to write to log file:", err);
    }

    // ANSI-colored line for xterm.js
    const ansiTimestamp = `\x1b[90m[${short}]\x1b[0m`;
    const ansiLevelTag = this.colorizeLevel(detectedLevel);
    const ansiLine = `${ansiTimestamp} ${ansiLevelTag} ${cleanMessage}`;

    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: full,
      timeShort: short,
      level: detectedLevel,
      raw: cleanMessage,
      ansi: ansiLine,
    };

    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxRingBufferSize) {
      this.ringBuffer.shift();
    }

    this.broadcast({
      type: "log",
      entry,
    });
  }

  public hookConsole(): void {
    if (this.isHooked) return;
    this.isHooked = true;

    console.log = (...args: any[]) => {
      this.originalConsole.log(...args);
      this.record("INFO", ...args);
    };

    console.info = (...args: any[]) => {
      this.originalConsole.info(...args);
      this.record("INFO", ...args);
    };

    console.warn = (...args: any[]) => {
      this.originalConsole.warn(...args);
      this.record("WARN", ...args);
    };

    console.error = (...args: any[]) => {
      this.originalConsole.error(...args);
      this.record("ERROR", ...args);
    };
  }

  public unhookConsole(): void {
    if (!this.isHooked) return;
    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    this.isHooked = false;
  }

  public getRecentLogs(limit = 500): LogEntry[] {
    if (this.ringBuffer.length > 0) {
      return this.ringBuffer.slice(-limit);
    }

    // If ringBuffer is empty (e.g. server just restarted), read from file
    try {
      if (existsSync(this.logFilePath)) {
        const content = readFileSync(this.logFilePath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        const recentLines = lines.slice(-limit);

        return recentLines.map((line, idx) => {
          const match = line.match(/^\[([\d-]+\s[\d:.]+)\]\s+\[([A-Z]+)\]\s*(.*)$/);
          if (match) {
            const [, fullTs, lvl, msg] = match;
            const timePart = fullTs.split(" ")[1]?.split(".")[0] || fullTs;
            const level = (["INFO", "WARN", "ERROR", "HTTP"].includes(lvl) ? lvl : "INFO") as LogEntry["level"];
            return {
              id: idx + 1,
              timestamp: fullTs,
              timeShort: timePart,
              level,
              raw: msg,
              ansi: `\x1b[90m[${timePart}]\x1b[0m ${this.colorizeLevel(level)} ${msg}`,
            };
          }
          return {
            id: idx + 1,
            timestamp: new Date().toISOString(),
            timeShort: "00:00:00",
            level: "INFO",
            raw: line,
            ansi: line,
          };
        });
      }
    } catch (err) {
      this.originalConsole.error("Failed to read historical log file:", err);
    }

    return [];
  }

  public purgeLogs(): { success: boolean; message: string } {
    try {
      this.ringBuffer = [];
      this.ensureLogDir();
      writeFileSync(this.logFilePath, "", "utf-8");
      this.broadcast({ type: "clear" });
      return { success: true, message: "Logs purged successfully" };
    } catch (err: any) {
      return { success: false, message: err.message || "Failed to purge logs" };
    }
  }

  public subscribe(ws: any): void {
    this.subscribers.add(ws);
    // Send recent history upon connection
    const history = this.getRecentLogs(500);
    try {
      ws.send(JSON.stringify({ type: "history", entries: history }));
    } catch (e) {
      this.subscribers.delete(ws);
    }
  }

  public unsubscribe(ws: any): void {
    this.subscribers.delete(ws);
  }

  public broadcast(payload: any): void {
    if (this.subscribers.size === 0) return;
    const dataStr = JSON.stringify(payload);

    for (const ws of this.subscribers) {
      try {
        // Backpressure check: if client buffer > 1MB, drop or skip to avoid server memory leak
        if (typeof ws.getBufferedAmount === "function" && ws.getBufferedAmount() > 1024 * 1024) {
          continue;
        }
        ws.send(dataStr);
      } catch (err) {
        this.subscribers.delete(ws);
      }
    }
  }

  public getSubscriberCount(): number {
    return this.subscribers.size;
  }
}

export const logger = new ServerLogger();
