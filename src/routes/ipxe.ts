import type { ConfigManager } from "../config.ts";
import type { StateManager } from "../core/state.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { BootContext } from "../types.ts";

export function handleIpxeRoute(
  req: Request,
  configMgr: ConfigManager,
  stateMgr: StateManager,
  registry: ProviderRegistry
): Response {
  const url = new URL(req.url);
  const macParam =
    url.searchParams.get("mac") ||
    url.searchParams.get("net0/mac") ||
    req.headers.get("x-ipxe-mac") ||
    "00:00:00:00:00:00";

  const cleanMac = configMgr.normalizeMac(macParam);
  const host = configMgr.getHost(cleanMac);
  const isInstalled = stateMgr.isInstalled(cleanMac);
  const forceInstall = Boolean(host.force_install || url.searchParams.get("force") === "true");

  // Get Client IP
  const clientIp =
    url.searchParams.get("ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown";

  const baseUrl = configMgr.appConfig.baseUrl;
  const timeoutMs = (configMgr.appConfig.ipxeMenuTimeout || 5) * 1000;

  // Case 1: Machine already marked as installed and not forced -> Direct local boot
  if (isInstalled && !forceInstall) {
    const script = `#!ipxe
echo ==========================================================
echo Node [${host.hostname}] (${cleanMac}) is ALREADY INSTALLED.
echo Bypassing network installation. Booting local disk...
echo (To reinstall, trigger API: POST ${baseUrl}/api/reset?mac=${cleanMac})
echo ==========================================================
sleep 2
sanboot --no-describe --drive 0x80 || exit 1
`;
    return new Response(script, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Case 2: Resolve OS Provider
  const osName = host.os || "ubuntu";
  const provider = registry.get(osName);

  if (!provider) {
    const errorScript = `#!ipxe
echo ==========================================================
echo ERROR: Unsupported OS '${osName}' configured for ${cleanMac}
echo Available OS providers: ${registry.getAll().map((p) => p.id).join(", ")}
echo ==========================================================
shell
`;
    return new Response(errorScript, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const bootCtx: BootContext = {
    mac: cleanMac,
    clientIp,
    baseUrl,
    hostConfig: host,
    isInstalled,
    timeoutSeconds: configMgr.appConfig.ipxeMenuTimeout,
  };

  const installScriptBody = provider.renderIpxe(bootCtx);

  // Auto install determination: if ?auto=1 or host config auto_install is true or not yet installed
  const autoInstall = url.searchParams.get("auto") === "1" || host.custom?.auto_install === true || !isInstalled;
  const defaultOption = autoInstall ? "install" : "local";

  const menuScript = `#!ipxe
# ==========================================================
# Bun Multi-OS iPXE Bootloader
# Target Node: ${host.hostname} (${cleanMac})
# Target OS:   ${provider.name} ${host.version || ""}
# Role/Profile: ${host.profile || host.role || "default"}
# ==========================================================

set menu-timeout ${timeoutMs}
set menu-default ${defaultOption}

:start
menu Network Boot Menu for ${host.hostname} [${cleanMac}]
item --gap --             ---------------- Operating System ----------------
item install              Install ${provider.name} ${host.version || ""} [${host.profile || host.role || "default"}]
item --gap --             ---------------- System Options ----------------
item local                (Default) Boot from Local Hard Drive
item shell                Drop to iPXE interactive shell
item reboot               Reboot machine
choose --timeout \${menu-timeout} --default \${menu-default} target && goto \${target}

:local
echo Booting from local hard drive...
sanboot --no-describe --drive 0x80 || exit 1

:shell
echo Dropping into iPXE shell. Type 'exit' to return to menu.
shell
goto start

:reboot
reboot

:install
goto run_install

:run_install
${installScriptBody.replace(/^#!ipxe\s*/m, "")}
`;

  return new Response(menuScript, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
