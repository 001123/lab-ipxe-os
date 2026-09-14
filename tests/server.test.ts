import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolve, join } from "node:path";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { ConfigManager } from "../src/config.ts";
import { StateManager } from "../src/core/state.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { StaticAssetServer } from "../src/core/static-server.ts";
import { server } from "../src/index.ts";

describe("Bun Multi-OS iPXE Server Tests", () => {
  const testStatePath = resolve(process.cwd(), "data", "test-state.json");
  const testIsoPath = resolve(process.cwd(), "assets", "test.iso");

  beforeAll(() => {
    // Create dummy ISO file for Range request test
    const dummyBuffer = Buffer.alloc(2048, "A");
    writeFileSync(testIsoPath, dummyBuffer);
  });

  afterAll(() => {
    if (existsSync(testStatePath)) unlinkSync(testStatePath);
    if (existsSync(testIsoPath)) unlinkSync(testIsoPath);
  });

  describe("ConfigManager", () => {
    const configMgr = new ConfigManager();

    it("should load and parse hosts.yaml correctly", () => {
      const config = configMgr.loadHostsConfig();
      expect(config.default).toBeDefined();
      expect(config.default.os).toBe("ubuntu");
    });

    it("should lookup specific host by MAC for Ubuntu Docker profile", () => {
      const host = configMgr.getHost("bc:24:11:00:24:04");
      expect(host.hostname).toBe("srv-docker-01");
      expect(host.os).toBe("ubuntu");
      expect(host.profile).toBe("docker-host");
      expect(host.network?.dhcp).toBe(false);
      expect(host.network?.ip).toBe("192.168.1.50");
    });

    it("should lookup Talos Linux host by MAC", () => {
      const host = configMgr.getHost("bc:24:11:00:14:00");
      expect(host.hostname).toBe("talos-cp-01");
      expect(host.os).toBe("talos");
      expect(host.role).toBe("controlplane");
      expect(host.version).toBe("v1.14.0");
    });

    it("should lookup openSUSE Leap Micro host by MAC", () => {
      const host = configMgr.getHost("bc:24:11:00:06:20");
      expect(host.hostname).toBe("suse-micro-01");
      expect(host.os).toBe("suse-micro");
      expect(host.version).toBe("6.2");
    });

    it("should fallback gracefully for unassigned MAC address", () => {
      const host = configMgr.getHost("aa:bb:cc:dd:ee:ff");
      expect(host.hostname).toContain("homelab-");
      expect(host.os).toBe("ubuntu");
      expect(host.profile).toBe("generic");
    });
  });

  describe("StateManager", () => {
    it("should track install status and prevent boot loop", () => {
      const stateMgr = new StateManager(testStatePath);
      const testMac = "11:22:33:44:55:66";

      expect(stateMgr.isInstalled(testMac)).toBe(false);

      stateMgr.markInstalled(testMac, { hostname: "test-node", os: "ubuntu" });
      expect(stateMgr.isInstalled(testMac)).toBe(true);

      stateMgr.resetInstalled(testMac);
      expect(stateMgr.isInstalled(testMac)).toBe(false);
    });
  });

  describe("HTTP API & iPXE Routes", () => {
    const baseUrl = `http://localhost:${server.port}`;

    it("GET /health should return 200 OK with server info", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Bun Multi-OS iPXE & Cloud-Init Server");
    });

    it("GET /boot.ipxe for Ubuntu node should return iPXE script", async () => {
      const res = await fetch(`${baseUrl}/boot.ipxe?mac=bc:24:11:00:24:04`);
      expect(res.status).toBe(200);
      const script = await res.text();
      expect(script).toContain("#!ipxe");
      expect(script).toContain("srv-docker-01");
      expect(script).toContain("autoinstall ds=nocloud-net");
      expect(script).toContain("vmlinuz");
      expect(script).toContain("initrd");
    });

    it("GET /boot.ipxe for Talos node should return Talos iPXE script", async () => {
      const res = await fetch(`${baseUrl}/boot.ipxe?mac=bc:24:11:00:14:00`);
      expect(res.status).toBe(200);
      const script = await res.text();
      expect(script).toContain("#!ipxe");
      expect(script).toContain("talos-cp-01");
      expect(script).toContain("talos.platform=metal");
      expect(script).toContain("vmlinuz-amd64");
    });

    it("GET /boot.ipxe for openSUSE Micro node should return SUSE iPXE script", async () => {
      const res = await fetch(`${baseUrl}/boot.ipxe?mac=bc:24:11:00:06:20`);
      expect(res.status).toBe(200);
      const script = await res.text();
      expect(script).toContain("#!ipxe");
      expect(script).toContain("suse-micro-01");
      expect(script).toContain("combustion.url=");
    });

    it("GET Ubuntu Cloud-Init user-data should return valid autoinstall YAML", async () => {
      const res = await fetch(`${baseUrl}/os/ubuntu/bc:24:11:00:24:04/user-data`);
      expect(res.status).toBe(200);
      const yaml = await res.text();
      expect(yaml).toContain("#cloud-config");
      expect(yaml).toContain("autoinstall:");
      expect(yaml).toContain("srv-docker-01");
      expect(yaml).toContain("docker.io");
      expect(yaml).toContain("/api/installed");
    });

    it("GET Ubuntu Cloud-Init meta-data should return hostname info", async () => {
      const res = await fetch(`${baseUrl}/os/ubuntu/bc:24:11:00:24:04/meta-data`);
      expect(res.status).toBe(200);
      const yaml = await res.text();
      expect(yaml).toContain("srv-docker-01");
    });

    it("GET Talos MachineConfig should return YAML with controlplane role", async () => {
      const res = await fetch(`${baseUrl}/os/talos/bc:24:11:00:14:00/config.yaml`);
      expect(res.status).toBe(200);
      const yaml = await res.text();
      expect(yaml).toContain("MachineConfig");
      expect(yaml).toContain("controlplane");
      expect(yaml).toContain("talos-cp-01");
    });

    it("GET openSUSE Combustion script should return bash script", async () => {
      const res = await fetch(`${baseUrl}/os/suse-micro/bc:24:11:00:06:20/combustion/script`);
      expect(res.status).toBe(200);
      const script = await res.text();
      expect(script).toContain("#!/bin/bash");
      expect(script).toContain("suse-micro-01");
      expect(script).toContain("/api/installed");
    });

    it("POST /api/installed should record install and trigger local boot on subsequent iPXE call", async () => {
      const testMac = "bc:24:11:99:99:99";

      // 1. Mark as installed
      const postRes = await fetch(`${baseUrl}/api/installed?mac=${testMac}&hostname=test-installed&os=ubuntu`, {
        method: "POST",
      });
      expect(postRes.status).toBe(200);

      // 2. Next iPXE call should return local disk bypass script
      const bootRes = await fetch(`${baseUrl}/boot.ipxe?mac=${testMac}`);
      const script = await bootRes.text();
      expect(script).toContain("ALREADY INSTALLED");
      expect(script).toContain("sanboot --no-describe --drive 0x80");

      // 3. Reset install state
      const resetRes = await fetch(`${baseUrl}/api/reset?mac=${testMac}`, { method: "POST" });
      expect(resetRes.status).toBe(200);

      // 4. Next iPXE call returns normal menu again
      const restoredBoot = await fetch(`${baseUrl}/boot.ipxe?mac=${testMac}`);
      const restoredScript = await restoredBoot.text();
      expect(restoredScript).toContain("menu Network Boot Menu");
    });

    it("GET /assets/test.iso with Range header should return HTTP 206 Partial Content", async () => {
      const res = await fetch(`${baseUrl}/assets/test.iso`, {
        headers: { Range: "bytes=0-511" },
      });
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe("bytes 0-511/2048");
      expect(res.headers.get("Content-Length")).toBe("512");
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBe(512);
    });
  });
});
