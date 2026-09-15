import type { ConfigManager } from "../config.ts";
import type { StateManager } from "../core/state.ts";
import {
  renderNodeRow,
  renderNodesTablePartial,
  type DashboardHostItem,
} from "../ui/dashboard.ts";

export function buildDashboardData(configMgr: ConfigManager, stateMgr: StateManager) {
  const hostsConfig = configMgr.loadHostsConfig();
  const allNodes = stateMgr.getAllNodes();
  const nodeMap = new Map(allNodes.map((n) => [configMgr.normalizeMac(n.mac), n]));

  const hosts: DashboardHostItem[] = [];
  const processedMacs = new Set<string>();

  if (hostsConfig.hosts) {
    for (const [rawMac, spec] of Object.entries(hostsConfig.hosts)) {
      const cleanMac = configMgr.normalizeMac(rawMac);
      processedMacs.add(cleanMac);
      const resolved = configMgr.getHost(cleanMac);
      const nodeRec = nodeMap.get(cleanMac);

      const status = nodeRec?.status || "PENDING";
      hosts.push({
        mac: cleanMac,
        hostname: resolved.hostname,
        ip: resolved.network?.ip || nodeRec?.ip,
        os: resolved.os,
        version: resolved.version,
        profile: resolved.profile || resolved.role,
        status,
        note: resolved.note || nodeRec?.note,
        installed_at: nodeRec?.installed_at,
        updated_at: nodeRec?.updated_at,
        isK8s: Boolean(
          resolved.profile?.includes("k3s") ||
          resolved.profile?.includes("rke2") ||
          resolved.profile?.includes("k8s")
        ),
      });
    }
  }

  // Also include nodes recorded in DB that are not explicitly in hosts.yaml
  for (const node of allNodes) {
    const cleanMac = configMgr.normalizeMac(node.mac);
    if (!processedMacs.has(cleanMac)) {
      hosts.push({
        mac: cleanMac,
        hostname: node.hostname || "unconfigured",
        ip: node.ip,
        os: node.os || "unknown",
        status: node.status,
        note: node.note,
        installed_at: node.installed_at,
        updated_at: node.updated_at,
      });
    }
  }

  const installedCount = hosts.filter((h) => h.status === "INSTALLED").length;
  const provisioningCount = hosts.filter((h) => h.status === "PROVISIONING").length;
  const pendingCount = hosts.filter((h) => h.status === "PENDING").length;

  return {
    hosts,
    baseUrl: configMgr.appConfig.baseUrl,
    appConfig: configMgr.appConfig,
    stats: {
      total: hosts.length,
      installed: installedCount,
      provisioning: provisioningCount,
      pending: pendingCount,
    },
  };
}

