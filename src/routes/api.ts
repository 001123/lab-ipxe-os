import type { ConfigManager } from "../config.ts";
import type { StateManager } from "../core/state.ts";
import type { HostConfig } from "../types.ts";
import {
  renderNodeRow,
  renderNodesTablePartial,
  renderStatsGridPartial,
  type DashboardHostItem,
} from "../ui/dashboard.ts";

export function buildDashboardData(configMgr: ConfigManager, stateMgr: StateManager) {
  const allHosts = stateMgr.getAllHosts();
  const hosts: DashboardHostItem[] = allHosts.map((h) => {
    const isK8s = Boolean(
      h.profile?.includes("k3s") ||
      h.profile?.includes("rke2") ||
      h.profile?.includes("k8s")
    );
    return {
      mac: configMgr.normalizeMac(h.mac),
      hostname: h.hostname,
      ip: h.network?.ip,
      os: h.os,
      version: h.version,
      profile: h.profile || h.role,
      status: (h.status || "PENDING") as any,
      note: h.note,
      installed_at: h.installed_at,
      updated_at: h.updated_at,
      isK8s,
      rawConfig: h,
    };
  });

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

export function parseSshKeys(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((k) => String(k).trim()).filter(Boolean);
  }
  const raw = input.toString().trim();
  if (!raw) return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((k) => String(k).trim()).filter(Boolean);
      }
    } catch {}
  }
  return raw
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0 && !line.startsWith("#"));
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
  const isHtmx = req.headers.get("hx-request") === "true" || req.headers.get("HX-Request") === "true";

  // =========================================================================
  // 1. Full CRUD Host Endpoints (/api/hosts)
  // =========================================================================

  // GET /api/hosts
  if (pathname === "/api/hosts" && method === "GET") {
    const hosts = stateMgr.getAllHosts();
    return new Response(JSON.stringify(hosts, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/hosts/:mac
  if (pathname.startsWith("/api/hosts/") && method === "GET" && !pathname.endsWith("/edit")) {
    const macParam = decodeURIComponent(pathname.slice("/api/hosts/".length)).trim();
    const host = stateMgr.getHost(macParam) || stateMgr.getHostByIdentifier(macParam);
    if (!host) {
      return new Response(JSON.stringify({ error: `Host '${macParam}' not found.` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(host, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/hosts (Create Host)
  if (pathname === "/api/hosts" && method === "POST") {
    let bodyData: any = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        bodyData = await req.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      formData.forEach((val, key) => {
        bodyData[key] = val.toString();
      });
    }

    const rawMac = bodyData.mac || url.searchParams.get("mac");
    const rawHostname = bodyData.hostname || url.searchParams.get("hostname");

    if (!rawMac || !rawHostname) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: 'mac' and 'hostname' are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const cleanMac = configMgr.normalizeMac(rawMac);
    const existing = stateMgr.getHost(cleanMac, false);
    if (existing) {
      return new Response(
        JSON.stringify({ error: `Host with MAC address '${cleanMac}' already exists.` }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    const os = bodyData.os || "ubuntu";
    const version = bodyData.version || (os === "ubuntu" ? "24.04" : os === "suse-micro" ? "6.2" : undefined);
    const profile = bodyData.profile || "generic";
    const note = bodyData.note || undefined;
    const ip = bodyData.ip ? bodyData.ip.trim() : undefined;
    const netmask = bodyData.netmask ? bodyData.netmask.trim() : undefined;
    const gateway = bodyData.gateway ? bodyData.gateway.trim() : undefined;
    const nameserversStr = bodyData.nameservers || bodyData.dns;
    const nameservers = nameserversStr
      ? nameserversStr.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean)
      : undefined;
    const dhcp = bodyData.dhcp !== undefined ? (bodyData.dhcp === "true" || bodyData.dhcp === true || bodyData.dhcp === "on") : !ip;
    const targetDisk = bodyData.target_disk || bodyData.disk || "/dev/sda";

    // Custom properties (GitOps / K3s / RKE2 / custom_json)
    let custom: Record<string, any> = {};
    if (bodyData.custom_json !== undefined && bodyData.custom_json !== null) {
      const trimmed = bodyData.custom_json.toString().trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
            return new Response(JSON.stringify({ error: "custom_json must be a valid JSON object." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          custom = parsed;
        } catch (err: any) {
          return new Response(JSON.stringify({ error: `Invalid JSON in custom_json: ${err.message}` }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    } else {
      if (bodyData.k3s_version) custom.k3s_version = bodyData.k3s_version;
      if (bodyData.rke2_version) custom.rke2_version = bodyData.rke2_version;
      if (bodyData.boot_method) custom.boot_method = bodyData.boot_method;
      if (bodyData.nfs_root) custom.nfs_root = bodyData.nfs_root;
      if (bodyData.argocd === "true" || bodyData.argocd === true || bodyData.argocd === "on") {
        custom.argocd = true;
        if (bodyData.gitops_repo) custom.gitops_repo = bodyData.gitops_repo;
        if (bodyData.gitops_branch) custom.gitops_branch = bodyData.gitops_branch;
        if (bodyData.gitops_path) custom.gitops_path = bodyData.gitops_path;
        if (bodyData.argocd_hostname) custom.argocd_hostname = bodyData.argocd_hostname;
      }
    }

    let sshAuthorizedKeys: string[] | undefined = undefined;
    if (bodyData.ssh_keys_json !== undefined && bodyData.ssh_keys_json !== null) {
      sshAuthorizedKeys = parseSshKeys(bodyData.ssh_keys_json);
    } else if (bodyData.ssh_authorized_keys !== undefined) {
      sshAuthorizedKeys = parseSshKeys(bodyData.ssh_authorized_keys);
    }

    const hostPayload: HostConfig = {
      mac: cleanMac,
      hostname: rawHostname.trim(),
      os,
      version,
      profile,
      note,
      status: "PENDING",
      ssh_authorized_keys: sshAuthorizedKeys,
      network: {
        dhcp,
        ip: ip || undefined,
        netmask: netmask || undefined,
        gateway: gateway || undefined,
        nameservers,
      },
      storage: {
        target_disk: targetDisk,
      },
      custom,
    };

    const created = stateMgr.createHost(hostPayload);

    if (isHtmx) {
      const allData = buildDashboardData(configMgr, stateMgr);
      const html = renderNodesTablePartial(allData.hosts, configMgr.appConfig.baseUrl);
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "HX-Trigger": "hostCreated, refreshStats",
        },
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: `Host ${created.hostname} created successfully.`, host: created }, null, 2),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }

  // PUT /api/hosts/:mac or POST /api/hosts/:mac/edit (Update Host)
  if (
    (pathname.startsWith("/api/hosts/") && method === "PUT") ||
    (pathname.startsWith("/api/hosts/") && pathname.endsWith("/edit") && method === "POST")
  ) {
    let macParam = "";
    if (pathname.endsWith("/edit")) {
      macParam = pathname.slice("/api/hosts/".length, -"/edit".length);
    } else {
      macParam = pathname.slice("/api/hosts/".length);
    }
    const cleanMac = configMgr.normalizeMac(decodeURIComponent(macParam));

    let bodyData: any = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        bodyData = await req.json();
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      formData.forEach((val, key) => {
        bodyData[key] = val.toString();
      });
    }

    const existing = stateMgr.getHost(cleanMac, false);
    if (!existing) {
      return new Response(JSON.stringify({ error: `Host '${cleanMac}' not found.` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const patch: Partial<HostConfig> = {};
    if (bodyData.hostname) patch.hostname = bodyData.hostname.trim();
    if (bodyData.os) patch.os = bodyData.os.trim();
    if (bodyData.version !== undefined) patch.version = bodyData.version.trim() || undefined;
    if (bodyData.profile !== undefined) patch.profile = bodyData.profile.trim() || undefined;
    if (bodyData.note !== undefined) patch.note = bodyData.note;

    // Network patch
    const ip = bodyData.ip !== undefined ? bodyData.ip.trim() : existing.network?.ip;
    const netmask = bodyData.netmask !== undefined ? bodyData.netmask.trim() : existing.network?.netmask;
    const gateway = bodyData.gateway !== undefined ? bodyData.gateway.trim() : existing.network?.gateway;
    let nameservers = existing.network?.nameservers;
    if (bodyData.nameservers !== undefined) {
      nameservers = bodyData.nameservers.split(/[\s,]+/).map((s: string) => s.trim()).filter(Boolean);
    }
    const dhcp = bodyData.dhcp !== undefined
      ? (bodyData.dhcp === "true" || bodyData.dhcp === true || bodyData.dhcp === "on")
      : existing.network?.dhcp;

    patch.network = {
      ...existing.network,
      dhcp,
      ip: ip || undefined,
      netmask: netmask || undefined,
      gateway: gateway || undefined,
      nameservers,
    };

    if (bodyData.target_disk !== undefined) {
      patch.storage = {
        ...existing.storage,
        target_disk: bodyData.target_disk.trim() || undefined,
      };
    }

    // SSH Keys patch
    if (bodyData.ssh_keys_json !== undefined && bodyData.ssh_keys_json !== null) {
      patch.ssh_authorized_keys = parseSshKeys(bodyData.ssh_keys_json);
    } else if (bodyData.ssh_authorized_keys !== undefined) {
      patch.ssh_authorized_keys = parseSshKeys(bodyData.ssh_authorized_keys);
    }

    // Custom patch
    if (bodyData.custom_json !== undefined && bodyData.custom_json !== null) {
      const trimmed = bodyData.custom_json.toString().trim();
      if (!trimmed) {
        // Empty textarea => overwrite to clear custom
        patch.custom = {};
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
            return new Response(JSON.stringify({ error: "custom_json must be a valid JSON object." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          patch.custom = parsed;
        } catch (err: any) {
          return new Response(JSON.stringify({ error: `Invalid JSON in custom_json: ${err.message}` }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    } else {
      const custom = { ...(existing.custom || {}) };
      if (bodyData.k3s_version !== undefined) custom.k3s_version = bodyData.k3s_version;
      if (bodyData.rke2_version !== undefined) custom.rke2_version = bodyData.rke2_version;
      if (bodyData.boot_method !== undefined) custom.boot_method = bodyData.boot_method;
      if (bodyData.nfs_root !== undefined) custom.nfs_root = bodyData.nfs_root;
      if (bodyData.argocd !== undefined) {
        custom.argocd = bodyData.argocd === "true" || bodyData.argocd === true || bodyData.argocd === "on";
      }
      if (bodyData.gitops_repo !== undefined) custom.gitops_repo = bodyData.gitops_repo;
      if (bodyData.gitops_branch !== undefined) custom.gitops_branch = bodyData.gitops_branch;
      if (bodyData.gitops_path !== undefined) custom.gitops_path = bodyData.gitops_path;
      if (bodyData.argocd_hostname !== undefined) custom.argocd_hostname = bodyData.argocd_hostname;
      patch.custom = custom;
    }

    const updated = stateMgr.updateHost(cleanMac, patch);

    if (isHtmx) {
      const allData = buildDashboardData(configMgr, stateMgr);
      const html = renderNodesTablePartial(allData.hosts, configMgr.appConfig.baseUrl);
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "HX-Trigger": "hostUpdated, refreshStats",
        },
      });
    }

    return new Response(
      JSON.stringify({ success: true, message: `Host ${cleanMac} updated.`, host: updated }, null, 2),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // DELETE /api/hosts/:mac or DELETE /api/nodes?mac=... (Delete Host)
  if (
    (pathname.startsWith("/api/hosts/") && method === "DELETE") ||
    (pathname === "/api/nodes" && method === "DELETE")
  ) {
    let mac = "";
    const isLegacyNodesEndpoint = pathname === "/api/nodes";
    if (pathname.startsWith("/api/hosts/")) {
      mac = decodeURIComponent(pathname.slice("/api/hosts/".length)).trim();
    } else {
      mac = url.searchParams.get("mac") || "";
      if (!mac && req.headers.get("content-type")?.includes("application/json")) {
        try {
          const body = (await req.json()) as any;
          mac = body?.mac || "";
        } catch {}
      }
    }

    if (!mac) {
      return new Response(JSON.stringify({ error: "Missing required parameter: 'mac'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cleanMac = configMgr.normalizeMac(mac);

    // Legacy /api/nodes behavior with HTMX:
    // If it's a seed host from hosts.yaml, reset status to PENDING and return row partial
    if (isLegacyNodesEndpoint && isHtmx) {
      const isSeed = stateMgr.isSeedHost(cleanMac);
      if (isSeed) {
        stateMgr.resetHostStatus(cleanMac);
        const existing = stateMgr.getHost(cleanMac);
        if (existing) {
          const item: DashboardHostItem = {
            mac: cleanMac,
            hostname: existing.hostname,
            ip: existing.network?.ip,
            os: existing.os,
            version: existing.version,
            profile: existing.profile || existing.role,
            status: "PENDING",
            note: existing.note,
            rawConfig: existing,
          };
          const html = renderNodeRow(item, configMgr.appConfig.baseUrl);
          return new Response(html, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "HX-Trigger": "refreshStats",
            },
          });
        }
      }
      // Dynamic unconfigured node: delete from DB and return empty string so HTMX removes row
      stateMgr.deleteHost(cleanMac);
      return new Response("", {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "HX-Trigger": "refreshStats",
        },
      });
    }

    const deleted = stateMgr.deleteHost(cleanMac);

    if (isHtmx) {
      // Return empty string so HTMX outerHTML swap removes the row completely
      return new Response("", {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "HX-Trigger": "refreshStats",
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: deleted,
        message: deleted
          ? `Host ${cleanMac} permanently deleted from database.`
          : `Host ${cleanMac} was not found.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // =========================================================================
  // 2. Export Database to YAML (/api/export/yaml or /api/export/hosts.yaml)
  // =========================================================================
  if ((pathname === "/api/export/yaml" || pathname === "/api/export/hosts.yaml") && method === "GET") {
    const yaml = stateMgr.exportToYaml();
    return new Response(yaml, {
      status: 200,
      headers: {
        "Content-Type": "application/x-yaml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="hosts.yaml"',
      },
    });
  }

  // =========================================================================
  // 2.1 Import YAML to Database (/api/import/yaml)
  // =========================================================================
  if (pathname === "/api/import/yaml" && method === "POST") {
    try {
      const contentType = req.headers.get("content-type") || "";
      let yamlContent = "";
      let replaceAll = false;
      let updateDefaults = true;
      let resetStatus = false;

      if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
        const formData = await req.formData();
        const file = formData.get("file");
        if (file && typeof file === "object" && "text" in file) {
          yamlContent = await (file as Blob).text();
        } else if (typeof file === "string") {
          yamlContent = file;
        } else {
          const yamlField = formData.get("yaml");
          if (typeof yamlField === "string") {
            yamlContent = yamlField;
          }
        }

        replaceAll = formData.get("replaceAll") === "true" || formData.get("replaceAll") === "1";
        updateDefaults = formData.has("updateDefaults")
          ? formData.get("updateDefaults") === "true" || formData.get("updateDefaults") === "1"
          : true;
        resetStatus = formData.get("resetStatus") === "true" || formData.get("resetStatus") === "1";
      } else if (contentType.includes("application/json")) {
        const body = await req.json().catch(() => ({}));
        yamlContent = body.yaml || body.content || "";
        if (body.replaceAll !== undefined) replaceAll = Boolean(body.replaceAll);
        if (body.updateDefaults !== undefined) updateDefaults = Boolean(body.updateDefaults);
        if (body.resetStatus !== undefined) resetStatus = Boolean(body.resetStatus);
      } else {
        // Raw text / yaml payload
        yamlContent = await req.text();
        replaceAll = url.searchParams.get("replaceAll") === "true";
        updateDefaults = url.searchParams.has("updateDefaults")
          ? url.searchParams.get("updateDefaults") === "true"
          : true;
        resetStatus = url.searchParams.get("resetStatus") === "true";
      }

      if (!yamlContent || !yamlContent.trim()) {
        return new Response(JSON.stringify({ error: "Nội dung file YAML rỗng hoặc không hợp lệ." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = stateMgr.importFromYaml(yamlContent, {
        replaceAll,
        updateDefaults,
        resetStatus,
      });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          error: err.message || "Failed to import YAML",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // =========================================================================
  // 3. Status & Reset Endpoints
  // =========================================================================

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
    const reset = stateMgr.resetHostStatus(cleanMac);

    if (isHtmx) {
      const host = stateMgr.getHost(cleanMac);
      if (host) {
        const item: DashboardHostItem = {
          mac: cleanMac,
          hostname: host.hostname,
          ip: host.network?.ip,
          os: host.os,
          version: host.version,
          profile: host.profile || host.role,
          status: "PENDING",
          note: host.note,
          rawConfig: host,
        };
        const html = renderNodeRow(item, configMgr.appConfig.baseUrl);
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "HX-Trigger": "refreshStats",
          },
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: reset,
        message: reset
          ? `Lock cleared for ${cleanMac}. Ready for reinstall.`
          : `Host ${cleanMac} was not found.`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // POST /api/installed?mac=... (Phone-home webhook)
  if (pathname === "/api/installed" && method === "POST") {
    let mac = url.searchParams.get("mac");
    let hostname = url.searchParams.get("hostname");
    let os = url.searchParams.get("os");
    let ip = url.searchParams.get("ip");
    let note = url.searchParams.get("note");

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
      return new Response(JSON.stringify({ error: "Missing required parameter: 'mac'" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cleanMac = configMgr.normalizeMac(mac);
    const host = stateMgr.getHost(cleanMac) || configMgr.getHost(cleanMac);

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

    const responseRecord = {
      ...record,
      client_ip: clientIp,
      ip: clientIp,
    };

    return new Response(
      JSON.stringify({
        success: true,
        message: `Host ${record.hostname} (${cleanMac}) recorded as installed.`,
        record: responseRecord,
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

    const host = stateMgr.getHostByIdentifier(targetId);
    if (!host) {
      return new Response(JSON.stringify({ error: `Node '${targetId}' not found.` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const updated = stateMgr.updateNote(host.mac, String(note));
    return new Response(
      JSON.stringify({
        success: true,
        message: `Note updated for host ${updated?.hostname || host.mac}.`,
        record: updated,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // GET /ui/stats (HTMX stats grid update)
  if (pathname === "/ui/stats" && method === "GET") {
    const data = buildDashboardData(configMgr, stateMgr);
    const html = renderStatsGridPartial(data.stats);
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // GET /ui/nodes-table (HTMX polling update)
  if (pathname === "/ui/nodes-table" && method === "GET") {
    const data = buildDashboardData(configMgr, stateMgr);
    const html = renderNodesTablePartial(data.hosts, configMgr.appConfig.baseUrl);
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // GET /api/nodes (Compatibility)
  if (pathname === "/api/nodes" && method === "GET") {
    return new Response(JSON.stringify(stateMgr.getAllNodes(), null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/state (Compatibility)
  if (pathname === "/api/state" && method === "GET") {
    return new Response(JSON.stringify(stateMgr.getAllInstalled(), null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // =========================================================================
  // 4. Kubeconfig SSH Fetcher (/api/kubeconfig or /api/kubeconfig/:identifier)
  // =========================================================================
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

    const resolvedHost = stateMgr.getHostByIdentifier(identifier);
    if (!resolvedHost) {
      return new Response(
        JSON.stringify({
          error: `Node '${identifier}' not found in registered hosts.`,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

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

    const nodeIp = resolvedHost.network?.ip;
    if (!nodeIp || nodeIp === "unknown") {
      return new Response(
        JSON.stringify({
          error: `Could not determine reachable IP address for host '${resolvedHost.hostname}'.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const sshUser = resolvedHost.user || "homelab";
    const advertiseIp = url.searchParams.get("server_ip") || nodeIp;

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
              mac: resolvedHost.mac,
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
