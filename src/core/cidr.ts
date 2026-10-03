/**
 * CIDR and IP utilities for Kubernetes cluster networking (K3s / RKE2).
 */

export const DEFAULT_CLUSTER_CIDR = "10.42.0.0/16";
export const DEFAULT_SERVICE_CIDR = "10.43.0.0/16";
export const DEFAULT_CLUSTER_DNS = "10.43.0.10";

export interface KubernetesCidrConfig {
  clusterCidr: string;
  serviceCidr: string;
  clusterDns: string;
}

/**
 * Converts an IPv4 dotted-decimal string into an unsigned 32-bit integer.
 */
export function ipToInt(ip: string): number {
  const trimmed = ip.trim();
  const parts = trimmed.split(".");
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: "${ip}". Must contain 4 octets.`);
  }
  let num = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`Invalid IPv4 address: "${ip}". Non-numeric octet.`);
    }
    const octet = parseInt(part, 10);
    if (octet < 0 || octet > 255) {
      throw new Error(`Invalid IPv4 address: "${ip}". Octet ${octet} out of range (0-255).`);
    }
    num = ((num << 8) | octet) >>> 0;
  }
  return num;
}

/**
 * Converts an unsigned 32-bit integer into an IPv4 dotted-decimal string.
 */
export function intToIp(int: number): string {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255,
  ].join(".");
}

/**
 * Parses and validates an IPv4 CIDR string (e.g. 10.42.0.0/16).
 */
export function parseCidr(cidr: string): {
  ip: string;
  prefix: number;
  startInt: number;
  endInt: number;
} {
  const trimmed = cidr.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid CIDR format: "${cidr}". Expected format: A.B.C.D/M`);
  }
  const [ipStr, prefixStr] = parts;
  if (!/^\d+$/.test(prefixStr)) {
    throw new Error(`Invalid CIDR prefix: "/${prefixStr}" in "${cidr}". Prefix must be numeric.`);
  }
  const prefix = parseInt(prefixStr, 10);
  if (prefix < 1 || prefix > 32) {
    throw new Error(`CIDR prefix out of range (1-32): "/${prefix}" in "${cidr}".`);
  }
  const ipInt = ipToInt(ipStr);
  const mask = prefix === 32 ? 0xffffffff : ((~0 << (32 - prefix)) >>> 0);
  const startInt = (ipInt & mask) >>> 0;
  const endInt = (startInt | ((~mask) >>> 0)) >>> 0;

  return {
    ip: ipStr,
    prefix,
    startInt,
    endInt,
  };
}

/**
 * Checks if a specific IPv4 address falls within a given CIDR block.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const ipInt = ipToInt(ip);
    const { startInt, endInt } = parseCidr(cidr);
    return ipInt >= startInt && ipInt <= endInt;
  } catch {
    return false;
  }
}

/**
 * Determines whether two IPv4 CIDR blocks overlap with each other.
 */
export function areCidrsOverlapping(cidr1: string, cidr2: string): boolean {
  const c1 = parseCidr(cidr1);
  const c2 = parseCidr(cidr2);
  return c1.startInt <= c2.endInt && c2.startInt <= c1.endInt;
}

/**
 * Calculates the Cluster DNS IP address for a given Service CIDR block.
 * Defaults to the 10th IP address in the Service CIDR (e.g. 10.96.0.0/12 -> 10.96.0.10).
 */
export function calculateClusterDns(serviceCidr: string, explicitDns?: string): string {
  if (explicitDns && explicitDns.trim()) {
    const dns = explicitDns.trim();
    ipToInt(dns); // validates IPv4 format
    if (!isIpInCidr(dns, serviceCidr)) {
      throw new Error(`Cluster DNS "${dns}" is not within Service CIDR "${serviceCidr}".`);
    }
    return dns;
  }

  const { startInt, endInt, prefix } = parseCidr(serviceCidr);
  if (prefix > 28) {
    throw new Error(
      `Service CIDR "${serviceCidr}" (/${prefix}) is too small to automatically allocate the .10 Cluster DNS address.`
    );
  }

  const dnsInt = (startInt + 10) >>> 0;
  if (dnsInt > endInt) {
    throw new Error(`Calculated Cluster DNS for "${serviceCidr}" exceeds subnet boundary.`);
  }

  return intToIp(dnsInt);
}

/**
 * Resolves Kubernetes network CIDR configuration from custom properties,
 * applying defaults and strictly validating boundaries and non-overlap.
 */
export function resolveKubernetesCidr(custom?: Record<string, any>): KubernetesCidrConfig {
  const clusterCidrRaw = (
    custom?.cluster_cidr?.toString()?.trim() ||
    custom?.pod_cidr?.toString()?.trim() ||
    DEFAULT_CLUSTER_CIDR
  );

  const serviceCidrRaw = (
    custom?.service_cidr?.toString()?.trim() ||
    DEFAULT_SERVICE_CIDR
  );

  const clusterDnsRaw = custom?.cluster_dns?.toString()?.trim() || undefined;

  // Validate CIDR formats
  parseCidr(clusterCidrRaw);
  parseCidr(serviceCidrRaw);

  // Validate non-overlap between Pod and Service CIDRs
  if (areCidrsOverlapping(clusterCidrRaw, serviceCidrRaw)) {
    throw new Error(
      `Pod/Cluster CIDR "${clusterCidrRaw}" and Service CIDR "${serviceCidrRaw}" overlap. Kubernetes requires distinct non-overlapping subnets.`
    );
  }

  // Resolve and validate Cluster DNS
  const clusterDns = calculateClusterDns(serviceCidrRaw, clusterDnsRaw);

  return {
    clusterCidr: clusterCidrRaw,
    serviceCidr: serviceCidrRaw,
    clusterDns,
  };
}

/**
 * Validates Kubernetes CIDR settings safely returning success status and error message.
 */
export function validateKubernetesCidr(custom?: Record<string, any>): {
  valid: boolean;
  error?: string;
  config?: KubernetesCidrConfig;
} {
  try {
    const config = resolveKubernetesCidr(custom);
    return { valid: true, config };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
