import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { runSyncAssets } from "./scripts/sync-assets.ts";

export interface ParsedCliConfig {
  action: "server" | "sync-assets" | "help" | "version";
  port: number;
  host: string;
  baseUrl: string;
  configPath: string;
  dataDir: string;
  dbPath: string;
  assetsDir: string;
  logDir: string;
  ipxeMenuTimeout: number;
  autoSync: boolean;
  syncOs?: string;
  syncAssetsArgs: string[];
}

export function printHelp(): void {
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  🚀 Bun Multi-OS iPXE & Cloud-Init Server (Standalone)      │
└─────────────────────────────────────────────────────────────┘

USAGE:
  lab-ipxe-os [command] [options]

COMMANDS:
  (default)            Start iPXE Web Server & Cloud-Init Engine
  sync-assets          Download, verify & extract OS ISOs / Kernels
  help                 Display this help information
  version              Display application version

OPTIONS:
  -p, --port <number>       Port to listen on (Default: 3000 or $PORT)
  -h, --host <ip>           Host address to bind to (Default: 0.0.0.0 or $HOST)
      --base-url <url>      Base URL exposed to PXE clients (Default: $BASE_URL or http://<host>:<port>)
  -c, --config <file>       Path to hosts.yaml configuration (Default: $CONFIG_PATH or ./config/hosts.yaml)
      --data-dir <dir>      Directory for SQLite database (Default: $DATA_DIR or ./data)
      --db-path <file>      Direct path to SQLite database file (Default: <data-dir>/state.db)
      --assets-dir <dir>    Directory for ISOs & Kernels (Default: $ASSETS_DIR or ./assets)
      --log-dir <dir>       Directory for server log files (Default: $LOG_DIR or ./logs)
      --ipxe-timeout <sec>  iPXE menu timeout in seconds (Default: $IPXE_MENU_TIMEOUT or 5)
      --sync-os <names>     Target OS(es) to sync on startup (e.g. 'ubuntu', 'talos', 'all', 'none') (Default: smart auto-detect)
      --no-sync             Disable automatic asset download check on server startup
  -?, --help                Show help screen
  -v, --version             Show version

EXAMPLES:
  # Start server on default port 3000
  lab-ipxe-os

  # Start server on custom port & data directories
  lab-ipxe-os --port 8080 --data-dir /var/lib/ipxe/data --assets-dir /mnt/storage/assets

  # Download and prepare OS ISOs directly without Bun installed
  lab-ipxe-os sync-assets --download

  # Extract Ubuntu 24.04 kernel & initrd from ISO
  lab-ipxe-os sync-assets ubuntu --extract
`);
}

export function parseCli(args: string[] = process.argv.slice(2)): ParsedCliConfig {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: false,
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
        "base-url": { type: "string" },
        config: { type: "string", short: "c" },
        "data-dir": { type: "string" },
        "db-path": { type: "string" },
        "assets-dir": { type: "string" },
        "log-dir": { type: "string" },
        "ipxe-timeout": { type: "string" },
        "sync-os": { type: "string" },
        "auto-sync": { type: "boolean" },
        "no-sync": { type: "boolean" },
        "no-download": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err: any) {
    console.error(`CLI Error: ${err.message}`);
    console.error(`Run 'lab-ipxe-os --help' for usage.`);
    process.exit(1);
  }

  const values = parsed.values;
  const positionals = parsed.positionals;

  let action: ParsedCliConfig["action"] = "server";
  if (values.help || positionals[0] === "help") {
    action = "help";
  } else if (values.version || positionals[0] === "version") {
    action = "version";
  } else if (positionals[0] === "sync-assets") {
    action = "sync-assets";
  }

  const isTest = process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test";
  const defaultPort = isTest ? "0" : "3000";
  const port = parseInt(values.port || process.env.PORT || defaultPort, 10);
  const host = values.host || process.env.HOST || "0.0.0.0";
  const baseUrl = (values["base-url"] || process.env.BASE_URL || `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`).replace(/\/+$/, "");

  const dataDir = resolve(values["data-dir"] || process.env.DATA_DIR || "./data");
  const dbPath = resolve(values["db-path"] || process.env.DB_PATH || join(dataDir, "state.db"));
  const assetsDir = resolve(values["assets-dir"] || process.env.ASSETS_DIR || "./assets");
  const logDir = resolve(values["log-dir"] || process.env.LOG_DIR || "./logs");
  const configPath = resolve(values.config || process.env.CONFIG_PATH || "./config/hosts.yaml");
  const ipxeMenuTimeout = parseInt(values["ipxe-timeout"] || process.env.IPXE_MENU_TIMEOUT || "5", 10);

  const disabledByFlag = values["no-sync"] === true || values["no-download"] === true;
  const disabledByEnv = process.env.NO_SYNC === "true" || process.env.AUTO_SYNC === "false";
  const autoSync = !disabledByFlag && !disabledByEnv;
  const syncOs = (values["sync-os"] as string | undefined) || process.env.SYNC_OS;

  const syncAssetsIdx = args.indexOf("sync-assets");
  const syncAssetsArgs = syncAssetsIdx !== -1 ? args.slice(syncAssetsIdx + 1) : [];

  return {
    action,
    port,
    host,
    baseUrl,
    configPath,
    dataDir,
    dbPath,
    assetsDir,
    logDir,
    ipxeMenuTimeout,
    autoSync,
    syncOs,
    syncAssetsArgs,
  };
}
