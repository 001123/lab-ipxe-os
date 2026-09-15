/**
 * iPXE Autoinstall Hub - Dashboard Script
 * 
 * NOTE ON HTMX UPGRADE:
 * - Upgraded from HTMX v2 (2.0.4) to HTMX v4 (4.0.0).
 * - Official documentation & migration guide: https://four.htmx.org/docs
 * - Bulma CSS documentation: https://bulma.io/documentation/start/overview/
 */

(function () {
  const STORAGE_KEY = 'ipxe-dashboard-theme';

  // Apply saved or system theme immediately to prevent FOUC (Flash of unstyled content)
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

  // Initial theme application
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  // Listen for OS theme changes if user has not explicitly set a preference
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // Polling logic for HTMX
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

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') || getPreferredTheme());
  });
})();
