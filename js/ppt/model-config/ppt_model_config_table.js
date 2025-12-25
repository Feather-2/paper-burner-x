/**
 * PPT 模型配置 - 统一表格视图
 * IIFE module: window.PPTModelConfig.table
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.table = ns.table || {};

  const {
    CAPABILITY_TAGS = [],
    ROLES = [],
    ROLE_SHORT = {},
    ROLE_DISPLAY_ORDER = [],
    ROLE_NAMES = {},
    ROLE_NAMES_TABLE = {}
  } = ns.constants || {};

  const { safe: _safe } = ns.utils || {};
  const safe = typeof _safe === 'function' ? _safe : (v) => String(v || '');

  ns.core = ns.core || {};
  ns.core.uiState = ns.core.uiState || {};
  const uiState = ns.core.uiState;

  const loadConfig = (...args) => (ns.core && typeof ns.core.loadConfig === 'function' ? ns.core.loadConfig(...args) : null);
  const saveConfig = (...args) => { if (ns.core && typeof ns.core.saveConfig === 'function') ns.core.saveConfig(...args); };
  const showSaveSuccess = (msg) => { if (ns.core && typeof ns.core.showSaveSuccess === 'function') ns.core.showSaveSuccess(msg); };
  const getModalRoot = () => (ns.core && typeof ns.core.getModalRoot === 'function' ? ns.core.getModalRoot() : document.getElementById('ppt-model-config-modal'));

  const getAllConfigurableModels = () => (ns.sources && typeof ns.sources.getAllConfigurableModels === 'function' ? ns.sources.getAllConfigurableModels() : []);
  const fetchModelsForSource = (...args) => (ns.sources && typeof ns.sources.fetchModelsForSource === 'function' ? ns.sources.fetchModelsForSource(...args) : Promise.resolve([]));
  const tab1ModelsSession = (ns.sources && ns.sources.tab1ModelsSession) ? ns.sources.tab1ModelsSession : { cache: {}, inflight: {}, error: {} };

  const normalizeModelTagsConfig = (...args) => (ns.tabs && typeof ns.tabs.normalizeModelTagsConfig === 'function' ? ns.tabs.normalizeModelTagsConfig(...args) : ({}));
  const normalizeRolePriorityConfig = (...args) => (ns.roles && typeof ns.roles.normalizeRolePriorityConfig === 'function' ? ns.roles.normalizeRolePriorityConfig(...args) : ({}));

  const renderRoleOverview = (...args) => { if (ns.roles && typeof ns.roles.renderRoleOverview === 'function') ns.roles.renderRoleOverview(...args); };
  const openRoleHotspareConfig = (...args) => { if (ns.roles && typeof ns.roles.openRoleHotspareConfig === 'function') ns.roles.openRoleHotspareConfig(...args); };
  const openRoleAddPicker = (...args) => { if (ns.roles && typeof ns.roles.openRoleAddPicker === 'function') ns.roles.openRoleAddPicker(...args); };

  const renderTab3Content = (...args) => { if (ns.tabs && typeof ns.tabs.renderTab3Content === 'function') ns.tabs.renderTab3Content(...args); };

  function notify(msg, type = 'info') {
    if (typeof global.showNotification === 'function') {
      global.showNotification(msg, type);
      return;
    }
    if (type === 'error') console.error(msg);
    else console.log(msg);
  }

  function splitFullModelKey(fullKey) {
    const s = String(fullKey || '');
    const idx = s.indexOf(':');
    if (idx <= 0 || idx === s.length - 1) return null;
    return { fullKey: s, sourceKey: s.slice(0, idx), modelId: s.slice(idx + 1) };
  }

  function getKeyStatsForSource(sourceKey) {
    if (!sourceKey || typeof loadModelKeys !== 'function') return { keyCount: 0, validKeyCount: 0 };
    try {
      const keys = (loadModelKeys(sourceKey) || []).filter((k) => k && k.value && String(k.value).trim());
      const keyCount = keys.length;
      const validKeyCount = keys.filter((k) => k.status !== 'invalid').length;
      return { keyCount, validKeyCount };
    } catch (_) {
      return { keyCount: 0, validKeyCount: 0 };
    }
  }

  function getAgentRolePrioritiesForModel(fullKey, roleCfg) {
    const out = {};
    const cfg = normalizeRolePriorityConfig(roleCfg);
    for (const r of ROLES) {
      const list = Array.isArray(cfg[r.id]) ? cfg[r.id] : [];
      const idx = list.indexOf(fullKey);
      out[r.id] = idx >= 0 ? idx + 1 : 0;
    }
    return out;
  }

  function formatAgentRoleSummary(agentRoles) {
    const parts = [];
    for (const roleId of ROLE_DISPLAY_ORDER) {
      const p = Number(agentRoles?.[roleId] || 0);
      if (!p) continue;
      parts.push(`${ROLE_SHORT[roleId] || roleId}${p}`);
    }
    return parts.join(' ');
  }

  function toCircledNumber(n) {
    const map = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
    return map[Number(n)] || String(n || '');
  }

  function formatRoleAssignmentsReadable(agentRoles) {
    const pairs = [];
    for (const roleId of ROLE_DISPLAY_ORDER) {
      const p = Number(agentRoles?.[roleId] || 0);
      if (!p) continue;
      const name = ROLE_NAMES_TABLE[roleId] || ROLE_NAMES[roleId] || roleId;
      pairs.push({ roleId, p, text: `${name}${toCircledNumber(p)}` });
    }
    const orderIndex = new Map(ROLE_DISPLAY_ORDER.map((id, idx) => [id, idx]));
    pairs.sort((a, b) => (a.p - b.p) || ((orderIndex.get(a.roleId) ?? 999) - (orderIndex.get(b.roleId) ?? 999)));
    return pairs.map((x) => x.text).join('');
  }



  function buildModelTableRows() {
    const sources = getAllConfigurableModels();
    const sourceMap = new Map(sources.map((s) => [s.key, s]));

    const tagsCfg = normalizeModelTagsConfig(loadConfig('modelTags'));
    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));

    const configuredFullKeys = new Set();
    for (const k of Object.keys(tagsCfg || {})) configuredFullKeys.add(k);
    for (const list of Object.values(roleCfg || {})) {
      for (const k of Array.isArray(list) ? list : []) configuredFullKeys.add(k);
    }

    for (const fullKey of configuredFullKeys) {
      const parts = splitFullModelKey(fullKey);
      if (!parts) continue;
      if (!sourceMap.has(parts.sourceKey)) {
        sourceMap.set(parts.sourceKey, { key: parts.sourceKey, name: parts.sourceKey, group: 'unknown' });
      }
    }

    const rows = [];
    const capIdSet = new Set(CAPABILITY_TAGS.map((t) => t.id));

    for (const [sourceKey, source] of sourceMap.entries()) {
      const fetched = Array.isArray(tab1ModelsSession.cache[sourceKey]) ? tab1ModelsSession.cache[sourceKey] : [];
      const modelIds = new Set(fetched);

      for (const fullKey of configuredFullKeys) {
        const parts = splitFullModelKey(fullKey);
        if (!parts || parts.sourceKey !== sourceKey) continue;
        modelIds.add(parts.modelId);
      }

      const { keyCount, validKeyCount } = getKeyStatsForSource(sourceKey);

      for (const modelId of Array.from(modelIds)) {
        const fullKey = `${sourceKey}:${modelId}`;
        const capabilitiesRaw = Array.isArray(tagsCfg[fullKey]) ? tagsCfg[fullKey] : [];
        const capabilities = Array.from(new Set(capabilitiesRaw.map((x) => String(x || '').trim()).filter((x) => capIdSet.has(x))));
        const agentRoles = getAgentRolePrioritiesForModel(fullKey, roleCfg);

        rows.push({
          id: fullKey,
          modelId,
          sourceKey,
          sourceName: source?.name || sourceKey,
          capabilities,
          keyCount,
          validKeyCount,
          agentRoles
        });
      }
    }

    rows.sort((a, b) => {
      const s = String(a.sourceName || '').localeCompare(String(b.sourceName || ''), 'zh');
      if (s !== 0) return s;
      return String(a.modelId || '').localeCompare(String(b.modelId || ''), 'zh');
    });

    return rows;
  }

  function renderModelRow(model) {
    const capabilityIcon = new Map(CAPABILITY_TAGS.map((t) => [t.id, t.icon]));
    const capabilityName = new Map(CAPABILITY_TAGS.map((t) => [t.id, t.name]));

    const capsHtml = (model.capabilities || []).length
      ? model.capabilities.map((c) => `
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 bg-white" title="${safe(capabilityName.get(c) || c)}">
            <iconify-icon icon="${safe(capabilityIcon.get(c) || 'carbon:dot-mark')}" width="16"></iconify-icon>
          </span>
        `).join('')
      : `<span class="text-slate-400 text-xs">—</span>`;

    const keyIcon = (() => {
      if (!model.keyCount) return { icon: 'carbon:warning-filled', style: 'color:#ef4444' };
      if (model.validKeyCount >= model.keyCount) return { icon: 'carbon:checkmark-filled', style: 'color:#10b981' };
      if (model.validKeyCount > 0) return { icon: 'carbon:warning-filled', style: 'color:#f59e0b' };
      return { icon: 'carbon:warning-filled', style: 'color:#ef4444' };
    })();

    const rolesReadable = formatRoleAssignmentsReadable(model.agentRoles);

    return `
      <tr class="pmc-model-row hover:bg-slate-50" data-model-full-key="${safe(model.id)}">
        <td class="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">${safe(model.modelId)}</td>
        <td class="px-4 py-3 text-slate-600 whitespace-nowrap">${safe(model.sourceName)}</td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-1">${capsHtml}</div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap">
          <div class="inline-flex items-center gap-2 text-slate-700">
            <span class="font-mono text-xs">${safe(String(model.validKeyCount))}/${safe(String(model.keyCount))}</span>
            <iconify-icon icon="${safe(keyIcon.icon)}" width="16" style="${safe(keyIcon.style)}"></iconify-icon>
          </div>
        </td>
        <td class="px-4 py-3 text-slate-700 max-w-[160px]">
          ${rolesReadable ? `<span class="text-xs break-words">${safe(rolesReadable)}</span>` : `<span class="text-slate-400 text-xs">-</span>`}
        </td>
        <td class="px-4 py-3 text-right whitespace-nowrap">
          <button class="pmc-model-config-btn inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs" data-action="open-config" type="button">
            <iconify-icon icon="carbon:settings" width="16"></iconify-icon>
            配置
          </button>
        </td>
      </tr>
    `;
  }

  function renderModelTable(container) {
    if (!container) return;

    container.className = 'pmc-model-explorer';
    container.innerHTML = `
      <div class="pmc-explorer-sidebar">
        <div class="pmc-sidebar-header">
          <iconify-icon icon="carbon:cloud-service-management" width="16"></iconify-icon>
          <span>模型来源</span>
        </div>
        <div id="pmc-source-sidebar-list" class="pmc-sidebar-list"></div>
      </div>
      
      <div class="pmc-explorer-main">
        <div class="bg-white border-b border-slate-200 p-4">
          <div class="flex flex-wrap items-center gap-3">
            <div class="text-sm font-semibold text-slate-800 mr-auto">
              <span id="pmc-active-source-name">全部模型</span>
              (<span id="pmc-model-total-count">0</span>)
            </div>
            <div class="relative flex items-center">
              <iconify-icon icon="carbon:search" class="absolute left-3 text-slate-400" width="16"></iconify-icon>
              <input id="pmc-model-search" class="pmc-input pl-9 w-[240px]" placeholder="在当前源中搜索..." autocomplete="off" value="${safe(uiState.tableSearch || '')}">
            </div>
            <label class="inline-flex items-center gap-2 text-xs text-slate-600 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors">
              <input id="pmc-model-configured-only" type="checkbox" ${uiState.tableConfiguredOnly ? 'checked' : ''}>
              仅显示已配置
            </label>
            <button id="pmc-model-refresh" class="pmc-btn-secondary" type="button" title="刷新模型列表">
              <iconify-icon icon="carbon:renew" width="16"></iconify-icon>
              刷新
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-auto bg-slate-50/30">
          <table class="min-w-full text-sm" style="table-layout: fixed;">
            <thead class="bg-white text-slate-700 sticky top-0 z-10 shadow-sm">
              <tr class="border-b border-slate-200">
                <th class="px-4 py-3 text-left font-semibold whitespace-nowrap" style="width: 30%;">模型名称</th>
                <th class="px-4 py-3 text-left font-semibold whitespace-nowrap" style="width: 15%;">来源</th>
                <th class="px-4 py-3 text-left font-semibold whitespace-nowrap" style="width: 15%;">能力</th>
                <th class="px-4 py-3 text-left font-semibold whitespace-nowrap" style="width: 12%;">Key状态</th>
                <th class="px-4 py-3 text-left font-semibold whitespace-nowrap" style="width: 18%;">角色分配</th>
                <th class="px-4 py-3 text-right font-semibold whitespace-nowrap" style="width: 10%;">操作</th>
              </tr>
            </thead>
            <tbody id="pmc-model-table-body" class="divide-y divide-slate-100 bg-white"></tbody>
          </table>
          <div id="pmc-model-table-footer" class="px-4 py-3 bg-white text-xs text-slate-500 border-t border-slate-100"></div>
        </div>
      </div>
    `;

    const sidebarListEl = container.querySelector('#pmc-source-sidebar-list');
    const activeSourceNameEl = container.querySelector('#pmc-active-source-name');
    const totalCountEl = container.querySelector('#pmc-model-total-count');
    const searchEl = container.querySelector('#pmc-model-search');
    const configuredOnlyEl = container.querySelector('#pmc-model-configured-only');
    const bodyEl = container.querySelector('#pmc-model-table-body');
    const footerEl = container.querySelector('#pmc-model-table-footer');
    const refreshBtn = container.querySelector('#pmc-model-refresh');

    const rerender = () => {
      const allRows = buildModelTableRows();
      let sources = getAllConfigurableModels();
      
      // 统计各源站模型数量
      const sourceStats = new Map();
      allRows.forEach(r => {
          sourceStats.set(r.sourceKey, (sourceStats.get(r.sourceKey) || 0) + 1);
      });

      // 按照模型数量从多到少排序源站列表
      sources.sort((a, b) => {
          const countA = sourceStats.get(a.key) || 0;
          const countB = sourceStats.get(b.key) || 0;
          return countB - countA; // 降序
      });

      const sidebarHtml = `
        <div class="pmc-sidebar-item ${!uiState.tableSourceKey ? 'active' : ''}" data-source-key="">
          <iconify-icon icon="carbon:list" width="16"></iconify-icon>
          <span class="pmc-sidebar-label">全部模型</span>
          <span class="pmc-sidebar-count">${allRows.length}</span>
        </div>
        ${sources.map(s => {
            const count = sourceStats.get(s.key) || 0;
            const active = uiState.tableSourceKey === s.key ? 'active' : '';
            const icon = s.key.startsWith('custom_source_') ? 'carbon:settings' : 'carbon:cloud';
            return `
              <div class="pmc-sidebar-item ${active}" data-source-key="${safe(s.key)}">
                <iconify-icon icon="${icon}" width="16"></iconify-icon>
                <span class="pmc-sidebar-label" title="${safe(s.name || s.key)}">${safe(s.name || s.key)}</span>
                <span class="pmc-sidebar-count">${count}</span>
              </div>
            `;
        }).join('')}
      `;
      
      if (sidebarListEl.innerHTML !== sidebarHtml) {
          sidebarListEl.innerHTML = sidebarHtml;
      }

      // 过滤逻辑
      const q = String(uiState.tableSearch || '').trim().toLowerCase();
      const sourceKey = String(uiState.tableSourceKey || '');
      const configuredOnly = !!uiState.tableConfiguredOnly;

      const filtered = allRows.filter((r) => {
        if (sourceKey && r.sourceKey !== sourceKey) return false;
        if (configuredOnly && !Object.values(r.agentRoles || {}).some((x) => Number(x) > 0)) return false;
        if (!q) return true;
        return (
          String(r.modelId || '').toLowerCase().includes(q) ||
          String(r.sourceName || '').toLowerCase().includes(q) ||
          String(r.id || '').toLowerCase().includes(q)
        );
      });

      if (activeSourceNameEl) {
          const currentSource = sources.find(s => s.key === sourceKey);
          activeSourceNameEl.textContent = currentSource ? (currentSource.name || currentSource.key) : '全部模型';
      }
      
      if (totalCountEl) totalCountEl.textContent = String(filtered.length);

      // 只有在角色分配 Tab 处于非激活状态或需要跨 Tab 同步时才更新外部容器
      const roleOverviewElTab = document.getElementById('pmc-role-overview-container-tab');
      if (roleOverviewElTab) {
          renderRoleOverview(roleOverviewElTab, allRows, uiState._refreshModelTable);
      }

      // 性能优化：首屏渲染限制
      const DISPLAY_LIMIT = 200;
      const displayRows = filtered.slice(0, DISPLAY_LIMIT);
      
      const nextHtml = filtered.length
        ? displayRows.map(renderModelRow).join('') + (filtered.length > DISPLAY_LIMIT ? `<tr><td colspan="6" class="py-4 text-center text-slate-400">还有 ${filtered.length - DISPLAY_LIMIT} 个模型，请使用搜索进行筛选</td></tr>` : '')
        : `<tr><td class="px-4 py-8 text-center text-slate-400" colspan="6">没有匹配的模型</td></tr>`;

      if (bodyEl.innerHTML !== nextHtml) {
          bodyEl.innerHTML = nextHtml;
      }

      const inflightCount = Object.keys(tab1ModelsSession.inflight || {}).length;
      const errCount = Object.values(tab1ModelsSession.error || {}).filter(Boolean).length;
      const hint = [];
      hint.push(`显示 ${displayRows.length}/${filtered.length}`);
      if (inflightCount) hint.push(`正在后台探测 ${inflightCount} 个源站的模型...`);
      if (errCount) hint.push(`获取失败：${errCount}`);
      footerEl.textContent = hint.join(' · ');
      
      if (footerEl) {
          footerEl.style.color = inflightCount > 0 ? 'var(--pmc-primary)' : '';
          footerEl.style.fontWeight = inflightCount > 0 ? '600' : '';
      }

      uiState._refreshModelTable = () => {
          if (uiState._refreshInflight) return;
          uiState._refreshInflight = true;
          requestAnimationFrame(() => {
              rerender();
              uiState._refreshInflight = false;
          });
      };
    };

    sidebarListEl.addEventListener('click', (e) => {
        const item = e.target.closest('.pmc-sidebar-item');
        if (!item) return;
        const key = item.getAttribute('data-source-key') || '';
        uiState.tableSourceKey = key;
        rerender();
    });

    const onRefresh = async () => {
      if (refreshBtn) refreshBtn.disabled = true;
      const sourceKey = String(uiState.tableSourceKey || '');
      const sourcesToRefresh = sourceKey ? [sourceKey] : getAllConfigurableModels().map((s) => s.key);

      for (const k of sourcesToRefresh) {
        delete tab1ModelsSession.cache[k];
        delete tab1ModelsSession.error[k];
      }

      rerender();
      
      // 迭代刷新，提高及时感
      for (const k of sourcesToRefresh) {
        try {
            await fetchModelsForSource(k);
            rerender(); // 每拿完一个源就刷一次
        } catch (e) {}
      }
      
      showSaveSuccess('模型列表已刷新');
      if (refreshBtn) refreshBtn.disabled = false;
    };

    const openConfigForFullKey = (fullKey) => {
      const all = buildModelTableRows();
      const model = all.find((r) => r.id === fullKey);
      if (!model) return;
      renderModelConfigPopup(model);
    };

    let searchDebounceTimer = null;
    searchEl?.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
          uiState.tableSearch = String(searchEl.value || '');
          rerender();
      }, 300);
    });

    configuredOnlyEl?.addEventListener('change', () => {
      uiState.tableConfiguredOnly = !!configuredOnlyEl.checked;
      rerender();
    });

    refreshBtn?.addEventListener('click', onRefresh);

    bodyEl?.addEventListener('click', (e) => {
      const actionBtn = e.target?.closest?.('[data-action="open-config"]');
      if (!actionBtn) return;
      const row = actionBtn?.closest?.('tr[data-model-full-key]');
      const fullKey = row?.getAttribute?.('data-model-full-key');
      if (!fullKey) return;
      openConfigForFullKey(fullKey);
    });

    rerender();
  }

  let activeModelConfigPopupEl = null;

  function renderModelConfigPopup(model) {
    if (!model?.id) return;

    if (activeModelConfigPopupEl) {
      activeModelConfigPopupEl.remove();
      activeModelConfigPopupEl = null;
    }

    const fullKey = model.id;
    const modelTagsCfg = normalizeModelTagsConfig(loadConfig('modelTags'));
    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));

    const selectedTags = new Set(Array.isArray(modelTagsCfg[fullKey]) ? modelTagsCfg[fullKey] : []);
    const priorities = getAgentRolePrioritiesForModel(fullKey, roleCfg);

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 flex items-center justify-center';
    popup.style.zIndex = '11000';

    popup.innerHTML = `
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative w-[min(760px,95vw)] max-h-[90vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200" style="display:flex; flex-direction:column;">
        <div class="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <div class="text-base font-semibold text-slate-900">模型配置</div>
            <div class="text-xs text-slate-500 mt-1 font-mono">${safe(model.sourceKey)}:${safe(model.modelId)}</div>
          </div>
          <button class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500" data-action="close" type="button" title="关闭">
            <iconify-icon icon="carbon:close" width="20"></iconify-icon>
          </button>
        </div>

        <div class="p-5 space-y-6 overflow-y-auto flex-1">
          <div>
            <div class="text-sm font-semibold text-slate-800 mb-3">能力</div>
            <div class="flex flex-wrap gap-2">
              ${CAPABILITY_TAGS.map((t) => {
                const active = selectedTags.has(t.id);
                return `
                  <button
                    class="pmc-cap-btn ${active ? 'selected' : ''}"
                    data-action="toggle-cap"
                    data-cap="${safe(t.id)}"
                    type="button"
                  >
                    <iconify-icon icon="${safe(t.icon)}" width="18"></iconify-icon>
                    <span class="text-sm font-medium">${safe(t.name)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div>
            <div class="text-sm font-semibold text-slate-800 mb-3">角色分配</div>
            <div class="pmc-role-assign-list">
              ${ROLES.map((r) => {
                const v = Math.min(5, Math.max(0, Number(priorities?.[r.id] || 0)));
                const checked = v > 0;
                return `
                  <div class="pmc-role-assign-item">
                    <label>
                      <input class="pmc-role-check" type="checkbox" data-role="${safe(r.id)}" ${checked ? 'checked' : ''}>
                      <span>${safe(ROLE_NAMES[r.id] || r.name)}</span>
                    </label>
                    <input class="pmc-role-priority priority-input" type="number" min="1" max="5" step="1" data-role-priority="${safe(r.id)}" value="${safe(String(checked ? v : 1))}" ${checked ? '' : 'disabled'}>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="px-5 py-4 border-t border-slate-200 bg-white flex items-center justify-end gap-2 flex-shrink-0">
          <button class="pmc-btn-secondary" data-action="cancel" type="button">取消</button>
          <button class="pmc-btn-save" data-action="save" type="button">
            <iconify-icon icon="carbon:save" width="16"></iconify-icon>
            保存
          </button>
        </div>
      </div>
    `;

    const close = () => {
      popup.remove();
      if (activeModelConfigPopupEl === popup) activeModelConfigPopupEl = null;
    };

    const backdrop = popup.querySelector('.absolute.inset-0');
    backdrop?.addEventListener('click', close);

    popup.querySelectorAll('[data-action="close"], [data-action="cancel"]').forEach((el) => {
      el.addEventListener('click', close);
    });

    popup.querySelectorAll('[data-action="toggle-cap"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cap = btn.getAttribute('data-cap');
        if (!cap) return;
        if (selectedTags.has(cap)) selectedTags.delete(cap);
        else selectedTags.add(cap);
        btn.classList.toggle('selected', selectedTags.has(cap));
      });
    });

    popup.querySelectorAll('.pmc-role-check').forEach((ck) => {
      ck.addEventListener('change', () => {
        const roleId = ck.getAttribute('data-role');
        if (!roleId) return;
        const input = popup.querySelector(`.pmc-role-priority[data-role-priority="${roleId}"]`);
        if (!input) return;
        input.disabled = !ck.checked;
        if (ck.checked && !Number(input.value)) input.value = '1';
      });
    });

    popup.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      const nextTags = Array.from(selectedTags).filter(Boolean);
      modelTagsCfg[fullKey] = nextTags;
      saveConfig('modelTags', modelTagsCfg);

      const nextRoleCfg = normalizeRolePriorityConfig(roleCfg);
      for (const r of ROLES) {
        const ck = popup.querySelector(`.pmc-role-check[data-role="${r.id}"]`);
        const enabled = !!ck?.checked;
        const input = popup.querySelector(`.pmc-role-priority[data-role-priority="${r.id}"]`);
        const nRaw = enabled ? Number(input?.value || 1) : 0;
        const n = enabled ? Math.min(5, Math.max(1, Math.floor(nRaw || 1))) : 0;

        const list = Array.isArray(nextRoleCfg[r.id]) ? nextRoleCfg[r.id].filter((x) => x !== fullKey) : [];
        if (n > 0) {
          const idx = Math.max(0, Math.min(list.length, n - 1));
          list.splice(idx, 0, fullKey);
        }
        nextRoleCfg[r.id] = Array.from(new Set(list));
      }
      saveConfig('rolePriority', nextRoleCfg);

      showSaveSuccess('模型配置已保存');
      close();
      if (typeof uiState._refreshModelTable === 'function') uiState._refreshModelTable();
    });

    document.body.appendChild(popup);
    activeModelConfigPopupEl = popup;
  }

  function initModelTableView({ forceRender = false } = {}) {
    const root = getModalRoot();
    if (!root) return;

    const container = root.querySelector('#pmc-model-table-container');
    if (container && (forceRender || container.dataset.rendered !== '1')) {
      renderModelTable(container);
      container.dataset.rendered = '1';
    }

    const collapse = root.querySelector('.pmc-audio-collapse');
    if (collapse && collapse.dataset.bound !== '1') {
      const header = collapse.querySelector('.pmc-audio-collapse-header');
      const body = collapse.querySelector('.pmc-audio-collapse-body');
      const chevron = collapse.querySelector('.pmc-audio-collapse-chevron');
      collapse.dataset.bound = '1';

      const setOpen = (open) => {
        collapse.classList.toggle('open', !!open);
        if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
      };
      setOpen(false);

      header?.addEventListener('click', () => {
        const isOpen = collapse.classList.contains('open');
        setOpen(!isOpen);
      });
    }

    // 每次打开都刷新音频区内容（保留现有 renderTab3Content 实现）
    const audioBody = root.querySelector('.pmc-audio-collapse-body');
    if (audioBody) {
      renderTab3Content(audioBody);
      // 默认折叠（每次打开重置）
      const collapseEl = root.querySelector('.pmc-audio-collapse');
      if (collapseEl) collapseEl.classList.remove('open');
      const chevron = root.querySelector('.pmc-audio-collapse-chevron');
      if (chevron) chevron.style.transform = '';
    }
  }

  function preloadAllSourcesModels() {
    const root = getModalRoot();
    if (!root) return;

    const sources = getAllConfigurableModels();
    if (!sources.length) return;

    // 性能优化：并发拉取，但每个源完成后都立即触发局部刷新
    sources.forEach(async (s) => {
        try {
            await fetchModelsForSource(s.key);
            // 这里不直接 rerender，而是请求一次刷新
            if (typeof uiState._refreshModelTable === 'function') {
                uiState._refreshModelTable();
            }
        } catch (e) {}
    });
  }

  Object.assign(ns.table, {
    buildModelTableRows,
    renderModelRow,
    renderModelTable,
    initModelTableView,
    preloadAllSourcesModels,
    renderModelConfigPopup,
    splitFullModelKey,
    getKeyStatsForSource,
    getAgentRolePrioritiesForModel,
    formatAgentRoleSummary,
    formatRoleAssignmentsReadable,
    toCircledNumber
  });

  Object.defineProperty(ns.table, 'activeModelConfigPopupEl', {
    enumerable: true,
    get: () => activeModelConfigPopupEl
  });
})(typeof window !== 'undefined' ? window : this);
