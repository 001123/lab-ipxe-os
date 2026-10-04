import { describe, it, expect } from "bun:test";
import { getUbuntuProfile } from "../src/providers/ubuntu/profiles/index.ts";
import type { HostConfig } from "../src/types.ts";

function decodeSetupScript(lateCommands: string[]): string {
  const cmd = lateCommands.find((c) => c.includes("rke2-setup.sh"));
  expect(cmd).toBeDefined();
  const encoded = cmd!.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1]!;
  return Buffer.from(encoded, "base64").toString("utf-8");
}

describe("Ubuntu rke2-single-node profile", () => {
  const host = {
    hostname: "rke2-node",
    os: "ubuntu",
    profile: "rke2-single-node",
    network: { ip: "10.0.0.50" },
    custom: { rke2_version: "v1.31.5+rke2r1", rke2_cni: "cilium", argocd: true },
  } as unknown as HostConfig;

  it("resolves without falling back to generic", () => {
    const spec = getUbuntuProfile("rke2-single-node", host, "http://x");
    expect(spec.lateCommands.some((c) => c.includes("rke2-setup.sh"))).toBe(true);
  });

  it("generates RKE2 config, pinned install and ArgoCD manifest", () => {
    const script = decodeSetupScript(getUbuntuProfile("rke2-single-node", host, "http://x").lateCommands);
    expect(script).toContain('cni: "cilium"');
    expect(script).toContain('  - "10.0.0.50"');
    expect(script).toContain('INSTALL_RKE2_VERSION="v1.31.5+rke2r1"');
    expect(script).toContain("INSTALL_RKE2_METHOD=tar");
    expect(script).toContain("systemctl enable rke2-server.service");
    expect(script).toContain("argocd.10.0.0.50.nip.io");
    expect(script).toContain("local-path-provisioner/v0.0.37/deploy/local-path-storage.yaml");
    expect(script).toContain("storageclass.kubernetes.io/is-default-class");
  });

  it("skips local-path-provisioner when local_path is false", () => {
    const noLp = { ...host, custom: { local_path: false } } as unknown as HostConfig;
    const script = decodeSetupScript(getUbuntuProfile("rke2-single-node", noLp, "http://x").lateCommands);
    expect(script).not.toContain("local-path-storage.yaml");
  });

  it("defaults to the stable channel without rke2_version", () => {
    const plain = { ...host, custom: {} } as HostConfig;
    const script = decodeSetupScript(getUbuntuProfile("rke2-single-node", plain, "http://x").lateCommands);
    expect(script).toContain("INSTALL_RKE2_CHANNEL=stable");
    expect(script).not.toContain("argocd.yaml");
  });
});
