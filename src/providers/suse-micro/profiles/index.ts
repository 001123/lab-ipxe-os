import type { HostConfig } from "../../../types.ts";
import type { SuseProfileSpec, SuseProfileHandler } from "./types.ts";
import { getGenericProfile } from "./generic.ts";
import { getRke2SingleNodeProfile } from "./rke2-single-node.ts";

export * from "./types.ts";

const PROFILES: Record<string, SuseProfileHandler> = {
  generic: getGenericProfile,
  "rke2-single-node": getRke2SingleNodeProfile,
};

export function getSuseMicroProfile(
  profileName: string,
  host: HostConfig,
  baseUrl: string
): SuseProfileSpec {
  const normalizedKey = profileName.toLowerCase();
  let handler = PROFILES[normalizedKey];

  if (!handler) {
    console.warn(
      `[openSUSE Leap Micro Profile] Unknown profile "${profileName}", falling back to "generic".`
    );
    handler = getGenericProfile;
  }

  return handler(host, baseUrl);
}
