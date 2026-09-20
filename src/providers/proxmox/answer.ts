import type { HostConfig } from "../../types.ts";
import { PROXMOX_DEFAULT_VERSION } from "./ipxe.ts";

function escapeTomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function netmaskToCidr(mask?: string): number {
  if (!mask) return 24;
  return mask
    .split(".")
    .map(Number)
    .map((n) => n.toString(2).replace(/0/g, "").length)
    .reduce((a, b) => a + b, 0);
}

function normalizeMac(mac: string): string {
  return (mac || "").trim().toLowerCase().replace(/[-]/g, ":").replace(/^0x/, "");
}

function diskBasename(targetDisk?: string): string {
  if (!targetDisk) return "sda";
  const base = targetDisk.trim().split("/").pop() || "sda";
  return base || "sda";
}

/**
 * Extract candidate MAC addresses from a Proxmox auto-installer answer
 * request body. The installer POSTs system-info JSON which carries MACs
 * either as a top-level `mac_addresses` array or per-NIC objects under
 * `network_interfaces`.
 */
export function extractInstallerMacs(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const found: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value !== "string") return;
    const mac = normalizeMac(value);
    if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) && !found.includes(mac)) {
      found.push(mac);
    }
  };

  const record = body as Record<string, unknown>;
  if (Array.isArray(record.mac_addresses)) {
    for (const entry of record.mac_addresses) push(entry);
  }
  for (const key of ["network_interfaces", "interfaces", "nics"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      for (const nic of list) {
        if (typeof nic === "string") {
          push(nic);
          continue;
        }
        if (nic && typeof nic === "object") {
          const nicRecord = nic as Record<string, unknown>;
          push(nicRecord.mac);
          push(nicRecord.mac_address);
          push(nicRecord["mac-address"]);
        }
      }
    }
  }
  if (typeof record.mac === "string") push(record.mac);

  return found;
}

