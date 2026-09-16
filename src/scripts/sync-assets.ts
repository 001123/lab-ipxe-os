import { existsSync, mkdirSync, statSync, renameSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

interface AssetSpec {
  os: string;
  version: string;
  files: {
    name: string;
    description: string;
    downloadUrl?: string;
    required: boolean;
    extractedFromIso?: {
      sourceFile: string;
      hweSourceFile?: string;
    };
  }[];
}

const ASSET_SPECS: AssetSpec[] = [
  {
    os: "ubuntu",
    version: "24.04",
    files: [
      {
        name: "ubuntu-24.04-live-server-amd64.iso",
        description: "Ubuntu 24.04 Live Server ISO (Single Source of Truth)",
        downloadUrl:
          "https://releases.ubuntu.com/noble/ubuntu-24.04.3-live-server-amd64.iso",
        required: true,
      },
      {
        name: "vmlinuz",
        description: "Ubuntu 24.04 Kernel (Extracted from ISO casper)",
        required: true,
        extractedFromIso: {
          sourceFile: "casper/vmlinuz",
          hweSourceFile: "casper/hwe-vmlinuz",
        },
      },
      {
        name: "initrd",
        description: "Ubuntu 24.04 Initrd (Extracted from ISO casper)",
        required: true,
        extractedFromIso: {
          sourceFile: "casper/initrd",
          hweSourceFile: "casper/hwe-initrd",
        },
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
        name: "openSUSE-Leap-Micro.x86_64-Default-SelfInstall.install.tar",
        description: "openSUSE Leap Micro 6.2 PXE SelfInstall Archive (Single Source of Truth)",
        downloadUrl:
          "https://download.opensuse.org/distribution/leap-micro/6.2/appliances/openSUSE-Leap-Micro.x86_64-Default-SelfInstall.install.tar",
        required: true,
      },
      {
        name: "vmlinuz",
        description: "openSUSE Leap Micro 6.2 Kernel (Extracted from openSUSE-Leap-Micro.x86_64-6.2.kernel)",
        required: true,
        extractedFromIso: {
          sourceFile: "openSUSE-Leap-Micro.x86_64-6.2.kernel",
        },
      },
      {
        name: "initrd",
        description: "openSUSE Leap Micro 6.2 Initrd (Extracted from openSUSE-Leap-Micro.x86_64-6.2.initrd)",
        required: true,
        extractedFromIso: {
          sourceFile: "openSUSE-Leap-Micro.x86_64-6.2.initrd",
        },
      },
      {
        name: "openSUSE-Leap-Micro.x86_64-6.2.xz",
        description: "openSUSE Leap Micro 6.2 Target OS Image for Kiwi PXE",
        required: true,
        extractedFromIso: {
          sourceFile: "openSUSE-Leap-Micro.x86_64-6.2.xz",
        },
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

function extractFromIso(isoPath: string, internalPath: string, destPath: string): boolean {
  try {
    const destDir = resolve(destPath, "..");
    const res = spawnSync("bsdtar", ["-xf", isoPath, "-C", destDir, internalPath]);
    if (res.status === 0) {
      const extractedPath = join(destDir, internalPath);
      if (existsSync(extractedPath)) {
        renameSync(extractedPath, destPath);
        const topDir = internalPath.split("/")[0];
        const dirToRemove = join(destDir, topDir);
        if (existsSync(dirToRemove) && dirToRemove !== destDir) {
          rmSync(dirToRemove, { recursive: true, force: true });
        }
        return true;
      }
    }

    // Fallback using 7z if bsdtar is not installed or failed
    try {
      const res7z = spawnSync("7z", ["e", "-y", `-o${destDir}`, isoPath, internalPath]);
      if (res7z.status === 0 && existsSync(destPath)) {
        return true;
      }
    } catch {}

    return false;
  } catch (err: any) {
    console.error(`     Extraction failed for ${internalPath}:`, err.message);
    return false;
  }
}

function getKernelInfo(filePath: string): string {
  try {
    const res = spawnSync("file", [filePath]);
    if (res.status === 0 && res.stdout) {
      const match = res.stdout.toString().match(/version ([0-9]+(\.[0-9]+)+-[0-9]+-[a-z0-9]+)/);
      if (match) return `[Linux ${match[1]}]`;
    }
  } catch {}
  return "";
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const parentDir = resolve(destPath, "..");
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  console.log(`     Downloading from ${url}...`);
  let downloaded = false;
  try {
    const res = spawnSync("curl", ["-#", "-fL", "--retry", "3", "--connect-timeout", "30", "-o", destPath, url], {
      stdio: "inherit",
    });
    if (res.status === 0 && existsSync(destPath)) {
      downloaded = true;
    }
  } catch {}

  if (!downloaded) {
    console.log(`     (Fallback: streaming download via native fetch...)`);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to download ${url} (HTTP ${resp.status} ${resp.statusText})`);
    }
    await Bun.write(destPath, resp);
  }

  const stat = statSync(destPath);
  console.log(`     Saved to ${destPath} (${formatBytes(stat.size)})`);
}

export function getMissingAssetsCount(assetsDir?: string, targetOs?: string): { missing: number; total: number; missingFiles: string[] } {
  const baseDir = assetsDir || process.env.ASSETS_DIR || resolve(process.cwd(), "assets");
  let missing = 0;
  let total = 0;
  const missingFiles: string[] = [];

  for (const spec of ASSET_SPECS) {
    if (targetOs && spec.os.toLowerCase() !== targetOs.toLowerCase()) {
      continue;
    }
    const dir = resolve(baseDir, spec.os, spec.version);
    for (const file of spec.files) {
      if (!file.required) continue;
      total++;
      const filePath = join(dir, file.name);
      if (!existsSync(filePath)) {
        missing++;
        missingFiles.push(`${spec.os}/${spec.version}/${file.name}`);
      }
    }
  }

  return { missing, total, missingFiles };
}

export interface OsAssetSummary {
  os: string;
  version: string;
  ready: boolean;
  missingCount: number;
  totalCount: number;
  files: { name: string; required: boolean; exists: boolean; size?: number }[];
}

export function getAssetsStatusSummary(assetsDir?: string): Record<string, OsAssetSummary> {
  const baseDir = assetsDir || process.env.ASSETS_DIR || resolve(process.cwd(), "assets");
  const result: Record<string, OsAssetSummary> = {};

  for (const spec of ASSET_SPECS) {
    const dir = resolve(baseDir, spec.os, spec.version);
    let missingCount = 0;
    let totalCount = 0;
    const fileList: { name: string; required: boolean; exists: boolean; size?: number }[] = [];

    for (const file of spec.files) {
      if (!file.required) continue;
      totalCount++;
      const filePath = join(dir, file.name);
      const exists = existsSync(filePath);
      let size: number | undefined;
      if (exists) {
        try {
          size = statSync(filePath).size;
        } catch {}
      } else {
        missingCount++;
      }
      fileList.push({
        name: file.name,
        required: file.required,
        exists,
        size,
      });
    }

    result[spec.os] = {
      os: spec.os,
      version: spec.version,
      ready: missingCount === 0,
      missingCount,
      totalCount,
      files: fileList,
    };
  }

  return result;
}

export async function runSyncAssets(customArgs?: string[], customAssetsDir?: string) {
  const args = customArgs || process.argv.slice(2);
  const shouldDownload = args.includes("--download");
  const forceExtract = args.includes("--extract");
  const useHwe = args.includes("--hwe");
  const targetOs = args.find((a) => !a.startsWith("-"));
  const baseDir = customAssetsDir || process.env.ASSETS_DIR || resolve(process.cwd(), "assets");

  console.log(`=== Multi-OS Assets Status & Sync ===\n`);
  console.log(`Base Assets Directory: ${baseDir}`);

  for (const spec of ASSET_SPECS) {
    if (targetOs && spec.os.toLowerCase() !== targetOs.toLowerCase()) {
      continue;
    }

    const dir = resolve(baseDir, spec.os, spec.version);
    mkdirSync(dir, { recursive: true });

    console.log(`\n📁 [${spec.os.toUpperCase()} ${spec.version}] Directory: ${dir}`);

    // Locate primary ISO or TAR archive in spec if any
    const isoFileSpec = spec.files.find((f) => f.name.endsWith(".iso") || f.name.endsWith(".tar"));
    const isoPath = isoFileSpec ? join(dir, isoFileSpec.name) : null;
    const isoExists = isoPath ? existsSync(isoPath) : false;

    // First pass: Process downloads (download ISO first if needed)
    for (const file of spec.files) {
      const filePath = join(dir, file.name);
      const exists = existsSync(filePath);

      if (exists) {
        const stat = statSync(filePath);
        const extraInfo = file.name.startsWith("vmlinuz") ? ` ${getKernelInfo(filePath)}` : "";
        console.log(`  ✅ ${file.name} (${formatBytes(stat.size)})${extraInfo} - ${file.description}`);
      } else {
        // Missing file
        if (file.downloadUrl) {
          console.log(`  ❌ ${file.name} (MISSING) - ${file.description}`);
          console.log(`     Download URL: ${file.downloadUrl}`);
          if (shouldDownload) {
            try {
              await downloadFile(file.downloadUrl, filePath);
            } catch (err: any) {
              console.error(`     Download failed: ${err.message}`);
            }
          }
        } else if (file.extractedFromIso) {
          console.log(`  ❌ ${file.name} (MISSING) - Requires extraction from ISO`);
        } else {
          console.log(`  ❌ ${file.name} (MISSING) - Manual upload required`);
        }
      }
    }

    // Second pass: ISO Extraction for files configured with extractedFromIso
    const currentIsoExists = isoPath ? existsSync(isoPath) : false;
    if (currentIsoExists && isoPath) {
      for (const file of spec.files) {
        if (!file.extractedFromIso) continue;

        const filePath = join(dir, file.name);
        const exists = existsSync(filePath);
        const internalPath = (useHwe && file.extractedFromIso.hweSourceFile)
          ? file.extractedFromIso.hweSourceFile
          : file.extractedFromIso.sourceFile;

        if (!exists || forceExtract) {
          console.log(`  🔄 Extracting '${internalPath}' from ISO into '${file.name}'...`);
          const ok = extractFromIso(isoPath, internalPath, filePath);
          if (ok) {
            const stat = statSync(filePath);
            const extraInfo = file.name.startsWith("vmlinuz") ? ` ${getKernelInfo(filePath)}` : "";
            console.log(`     ✅ Extracted successfully (${formatBytes(stat.size)})${extraInfo}`);
          } else {
            console.log(`     ❌ Extraction failed for '${internalPath}'`);
          }
        }
      }
    }
  }

  if (!shouldDownload && !forceExtract) {
    console.log(`
Usage Options:
  --download   Download missing assets (e.g. ISOs, Talos assets)
  --extract    Force re-extract Kernel/Initrd from ISO (Single Source of Truth)
  --hwe        Use HWE kernel/initrd instead of GA kernel during extraction
  [os_name]    Target specific OS: 'ubuntu', 'talos', or 'suse-micro'

Examples:
  bun run sync-assets                          # Check status
  bun run sync-assets ubuntu --extract         # Re-extract 24.04 kernel & initrd from ISO
  bun run sync-assets ubuntu --extract --hwe   # Re-extract HWE kernel & initrd from ISO
  bun run sync-assets --download               # Download all missing assets
`);
  }
}

if (import.meta.main) {
  runSyncAssets().catch(console.error);
}
