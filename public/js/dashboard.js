/**
 * iPXE Autoinstall Hub - Dashboard Script & Modal Controller
 * Bulma CSS v1.0.4 & HTMX v4.0.0
 * Official documentation & migration guide: https://four.htmx.org/docs
 */

(function () {
  const STORAGE_KEY = 'ipxe-dashboard-theme';

  // --- Theme Controller ---
  function getPreferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');
    if (themeIcon) {
      themeIcon.innerHTML = theme === 'dark'
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
    if (themeText) {
      themeText.textContent = theme === 'dark' ? 'Light' : 'Dark';
    }
  }

  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  // --- Modal Helpers ---
  window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('is-active');
    }
  };

  window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('is-active');
    }
  };

  window.handleOsChange = function (selectElem, prefix) {
    const os = selectElem.value;
    const versionInput = document.getElementById(`${prefix}-version`);
    if (versionInput) {
      if (os === 'ubuntu') versionInput.value = '24.04';
      if (os === 'suse-micro') versionInput.value = '6.2';
    }
  };

  window.openEditModalFromRow = function (btn) {
    const d = btn.dataset;
    document.getElementById('edit-mac').value = d.mac || '';
    document.getElementById('edit-hostname').value = d.hostname || '';
    document.getElementById('edit-os').value = d.os || 'ubuntu';
    document.getElementById('edit-version').value = d.version || '';
    document.getElementById('edit-profile').value = d.profile || 'generic';
    document.getElementById('edit-ip').value = d.ip || '';
    document.getElementById('edit-gateway').value = d.gateway || '';
    document.getElementById('edit-netmask').value = d.netmask || '';
    document.getElementById('edit-nameservers').value = d.nameservers || '';
    document.getElementById('edit-disk').value = d.disk || '/dev/sda';
    document.getElementById('edit-note').value = d.note ? decodeURIComponent(d.note) : '';

    // GitOps fields
    document.getElementById('edit-argocd').checked = d.argocd === '1';
    document.getElementById('edit-gitops-repo').value = d.gitopsRepo || '';
    document.getElementById('edit-gitops-branch').value = d.gitopsBranch || '';
    document.getElementById('edit-gitops-path').value = d.gitopsPath || '';

    window.openModal('edit-node-modal');
  };

  window.submitEditNodeForm = async function (e) {
    e.preventDefault();
    const mac = document.getElementById('edit-mac').value.trim();
    if (!mac) return;

    const form = document.getElementById('edit-node-form');
    const formData = new FormData(form);

    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(mac)}/edit`, {
        method: 'POST',
        body: formData,
        headers: {
          'HX-Request': 'true',
        },
      });

      if (res.ok) {
        window.closeModal('edit-node-modal');
        // Refresh table
        if (window.htmx) {
          window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
        } else {
          window.location.reload();
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Error updating node: ${err.error || res.statusText}`);
      }
    } catch (err) {
      alert(`Network error updating node: ${err.message}`);
    }
  };

  // Close modals on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const activeModals = document.querySelectorAll('.modal.is-active');
      activeModals.forEach((m) => m.classList.remove('is-active'));
    }
  });

  // HTMX Event Listeners
  document.addEventListener('htmx:afterRequest', (evt) => {
    // If add-node-form was submitted successfully, close modal and reset form
    if (evt.detail.elt && evt.detail.elt.id === 'add-node-form' && evt.detail.successful) {
      window.closeModal('add-node-modal');
      evt.detail.elt.reset();
    }
  });

  // Auto-Polling
  let pollInterval = null;
  window.handlePollingToggle = function (checkbox) {
    if (checkbox.checked) {
      if (!pollInterval) {
        pollInterval = setInterval(() => {
          const tableBody = document.getElementById('nodes-table-body');
          if (tableBody && window.htmx) {
            window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
          }
        }, 3000);
      }
    } else {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  };

  // Initial theme application
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') || getPreferredTheme());
  });
})();
