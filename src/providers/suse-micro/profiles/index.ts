import type { HostConfig } from "../../../types.ts";
import type { SuseProfileSpec } from "./types.ts";
import { getGenericProfile } from "./generic.ts";
import { getRke2SingleNodeProfile } from "./rke2-single-node.ts";

export * from "./types.ts";

export function getSuseMicroProfile(
  profileName: string,
  host: HostConfig,
  baseUrl: string
): SuseProfileSpec {
  switch (profileName.toLowerCase()) {
    case "rke2-single-node":
      return getRke2SingleNodeProfile(host, baseUrl);

    case "generic":
      return getGenericProfile(host, baseUrl);

    default:
      console.warn(
        `[openSUSE Leap Micro Profile] Unknown profile "${profileName}", falling back to "generic".`
      );
      return getGenericProfile(host, baseUrl);
  }
}
