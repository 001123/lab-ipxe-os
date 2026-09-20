import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { getProxmoxProfile } from "../src/providers/proxmox/profiles/index.ts";
import { renderProxmoxIpxe } from "../src/providers/proxmox/ipxe.ts";
import {
  extractInstallerMacs,
  renderProxmoxAnswer,
  renderProxmoxFirstBootScript,
} from "../src/providers/proxmox/answer.ts";
import type { HostConfig } from "../src/types.ts";
import { server } from "../src/index.ts";

const baseUrl = `http://localhost:${server.port}`;

const dhcpHost: HostConfig = {
  mac: "bc:24:11:00:24:40",
  hostname: "pve-01",
  os: "proxmox",
  version: "9.2",
  profile: "generic",
  password_hash: "$6$rounds=4096$homelab$testhashedvalueexample0000000000000000000000000000001",
  ssh_authorized_keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY proxmox@homelab"],
  storage: { target_disk: "/dev/sda" },
  network: { dhcp: true },
};

const staticZfsHost: HostConfig = {
  mac: "bc:24:11:00:24:41",
  hostname: "pve-02",
  os: "proxmox",
  version: "9.2",
  profile: "generic",
  ssh_authorized_keys: [],
  storage: { target_disk: "/dev/sda" },
  network: {
    dhcp: false,
    ip: "192.168.250.41",
    netmask: "255.255.255.0",
    gateway: "192.168.250.1",
    nameservers: ["192.168.250.1", "1.1.1.1"],
  },
  custom: {
    filesystem: "zfs",
    zfs_raid: "raid1",
    timezone: "Asia/Ho_Chi_Minh",
    domain: "homelab.local",
  },
};

