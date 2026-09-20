import type { OSProvider } from "./base.ts";
import { UbuntuProvider } from "./ubuntu/index.ts";
import { TalosProvider } from "./talos/index.ts";
import { SuseMicroProvider } from "./suse-micro/index.ts";
import { ProxmoxProvider } from "./proxmox/index.ts";

export class ProviderRegistry {
  private providers: Map<string, OSProvider> = new Map();
  private aliases: Map<string, string> = new Map();

  constructor() {
    this.register(new UbuntuProvider(), ["ubuntu", "ubuntu-server"]);
    this.register(new TalosProvider(), ["talos", "talos-linux", "taloslinux"]);
    this.register(new SuseMicroProvider(), [
      "suse-micro",
      "suse",
      "opensuse",
      "leap-micro",
      "microos",
      "suse_micro",
    ]);
    this.register(new ProxmoxProvider(), ["proxmox", "proxmox-ve", "pve"]);
  }

  public register(provider: OSProvider, aliases: string[] = []): void {
    this.providers.set(provider.id.toLowerCase(), provider);
    for (const alias of aliases) {
      this.aliases.set(alias.toLowerCase(), provider.id.toLowerCase());
    }
  }

  public get(name: string): OSProvider | undefined {
    const cleanName = name.trim().toLowerCase();
    const resolvedId = this.aliases.get(cleanName) || cleanName;
    return this.providers.get(resolvedId);
  }

  public getAll(): OSProvider[] {
    return Array.from(this.providers.values());
  }
}
