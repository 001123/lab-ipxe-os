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

  window.showToast = function (message, type = 'is-success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; max-width: 380px; pointer-events: none;';
      document.body.appendChild(container);
    }
    const notif = document.createElement('div');
    notif.className = `notification ${type} is-light py-2 px-4 mb-2`;
    notif.style.cssText = 'pointer-events: auto; box-shadow: 0 4px 14px rgba(0,0,0,0.2); transition: opacity 0.3s ease, transform 0.3s ease; border-radius: 6px;';
    notif.innerHTML = `<button class="delete is-small"></button><span>${message}</span>`;
    notif.querySelector('.delete').onclick = () => notif.remove();
    container.appendChild(notif);
    setTimeout(() => {
      notif.style.opacity = '0';
      notif.style.transform = 'translateY(-10px)';
      setTimeout(() => notif.remove(), 300);
    }, 3500);
  };

  window.formatCustomJson = function (textareaId) {
    const elem = document.getElementById(textareaId);
    if (!elem) return;
    const val = elem.value.trim();
    if (!val) {
      alert('Vui lòng nhập JSON trước khi bấm Format.');
      return;
    }
    try {
      const parsed = JSON.parse(val);
      elem.value = JSON.stringify(parsed, null, 2);
    } catch (err) {
      alert('Cú pháp JSON không hợp lệ:\n' + err.message);
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

    // Custom JSON field
    let customObj = {};
    if (d.custom) {
      try {
        customObj = JSON.parse(decodeURIComponent(d.custom));
      } catch (err) {
        console.error('Failed to parse d.custom:', err);
      }
    }
    const editCustomTextarea = document.getElementById('edit-custom-json');
    if (editCustomTextarea) {
      editCustomTextarea.value = Object.keys(customObj).length > 0 ? JSON.stringify(customObj, null, 2) : '';
    }

    // SSH Keys field
    let sshKeys = [];
    if (d.sshKeys) {
      try {
        sshKeys = JSON.parse(decodeURIComponent(d.sshKeys));
      } catch (err) {
        console.error('Failed to parse d.sshKeys:', err);
      }
    }
    const editSshTextarea = document.getElementById('edit-ssh-keys-json');
    if (editSshTextarea) {
      editSshTextarea.value = Array.isArray(sshKeys) ? sshKeys.join('\n') : '';
    }

    window.openModal('edit-node-modal');
  };

  window.submitEditNodeForm = async function (e) {
    e.preventDefault();
    const mac = document.getElementById('edit-mac').value.trim();
    if (!mac) return;

    const customTextarea = document.getElementById('edit-custom-json');
    if (customTextarea && customTextarea.value.trim()) {
      try {
        const parsed = JSON.parse(customTextarea.value.trim());
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          throw new Error('Custom JSON phải là một đối tượng JSON (object dạng {}).');
        }
      } catch (err) {
        alert('Cú pháp Custom JSON không hợp lệ:\n' + err.message);
        customTextarea.focus();
        return;
      }
    }

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
        // Refresh table & stats
        if (window.htmx) {
          window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
          if (window.triggerStatsRefresh) window.triggerStatsRefresh();
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

  // --- Import YAML Handlers ---
  window.handleYamlFileSelect = function (input) {
    const file = input.files && input.files[0];
    const nameSpan = document.getElementById('import-yaml-filename');
    const previewBox = document.getElementById('import-yaml-preview');
    const countBadge = document.getElementById('import-node-count-badge');
    const previewList = document.getElementById('import-preview-list');

    if (!file) {
      if (nameSpan) nameSpan.textContent = 'No file selected';
      if (previewBox) previewBox.classList.add('is-hidden');
      return;
    }

    if (nameSpan) nameSpan.textContent = file.name;

    const reader = new FileReader();
    reader.onload = function (e) {
      const text = e.target.result;
      const lines = text.split('\n');
      const detectedHosts = [];
      let inHosts = false;
      let hasDefault = false;

      for (const line of lines) {
        if (/^default\s*:/i.test(line)) {
          hasDefault = true;
          inHosts = false;
        } else if (/^hosts\s*:/i.test(line)) {
          inHosts = true;
        } else if (inHosts) {
          const macMatch = line.match(/^\s{1,4}([0-9a-fA-F:.-]{11,20})\s*:/);
          if (macMatch) {
            detectedHosts.push(macMatch[1]);
          } else if (/^\S/.test(line)) {
            inHosts = false;
          }
        }
      }

      if (previewBox && countBadge && previewList) {
        previewBox.classList.remove('is-hidden');
        countBadge.textContent = `${detectedHosts.length} node(s) found`;
        let html = '';
        if (hasDefault) {
          html += '<div class="has-text-success mb-1">✔ Contains global default configuration (<code>default:</code>)</div>';
        }
        if (detectedHosts.length > 0) {
          html += '<div class="has-text-grey-light mb-1">Detected MACs:</div>';
          html += '<ul style="padding-left: 1rem; list-style-type: disc;">';
          detectedHosts.slice(0, 10).forEach((mac) => {
            html += `<li><code>${mac}</code></li>`;
          });
          if (detectedHosts.length > 10) {
            html += `<li>… and ${detectedHosts.length - 10} more node(s)</li>`;
          }
          html += '</ul>';
        } else {
          html += '<div class="has-text-warning">No host entries found under `hosts:` block.</div>';
        }
        previewList.innerHTML = html;
      }
    };
    reader.readAsText(file);
  };

  window.submitImportYamlForm = async function (e) {
    e.preventDefault();
    const form = document.getElementById('import-yaml-form');
    const submitBtn = document.getElementById('import-submit-btn');
    const replaceAllCheckbox = document.getElementById('import-replace-all');

    if (replaceAllCheckbox && replaceAllCheckbox.checked) {
      const confirmed = confirm(
        'CẢNH BÁO: Tùy chọn "Replace All" sẽ XÓA SẠCH toàn bộ node trong cơ sở dữ liệu trước khi nạp file YAML.\n\nBạn có chắc chắn muốn tiếp tục?'
      );
      if (!confirmed) return;
    }

    if (submitBtn) submitBtn.classList.add('is-loading');

    try {
      const formData = new FormData(form);
      const res = await fetch('/api/import/yaml', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        window.closeModal('import-yaml-modal');
        form.reset();
        const previewBox = document.getElementById('import-yaml-preview');
        const nameSpan = document.getElementById('import-yaml-filename');
        if (previewBox) previewBox.classList.add('is-hidden');
        if (nameSpan) nameSpan.textContent = 'No file selected';

        window.showToast(data.message || 'Import YAML thành công!', 'is-success');

        // Refresh table using HTMX or reload
        if (window.htmx) {
          window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
          if (window.triggerStatsRefresh) window.triggerStatsRefresh();
        } else {
          window.location.reload();
        }
      } else {
        alert(`Lỗi Import YAML: ${data.error || res.statusText || 'Không rõ nguyên nhân'}`);
      }
    } catch (err) {
      alert(`Lỗi kết nối khi import YAML: ${err.message}`);
    } finally {
      if (submitBtn) submitBtn.classList.remove('is-loading');
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
  document.addEventListener('htmx:configRequest', (evt) => {
    // Validate add-node-form custom JSON before HTMX sends request
    if (evt.detail.elt && evt.detail.elt.id === 'add-node-form') {
      const textarea = document.getElementById('add-custom-json');
      if (textarea && textarea.value.trim()) {
        try {
          const parsed = JSON.parse(textarea.value.trim());
          if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
            throw new Error('Custom JSON phải là một đối tượng JSON (object dạng {}).');
          }
        } catch (err) {
          alert('Cú pháp Custom JSON không hợp lệ:\n' + err.message);
          textarea.focus();
          evt.preventDefault();
        }
      }
    }
  });

  document.addEventListener('htmx:responseError', (evt) => {
    let msg = 'Đã xảy ra lỗi khi gửi yêu cầu.';
    try {
      const err = JSON.parse(evt.detail.xhr.responseText);
      if (err.error) msg = err.error;
    } catch {}
    alert(`Lỗi: ${msg}`);
  });

  document.addEventListener('htmx:afterRequest', (evt) => {
    // If add-node-form was submitted successfully, close modal and reset form
    const elt = evt.detail.elt;
    const form = elt && (elt.id === 'add-node-form' ? elt : elt.closest('#add-node-form') || elt.form);
    if (form && form.id === 'add-node-form' && evt.detail.successful) {
      window.closeModal('add-node-modal');
      form.reset();
      window.showToast('Tạo node mới thành công!', 'is-success');
    }
  });

  // Listen to server trigger event "hostCreated"
  document.body.addEventListener('hostCreated', () => {
    window.closeModal('add-node-modal');
    const form = document.getElementById('add-node-form');
    if (form) form.reset();
    window.showToast('Tạo node mới thành công!', 'is-success');
  });

  // Trigger stats grid refresh
  window.triggerStatsRefresh = function () {
    const statsGrid = document.getElementById('stats-grid');
    if (statsGrid && window.htmx) {
      window.htmx.ajax('GET', '/ui/stats', { target: '#stats-grid', swap: 'innerHTML' });
    }
  };

  // Manual Table & Stats Refresh
  window.handleManualRefresh = function (btn) {
    const icon = btn ? btn.querySelector('.btn-icon') : document.querySelector('#refresh-table-btn .btn-icon');
    if (icon) icon.classList.add('is-spinning');

    const tableBody = document.getElementById('nodes-table-body');
    if (tableBody && window.htmx) {
      window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
    }
    window.triggerStatsRefresh();

    setTimeout(() => {
      if (icon) icon.classList.remove('is-spinning');
    }, 600);
  };

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
          window.triggerStatsRefresh();
        }, 3000);
      }
    } else {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  };

  // Detect changes in stat cards to trigger pulse animation
  let previousStats = {};
  function initializeStatsCache() {
    const statsGrid = document.getElementById('stats-grid');
    if (statsGrid) {
      previousStats = {};
      const currentCards = statsGrid.querySelectorAll('[data-stat]');
      currentCards.forEach((card) => {
        const statName = card.getAttribute('data-stat');
        const val = card.getAttribute('data-val');
        if (statName) {
          previousStats[statName] = val;
        }
      });
    }
  }

  document.body.addEventListener('htmx:beforeSwap', (evt) => {
    if (evt.detail.target && evt.detail.target.id === 'stats-grid') {
      previousStats = {};
      const currentCards = evt.detail.target.querySelectorAll('[data-stat]');
      currentCards.forEach((card) => {
        const statName = card.getAttribute('data-stat');
        const val = card.getAttribute('data-val');
        if (statName) {
          previousStats[statName] = val;
        }
      });
    }
  });

  document.body.addEventListener('htmx:afterSwap', (evt) => {
    if (evt.detail.target && evt.detail.target.id === 'stats-grid') {
      const newCards = evt.detail.target.querySelectorAll('[data-stat]');
      newCards.forEach((card) => {
        const statName = card.getAttribute('data-stat');
        const newVal = card.getAttribute('data-val');
        const oldVal = previousStats[statName];
        if (oldVal !== undefined && newVal !== oldVal) {
          card.classList.add('stat-box-pulsing');
          setTimeout(() => {
            card.classList.remove('stat-box-pulsing');
          }, 1200);
        }
      });
    }
  });

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
    initializeStatsCache();
  });
})();
