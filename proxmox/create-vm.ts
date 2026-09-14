import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

interface TestVM {
  vmid: number;
  name: string;
  os: string;
  mac: string;
  cores: number;
  memory: number;
  disk_size: number;
  bios?: "ovmf" | "seabios";
}

interface PveCredentials {
  host: string;
  node: string;
  tokenId: string;
  tokenSecret: string;
  bridge: string;
  storage: string;
  insecure: boolean;
}

function loadCredentials(): PveCredentials {
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
    Please copy 'proxmox/credentials.env.example' to 'proxmox/credentials.env'
    and provide your PVE_HOST, PVE_TOKEN_ID, and PVE_TOKEN_SECRET.
`);
  }

  return { host, node, tokenId, tokenSecret, bridge, storage, insecure };
}

async function pveRequest(
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

  // Handle self-signed certs
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

  const data = await res.json();
  return (data as any).data;
}

async function checkVmExists(creds: PveCredentials, vmid: number): Promise<boolean> {
  try {
    await pveRequest(creds, `nodes/${creds.node}/qemu/${vmid}/status/current`);
    return true;
  } catch {
    return false;
  }
}

async function stopAndDeleteVm(creds: PveCredentials, vmid: number): Promise<void> {
  console.log(`[PVE] Stopping VM ${vmid}...`);
  try {
    await pveRequest(creds, `nodes/${creds.node}/qemu/${vmid}/status/stop`, "POST");
    await new Promise((r) => setTimeout(r, 2000));
  } catch {}

  console.log(`[PVE] Destroying VM ${vmid}...`);
  await pveRequest(creds, `nodes/${creds.node}/qemu/${vmid}`, "DELETE");
  await new Promise((r) => setTimeout(r, 1500));
}

async function createVm(
  creds: PveCredentials,
  vm: TestVM,
  options: { start?: boolean; recreate?: boolean } = {}
): Promise<void> {
  const exists = await checkVmExists(creds, vm.vmid);
  if (exists) {
    if (options.recreate) {
      console.log(`[PVE] VM ${vm.vmid} (${vm.name}) exists. Recreating...`);
      await stopAndDeleteVm(creds, vm.vmid);
    } else {
      console.log(`[PVE] VM ${vm.vmid} (${vm.name}) already exists. Skipping (use --recreate to overwrite).`);
      if (options.start) {
        console.log(`[PVE] Starting existing VM ${vm.vmid}...`);
        await pveRequest(creds, `nodes/${creds.node}/qemu/${vm.vmid}/status/start`, "POST");
      }
      return;
    }
  }

  console.log(`[PVE] Creating VM ${vm.vmid} (${vm.name}) with MAC ${vm.mac}...`);

  const bios = vm.bios || "ovmf";
  const nicModel = bios === "ovmf" ? "e1000" : "virtio";
  const payload: Record<string, any> = {
    vmid: vm.vmid,
    name: vm.name,
    cores: vm.cores,
    memory: vm.memory,
    bios: bios,
    machine: "q35",
    scsihw: "virtio-scsi-pci",
    scsi0: `${creds.storage}:${vm.disk_size},discard=on,ssd=1`,
    net0: `${nicModel}=${vm.mac},bridge=${creds.bridge},firewall=0`,
    boot: "order=net0;scsi0", // PXE network boot first, then local disk
    agent: 1,
    ostype: "l26",
    rng0: "source=/dev/urandom",
  };

  if (bios === "ovmf") {
    payload.efidisk0 = `${creds.storage}:1,efitype=4m,pre-enrolled-keys=0`;
  }

  await pveRequest(creds, `nodes/${creds.node}/qemu`, "POST", payload);
  console.log(`[PVE] Created VM ${vm.vmid} successfully.`);

  if (options.start) {
    console.log(`[PVE] Waiting for VM initialization...`);
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`[PVE] Booting VM ${vm.vmid} into PXE...`);
    await pveRequest(creds, `nodes/${creds.node}/qemu/${vm.vmid}/status/start`, "POST");
    console.log(`[PVE] VM ${vm.vmid} is now running and booting via network!`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const creds = loadCredentials();

  const testVmsPath = resolve(process.cwd(), "proxmox", "test-vms.yaml");
  if (!existsSync(testVmsPath)) {
    console.error(`[!] Missing test VMs definition at: ${testVmsPath}`);
    process.exit(1);
  }

  const rawYaml = readFileSync(testVmsPath, "utf-8");
  const parsed = YAML.parse(rawYaml) as { vms: TestVM[] };
  const vms = parsed.vms || [];

  const shouldStart = args.includes("--start");
  const shouldRecreate = args.includes("--recreate");

  // Check destroy command: --destroy <vmid>
  const destroyIndex = args.indexOf("--destroy");
  if (destroyIndex !== -1 && args[destroyIndex + 1]) {
    const vmidToDestroy = parseInt(args[destroyIndex + 1], 10);
    await stopAndDeleteVm(creds, vmidToDestroy);
    console.log(`[PVE] VM ${vmidToDestroy} destroyed.`);
    return;
  }

  // Filter by OS: --os <os>
  const osIndex = args.indexOf("--os");
  const targetOs = osIndex !== -1 ? args[osIndex + 1] : undefined;

  // Filter by VMID: --vmid <id>
  const vmidIndex = args.indexOf("--vmid");
  const targetVmid = vmidIndex !== -1 ? parseInt(args[vmidIndex + 1], 10) : undefined;

  let filteredVms = vms;
  if (targetVmid) {
    filteredVms = vms.filter((v) => v.vmid === targetVmid);
  } else if (targetOs) {
    filteredVms = vms.filter((v) => v.os.toLowerCase() === targetOs.toLowerCase());
  } else if (!args.includes("--all")) {
    console.log(`
Usage:
  bun run proxmox/create-vm.ts --all                 # Create all defined test VMs
  bun run proxmox/create-vm.ts --os ubuntu           # Create test VM for Ubuntu
  bun run proxmox/create-vm.ts --os talos            # Create test VM for Talos
  bun run proxmox/create-vm.ts --os suse-micro       # Create test VM for openSUSE Micro
  bun run proxmox/create-vm.ts --vmid 9001           # Create specific VM by ID
  bun run proxmox/create-vm.ts --vmid 9001 --start   # Create and boot VM immediately
  bun run proxmox/create-vm.ts --destroy 9001        # Stop and remove test VM
  bun run proxmox/create-vm.ts --all --recreate      # Force wipe and recreate all
`);
    return;
  }

  if (filteredVms.length === 0) {
    console.log(`No test VMs matched the criteria.`);
    return;
  }

  console.log(`Processing ${filteredVms.length} VM(s) on Proxmox node '${creds.node}'...`);
  for (const vm of filteredVms) {
    await createVm(creds, vm, { start: shouldStart, recreate: shouldRecreate });
  }

  console.log(`\nAll operations completed!`);
}

main().catch((err) => {
  console.error(`\n[Fatal Error]:`, err.message || err);
  process.exit(1);
});
