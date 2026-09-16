import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { StateManager } from "../src/core/state.ts";
import { ConfigManager } from "../src/config.ts";
import {
  renderStatsGridPartial,
  renderDashboardHtml,
  type DashboardHostItem,
} from "../src/ui/dashboard.ts";
import { handleApiRoute } from "../src/routes/api.ts";

describe("Stats Grid & Auto-polling Synchronization Tests", () => {
  const dbPath = resolve(process.cwd(), "data", "test-stats.db");
  let stateMgr: StateManager;
  let configMgr: ConfigManager;

  beforeAll(() => {
    stateMgr = new StateManager(dbPath);
    configMgr = new ConfigManager(undefined, stateMgr);

    // Seed test hosts
    stateMgr.seedFromYaml();
  });

  afterAll(() => {
    try {
      const fs = require("node:fs");
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
      if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    } catch {}
  });

  describe("UI Rendering Functions", () => {
    it("renderStatsGridPartial should render 4 stat boxes with data-stat and data-val", () => {
      const stats = {
        total: 10,
        installed: 4,
        provisioning: 3,
        pending: 3,
      };

      const html = renderStatsGridPartial(stats);

      expect(html).toContain('data-stat="total" data-val="10"');
      expect(html).toContain('data-stat="installed" data-val="4"');
      expect(html).toContain('data-stat="provisioning" data-val="3"');
      expect(html).toContain('data-stat="pending" data-val="3"');
      expect(html).toContain('<span class="stat-badge-val font-mono">10</span>');
      expect(html).toContain('<span class="stat-badge-val font-mono has-text-success">4</span>');
      expect(html).toContain('<span class="stat-badge-val font-mono has-text-warning">3</span>');
      expect(html).toContain('<span class="stat-badge-val font-mono has-text-grey-light">3</span>');
      expect(html).toContain('All');
      expect(html).toContain('Installed');
      expect(html).toContain('Provisioning');
      expect(html).toContain('Pending');
    });

    it("renderDashboardHtml should include #stats-grid with HTMX attributes and refresh button", () => {
      const hosts: DashboardHostItem[] = [];
      const stats = { total: 0, installed: 0, provisioning: 0, pending: 0 };
      const html = renderDashboardHtml({
        hosts,
        baseUrl: "http://localhost:3000",
        appConfig: configMgr.appConfig,
        stats,
      });

      expect(html).toContain('id="stats-grid"');
      expect(html).toContain('hx-get="http://localhost:3000/ui/stats"');
      expect(html).toContain('hx-trigger="refreshStats from:body"');
      expect(html).toContain('hx-swap="innerHTML"');
      expect(html).toContain('id="refresh-table-btn"');
      expect(html).toContain("handleManualRefresh(this)");
      expect(html).toContain("handlePollingToggle(this)");
    });
  });

  describe("API Endpoints & HTMX Headers", () => {
    it("GET /ui/stats should return HTML stats grid partial with 200 OK", async () => {
      const req = new Request("http://localhost:3000/ui/stats", { method: "GET" });
      const res = await handleApiRoute(req, "/ui/stats", configMgr, stateMgr);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      expect(res?.headers.get("content-type")).toContain("text/html");

      const html = await res?.text();
      expect(html).toContain('data-stat="total"');
      expect(html).toContain('data-stat="installed"');
      expect(html).toContain('data-stat="provisioning"');
      expect(html).toContain('data-stat="pending"');
    });

    it("POST /api/hosts with HTMX should return HX-Trigger with refreshStats", async () => {
      const formData = new FormData();
      formData.set("mac", "44:55:66:77:88:99");
      formData.set("hostname", "test-sync-host");
      formData.set("os", "ubuntu");

      const req = new Request("http://localhost:3000/api/hosts", {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts", configMgr, stateMgr);
      expect(res?.status).toBe(200);
      expect(res?.headers.get("hx-trigger")).toContain("refreshStats");
      expect(res?.headers.get("hx-trigger")).toContain("hostCreated");
    });

    it("POST /api/hosts/:mac/edit with HTMX should return HX-Trigger with refreshStats", async () => {
      const formData = new FormData();
      formData.set("hostname", "test-sync-host-edited");
      formData.set("note", "Updated note for sync test");

      const req = new Request("http://localhost:3000/api/hosts/44:55:66:77:88:99/edit", {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts/44:55:66:77:88:99/edit", configMgr, stateMgr);
      expect(res?.status).toBe(200);
      expect(res?.headers.get("hx-trigger")).toContain("refreshStats");
      expect(res?.headers.get("hx-trigger")).toContain("hostUpdated");
    });

    it("POST /api/reset with HTMX should return HX-Trigger with refreshStats", async () => {
      const req = new Request("http://localhost:3000/api/reset?mac=44:55:66:77:88:99", {
        method: "POST",
        headers: { "HX-Request": "true" },
      });

      const res = await handleApiRoute(req, "/api/reset", configMgr, stateMgr);
      expect(res?.status).toBe(200);
      expect(res?.headers.get("hx-trigger")).toContain("refreshStats");
    });

    it("DELETE /api/hosts/:mac with HTMX should return HX-Trigger with refreshStats", async () => {
      const req = new Request("http://localhost:3000/api/hosts/44:55:66:77:88:99", {
        method: "DELETE",
        headers: { "HX-Request": "true" },
      });

      const res = await handleApiRoute(req, "/api/hosts/44:55:66:77:88:99", configMgr, stateMgr);
      expect(res?.status).toBe(200);
      expect(res?.headers.get("hx-trigger")).toContain("refreshStats");
    });
  });
});
