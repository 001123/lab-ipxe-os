import type { HostConfig } from "../../../types.ts";

export interface ProxmoxProfileSpec {
  packages?: string[];
  notes: string[];
}

export type ProxmoxProfileHandler = (host: HostConfig, baseUrl: string) => ProxmoxProfileSpec;
