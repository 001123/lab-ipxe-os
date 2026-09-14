import type { ConfigManager } from "../config.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { HostContext } from "../types.ts";

export async function handleOsConfigRoute(
  req: Request,
  pathname: string,
  configMgr: ConfigManager,
  registry: ProviderRegistry
): Promise<Response> {
  // Format: /os/<provider-id>/<mac>/<subpath...>
  // e.g. /os/ubuntu/bc:24:11:22:33:44/user-data
  // e.g. /os/talos/bc:24:11:22:33:44/config.yaml
  // e.g. /os/suse-micro/bc:24:11:22:33:44/combustion/script
  const parts = pathname.replace(/^\/+os\/+/, "").split("/");
  if (parts.length < 3) {
    return new Response(
      "Invalid OS config URL format. Expected: /os/<provider>/<mac>/<subpath>",
      { status: 400 }
    );
  }

  const providerName = parts[0];
  const mac = parts[1];
  const subpath = parts.slice(2).join("/");

  const cleanMac = configMgr.normalizeMac(mac);
  const host = configMgr.getHost(cleanMac);
  const provider = registry.get(providerName);

  if (!provider) {
    return new Response(`Unknown OS provider: ${providerName}`, { status: 404 });
  }

  const ctx: HostContext = {
    mac: cleanMac,
    baseUrl: configMgr.appConfig.baseUrl,
    hostConfig: host,
  };

  return await provider.handleConfig(subpath, req, ctx);
}
