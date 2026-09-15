import type { HostConfig } from "../../../types.ts";

export interface ProfileSpec {
  packages: string[];
  lateCommands: string[];
  earlyCommands?: string[];
}

export type ProfileHandler = (host: HostConfig, baseUrl: string) => ProfileSpec;
