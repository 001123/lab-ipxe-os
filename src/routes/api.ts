import type { ConfigManager } from "../config.ts";
import type { StateManager } from "../core/state.ts";

export async function handleApiRoute(
  req: Request,
  pathname: string,
  configMgr: ConfigManager,
  stateMgr: StateManager
): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // POST /api/installed?mac=...
  if (pathname === "/api/installed" && method === "POST") {
    let mac = url.searchParams.get("mac");
    let hostname = url.searchParams.get("hostname");
    let os = url.searchParams.get("os");

    // Also attempt to read JSON body if query params are missing
    if (!mac && req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = (await req.json()) as any;
        mac = body.mac;
        hostname = body.hostname;
        os = body.os;
      } catch {}
    }

    if (!mac) {
      return new Response(JSON.stringify({ error: "Missing required query or body parameter: 'mac'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cleanMac = configMgr.normalizeMac(mac);
    const host = configMgr.getHost(cleanMac);
    const record = stateMgr.markInstalled(cleanMac, {
      hostname: hostname || host.hostname,
      os: os || host.os,
      clientIp: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Host ${record.hostname} (${cleanMac}) recorded as installed.`,
        record,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // POST /api/reset?mac=...
  if (pathname === "/api/reset" && method === "POST") {
    const mac = url.searchParams.get("mac");
    if (!mac) {
      return new Response(JSON.stringify({ error: "Missing parameter 'mac'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cleanMac = configMgr.normalizeMac(mac);
    const reset = stateMgr.resetInstalled(cleanMac);

    return new Response(
      JSON.stringify({
        success: reset,
        message: reset
          ? `Lock cleared for ${cleanMac}. Ready for reinstall.`
          : `Host ${cleanMac} was not in installed state.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // GET /api/hosts
  if (pathname === "/api/hosts" && method === "GET") {
    const hostsConfig = configMgr.loadHostsConfig();
    const installed = stateMgr.getAllInstalled();

    const result: any[] = [];
    if (hostsConfig.hosts) {
      for (const [rawMac, spec] of Object.entries(hostsConfig.hosts)) {
        const cleanMac = configMgr.normalizeMac(rawMac);
        const resolved = configMgr.getHost(cleanMac);
        result.push({
          mac: cleanMac,
          hostname: resolved.hostname,
          os: resolved.os,
          version: resolved.version,
          profile: resolved.profile || resolved.role,
          installed: Boolean(installed[cleanMac]),
          installed_info: installed[cleanMac] || null,
        });
      }
    }

    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/state
  if (pathname === "/api/state" && method === "GET") {
    return new Response(JSON.stringify(stateMgr.getAllInstalled(), null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Not Found", { status: 404 });
}
