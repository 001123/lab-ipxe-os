import { join } from "node:path";
import { ConfigManager } from "./config.ts";
import { StateManager } from "./core/state.ts";
import { StaticAssetServer } from "./core/static-server.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { handleIpxeRoute } from "./routes/ipxe.ts";
import { handleOsConfigRoute } from "./routes/os-configs.ts";
import { handleApiRoute, buildDashboardData } from "./routes/api.ts";
import { renderDashboardHtml } from "./ui/dashboard.ts";

const stateMgr = new StateManager();
const configMgr = new ConfigManager(undefined, stateMgr);
const registry = new ProviderRegistry();
const staticServer = new StaticAssetServer();
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
`,
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
});

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
