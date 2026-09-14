import { ConfigManager } from "./config.ts";
import { StateManager } from "./core/state.ts";
import { StaticAssetServer } from "./core/static-server.ts";
import { ProviderRegistry } from "./providers/registry.ts";
import { handleIpxeRoute } from "./routes/ipxe.ts";
import { handleOsConfigRoute } from "./routes/os-configs.ts";
import { handleApiRoute } from "./routes/api.ts";

const configMgr = new ConfigManager();
const stateMgr = new StateManager();
const registry = new ProviderRegistry();
const staticServer = new StaticAssetServer();

export const server = Bun.serve({
  port: configMgr.appConfig.port,
  hostname: configMgr.appConfig.host,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

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

    // 3. Dynamic OS Configuration Routes (Cloud-Init, Talos Config, Combustion)
    if (pathname.startsWith("/os/")) {
      return await handleOsConfigRoute(req, pathname, configMgr, registry);
    }

    // 4. Management & Webhook API Routes
    if (pathname.startsWith("/api/")) {
      return await handleApiRoute(req, pathname, configMgr, stateMgr);
    }

    // 5. Root / Info Page
    if (pathname === "/" || pathname === "/health") {
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
- iPXE Chain URL:     ${configMgr.appConfig.baseUrl}/boot.ipxe?mac=\${net0/mac}
- Asset Mirror:       ${configMgr.appConfig.baseUrl}/assets/
- Host API:           ${configMgr.appConfig.baseUrl}/api/hosts
- Phone-Home Webhook: ${configMgr.appConfig.baseUrl}/api/installed?mac=<MAC>
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
