import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { resolve } from "node:path";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { ConfigManager } from "../src/config.ts";
import { StateManager } from "../src/core/state.ts";
import { getUbuntuProfile } from "../src/providers/ubuntu/profiles/index.ts";
import { getSuseMicroProfile } from "../src/providers/suse-micro/profiles/index.ts";
import { renderSuseCombustionScript } from "../src/providers/suse-micro/combustion.ts";
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

    it("should lookup specific host by MAC for Ubuntu K3s server profile", () => {
      const host = configMgr.getHost("bc:24:11:00:24:33");
      expect(host.hostname).toBe("k3s-single-node");
      expect(host.os).toBe("ubuntu");
      expect(host.profile).toBe("k3s-single-node");
      expect(host.network?.dhcp).toBe(false);
      expect(host.network?.ip).toBe("192.168.250.33");
      expect(host.network?.gateway).toBe("192.168.250.1");
      expect(host.ssh_authorized_keys?.[0]).toContain("AAAAC3NzaC1lZDI1NTE5AAAAIPaWkIWwJqchLwmCMSN3hmUDVg08y3SU5L544sJSFpbW");
    });

    it("should fallback gracefully for unassigned MAC address", () => {
      const host = configMgr.getHost("aa:bb:cc:dd:ee:ff");
      expect(host.hostname).toContain("homelab-");
      expect(host.os).toBe("ubuntu");
      expect(host.profile).toBe("generic");
      expect(host.network?.dhcp).toBe(true);
      expect(host.ssh_authorized_keys?.[0]).toContain("AAAAC3NzaC1lZDI1NTE5AAAAIPaWkIWwJqchLwmCMSN3hmUDVg08y3SU5L544sJSFpbW");
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

    it("GET /boot.ipxe for Ubuntu K3s node should return iPXE script", async () => {
      const res = await fetch(`${baseUrl}/boot.ipxe?mac=bc:24:11:00:24:33&force=true`);
      expect(res.status).toBe(200);
      const script = await res.text();
      expect(script).toContain("#!ipxe");
      expect(script).toContain("k3s-single-node");
      expect(script).toContain("autoinstall ds=nocloud-net");
      expect(script).toContain("vmlinuz");
      expect(script).toContain("initrd");
    });

    it("GET Ubuntu Cloud-Init user-data should return valid autoinstall YAML with K3s", async () => {
      const res = await fetch(`${baseUrl}/os/ubuntu/bc:24:11:00:24:33/user-data`);
      expect(res.status).toBe(200);
      const yaml = await res.text();
      expect(yaml).toContain("#cloud-config");
      expect(yaml).toContain("autoinstall:");
      expect(yaml).toContain("k3s-single-node");
      expect(yaml).toContain("192.168.250.33/24");
      expect(yaml).toContain("192.168.250.1");
      expect(yaml).toContain("AAAAC3NzaC1lZDI1NTE5AAAAIPaWkIWwJqchLwmCMSN3hmUDVg08y3SU5L544sJSFpbW");
      expect(yaml).toContain("get.k3s.io");
      expect(yaml).toContain("write-kubeconfig-mode: \"0644\"");
      expect(yaml).toContain("tls-san:");
      expect(yaml).toContain("192.168.250.33");
      expect(yaml).toContain("INSTALL_K3S_SKIP_START=true");
      expect(yaml).toContain("KUBECONFIG=/etc/rancher/k3s/k3s.yaml");
      expect(yaml).toContain("/api/installed");
    });

    it("GET Ubuntu Cloud-Init meta-data should return hostname info", async () => {
      const res = await fetch(`${baseUrl}/os/ubuntu/bc:24:11:00:24:33/meta-data`);
      expect(res.status).toBe(200);
      const yaml = await res.text();
      expect(yaml).toContain("k3s-single-node");
      expect(yaml).toContain("i-bc2411002433");
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

    it("GET openSUSE Leap Micro Combustion script should return valid bash script with RKE2", async () => {
      const res = await fetch(`${baseUrl}/os/suse-micro/bc:24:11:00:24:35/combustion/script`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/x-shellscript");
      const script = await res.text();
      expect(script).toContain("#!/bin/bash");
      expect(script).toContain("# combustion: network");
      expect(script).toContain("rke2-micro-node");
      expect(script).toContain("write-kubeconfig-mode: \"0644\"");
      expect(script).toContain("cni: \"canal\"");
      expect(script).toContain("- \"traefik\"");
      expect(script).toContain("INSTALL_RKE2_METHOD=rpm");
      expect(script).toContain("systemctl enable rke2-server.service");
      expect(script).toContain("/api/installed");
    });
  });

  describe("Ubuntu Profiles", () => {
    const mockHost = {
      mac: "11:22:33:44:55:66",
      hostname: "test-node",
      os: "ubuntu",
      profile: "generic",
    };
    const baseUrl = "http://localhost:3000";

    it("should return k3s-single-node profile with k3s packages and setup late-commands", () => {
      const profile = getUbuntuProfile("k3s-single-node", mockHost, baseUrl);
      expect(profile.packages).toContain("open-iscsi");
      expect(profile.packages).toContain("nfs-common");
      expect(profile.packages).toContain("efibootmgr");
      expect(profile.lateCommands.some((c) => c.includes("config.yaml"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("get.k3s.io"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("INSTALL_K3S_SKIP_DOWNLOAD=true"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("curl -#"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("/dev/console"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("update.k3s.io"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("tls-san"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("KUBECONFIG=/etc/rancher/k3s/k3s.yaml"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes(".kube/config"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("systemctl enable k3s"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("efibootmgr"))).toBe(true);
    });

    it("should support custom k3s_version in k3s-single-node profile", () => {
      const versionHost = {
        ...mockHost,
        custom: { k3s_version: "v1.31.0+k3s1" },
      };
      const profile = getUbuntuProfile("k3s-single-node", versionHost, baseUrl);
      expect(profile.lateCommands.some((c) => c.includes('INSTALL_K3S_VERSION="v1.31.0+k3s1"'))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes('K3S_VER="v1.31.0+k3s1"'))).toBe(true);
    });

    it("should return generic profile with base utilities", () => {
      const profile = getUbuntuProfile("generic", mockHost, baseUrl);
      expect(profile.packages).toContain("curl");
      expect(profile.packages).toContain("htop");
      expect(profile.packages).toContain("git");
      expect(profile.packages).toContain("efibootmgr");
      expect(profile.lateCommands.some((c) => c.includes("qemu-guest-agent"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("efibootmgr"))).toBe(true);
      expect(profile.lateCommands.some((c) => c.includes("/api/installed"))).toBe(true);
    });

    it("should fallback to generic profile with warning when given unknown/removed profile", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const fallbackK3sServer = getUbuntuProfile("k3s-server", mockHost, baseUrl);
      expect(warnSpy).toHaveBeenCalled();
      expect(fallbackK3sServer.packages).toContain("git");

      const fallbackDocker = getUbuntuProfile("docker-host", mockHost, baseUrl);
      expect(fallbackDocker.packages).toContain("git");

      const fallbackK8s = getUbuntuProfile("k8s-node", mockHost, baseUrl);
      expect(fallbackK8s.packages).toContain("git");

      warnSpy.mockRestore();
    });
  });

  describe("openSUSE Leap Micro Profiles", () => {
    const mockSuseHost = {
      mac: "00:11:22:33:44:55",
      hostname: "rke2-test-node",
      os: "suse-micro",
      profile: "rke2-single-node",
      user: "homelab",
      network: {
        dhcp: false,
        ip: "192.168.250.50",
      },
    };
    const baseUrl = "http://localhost:3000";

    it("should return rke2-single-node profile with packages and configuration snippets", () => {
      const profile = getSuseMicroProfile("rke2-single-node", mockSuseHost, baseUrl);
      expect(profile.packages).toContain("curl");
      expect(profile.packages).toContain("ca-certificates");
      expect(profile.packages).toContain("nfs-client");
      expect(profile.packages).toContain("open-iscsi");
      expect(profile.packages).toContain("qemu-guest-agent");

      const script = profile.scriptSnippets.join("\n");
      expect(script).toContain("btrfs filesystem resize max /");
      expect(script).toContain("systemctl disable firewalld");
      expect(script).toContain("net.ipv4.ip_forward");
      expect(script).toContain("overlay");
      expect(script).toContain("br_netfilter");
      expect(script).toContain("write-kubeconfig-mode: \"0644\"");
      expect(script).toContain("cni: \"canal\"");
      expect(script).toContain("ingress-controller:");
      expect(script).toContain("- \"traefik\"");
      expect(script).toContain("192.168.250.50");
      expect(script).toContain("INSTALL_RKE2_METHOD=rpm");
      expect(script).toContain("systemctl enable rke2-server.service");
      expect(script).toContain("KUBECONFIG=/etc/rancher/rke2/rke2.yaml");
      expect(script).toContain(".kube/config");
    });

    it("should support custom rke2_version, rke2_token, and rke2_cni", () => {
      const customHost = {
        ...mockSuseHost,
        custom: {
          rke2_version: "v1.36.4+rke2r1",
          rke2_token: "super-secret-cluster-token",
          rke2_cni: "cilium",
          rke2_ingress: "ingress-nginx",
        },
      };
      const profile = getSuseMicroProfile("rke2-single-node", customHost, baseUrl);
      const script = profile.scriptSnippets.join("\n");
      expect(script).toContain('INSTALL_RKE2_VERSION="v1.36.4+rke2r1"');
      expect(script).toContain('token: "super-secret-cluster-token"');
      expect(script).toContain('cni: "cilium"');
      expect(script).toContain('- "ingress-nginx"');
    });

    it("should return generic profile with base utilities and btrfs resize", () => {
      const profile = getSuseMicroProfile("generic", mockSuseHost, baseUrl);
      expect(profile.packages).toContain("curl");
      expect(profile.packages).toContain("htop");
      expect(profile.packages).toContain("git");
      const script = profile.scriptSnippets.join("\n");
      expect(script).toContain("btrfs filesystem resize max /");
    });

    it("should fallback to generic profile with warning when given unknown profile", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const fallback = getSuseMicroProfile("unknown-profile", mockSuseHost, baseUrl);
      expect(warnSpy).toHaveBeenCalled();
      expect(fallback.packages).toContain("git");
      warnSpy.mockRestore();
    });

    it("renderSuseCombustionScript should assemble complete bash combustion script", () => {
      const fullScript = renderSuseCombustionScript(mockSuseHost, baseUrl);
      expect(fullScript).toContain("#!/bin/bash");
      expect(fullScript).toContain("# combustion: network");
      expect(fullScript).toContain("rke2-test-node");
      expect(fullScript).toContain('useradd -m -U -G wheel "homelab"');
      expect(fullScript).toContain("zypper --non-interactive --no-gpg-checks in -y");
      expect(fullScript).toContain("INSTALL_RKE2_METHOD=rpm");
      expect(fullScript).toContain("efibootmgr");
      expect(fullScript).toContain("/api/installed?mac=00%3A11%3A22%3A33%3A44%3A55&hostname=rke2-test-node&os=suse-micro");
    });
  });
});

