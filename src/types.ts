export interface StorageConfig {
  target_disk?: string;
  layout?: "direct" | "lvm";
  swap_size?: number | string;
}

export interface NetworkConfig {
  dhcp?: boolean;
  ip?: string;
  netmask?: string;
  gateway?: string;
  nameservers?: string[];
  interface?: string;
}

export interface HostConfig {
  mac: string;
  hostname: string;
  os: string;
  version?: string;
  profile?: string;
  role?: string;
  user?: string;
  password_hash?: string;
  ssh_authorized_keys?: string[];
  storage?: StorageConfig;
  network?: NetworkConfig;
  extra_packages?: string[];
  force_install?: boolean;
  note?: string;
  custom?: Record<string, any>;
}

export interface DefaultHostConfig extends Omit<Partial<HostConfig>, "mac"> {
  os: string;
  version?: string;
}

export interface HostsFileStructure {
  default: DefaultHostConfig;
  hosts?: Record<string, Partial<HostConfig>>;
}

export interface BootContext {
  mac: string;
  clientIp?: string;
  baseUrl: string;
  hostConfig: HostConfig;
  isInstalled: boolean;
  timeoutSeconds: number;
}

export interface HostContext {
  mac: string;
  baseUrl: string;
  hostConfig: HostConfig;
}

export type NodeStatus = "PENDING" | "PROVISIONING" | "INSTALLED" | "FAILED";

export interface NodeRecord {
  mac: string;
  hostname?: string;
  ip?: string;
  os?: string;
  status: NodeStatus;
  note?: string;
  installed_at?: string;
  updated_at: string;
}

export interface StateRecord {
  mac: string;
  hostname?: string;
  os?: string;
  installed_at: string;
  client_ip?: string;
  note?: string;
  status?: NodeStatus;
}

export interface AppState {
  installed: Record<string, StateRecord>;
}

export interface OSProvider {
  readonly id: string;
  readonly name: string;
  renderIpxe(ctx: BootContext): string;
  handleConfig(subpath: string, req: Request, ctx: HostContext): Promise<Response> | Response;
}
