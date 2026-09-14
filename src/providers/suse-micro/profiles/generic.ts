import type { HostConfig } from "../../../types.ts";
import type { SuseProfileSpec } from "./types.ts";

export function getGenericProfile(_host: HostConfig, _baseUrl: string): SuseProfileSpec {
  return {
    packages: ["curl", "htop", "qemu-guest-agent", "git"],
    scriptSnippets: [
      `# Auto-expand Btrfs root filesystem to use all disk capacity`,
      `btrfs filesystem resize max / || true`,
      `systemctl enable qemu-guest-agent || true`,
    ],
  };
}
