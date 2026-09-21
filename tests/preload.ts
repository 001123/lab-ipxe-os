import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "lab-ipxe-os-test-"));
const dataDir = join(root, "data");
const logDir = join(root, "logs");
mkdirSync(dataDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

process.env.NODE_ENV = "test";
process.env.BUN_ENV = "test";
if (!process.env.PORT) {
  process.env.PORT = "0";
}

process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, "state.db");
process.env.LOG_DIR = logDir;
process.env.CONFIG_PATH = resolve(process.cwd(), "config", "hosts.example.yaml");
