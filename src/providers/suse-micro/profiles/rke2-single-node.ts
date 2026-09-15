import type { HostConfig } from "../../../types.ts";
import type { SuseProfileSpec } from "./types.ts";

export function getRke2SingleNodeProfile(host: HostConfig, _baseUrl: string): SuseProfileSpec {
  const defaultUser = host.user || "homelab";
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

  let additionalAppsYaml = "";
  if (gitopsRepo) {
    additionalAppsYaml = `
      additionalApplications:
        - name: root-bootstrap
          namespace: argocd
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
              selfHeal: true`;
  }

  let repoCredsYaml = "";
  if (gitopsRepo && (gitopsToken || gitopsSshKey)) {
    if (gitopsToken) {
      repoCredsYaml = `
      repositories:
        root-repo:
          url: "${gitopsRepo}"
          username: "git"
          password: "${gitopsToken}"`;
    } else if (gitopsSshKey) {
      const indentedKey = gitopsSshKey
        .trim()
        .split("\n")
        .map((l: string) => `            ${l}`)
        .join("\n");
      repoCredsYaml = `
      repositories:
        root-repo:
          url: "${gitopsRepo}"
          sshPrivateKey: |
${indentedKey}`;
    }
  }

  const argocdSnippets = enableArgocd
    ? [
        `# 12. Pre-configure ArgoCD HelmChart auto-deploy manifest
echo "[Combustion RKE2] Pre-configuring ArgoCD HelmChart auto-deploy manifest (${argocdDomain})..." | (tee -a /dev/console 2>/dev/null || cat)
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
        server.insecure: true${repoCredsYaml}
    server:
      ingress:
        enabled: true
        ingressClassName: ${ingressClassName}
        hostname: ${argocdDomain}
        paths:
          - /
        pathType: Prefix${additionalAppsYaml}
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
fi`,

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
    packages: [
      "curl",
      "ca-certificates",
      "tar",
      "gzip",
      "qemu-guest-agent",
      "nfs-client",
      "open-iscsi",
      "efibootmgr",
    ],
    scriptSnippets: [
      `# 1. Expand Btrfs root filesystem to full disk capacity`,
      `echo "[Combustion RKE2] Resizing Btrfs root filesystem..." | (tee -a /dev/console 2>/dev/null || cat)`,
      `btrfs filesystem resize max / || true`,

      `# 2. Disable Swap for Kubernetes compliance`,
      `sed -i '/ swap / s/^\\(.*\\)$/#\\1/g' /etc/fstab || true`,
      `swapoff -a || true`,

      `# 3. Disable Firewalld to prevent port & CNI packet filtering conflicts`,
      `echo "[Combustion RKE2] Disabling firewalld for clean CNI networking..." | (tee -a /dev/console 2>/dev/null || cat)`,
      `systemctl disable firewalld || true`,
      `systemctl stop firewalld || true`,

      `# 4. Configure Sysctl for Kubernetes networking`,
      `mkdir -p /etc/sysctl.d
cat <<'EOF' > /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system || true`,

      `# 5. Pre-load required Kernel Modules`,
      `mkdir -p /etc/modules-load.d
cat <<'EOF' > /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay || true
modprobe br_netfilter || true`,

      `# 6. Configure SELinux for RKE2 compatibility on Leap Micro 6.2`,
      `sed -i 's/^SELINUX=enforcing/SELINUX=permissive/' /etc/selinux/config 2>/dev/null || true`,
      `setenforce 0 2>/dev/null || true`,

      `# 7. Pre-create RKE2 declarative configuration`,
      `mkdir -p /etc/rancher/rke2`,
      `cat <<'EOF' > /etc/rancher/rke2/config.yaml
write-kubeconfig-mode: "0644"
selinux: false
cni: "${cni}"
ingress-controller:
  - "${ingress}"
${tokenEntry}tls-san:
${sanEntries}
EOF`,

      `# 7. Fallback runtime check: append active DHCP IP to tls-san if not already present`,
      `NODE_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}' || true)
if [ -n "\${NODE_IP:-}" ] && ! grep -q "\$NODE_IP" /etc/rancher/rke2/config.yaml; then
  echo "  - \\"\$NODE_IP\\"" >> /etc/rancher/rke2/config.yaml
fi`,

      `# 8. Install RKE2 using official RPM method for openSUSE Leap Micro`,
      `echo "[Combustion RKE2] Installing RKE2 (${configuredRke2Version || "channel: v1.36"}) with RPM method..." | (tee -a /dev/console 2>/dev/null || cat)`,
      configuredRke2Version
        ? `export TRANSACTIONAL_UPDATE=true; curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=rpm INSTALL_RKE2_TYPE=server INSTALL_RKE2_VERSION="${configuredRke2Version}" sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`
        : `export TRANSACTIONAL_UPDATE=true; curl -sfL https://get.rke2.io | INSTALL_RKE2_METHOD=rpm INSTALL_RKE2_TYPE=server INSTALL_RKE2_CHANNEL=v1.36 sh - 2>&1 | (tee -a /dev/console 2>/dev/null || cat)`,

      `# 9. Enable RKE2 and QEMU guest agent systemd services`,
      `systemctl enable rke2-server.service || true`,
      `systemctl enable qemu-guest-agent || true`,

      `# 10. Configure CLI environment and PATH for homelab user and root`,
      `echo "KUBECONFIG=/etc/rancher/rke2/rke2.yaml" >> /etc/environment`,
      `mkdir -p /etc/profile.d
cat <<'EOF' > /etc/profile.d/rke2.sh
export PATH=$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin
export KUBECONFIG=/etc/rancher/rke2/rke2.yaml
EOF`,

      `# 11. Symlink ~/.kube/config for convenient kubectl access`,
      `mkdir -p "/home/${defaultUser}/.kube" /root/.kube`,
      `ln -sf /etc/rancher/rke2/rke2.yaml "/home/${defaultUser}/.kube/config"`,
      `ln -sf /etc/rancher/rke2/rke2.yaml /root/.kube/config`,
      `chown -R "${defaultUser}:${defaultUser}" "/home/${defaultUser}/.kube" || true`,
      ...argocdSnippets,
    ],
  };
}