export async function handleApiRoute(
  req: Request,
  pathname: string,
  configMgr: ConfigManager,
  stateMgr: StateManager,
  server?: any
): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // POST /api/installed?mac=...
  if (pathname === "/api/installed" && method === "POST") {
    let mac = url.searchParams.get("mac");
    let hostname = url.searchParams.get("hostname");
    let os = url.searchParams.get("os");
    let ip = url.searchParams.get("ip");

    let note = url.searchParams.get("note");

    // Also attempt to read JSON body if query params are missing
    if (req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = (await req.json()) as any;
        mac = mac || body.mac;
        hostname = hostname || body.hostname;
        os = os || body.os;
        ip = ip || body.ip || body.client_ip;
        note = note ?? body.note;
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

    const socketIp = server?.requestIP?.(req)?.address?.replace(/^::ffff:/, "");
    const forwardedIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const realIp = req.headers.get("x-real-ip")?.trim();

    const clientIp =
      ip ||
      host.network?.ip ||
      socketIp ||
      forwardedIp ||
      realIp ||
      "unknown";

    const record = stateMgr.markInstalled(cleanMac, {
      hostname: hostname || host.hostname,
      os: os || host.os,
      clientIp,
      note: note || host.note,
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

  // POST /api/note
  if (pathname === "/api/note" && method === "POST") {
    let mac = url.searchParams.get("mac");
    let identifier =
      url.searchParams.get("id") ||
      url.searchParams.get("identifier") ||
      url.searchParams.get("hostname");
    let note = url.searchParams.get("note");

    if (req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = (await req.json()) as any;
        mac = mac || body.mac;
        identifier = identifier || body.id || body.identifier || body.hostname;
        if (note === null || note === undefined) {
          note = body.note;
        }
      } catch {}
    }

    const targetId = (mac || identifier || "").trim();
    if (!targetId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: 'mac' or 'hostname'" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (note === null || note === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: 'note'" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Resolve target MAC address
    const cleanMac = configMgr.normalizeMac(targetId);
    let resolvedMac = cleanMac;
    const installed = stateMgr.getAllInstalled();
    const hostsConfig = configMgr.loadHostsConfig();

    if (!installed[cleanMac]) {
      // Try resolving by hostname
      const lowerTarget = targetId.toLowerCase();
      let foundMac: string | null = null;
      for (const [rawMac, record] of Object.entries(installed)) {
        if (record.hostname?.toLowerCase() === lowerTarget) {
          foundMac = configMgr.normalizeMac(rawMac);
          break;
        }
      }
      if (!foundMac && hostsConfig.hosts) {
        for (const rawMac of Object.keys(hostsConfig.hosts)) {
          const host = configMgr.getHost(rawMac);
          if (host.hostname?.toLowerCase() === lowerTarget) {
            foundMac = configMgr.normalizeMac(rawMac);
            break;
          }
        }
      }
      if (foundMac) {
        resolvedMac = foundMac;
      }
    }

    // Update note in StateManager. If node is not yet in state.json, create a record for it
    let record = stateMgr.updateNote(resolvedMac, String(note));
    if (!record) {
      const host = configMgr.getHost(resolvedMac);
      record = stateMgr.markInstalled(resolvedMac, {
        hostname: host.hostname,
        os: host.os,
        clientIp: host.network?.ip || "unknown",
        note: String(note),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Note updated for host ${record.hostname || resolvedMac}.`,
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

    // If request comes from HTMX, return the updated HTML row partial
    if (req.headers.get("hx-request") === "true" || req.headers.get("HX-Request") === "true") {
      const host = configMgr.getHost(cleanMac);
      const record = stateMgr.getNodeRecord(cleanMac);
      const updatedHost: DashboardHostItem = {
        mac: cleanMac,
        hostname: host.hostname,
        ip: host.network?.ip || record?.ip,
        os: host.os,
        version: host.version,
        profile: host.profile || host.role,
        status: (record?.status || "PENDING") as any,
        note: host.note || record?.note,
        installed_at: record?.installed_at,
        updated_at: record?.updated_at,
        isK8s: Boolean(
          host.profile?.includes("k3s") ||
          host.profile?.includes("rke2") ||
          host.profile?.includes("k8s")
        ),
      };
      const html = renderNodeRow(updatedHost, configMgr.appConfig.baseUrl);
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

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

  // GET /ui/nodes-table (HTMX partial update)
  if (pathname === "/ui/nodes-table" && method === "GET") {
    const data = buildDashboardData(configMgr, stateMgr);
    const html = renderNodesTablePartial(data.hosts, configMgr.appConfig.baseUrl);
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // GET /api/nodes (Full SQLite node records)
  if (pathname === "/api/nodes" && method === "GET") {
    return new Response(JSON.stringify(stateMgr.getAllNodes(), null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // DELETE /api/nodes?mac=... (Delete node record from SQLite)
  if (pathname === "/api/nodes" && method === "DELETE") {
    let mac = url.searchParams.get("mac");
    if (!mac && req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = (await req.json()) as any;
        mac = body?.mac;
      } catch {}
    }

    if (!mac) {
      return new Response(JSON.stringify({ error: "Missing required query parameter: 'mac'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cleanMac = configMgr.normalizeMac(mac);
    const deleted = stateMgr.deleteNode(cleanMac);

    if (req.headers.get("hx-request") === "true" || req.headers.get("HX-Request") === "true") {
      const hostsConfig = configMgr.loadHostsConfig();
      const isConfiguredHost = Boolean(hostsConfig.hosts && hostsConfig.hosts[cleanMac]);

      if (isConfiguredHost) {
        // Since node is declared in hosts.yaml, reset row back to clean PENDING state
        const host = configMgr.getHost(cleanMac);
        const pendingHost: DashboardHostItem = {
          mac: cleanMac,
          hostname: host.hostname,
          ip: host.network?.ip,
          os: host.os,
          version: host.version,
          profile: host.profile || host.role,
          status: "PENDING",
          note: host.note,
          isK8s: Boolean(
            host.profile?.includes("k3s") ||
            host.profile?.includes("rke2") ||
            host.profile?.includes("k8s")
          ),
        };
        const html = renderNodeRow(pendingHost, configMgr.appConfig.baseUrl);
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } else {
        // Dynamic node not declared in hosts.yaml: return empty string so HTMX deletes the row
        return new Response("", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: deleted,
        message: deleted
          ? `Node ${cleanMac} deleted from state.`
          : `Node ${cleanMac} was not found in state.`,
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
          note: resolved.note,
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

  // GET /api/kubeconfig or /api/kubeconfig/:identifier
  if (
    (pathname === "/api/kubeconfig" || pathname.startsWith("/api/kubeconfig/")) &&
    method === "GET"
  ) {
    let identifier = "";
    if (pathname.startsWith("/api/kubeconfig/")) {
      identifier = decodeURIComponent(pathname.slice("/api/kubeconfig/".length)).trim();
    } else {
      identifier = (
        url.searchParams.get("id") ||
        url.searchParams.get("identifier") ||
        url.searchParams.get("hostname") ||
        url.searchParams.get("mac") ||
        ""
      ).trim();
    }

    if (!identifier) {
      return new Response(
        JSON.stringify({
          error: "Missing node identifier. Provide either /api/kubeconfig/:identifier or ?hostname=... / ?mac=...",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const hostsConfig = configMgr.loadHostsConfig();
    const installed = stateMgr.getAllInstalled();

    let targetMac: string | null = null;
    let resolvedHost: any = null;

    // 1. Try matching by MAC address
    const normalizedInputMac = configMgr.normalizeMac(identifier);
    if (hostsConfig.hosts && hostsConfig.hosts[normalizedInputMac]) {
      targetMac = normalizedInputMac;
      resolvedHost = configMgr.getHost(targetMac);
    } else if (installed[normalizedInputMac]) {
      targetMac = normalizedInputMac;
      resolvedHost = configMgr.getHost(targetMac);
    }

    // 2. If not matched by MAC, search by hostname (case-insensitive)
    if (!targetMac) {
      const lowerId = identifier.toLowerCase();
      if (hostsConfig.hosts) {
        for (const rawMac of Object.keys(hostsConfig.hosts)) {
          const cleanMac = configMgr.normalizeMac(rawMac);
          const host = configMgr.getHost(cleanMac);
          if (host.hostname?.toLowerCase() === lowerId) {
            targetMac = cleanMac;
            resolvedHost = host;
            break;
          }
        }
      }

      if (!targetMac) {
        for (const [rawMac, record] of Object.entries(installed)) {
          const cleanMac = configMgr.normalizeMac(rawMac);
          if (record.hostname?.toLowerCase() === lowerId) {
            targetMac = cleanMac;
            resolvedHost = configMgr.getHost(cleanMac);
            break;
          }
        }
      }
    }

    if (!targetMac || !resolvedHost) {
      return new Response(
        JSON.stringify({
          error: `Node '${identifier}' not found in registered hosts or installed state.`,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Verify that the profile runs a Kubernetes cluster
    const profile = (resolvedHost.profile || resolvedHost.role || "generic").toLowerCase();
    let remotePath = "";

    if (profile === "k3s-single-node" || profile.includes("k3s")) {
      remotePath = "/etc/rancher/k3s/k3s.yaml";
    } else if (profile === "rke2-single-node" || profile.includes("rke2")) {
      remotePath = "/etc/rancher/rke2/rke2.yaml";
    } else {
      return new Response(
        JSON.stringify({
          error: `Host '${resolvedHost.hostname}' (profile: '${profile}') does not run a Kubernetes cluster (k3s or rke2).`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Resolve node IP and SSH user
    const installedInfo = installed[targetMac];
    const nodeIp = installedInfo?.client_ip || resolvedHost.network?.ip;

    if (!nodeIp || nodeIp === "unknown") {
      return new Response(
        JSON.stringify({
          error: `Could not determine reachable IP address for host '${resolvedHost.hostname}'.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const sshUser = resolvedHost.user || hostsConfig.default?.user || "homelab";
    const advertiseIp = url.searchParams.get("server_ip") || nodeIp;

    // 5. Fetch kubeconfig via SSH directly without caching
    try {
      const proc = Bun.spawn(
        [
          "ssh",
          "-o", "BatchMode=yes",
          "-o", "StrictHostKeyChecking=no",
          "-o", "ConnectTimeout=5",
          `${sshUser}@${nodeIp}`,
          `cat ${remotePath}`,
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (exitCode !== 0) {
        return new Response(
          JSON.stringify({
            error: `Failed to fetch kubeconfig from ${resolvedHost.hostname} (${nodeIp}) via SSH.`,
            details: stderr.trim() || `ssh exited with code ${exitCode}`,
          }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }

      // Replace 127.0.0.1:6443 with target server IP
      const finalKubeconfig = stdout.replace(
        /https:\/\/127\.0\.0\.1:6443/g,
        `https://${advertiseIp}:6443`
      );

      const format = url.searchParams.get("format")?.toLowerCase();
      if (format === "json") {
        return new Response(
          JSON.stringify(
            {
              success: true,
              hostname: resolvedHost.hostname,
              ip: nodeIp,
              mac: targetMac,
              profile,
              kubeconfig: finalKubeconfig,
            },
            null,
            2
          ),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(finalKubeconfig, {
        status: 200,
        headers: {
          "Content-Type": "application/x-yaml; charset=utf-8",
          "Content-Disposition": `attachment; filename="kubeconfig-${resolvedHost.hostname}"`,
        },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          error: `Unexpected error connecting to ${resolvedHost.hostname}: ${err.message}`,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response("Not Found", { status: 404 });
}
