import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { ServerLogger } from "../src/core/logger.ts";
import { server } from "../src/index.ts";

describe("ServerLogger & Live Log Streaming Tests", () => {
  const testLogDir = resolve(process.cwd(), "logs-test");
  const testLogFile = resolve(testLogDir, "server.log");
  let testLogger: ServerLogger;

  beforeAll(() => {
    testLogger = new ServerLogger(testLogDir);
  });

  afterAll(() => {
    testLogger.unhookConsole();
    if (existsSync(testLogFile)) unlinkSync(testLogFile);
  });

  it("should record log with timestamps and strip ANSI in file", () => {
    testLogger.record("INFO", "Test message with \x1b[32mcolor\x1b[0m");

    expect(existsSync(testLogFile)).toBe(true);
    const fileContent = readFileSync(testLogFile, "utf-8");
    expect(fileContent).toContain("[INFO] Test message with color");
    expect(fileContent).not.toContain("\x1b[32m");
    // Should have timestamp formatted [YYYY-MM-DD HH:mm:ss.SSS]
    expect(fileContent).toMatch(/^\[\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3}\]/);
  });

  it("should detect HTTP and ERROR levels properly", () => {
    testLogger.record("INFO", "[HTTP] GET /boot.ipxe?mac=11:22:33:44:55:66");
    testLogger.record("ERROR", "Something went wrong in boot process");

    const recent = testLogger.getRecentLogs(10);
    const httpEntry = recent.find((e) => e.raw.includes("GET /boot.ipxe"));
    expect(httpEntry).toBeDefined();
    expect(httpEntry?.level).toBe("HTTP");
    expect(httpEntry?.ansi).toContain("\x1b[36m[HTTP]\x1b[0m");

    const errorEntry = recent.find((e) => e.raw.includes("Something went wrong"));
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.level).toBe("ERROR");
    expect(errorEntry?.ansi).toContain("\x1b[31m[ERROR]\x1b[0m");
  });

  it("should maintain ring buffer and get recent logs", () => {
    for (let i = 1; i <= 20; i++) {
      testLogger.record("INFO", `Bulk message #${i}`);
    }

    const last5 = testLogger.getRecentLogs(5);
    expect(last5.length).toBe(5);
    expect(last5[4].raw).toBe("Bulk message #20");
  });

  it("should purge logs on demand", () => {
    testLogger.record("WARN", "Warning before purge");
    expect(readFileSync(testLogFile, "utf-8").length).toBeGreaterThan(0);

    const result = testLogger.purgeLogs();
    expect(result.success).toBe(true);

    const fileContent = readFileSync(testLogFile, "utf-8");
    expect(fileContent).toBe("");
    expect(testLogger.getRecentLogs(10).length).toBe(0);
  });

  it("should support subscribing and receiving history via mock WebSocket", () => {
    testLogger.record("INFO", "History message");
    const sentMessages: string[] = [];

    const mockWs = {
      send(data: string) {
        sentMessages.push(data);
      },
      getBufferedAmount() {
        return 0;
      },
    };

    testLogger.subscribe(mockWs);
    expect(sentMessages.length).toBe(1);
    const historyPayload = JSON.parse(sentMessages[0]);
    expect(historyPayload.type).toBe("history");
    expect(historyPayload.entries.length).toBeGreaterThan(0);

    // Broadcast new message
    testLogger.record("INFO", "Live streamed message");
    expect(sentMessages.length).toBe(2);
    const livePayload = JSON.parse(sentMessages[1]);
    expect(livePayload.type).toBe("log");
    expect(livePayload.entry.raw).toBe("Live streamed message");

    testLogger.unsubscribe(mockWs);
  });

  describe("HTTP & API Endpoints for Logs", () => {
    it("should allow downloading server.log via GET /api/logs/download", async () => {
      const res = await server.fetch(new Request("http://localhost/api/logs/download"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      expect(res.headers.get("Content-Disposition")).toContain('attachment; filename="server.log"');
    });

    it("should purge server logs via DELETE /api/logs", async () => {
      const res = await server.fetch(
        new Request("http://localhost/api/logs", { method: "DELETE" })
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it("should render terminal component in dashboard HTML", async () => {
      const res = await server.fetch(new Request("http://localhost/dashboard"));
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain("xterm.js");
      expect(html).toContain("id=\"terminal-panel\"");
      expect(html).toContain("id=\"terminal-container\"");
      expect(html).toContain("id=\"terminal-filter-level\"");
      expect(html).toContain("id=\"terminal-filter-search\"");
      expect(html).toContain("id=\"terminal-btn-purge\"");
      expect(html).toContain("id=\"terminal-btn-clear\"");
      expect(html).toContain("id=\"terminal-btn-pause\"");
      expect(html).toContain("id=\"terminal-auto-scroll\"");
    });
  });
});
