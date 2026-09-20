import type { HostConfig } from "../../../types.ts";
import type { ProxmoxProfileHandler, ProxmoxProfileSpec } from "./types.ts";
import { getGenericProfile } from "./generic.ts";

export * from "./types.ts";

const PROFILES: Record<string, ProxmoxProfileHandler> = {
  generic: getGenericProfile,
};

export function getProxmoxProfile(
  profileName: string,
  host: HostConfig,
  baseUrl: string
): ProxmoxProfileSpec {
  const normalizedKey = (profileName || "generic").toLowerCase();
  let handler = PROFILES[normalizedKey];

  if (!handler) {
    console.warn(`[Proxmox VE Profile] Unknown profile "${profileName}", falling back to "generic".`);
    handler = getGenericProfile;
  }

  return handler(host, baseUrl);
}
