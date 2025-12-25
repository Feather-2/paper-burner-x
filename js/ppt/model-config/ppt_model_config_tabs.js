/**
 * PPT 模型配置 - Tabs 内容
 * IIFE module: window.PPTModelConfig.tabs
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.tabs = ns.tabs || {};

  const { CAPABILITY_TAGS = [], ROLES = [], TRANSCRIPTION_PROVIDERS = [], SYNTHESIS_PROVIDERS = [] } = ns.constants || {};
  const { normalizeObject: _normalizeObject, safe: _safe } = ns.utils || {};
  const normalizeObject = typeof _normalizeObject === 'function' ? _normalizeObject : (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const safe = typeof _safe === 'function' ? _safe : (v) => String(v || '');

  ns.core = ns.core || {};
  ns.core.uiState = ns.core.uiState || {};
  const uiState = ns.core.uiState;

  const getModalRoot = () => (ns.core && typeof ns.core.getModalRoot === 'function' ? ns.core.getModalRoot() : document.getElementById('ppt-model-config-modal'));

  const loadConfig = (...args) => (ns.core && typeof ns.core.loadConfig === 'function' ? ns.core.loadConfig(...args) : null);
  const saveConfig = (...args) => { if (ns.core && typeof ns.core.saveConfig === 'function') ns.core.saveConfig(...args); };
  const showSaveSuccess = (msg) => { if (ns.core && typeof ns.core.showSaveSuccess === 'function') ns.core.showSaveSuccess(msg); };

  const getAllConfigurableModels = () => (ns.sources && typeof ns.sources.getAllConfigurableModels === 'function' ? ns.sources.getAllConfigurableModels() : []);
  const fetchModelsForSource = (...args) => (ns.sources && typeof ns.sources.fetchModelsForSource === 'function' ? ns.sources.fetchModelsForSource(...args) : Promise.resolve([]));
  const tab1ModelsSession = (ns.sources && ns.sources.tab1ModelsSession) ? ns.sources.tab1ModelsSession : { cache: {}, inflight: {}, error: {} };

  const normalizeRolePriorityConfig = (...args) => (ns.roles && typeof ns.roles.normalizeRolePriorityConfig === 'function' ? ns.roles.normalizeRolePriorityConfig(...args) : ({}));
  const setupDragAndDrop = (...args) => { if (ns.roles && typeof ns.roles.setupDragAndDrop === 'function') ns.roles.setupDragAndDrop(...args); };

  function activateTab(tab) {
    const root = getModalRoot();
    if (!root) return;

    uiState.activeTab = tab;

    // 更新顶部 Tab 按钮状态
    const btns = root.querySelectorAll('.pmc-tab-btn');
    btns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));

    // 更新面板显示
    const panels = root.querySelectorAll('.pmc-tab-panel');
    panels.forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === tab));

    const panel = root.querySelector(`.pmc-tab-panel[data-panel="${tab}"]`);
    if (!panel) return;

    if (tab === 'quick') {
        // 快捷指派内容已在模板中
    } else if (tab === 'models') {
        ns.table?.initModelTableView?.({ forceRender: true });
    } else if (tab === 'roles') {
        const roleContainer = root.querySelector('#pmc-role-overview-container-tab');
        if (roleContainer) {
            const rows = ns.table?.buildModelTableRows?.() || [];
            ns.roles?.renderRoleOverview?.(roleContainer, rows, () => {
                if (typeof uiState._refreshModelTable === 'function') uiState._refreshModelTable();
            });
        }
    } else if (tab === 'advanced') {
        renderTab3Content(panel);
        ns.advanced?.loadImageSettings?.();
        ns.advanced?.updateStatsDisplay?.();
    }
  }

  function initTabSwitching() {
    const root = getModalRoot();
    if (!root) return;

    const nav = root.querySelector('.pmc-tabs-nav');
    if (!nav || nav.dataset.bound === '1') return;
    nav.dataset.bound = '1';

    nav.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.pmc-tab-btn');
      if (!btn) return;
      const tab = btn.getAttribute('data-tab');
      if (!tab) return;
      activateTab(tab);
    });

    const initialBtn = nav.querySelector('.pmc-tab-btn.active') || nav.querySelector('.pmc-tab-btn');
    const tab = initialBtn?.getAttribute('data-tab') || 'quick';
    activateTab(tab);
  }



  function normalizeModelTagsConfig(raw) {
    const obj = normalizeObject(raw);
    const out = {};
    for (const [modelKey, tags] of Object.entries(obj)) {
      if (!modelKey) continue;
      const arr = Array.isArray(tags) ? tags : [];
      const cleaned = [];
      const seen = new Set();
      for (const t of arr) {
        const id = String(t || '').trim();
        if (!id || seen.has(id)) continue;
        if (!CAPABILITY_TAGS.some((x) => x.id === id)) continue;
        seen.add(id);
        cleaned.push(id);
      }
      out[modelKey] = cleaned;
    }
    return out;
  }

  function renderTab1Content(panel) {
    panel.innerHTML = `
      <div class="pmc-tab-layout pmc-tab-layout-60-40">
        <div class="pmc-tab-left">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:catalog" width="18"></iconify-icon>
            源站 / 模型列表
          </div>
          <div class="pmc-form-group">
            <input id="pmc-tags-search" class="pmc-input" placeholder="搜索模型..." autocomplete="off">
          </div>
          <div id="pmc-tags-source-list" class="pmc-accordion"></div>
        </div>
        <div class="pmc-tab-right">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:tag-group" width="18"></iconify-icon>
            能力标签
            <span id="pmc-tags-selected-name" class="pmc-panel-subtitle">未选择模型</span>
          </div>
          <div id="pmc-tags-icons" class="pmc-tags-icons"></div>
          <div class="pmc-tab-actions">
            <button id="pmc-tags-clear" class="pmc-btn-secondary" disabled>
              <iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>
              清空当前模型标签
            </button>
          </div>
          <div class="pmc-helper-text">提示：为每个具体模型打上能力标签（存储格式：<code>{ "openai:gpt-4o": ["lang"] }</code>）。</div>
        </div>
      </div>
    `;

    const sourceListEl = panel.querySelector('#pmc-tags-source-list');
    const searchEl = panel.querySelector('#pmc-tags-search');
    const iconsEl = panel.querySelector('#pmc-tags-icons');
    const selectedNameEl = panel.querySelector('#pmc-tags-selected-name');
    const clearBtn = panel.querySelector('#pmc-tags-clear');

    const sources = getAllConfigurableModels();
    console.log('[PPT Model Config] Tab1 sources:', sources);
    const cfg = normalizeModelTagsConfig(loadConfig('modelTags'));

    const expandedSet = new Set(Array.isArray(uiState.tagsExpandedSources) ? uiState.tagsExpandedSources : []);

    const getSourceName = (sourceKey) => sources.find((s) => s.key === sourceKey)?.name || sourceKey;

    const getActiveModelParts = () => {
      const fullKey = uiState.tagsActiveModelKey;
      if (!fullKey || !String(fullKey).includes(':')) return null;
      const idx = String(fullKey).indexOf(':');
      const sourceKey = String(fullKey).slice(0, idx);
      const modelId = String(fullKey).slice(idx + 1);
      if (!sourceKey || !modelId) return null;
      return { fullKey, sourceKey, modelId };
    };

    const getSelectedTags = () => {
      const active = getActiveModelParts();
      if (!active) return [];
      return Array.isArray(cfg[active.fullKey]) ? cfg[active.fullKey] : [];
    };

    const countTaggedModelsForSource = (sourceKey) => {
      const prefix = `${sourceKey}:`;
      let count = 0;
      for (const [k, v] of Object.entries(cfg)) {
        if (!k.startsWith(prefix)) continue;
        if (Array.isArray(v) && v.length) count += 1;
      }
      return count;
    };

    const ensureModelsLoaded = async (sourceKey) => {
      if (!sourceKey) return;
      if (Array.isArray(tab1ModelsSession.cache[sourceKey])) return;
      await fetchModelsForSource(sourceKey);
    };

    const renderSourceList = () => {
      const q = String(searchEl?.value || '').trim().toLowerCase();

      sourceListEl.innerHTML = sources.length
        ? sources.map((s) => {
            const open = expandedSet.has(s.key);
            const loading = !!tab1ModelsSession.inflight[s.key];
            const models = Array.isArray(tab1ModelsSession.cache[s.key]) ? tab1ModelsSession.cache[s.key] : null;
            const error = tab1ModelsSession.error[s.key] || '';
            const taggedCount = countTaggedModelsForSource(s.key);

            const visibleModels = Array.isArray(models)
              ? models.filter((id) => !q || String(id || '').toLowerCase().includes(q))
              : [];

            const headerRight = Array.isArray(models)
              ? `<span class="pmc-badge" title="模型数">${models.length}</span>`
              : `<span class="pmc-badge pmc-badge-muted" title="未加载">-</span>`;

            const taggedBadge = taggedCount
              ? `<span class="pmc-badge pmc-badge-primary" title="已标注模型">${taggedCount}</span>`
              : `<span class="pmc-badge pmc-badge-muted" title="已标注模型">0</span>`;

            const bodyHtml = !open
              ? ''
              : loading
                ? `<div class="pmc-loading">加载中…</div>`
                : error
                  ? `<div class="pmc-empty">${safe(error)}</div>`
                  : Array.isArray(models) && models.length
                    ? `
                      <div class="pmc-model-list">
                        ${visibleModels.length
                          ? visibleModels.map((modelId) => {
                              const fullKey = `${s.key}:${modelId}`;
                              const active = uiState.tagsActiveModelKey === fullKey ? 'active' : '';
                              const tags = Array.isArray(cfg[fullKey]) ? cfg[fullKey] : [];
                              const tagIcons = CAPABILITY_TAGS.map((t) => {
                                const on = tags.includes(t.id) ? 'on' : '';
                                return `<iconify-icon class="${on}" icon="${safe(t.icon)}" width="14" title="${safe(t.name)}"></iconify-icon>`;
                              }).join('');
                              return `
                                <button class="pmc-model-item ${active}" data-action="select-model" data-model-full-key="${safe(fullKey)}" title="${safe(fullKey)}">
                                  <div class="pmc-model-item-main">
                                    <div class="pmc-model-item-title">${safe(modelId)}</div>
                                    <div class="pmc-model-item-sub">${safe(s.key)}</div>
                                  </div>
                                  <div class="pmc-model-tags">${tagIcons}</div>
                                </button>
                              `;
                            }).join('')
                          : `<div class="pmc-empty">没有匹配的模型</div>`
                        }
                      </div>
                    `
                    : `<div class="pmc-empty">未获取到模型</div>`;

            return `
              <div class="pmc-acc-item" data-source-key="${safe(s.key)}">
                <button class="pmc-acc-header" data-action="toggle-source" data-source-key="${safe(s.key)}" title="${safe(s.key)}">
                  <iconify-icon class="pmc-acc-chevron ${open ? 'open' : ''}" icon="carbon:chevron-right" width="16"></iconify-icon>
                  <div class="pmc-acc-title">
                    <div class="pmc-acc-title-main">${safe(s.name || s.key)}</div>
                    <div class="pmc-acc-title-sub">${safe(s.key)}</div>
                  </div>
                  <div class="pmc-acc-meta">
                    ${taggedBadge}
                    ${headerRight}
                  </div>
                </button>
                ${open ? `<div class="pmc-acc-body">${bodyHtml}</div>` : ''}
              </div>
            `;
          }).join('')
        : `<div class="pmc-empty">未发现可配置源站</div>`;
    };

    const renderTagIcons = () => {
      const active = getActiveModelParts();
      const selectedTags = getSelectedTags();
      selectedNameEl.textContent = active ? `${getSourceName(active.sourceKey)} · ${active.modelId}` : '未选择模型';
      clearBtn.disabled = !active || selectedTags.length === 0;

      iconsEl.innerHTML = CAPABILITY_TAGS.map((t) => {
        const selected = selectedTags.includes(t.id);
        return `
          <button
            class="pmc-tag-icon-btn ${selected ? 'selected' : ''}"
            data-action="toggle-tag"
            data-tag-id="${safe(t.id)}"
            title="${safe(t.name)}"
            ${active ? '' : 'disabled'}
          >
            <iconify-icon icon="${safe(t.icon)}" width="22"></iconify-icon>
          </button>
        `;
      }).join('');
    };

    const persist = () => {
      saveConfig('modelTags', cfg);
      showSaveSuccess('模型标签已保存');
      renderSourceList();
      renderTagIcons();
    };

    const selectModel = (fullKey) => {
      uiState.tagsActiveModelKey = fullKey;
      renderSourceList();
      renderTagIcons();
    };

    sourceListEl.addEventListener('click', async (e) => {
      const actionEl = e.target?.closest?.('[data-action]');
      const action = actionEl?.getAttribute?.('data-action');
      if (!action) return;

      if (action === 'toggle-source') {
        const sourceKey = actionEl.getAttribute('data-source-key');
        if (!sourceKey) return;
        const nextOpen = !expandedSet.has(sourceKey);
        if (nextOpen) expandedSet.add(sourceKey);
        else expandedSet.delete(sourceKey);
        uiState.tagsExpandedSources = Array.from(expandedSet);
        renderSourceList();
        if (nextOpen) {
          await ensureModelsLoaded(sourceKey);
          renderSourceList();
        }
      } else if (action === 'select-model') {
        const fullKey = actionEl.getAttribute('data-model-full-key');
        if (!fullKey) return;
        selectModel(fullKey);
      }
    });

    searchEl?.addEventListener('input', () => renderSourceList());

    iconsEl.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-action="toggle-tag"]');
      const tagId = btn?.getAttribute?.('data-tag-id');
      if (!tagId) return;

      const active = getActiveModelParts();
      if (!active) return;

      const current = Array.isArray(cfg[active.fullKey]) ? cfg[active.fullKey] : [];
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      cfg[active.fullKey] = Array.from(next);
      persist();
    });

    clearBtn.addEventListener('click', () => {
      const active = getActiveModelParts();
      if (!active) return;
      cfg[active.fullKey] = [];
      persist();
    });

    // 默认展开第一项并拉取模型列表（不强制默认选中具体模型）
    if (sources.length && expandedSet.size === 0) {
      expandedSet.add(sources[0].key);
      uiState.tagsExpandedSources = Array.from(expandedSet);
      fetchModelsForSource(sources[0].key).finally(() => renderSourceList());
    }
    renderSourceList();
    renderTagIcons();
  }



  function renderTab2Content(panel) {
    // Load concurrency config
    let concurrencyConfig = { batchSize: 4, batchConcurrency: 2, imageConcurrency: 4 };
    try {
      const raw = localStorage.getItem('ppt_designConcurrency');
      if (raw) concurrencyConfig = { ...concurrencyConfig, ...JSON.parse(raw) };
    } catch (_) {}

    panel.innerHTML = `
      <div class="pmc-tab-layout">
        <div class="pmc-tab-left">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:user-role" width="18"></iconify-icon>
            角色列表
          </div>
          <div id="pmc-roles-list" class="pmc-list"></div>

          <div class="pmc-panel-title" style="margin-top: 20px;">
            <iconify-icon icon="carbon:meter" width="18"></iconify-icon>
            并发设置
          </div>
          <div class="pmc-concurrency-settings" style="padding: 12px; background: #f8fafc; border-radius: 8px;">
            <div class="pmc-form-group" style="margin-bottom: 12px;">
              <label style="display: block; font-size: 12px; color: #64748b; margin-bottom: 4px;">批量大小 (batchSize)</label>
              <input type="number" id="pmc-batch-size" class="pmc-input" value="${concurrencyConfig.batchSize}" min="1" style="width: 100%;">
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">每批处理的幻灯片数量</div>
            </div>
            <div class="pmc-form-group" style="margin-bottom: 12px;">
              <label style="display: block; font-size: 12px; color: #64748b; margin-bottom: 4px;">批量并发 (batchConcurrency)</label>
              <input type="number" id="pmc-batch-concurrency" class="pmc-input" value="${concurrencyConfig.batchConcurrency}" min="1" style="width: 100%;">
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">同时处理的批次数</div>
            </div>
            <div class="pmc-form-group" style="margin-bottom: 12px;">
              <label style="display: block; font-size: 12px; color: #64748b; margin-bottom: 4px;">图片并发 (imageConcurrency)</label>
              <input type="number" id="pmc-image-concurrency" class="pmc-input" value="${concurrencyConfig.imageConcurrency}" min="1" style="width: 100%;">
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">同时生成的图片数</div>
            </div>
            <button id="pmc-save-concurrency" class="pmc-btn-save" style="width: 100%;">
              <iconify-icon icon="carbon:save" width="16"></iconify-icon>
              保存并发设置
            </button>
          </div>
        </div>
        <div class="pmc-tab-right">
          <div class="pmc-panel-title">
            <iconify-icon icon="carbon:list-numbered" width="18"></iconify-icon>
            <span id="pmc-role-title">模型优先级</span>
          </div>
          <div class="pmc-two-col">
            <div>
              <div class="pmc-subheading">可用模型</div>
              <div class="pmc-form-group">
                <input id="pmc-available-search" class="pmc-input" placeholder="搜索可用模型..." autocomplete="off">
              </div>
              <div id="pmc-available-models" class="pmc-list pmc-list-compact"></div>
            </div>
            <div>
              <div class="pmc-subheading">当前优先级（拖拽排序）</div>
              <div id="pmc-priority-list" class="pmc-dnd-list"></div>
            </div>
          </div>
          <div class="pmc-helper-text">提示：拖动排序后会自动保存。</div>
        </div>
      </div>
    `;

    // Bind concurrency save button
    panel.querySelector('#pmc-save-concurrency')?.addEventListener('click', () => {
      const batchSize = Math.max(1, parseInt(panel.querySelector('#pmc-batch-size')?.value) || 4);
      const batchConcurrency = Math.max(1, parseInt(panel.querySelector('#pmc-batch-concurrency')?.value) || 2);
      const imageConcurrency = Math.max(1, parseInt(panel.querySelector('#pmc-image-concurrency')?.value) || 4);
      localStorage.setItem('ppt_designConcurrency', JSON.stringify({ batchSize, batchConcurrency, imageConcurrency }));
      showSaveSuccess('并发设置已保存');
    });

    const rolesListEl = panel.querySelector('#pmc-roles-list');
    const roleTitleEl = panel.querySelector('#pmc-role-title');
    const availableSearchEl = panel.querySelector('#pmc-available-search');
    const availableListEl = panel.querySelector('#pmc-available-models');
    const priorityListEl = panel.querySelector('#pmc-priority-list');

    const allModels = getAllConfigurableModels();
    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));

    const persist = () => {
      saveConfig('rolePriority', roleCfg);
      showSaveSuccess('角色优先级已保存');
      renderAvailableModels();
    };

    const renderRoles = () => {
      rolesListEl.innerHTML = ROLES.map((r) => {
        const active = uiState.priorityActiveRole === r.id ? 'active' : '';
        return `
          <button class="pmc-list-item ${active}" data-role-id="${safe(r.id)}">
            <div class="pmc-list-item-main">
              <div class="pmc-list-item-title">
                <iconify-icon icon="${safe(r.icon)}" width="16"></iconify-icon>
                ${safe(r.name)}
              </div>
              <div class="pmc-list-item-sub">${safe(r.desc)}</div>
            </div>
          </button>
        `;
      }).join('');
    };

    const renderPriorityList = () => {
      const roleId = uiState.priorityActiveRole;
      const order = Array.isArray(roleCfg[roleId]) ? roleCfg[roleId] : [];
      const label = ROLES.find((r) => r.id === roleId)?.name || roleId;
      roleTitleEl.textContent = `${label} · 模型优先级`;

      const keyToName = new Map(allModels.map((m) => [m.key, m.name || m.key]));

      priorityListEl.innerHTML = order.length
        ? order.map((k) => `
            <div class="pmc-drag-item" draggable="true" data-model-key="${safe(k)}">
              <div class="pmc-drag-item-title">${safe(keyToName.get(k) || k)}</div>
              <div class="pmc-drag-item-sub">${safe(k)}</div>
              <button class="pmc-drag-item-remove" title="移除" data-remove-key="${safe(k)}">
                <iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>
              </button>
            </div>
          `).join('')
        : `<div class="pmc-empty">暂无优先级配置，可从左侧添加</div>`;

      setupDragAndDrop(priorityListEl, () => {
        const next = Array.from(priorityListEl.querySelectorAll('.pmc-drag-item'))
          .map((el) => el.getAttribute('data-model-key'))
          .filter(Boolean);
        roleCfg[roleId] = next;
        persist();
      });
    };

    const renderAvailableModels = () => {
      const q = String(availableSearchEl?.value || '').trim().toLowerCase();
      const roleId = uiState.priorityActiveRole;
      const chosen = new Set(Array.isArray(roleCfg[roleId]) ? roleCfg[roleId] : []);

      const filtered = allModels.filter((m) => {
        if (!q) return true;
        return String(m.name || '').toLowerCase().includes(q) || String(m.key || '').toLowerCase().includes(q);
      });

      availableListEl.innerHTML = filtered.length
        ? filtered.map((m) => {
            const disabled = chosen.has(m.key);
            return `
              <div class="pmc-list-row">
                <div class="pmc-list-row-main">
                  <div class="pmc-list-row-title">${safe(m.name || m.key)}</div>
                  <div class="pmc-list-row-sub">${safe(m.key)}</div>
                </div>
                <button class="pmc-btn-mini" data-add-key="${safe(m.key)}" ${disabled ? 'disabled' : ''}>
                  <iconify-icon icon="carbon:add" width="14"></iconify-icon>
                  添加
                </button>
              </div>
            `;
          }).join('')
        : `<div class="pmc-empty">没有可用模型</div>`;
    };

    rolesListEl.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('.pmc-list-item');
      const roleId = btn?.getAttribute('data-role-id');
      if (!roleId) return;
      uiState.priorityActiveRole = roleId;
      renderRoles();
      renderPriorityList();
      renderAvailableModels();
    });

    availableSearchEl?.addEventListener('input', () => renderAvailableModels());

    availableListEl.addEventListener('click', (e) => {
      const addKey = e.target?.closest?.('[data-add-key]')?.getAttribute('data-add-key');
      if (!addKey) return;
      const roleId = uiState.priorityActiveRole;
      const list = Array.isArray(roleCfg[roleId]) ? roleCfg[roleId] : [];
      if (list.includes(addKey)) return;
      list.push(addKey);
      roleCfg[roleId] = list;
      renderPriorityList();
      persist();
    });

    priorityListEl.addEventListener('click', (e) => {
      const removeKey = e.target?.closest?.('[data-remove-key]')?.getAttribute('data-remove-key');
      if (!removeKey) return;
      const roleId = uiState.priorityActiveRole;
      roleCfg[roleId] = (roleCfg[roleId] || []).filter((k) => k !== removeKey);
      renderPriorityList();
      persist();
    });

    if (!uiState.priorityActiveRole) uiState.priorityActiveRole = ROLES[0]?.id || 'analyst';
    renderRoles();
    renderPriorityList();
    renderAvailableModels();
  }



  function normalizeAudioConfig(raw) {
    const obj = normalizeObject(raw);
    const t = normalizeObject(obj.transcription);
    const s = normalizeObject(obj.synthesis);
    return {
      transcription: {
        provider: String(t.provider || 'groq'),
        apiKey: String(t.apiKey || ''),
        model: String(t.model || '')
      },
      synthesis: {
        provider: String(s.provider || 'elevenlabs'),
        apiKey: String(s.apiKey || ''),
        model: String(s.model || ''),
        voice: String(s.voice || '')
      }
    };
  }

  function renderTab3Content(panel) {
    const cfg = normalizeAudioConfig(loadConfig('audio'));

    panel.innerHTML = `
      <div class="pmc-tab3-container">
        <div class="modern-grid">
          <!-- 转录配置 (STT) -->
          <div class="modern-card theme-blue">
            <div class="card-header">
              <div class="card-icon"><iconify-icon icon="carbon:audio-console" width="24"></iconify-icon></div>
              <div class="card-meta">
                <h3>转录配置</h3>
                <p>Speech-to-Text</p>
              </div>
            </div>
            <div class="card-content">
              <div class="form-item">
                <label>Provider</label>
                <select id="pmc-stt-provider" class="modern-select"></select>
              </div>
              <div class="form-item">
                <label>API Key</label>
                <input id="pmc-stt-api-key" class="modern-input" type="password" placeholder="输入转录 API Key">
              </div>
              <div class="form-item">
                <label>Model</label>
                <select id="pmc-stt-model-select" class="modern-select"></select>
                <input id="pmc-stt-model-input" class="modern-input" placeholder="输入模型 ID" style="display:none;">
              </div>
            </div>
          </div>

          <!-- 合成配置 (TTS) -->
          <div class="modern-card theme-rose">
            <div class="card-header">
              <div class="card-icon"><iconify-icon icon="carbon:volume-up" width="24"></iconify-icon></div>
              <div class="card-meta">
                <h3>合成配置</h3>
                <p>Text-to-Speech</p>
              </div>
            </div>
            <div class="card-content">
              <div class="form-item">
                <label>Provider</label>
                <select id="pmc-tts-provider" class="modern-select"></select>
              </div>
              <div class="form-item">
                <label>API Key</label>
                <input id="pmc-tts-api-key" class="modern-input" type="password" placeholder="输入合成 API Key">
              </div>
              <div class="form-item">
                <label>Model</label>
                <select id="pmc-tts-model-select" class="modern-select"></select>
              </div>
              <div class="form-item">
                <label>Voice</label>
                <input id="pmc-tts-voice" class="modern-input" placeholder="alloy / aria / 自定义">
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end" style="margin-top: 24px;">
          <button id="pmc-audio-save" class="modern-btn-save" style="width: auto; padding: 12px 48px;">
            <iconify-icon icon="carbon:save" width="18"></iconify-icon>
            保存音频配置
          </button>
        </div>
      </div>
    `;

    // 后续绑定逻辑保持不变...
    const sttProviderEl = panel.querySelector('#pmc-stt-provider');
    const sttApiKeyEl = panel.querySelector('#pmc-stt-api-key');
    const sttModelSelectEl = panel.querySelector('#pmc-stt-model-select');
    const sttModelInputEl = panel.querySelector('#pmc-stt-model-input');

    const ttsProviderEl = panel.querySelector('#pmc-tts-provider');
    const ttsApiKeyEl = panel.querySelector('#pmc-tts-api-key');
    const ttsModelSelectEl = panel.querySelector('#pmc-tts-model-select');
    const ttsVoiceEl = panel.querySelector('#pmc-tts-voice');

    const saveBtn = panel.querySelector('#pmc-audio-save');

    sttProviderEl.innerHTML = TRANSCRIPTION_PROVIDERS.map((p) => `<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
    ttsProviderEl.innerHTML = SYNTHESIS_PROVIDERS.map((p) => `<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');

    const applySttModels = () => {
      const providerId = sttProviderEl.value;
      const provider = TRANSCRIPTION_PROVIDERS.find((p) => p.id === providerId) || TRANSCRIPTION_PROVIDERS[0];
      const models = Array.isArray(provider?.models) ? provider.models : [];

      if (models.length) {
        sttModelSelectEl.style.display = '';
        sttModelInputEl.style.display = 'none';
        sttModelSelectEl.innerHTML = models.map((m) => `<option value="${safe(m)}">${safe(m)}</option>`).join('');
        sttModelSelectEl.value = cfg.transcription.model && models.includes(cfg.transcription.model) ? cfg.transcription.model : models[0];
      } else {
        sttModelSelectEl.style.display = 'none';
        sttModelInputEl.style.display = '';
        sttModelInputEl.value = cfg.transcription.model || '';
      }
    };

    const applyTtsModels = () => {
      const providerId = ttsProviderEl.value;
      const provider = SYNTHESIS_PROVIDERS.find((p) => p.id === providerId) || SYNTHESIS_PROVIDERS[0];
      const models = Array.isArray(provider?.models) ? provider.models : [];
      ttsModelSelectEl.innerHTML = models.map((m) => `<option value="${safe(m)}">${safe(m)}</option>`).join('');
      ttsModelSelectEl.value = cfg.synthesis.model && models.includes(cfg.synthesis.model) ? cfg.synthesis.model : (models[0] || '');
    };

    sttProviderEl.value = TRANSCRIPTION_PROVIDERS.some((p) => p.id === cfg.transcription.provider) ? cfg.transcription.provider : TRANSCRIPTION_PROVIDERS[0].id;
    ttsProviderEl.value = SYNTHESIS_PROVIDERS.some((p) => p.id === cfg.synthesis.provider) ? cfg.synthesis.provider : SYNTHESIS_PROVIDERS[0].id;

    sttApiKeyEl.value = cfg.transcription.apiKey || '';
    ttsApiKeyEl.value = cfg.synthesis.apiKey || '';
    ttsVoiceEl.value = cfg.synthesis.voice || '';

    applySttModels();
    applyTtsModels();

    sttProviderEl.addEventListener('change', () => {
      cfg.transcription.provider = sttProviderEl.value;
      applySttModels();
    });

    ttsProviderEl.addEventListener('change', () => {
      cfg.synthesis.provider = ttsProviderEl.value;
      applyTtsModels();
    });

    saveBtn.addEventListener('click', () => {
      const sttProvider = sttProviderEl.value;
      const ttsProvider = ttsProviderEl.value;

      const sttModel = sttModelSelectEl.style.display === 'none'
        ? String(sttModelInputEl.value || '').trim()
        : String(sttModelSelectEl.value || '').trim();

      const out = {
        transcription: {
          provider: sttProvider,
          apiKey: String(sttApiKeyEl.value || '').trim(),
          model: sttModel
        },
        synthesis: {
          provider: ttsProvider,
          apiKey: String(ttsApiKeyEl.value || '').trim(),
          model: String(ttsModelSelectEl.value || '').trim(),
          voice: String(ttsVoiceEl.value || '').trim()
        }
      };

      saveConfig('audio', out);
      showSaveSuccess('音频模型配置已保存');
    });
  }

  Object.assign(ns.tabs, {
    initTabSwitching,
    activateTab,
    renderTab1Content,
    renderTab2Content,
    renderTab3Content,
    normalizeModelTagsConfig,
    normalizeAudioConfig
  });
})(typeof window !== 'undefined' ? window : this);
