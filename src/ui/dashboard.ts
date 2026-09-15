/**
 * iPXE Autoinstall Hub - Dashboard HTML Renderer
 * Powered by Bulma CSS v1.0.4 & HTMX v4.0.0
 */

import type { HostConfig } from "../types.ts";

export interface DashboardHostItem {
  mac: string;
  hostname: string;
  ip?: string;
  os: string;
  version?: string;
  profile?: string;
  status: "PENDING" | "PROVISIONING" | "INSTALLED" | "FAILED";
  note?: string;
  installed_at?: string;
  updated_at?: string;
  isK8s?: boolean;
  rawConfig?: HostConfig;
}

export function renderNodeRow(host: DashboardHostItem, baseUrl: string): string {
  const rowId = `row-${host.mac.replace(/[:]/g, "")}`;
  const isK8s = Boolean(
    host.isK8s ||
    host.profile?.includes("k3s") ||
    host.profile?.includes("rke2") ||
    host.profile?.includes("k8s")
  );

  let statusBadge = "";
  if (host.status === "INSTALLED") {
    statusBadge = `
      <div class="status-badge-wrapper">
        <span class="tag is-success is-light">
          <svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>
          Installed
        </span>
        ${host.installed_at ? `<div class="date-subtext">${new Date(host.installed_at).toLocaleTimeString()} - ${new Date(host.installed_at).toLocaleDateString()}</div>` : ""}
      </div>
    `;
  } else if (host.status === "PROVISIONING") {
    statusBadge = `
      <span class="tag is-warning is-light">
        <span class="pulse-dot"></span>
        Provisioning...
      </span>
    `;
  } else if (host.status === "FAILED") {
    statusBadge = `
      <span class="tag is-danger is-light">
        <svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>
        Failed
      </span>
    `;
  } else {
    statusBadge = `
      <span class="tag is-info is-light">
        <svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>
        Pending
      </span>
    `;
  }

  const osName = host.os === "suse-micro" ? "openSUSE Leap Micro" : host.os === "ubuntu" ? "Ubuntu Server" : host.os;
  const osBadgeClass = host.os === "suse-micro" ? "tag-suse" : "tag-ubuntu";

  const cfg = host.rawConfig || ({} as any);
  const net = cfg.network || {};
  const stor = cfg.storage || {};
  const custom = cfg.custom || {};

  return `
    <tr id="${rowId}" class="host-row status-${host.status.toLowerCase()}">
      <td>
        <div class="hostname-title">${host.hostname || "unnamed"}</div>
        ${host.note ? `<div class="host-note">${host.note}</div>` : ""}
      </td>
      <td>
        <div class="has-text-weight-medium">${host.ip || (net.dhcp !== false ? "DHCP" : "Unset")}</div>
        <div class="mac-subtext font-mono">${host.mac}</div>
      </td>
      <td>
        <span class="tag ${osBadgeClass}">${osName} ${host.version || ""}</span>
        <div class="font-mono is-size-7 mt-1">${host.profile || "generic"}</div>
      </td>
      <td>
        ${statusBadge}
      </td>
      <td>
        <div class="actions-buttons">
          <button
            class="button is-link is-light is-small"
            type="button"
            onclick="openEditModalFromRow(this)"
            title="Edit node configuration"
            data-mac="${host.mac}"
            data-hostname="${host.hostname}"
            data-os="${host.os}"
            data-version="${host.version || ""}"
            data-profile="${host.profile || ""}"
            data-ip="${net.ip || host.ip || ""}"
            data-dhcp="${net.dhcp !== false ? "1" : "0"}"
            data-gateway="${net.gateway || ""}"
            data-netmask="${net.netmask || ""}"
            data-nameservers="${(net.nameservers || []).join(", ")}"
            data-disk="${stor.target_disk || "/dev/sda"}"
            data-note="${encodeURIComponent(host.note || "")}"
            data-k3s-version="${custom.k3s_version || ""}"
            data-rke2-version="${custom.rke2_version || ""}"
            data-argocd="${custom.argocd ? "1" : "0"}"
            data-gitops-repo="${custom.gitops_repo || ""}"
            data-gitops-branch="${custom.gitops_branch || ""}"
            data-gitops-path="${custom.gitops_path || ""}"
            data-argocd-hostname="${custom.argocd_hostname || ""}"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>Edit</span>
          </button>

          <button
            class="button is-warning is-light is-small"
            hx-post="${baseUrl}/api/reset?mac=${encodeURIComponent(host.mac)}"
            hx-target="#${rowId}"
            hx-swap="outerHTML"
            title="Reset install state to PENDING"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
            <span>Reset</span>
          </button>

          <button
            class="button is-danger is-light is-small"
            hx-delete="${baseUrl}/api/hosts/${encodeURIComponent(host.mac)}"
            hx-target="#${rowId}"
            hx-swap="outerHTML"
            hx-confirm="Bạn có chắc chắn muốn xoá vĩnh viễn node [${host.hostname || host.mac}] khỏi cơ sở dữ liệu không?"
            title="Delete node from database"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span>Delete</span>
          </button>

          ${
            isK8s && host.status === "INSTALLED"
              ? `<a
                  class="button is-info is-light is-small"
                  href="${baseUrl}/api/kubeconfig/${encodeURIComponent(host.hostname || host.mac)}"
                  target="_blank"
                  title="Download Kubeconfig"
                >
                  <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span>Kubeconfig</span>
                </a>`
              : ""
          }
        </div>
      </td>
    </tr>
  `;
}

