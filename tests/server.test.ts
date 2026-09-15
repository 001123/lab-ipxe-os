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
      expect(host.note).toBe("VM Ubuntu 24.04 chạy K3s Single-Node (NFS root boot)");
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

    it("should fallback to hosts.example.yaml when target configPath does not exist", () => {
      const fallbackMgr = new ConfigManager("./config/non-existent-hosts.yaml");
      const config = fallbackMgr.loadHostsConfig();
      expect(config.default).toBeDefined();
      expect(config.hosts?.["bc:24:11:00:24:33"]).toBeDefined();
      expect(config.hosts?.["bc:24:11:00:24:33"].hostname).toBe("k3s-single-node");
    });
  });

  describe("StateManager", () => {
    it("should track install status and prevent boot loop", () => {
      const stateMgr = new StateManager(testStatePath);
      const testMac = "11:22:33:44:55:66";

      expect(stateMgr.isInstalled(testMac)).toBe(false);

      stateMgr.markInstalled(testMac, { hostname: "test-node", os: "ubuntu", note: "Initial note" });
      expect(stateMgr.isInstalled(testMac)).toBe(true);
      expect(stateMgr.getRecord(testMac)?.note).toBe("Initial note");

      stateMgr.updateNote(testMac, "Updated note");
      expect(stateMgr.getRecord(testMac)?.note).toBe("Updated note");

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

    it("POST /api/installed should resolve client IP from host network config or query param", async () => {
      // 1. Host with network.ip configured in hosts.yaml (bc:24:11:00:24:33)
      const resHost = await fetch(`${baseUrl}/api/installed?mac=bc:24:11:00:24:33&hostname=k3s-single-node&os=ubuntu`, {
        method: "POST",
      });
      const dataHost = (await resHost.json()) as any;
      expect(dataHost.record.client_ip).toBe("192.168.250.33");

      // 2. Explicit ip parameter overrides fallback
      const resCustom = await fetch(`${baseUrl}/api/installed?mac=bc:24:11:00:24:33&ip=10.0.0.99`, {
        method: "POST",
      });
      const dataCustom = (await resCustom.json()) as any;
      expect(dataCustom.record.client_ip).toBe("10.0.0.99");

      // Clean up / restore original state in state.json
      await fetch(`${baseUrl}/api/installed?mac=bc:24:11:00:24:33&ip=192.168.250.33`, {
        method: "POST",
      });
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

    it("GET /api/kubeconfig without identifier should return 400 Bad Request", async () => {
      const res = await fetch(`${baseUrl}/api/kubeconfig`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("Missing node identifier");
    });

    it("GET /api/kubeconfig/unknown-node should return 404 Not Found", async () => {
      const res = await fetch(`${baseUrl}/api/kubeconfig/unknown-node`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as any;
      expect(data.error).toContain("not found");
    });

    it("GET /api/kubeconfig for host with non-k8s profile should return 400 Bad Request", async () => {
      const genericMac = "aa:bb:cc:11:22:33";
      await fetch(`${baseUrl}/api/installed?mac=${genericMac}&hostname=generic-box&os=ubuntu`, {
        method: "POST",
      });

      const res = await fetch(`${baseUrl}/api/kubeconfig/${genericMac}`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("does not run a Kubernetes cluster");

      await fetch(`${baseUrl}/api/reset?mac=${genericMac}`, { method: "POST" });
    });

    it("GET /api/hosts should return registered hosts with note and install status", async () => {
      const res = await fetch(`${baseUrl}/api/hosts`);
      expect(res.status).toBe(200);
      const hosts = (await res.json()) as any[];
      const k3sHost = hosts.find((h) => h.mac === "bc:24:11:00:24:33");
      expect(k3sHost).toBeDefined();
      expect(k3sHost.note).toBe("VM Ubuntu 24.04 chạy K3s Single-Node (NFS root boot)");
    });

    it("POST /api/installed should inherit note from hosts.yaml or query parameter", async () => {
      const testMac = "bc:24:11:00:24:33";

      // 1. Inherits note from hosts.yaml if not provided
      const resInherit = await fetch(`${baseUrl}/api/installed?mac=${testMac}&hostname=k3s-single-node&os=ubuntu`, {
        method: "POST",
      });
      expect(resInherit.status).toBe(200);
      const dataInherit = (await resInherit.json()) as any;
      expect(dataInherit.record.note).toBe("VM Ubuntu 24.04 chạy K3s Single-Node (NFS root boot)");

      // 2. Query param note overrides hosts.yaml
      const resOverride = await fetch(`${baseUrl}/api/installed?mac=${testMac}&note=Custom+Override+Note`, {
        method: "POST",
      });
      expect(resOverride.status).toBe(200);
      const dataOverride = (await resOverride.json()) as any;
      expect(dataOverride.record.note).toBe("Custom Override Note");

      // Restore original note
      await fetch(`${baseUrl}/api/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: testMac, note: "VM Ubuntu 24.04 chạy K3s Single-Node (NFS root boot)" }),
      });
    });

    it("POST /api/note should update node note dynamically in state.json", async () => {
      const testMac = "bc:24:11:00:24:33";
      const tempNote = "Temporary custom note for node";
      const originalNote = "VM Ubuntu 24.04 chạy K3s Single-Node (NFS root boot)";

      const res = await fetch(`${baseUrl}/api/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: testMac, note: tempNote }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.record.note).toBe(tempNote);

      // Verify GET /api/state reflects updated note
      const stateRes = await fetch(`${baseUrl}/api/state`);
      const stateData = (await stateRes.json()) as any;
      expect(stateData[testMac]?.note).toBe(tempNote);

      // Restore original note
      await fetch(`${baseUrl}/api/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac: testMac, note: originalNote }),
      });
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

    it("should include ArgoCD HelmChart manifest and get-argocd-password helper when custom.argocd is enabled", () => {
      const argocdHost = {
        ...mockSuseHost,
        custom: {
          argocd: true,
        },
      };
      const profile = getSuseMicroProfile("rke2-single-node", argocdHost, baseUrl);
      const script = profile.scriptSnippets.join("\n");
      expect(script).toContain("Pre-configuring ArgoCD HelmChart auto-deploy manifest");
      expect(script).toContain("name: argo-cd");
      expect(script).toContain("chart: argo-cd");
      expect(script).toContain("argocd.192.168.250.50.nip.io");
      expect(script).toContain("server.insecure: true");
      expect(script).toContain("ingressClassName: traefik");
      expect(script).toContain("/usr/local/bin/get-argocd-password");
      // When argocd_version is not set, version field is omitted so Helm pulls latest
      expect(script).not.toContain("version:");
    });

    it("should allow pinning custom argocd_version in HelmChart when specified", () => {
      const versionedHost = {
        ...mockSuseHost,
        custom: {
          argocd: true,
          argocd_version: "7.7.16",
        },
      };
      const profile = getSuseMicroProfile("rke2-single-node", versionedHost, baseUrl);
      const script = profile.scriptSnippets.join("\n");
      expect(script).toContain('version: "7.7.16"');
    });

    it("should configure GitOps root application and repo credentials when gitops_repo and gitops_token are set", () => {
      const gitopsHost = {
        ...mockSuseHost,
        custom: {
          argocd: true,
          argocd_hostname: "argocd.lab.internal",
          gitops_repo: "https://github.com/my-user/homelab-gitops.git",
          gitops_branch: "main",
          gitops_path: "apps",
          gitops_token: "ghp_secretToken123",
        },
      };
      const profile = getSuseMicroProfile("rke2-single-node", gitopsHost, baseUrl);
      const script = profile.scriptSnippets.join("\n");
      expect(script).toContain("domain: argocd.lab.internal");
      expect(script).toContain("additionalApplications:");
      expect(script).toContain("name: root-bootstrap");
      expect(script).toContain("repoURL: \"https://github.com/my-user/homelab-gitops.git\"");
      expect(script).toContain("targetRevision: \"main\"");
      expect(script).toContain("path: \"apps\"");
      expect(script).toContain("password: \"ghp_secretToken123\"");
    });

    it("should return generic profile with base utilities and btrfs resize", () => {
      const profile = getSuseMicroProfile("generic", mockSuseHost, baseUrl);
      expect(profile.packages).toContain("curl");
      expect(profile.packages).toContain("qemu-guest-agent");
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

