import type { HostConfig } from "../../../types.ts";

export interface SuseProfileSpec {
  packages?: string[];
  scriptSnippets: string[];
}

export type SuseProfileHandler = (host: HostConfig, baseUrl: string) => SuseProfileSpec;