export function renderNodesTablePartial(hosts: DashboardHostItem[], baseUrl: string): string {
  if (hosts.length === 0) {
    return `
      <tr>
        <td colspan="5" class="has-text-centered has-text-grey py-5">
          No hosts found in database. Click <strong>+ Add Node</strong> to register your first host.
        </td>
      </tr>
    `;
  }
  return hosts.map((h) => renderNodeRow(h, baseUrl)).join("\n");
}

export function renderDashboardHtml(context: {
  hosts: DashboardHostItem[];
  baseUrl: string;
  appConfig: any;
  stats: { total: number; installed: number; provisioning: number; pending: number };
}): string {
  const { hosts, baseUrl, stats } = context;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>iPXE Autoinstall Hub | Node Dashboard</title>
  
  <!-- Bulma CSS v1.0.4 -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css">
  
  <!-- Custom Styles (Public) -->
  <link rel="stylesheet" href="${baseUrl}/public/css/dashboard.css">
  
  <!-- HTMX v4.0.0 -->
  <script src="https://unpkg.com/htmx.org@4.0.0/dist/htmx.min.js"></script>
  
  <!-- Dashboard Script & Theme Controller (Public) -->
  <script src="${baseUrl}/public/js/dashboard.js"></script>
</head>
<body class="has-background-background">
  <div class="container is-max-desktop px-4 py-5">
    
    <!-- Navbar / Header -->
    <nav class="level mb-5 pb-4" style="border-bottom: 1px solid var(--bulma-border-weak, rgba(255,255,255,0.1));" role="navigation" aria-label="main navigation">
      <div class="level-left">
        <div class="level-item">
          <div class="is-flex is-align-items-center">
            <div class="brand-logo-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                <line x1="6" y1="6" x2="6.01" y2="6"/>
                <line x1="6" y1="18" x2="6.01" y2="18"/>
              </svg>
            </div>
            <div>
              <h1 class="title is-4 mb-0">iPXE Autoinstall Hub</h1>
              <p class="subtitle is-7 has-text-grey">Multi-OS Netboot &amp; Cloud-Init Engine (SQLite Full CRUD)</p>
            </div>
          </div>
        </div>
      </div>

      <div class="level-right">
        <div class="level-item is-flex is-align-items-center" style="gap: 0.75rem;">
          <span class="tag is-success is-light is-medium" style="border-radius: 9999px;">
            <svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>
            SQLite Live
          </span>
          <button
            id="theme-toggle-btn"
            class="button is-small is-light"
            onclick="toggleTheme()"
            title="Toggle Dark/Light Mode"
            style="border-radius: 9999px;"
          >
            <span id="theme-icon" class="icon is-small"></span>
            <span id="theme-text">Theme</span>
          </button>
        </div>
      </div>
    </nav>

    <!-- Stats Grid -->
    <div class="columns is-mobile is-multiline mb-5">
      <div class="column is-6-mobile is-3-tablet">
        <div class="box stat-box">
          <p class="heading has-text-grey">Total Nodes</p>
          <p class="title">${stats.total}</p>
        </div>
      </div>
      <div class="column is-6-mobile is-3-tablet">
        <div class="box stat-box">
          <p class="heading has-text-success">Installed</p>
          <p class="title has-text-success">${stats.installed}</p>
        </div>
      </div>
      <div class="column is-6-mobile is-3-tablet">
        <div class="box stat-box">
          <p class="heading has-text-warning">Provisioning</p>
          <p class="title has-text-warning">${stats.provisioning}</p>
        </div>
      </div>
      <div class="column is-6-mobile is-3-tablet">
        <div class="box stat-box">
          <p class="heading has-text-grey-light">Pending</p>
          <p class="title has-text-grey">${stats.pending}</p>
        </div>
      </div>
    </div>

    <!-- Table Toolbar -->
    <div class="level mb-3">
      <div class="level-left">
        <div class="level-item">
          <h2 class="title is-5 mb-0">Managed Nodes</h2>
        </div>
      </div>
      <div class="level-right">
        <div class="level-item is-flex is-align-items-center" style="gap: 0.75rem;">
          <button
            class="button is-primary is-small"
            onclick="openModal('add-node-modal')"
            title="Register a new host node"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span> Add Node</span>
          </button>

          <a
            class="button is-light is-small"
            href="${baseUrl}/api/export/yaml"
            download="hosts.yaml"
            title="Export all nodes to hosts.yaml backup"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Export YAML</span>
          </a>

          <button
            class="button is-light is-small"
            onclick="openModal('import-yaml-modal')"
            title="Import nodes from hosts.yaml backup"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span>Import YAML</span>
          </button>

          <label class="checkbox is-size-7 is-flex is-align-items-center" style="gap: 0.35rem;" title="Auto-refresh table every 3 seconds">
            <input
              type="checkbox"
              id="polling-toggle"
              onchange="handlePollingToggle(this)"
            >
            <span>Auto-polling (3s)</span>
          </label>

          <button
            class="button is-light is-small"
            hx-get="${baseUrl}/ui/nodes-table"
            hx-target="#nodes-table-body"
            hx-swap="innerHTML"
            title="Refresh table data"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Nodes Table -->
    <div class="box p-0 mb-5" style="overflow: hidden;">
      <div class="table-container mb-0">
        <table class="table is-fullwidth is-hoverable is-striped mb-0">
          <thead>
            <tr>
              <th>Node / Hostname</th>
              <th>Network</th>
              <th>OS &amp; Profile</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="nodes-table-body">
            ${renderNodesTablePartial(hosts, baseUrl)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Quick Info -->
    <div class="box">
      <h3 class="title is-6 mb-2">Quick Integration Links</h3>
      <div class="quick-code-box has-background-dark has-text-light mb-2">
        <span>iPXE Chainload URL: ${baseUrl}/boot.ipxe?mac=\${net0/mac}</span>
      </div>
      <div class="quick-code-box has-background-dark has-text-light mb-2">
        <span>REST API Create Host: curl -X POST "${baseUrl}/api/hosts" -H "Content-Type: application/json" -d '{"mac":"...","hostname":"..."}'</span>
      </div>
      <div class="quick-code-box has-background-dark has-text-light">
        <span>API Reset: curl -X POST "${baseUrl}/api/reset?mac=&lt;MAC&gt;"</span>
      </div>
    </div>

  </div>

  <!-- ===================================================================== -->
  <!-- Add Node Modal -->
  <!-- ===================================================================== -->
  <div id="add-node-modal" class="modal">
    <div class="modal-background" onclick="closeModal('add-node-modal')"></div>
    <div class="modal-card" style="max-width: 680px; width: 100%;">
      <header class="modal-card-head">
        <p class="modal-card-title is-size-5 mb-0">Add New Node</p>
        <button class="delete" aria-label="close" type="button" onclick="closeModal('add-node-modal')"></button>
      </header>
      <form id="add-node-form" hx-post="${baseUrl}/api/hosts" hx-target="#nodes-table-body" hx-swap="innerHTML">
        <section class="modal-card-body">
          <div class="columns is-multiline">
            <div class="column is-6 py-2">
              <label class="label is-small">MAC Address <span class="has-text-danger">*</span></label>
              <div class="control">
                <input class="input is-small font-mono" type="text" name="mac" placeholder="e.g. bc:24:11:00:24:40" required>
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Hostname <span class="has-text-danger">*</span></label>
              <div class="control">
                <input class="input is-small" type="text" name="hostname" placeholder="e.g. k3s-worker-01" required>
              </div>
            </div>

            <div class="column is-4 py-2">
              <label class="label is-small">Operating System</label>
              <div class="control">
                <div class="select is-small is-fullwidth">
                  <select name="os" onchange="handleOsChange(this, 'add')">
                    <option value="ubuntu" selected>Ubuntu Server</option>
                    <option value="suse-micro">openSUSE Leap Micro</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="column is-4 py-2">
              <label class="label is-small">OS Version</label>
              <div class="control">
                <input id="add-version" class="input is-small" type="text" name="version" value="24.04">
              </div>
            </div>
            <div class="column is-4 py-2">
              <label class="label is-small">Profile / Role</label>
              <div class="control">
                <div class="select is-small is-fullwidth">
                  <select name="profile">
                    <option value="generic">generic (standalone)</option>
                    <option value="k3s-single-node">k3s-single-node</option>
                    <option value="rke2-single-node">rke2-single-node</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="column is-6 py-2">
              <label class="label is-small">Static IP (Leave blank for DHCP)</label>
              <div class="control">
                <input class="input is-small font-mono" type="text" name="ip" placeholder="e.g. 192.168.250.40">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Gateway</label>
              <div class="control">
                <input class="input is-small font-mono" type="text" name="gateway" placeholder="e.g. 192.168.250.1">
              </div>
            </div>

            <div class="column is-6 py-2">
              <label class="label is-small">Subnet Netmask</label>
              <div class="control">
                <input class="input is-small font-mono" type="text" name="netmask" placeholder="255.255.255.0">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Nameservers (DNS)</label>
              <div class="control">
                <input class="input is-small font-mono" type="text" name="nameservers" placeholder="192.168.250.1, 1.1.1.1">
              </div>
            </div>

            <div class="column is-6 py-2">
              <label class="label is-small">Target Disk</label>
              <div class="control">
                <input class="input is-small font-mono" type="text" name="target_disk" value="/dev/sda">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Note / Description</label>
              <div class="control">
                <input class="input is-small" type="text" name="note" placeholder="e.g. VM Worker Node">
              </div>
            </div>

            <!-- GitOps & K8s Parameters -->
            <div class="column is-12 py-2">
              <div class="box p-3 has-background-dark-ter" style="border: 1px solid var(--bulma-border-weak, rgba(255,255,255,0.1));">
                <label class="checkbox is-size-7 has-text-weight-bold mb-2 is-block">
                  <input type="checkbox" name="argocd" value="true"> Enable ArgoCD &amp; GitOps Bootstrapping
                </label>
                <div class="columns is-multiline is-gapless mb-0">
                  <div class="column is-12 mb-2">
                    <input class="input is-small" type="text" name="gitops_repo" placeholder="GitOps Repo URL (https://github.com/...)">
                  </div>
                  <div class="column is-6 pr-1">
                    <input class="input is-small" type="text" name="gitops_branch" placeholder="Branch (e.g. main)">
                  </div>
                  <div class="column is-6 pl-1">
                    <input class="input is-small" type="text" name="gitops_path" placeholder="Path (e.g. apps or bootstrap)">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <footer class="modal-card-foot is-justify-content-flex-end">
          <button class="button is-small" type="button" onclick="closeModal('add-node-modal')">Cancel</button>
          <button class="button is-primary is-small" type="submit">Create Node</button>
        </footer>
      </form>
    </div>
  </div>

  <!-- ===================================================================== -->
  <!-- Edit Node Modal -->
  <!-- ===================================================================== -->
  <div id="edit-node-modal" class="modal">
    <div class="modal-background" onclick="closeModal('edit-node-modal')"></div>
    <div class="modal-card" style="max-width: 680px; width: 100%;">
      <header class="modal-card-head">
        <p class="modal-card-title is-size-5 mb-0">Edit Node Configuration</p>
        <button class="delete" aria-label="close" type="button" onclick="closeModal('edit-node-modal')"></button>
      </header>
      <form id="edit-node-form" onsubmit="submitEditNodeForm(event)">
        <section class="modal-card-body">
          <div class="columns is-multiline">
            <div class="column is-6 py-2">
              <label class="label is-small">MAC Address (Primary Key)</label>
              <div class="control">
                <input id="edit-mac" class="input is-small font-mono" type="text" name="mac" readonly style="background-color: var(--bulma-background-weak, rgba(0,0,0,0.05));">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Hostname <span class="has-text-danger">*</span></label>
              <div class="control">
                <input id="edit-hostname" class="input is-small" type="text" name="hostname" required>
              </div>
            </div>

            <div class="column is-4 py-2">
              <label class="label is-small">Operating System</label>
              <div class="control">
                <div class="select is-small is-fullwidth">
                  <select id="edit-os" name="os" onchange="handleOsChange(this, 'edit')">
                    <option value="ubuntu">Ubuntu Server</option>
                    <option value="suse-micro">openSUSE Leap Micro</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="column is-4 py-2">
              <label class="label is-small">OS Version</label>
              <div class="control">
                <input id="edit-version" class="input is-small" type="text" name="version">
              </div>
            </div>
            <div class="column is-4 py-2">
              <label class="label is-small">Profile / Role</label>
              <div class="control">
                <div class="select is-small is-fullwidth">
                  <select id="edit-profile" name="profile">
                    <option value="generic">generic (standalone)</option>
                    <option value="k3s-single-node">k3s-single-node</option>
                    <option value="rke2-single-node">rke2-single-node</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="column is-6 py-2">
              <label class="label is-small">Static IP (Leave blank for DHCP)</label>
              <div class="control">
                <input id="edit-ip" class="input is-small font-mono" type="text" name="ip" placeholder="Leave empty for DHCP">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Gateway</label>
              <div class="control">
                <input id="edit-gateway" class="input is-small font-mono" type="text" name="gateway">
              </div>
            </div>

            <div class="column is-6 py-2">
              <label class="label is-small">Subnet Netmask</label>
              <div class="control">
                <input id="edit-netmask" class="input is-small font-mono" type="text" name="netmask">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Nameservers (DNS)</label>
              <div class="control">
                <input id="edit-nameservers" class="input is-small font-mono" type="text" name="nameservers">
              </div>
            </div>

            <div class="column is-6 py-2">
              <label class="label is-small">Target Disk</label>
              <div class="control">
                <input id="edit-disk" class="input is-small font-mono" type="text" name="target_disk">
              </div>
            </div>
            <div class="column is-6 py-2">
              <label class="label is-small">Note / Description</label>
              <div class="control">
                <input id="edit-note" class="input is-small" type="text" name="note">
              </div>
            </div>

            <!-- GitOps & K8s Parameters -->
            <div class="column is-12 py-2">
              <div class="box p-3 has-background-dark-ter" style="border: 1px solid var(--bulma-border-weak, rgba(255,255,255,0.1));">
                <label class="checkbox is-size-7 has-text-weight-bold mb-2 is-block">
                  <input id="edit-argocd" type="checkbox" name="argocd" value="true"> Enable ArgoCD &amp; GitOps Bootstrapping
                </label>
                <div class="columns is-multiline is-gapless mb-0">
                  <div class="column is-12 mb-2">
                    <input id="edit-gitops-repo" class="input is-small" type="text" name="gitops_repo" placeholder="GitOps Repo URL (https://github.com/...)">
                  </div>
                  <div class="column is-6 pr-1">
                    <input id="edit-gitops-branch" class="input is-small" type="text" name="gitops_branch" placeholder="Branch (e.g. main)">
                  </div>
                  <div class="column is-6 pl-1">
                    <input id="edit-gitops-path" class="input is-small" type="text" name="gitops_path" placeholder="Path (e.g. apps or bootstrap)">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <footer class="modal-card-foot is-justify-content-flex-end">
          <button class="button is-small" type="button" onclick="closeModal('edit-node-modal')">Cancel</button>
          <button class="button is-link is-small" type="submit">Save Changes</button>
        </footer>
      </form>
    </div>
  </div>

  <!-- ===================================================================== -->
  <!-- Import YAML Modal -->
  <!-- ===================================================================== -->
  <div id="import-yaml-modal" class="modal">
    <div class="modal-background" onclick="closeModal('import-yaml-modal')"></div>
    <div class="modal-card" style="max-width: 580px; width: 100%;">
      <header class="modal-card-head">
        <p class="modal-card-title is-size-5 mb-0">Import Configuration from YAML</p>
        <button class="delete" aria-label="close" type="button" onclick="closeModal('import-yaml-modal')"></button>
      </header>
      <form id="import-yaml-form" onsubmit="submitImportYamlForm(event)">
        <section class="modal-card-body">
          <p class="is-size-7 has-text-grey mb-4">
            Upload a previously exported <code>hosts.yaml</code> or backup file. Nodes will be imported into the SQLite database.
          </p>

          <!-- File Upload Zone -->
          <div class="field mb-4">
            <label class="label is-small">YAML Backup File <span class="has-text-danger">*</span></label>
            <div class="file has-name is-small is-fullwidth">
              <label class="file-label">
                <input
                  class="file-input"
                  type="file"
                  id="import-yaml-file"
                  name="file"
                  accept=".yaml,.yml"
                  required
                  onchange="handleYamlFileSelect(this)"
                >
                <span class="file-cta">
                  <span class="file-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </span>
                  <span class="file-label">Choose file…</span>
                </span>
                <span class="file-name" id="import-yaml-filename">No file selected</span>
              </label>
            </div>
          </div>

          <!-- File Preview Details -->
          <div id="import-yaml-preview" class="box p-3 mb-4 is-hidden has-background-dark-ter" style="border: 1px solid var(--bulma-border-weak, rgba(255,255,255,0.1));">
            <div class="is-flex is-justify-content-space-between is-align-items-center mb-2">
              <span class="is-size-7 has-text-weight-bold">File Content Summary</span>
              <span id="import-node-count-badge" class="tag is-info is-small">0 nodes found</span>
            </div>
            <div id="import-preview-list" class="is-size-7 font-mono" style="max-height: 120px; overflow-y: auto;">
            </div>
          </div>

          <!-- Import Options -->
          <div class="box p-3 has-background-dark-ter" style="border: 1px solid var(--bulma-border-weak, rgba(255,255,255,0.1));">
            <p class="is-size-7 has-text-weight-bold mb-2">Import Options</p>
            
            <label class="checkbox is-size-7 is-flex is-align-items-center mb-2" style="gap: 0.4rem;">
              <input type="checkbox" id="import-update-defaults" name="updateDefaults" value="true" checked>
              <span>Update Global Defaults from file (<code>default:</code> section)</span>
            </label>

            <label class="checkbox is-size-7 is-flex is-align-items-center mb-2" style="gap: 0.4rem;">
              <input type="checkbox" id="import-reset-status" name="resetStatus" value="true">
              <span>Reset node statuses to <strong>PENDING</strong> (ready for reinstall)</span>
            </label>

            <label class="checkbox is-size-7 is-flex is-align-items-center" style="gap: 0.4rem;">
              <input type="checkbox" id="import-replace-all" name="replaceAll" value="true">
              <span class="has-text-danger">Replace All: Clear entire database before importing</span>
            </label>
          </div>
        </section>
        <footer class="modal-card-foot is-justify-content-flex-end">
          <button class="button is-small" type="button" onclick="closeModal('import-yaml-modal')">Cancel</button>
          <button id="import-submit-btn" class="button is-primary is-small" type="submit">
            <span>Import YAML</span>
          </button>
        </footer>
      </form>
    </div>
  </div>

</body>
</html>
  `;
}
