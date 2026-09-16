/**
 * iPXE Hub - Dashboard HTML Renderer
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

  const cfg = host.rawConfig || (host as any);
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
            data-custom="${encodeURIComponent(JSON.stringify(custom || {}))}"
            data-ssh-keys="${encodeURIComponent(JSON.stringify(cfg.ssh_authorized_keys || []))}"
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
            hx-confirm="Bạn có chắc chắn muốn đặt lại trạng thái node [${host.hostname || host.mac}] về PENDING không?"
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

export interface DashboardStats {
  total: number;
  installed: number;
  provisioning: number;
  pending: number;
}

export function renderStatsGridPartial(stats: DashboardStats): string {
  return `
    <div class="column is-6-mobile is-3-tablet">
      <div class="box stat-box stat-clickable is-flex is-align-items-center is-justify-content-space-between" data-stat="total" data-val="${stats.total}" onclick="filterGridByStatus('all', this)" title="Show all nodes">
        <div class="is-flex is-align-items-center">
          <span class="stat-indicator-dot dot-total"></span>
          <p class="heading has-text-grey">Total Nodes</p>
        </div>
        <p class="title stat-number">${stats.total}</p>
      </div>
    </div>
    <div class="column is-6-mobile is-3-tablet">
      <div class="box stat-box stat-clickable is-flex is-align-items-center is-justify-content-space-between" data-stat="installed" data-val="${stats.installed}" onclick="filterGridByStatus('installed', this)" title="Filter installed nodes">
        <div class="is-flex is-align-items-center">
          <span class="stat-indicator-dot dot-installed"></span>
          <p class="heading has-text-success">Installed</p>
        </div>
        <p class="title has-text-success stat-number">${stats.installed}</p>
      </div>
    </div>
    <div class="column is-6-mobile is-3-tablet">
      <div class="box stat-box stat-clickable is-flex is-align-items-center is-justify-content-space-between" data-stat="provisioning" data-val="${stats.provisioning}" onclick="filterGridByStatus('provisioning', this)" title="Filter provisioning nodes">
        <div class="is-flex is-align-items-center">
          <span class="stat-indicator-dot dot-provisioning"></span>
          <p class="heading has-text-warning">Provisioning</p>
        </div>
        <p class="title has-text-warning stat-number">${stats.provisioning}</p>
      </div>
    </div>
    <div class="column is-6-mobile is-3-tablet">
      <div class="box stat-box stat-clickable is-flex is-align-items-center is-justify-content-space-between" data-stat="pending" data-val="${stats.pending}" onclick="filterGridByStatus('pending', this)" title="Filter pending nodes">
        <div class="is-flex is-align-items-center">
          <span class="stat-indicator-dot dot-pending"></span>
          <p class="heading has-text-grey-light">Pending</p>
        </div>
        <p class="title has-text-grey stat-number">${stats.pending}</p>
      </div>
    </div>
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
  <title>iPXE Hub | Node Dashboard</title>
  
  <!-- Bulma CSS v1.0.4 -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@1.0.4/css/bulma.min.css">
  
  <!-- AG Grid Community Styles & Script (v31+) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community/styles/ag-grid.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community/styles/ag-theme-quartz.css">
  <script src="https://cdn.jsdelivr.net/npm/ag-grid-community/dist/ag-grid-community.min.js"></script>

  <!-- xterm.js & Addons (v5.5.0) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-webgl@0.18.0/lib/addon-webgl.min.js"></script>

  <!-- Custom Styles (Public) -->
  <link rel="stylesheet" href="${baseUrl}/public/css/dashboard.css">
  
  <!-- HTMX v4.0.0 -->
  <script src="https://unpkg.com/htmx.org@4.0.0/dist/htmx.min.js"></script>
  
  <!-- Dashboard Script & Theme Controller (Public) -->
  <script src="${baseUrl}/public/js/dashboard.js"></script>
</head>
<body class="dashboard-body has-background-background">
  <div class="container dashboard-container px-4 py-5" style="max-width: 1920px;">
    
    <!-- Navbar / Header -->
    <nav id="navbar-header" class="navbar-card level mb-5" role="navigation" aria-label="main navigation">
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
              <h1 class="title is-4 mb-0">iPXE Hub</h1>
              <p class="subtitle is-7 has-text-grey font-mono">v.0.0.1</p>
            </div>
          </div>
        </div>
      </div>

      <div class="level-right">
        <div class="level-item is-flex is-align-items-center" style="gap: 0.75rem;">
          <button
            id="navbar-polling-badge"
            class="button is-small is-rounded is-clickable navbar-polling-badge"
            onclick="togglePollingFromNavbar()"
            title="Auto-polling is active (3s). Click to pause."
            type="button"
            style="display: none;"
          >
            <span class="polling-pulse-ring"></span>
            <span class="polling-dot"></span>
            <span class="has-text-weight-semibold">Live Syncing</span>
            <span class="tag is-info is-light is-rounded is-small py-0 px-2 font-mono">3s</span>
          </button>

          <button
            id="navbar-config-btn"
            class="button is-small is-light"
            onclick="openConfigModal()"
            title="Configure System Settings (Base URL & Timeout)"
            style="border-radius: 9999px;"
            type="button"
          >
            <span class="icon is-small">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </span>
            <span>Config</span>
          </button>

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

      <div class="navbar-laser-stream" aria-hidden="true"></div>
    </nav>

    <!-- Stats Grid -->
    <div
      id="stats-grid"
      class="columns is-mobile is-multiline mb-5"
      hx-get="${baseUrl}/ui/stats"
      hx-trigger="refreshStats from:body"
      hx-swap="innerHTML"
    >
      ${renderStatsGridPartial(stats)}
    </div>

    <!-- Table Toolbar -->
    <div class="level mb-3">
      <div class="level-left">
        <div class="level-item">
          <div class="control has-icons-left">
            <input
              id="grid-search-input"
              class="input is-small is-rounded"
              type="text"
              placeholder="Quick search nodes..."
              style="width: 220px;"
            >
            <span class="icon is-small is-left">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
          </div>
        </div>
      </div>
      <div class="level-right">
        <div class="level-item is-flex is-align-items-center" style="gap: 0.75rem;">
          <button
            class="button is-light is-small"
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

          <button
            id="refresh-table-btn"
            class="button is-light is-small"
            hx-get="${baseUrl}/ui/nodes-table"
            hx-target="#nodes-table-body"
            hx-swap="innerHTML"
            onclick="handleManualRefresh(this)"
            title="Refresh table data"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>Refresh</span>
          </button>

          <label class="checkbox is-size-7 is-flex is-align-items-center" style="gap: 0.35rem;" title="Auto-refresh table every 3 seconds">
            <input
              type="checkbox"
              id="polling-toggle"
              onchange="handlePollingToggle(this)"
            >
            <span>Auto-polling (3s)</span>
          </label>
        </div>
      </div>
    </div>

    <!-- AG Grid Community Container -->
    <div class="box p-0 mb-5" style="overflow: hidden; border-radius: 8px; border: 1px solid var(--bulma-border-weak, rgba(255,255,255,0.1));">
      <div id="nodes-grid" class="ag-theme-quartz" style="width: 100%;"></div>
    </div>

    <!-- Hidden fallback tbody for backwards compatibility with tests / HTMX -->
    <table style="display: none;"><tbody id="nodes-table-body">${renderNodesTablePartial(hosts, baseUrl)}</tbody></table>

    <!-- Initial Hosts Data SSR -->
    <script id="initial-hosts-data" type="application/json">
      ${JSON.stringify(hosts).replace(/</g, "\\u003c")}
    </script>

    <!-- Server Console & Live Logs Panel -->
    <div id="terminal-panel" class="box p-0 mb-5 terminal-card">
      <div class="terminal-header is-flex is-justify-content-space-between is-align-items-center p-3">
        <!-- Header Left: Title & Status -->
        <div class="is-flex is-align-items-center" style="gap: 0.6rem; flex-wrap: wrap;">
          <div class="terminal-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5"></polyline>
              <line x1="12" y1="19" x2="20" y2="19"></line>
            </svg>
          </div>
          <span class="has-text-weight-bold font-mono is-size-6">Server Console &amp; Live Logs</span>
          <span id="terminal-status-badge" class="tag is-success is-light is-small is-rounded">
            <span class="status-indicator-dot is-connected"></span>
            <span id="terminal-status-text">Connected</span>
          </span>
          <span id="terminal-line-count" class="tag is-dark is-small is-rounded font-mono">0 lines</span>
        </div>

        <!-- Header Right: Toolbar Controls -->
        <div class="terminal-toolbar is-flex is-align-items-center" style="gap: 0.5rem; flex-wrap: wrap;">
          <!-- Level Filter -->
          <div class="select is-small">
            <select id="terminal-filter-level" onchange="terminalManager && terminalManager.handleLevelChange(this.value)" title="Filter log level">
              <option value="ALL">All Levels</option>
              <option value="INFO">INFO</option>
              <option value="HTTP">HTTP</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </div>

          <!-- Search Filter -->
          <div class="control has-icons-left" style="width: 140px;">
            <input
              id="terminal-filter-search"
              class="input is-small"
              type="text"
              placeholder="Search log..."
              oninput="terminalManager && terminalManager.handleSearch(this.value)"
              title="Filter by keyword"
            >
            <span class="icon is-small is-left">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
          </div>

          <!-- Auto-scroll toggle -->
          <label class="checkbox is-size-7 is-flex is-align-items-center mb-0" style="gap: 0.35rem; cursor: pointer;" title="Toggle automatic scrolling to bottom">
            <input type="checkbox" id="terminal-auto-scroll" checked onchange="terminalManager && terminalManager.toggleAutoScroll(this.checked)">
            <span>Auto-scroll</span>
          </label>

          <!-- Pause/Resume Button -->
          <button
            id="terminal-btn-pause"
            class="button is-small is-light"
            onclick="terminalManager && terminalManager.togglePause()"
            title="Pause/Resume live stream"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="terminal-pause-icon">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
            <span id="terminal-pause-text">Pause</span>
          </button>

          <!-- Clear Terminal Button -->
          <button
            id="terminal-btn-clear"
            class="button is-small is-light"
            onclick="terminalManager && terminalManager.clearScreen()"
            title="Clear terminal view (client only)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            <span>Clear</span>
          </button>

          <!-- Purge Server Log (with confirm) -->
          <button
            id="terminal-btn-purge"
            class="button is-small is-danger is-light"
            onclick="terminalManager && terminalManager.purgeServerLogs()"
            title="Xóa vĩnh viễn toàn bộ log trên server"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Purge Log</span>
          </button>

          <!-- Download Log File -->
          <a
            id="terminal-btn-download"
            class="button is-small is-info is-light"
            href="${baseUrl}/api/logs/download"
            download="server.log"
            title="Download server.log file"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download</span>
          </a>

          <!-- Collapse / Expand Toggle Button -->
          <button
            id="terminal-btn-collapse"
            class="button is-small is-ghost"
            onclick="terminalManager && terminalManager.toggleCollapse()"
            title="Thu gọn / Mở rộng Console"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="terminal-collapse-icon">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <!-- Terminal Body / xterm viewport -->
      <div id="terminal-body" class="terminal-body">
        <div id="terminal-container" style="height: 340px; width: 100%;"></div>
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

            <!-- SSH Authorized Keys -->
            <div class="column is-12 py-2">
              <label class="label is-small mb-1">SSH Authorized Keys</label>
              <div class="control">
                <textarea
                  id="add-ssh-keys-json"
                  name="ssh_keys_json"
                  class="textarea is-small is-family-monospace"
                  rows="3"
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... admin@homelab&#10;ssh-rsa AAAAB3NzaC1yc2EAAAA... user@work"
                ></textarea>
              </div>
              <p class="help has-text-grey">Tuỳ chọn: Nhập SSH public key (mỗi dòng một key hoặc mảng JSON dạng [&quot;ssh-ed25519 ...&quot;]).</p>
            </div>

            <!-- Custom JSON Parameters -->
            <div class="column is-12 py-2">
              <div class="is-flex is-justify-content-space-between is-align-items-center mb-1">
                <label class="label is-small mb-0">Custom JSON (Metadata / GitOps / K8s)</label>
                <button type="button" class="button is-ghost is-small py-0 px-1 has-text-info" style="font-size: 0.75rem; text-decoration: none;" onclick="formatCustomJson('add-custom-json')">
                  <svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                  </svg>
                  Format JSON
                </button>
              </div>
              <div class="control">
                <textarea
                  id="add-custom-json"
                  name="custom_json"
                  class="textarea is-small is-family-monospace"
                  rows="4"
                  placeholder='{
  "argocd": true,
  "gitops_repo": "https://github.com/org/gitops.git",
  "gitops_branch": "main",
  "gitops_path": "apps"
}'
                ></textarea>
              </div>
              <p class="help has-text-grey">Tuỳ chọn: Nhập JSON tuỳ biến (ví dụ: argocd, gitops_repo, k3s_version, boot_method...).</p>
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

            <!-- SSH Authorized Keys -->
            <div class="column is-12 py-2">
              <label class="label is-small mb-1">SSH Authorized Keys</label>
              <div class="control">
                <textarea
                  id="edit-ssh-keys-json"
                  name="ssh_keys_json"
                  class="textarea is-small is-family-monospace"
                  rows="3"
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... admin@homelab&#10;ssh-rsa AAAAB3NzaC1yc2EAAAA... user@work"
                ></textarea>
              </div>
              <p class="help has-text-grey">Tuỳ chọn: Nhập SSH public key (mỗi dòng một key hoặc mảng JSON). Để trống nếu muốn xóa hết key.</p>
            </div>

            <!-- Custom JSON Parameters -->
            <div class="column is-12 py-2">
              <div class="is-flex is-justify-content-space-between is-align-items-center mb-1">
                <label class="label is-small mb-0">Custom JSON (Metadata / GitOps / K8s)</label>
                <button type="button" class="button is-ghost is-small py-0 px-1 has-text-info" style="font-size: 0.75rem; text-decoration: none;" onclick="formatCustomJson('edit-custom-json')">
                  <svg style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="16 18 22 12 16 6"></polyline>
                    <polyline points="8 6 2 12 8 18"></polyline>
                  </svg>
                  Format JSON
                </button>
              </div>
              <div class="control">
                <textarea
                  id="edit-custom-json"
                  name="custom_json"
                  class="textarea is-small is-family-monospace"
                  rows="4"
                  placeholder='{
  "argocd": true,
  "gitops_repo": "https://github.com/org/gitops.git",
  "gitops_branch": "main",
  "gitops_path": "apps"
}'
                ></textarea>
              </div>
              <p class="help has-text-grey">Tuỳ chọn: Nhập JSON tuỳ biến. Dữ liệu này sẽ ghi đè thuộc tính custom của node.</p>
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

  <!-- ===================================================================== -->
  <!-- System Configuration Modal -->
  <!-- ===================================================================== -->
  <div id="system-config-modal" class="modal">
    <div class="modal-background" onclick="closeModal('system-config-modal')"></div>
    <div class="modal-card" style="max-width: 540px; width: 100%;">
      <header class="modal-card-head">
        <p class="modal-card-title is-size-5 mb-0">System Configuration</p>
        <button class="delete" aria-label="close" type="button" onclick="closeModal('system-config-modal')"></button>
      </header>
      <form id="system-config-form" onsubmit="submitSystemConfigForm(event)">
        <section class="modal-card-body">
          <p class="is-size-7 has-text-grey mb-4">
            Configure system runtime settings stored in SQLite (<code>state.db</code>). These values allow iPXE Hub to run standalone without <code>.env</code>.
          </p>

          <div class="field mb-4">
            <label class="label is-small" for="cfg-base-url">Base URL <span class="has-text-danger">*</span></label>
            <div class="control has-icons-left">
              <input
                id="cfg-base-url"
                name="baseUrl"
                class="input is-small font-mono"
                type="text"
                value="${baseUrl || ""}"
                placeholder="http://192.168.1.100:3000"
                required
              >
              <span class="icon is-small is-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
              </span>
            </div>
            <p class="help is-size-7 has-text-grey">
              The address reachable by iPXE client machines on the local network (no trailing slash).
            </p>
          </div>

          <div class="field mb-4">
            <label class="label is-small" for="cfg-menu-timeout">iPXE Menu Timeout (seconds) <span class="has-text-danger">*</span></label>
            <div class="control has-icons-left">
              <input
                id="cfg-menu-timeout"
                name="ipxeMenuTimeout"
                class="input is-small font-mono"
                type="number"
                min="0"
                max="3600"
                value="${context.appConfig?.ipxeMenuTimeout ?? 5}"
                required
              >
              <span class="icon is-small is-left">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </span>
            </div>
            <p class="help is-size-7 has-text-grey">
              Countdown delay in seconds before auto-booting local hard disk if no selection is made.
            </p>
          </div>
        </section>
        <footer class="modal-card-foot is-justify-content-flex-end">
          <button class="button is-small" type="button" onclick="closeModal('system-config-modal')">Cancel</button>
          <button id="system-config-submit-btn" class="button is-primary is-small" type="submit">
            <span>Save Config</span>
          </button>
        </footer>
      </form>
    </div>
  </div>

</body>
</html>
  `;
}
