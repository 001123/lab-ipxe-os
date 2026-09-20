import type { HostConfig } from "../../../types.ts";
import type { ProxmoxProfileSpec } from "./types.ts";

export function getGenericProfile(_host: HostConfig, _baseUrl: string): ProxmoxProfileSpec {
  return {
    notes: ["Proxmox VE generic standalone node (no extra first-boot packages)."],
  };
}
