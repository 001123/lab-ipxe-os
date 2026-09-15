/**
 * iPXE Autoinstall Hub - Dashboard HTML Renderer
 *
 * NOTE ON HTMX UPGRADE:
 * - Upgraded from HTMX v2 (2.0.4) to HTMX v4 (4.0.0).
 * - Official documentation & migration guide: https://four.htmx.org/docs
 * - Bulma CSS framework v1.0.4: https://bulma.io/documentation/start/overview/
 */

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

  return `
    <tr id="${rowId}" class="host-row status-${host.status.toLowerCase()}">
      <td>
        <div class="hostname-title">${host.hostname || "unnamed"}</div>
        ${host.note ? `<div class="host-note">${host.note}</div>` : ""}
      </td>
      <td>
        <div class="has-text-weight-medium">${host.ip || "DHCP"}</div>
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
            class="button is-warning is-light is-small"
            hx-post="${baseUrl}/api/reset?mac=${encodeURIComponent(host.mac)}"
            hx-target="#${rowId}"
            hx-swap="outerHTML"
            title="Reset install lock to re-provision"
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
            hx-delete="${baseUrl}/api/nodes?mac=${encodeURIComponent(host.mac)}"
            hx-target="#${rowId}"
            hx-swap="outerHTML"
            hx-confirm="Bạn có chắc chắn muốn xoá node [${host.hostname || host.mac}] không?"
            title="Delete node record from SQLite"
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
          No hosts found. Define hosts in <code>config/hosts.yaml</code>.
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
  
  <!-- HTMX v4.0.0 (https://four.htmx.org/docs) -->
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
              <p class="subtitle is-7 has-text-grey">Multi-OS Netboot &amp; Cloud-Init Engine</p>
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
          <p class="heading has-text-grey">Configured Hosts</p>
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
        <div class="level-item is-flex is-align-items-center" style="gap: 1rem;">
          <label class="checkbox is-size-7 is-flex is-align-items-center" style="gap: 0.4rem;" title="Auto-refresh table every 3 seconds">
            <input
              type="checkbox"
              id="polling-toggle"
              onchange="handlePollingToggle(this)"
            >
            <span>Auto-polling (3s)</span>
          </label>
          <button
            class="button is-primary is-small"
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
      <div class="quick-code-box has-background-dark has-text-light">
        <span>iPXE Chainload URL: ${baseUrl}/boot.ipxe?mac=\${net0/mac}</span>
      </div>
      <div class="quick-code-box has-background-dark has-text-light">
        <span>API Reset: curl -X POST "${baseUrl}/api/reset?mac=&lt;MAC&gt;"</span>
      </div>
    </div>

  </div>
</body>
</html>
  `;
}
