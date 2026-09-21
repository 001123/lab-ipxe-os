import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { StateManager } from "../src/core/state.ts";
import { ConfigManager } from "../src/config.ts";
import { handleApiRoute, buildDashboardData } from "../src/routes/api.ts";
import { renderDashboardHtml } from "../src/ui/dashboard.ts";

describe("AG-Grid Community Dashboard Integration Tests", () => {
  let stateMgr: StateManager;
  let configMgr: ConfigManager;

  beforeEach(() => {
    stateMgr = new StateManager(":memory:");
    // Seed test hosts
    stateMgr.createHost({
      mac: "11:22:33:44:55:66",
      hostname: "ag-test-node-01",
      os: "ubuntu",
      version: "24.04",
      profile: "generic",
      network: { ip: "192.168.1.50", dhcp: false },
      note: "Integration test node",
    });
    stateMgr.createHost({
      mac: "aa:bb:cc:11:22:33",
      hostname: "k8s-worker-node",
      os: "suse-micro",
      version: "6.2",
      profile: "k3s-single-node",
      status: "INSTALLED",
      network: { ip: "192.168.1.60", dhcp: false },
    });
    configMgr = new ConfigManager(undefined, stateMgr);
  });

  afterEach(() => {
    stateMgr.close();
  });

  describe("HTML Template Rendering (renderDashboardHtml)", () => {
    it("should include AG Grid CDN scripts and Quartz styles in head", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain("https://cdn.jsdelivr.net/npm/ag-grid-community/styles/ag-grid.css");
      expect(html).toContain("https://cdn.jsdelivr.net/npm/ag-grid-community/styles/ag-theme-quartz.css");
      expect(html).toContain("https://cdn.jsdelivr.net/npm/ag-grid-community/dist/ag-grid-community.min.js");
    });

    it("should include #nodes-grid container with ag-theme-quartz class", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain('id="nodes-grid"');
      expect(html).toContain('class="ag-theme-quartz"');
    });

    it("should set dashboard container max-width to 1920px and render frosted navbar-card with polling stream", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain('class="container dashboard-container px-4 py-5"');
      expect(html).toContain('max-width: 1920px');
      expect(html).toContain('class="dashboard-body has-background-background"');
      expect(html).toContain('id="navbar-header"');
      expect(html).toContain('class="navbar-card level mb-3"');
      expect(html).toContain('id="navbar-polling-badge"');
      expect(html).toContain('class="navbar-laser-stream"');
    });

    it("should include Quick Search input on table toolbar", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain('id="grid-search-input"');
      expect(html).toContain('placeholder="Quick search nodes..."');
    });

    it("should embed initial hosts data JSON script tag for instant SSR", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain('id="initial-hosts-data"');
      expect(html).toContain('type="application/json"');
      expect(html).toContain("ag-test-node-01");
      expect(html).toContain("11:22:33:44:55:66");
      expect(html).toContain("k8s-worker-node");
    });

    it("should include reset confirmation in node row HTML", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain('hx-confirm="Bạn có chắc chắn muốn đặt lại trạng thái node [ag-test-node-01] về PENDING không?"');
    });

    it("should maintain hidden #nodes-table-body for backward compatibility", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);

      expect(html).toContain('id="nodes-table-body"');
      expect(html).toContain("ag-test-node-01");
    });
  });

  describe("Client Scripts & Styles Verification", () => {
    it("public/js/dashboard.js should contain AG Grid logic and CRUD helpers with confirm", () => {
      const jsPath = resolve(process.cwd(), "public", "js", "dashboard.js");
      const jsContent = readFileSync(jsPath, "utf-8");

      expect(jsContent).toContain("initAgGrid");
      expect(jsContent).toContain("refreshGridData");
      expect(jsContent).toContain("ag-theme-quartz-dark");
      expect(jsContent).toContain("grid-search-input");
      expect(jsContent).toContain("openEditModalByMac");
      expect(jsContent).toContain("openEditModalFromHostData");
      expect(jsContent).toContain("resetHost");
      expect(jsContent).toContain("deleteHost");
      expect(jsContent).toContain("confirm(`Bạn có chắc chắn muốn đặt lại trạng thái node [${hostname}] về PENDING không?`)");
      expect(jsContent).toContain("togglePollingFromNavbar");
      expect(jsContent).toContain("is-polling-active");
      expect(jsContent).toContain("navbar-polling-badge");
      expect(jsContent).toContain("filterGridByStatus");
      expect(jsContent).toContain("is-active-filter");
    });

    it("public/css/dashboard.css should contain AG Grid styling and Quartz theme overrides", () => {
      const cssPath = resolve(process.cwd(), "public", "css", "dashboard.css");
      const cssContent = readFileSync(cssPath, "utf-8");

      expect(cssContent).toContain(".dashboard-container");
      expect(cssContent).toContain("max-width: 1920px");
      expect(cssContent).toContain("#nodes-grid");
      expect(cssContent).toContain(".ag-theme-quartz");
      expect(cssContent).toContain(".ag-theme-quartz-dark");
      expect(cssContent).toContain("#grid-search-input");
      expect(cssContent).toContain(".navbar-card");
      expect(cssContent).toContain("body.dashboard-body");
      expect(cssContent).toContain("--ambient-glow-primary");
      expect(cssContent).toContain("--pattern-grid");
      expect(cssContent).toContain(".navbar-laser-stream");
      expect(cssContent).toContain(".is-polling-active");
      expect(cssContent).toContain(".navbar-polling-badge");
      expect(cssContent).toContain("@keyframes navbar-laser-sweep");
      expect(cssContent).toContain(".stat-indicator-dot");
      expect(cssContent).toContain(".is-active-filter");
    });
  });

  describe("API Integration for AG Grid (/api/hosts)", () => {
    it("GET /api/hosts should return JSON array with all host objects", async () => {
      const req = new Request("http://localhost:3000/api/hosts", { method: "GET" });
      const res = await handleApiRoute(req, "/api/hosts", configMgr, stateMgr);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const hosts = (await res.json()) as any[];
      expect(Array.isArray(hosts)).toBe(true);
      expect(hosts.length).toBeGreaterThanOrEqual(2);

      const macs = hosts.map((h) => h.mac);
      expect(macs).toContain("11:22:33:44:55:66");
      expect(macs).toContain("aa:bb:cc:11:22:33");
    });
  });
});
