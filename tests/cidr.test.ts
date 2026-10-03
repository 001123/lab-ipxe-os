import { describe, expect, it } from "bun:test";
import {
  areCidrsOverlapping,
  calculateClusterDns,
  DEFAULT_CLUSTER_CIDR,
  DEFAULT_CLUSTER_DNS,
  DEFAULT_SERVICE_CIDR,
  intToIp,
  ipToInt,
  isIpInCidr,
  parseCidr,
  resolveKubernetesCidr,
  validateKubernetesCidr,
} from "../src/core/cidr.ts";

describe("Kubernetes CIDR Utility Tests", () => {
  describe("ipToInt & intToIp conversions", () => {
    it("should accurately convert valid IPv4 addresses to integer and back", () => {
      expect(intToIp(ipToInt("0.0.0.0"))).toBe("0.0.0.0");
      expect(intToIp(ipToInt("127.0.0.1"))).toBe("127.0.0.1");
      expect(intToIp(ipToInt("10.42.0.0"))).toBe("10.42.0.0");
      expect(intToIp(ipToInt("192.168.1.254"))).toBe("192.168.1.254");
      expect(intToIp(ipToInt("255.255.255.255"))).toBe("255.255.255.255");
    });

    it("should throw errors on invalid IPv4 addresses", () => {
      expect(() => ipToInt("10.42.0")).toThrow();
      expect(() => ipToInt("10.42.0.256")).toThrow();
      expect(() => ipToInt("10.42.0.-1")).toThrow();
      expect(() => ipToInt("abc.def.ghi.jkl")).toThrow();
    });
  });

  describe("parseCidr & isIpInCidr", () => {
    it("should parse valid CIDR blocks and calculate network and broadcast boundaries", () => {
      const parsed = parseCidr("10.42.0.0/16");
      expect(parsed.prefix).toBe(16);
      expect(intToIp(parsed.startInt)).toBe("10.42.0.0");
      expect(intToIp(parsed.endInt)).toBe("10.42.255.255");
    });

    it("should detect whether an IP is inside a CIDR block", () => {
      expect(isIpInCidr("10.42.0.1", "10.42.0.0/16")).toBe(true);
      expect(isIpInCidr("10.42.255.254", "10.42.0.0/16")).toBe(true);
      expect(isIpInCidr("10.43.0.1", "10.42.0.0/16")).toBe(false);
      expect(isIpInCidr("192.168.1.1", "10.42.0.0/16")).toBe(false);
    });

    it("should reject invalid CIDR formats and prefixes", () => {
      expect(() => parseCidr("10.42.0.0")).toThrow();
      expect(() => parseCidr("10.42.0.0/0")).toThrow();
      expect(() => parseCidr("10.42.0.0/33")).toThrow();
      expect(() => parseCidr("10.42.0.0/invalid")).toThrow();
    });
  });

  describe("areCidrsOverlapping", () => {
    it("should return false for distinct non-overlapping CIDRs", () => {
      expect(areCidrsOverlapping("10.42.0.0/16", "10.43.0.0/16")).toBe(false);
      expect(areCidrsOverlapping("10.244.0.0/16", "10.96.0.0/12")).toBe(false);
      expect(areCidrsOverlapping("172.16.0.0/16", "172.17.0.0/16")).toBe(false);
    });

    it("should return true when one CIDR contains or overlaps another", () => {
      // Direct overlap
      expect(areCidrsOverlapping("10.42.0.0/16", "10.42.10.0/24")).toBe(true);
      // Identical
      expect(areCidrsOverlapping("10.96.0.0/12", "10.96.0.0/12")).toBe(true);
      // Sibling overlap in supernet
      expect(areCidrsOverlapping("10.0.0.0/8", "10.43.0.0/16")).toBe(true);
    });
  });

  describe("calculateClusterDns", () => {
    it("should automatically calculate the 10th IP for standard service CIDRs", () => {
      expect(calculateClusterDns("10.43.0.0/16")).toBe("10.43.0.10");
      expect(calculateClusterDns("10.96.0.0/12")).toBe("10.96.0.10");
      expect(calculateClusterDns("172.20.0.0/16")).toBe("172.20.0.10");
    });

    it("should accept valid explicit Cluster DNS within the service CIDR", () => {
      expect(calculateClusterDns("10.96.0.0/12", "10.96.0.254")).toBe("10.96.0.254");
    });

    it("should reject explicit Cluster DNS outside the service CIDR", () => {
      expect(() => calculateClusterDns("10.96.0.0/12", "10.43.0.10")).toThrow(
        /not within Service CIDR/
      );
      expect(() => calculateClusterDns("10.43.0.0/16", "192.168.1.1")).toThrow(
        /not within Service CIDR/
      );
    });

    it("should reject overly small Service CIDRs unable to allocate .10", () => {
      expect(() => calculateClusterDns("10.43.0.0/29")).toThrow(/too small/);
    });
  });

  describe("resolveKubernetesCidr & validateKubernetesCidr", () => {
    it("should provide default Kubernetes network values when custom is empty", () => {
      const res = resolveKubernetesCidr({});
      expect(res.clusterCidr).toBe(DEFAULT_CLUSTER_CIDR);
      expect(res.serviceCidr).toBe(DEFAULT_SERVICE_CIDR);
      expect(res.clusterDns).toBe(DEFAULT_CLUSTER_DNS);

      const validation = validateKubernetesCidr({});
      expect(validation.valid).toBe(true);
      expect(validation.config?.clusterCidr).toBe(DEFAULT_CLUSTER_CIDR);
    });

    it("should support custom cluster_cidr and service_cidr with pod_cidr alias", () => {
      const res = resolveKubernetesCidr({
        pod_cidr: "10.244.0.0/16",
        service_cidr: "10.96.0.0/12",
      });
      expect(res.clusterCidr).toBe("10.244.0.0/16");
      expect(res.serviceCidr).toBe("10.96.0.0/12");
      expect(res.clusterDns).toBe("10.96.0.10");
    });

    it("should reject overlapping cluster and service CIDRs", () => {
      const validation = validateKubernetesCidr({
        cluster_cidr: "10.42.0.0/16",
        service_cidr: "10.42.100.0/24",
      });
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("overlap");
    });

    it("should reject invalid cluster DNS outside service CIDR", () => {
      const validation = validateKubernetesCidr({
        service_cidr: "10.96.0.0/12",
        cluster_dns: "172.16.0.10",
      });
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain("not within Service CIDR");
    });
  });
});
