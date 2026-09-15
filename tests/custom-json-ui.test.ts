import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { StateManager } from "../src/core/state.ts";
import { ConfigManager } from "../src/config.ts";
import { handleApiRoute, buildDashboardData } from "../src/routes/api.ts";
import { renderNodesTablePartial, renderDashboardHtml } from "../src/ui/dashboard.ts";

describe("Custom JSON Dashboard & API Tests", () => {
  const testDbPath = resolve(process.cwd(), "data", "test-custom-json-state.db");
  let stateMgr: StateManager;
  let configMgr: ConfigManager;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    stateMgr = new StateManager(testDbPath);
    // Clear initial seed
    for (const h of stateMgr.getAllHosts()) {
      stateMgr.deleteHost(h.mac);
    }
    configMgr = new ConfigManager(undefined, stateMgr);
  });

  afterEach(() => {
    stateMgr.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(`${testDbPath}-wal`)) unlinkSync(`${testDbPath}-wal`);
    if (existsSync(`${testDbPath}-shm`)) unlinkSync(`${testDbPath}-shm`);
  });

  describe("POST /api/hosts (Create Host with custom_json)", () => {
    it("should create host with custom_json via FormData", async () => {
      const formData = new FormData();
      formData.append("mac", "aa:bb:cc:dd:ee:01");
      formData.append("hostname", "node-custom-01");
      formData.append("os", "ubuntu");
      formData.append("version", "24.04");
      formData.append("profile", "k3s-single-node");
      formData.append(
        "custom_json",
        JSON.stringify({
          argocd: true,
          gitops_repo: "https://github.com/myorg/gitops.git",
          custom_tag: "worker-prod",
        })
      );

      const req = new Request("http://localhost:3000/api/hosts", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts", configMgr, stateMgr);
      expect(res.status).toBe(201);

      const host = stateMgr.getHost("aa:bb:cc:dd:ee:01", false);
      expect(host).toBeDefined();
      expect(host?.custom?.argocd).toBe(true);
      expect(host?.custom?.gitops_repo).toBe("https://github.com/myorg/gitops.git");
      expect(host?.custom?.custom_tag).toBe("worker-prod");
    });

    it("should return 400 when custom_json has malformed syntax", async () => {
      const formData = new FormData();
      formData.append("mac", "aa:bb:cc:dd:ee:02");
      formData.append("hostname", "node-custom-broken");
      formData.append("os", "ubuntu");
      formData.append("custom_json", "{ broken json here: ");

      const req = new Request("http://localhost:3000/api/hosts", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts", configMgr, stateMgr);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("Invalid JSON in custom_json");
    });
  });

  describe("POST /api/hosts/:mac/edit (Update Host with custom_json)", () => {
    beforeEach(() => {
      // Create initial host with custom fields
      stateMgr.createHost({
        mac: "aa:bb:cc:dd:ee:03",
        hostname: "node-edit-test",
        os: "ubuntu",
        custom: {
          argocd: true,
          gitops_repo: "https://github.com/old/repo.git",
          old_flag: "keep_or_delete",
        },
      });
    });

    it("should overwrite custom object when new custom_json is provided", async () => {
      const formData = new FormData();
      formData.append("hostname", "node-edit-test");
      formData.append("os", "ubuntu");
      // New custom_json removes old_flag and updates gitops_repo
      formData.append(
        "custom_json",
        JSON.stringify({
          gitops_repo: "https://github.com/new/repo.git",
          k3s_channel: "stable",
        })
      );

      const req = new Request("http://localhost:3000/api/hosts/aa:bb:cc:dd:ee:03/edit", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts/aa:bb:cc:dd:ee:03/edit", configMgr, stateMgr);
      expect(res.status).toBe(200);

      const updated = stateMgr.getHost("aa:bb:cc:dd:ee:03", false);
      expect(updated?.custom?.gitops_repo).toBe("https://github.com/new/repo.git");
      expect(updated?.custom?.k3s_channel).toBe("stable");
      // old_flag and argocd should be removed because of overwrite
      expect(updated?.custom?.old_flag).toBeUndefined();
      expect(updated?.custom?.argocd).toBeUndefined();
    });

    it("should clear custom object when empty custom_json is provided", async () => {
      const formData = new FormData();
      formData.append("hostname", "node-edit-test");
      formData.append("os", "ubuntu");
      formData.append("custom_json", "");

      const req = new Request("http://localhost:3000/api/hosts/aa:bb:cc:dd:ee:03/edit", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts/aa:bb:cc:dd:ee:03/edit", configMgr, stateMgr);
      expect(res.status).toBe(200);

      const updated = stateMgr.getHost("aa:bb:cc:dd:ee:03", false);
      expect(updated?.custom).toEqual({});
    });

    it("should return 400 when updating with invalid JSON in custom_json", async () => {
      const formData = new FormData();
      formData.append("hostname", "node-edit-test");
      formData.append("os", "ubuntu");
      formData.append("custom_json", "{ invalid JSON");

      const req = new Request("http://localhost:3000/api/hosts/aa:bb:cc:dd:ee:03/edit", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts/aa:bb:cc:dd:ee:03/edit", configMgr, stateMgr);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("Invalid JSON in custom_json");
    });
  });

  describe("UI Template Rendering", () => {
    it("should render data-custom on Edit button in nodes table", () => {
      const customData = { argocd: true, gitops_repo: "https://github.com/test.git" };
      stateMgr.createHost({
        mac: "aa:bb:cc:dd:ee:04",
        hostname: "node-ui-test",
        os: "ubuntu",
        custom: customData,
      });

      const hosts = stateMgr.getAllHosts();
      const html = renderNodesTablePartial(hosts, "http://localhost:3000");

      const expectedEncoded = encodeURIComponent(JSON.stringify(customData));
      expect(html).toContain(`data-custom="${expectedEncoded}"`);
    });

    it("should render custom_json textareas and Format JSON buttons in dashboard modals", () => {
      const dashboardData = buildDashboardData(configMgr, stateMgr);
      const html = renderDashboardHtml(dashboardData as any);
      // Both add and edit textareas should be present
      expect(html).toContain('id="add-custom-json"');
      expect(html).toContain('id="edit-custom-json"');
      // Format JSON buttons
      expect(html).toContain("formatCustomJson('add-custom-json')");
      expect(html).toContain("formatCustomJson('edit-custom-json')");
      // GitOps inputs should no longer be present
      expect(html).not.toContain('id="edit-argocd"');
      expect(html).not.toContain('id="edit-gitops-repo"');
    });
  });
});