export function renderProxmoxAnswer(host: HostConfig, baseUrl: string): string {
  const custom = host.custom || {};
  const keyboard = custom.keyboard || "en-us";
  const country = custom.country || "us";
  const domain = (custom.domain || "").toString().trim();
  const fqdn = domain ? `${host.hostname}.${domain}` : host.hostname;
  const mailto = custom.mailto || "admin@example.com";
  const timezone = custom.timezone || "UTC";

  const lines: string[] = [];
  lines.push(`# Proxmox VE ${host.version || PROXMOX_DEFAULT_VERSION} automated-install answer for ${host.hostname} (${host.mac})`);
  lines.push(`# Served by lab-ipxe-os. Validate with: proxmox-auto-install-assistant validate-answer answer.toml`);
  lines.push(``);
  lines.push(`[global]`);
  lines.push(`keyboard = ${escapeTomlString(keyboard)}`);
  lines.push(`country = ${escapeTomlString(country)}`);
  lines.push(`fqdn = ${escapeTomlString(fqdn)}`);
  lines.push(`mailto = ${escapeTomlString(mailto)}`);
  lines.push(`timezone = ${escapeTomlString(timezone)}`);

  if (host.password_hash) {
    lines.push(`root-password-hashed = ${escapeTomlString(host.password_hash)}`);
  } else if (custom.root_password) {
    lines.push(`# WARNING: plain-text root password from host custom.root_password - prefer password_hash`);
    lines.push(`root-password = ${escapeTomlString(String(custom.root_password))}`);
  } else {
    lines.push(`# WARNING: no password_hash configured - default root password "proxmox". Override via password_hash!`);
    lines.push(`root-password = "proxmox"`);
  }

  const sshKeys = host.ssh_authorized_keys || [];
  if (sshKeys.length > 0) {
    lines.push(`root-ssh-keys = [`);
    for (const key of sshKeys) {
      lines.push(`    ${escapeTomlString(key)},`);
    }
    lines.push(`]`);
  }

  if (custom.reboot_mode) {
    lines.push(`reboot-mode = ${escapeTomlString(String(custom.reboot_mode))}`);
  }

  lines.push(``);
  lines.push(`[network]`);
  if (host.network && host.network.dhcp === false && host.network.ip) {
    const cidr = netmaskToCidr(host.network.netmask);
    lines.push(`source = "from-answer"`);
    lines.push(`cidr = ${escapeTomlString(`${host.network.ip}/${cidr}`)}`);
    if (host.network.gateway) {
      lines.push(`gateway = ${escapeTomlString(host.network.gateway)}`);
    }
    const dns = host.network.nameservers?.[0] || host.network.gateway || "1.1.1.1";
    lines.push(`dns = ${escapeTomlString(dns)}`);
  } else {
    lines.push(`source = "from-dhcp"`);
  }

  lines.push(``);
  lines.push(`[disk-setup]`);
  const allowedFilesystems = ["ext4", "xfs", "zfs", "btrfs"];
  const filesystem = allowedFilesystems.includes(String(custom.filesystem || "").toLowerCase())
    ? String(custom.filesystem).toLowerCase()
    : "ext4";
  if (custom.filesystem && filesystem !== String(custom.filesystem).toLowerCase()) {
    console.warn(`[Proxmox VE Answer] Unsupported filesystem "${custom.filesystem}", falling back to "ext4".`);
  }
  lines.push(`filesystem = ${escapeTomlString(filesystem)}`);
  lines.push(`disk-list = [${escapeTomlString(diskBasename(host.storage?.target_disk))}]`);
  if (filesystem === "zfs") {
    lines.push(`zfs.raid = ${escapeTomlString(String(custom.zfs_raid || "raid0"))}`);
    if (custom.zfs_hdsize !== undefined) {
      lines.push(`zfs.hdsize = ${Number(custom.zfs_hdsize)}`);
    }
  }
  if ((filesystem === "ext4" || filesystem === "xfs") && custom.lvm_swapsize !== undefined) {
    lines.push(`lvm.swapsize = ${Number(custom.lvm_swapsize)}`);
  }
  if (filesystem === "btrfs" && custom.btrfs_raid) {
    lines.push(`btrfs.raid = ${escapeTomlString(String(custom.btrfs_raid))}`);
  }

  lines.push(``);
  lines.push(`[first-boot]`);
  lines.push(`source = "from-url"`);
  lines.push(`ordering = ${escapeTomlString(String(custom.first_boot_ordering || "network-online"))}`);
  lines.push(`url = ${escapeTomlString(`${baseUrl}/os/proxmox/${host.mac}/first-boot.sh`)}`);

  lines.push(``);
  return lines.join("\n");
}

export function renderProxmoxFirstBootScript(host: HostConfig, baseUrl: string): string {
  const custom = host.custom || {};
  const rawUrl = `${baseUrl}/api/installed?mac=${encodeURIComponent(host.mac)}&hostname=${encodeURIComponent(host.hostname)}&os=proxmox`;
  const phoneHomeUrl = `'${rawUrl.replace(/'/g, `'\\''`)}'`;
  const extra = typeof custom.first_boot_extra === "string" && custom.first_boot_extra.trim()
    ? `\n# Operator-supplied first-boot extra (custom.first_boot_extra)\n${custom.first_boot_extra.trim()}\n`
    : "";

  return `#!/bin/sh
# Proxmox VE first-boot hook for ${host.hostname} (${host.mac})
# Fetched from lab-ipxe-os. Reports back so the node flips to INSTALLED.
set -eu

PHONE_HOME_URL=${phoneHomeUrl}

if command -v curl >/dev/null 2>&1; then
  curl -s --connect-timeout 5 --max-time 15 -X POST "$PHONE_HOME_URL" || true
elif command -v wget >/dev/null 2>&1; then
  wget -q -O /dev/null "$PHONE_HOME_URL" || true
fi
${extra}exit 0
`;
}
