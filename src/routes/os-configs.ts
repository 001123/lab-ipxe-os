import type { ConfigManager } from "../config.ts";
import type { StateManager } from "../core/state.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { HostConfig, HostContext } from "../types.ts";
import { extractInstallerMacs, renderProxmoxAnswer } from "../providers/proxmox/answer.ts";

/**
 * Shared Proxmox VE answer endpoint (no MAC segment).
 * Configure once via:
 *   proxmox-auto-install-assistant prepare-iso <pve-9.2-iso> \
 *     --fetch-from http --url <BASE_URL>/os/proxmox/answer \
 *     --pxe --pxe-loader ipxe --output <dir>
 * The installer POSTs system-info JSON; the host is matched by NIC MAC
 * against registered hosts, falling back to the global default config.
 */
async function handleProxmoxDynamicAnswer(
  req: Request,
  configMgr: ConfigManager,
  stateMgr?: StateManager
): Promise<Response> {
  const url = new URL(req.url);
  const macOverride = url.searchParams.get("mac");

  let resolvedMac = "";
  let host: HostConfig | null = null;

  if (macOverride) {
    resolvedMac = configMgr.normalizeMac(macOverride);
    host = configMgr.getHost(resolvedMac);
  } else {
    let candidates: string[] = [];
    if (req.method === "POST") {
      try {
        candidates = extractInstallerMacs(await req.json());
      } catch {
        candidates = [];
      }
    }

    for (const candidate of candidates) {
      const registered = stateMgr
        ? stateMgr.getHost(candidate, false)
        : configMgr.getHost(candidate);
      // configMgr.getHost() always synthesizes, so only accept DB hits here.
      if (stateMgr && registered) {
        host = registered;
        resolvedMac = candidate;
        break;
      }
      if (!stateMgr && registered) {
        const configData = configMgr.loadHostsConfig();
        const isSeed = Object.keys(configData.hosts || {}).some(
          (key) => configMgr.normalizeMac(key) === candidate
        );
        if (isSeed) {
          host = registered;
          resolvedMac = candidate;
          break;
        }
      }
    }

    if (!host) {
      resolvedMac = candidates[0] || "00:00:00:00:00:00";
      host = configMgr.getHost(resolvedMac);
    }
  }

  if (stateMgr) {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      host.network?.ip ||
      "unknown";

    stateMgr.markProvisioning(resolvedMac, {
      hostname: host.hostname,
      os: host.os,
      clientIp,
      note: host.note,
    });
  }

  return new Response(renderProxmoxAnswer(host, configMgr.appConfig.baseUrl), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function handleOsConfigRoute(
  req: Request,
  pathname: string,
  configMgr: ConfigManager,
  registry: ProviderRegistry,
  stateMgr?: StateManager
): Promise<Response> {
  // Format: /os/<provider-id>/<mac>/<subpath...>
  // e.g. /os/ubuntu/bc:24:11:22:33:44/user-data
  // e.g. /os/talos/bc:24:11:22:33:44/config.yaml
  // e.g. /os/suse-micro/bc:24:11:22:33:44/combustion/script
  const parts = pathname.replace(/^\/+os\/+/, "").split("/");

  // Shared Proxmox answer endpoint: /os/proxmox/answer[.toml] (GET or POST, no MAC)
  if (
    parts.length === 2 &&
    (parts[1] === "answer" || parts[1] === "answer.toml") &&
    registry.get(parts[0])?.id === "proxmox"
  ) {
    return await handleProxmoxDynamicAnswer(req, configMgr, stateMgr);
  }

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

  if (stateMgr) {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      host.network?.ip ||
      "unknown";

    stateMgr.markProvisioning(cleanMac, {
      hostname: host.hostname,
      os: host.os,
      clientIp,
      note: host.note,
    });
  }

  return await provider.handleConfig(subpath, req, ctx);
}
