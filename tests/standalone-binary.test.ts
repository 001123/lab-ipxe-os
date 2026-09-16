import { describe, it, expect } from "bun:test";
import { getEmbeddedAsset } from "../src/ui/embedded-assets.ts";
import { StaticAssetServer } from "../src/core/static-server.ts";
import { parseCli } from "../src/cli.ts";
import { runSyncAssets, getMissingAssetsCount, getAssetsStatusSummary } from "../src/scripts/sync-assets.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Standalone Binary & Embedded Assets Tests", () => {
  it("getEmbeddedAsset should return embedded CSS and JS", () => {
    const css = getEmbeddedAsset("css/dashboard.css");
    expect(css).not.toBeNull();
    expect(css?.contentType).toBe("text/css; charset=utf-8");
    expect(css?.content.length).toBeGreaterThan(1000);
    expect(css?.content).toContain("dashboard");

    const js = getEmbeddedAsset("js/dashboard.js");
    expect(js).not.toBeNull();
    expect(js?.contentType).toBe("text/javascript; charset=utf-8");
    expect(js?.content.length).toBeGreaterThan(1000);
    expect(js?.content).toContain("agGrid");
  });

  it("StaticAssetServer should fallback to embedded assets when file is not on disk", async () => {
    // Point StaticAssetServer to a non-existent / empty directory
    const emptyTempDir = mkdtempSync(join(tmpdir(), "ipxe-test-empty-"));
    try {
      const server = new StaticAssetServer(emptyTempDir, "public");

      // Request embedded CSS
      const reqCss = new Request("http://localhost:3000/public/css/dashboard.css");
      const resCss = await server.serve(reqCss, "/public/css/dashboard.css");
      expect(resCss.status).toBe(200);
      expect(resCss.headers.get("content-type")).toBe("text/css; charset=utf-8");
      const cssText = await resCss.text();
      expect(cssText.length).toBeGreaterThan(1000);

      // Request embedded JS
      const reqJs = new Request("http://localhost:3000/public/js/dashboard.js");
      const resJs = await server.serve(reqJs, "/public/js/dashboard.js");
      expect(resJs.status).toBe(200);
      expect(resJs.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      const jsText = await resJs.text();
      expect(jsText.length).toBeGreaterThan(1000);

      // Request non-existent asset that is not embedded
      const req404 = new Request("http://localhost:3000/public/random-nonexistent.png");
      const res404 = await server.serve(req404, "/public/random-nonexistent.png");
      expect(res404.status).toBe(404);
    } finally {
      rmSync(emptyTempDir, { recursive: true, force: true });
    }
  });

  it("parseCli should parse CLI flags and override defaults", () => {
    const config = parseCli([
      "--port", "8080",
      "--host", "127.0.0.1",
      "--base-url", "http://pxe.lab.local:8080",
      "--data-dir", "/tmp/custom-data",
      "--assets-dir", "/tmp/custom-assets",
      "--log-dir", "/tmp/custom-logs",
      "--config", "/tmp/custom-hosts.yaml",
      "--ipxe-timeout", "10",
    ]);

    expect(config.action).toBe("server");
    expect(config.port).toBe(8080);
    expect(config.host).toBe("127.0.0.1");
    expect(config.baseUrl).toBe("http://pxe.lab.local:8080");
    expect(config.dataDir).toContain("custom-data");
    expect(config.dbPath).toContain("custom-data");
    expect(config.assetsDir).toContain("custom-assets");
    expect(config.logDir).toContain("custom-logs");
    expect(config.configPath).toContain("custom-hosts.yaml");
    expect(config.ipxeMenuTimeout).toBe(10);
    expect(config.autoSync).toBe(true);
  });

  it("parseCli should handle --no-sync and --no-download flags", () => {
    const noSyncConfig = parseCli(["--no-sync"]);
    expect(noSyncConfig.autoSync).toBe(false);

    const noDownloadConfig = parseCli(["--no-download"]);
    expect(noDownloadConfig.autoSync).toBe(false);
  });

  it("getMissingAssetsCount should accurately detect missing files", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "ipxe-assets-empty-"));
    try {
      const res = getMissingAssetsCount(emptyDir);
      expect(res.missing).toBeGreaterThan(0);
      expect(res.total).toBeGreaterThan(0);
      expect(res.missingFiles.length).toBe(res.missing);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("parseCli should recognize sync-assets subcommand", () => {
    const config = parseCli(["sync-assets", "ubuntu", "--download"]);
    expect(config.action).toBe("sync-assets");
    expect(config.syncAssetsArgs).toEqual(["ubuntu", "--download"]);
  });

  it("parseCli should recognize help and version flags", () => {
    const helpConfig = parseCli(["--help"]);
    expect(helpConfig.action).toBe("help");

    const versionConfig = parseCli(["--version"]);
    expect(versionConfig.action).toBe("version");
  });

  it("parseCli should parse --sync-os flag", () => {
    const config = parseCli(["--sync-os", "ubuntu,talos"]);
    expect(config.syncOs).toBe("ubuntu,talos");
  });

  it("getAssetsStatusSummary should return status per OS", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "ipxe-assets-summary-"));
    try {
      const summary = getAssetsStatusSummary(emptyDir);
      expect(summary.ubuntu).toBeDefined();
      expect(summary.ubuntu.os).toBe("ubuntu");
      expect(summary.ubuntu.version).toBe("24.04");
      expect(summary.ubuntu.ready).toBe(false);
      expect(summary.ubuntu.missingCount).toBeGreaterThan(0);

      expect(summary.talos).toBeDefined();
      expect(summary.talos.os).toBe("talos");
      expect(summary.talos.ready).toBe(false);

      expect(summary["suse-micro"]).toBeDefined();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("API /api/assets endpoints should handle status and sync requests", async () => {
    const { handleApiRoute } = await import("../src/routes/api.ts");
    const { ConfigManager } = await import("../src/config.ts");
    const { StateManager } = await import("../src/core/state.ts");

    const tempDir = mkdtempSync(join(tmpdir(), "ipxe-api-assets-"));
    try {
      const stateMgr = new StateManager(join(tempDir, "test.db"));
      const configMgr = new ConfigManager({ assetsDir: tempDir }, stateMgr);

      // GET /api/assets/status
      const reqStatus = new Request("http://localhost:3000/api/assets/status", { method: "GET" });
      const resStatus = await handleApiRoute(reqStatus, "/api/assets/status", configMgr, stateMgr);
      expect(resStatus.status).toBe(200);
      const jsonStatus = await resStatus.json();
      expect(jsonStatus.ubuntu).toBeDefined();
      expect(jsonStatus.talos).toBeDefined();

      // POST /api/assets/sync?os=talos
      const reqSync = new Request("http://localhost:3000/api/assets/sync?os=talos", { method: "POST" });
      const resSync = await handleApiRoute(reqSync, "/api/assets/sync", configMgr, stateMgr);
      expect(resSync.status).toBe(202);
      const jsonSync = await resSync.json();
      expect(jsonSync.success).toBe(true);
      expect(jsonSync.os).toBe("talos");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20000);

  it("runSyncAssets should be callable as an exported function", () => {
    expect(typeof runSyncAssets).toBe("function");
  });
});
