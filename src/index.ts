import { join } from "node:path";
import { ConfigManager } from "./config.ts";
import { StateManager } from "./core/state.ts";
import { StaticAssetServer } from "./core/static-server.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { handleIpxeRoute } from "./routes/ipxe.ts";
import { handleOsConfigRoute } from "./routes/os-configs.ts";
import { handleApiRoute, buildDashboardData } from "./routes/api.ts";
import { renderDashboardHtml } from "./ui/dashboard.ts";
import { logger } from "./core/logger.ts";
import { parseCli, printHelp } from "./cli.ts";
import pkg from "../package.json";
import { runSyncAssets, getMissingAssetsCount } from "./scripts/sync-assets.ts";

logger.hookConsole();

const isTest = process.env.NODE_ENV === "test" || process.env.PORT === "0";
const cliConfig = !isTest && import.meta.main ? parseCli() : parseCli([]);

if (import.meta.main) {
  if (cliConfig.action === "help") {
    printHelp();
    process.exit(0);
  }
  if (cliConfig.action === "version") {
    console.log(`lab-ipxe-os v${pkg.version}`);
    process.exit(0);
  }
  if (cliConfig.action === "sync-assets") {
    await runSyncAssets(cliConfig.syncAssetsArgs, cliConfig.assetsDir);
    process.exit(0);
  }
}

const stateMgr = new StateManager(cliConfig.dbPath, cliConfig.configPath, {
  baseUrl: cliConfig.baseUrl,
  ipxeMenuTimeout: cliConfig.ipxeMenuTimeout,
});
const configMgr = new ConfigManager(
  {
    port: cliConfig.port,
    host: cliConfig.host,
    baseUrl: cliConfig.baseUrl,
    configPath: cliConfig.configPath,
    dataDir: cliConfig.dataDir,
    dbPath: cliConfig.dbPath,
    assetsDir: cliConfig.assetsDir,
    logDir: cliConfig.logDir,
    ipxeMenuTimeout: cliConfig.ipxeMenuTimeout,
  },
  stateMgr
);
const registry = new ProviderRegistry();
const staticServer = new StaticAssetServer(cliConfig.assetsDir, "assets");
const publicServer = new StaticAssetServer(join(process.cwd(), "public"), "public");

