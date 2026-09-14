import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

interface AssetSpec {
  os: string;
  version: string;
  files: {
    name: string;
    description: string;
    downloadUrl?: string;
    required: boolean;
  }[];
}

const ASSET_SPECS: AssetSpec[] = [
  {
    os: "ubuntu",
    version: "24.04",
    files: [
      {
        name: "vmlinuz",
        description: "Ubuntu 24.04 Kernel",
        downloadUrl:
          "https://releases.ubuntu.com/24.04/netboot/amd64/linux",
        required: true,
      },
      {
        name: "initrd",
        description: "Ubuntu 24.04 Initrd",
        downloadUrl:
          "https://releases.ubuntu.com/24.04/netboot/amd64/initrd",
        required: true,
      },
      {
        name: "ubuntu-24.04-live-server-amd64.iso",
        description: "Ubuntu 24.04 Live Server ISO (Subiquity rootfs)",
        downloadUrl:
          "https://releases.ubuntu.com/noble/ubuntu-24.04.1-live-server-amd64.iso",
        required: true,
      },
    ],
  },
  {
    os: "talos",
    version: "v1.14.0",
    files: [
      {
        name: "vmlinuz-amd64",
        description: "Talos Linux Kernel",
        downloadUrl:
          "https://github.com/siderolabs/talos/releases/download/v1.14.0/vmlinuz-amd64",
        required: true,
      },
      {
        name: "initramfs-amd64.xz",
        description: "Talos Linux Initramfs",
        downloadUrl:
          "https://github.com/siderolabs/talos/releases/download/v1.14.0/initramfs-amd64.xz",
        required: true,
      },
    ],
  },
  {
    os: "suse-micro",
    version: "6.2",
    files: [
      {
        name: "vmlinuz",
        description: "openSUSE Leap Micro 6.2 Kernel",
        required: true,
      },
      {
        name: "initrd",
        description: "openSUSE Leap Micro 6.2 Initrd",
        required: true,
      },
      {
        name: "openSUSE-Leap-Micro.x86_64-6.2-Default-SelfInstall.iso",
        description: "openSUSE Leap Micro 6.2 SelfInstall ISO",
        downloadUrl:
          "https://download.opensuse.org/distribution/leap-micro/6.2/product/iso/openSUSE-Leap-Micro.x86_64-6.2-Default-SelfInstall.iso",
        required: false,
      },
    ],
  },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`Downloading from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  await Bun.write(destPath, arrayBuffer);
  console.log(`Saved to ${destPath} (${formatBytes(arrayBuffer.byteLength)})`);
}

async function main() {
  const args = process.argv.slice(2);
  const shouldDownload = args.includes("--download");
  const targetOs = args.find((a) => !a.startsWith("-"));

  console.log(`=== Multi-OS Assets Status Check ===\n`);

  for (const spec of ASSET_SPECS) {
    if (targetOs && spec.os.toLowerCase() !== targetOs.toLowerCase()) {
      continue;
    }

    const dir = resolve(process.cwd(), "assets", spec.os, spec.version);
    mkdirSync(dir, { recursive: true });

    console.log(`\n📁 [${spec.os.toUpperCase()} ${spec.version}] Directory: ${dir}`);

    for (const file of spec.files) {
      const filePath = join(dir, file.name);
      const exists = existsSync(filePath);

      if (exists) {
        const stat = statSync(filePath);
        console.log(`  ✅ ${file.name} (${formatBytes(stat.size)}) - ${file.description}`);
      } else {
        console.log(`  ❌ ${file.name} (MISSING) - ${file.description}`);
        if (file.downloadUrl) {
          console.log(`     Mirror URL: ${file.downloadUrl}`);
          if (shouldDownload) {
            try {
              await downloadFile(file.downloadUrl, filePath);
            } catch (err: any) {
              console.error(`     Download failed: ${err.message}`);
            }
          }
        }
      }
    }
  }

  if (!shouldDownload) {
    console.log(`
Tip: Run with '--download' to automatically download available netboot files:
     bun run sync-assets --download
     bun run sync-assets talos --download
`);
  }
}

main().catch(console.error);
