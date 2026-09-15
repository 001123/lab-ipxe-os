import type { HostConfig } from "../../../types.ts";
import type { ProfileSpec, ProfileHandler } from "./types.ts";
import { getBaseLateCommands } from "./base.ts";
import { getGenericProfile } from "./generic.ts";
import { getK3sSingleNodeProfile } from "./k3s-single-node.ts";

export * from "./types.ts";

const PROFILES: Record<string, ProfileHandler> = {
  generic: getGenericProfile,
  "k3s-single-node": getK3sSingleNodeProfile,
};

export function getUbuntuProfile(
  profileName: string,
  host: HostConfig,
  baseUrl: string
): ProfileSpec {
  const normalizedKey = profileName.toLowerCase();
  let handler = PROFILES[normalizedKey];

  if (!handler) {
    console.warn(
      `[Ubuntu Profile] Unknown profile "${profileName}", falling back to "generic".`
    );
    handler = getGenericProfile;
  }

  const spec = handler(host, baseUrl);
  const baseLate = getBaseLateCommands(host, baseUrl);

  return {
    packages: spec.packages,
    lateCommands: [...spec.lateCommands, ...baseLate],
    ...(spec.earlyCommands ? { earlyCommands: spec.earlyCommands } : {}),
  };
}
