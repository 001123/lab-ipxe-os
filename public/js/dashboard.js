/**
 * iPXE Hub - Dashboard Script & Modal Controller
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

    const gridDiv = document.getElementById('nodes-grid');
    if (gridDiv) {
      if (theme === 'dark') {
        gridDiv.classList.remove('ag-theme-quartz');
        gridDiv.classList.add('ag-theme-quartz-dark');
      } else {
        gridDiv.classList.remove('ag-theme-quartz-dark');
        gridDiv.classList.add('ag-theme-quartz');
      }
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
      if (os === 'proxmox') versionInput.value = '9.2';
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

  // --- System Configuration Modal & Controller ---
  window.openConfigModal = async function () {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        const urlInput = document.getElementById('cfg-base-url');
        const timeoutInput = document.getElementById('cfg-menu-timeout');
        if (urlInput && data.baseUrl) urlInput.value = data.baseUrl;
        if (timeoutInput && typeof data.ipxeMenuTimeout === 'number') timeoutInput.value = data.ipxeMenuTimeout;
      }
    } catch (err) {
      console.warn('Could not fetch latest /api/config:', err);
    }
    window.openModal('system-config-modal');
    window.refreshAssetStatus();
  };

  window.refreshAssetStatus = async function () {
    const container = document.getElementById('os-assets-list');
    if (!container) return;
    container.innerHTML = '<div class="has-text-grey is-size-7 py-2"><span class="icon is-small mr-1">⏳</span>Checking OS boot assets...</div>';

    try {
      const res = await fetch('/api/assets/status');
      if (!res.ok) throw new Error('Failed to fetch asset status');
      const data = await res.json();

      const osNames = {
        'ubuntu': { title: 'Ubuntu Server', icon: '🐧' },
        'talos': { title: 'Talos Linux', icon: '⚡' },
        'suse-micro': { title: 'openSUSE Leap Micro', icon: '🦎' },
        'proxmox': { title: 'Proxmox VE', icon: '🖥️' },
      };

      let html = '';
      for (const [osKey, info] of Object.entries(data)) {
        const meta = osNames[osKey] || { title: osKey, icon: '📦' };
        const isReady = info.ready;
        const badgeClass = isReady ? 'is-success' : 'is-warning';
        const badgeText = isReady ? 'Ready' : `Missing (${info.missingCount}/${info.totalCount})`;

        html += `
          <div class="card p-2 mb-1" style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--bulma-border, rgba(255,255,255,0.08)); border-radius: 6px;">
            <div class="is-flex is-justify-content-space-between is-align-items-center">
              <div>
                <span class="mr-1">${meta.icon}</span>
                <strong class="is-size-7">${meta.title}</strong>
                <span class="tag is-dark is-rounded is-small ml-1" style="font-size: 0.65rem;">${info.version}</span>
                <span class="tag ${badgeClass} is-light is-small ml-1" style="font-size: 0.65rem;">${badgeText}</span>
              </div>
              <div>
                <button
                  type="button"
                  class="button is-small is-rounded is-outlined ${isReady ? 'is-info' : 'is-primary'}"
                  style="font-size: 0.7rem; height: 24px; padding: 0 8px;"
                  onclick="triggerAssetSync('${osKey}', this)"
                  title="${isReady ? 'Re-sync / re-extract files' : 'Download and extract ISO / kernel'}"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  ${isReady ? 'Re-sync' : 'Sync'}
                </button>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<div class="has-text-danger is-size-7 py-1">Lỗi tải assets: ${err.message}</div>`;
    }
  };

  window.triggerAssetSync = async function (osKey, btn) {
    if (btn) {
      btn.classList.add('is-loading');
      btn.disabled = true;
    }
    try {
      const res = await fetch(`/api/assets/sync?os=${encodeURIComponent(osKey)}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi khi kích hoạt sync');
      window.showToast(`🚀 Đã kích hoạt tải OS '${osKey}'. Xem tiến độ chi tiết tại Live Terminal.`, 'is-info');
      // Refresh status after delay
      setTimeout(() => window.refreshAssetStatus(), 3000);
    } catch (err) {
      window.showToast(err.message || 'Lỗi khi đồng bộ asset', 'is-danger');
    } finally {
      if (btn) {
        btn.classList.remove('is-loading');
        btn.disabled = false;
      }
    }
  };

  window.submitSystemConfigForm = async function (event) {
    if (event) event.preventDefault();
    const form = document.getElementById('system-config-form');
    const submitBtn = document.getElementById('system-config-submit-btn');
    if (!form) return;

    const baseUrl = (document.getElementById('cfg-base-url')?.value || '').trim();
    const timeoutVal = parseInt(document.getElementById('cfg-menu-timeout')?.value || '5', 10);

    if (!baseUrl) {
      window.showToast('Vui lòng nhập Base URL!', 'is-danger');
      return;
    }

    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      window.showToast('Base URL phải bắt đầu bằng http:// hoặc https://', 'is-danger');
      return;
    }

    if (submitBtn) {
      submitBtn.classList.add('is-loading');
      submitBtn.disabled = true;
    }

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          ipxeMenuTimeout: timeoutVal,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lỗi khi lưu cấu hình');
      }

      window.showToast('Cấu hình hệ thống đã được lưu thành công vào SQLite!', 'is-success');
      window.closeModal('system-config-modal');

      setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err) {
      console.error('Error saving system config:', err);
      window.showToast(err.message || 'Lưu cấu hình thất bại', 'is-danger');
    } finally {
      if (submitBtn) {
        submitBtn.classList.remove('is-loading');
        submitBtn.disabled = false;
      }
    }
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

  window.openEditModalFromHostData = function (host) {
    if (!host) return;
    const cfg = host.rawConfig || host;
    const net = cfg.network || {};
    const stor = cfg.storage || {};
    const custom = cfg.custom || {};
    const sshKeys = cfg.ssh_authorized_keys || [];

    document.getElementById('edit-mac').value = host.mac || cfg.mac || '';
    document.getElementById('edit-hostname').value = host.hostname || cfg.hostname || '';
    document.getElementById('edit-os').value = host.os || cfg.os || 'ubuntu';
    document.getElementById('edit-version').value = host.version || cfg.version || '';
    document.getElementById('edit-profile').value = host.profile || cfg.profile || 'generic';
    document.getElementById('edit-ip').value = net.ip || host.ip || '';
    document.getElementById('edit-gateway').value = net.gateway || '';
    document.getElementById('edit-netmask').value = net.netmask || '';
    document.getElementById('edit-nameservers').value = Array.isArray(net.nameservers)
      ? net.nameservers.join(', ')
      : (net.nameservers || '');
    document.getElementById('edit-disk').value = stor.target_disk || '/dev/sda';
    document.getElementById('edit-note').value = host.note || cfg.note || '';

    // Custom JSON field
    const editCustomTextarea = document.getElementById('edit-custom-json');
    if (editCustomTextarea) {
      editCustomTextarea.value = Object.keys(custom).length > 0 ? JSON.stringify(custom, null, 2) : '';
    }

    // SSH Keys field
    const editSshTextarea = document.getElementById('edit-ssh-keys-json');
    if (editSshTextarea) {
      editSshTextarea.value = Array.isArray(sshKeys)
        ? sshKeys.join('\n')
        : (typeof sshKeys === 'string' ? sshKeys : '');
    }

    window.openModal('edit-node-modal');
  };

  window.openEditModalByMac = function (mac) {
    let host = null;
    if (window.gridApi) {
      window.gridApi.forEachNode((node) => {
        if (node.data && (node.data.mac === mac || node.data.rawConfig?.mac === mac)) {
          host = node.data;
        }
      });
    }
    if (!host && window.currentGridData) {
      host = window.currentGridData.find((h) => h.mac === mac);
    }
    if (host) {
      window.openEditModalFromHostData(host);
    }
  };

  window.resetHost = async function (mac, encodedHostname) {
    const hostname = decodeURIComponent(encodedHostname || '') || mac;
    const confirmed = confirm(`Bạn có chắc chắn muốn đặt lại trạng thái node [${hostname}] về PENDING không?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/reset?mac=${encodeURIComponent(mac)}`, { method: 'POST' });
      if (res.ok) {
        window.showToast(`Đã chuyển trạng thái node [${hostname}] về PENDING!`, 'is-info');
        if (window.refreshGridData) window.refreshGridData();
        if (window.triggerStatsRefresh) window.triggerStatsRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Lỗi reset node: ${err.error || res.statusText}`);
      }
    } catch (err) {
      alert(`Lỗi kết nối khi reset: ${err.message}`);
    }
  };

  window.deleteHost = async function (mac, encodedHostname) {
    const hostname = decodeURIComponent(encodedHostname || '') || mac;
    const confirmed = confirm(`Bạn có chắc chắn muốn xoá vĩnh viễn node [${hostname}] khỏi cơ sở dữ liệu không?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(mac)}`, { method: 'DELETE' });
      if (res.ok) {
        window.showToast(`Đã xoá vĩnh viễn node [${hostname}]!`, 'is-success');
        if (window.refreshGridData) window.refreshGridData();
        if (window.triggerStatsRefresh) window.triggerStatsRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Lỗi xoá node: ${err.error || res.statusText}`);
      }
    } catch (err) {
      alert(`Lỗi kết nối khi xoá: ${err.message}`);
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
        window.showToast('Cập nhật thông tin node thành công!', 'is-success');
        if (window.refreshGridData) window.refreshGridData();
        if (window.triggerStatsRefresh) window.triggerStatsRefresh();
        if (window.htmx) {
          window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
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

        if (window.refreshGridData) window.refreshGridData();
        if (window.triggerStatsRefresh) window.triggerStatsRefresh();
        if (window.htmx) {
          window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
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
      if (window.refreshGridData) window.refreshGridData();
      if (window.triggerStatsRefresh) window.triggerStatsRefresh();
    }
  });

  // Listen to server trigger event "hostCreated"
  document.addEventListener('hostCreated', () => {
    window.closeModal('add-node-modal');
    const form = document.getElementById('add-node-form');
    if (form) form.reset();
    window.showToast('Tạo node mới thành công!', 'is-success');
    if (window.refreshGridData) window.refreshGridData();
    if (window.triggerStatsRefresh) window.triggerStatsRefresh();
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

    if (window.refreshGridData) window.refreshGridData();
    window.triggerStatsRefresh();

    const tableBody = document.getElementById('nodes-table-body');
    if (tableBody && window.htmx) {
      window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
    }

    setTimeout(() => {
      if (icon) icon.classList.remove('is-spinning');
    }, 600);
  };

  // Auto-Polling
  let pollInterval = null;
  window.handlePollingToggle = function (checkbox) {
    const navHeader = document.getElementById('navbar-header');
    const pollingBadge = document.getElementById('navbar-polling-badge');

    if (checkbox.checked) {
      if (navHeader) navHeader.classList.add('is-polling-active');
      if (pollingBadge) pollingBadge.style.display = 'inline-flex';

      if (!pollInterval) {
        pollInterval = setInterval(() => {
          if (window.refreshGridData) window.refreshGridData();
          window.triggerStatsRefresh();

          const tableBody = document.getElementById('nodes-table-body');
          if (tableBody && window.htmx) {
            window.htmx.ajax('GET', '/ui/nodes-table', { target: '#nodes-table-body', swap: 'innerHTML' });
          }
        }, 3000);
      }
    } else {
      if (navHeader) navHeader.classList.remove('is-polling-active');
      if (pollingBadge) pollingBadge.style.display = 'none';

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  };

  window.togglePollingFromNavbar = function () {
    const checkbox = document.getElementById('polling-toggle');
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      window.handlePollingToggle(checkbox);
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

  document.addEventListener('htmx:beforeSwap', (evt) => {
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

  // --- Stats Filter Controller ---
  let activeStatusFilter = null;

  window.filterGridByStatus = function (status, cardElem) {
    if (!window.gridApi) return;

    // If clicking the same active filter, or clicking 'all', clear filter
    if (status === 'all' || activeStatusFilter === status) {
      activeStatusFilter = null;
      document.querySelectorAll('.stat-box').forEach((b) => b.classList.remove('is-active-filter'));
      window.gridApi.setColumnFilterModel('status', null).then(() => {
        window.gridApi.onFilterChanged();
      });
      return;
    }

    activeStatusFilter = status;
    document.querySelectorAll('.stat-box').forEach((b) => b.classList.remove('is-active-filter'));
    if (cardElem) {
      cardElem.classList.add('is-active-filter');
    }

    const targetUpper = status.toUpperCase();
    window.gridApi.setColumnFilterModel('status', {
      filterType: 'text',
      type: 'equals',
      filter: targetUpper,
    }).then(() => {
      window.gridApi.onFilterChanged();
    });
  };

  document.addEventListener('htmx:afterSwap', (evt) => {
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

      if (activeStatusFilter) {
        const activeCard = evt.detail.target.querySelector(`[data-stat="${activeStatusFilter}"]`);
        if (activeCard) {
          activeCard.classList.add('is-active-filter');
        }
      }
    }
  });

  // --- AG Grid Community Controller ---
  window.gridApi = null;
  window.currentGridData = [];

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.refreshGridData = async function () {
    try {
      const res = await fetch('/api/hosts');
      if (res.ok) {
        const hosts = await res.json();
        window.currentGridData = hosts;
        if (window.gridApi) {
          window.gridApi.setGridOption('rowData', hosts);
        }
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching /api/hosts:', err);
    }
  };

  function initAgGrid() {
    const gridDiv = document.getElementById('nodes-grid');
    if (!gridDiv) {
      return;
    }
    if (typeof agGrid === 'undefined') {
      console.warn('[Dashboard] agGrid is not defined yet, retrying in 150ms...');
      setTimeout(initAgGrid, 150);
      return;
    }

    // Register all community modules for AG Grid v33+ compatibility
    if (typeof agGrid.ModuleRegistry !== 'undefined' && agGrid.AllCommunityModule) {
      try {
        agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule]);
      } catch (e) {
        console.warn('[Dashboard] Module registration note:', e);
      }
    }

    // Read initial SSR data
    let initialHosts = [];
    const initialDataElem = document.getElementById('initial-hosts-data');
    if (initialDataElem && initialDataElem.textContent.trim()) {
      try {
        initialHosts = JSON.parse(initialDataElem.textContent.trim());
      } catch (e) {
        console.error('[Dashboard] Failed to parse initial hosts SSR data:', e);
      }
    }
    window.currentGridData = initialHosts;

    const columnDefs = [
      {
        field: 'hostname',
        headerName: 'Node / Hostname',
        flex: 1.4,
        minWidth: 160,
        valueGetter: (params) => {
          if (!params.data) return '';
          return `${params.data.hostname || ''} ${params.data.note || ''}`;
        },
        cellRenderer: (params) => {
          if (!params.data) return '';
          const name = params.data.hostname || 'unnamed';
          const note = params.data.note ? `<div class="host-note">${escapeHtml(params.data.note)}</div>` : '';
          return `<div class="ag-cell-inner"><div class="hostname-title">${escapeHtml(name)}</div>${note}</div>`;
        },
      },
      {
        headerName: 'Network',
        flex: 1.2,
        minWidth: 150,
        valueGetter: (params) => {
          if (!params.data) return '';
          const d = params.data;
          const ip = d.ip || d.network?.ip || (d.network?.dhcp !== false ? 'DHCP' : 'Unset');
          return `${ip} ${d.mac || ''}`;
        },
        cellRenderer: (params) => {
          if (!params.data) return '';
          const d = params.data;
          const ip = d.ip || d.network?.ip || (d.network?.dhcp !== false ? 'DHCP' : 'Unset');
          const mac = d.mac || '';
          return `<div class="ag-cell-inner"><div class="has-text-weight-medium">${escapeHtml(ip)}</div><div class="mac-subtext font-mono">${escapeHtml(mac)}</div></div>`;
        },
      },
      {
        headerName: 'OS & Profile',
        flex: 1.2,
        minWidth: 150,
        valueGetter: (params) => {
          if (!params.data) return '';
          const d = params.data;
          return `${d.os || ''} ${d.version || ''} ${d.profile || d.role || ''}`;
        },
        cellRenderer: (params) => {
          if (!params.data) return '';
          const d = params.data;
          const os = d.os || 'ubuntu';
          const version = d.version || '';
          const profile = d.profile || d.role || 'generic';
          const osName = os === 'suse-micro' ? 'openSUSE Leap Micro' : os === 'ubuntu' ? 'Ubuntu Server' : os === 'proxmox' ? 'Proxmox VE' : os;
          const osBadgeClass = os === 'suse-micro' ? 'tag-suse' : os === 'proxmox' ? 'tag-proxmox' : 'tag-ubuntu';
          return `<div class="ag-cell-inner"><span class="tag ${osBadgeClass}">${escapeHtml(osName)} ${escapeHtml(version)}</span><div class="font-mono is-size-7 mt-1">${escapeHtml(profile)}</div></div>`;
        },
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 1.1,
        minWidth: 130,
        cellRenderer: (params) => {
          if (!params.data) return '';
          const status = params.data.status || 'PENDING';
          if (status === 'INSTALLED') {
            const timeStr = params.data.installed_at
              ? `<div class="date-subtext">${new Date(params.data.installed_at).toLocaleTimeString()} - ${new Date(params.data.installed_at).toLocaleDateString()}</div>`
              : '';
            return `<div class="ag-cell-inner"><div class="status-badge-wrapper"><span class="tag is-success is-light"><svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>Installed</span>${timeStr}</div></div>`;
          } else if (status === 'PROVISIONING') {
            return `<div class="ag-cell-inner"><span class="tag is-warning is-light"><span class="pulse-dot"></span>Provisioning...</span></div>`;
          } else if (status === 'FAILED') {
            return `<div class="ag-cell-inner"><span class="tag is-danger is-light"><svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>Failed</span></div>`;
          }
          return `<div class="ag-cell-inner"><span class="tag is-info is-light"><svg class="icon-dot" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="3"/></svg>Pending</span></div>`;
        },
      },
      {
        headerName: 'Actions',
        flex: 1.8,
        minWidth: 240,
        sortable: false,
        filter: false,
        cellRenderer: (params) => {
          if (!params.data) return '';
          const d = params.data;
          const mac = d.mac || '';
          const hostname = d.hostname || '';
          const isK8s = Boolean(
            d.isK8s ||
            d.profile?.includes('k3s') ||
            d.profile?.includes('rke2') ||
            d.profile?.includes('k8s')
          );
          const kubeBtn = (isK8s && d.status === 'INSTALLED')
            ? `
              <a class="button is-info is-light is-small" href="/api/kubeconfig/${encodeURIComponent(hostname || mac)}" target="_blank" title="Download Kubeconfig">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Kubeconfig</span>
              </a>
            `
            : '';

          return `
            <div class="actions-buttons is-flex is-align-items-center" style="gap: 0.35rem; height: 100%;">
              <button class="button is-link is-light is-small" type="button" onclick="openEditModalByMac('${escapeHtml(mac)}')" title="Edit node configuration">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>Edit</span>
              </button>
              <button class="button is-warning is-light is-small" type="button" onclick="resetHost('${escapeHtml(mac)}', '${encodeURIComponent(hostname)}')" title="Reset install state to PENDING">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                  <path d="M21 3v5h-5"/>
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                  <path d="M3 21v-5h5"/>
                </svg>
                <span>Reset</span>
              </button>
              <button class="button is-danger is-light is-small" type="button" onclick="deleteHost('${escapeHtml(mac)}', '${encodeURIComponent(hostname)}')" title="Delete node from database">
                <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                <span>Delete</span>
              </button>
              ${kubeBtn}
            </div>
          `;
        },
      },
    ];

    const gridOptions = {
      theme: 'legacy',
      rowData: initialHosts,
      columnDefs: columnDefs,
      domLayout: 'autoHeight',
      rowHeight: 64,
      headerHeight: 42,
      pagination: true,
      paginationPageSize: 10,
      paginationPageSizeSelector: [10, 25, 50],
      animateRows: true,
      defaultColDef: {
        sortable: true,
        filter: true,
        resizable: true,
      },
      overlayNoRowsTemplate: '<span class="has-text-grey py-5">No hosts found. Click <strong>+ Add Node</strong> to register your first host.</span>',
    };

    window.gridApi = agGrid.createGrid(gridDiv, gridOptions);

    // Bind Quick Search
    const searchInput = document.getElementById('grid-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        if (window.gridApi) {
          window.gridApi.setGridOption('quickFilterText', e.target.value);
        }
      });
    }

    // Apply active theme to gridDiv
    const currentTheme = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
    if (currentTheme === 'dark') {
      gridDiv.classList.remove('ag-theme-quartz');
      gridDiv.classList.add('ag-theme-quartz-dark');
    } else {
      gridDiv.classList.remove('ag-theme-quartz-dark');
      gridDiv.classList.add('ag-theme-quartz');
    }
  }

  // --- Terminal & Live Logs Manager (xterm.js) ---
  class TerminalManager {
    constructor() {
      this.term = null;
      this.fitAddon = null;
      this.socket = null;
      this.autoScroll = true;
      this.isPaused = false;
      this.isCollapsed = false;
      this.filterLevel = 'ALL';
      this.filterSearch = '';
      this.maxScrollback = 3000;
      this.allEntries = [];
      this.batchBuffer = [];
      this.rafScheduled = false;
      this.searchDebounceTimer = null;
      this.reconnectTimer = null;

      this.init();
    }

    init() {
      const container = document.getElementById('terminal-container');
      if (!container || typeof window.Terminal === 'undefined') {
        return;
      }

      this.term = new window.Terminal({
        cursorBlink: false,
        cursorStyle: 'bar',
        fontSize: 13,
        lineHeight: 1.3,
        fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc',
        },
        scrollback: this.maxScrollback,
        convertEol: true,
        disableStdin: true,
      });

      // Fit addon
      if (window.FitAddon && window.FitAddon.FitAddon) {
        this.fitAddon = new window.FitAddon.FitAddon();
        this.term.loadAddon(this.fitAddon);
      }

      this.term.open(container);

      // WebGL GPU acceleration with fallback
      if (window.WebglAddon && window.WebglAddon.WebglAddon) {
        try {
          const webgl = new window.WebglAddon.WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          this.term.loadAddon(webgl);
        } catch (e) {
          console.warn('[Terminal] WebGL addon not available, using default renderer');
        }
      }

      if (this.fitAddon) {
        setTimeout(() => this.fitAddon.fit(), 60);
      }

      window.addEventListener('resize', () => {
        if (this.fitAddon && !this.isCollapsed) {
          this.fitAddon.fit();
        }
      });

      this.connectWebSocket();
    }

    connectWebSocket() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/logs`;

      try {
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          this.updateStatus(true);
        };

        this.socket.onclose = () => {
          this.updateStatus(false);
          // Auto reconnect after 2.5s
          this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2500);
        };

        this.socket.onerror = () => {
          this.updateStatus(false);
        };

        this.socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'history') {
              this.allEntries = (data.entries || []).slice(-this.maxScrollback);
              this.updateLineCount();
              this.renderFilteredEntries();
            } else if (data.type === 'log' && data.entry) {
              this.allEntries.push(data.entry);
              if (this.allEntries.length > this.maxScrollback) {
                this.allEntries.shift();
              }
              this.updateLineCount();

              if (!this.isPaused && this.matchFilter(data.entry)) {
                this.enqueueLog(data.entry.ansi);
              }
            } else if (data.type === 'clear') {
              this.allEntries = [];
              this.term.clear();
              this.updateLineCount();
            }
          } catch (err) {
            console.error('[Terminal] Error processing WS message:', err);
          }
        };
      } catch (err) {
        this.updateStatus(false);
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2500);
      }
    }

    updateStatus(connected) {
      const badge = document.getElementById('terminal-status-badge');
      const text = document.getElementById('terminal-status-text');
      const dot = badge ? badge.querySelector('.status-indicator-dot') : null;

      if (badge && text && dot) {
        if (connected) {
          badge.className = 'tag is-success is-light is-small is-rounded';
          text.textContent = 'Connected';
          dot.className = 'status-indicator-dot is-connected';
        } else {
          badge.className = 'tag is-danger is-light is-small is-rounded';
          text.textContent = 'Disconnected';
          dot.className = 'status-indicator-dot is-disconnected';
        }
      }
    }

    updateLineCount() {
      const countElem = document.getElementById('terminal-line-count');
      if (countElem) {
        countElem.textContent = `${this.allEntries.length} lines`;
      }
    }

    matchFilter(entry) {
      if (this.filterLevel !== 'ALL' && entry.level !== this.filterLevel) {
        return false;
      }
      if (this.filterSearch) {
        const rawLower = (entry.raw || '').toLowerCase();
        if (!rawLower.includes(this.filterSearch)) {
          return false;
        }
      }
      return true;
    }

    enqueueLog(line) {
      this.batchBuffer.push(line);
      if (!this.rafScheduled) {
        this.rafScheduled = true;
        requestAnimationFrame(() => this.flushBatch());
      }
    }

    flushBatch() {
      if (!this.term || this.batchBuffer.length === 0) {
        this.rafScheduled = false;
        return;
      }

      const chunk = this.batchBuffer.join('\r\n') + '\r\n';
      this.batchBuffer = [];
      this.term.write(chunk, () => {
        if (this.autoScroll) {
          this.term.scrollToBottom();
        }
      });
      this.rafScheduled = false;
    }

    renderFilteredEntries() {
      if (!this.term) return;
      this.term.clear();
      this.batchBuffer = [];

      const filtered = this.allEntries.filter((e) => this.matchFilter(e));
      if (filtered.length === 0) {
        if (this.filterSearch || this.filterLevel !== 'ALL') {
          this.term.write('\x1b[90m(No logs matching current filter)\x1b[0m\r\n');
        }
        return;
      }

      // Group in chunks to write smoothly
      const lines = filtered.map((e) => e.ansi).join('\r\n') + '\r\n';
      this.term.write(lines, () => {
        if (this.autoScroll) {
          this.term.scrollToBottom();
        }
      });
    }

    togglePause() {
      this.isPaused = !this.isPaused;
      const btn = document.getElementById('terminal-btn-pause');
      const text = document.getElementById('terminal-pause-text');
      const icon = document.getElementById('terminal-pause-icon');

      if (this.isPaused) {
        btn.classList.add('is-warning');
        text.textContent = 'Resume';
        icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
        if (window.showToast) window.showToast('Terminal stream đã tạm dừng', 'is-warning');
      } else {
        btn.classList.remove('is-warning');
        text.textContent = 'Pause';
        icon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;
        this.renderFilteredEntries();
        if (window.showToast) window.showToast('Terminal stream đang tiếp tục', 'is-info');
      }
    }

    clearScreen() {
      if (this.term) {
        this.term.clear();
      }
      if (window.showToast) {
        window.showToast('Đã xóa màn hình terminal', 'is-light');
      }
    }

    async purgeServerLogs() {
      const ok = confirm(
        '⚠️ XÁC NHẬN: Bạn có chắc chắn muốn xoá vĩnh viễn toàn bộ nội dung file log trên server (logs/server.log) không?'
      );
      if (!ok) return;

      try {
        const res = await fetch('/api/logs', { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
          this.allEntries = [];
          if (this.term) this.term.clear();
          this.updateLineCount();
          if (window.showToast) {
            window.showToast('Toàn bộ file log server đã được xoá sạch', 'is-success');
          }
        } else {
          if (window.showToast) {
            window.showToast(`Lỗi khi xóa log: ${json.message}`, 'is-danger');
          }
        }
      } catch (err) {
        if (window.showToast) {
          window.showToast(`Lỗi kết nối khi xóa log: ${err.message}`, 'is-danger');
        }
      }
    }

    toggleAutoScroll(checked) {
      this.autoScroll = checked;
      if (checked && this.term) {
        this.term.scrollToBottom();
      }
    }

    handleLevelChange(level) {
      this.filterLevel = level;
      this.renderFilteredEntries();
    }

    handleSearch(value) {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = setTimeout(() => {
        this.filterSearch = (value || '').toLowerCase().trim();
        this.renderFilteredEntries();
      }, 150);
    }

    toggleCollapse() {
      this.isCollapsed = !this.isCollapsed;
      const body = document.getElementById('terminal-body');
      const icon = document.getElementById('terminal-collapse-icon');

      if (body) {
        if (this.isCollapsed) {
          body.classList.add('is-collapsed');
          if (icon) {
            icon.innerHTML = `<polyline points="6 9 12 15 18 9"></polyline>`;
          }
        } else {
          body.classList.remove('is-collapsed');
          if (icon) {
            icon.innerHTML = `<polyline points="18 15 12 9 6 15"></polyline>`;
          }
          if (this.fitAddon) {
            setTimeout(() => this.fitAddon.fit(), 50);
          }
        }
      }
    }
  }

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
    initAgGrid();
    window.terminalManager = new TerminalManager();
  });
})();

