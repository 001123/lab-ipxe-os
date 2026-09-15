import type { HostConfig } from "../../../types.ts";
import type { ProfileSpec } from "./types.ts";

export function getGenericProfile(_host: HostConfig, _baseUrl: string): ProfileSpec {
  return {
    packages: [
      "qemu-guest-agent",
      "curl",
      "htop",
      "vim",
      "tmux",
      "net-tools",
      "git",
      "efibootmgr",
    ],
    lateCommands: [],
  };
}
