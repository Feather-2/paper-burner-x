// Admin System/Proxy Settings Module (ESM)
// Depends on globals: axios, window.API_BASE, window.authToken

function setInputValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
function getInputValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function setSelectValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getSelectValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderEffectiveProxySettings(d) {
  const containerId = 'effectiveProxySettings';
  let container = document.getElementById(containerId);
  if (!container) {
    const sys = document.getElementById('content-system');
    if (!sys) return;
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'mt-6 bg-gray-50 border rounded-md p-4';
    sys.appendChild(container);
  }
  try {
    const sources = d?.sources || {};
    const eff = d?.effective || {};
    const nl = arr => Array.isArray(arr) && arr.length ? arr.map(x => `<code class="px-1 py-0.5 bg-white border rounded">${escapeHtml(String(x))}</code>`).join(' ') : '<span class="text-gray-400">(空)</span>';
    container.innerHTML = `
      <h4 class="text-sm font-medium text-gray-800 mb-2">当前生效的代理设置（合并 + 来源）</h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div class="bg-white rounded border p-3">
          <div class="font-medium text-gray-700 mb-1">合并后白名单</div>
          <div class="space-x-1">${nl(eff.whitelist)}</div>
        </div>
        <div class="bg-white rounded border p-3">
          <div class="font-medium text-gray-700 mb-1">开关与限制</div>
          <div class="text-gray-600">允许 HTTP：${eff.allowHttp ? '是' : '否'}</div>
          <div class="text-gray-600">上游超时：${eff.timeoutMs} ms</div>
          <div class="text-gray-600">下载上限：${Math.round((eff.maxDownloadBytes||0)/1024/1024)} MB</div>
        </div>
        <div class="bg-white rounded border p-3 md:col-span-2">
          <div class="font-medium text-gray-700 mb-1">来源拆解</div>
          <div class="mt-1"><span class="text-gray-600">默认域：</span>${nl(sources.defaults)}</div>
          <div class="mt-1"><span class="text-gray-600">手动白名单：</span>${nl(sources.manualWhitelist)}</div>
          <div class="mt-1"><span class="text-gray-600">Workers 域：</span>${nl(sources.workerDomains)}</div>
          <div class="mt-1"><span class="text-gray-600">自定义源站域：</span>${nl(sources.customSiteDomains)}</div>
        </div>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="text-sm text-red-600">无法渲染有效配置：${escapeHtml(e.message||'')}</div>`;
  }
}

async function loadProxySettings() {
  try {
    const resp = await axios.get(`${window.API_BASE}/admin/config`, { headers: { Authorization: `Bearer ${window.authToken}` } });
    const cfg = resp.data || {};
    setSelectValue('allowRegistration', (cfg.ALLOW_REGISTRATION || 'false').toString());
    setInputValue('maxUploadSize', cfg.MAX_UPLOAD_SIZE_MB || '100');
    setInputValue('proxyWhitelistDomains', cfg.PROXY_WHITELIST_DOMAINS || '');
    setInputValue('workerProxyDomains', cfg.WORKER_PROXY_DOMAINS || '');
    setSelectValue('allowHttpProxy', (cfg.ALLOW_HTTP_PROXY || 'false').toString());
    setInputValue('ocrUpstreamTimeoutMs', cfg.OCR_UPSTREAM_TIMEOUT_MS || '30000');
    setInputValue('maxProxyDownloadMb', cfg.MAX_PROXY_DOWNLOAD_MB || '100');
    const eff = await axios.get(`${window.API_BASE}/admin/proxy-settings/effective`, { headers: { Authorization: `Bearer ${window.authToken}` } });
    renderEffectiveProxySettings(eff.data);
  } catch (e) {
    console.error('Failed to load proxy settings:', e);
  }
}

async function saveSystemSettings() {
  try {
    const entries = [
      { key: 'ALLOW_REGISTRATION', value: getSelectValue('allowRegistration') },
      { key: 'MAX_UPLOAD_SIZE_MB', value: String(parseInt(getInputValue('maxUploadSize') || '100')) },
    ];
    for (const item of entries) {
      await axios.put(`${window.API_BASE}/admin/config`, item, { headers: { Authorization: `Bearer ${window.authToken}` } });
    }
    alert('系统设置已保存');
  } catch (e) {
    console.error('Failed to save system settings:', e);
    alert('保存失败：' + (e.response?.data?.error || e.message));
  }
}

async function saveProxySettings() {
  try {
    const entries = [
      { key: 'PROXY_WHITELIST_DOMAINS', value: getInputValue('proxyWhitelistDomains') },
      { key: 'WORKER_PROXY_DOMAINS', value: getInputValue('workerProxyDomains') },
      { key: 'ALLOW_HTTP_PROXY', value: getSelectValue('allowHttpProxy') },
      { key: 'OCR_UPSTREAM_TIMEOUT_MS', value: String(parseInt(getInputValue('ocrUpstreamTimeoutMs') || '30000')) },
      { key: 'MAX_PROXY_DOWNLOAD_MB', value: String(parseInt(getInputValue('maxProxyDownloadMb') || '100')) },
    ];
    for (const item of entries) {
      await axios.put(`${window.API_BASE}/admin/config`, item, { headers: { Authorization: `Bearer ${window.authToken}` } });
    }
    alert('已保存，约 60 秒内生效');
  } catch (e) {
    console.error('Failed to save proxy settings:', e);
    alert('保存失败：' + (e.response?.data?.error || e.message));
  }
}

async function refreshEffectiveProxySettings() {
  try {
    const eff = await axios.get(`${window.API_BASE}/admin/proxy-settings/effective`, { headers: { Authorization: `Bearer ${window.authToken}` } });
    renderEffectiveProxySettings(eff.data);
  } catch (e) {
    alert('刷新失败：' + (e.response?.data?.error || e.message));
  }
}

async function applyProxySettingsNow() {
  try {
    await axios.post(`${window.API_BASE}/admin/proxy-settings/apply-now`, {}, { headers: { Authorization: `Bearer ${window.authToken}` } });
    await refreshEffectiveProxySettings();
    alert('已立即应用配置（缓存清空）');
  } catch (e) {
    alert('操作失败：' + (e.response?.data?.error || e.message));
  }
}

async function clearProxyDomains() {
  if (!confirm('确定清空“代理白名单域（手动）”与“Workers 代理域”吗？')) return;
  try {
    const entries = [
      { key: 'PROXY_WHITELIST_DOMAINS', value: '' },
      { key: 'WORKER_PROXY_DOMAINS', value: '' },
    ];
    for (const item of entries) {
      await axios.put(`${window.API_BASE}/admin/config`, item, { headers: { Authorization: `Bearer ${window.authToken}` } });
    }
    await applyProxySettingsNow();
    setInputValue('proxyWhitelistDomains', '');
    setInputValue('workerProxyDomains', '');
  } catch (e) {
    alert('清空失败：' + (e.response?.data?.error || e.message));
  }
}

export async function initSystem() {
  await loadProxySettings();
  // 暴露到 window，兼容现有 onclick
  window.saveSystemSettings = saveSystemSettings;
  window.saveProxySettings = saveProxySettings;
  window.refreshEffectiveProxySettings = refreshEffectiveProxySettings;
  window.applyProxySettingsNow = applyProxySettingsNow;
  window.clearProxyDomains = clearProxyDomains;
}