describe("Proxmox VE Provider", () => {
  describe("Provider Registry", () => {
    it("should resolve proxmox aliases (proxmox, proxmox-ve, pve)", () => {
      const registry = new ProviderRegistry();
      expect(registry.get("proxmox")?.id).toBe("proxmox");
      expect(registry.get("proxmox-ve")?.id).toBe("proxmox");
      expect(registry.get("pve")?.id).toBe("proxmox");
      expect(registry.get("proxmox")?.name).toBe("Proxmox VE");
    });
  });

  describe("Profiles", () => {
    it("should return generic profile", () => {
      const profile = getProxmoxProfile("generic", dhcpHost, baseUrl);
      expect(profile).toBeDefined();
    });

    it("should fallback to generic profile with warning when given unknown profile", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const fallback = getProxmoxProfile("cluster-join", dhcpHost, baseUrl);
      expect(warnSpy).toHaveBeenCalled();
      expect(fallback).toBeDefined();
      warnSpy.mockRestore();
    });
  });

  describe("iPXE rendering", () => {
    it("should boot official PXE files with auto-installer flag", () => {
      const script = renderProxmoxIpxe({
        mac: dhcpHost.mac,
        baseUrl,
        hostConfig: dhcpHost,
        isInstalled: false,
        timeoutSeconds: 5,
      });
      expect(script).toContain("#!ipxe");
      expect(script).toContain("Proxmox VE 9.2");
      expect(script).toContain("pve-01");
      expect(script).toContain(`/assets/proxmox/9.2/vmlinuz`);
      expect(script).toContain("initrd=initrd.img");
      expect(script).toContain("ramdisk_size=16777216");
      expect(script).toContain("proxmox-start-auto-installer");
      expect(script).toContain(`/assets/proxmox/9.2/initrd.img`);
    });
  });

  describe("Answer file rendering", () => {
    it("should render DHCP answer with hashed root password and SSH keys", () => {
      const answer = renderProxmoxAnswer(dhcpHost, baseUrl);
      expect(answer).toContain("[global]");
      expect(answer).toContain('fqdn = "pve-01"');
      expect(answer).toContain("root-password-hashed");
      expect(answer).toContain("$6$rounds=4096$homelab$testhashedvalueexample");
      expect(answer).toContain("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY proxmox@homelab");
      expect(answer).toContain("[network]");
      expect(answer).toContain('source = "from-dhcp"');
      expect(answer).toContain("[disk-setup]");
      expect(answer).toContain('filesystem = "ext4"');
      expect(answer).toContain('disk-list = ["sda"]');
      expect(answer).toContain("[first-boot]");
      expect(answer).toContain('source = "from-url"');
      expect(answer).toContain(`/os/proxmox/${dhcpHost.mac}/first-boot.sh`);
    });

    it("should use kebab-case keys only (PVE 9.x requirement)", () => {
      const answer = renderProxmoxAnswer(staticZfsHost, baseUrl);
      expect(answer).not.toContain("root_password");
      expect(answer).not.toContain("disk_list");
      expect(answer).not.toContain("from_dhcp");
      expect(answer).not.toContain("from_answer");
    });

    it("should render static network with ZFS mirror and FQDN domain", () => {
      const answer = renderProxmoxAnswer(staticZfsHost, baseUrl);
      expect(answer).toContain('fqdn = "pve-02.homelab.local"');
      expect(answer).toContain('timezone = "Asia/Ho_Chi_Minh"');
      expect(answer).toContain('source = "from-answer"');
      expect(answer).toContain('cidr = "192.168.250.41/24"');
      expect(answer).toContain('gateway = "192.168.250.1"');
      expect(answer).toContain('dns = "192.168.250.1"');
      expect(answer).toContain('filesystem = "zfs"');
      expect(answer).toContain('zfs.raid = "raid1"');
    });

    it("should fall back to default root password with warning when no hash configured", () => {
      const answer = renderProxmoxAnswer(staticZfsHost, baseUrl);
      expect(answer).toContain('root-password = "proxmox"');
    });
  });

  describe("First-boot hook rendering", () => {
    it("should render phone-home shell script with curl/wget fallback", () => {
      const script = renderProxmoxFirstBootScript(dhcpHost, baseUrl);
      expect(script.startsWith("#!/bin/sh")).toBe(true);
      expect(script).toContain("/api/installed?mac=bc%3A24%3A11%3A00%3A24%3A40");
      expect(script).toContain("hostname=pve-01");
      expect(script).toContain("os=proxmox");
      expect(script).toContain("command -v curl");
      expect(script).toContain("command -v wget");
    });
  });

  describe("Installer body MAC extraction", () => {
    it("should extract MACs from mac_addresses and network_interfaces payloads", () => {
      expect(
        extractInstallerMacs({ mac_addresses: ["BC:24:11:00:24:40", "not-a-mac"] })
      ).toEqual(["bc:24:11:00:24:40"]);
      expect(
        extractInstallerMacs({
          network_interfaces: [{ mac: "BC:24:11:00:24:41" }, { mac_address: "00:11:22:33:44:55" }],
        })
      ).toEqual(["bc:24:11:00:24:41", "00:11:22:33:44:55"]);
      expect(extractInstallerMacs({})).toEqual([]);
      expect(extractInstallerMacs(null)).toEqual([]);
    });
  });

  describe("HTTP routes", () => {
    const testMac = "bc:24:11:00:24:49";

    beforeAll(async () => {
      await fetch(`${baseUrl}/api/hosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mac: testMac,
          hostname: "pve-http-test",
          os: "proxmox",
          version: "9.2",
          profile: "generic",
          ip: "192.168.250.49",
          gateway: "192.168.250.1",
          target_disk: "/dev/sda",
          note: "Proxmox HTTP route test node",
        }),
      });
    });

    afterAll(async () => {
      await fetch(`${baseUrl}/api/hosts/${testMac}`, { method: "DELETE" });
      // Clean up auto-registered fallback node from unknown-MAC answer test
      await fetch(`${baseUrl}/api/hosts/aa:bb:cc:dd:ee:ff`, { method: "DELETE" });
    });

    it("GET /boot.ipxe for Proxmox node should return auto-installer script", async () => {
      const res = await fetch(`${baseUrl}/boot.ipxe?mac=${testMac}&force=true`);
      expect(res.status).toBe(200);
      const script = await res.text();
      expect(script).toContain("#!ipxe");
      expect(script).toContain("Proxmox VE 9.2");
      expect(script).toContain("proxmox-start-auto-installer");
      expect(script).toContain("initrd=initrd.img");
    });

    it("GET per-MAC answer.toml should return static-network answer", async () => {
      const res = await fetch(`${baseUrl}/os/proxmox/${testMac}/answer.toml`);
      expect(res.status).toBe(200);
      const answer = await res.text();
      expect(answer).toContain('fqdn = "pve-http-test"');
      expect(answer).toContain('source = "from-answer"');
      expect(answer).toContain('cidr = "192.168.250.49/24"');
      expect(answer).toContain("[first-boot]");
    });

    it("GET per-MAC first-boot.sh should return phone-home hook", async () => {
      const res = await fetch(`${baseUrl}/os/proxmox/${testMac}/first-boot.sh`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/x-shellscript");
      const script = await res.text();
      expect(script.startsWith("#!/bin/sh")).toBe(true);
      expect(script).toContain("/api/installed");
      expect(script).toContain("os=proxmox");
    });

    it("POST shared /os/proxmox/answer should match host by installer MACs", async () => {
      const res = await fetch(`${baseUrl}/os/proxmox/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac_addresses: [testMac.toUpperCase(), "00:11:22:33:44:55"] }),
      });
      expect(res.status).toBe(200);
      const answer = await res.text();
      expect(answer).toContain('fqdn = "pve-http-test"');
      expect(answer).toContain('cidr = "192.168.250.49/24"');

      const hostRes = await fetch(`${baseUrl}/api/hosts/${testMac}`);
      const host = (await hostRes.json()) as any;
      expect(host.status).toBe("PROVISIONING");
    });

    it("GET shared /os/proxmox/answer?mac= should honor explicit override", async () => {
      const res = await fetch(`${baseUrl}/os/proxmox/answer?mac=${testMac}`);
      expect(res.status).toBe(200);
      const answer = await res.text();
      expect(answer).toContain('fqdn = "pve-http-test"');
    });

    it("POST shared /os/proxmox/answer with unknown MAC should fall back to default", async () => {
      const res = await fetch(`${baseUrl}/os/proxmox/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac_addresses: ["aa:bb:cc:dd:ee:ff"] }),
      });
      expect(res.status).toBe(200);
      const answer = await res.text();
      expect(answer).toContain("[global]");
      expect(answer).toContain("homelab-");
    });

    it("GET unknown per-MAC subpath should return 404", async () => {
      const res = await fetch(`${baseUrl}/os/proxmox/${testMac}/nope`);
      expect(res.status).toBe(404);
    });
  });
});
