import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { StateManager } from "../src/core/state.ts";
import { ConfigManager } from "../src/config.ts";
import { handleApiRoute } from "../src/routes/api.ts";

describe("YAML Import Feature Tests", () => {
  const testDbPath = resolve(process.cwd(), "data", "test-import-state.db");
  let stateMgr: StateManager;

  const validYamlSample = `
default:
  os: ubuntu
  version: "24.04"
  profile: generic
  user: homelab
  storage:
    layout: direct
    target_disk: /dev/sda
  network:
    dhcp: true
hosts:
  70:80:90:aa:bb:01:
    hostname: k3s-single-node
    os: ubuntu
    version: "24.04"
    profile: k3s-single-node
    note: K3s Test Node
    network:
      dhcp: false
      ip: 192.168.250.33
      netmask: 255.255.255.0
      gateway: 192.168.250.1
  70:80:90:aa:bb:02:
    hostname: rke2-single-node-i5
    os: suse-micro
    version: "6.2"
    profile: rke2-single-node
    note: RKE2 Bare-metal Node
    network:
      dhcp: false
      ip: 192.168.250.2
`;

  beforeEach(() => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    stateMgr = new StateManager(testDbPath);
    // Clear initial seed so we start with a clean state for testing import
    for (const h of stateMgr.getAllHosts()) {
      stateMgr.deleteHost(h.mac);
    }
  });

  afterEach(() => {
    stateMgr.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(`${testDbPath}-wal`)) unlinkSync(`${testDbPath}-wal`);
    if (existsSync(`${testDbPath}-shm`)) unlinkSync(`${testDbPath}-shm`);
  });

  describe("StateManager.importFromYaml", () => {
    it("should import hosts and global default config from valid YAML", () => {
      const result = stateMgr.importFromYaml(validYamlSample);
      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.added).toBe(2);
      expect(result.updated).toBe(0);

      const host1 = stateMgr.getHost("70:80:90:aa:bb:01");
      expect(host1).toBeDefined();
      expect(host1?.hostname).toBe("k3s-single-node");
      expect(host1?.os).toBe("ubuntu");
      expect(host1?.network?.ip).toBe("192.168.250.33");
      expect(host1?.status).toBe("PENDING");

      const host2 = stateMgr.getHost("70:80:90:aa:bb:02");
      expect(host2).toBeDefined();
      expect(host2?.hostname).toBe("rke2-single-node-i5");
      expect(host2?.os).toBe("suse-micro");

      const defaults = stateMgr.getGlobalDefaultConfig();
      expect(defaults.os).toBe("ubuntu");
      expect(defaults.user).toBe("homelab");
    });

    it("should perform merge/upsert when importing existing hosts", () => {
      // First import
      stateMgr.importFromYaml(validYamlSample);

      // Second import with modified note and new node
      const updatedYaml = `
hosts:
  70:80:90:aa:bb:01:
    hostname: k3s-single-node-updated
    os: ubuntu
    note: Updated Note
  11:22:33:44:55:66:
    hostname: new-worker-node
    os: ubuntu
`;
      const result = stateMgr.importFromYaml(updatedYaml);
      expect(result.success).toBe(true);
      expect(result.total).toBe(2);
      expect(result.added).toBe(1);
      expect(result.updated).toBe(1);

      const host1 = stateMgr.getHost("70:80:90:aa:bb:01");
      expect(host1?.hostname).toBe("k3s-single-node-updated");
      expect(host1?.note).toBe("Updated Note");
      // Preserves existing network configuration not specified in update
      expect(host1?.network?.ip).toBe("192.168.250.33");

      // Node 70:80:90:aa:bb:02 should still exist
      expect(stateMgr.getHost("70:80:90:aa:bb:02")).toBeDefined();

      // New node should exist
      expect(stateMgr.getHost("11:22:33:44:55:66")).toBeDefined();
    });

    it("should preserve existing node status unless resetStatus is requested", () => {
      stateMgr.importFromYaml(validYamlSample);
      // Mark node as INSTALLED
      stateMgr.updateHost("70:80:90:aa:bb:01", { status: "INSTALLED" });
      expect(stateMgr.getHost("70:80:90:aa:bb:01")?.status).toBe("INSTALLED");

      // Re-import without resetStatus
      stateMgr.importFromYaml(validYamlSample, { resetStatus: false });
      expect(stateMgr.getHost("70:80:90:aa:bb:01")?.status).toBe("INSTALLED");

      // Re-import with resetStatus = true
      stateMgr.importFromYaml(validYamlSample, { resetStatus: true });
      expect(stateMgr.getHost("70:80:90:aa:bb:01")?.status).toBe("PENDING");
    });

    it("should replace all hosts when replaceAll is true", () => {
      stateMgr.importFromYaml(validYamlSample);
      expect(stateMgr.getAllHosts().length).toBe(2);

      const singleNodeYaml = `
hosts:
  aa:bb:cc:dd:ee:ff:
    hostname: only-one-host
    os: ubuntu
`;
      const result = stateMgr.importFromYaml(singleNodeYaml, { replaceAll: true });
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);

      const allHosts = stateMgr.getAllHosts();
      expect(allHosts.length).toBe(1);
      expect(allHosts[0].hostname).toBe("only-one-host");
      expect(stateMgr.getHost("bc:24:11:00:24:33")).toBeNull();
    });

    it("should reject invalid MAC addresses atomically and rollback transaction", () => {
      stateMgr.importFromYaml(validYamlSample);
      const initialCount = stateMgr.getAllHosts().length;

      const corruptYaml = `
hosts:
  99:88:77:66:55:44:
    hostname: valid-host-1
    os: ubuntu
  not-a-valid-mac:
    hostname: broken-host
    os: ubuntu
`;
      expect(() => {
        stateMgr.importFromYaml(corruptYaml);
      }).toThrow(/Invalid MAC address format/);

      // Verify that no hosts were added or modified (atomic rollback)
      expect(stateMgr.getAllHosts().length).toBe(initialCount);
      expect(stateMgr.getHost("99:88:77:66:55:44")).toBeNull();
    });

    it("should reject malformed YAML syntax", () => {
      const brokenYaml = `
hosts:
  bc:24:11:00:24:33: [unclosed array
`;
      expect(() => {
        stateMgr.importFromYaml(brokenYaml);
      }).toThrow(/YAML syntax error/);
    });
  });

  describe("API Endpoint POST /api/import/yaml", () => {
    it("should import YAML via JSON payload", async () => {
      const configMgr = new ConfigManager(undefined, stateMgr);
      const req = new Request("http://localhost:3000/api/import/yaml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yaml: validYamlSample,
          replaceAll: false,
          updateDefaults: true,
        }),
      });

      const res = await handleApiRoute(req, "/api/import/yaml", configMgr, stateMgr);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.total).toBe(2);
    });

    it("should import YAML via FormData payload", async () => {
      const configMgr = new ConfigManager(undefined, stateMgr);
      const formData = new FormData();
      const blob = new Blob([validYamlSample], { type: "application/x-yaml" });
      formData.append("file", blob, "hosts.yaml");
      formData.append("updateDefaults", "true");

      const req = new Request("http://localhost:3000/api/import/yaml", {
        method: "POST",
        body: formData,
      });

      const res = await handleApiRoute(req, "/api/import/yaml", configMgr, stateMgr);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
    });

    it("should return 400 error on empty or invalid YAML", async () => {
      const configMgr = new ConfigManager(undefined, stateMgr);
      const req = new Request("http://localhost:3000/api/import/yaml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yaml: "hosts: invalid_format",
        }),
      });

      const res = await handleApiRoute(req, "/api/import/yaml", configMgr, stateMgr);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toBeDefined();
    });
  });
});
