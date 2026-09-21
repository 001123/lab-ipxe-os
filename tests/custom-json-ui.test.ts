import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { StateManager } from "../src/core/state.ts";
import { ConfigManager } from "../src/config.ts";
import { handleApiRoute, buildDashboardData } from "../src/routes/api.ts";
import { renderNodesTablePartial, renderDashboardHtml } from "../src/ui/dashboard.ts";

describe("Custom JSON Dashboard & API Tests", () => {
  let stateMgr: StateManager;
  let configMgr: ConfigManager;

  beforeEach(() => {
    stateMgr = new StateManager(":memory:");
    // Clear initial seed
    for (const h of stateMgr.getAllHosts()) {
      stateMgr.deleteHost(h.mac);
    }
    configMgr = new ConfigManager(undefined, stateMgr);
  });

  afterEach(() => {
    stateMgr.close();
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
      // SSH Keys textareas
      expect(html).toContain('id="add-ssh-keys-json"');
      expect(html).toContain('id="edit-ssh-keys-json"');
    });
  });

  describe("SSH Keys (ssh_keys_json) Tests", () => {
    it("should create host with multi-line ssh_keys_json via FormData", async () => {
      const formData = new FormData();
      formData.append("mac", "bb:cc:dd:ee:ff:01");
      formData.append("hostname", "node-ssh-test-01");
      formData.append("os", "ubuntu");
      formData.append(
        "ssh_keys_json",
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG1 user1@homelab\n# this is a comment\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB user2@work\n"
      );

      const req = new Request("http://localhost:3000/api/hosts", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts", configMgr, stateMgr);
      expect(res.status).toBe(201);

      const host = stateMgr.getHost("bb:cc:dd:ee:ff:01", false);
      expect(host).toBeDefined();
      expect(host?.ssh_authorized_keys).toEqual([
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG1 user1@homelab",
        "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB user2@work",
      ]);
    });

    it("should create host with JSON array ssh_keys_json", async () => {
      const formData = new FormData();
      formData.append("mac", "bb:cc:dd:ee:ff:02");
      formData.append("hostname", "node-ssh-test-02");
      formData.append("os", "ubuntu");
      formData.append(
        "ssh_keys_json",
        JSON.stringify(["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG2 admin@cluster"])
      );

      const req = new Request("http://localhost:3000/api/hosts", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/hosts", configMgr, stateMgr);
      expect(res.status).toBe(201);

      const host = stateMgr.getHost("bb:cc:dd:ee:ff:02", false);
      expect(host?.ssh_authorized_keys).toEqual([
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG2 admin@cluster",
      ]);
    });

    it("should update and clear ssh_keys_json on edit host", async () => {
      // Create initial host with 1 key
      stateMgr.createHost({
        mac: "bb:cc:dd:ee:ff:03",
        hostname: "node-ssh-test-03",
        os: "ubuntu",
        ssh_authorized_keys: ["ssh-ed25519 OLD_KEY user@old"],
      });

      // Update with new key
      const updateForm = new FormData();
      updateForm.append("hostname", "node-ssh-test-03");
      updateForm.append("os", "ubuntu");
      updateForm.append("ssh_keys_json", "ssh-ed25519 NEW_KEY user@new");

      const updateReq = new Request("http://localhost:3000/api/hosts/bb:cc:dd:ee:ff:03/edit", {
        method: "POST",
        body: updateForm,
      });

      const updateRes = await handleApiRoute(updateReq, "/api/hosts/bb:cc:dd:ee:ff:03/edit", configMgr, stateMgr);
      expect(updateRes.status).toBe(200);

      let host = stateMgr.getHost("bb:cc:dd:ee:ff:03", false);
      expect(host?.ssh_authorized_keys).toEqual(["ssh-ed25519 NEW_KEY user@new"]);

      // Clear with empty string
      const clearForm = new FormData();
      clearForm.append("hostname", "node-ssh-test-03");
      clearForm.append("os", "ubuntu");
      clearForm.append("ssh_keys_json", "");

      const clearReq = new Request("http://localhost:3000/api/hosts/bb:cc:dd:ee:ff:03/edit", {
        method: "POST",
        body: clearForm,
      });

      const clearRes = await handleApiRoute(clearReq, "/api/hosts/bb:cc:dd:ee:ff:03/edit", configMgr, stateMgr);
      expect(clearRes.status).toBe(200);

      host = stateMgr.getHost("bb:cc:dd:ee:ff:03", false);
      expect(host?.ssh_authorized_keys).toEqual([]);
    });

    it("should render data-ssh-keys in nodes table row", () => {
      const keys = ["ssh-ed25519 KEY1", "ssh-rsa KEY2"];
      stateMgr.createHost({
        mac: "bb:cc:dd:ee:ff:04",
        hostname: "node-ssh-table-test",
        os: "ubuntu",
        ssh_authorized_keys: keys,
      });

      const hosts = stateMgr.getAllHosts();
      const html = renderNodesTablePartial(hosts, "http://localhost:3000");
      const hostItem = hosts.find((h) => h.mac === "bb:cc:dd:ee:ff:04");
      const expected = encodeURIComponent(JSON.stringify(hostItem?.ssh_authorized_keys || []));
      expect(html).toContain(`data-ssh-keys="${expected}"`);
    });
  });
});
