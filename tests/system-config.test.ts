import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { unlinkSync, existsSync, readFileSync } from "node:fs";
import { StateManager } from "../src/core/state.ts";
import { ConfigManager } from "../src/config.ts";
import { handleApiRoute, buildDashboardData } from "../src/routes/api.ts";
import { renderDashboardHtml } from "../src/ui/dashboard.ts";

describe("System Configuration & SQLite Persistence Tests", () => {
  const testDbPath = resolve(process.cwd(), "data", "test-system-config.db");
  let stateMgr: StateManager;
  let configMgr: ConfigManager;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    stateMgr = new StateManager(testDbPath);
    configMgr = new ConfigManager(undefined, stateMgr);
  });

  afterEach(() => {
    stateMgr.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(`${testDbPath}-wal`)) unlinkSync(`${testDbPath}-wal`);
    if (existsSync(`${testDbPath}-shm`)) unlinkSync(`${testDbPath}-shm`);
  });

  describe("StateManager SQLite System Config", () => {
    it("should initialize system_config in SQLite during initDb", () => {
      const config = stateMgr.getSystemConfig();
      expect(config).not.toBeNull();
      expect(config?.baseUrl).toBeDefined();
      expect(typeof config?.ipxeMenuTimeout).toBe("number");
    });

    it("should save and retrieve updated system config", () => {
      stateMgr.saveSystemConfig({
        baseUrl: "http://192.168.1.150:3000/",
        ipxeMenuTimeout: 15,
      });

      const retrieved = stateMgr.getSystemConfig();
      expect(retrieved).not.toBeNull();
      // Should strip trailing slash
      expect(retrieved?.baseUrl).toBe("http://192.168.1.150:3000");
      expect(retrieved?.ipxeMenuTimeout).toBe(15);
    });
  });

  describe("ConfigManager Independence from .env", () => {
    it("should prioritize SQLite system config over process.env values", () => {
      // Save specific config into SQLite
      stateMgr.saveSystemConfig({
        baseUrl: "http://10.0.0.99:8080",
        ipxeMenuTimeout: 20,
      });

      // Create a fresh ConfigManager without env parameters
      const freshMgr = new ConfigManager(undefined, stateMgr);
      expect(freshMgr.appConfig.baseUrl).toBe("http://10.0.0.99:8080");
      expect(freshMgr.appConfig.ipxeMenuTimeout).toBe(20);
    });

    it("should update config in-memory and write directly to SQLite", () => {
      const updated = configMgr.updateSystemConfig({
        baseUrl: "https://ipxe.homelab.local:8443",
        ipxeMenuTimeout: 7,
      });

      expect(updated.baseUrl).toBe("https://ipxe.homelab.local:8443");
      expect(updated.ipxeMenuTimeout).toBe(7);
      expect(configMgr.appConfig.baseUrl).toBe("https://ipxe.homelab.local:8443");
      expect(configMgr.appConfig.ipxeMenuTimeout).toBe(7);

      // Verify persisted directly in SQLite database
      const dbConfig = stateMgr.getSystemConfig();
      expect(dbConfig?.baseUrl).toBe("https://ipxe.homelab.local:8443");
      expect(dbConfig?.ipxeMenuTimeout).toBe(7);
    });
  });

  describe("API Endpoints (/api/config)", () => {
    it("GET /api/config should return current baseUrl and ipxeMenuTimeout", async () => {
      configMgr.updateSystemConfig({
        baseUrl: "http://192.168.1.55:3000",
        ipxeMenuTimeout: 8,
      });

      const req = new Request("http://localhost/api/config", { method: "GET" });
      const res = await handleApiRoute(req, "/api/config", configMgr, stateMgr);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.baseUrl).toBe("http://192.168.1.55:3000");
      expect(json.ipxeMenuTimeout).toBe(8);
    });

    it("POST /api/config should update system config via JSON payload", async () => {
      const req = new Request("http://localhost/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://192.168.250.250:3000",
          ipxeMenuTimeout: 12,
        }),
      });

      const res = await handleApiRoute(req, "/api/config", configMgr, stateMgr);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.config.baseUrl).toBe("http://192.168.250.250:3000");
      expect(json.config.ipxeMenuTimeout).toBe(12);

      // Verify in SQLite
      const inDb = stateMgr.getSystemConfig();
      expect(inDb?.baseUrl).toBe("http://192.168.250.250:3000");
      expect(inDb?.ipxeMenuTimeout).toBe(12);
    });

    it("POST /api/config should update system config via Form Data", async () => {
      const formData = new FormData();
      formData.append("baseUrl", "http://172.16.0.10:3000");
      formData.append("ipxeMenuTimeout", "10");

      const req = new Request("http://localhost/api/config", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/config", configMgr, stateMgr);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(configMgr.appConfig.baseUrl).toBe("http://172.16.0.10:3000");
      expect(configMgr.appConfig.ipxeMenuTimeout).toBe(10);
    });

    it("POST /api/config should reject invalid baseUrl protocol", async () => {
      const req = new Request("http://localhost/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: "ftp://192.168.1.1:3000",
        }),
      });

      const res = await handleApiRoute(req, "/api/config", configMgr, stateMgr);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("http:// or https://");
    });

    it("POST /api/config should reject negative timeout values", async () => {
      const req = new Request("http://localhost/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipxeMenuTimeout: -5,
        }),
      });

      const res = await handleApiRoute(req, "/api/config", configMgr, stateMgr);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("between 0 and 3600");
    });

    it("POST /api/config should set HX-Trigger header when called from HTMX", async () => {
      const req = new Request("http://localhost/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "HX-Request": "true",
        },
        body: JSON.stringify({
          baseUrl: "http://192.168.1.2:3000",
        }),
      });

      const res = await handleApiRoute(req, "/api/config", configMgr, stateMgr);
      expect(res.status).toBe(200);
      expect(res.headers.get("HX-Trigger")).toBe("refreshConfig");
    });
  });

  describe("UI Dashboard Template & Elements", () => {
    it("should render #navbar-config-btn on the navbar", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData);

      expect(html).toContain('id="navbar-config-btn"');
      expect(html).toContain('onclick="openConfigModal()"');
      expect(html).toContain("Config");
    });

    it("should render #system-config-modal with inputs and prefilled values", () => {
      configMgr.updateSystemConfig({
        baseUrl: "http://192.168.100.200:3000",
        ipxeMenuTimeout: 9,
      });

      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData);

      expect(html).toContain('id="system-config-modal"');
      expect(html).toContain('id="system-config-form"');
      expect(html).toContain('id="cfg-base-url"');
      expect(html).toContain('value="http://192.168.100.200:3000"');
      expect(html).toContain('id="cfg-menu-timeout"');
      expect(html).toContain('value="9"');
      expect(html).toContain('id="system-config-submit-btn"');
    });
  });

  describe("Client Scripts & Styles Verification", () => {
    it("dashboard.js should contain openConfigModal and submitSystemConfigForm", () => {
      const jsContent = readFileSync(resolve(process.cwd(), "public", "js", "dashboard.js"), "utf-8");
      expect(jsContent).toContain("window.openConfigModal");
      expect(jsContent).toContain("window.submitSystemConfigForm");
      expect(jsContent).toContain("/api/config");
    });

    it("dashboard.css should contain styling for #navbar-config-btn", () => {
      const cssContent = readFileSync(resolve(process.cwd(), "public", "css", "dashboard.css"), "utf-8");
      expect(cssContent).toContain("#navbar-config-btn");
    });

    it("dashboard.css should contain gap spacing for .modal-card-foot buttons", () => {
      const cssContent = readFileSync(resolve(process.cwd(), "public", "css", "dashboard.css"), "utf-8");
      expect(cssContent).toContain(".modal-card-foot");
      expect(cssContent).toContain("gap: 0.75rem;");
    });
  });
});