export const server = Bun.serve({
  port: configMgr.appConfig.port,
  hostname: configMgr.appConfig.host,

  async fetch(req: Request, serverInstance: any): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;
    console.log(`[HTTP] ${req.method} ${pathname}${url.search}`);

    // CORS headers for API calls
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range",
        },
      });
    }

    // 1. iPXE Boot Script Routes
    if (
      pathname === "/boot.ipxe" ||
      pathname === "/chain" ||
      pathname === "/ipxe"
    ) {
      return handleIpxeRoute(req, configMgr, stateMgr, registry);
    }

    // 2. Static Asset Routes (ISOs, Kernels, Initrds with HTTP Range support)
    if (pathname.startsWith("/assets/")) {
      return await staticServer.serve(req, pathname);
    }

    // 2b. Static Client Public Routes (CSS, JS, Fonts)
    if (pathname.startsWith("/public/")) {
      return await publicServer.serve(req, pathname);
    }

    // 3. Dynamic OS Configuration Routes (Cloud-Init, Talos Config, Combustion)
    if (pathname.startsWith("/os/")) {
      return await handleOsConfigRoute(req, pathname, configMgr, registry, stateMgr);
    }

    // WebSocket endpoint for Live Console Logs
    if (pathname === "/ws/logs") {
      const upgraded = serverInstance.upgrade(req);
      if (upgraded) {
        return undefined as any;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Log download and purge API endpoints
    if (pathname === "/api/logs/download") {
      const logPath = logger.getLogFilePath();
      const file = Bun.file(logPath);
      return new Response(file, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="server.log"',
        },
      });
    }

    if (pathname === "/api/logs" && req.method === "DELETE") {
      const res = logger.purgeLogs();
      return new Response(JSON.stringify(res), {
        status: res.success ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. Management & Webhook API Routes
    if (pathname.startsWith("/api/") || pathname.startsWith("/ui/")) {
      return await handleApiRoute(req, pathname, configMgr, stateMgr, serverInstance);
    }

    // 5. Dashboard / Root / Info Page
    if (pathname === "/" || pathname === "/dashboard" || pathname === "/health") {
      const isHtmlRequest =
        pathname === "/dashboard" ||
        (pathname === "/" && (req.headers.get("accept")?.includes("text/html") ?? false));

      if (isHtmlRequest) {
        const dashboardData = buildDashboardData(configMgr, stateMgr);
        const html = renderDashboardHtml(dashboardData);
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const providers = registry.getAll().map((p) => p.name);
      const hostsConfig = configMgr.loadHostsConfig();
      const hostCount = Object.keys(hostsConfig.hosts || {}).length;

      return new Response(
        `=== Bun Multi-OS iPXE & Cloud-Init Server ===
Status: Running
Base URL: ${configMgr.appConfig.baseUrl}
Registered OS Providers: ${providers.join(", ")}
Configured Hosts: ${hostCount}

Useful Endpoints:
- Web UI Dashboard:   ${configMgr.appConfig.baseUrl}/
- iPXE Chain URL:     ${configMgr.appConfig.baseUrl}/boot.ipxe?mac=\${net0/mac}
- Asset Mirror:       ${configMgr.appConfig.baseUrl}/assets/
- Host API:           ${configMgr.appConfig.baseUrl}/api/hosts
- Nodes API (SQLite): ${configMgr.appConfig.baseUrl}/api/nodes
- Update Note API:     ${configMgr.appConfig.baseUrl}/api/note
- Phone-Home Webhook: ${configMgr.appConfig.baseUrl}/api/installed?mac=<MAC>
- Kubeconfig API:     ${configMgr.appConfig.baseUrl}/api/kubeconfig/<hostname|MAC>
- Live Console WS:    ${configMgr.appConfig.baseUrl.replace("http", "ws")}/ws/logs
`,
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws: any) {
      logger.subscribe(ws);
    },
    message(ws: any, message: any) {
      try {
        const data = JSON.parse(String(message));
        if (data.action === "purge") {
          logger.purgeLogs();
        }
      } catch {}
    },
    close(ws: any) {
      logger.unsubscribe(ws);
    },
  },
});

if (import.meta.main) {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  🚀 Bun Multi-OS iPXE & Cloud-Init Server is LIVE           │
├─────────────────────────────────────────────────────────────┤
│  Server URL:    ${configMgr.appConfig.baseUrl}
│  Listen:        http://${configMgr.appConfig.host}:${configMgr.appConfig.port}
│  iPXE Boot:     ${configMgr.appConfig.baseUrl}/boot.ipxe?mac=\${net0/mac}
│  Providers:     ${registry.getAll().map((p) => p.id).join(", ")}
└─────────────────────────────────────────────────────────────┘
`);

  const isTest = process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";
  if (cliConfig.action === "server" && cliConfig.autoSync && !isTest) {
    let targetOses: string[] = [];
    if (cliConfig.syncOs) {
      if (cliConfig.syncOs === "all") {
        targetOses = ["ubuntu", "talos", "suse-micro"];
      } else if (cliConfig.syncOs === "none") {
        targetOses = [];
      } else {
        targetOses = cliConfig.syncOs
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
      }
    } else {
      // Smart Default: only sync default OS and OSes of registered hosts
      const defaultOs = (stateMgr.getGlobalDefaultConfig().os || "ubuntu").toLowerCase();
      const hostOses = stateMgr
        .getAllHosts(false)
        .map((h) => (h.os || "").toLowerCase())
        .filter(Boolean);
      targetOses = Array.from(new Set([defaultOs, ...hostOses]));
    }

    if (targetOses.length > 0) {
      console.log(`[Assets] Target OS for startup synchronization: ${targetOses.join(", ")}`);
      for (const os of targetOses) {
        const assetStatus = getMissingAssetsCount(cliConfig.assetsDir, os);
        if (assetStatus.missing > 0) {
          console.log(`[Assets] ⚠️  [${os.toUpperCase()}] Detected ${assetStatus.missing}/${assetStatus.total} missing required boot assets:`);
          for (const missingFile of assetStatus.missingFiles) {
            console.log(`         - ${missingFile}`);
          }
          console.log(`[Assets] 🚀 Starting automatic background asset download & extraction for '${os}'...`);
          (async () => {
            try {
              await runSyncAssets(["--download", os], cliConfig.assetsDir);
              console.log(`[Assets] ✅ Boot assets synchronization complete for '${os}'.\n`);
            } catch (err: any) {
              console.error(`[Assets] ❌ Error syncing assets for '${os}':`, err.message);
            }
          })();
        } else {
          console.log(`[Assets] ✅ [${os.toUpperCase()}] All required boot assets are present in '${cliConfig.assetsDir}'.`);
        }
      }
    } else {
      console.log(`[Assets] Auto-sync skipped (no target OS specified).`);
    }
  }
}
