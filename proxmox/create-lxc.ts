import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface LxcConfig {
  vmid: number;
  hostname: string;
  template: string;
  cores: number;
  memory: number;
  swap: number;
  diskSize: number;
  ip: string;
  gateway: string;
  bridge: string;
  storage: string;
  password?: string;
  sshKey?: string;
}

export interface PveCredentials {
  host: string;
  node: string;
  tokenId: string;
  tokenSecret: string;
  bridge: string;
  storage: string;
  insecure: boolean;
}

export function loadCredentials(): PveCredentials {
  const envPath = resolve(process.cwd(), "proxmox", "credentials.env");
  const envVars: Record<string, string> = {};

  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...valParts] = trimmed.split("=");
        let val = valParts.join("=").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        envVars[key.trim()] = val;
      }
    }
  }

  const host = envVars.PVE_HOST || process.env.PVE_HOST || "https://127.0.0.1:8006";
  const node = envVars.PVE_NODE || process.env.PVE_NODE || "pve";
  const tokenId = envVars.PVE_TOKEN_ID || process.env.PVE_TOKEN_ID || "";
  const tokenSecret = envVars.PVE_TOKEN_SECRET || process.env.PVE_TOKEN_SECRET || "";
  const bridge = envVars.PVE_BRIDGE || process.env.PVE_BRIDGE || "vmbr0";
  const storage = envVars.PVE_STORAGE || process.env.PVE_STORAGE || "local-lvm";
  const insecure = (envVars.PVE_INSECURE || process.env.PVE_INSECURE || "true") === "true";

  if (!tokenId || !tokenSecret) {
    console.warn(`
[!] Warning: Proxmox credentials missing or incomplete.
    Please check 'proxmox/credentials.env'.
`);
  }

  return { host, node, tokenId, tokenSecret, bridge, storage, insecure };
}

export async function pveRequest(
  creds: PveCredentials,
  endpoint: string,
  method: string = "GET",
  body?: Record<string, any>
): Promise<any> {
  const url = `${creds.host.replace(/\/+$/, "")}/api2/json/${endpoint.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = {
    Authorization: `PVEAPIToken=${creds.tokenId}=${creds.tokenSecret}`,
  };

  let reqBody: string | undefined;
  if (body) {
    headers["Content-Type"] = "application/json";
    reqBody = JSON.stringify(body);
  }

  if (creds.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: reqBody,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PVE API Error (${res.status} ${res.statusText}): ${errorText}`);
  }

  const data = (await res.json()) as any;
  return data.data;
}

