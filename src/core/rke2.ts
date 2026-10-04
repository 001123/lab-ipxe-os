import type { HostConfig } from "../types.ts";
import { resolveKubernetesCidr } from "./cidr.ts";

export interface Rke2Common {
  defaultUser: string;
  clusterCidr: string;
  serviceCidr: string;
  clusterDns: string;
  configuredRke2Version: string;
  cni: string;
  ingress: string;
  sanEntries: string;
  tokenEntry: string;
  /** Shell snippets that pre-configure ArgoCD (+ optional GitOps root app). Empty when disabled. */
  argocdSnippets: string[];
  /** Shell snippets that install local-path-provisioner as the default StorageClass. Empty when disabled. */
  storageSnippets: string[];
}

export const DEFAULT_LOCAL_PATH_VERSION = "v0.0.37";

/**
 * Shared RKE2 server settings and ArgoCD/GitOps shell snippets, used by every OS provider.
 * `logTag` prefixes console messages, e.g. "Combustion RKE2" or "iPXE RKE2".
 */
export function buildRke2Common(host: HostConfig, logTag: string): Rke2Common {
  const defaultUser = host.user || "homelab";
  const { clusterCidr, serviceCidr, clusterDns } = resolveKubernetesCidr(host.custom);
  const configuredRke2Version = host.custom?.rke2_version || "";
  const configuredRke2Token = host.custom?.rke2_token || "";
  const cni = host.custom?.rke2_cni || "canal";
  const ingress = host.custom?.rke2_ingress || "traefik";

  const sans = Array.from(
    new Set([
      host.hostname,
      "127.0.0.1",
      "localhost",
      ...(host.network?.ip ? [host.network.ip] : []),
    ])
  );
  const sanEntries = sans.map((san) => `  - "${san}"`).join("\n");
  const tokenEntry = configuredRke2Token ? `token: "${configuredRke2Token}"\n` : "";

  // RKE2 (unlike K3s) ships no StorageClass; bundle local-path-provisioner unless disabled.
  const enableLocalPath = host.custom?.local_path !== false;
  const localPathVersion: string = host.custom?.local_path_version || DEFAULT_LOCAL_PATH_VERSION;
  const storageSnippets = enableLocalPath
    ? [
        `# Install local-path-provisioner (${localPathVersion}) as default StorageClass via RKE2 auto-deploy manifests
echo "[${logTag}] Fetching local-path-provisioner ${localPathVersion} manifest..." | (tee -a /dev/console 2>/dev/null || cat)
mkdir -p /var/lib/rancher/rke2/server/manifests
if curl -fsSL --retry 3 --connect-timeout 30 -o /tmp/local-path-storage.yaml "https://raw.githubusercontent.com/rancher/local-path-provisioner/${localPathVersion}/deploy/local-path-storage.yaml"; then
  awk '{ print } /^kind: StorageClass/ { sc = 1 } sc && /^  name: local-path$/ { print "  annotations:"; print "    storageclass.kubernetes.io/is-default-class: \\"true\\""; sc = 0 }' /tmp/local-path-storage.yaml > /var/lib/rancher/rke2/server/manifests/local-path-storage.yaml
  rm -f /tmp/local-path-storage.yaml
else
  echo "[${logTag}] WARNING: failed to download local-path-provisioner manifest, skipping." | (tee -a /dev/console 2>/dev/null || cat)
fi`,
      ]
    : [];

  const enableArgocd = host.custom?.argocd === true || host.custom?.enable_argocd === true;
  const argocdDomain =
    host.custom?.argocd_hostname ||
    (host.network?.ip ? `argocd.${host.network.ip}.nip.io` : `argocd.${host.hostname}.nip.io`);
  const ingressClassName = ingress.includes("nginx") ? "nginx" : ingress;
  const argocdVersion = host.custom?.argocd_version || "";
  const versionEntry = argocdVersion ? `  version: "${argocdVersion}"\n` : "";
  const gitopsRepo: string = host.custom?.gitops_repo || "";
  const gitopsBranch: string = host.custom?.gitops_branch || "HEAD";
  const gitopsPath: string = host.custom?.gitops_path || ".";
  const gitopsToken: string = host.custom?.gitops_token || "";
  const gitopsSshKey: string = host.custom?.gitops_ssh_key || "";

  let gitopsManifestSnippet = "";
  if (gitopsRepo) {
    let repoSecretYaml = "";
    if (gitopsToken) {
      repoSecretYaml = `
---
apiVersion: v1
kind: Secret
metadata:
  name: gitops-repo-creds
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
type: Opaque
stringData:
  type: git
  url: "${gitopsRepo}"
  username: "git"
  password: "${gitopsToken}"`;
    } else if (gitopsSshKey) {
      const indentedKey = gitopsSshKey
        .trim()
        .split("\n")
        .map((l: string) => `    ${l}`)
        .join("\n");
      repoSecretYaml = `
---
apiVersion: v1
kind: Secret
metadata:
  name: gitops-repo-creds
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
type: Opaque
stringData:
  type: git
  url: "${gitopsRepo}"
  sshPrivateKey: |
${indentedKey}`;
    }

    gitopsManifestSnippet = `cat <<'EOF' > /var/lib/rancher/rke2/server/manifests/argocd-root-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root-bootstrap
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: "${gitopsRepo}"
    targetRevision: "${gitopsBranch}"
    path: "${gitopsPath}"
  destination:
    server: "https://kubernetes.default.svc"
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
${repoSecretYaml}
EOF`;
  }

  const argocdSnippets = enableArgocd
    ? [
        `# 12. Pre-configure ArgoCD HelmChart auto-deploy manifest
echo "[${logTag}] Pre-configuring ArgoCD HelmChart auto-deploy manifest (${argocdDomain})..." | (tee -a /dev/console 2>/dev/null || cat)
mkdir -p /var/lib/rancher/rke2/server/manifests
cat <<'EOF' > /var/lib/rancher/rke2/server/manifests/argocd.yaml
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: argo-cd
  namespace: kube-system
spec:
  chart: argo-cd
  repo: https://argoproj.github.io/argo-helm
  targetNamespace: argocd
  createNamespace: true
${versionEntry}  valuesContent: |-
    global:
      domain: ${argocdDomain}
    configs:
      params:
        server.insecure: true
      cm:
        resource.customizations.health.networking.k8s.io_Ingress: |-
          hs = {}
          hs.status = "Healthy"
          return hs
    server:
      ingress:
        enabled: true
        ingressClassName: ${ingressClassName}
        hostname: ${argocdDomain}
        paths:
          - /
        pathType: Prefix
    controller:
      replicas: 1
    repoServer:
      replicas: 1
    applicationSet:
      replicas: 1
    redis:
      enabled: true
    dex:
      enabled: false
    notifications:
      enabled: false
EOF

# Fallback: if dynamic DHCP node IP detected, update nip.io domain if using hostname placeholder
if [ -n "\${NODE_IP:-}" ] && grep -q "argocd.${host.hostname}.nip.io" /var/lib/rancher/rke2/server/manifests/argocd.yaml; then
  sed -i "s|argocd.${host.hostname}.nip.io|argocd.\${NODE_IP}.nip.io|g" /var/lib/rancher/rke2/server/manifests/argocd.yaml
fi${gitopsManifestSnippet ? `\n\n${gitopsManifestSnippet}` : ""}`,

        `# 13. Install helper script to retrieve ArgoCD admin password and URL
mkdir -p /usr/local/bin
cat <<'EOF' > /usr/local/bin/get-argocd-password
#!/bin/sh
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
echo "=================================================="
echo "           ArgoCD Access Information              "
echo "=================================================="
echo "URL:      http://${argocdDomain}"
echo "Username: admin"
echo -n "Password: "
/var/lib/rancher/rke2/bin/kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d
echo ""
echo "=================================================="
EOF
chmod 755 /usr/local/bin/get-argocd-password || true
mkdir -p /usr/bin && ln -sf /usr/local/bin/get-argocd-password /usr/bin/get-argocd-password 2>/dev/null || true`,
      ]
    : [];

  return {
    defaultUser,
    clusterCidr,
    serviceCidr,
    clusterDns,
    configuredRke2Version,
    cni,
    ingress,
    sanEntries,
    tokenEntry,
    argocdSnippets,
    storageSnippets,
  };
}