export async function waitForTask(
  creds: PveCredentials,
  upid: string,
  timeoutMs: number = 120000
): Promise<void> {
  const start = Date.now();
  process.stdout.write(`[PVE] Waiting for task completion... `);
  while (Date.now() - start < timeoutMs) {
    const task = await pveRequest(
      creds,
      `nodes/${creds.node}/tasks/${encodeURIComponent(upid)}/status`
    );
    if (task.status === "stopped") {
      if (task.exitstatus === "OK") {
        console.log("Done (OK).");
        return;
      }
      console.log(`Failed! (${task.exitstatus})`);
      throw new Error(`PVE Task ${upid} failed with exit status: ${task.exitstatus}`);
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timeout waiting for task ${upid}`);
}

export async function checkLxcExists(creds: PveCredentials, vmid: number): Promise<boolean> {
  try {
    await pveRequest(creds, `nodes/${creds.node}/lxc/${vmid}/status/current`);
    return true;
  } catch {
    return false;
  }
}

export async function stopAndDeleteLxc(creds: PveCredentials, vmid: number): Promise<void> {
  console.log(`[PVE] Checking status of LXC ${vmid}...`);
  try {
    const status = await pveRequest(creds, `nodes/${creds.node}/lxc/${vmid}/status/current`);
    if (status.status === "running") {
      console.log(`[PVE] Stopping LXC ${vmid}...`);
      const stopUpid = await pveRequest(creds, `nodes/${creds.node}/lxc/${vmid}/status/stop`, "POST");
      if (typeof stopUpid === "string") {
        await waitForTask(creds, stopUpid, 30000);
      } else {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } catch {}

  console.log(`[PVE] Destroying LXC ${vmid}...`);
  try {
    const deleteUpid = await pveRequest(creds, `nodes/${creds.node}/lxc/${vmid}?purge=1`, "DELETE");
    if (typeof deleteUpid === "string") {
      await waitForTask(creds, deleteUpid, 30000);
    } else {
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err: any) {
    console.warn(`[PVE] Delete warning:`, err.message);
  }
}

export async function createLxc(
  creds: PveCredentials,
  cfg: LxcConfig,
  options: { start?: boolean; recreate?: boolean } = {}
): Promise<void> {
  const exists = await checkLxcExists(creds, cfg.vmid);
  if (exists) {
    if (options.recreate) {
      console.log(`[PVE] LXC ${cfg.vmid} (${cfg.hostname}) exists. Recreating...`);
      await stopAndDeleteLxc(creds, cfg.vmid);
    } else {
      console.log(`[PVE] LXC ${cfg.vmid} (${cfg.hostname}) already exists.`);
      if (options.start) {
        const current = await pveRequest(creds, `nodes/${creds.node}/lxc/${cfg.vmid}/status/current`);
        if (current.status !== "running") {
          console.log(`[PVE] Starting LXC ${cfg.vmid}...`);
          const upid = await pveRequest(creds, `nodes/${creds.node}/lxc/${cfg.vmid}/status/start`, "POST");
          if (typeof upid === "string") await waitForTask(creds, upid);
        }
      }
      return;
    }
  }

  console.log(`[PVE] Creating LXC ${cfg.vmid} (${cfg.hostname}) on node ${creds.node}...`);
  console.log(`      IP: ${cfg.ip} | GW: ${cfg.gateway} | CPU: ${cfg.cores} | RAM: ${cfg.memory}MB | Disk: ${cfg.diskSize}GB`);

  const payload: Record<string, any> = {
    vmid: cfg.vmid,
    hostname: cfg.hostname,
    ostemplate: cfg.template,
    cores: cfg.cores,
    memory: cfg.memory,
    swap: cfg.swap,
    rootfs: `${cfg.storage}:${cfg.diskSize}`,
    net0: `name=eth0,bridge=${cfg.bridge},ip=${cfg.ip},gw=${cfg.gateway},firewall=0`,
    nameserver: cfg.gateway,
    features: "nesting=1",
    unprivileged: 1,
    onboot: 1,
  };

  if (cfg.password) {
    payload.password = cfg.password;
  }

  if (cfg.sshKey) {
    payload["ssh-public-keys"] = cfg.sshKey;
  }

  const upid = await pveRequest(creds, `nodes/${creds.node}/lxc`, "POST", payload);
  if (typeof upid === "string") {
    await waitForTask(creds, upid, 120000);
  }
  console.log(`[PVE] Created LXC ${cfg.vmid} successfully.`);

  if (options.start) {
    console.log(`[PVE] Starting LXC ${cfg.vmid}...`);
    const startUpid = await pveRequest(creds, `nodes/${creds.node}/lxc/${cfg.vmid}/status/start`, "POST");
    if (typeof startUpid === "string") {
      await waitForTask(creds, startUpid, 30000);
    }
    console.log(`[PVE] LXC ${cfg.vmid} is now running!`);
  }
}

function getDefaultSshKey(): string {
  const possibleKeys = [
    resolve(homedir(), ".ssh", "id_ed25519.pub"),
    resolve(homedir(), ".ssh", "id_rsa.pub"),
  ];
  for (const p of possibleKeys) {
    if (existsSync(p)) {
      return readFileSync(p, "utf-8").trim();
    }
  }
  return "";
}

async function main() {
  const args = process.argv.slice(2);
  const creds = loadCredentials();

  const shouldStart = args.includes("--start") || !args.includes("--no-start");
  const shouldRecreate = args.includes("--recreate");

  if (args.includes("--destroy")) {
    const vmidToDestroy = 9100;
    await stopAndDeleteLxc(creds, vmidToDestroy);
    console.log(`[PVE] LXC ${vmidToDestroy} destroyed.`);
    return;
  }

  const sshKey = getDefaultSshKey();
  if (sshKey) {
    console.log(`[Auth] Loaded SSH public key from local system.`);
  }

  const lxcConfig: LxcConfig = {
    vmid: 9100,
    hostname: "ipxe-server",
    template: "local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst",
    cores: 1,
    memory: 1024,
    swap: 512,
    diskSize: 20,
    ip: "192.168.250.11/24",
    gateway: "192.168.250.1",
    bridge: creds.bridge || "vmbr0",
    storage: creds.storage || "local-lvm",
    password: "PxeLab@2026!",
    sshKey: sshKey,
  };

  await createLxc(creds, lxcConfig, { start: shouldStart, recreate: shouldRecreate });
  console.log(`\nLXC ${lxcConfig.vmid} setup complete!`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`\n[Fatal Error]:`, err.message || err);
    process.exit(1);
  });
}
