/**
 * PPT 模型配置 - 角色优先级/拖拽/热备
 * IIFE module: window.PPTModelConfig.roles
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.roles = ns.roles || {};

  const { ROLES = [], ROLE_NAMES = {}, ROLE_GROUPS = {} } = ns.constants || {};
  const { safe: _safe, normalizeObject: _normalizeObject } = ns.utils || {};
  const safe = typeof _safe === 'function' ? _safe : (v) => String(v || '');
  const normalizeObject = typeof _normalizeObject === 'function' ? _normalizeObject : (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  const loadConfig = (...args) => (ns.core && typeof ns.core.loadConfig === 'function' ? ns.core.loadConfig(...args) : null);
  const saveConfig = (...args) => { if (ns.core && typeof ns.core.saveConfig === 'function') ns.core.saveConfig(...args); };
  const showSaveSuccess = (msg) => { if (ns.core && typeof ns.core.showSaveSuccess === 'function') ns.core.showSaveSuccess(msg); };

  const splitFullModelKey = (fullKey) => {
    if (ns.table && typeof ns.table.splitFullModelKey === 'function') return ns.table.splitFullModelKey(fullKey);
    const s = String(fullKey || '');
    const idx = s.indexOf(':');
    if (idx <= 0 || idx === s.length - 1) return null;
    return { fullKey: s, sourceKey: s.slice(0, idx), modelId: s.slice(idx + 1) };
  };

  function getModelLabelForFullKey(fullKey, rowsById) {
    const r = rowsById?.get?.(fullKey);
    if (r) return { title: r.modelId, sub: r.sourceName };
    const parts = splitFullModelKey(fullKey);
    if (!parts) return { title: String(fullKey || ''), sub: '' };
    return { title: parts.modelId, sub: parts.sourceKey };
  }

  /**
   * 角色热备配置弹窗
   * 支持：查看/排序热备列表、添加模型、（未来）频次比例
   */
  function openRoleHotspareConfig({ roleId, rows, roleCfg, onSave } = {}) {
    if (!roleId) return;

    const role = ROLES.find(r => r.id === roleId);
    if (!role) return;

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 flex items-center justify-center';
    popup.style.zIndex = '11000';

    const rowsById = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));
    let currentList = Array.isArray(roleCfg?.[roleId]) ? [...roleCfg[roleId]] : [];

    const renderHotspareList = () => {
      const listEl = popup.querySelector('#pmc-hotspare-list');
      if (!listEl) return;

      if (currentList.length === 0) {
        listEl.innerHTML = `
          <div class="py-8 text-center text-slate-400 text-sm">
            暂无热备模型，点击下方按钮添加
          </div>
        `;
        return;
      }

      listEl.innerHTML = currentList.map((fullKey, idx) => {
        const label = getModelLabelForFullKey(fullKey, rowsById);
        return `
          <div class="pmc-hotspare-item pmc-drag-item" draggable="true" data-model-key="${safe(fullKey)}">
            <div class="pmc-hotspare-item-drag">
              <iconify-icon icon="carbon:draggable" width="16"></iconify-icon>
            </div>
            <div class="pmc-hotspare-item-num">${idx + 1}</div>
            <div class="pmc-hotspare-item-info">
              <div class="pmc-hotspare-item-name">${safe(label.title || fullKey)}</div>
              <div class="pmc-hotspare-item-source">${safe(label.sub || '')}</div>
            </div>
            <button class="pmc-hotspare-item-remove" data-remove-key="${safe(fullKey)}" title="移除" type="button">
              <iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>
            </button>
          </div>
        `;
      }).join('');

      // 拖拽排序
      setupDragAndDrop(listEl, () => {
        currentList = Array.from(listEl.querySelectorAll('.pmc-drag-item'))
          .map(el => el.getAttribute('data-model-key'))
          .filter(Boolean);
        renderHotspareList();
      });

      // 移除按钮
      listEl.querySelectorAll('[data-remove-key]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const key = btn.getAttribute('data-remove-key');
          currentList = currentList.filter(k => k !== key);
          renderHotspareList();
        });
      });
    };

    popup.innerHTML = `
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative w-[min(480px,95vw)] max-h-[85vh] overflow-hidden flex flex-direction-column bg-white rounded-2xl shadow-2xl border border-slate-200" style="display:flex; flex-direction:column;">
        <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 flex-shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
              <iconify-icon icon="${safe(role.icon)}" width="20"></iconify-icon>
            </div>
            <div>
              <div class="text-sm font-semibold text-slate-900">${safe(ROLE_NAMES[roleId] || role.name)}</div>
              <div class="text-xs text-slate-500">${safe(role.desc || '')}</div>
            </div>
          </div>
          <button class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500" data-action="close" type="button" title="关闭">
            <iconify-icon icon="carbon:close" width="20"></iconify-icon>
          </button>
        </div>

        <div class="p-5 overflow-y-auto flex-1">
          <div class="text-xs font-medium text-slate-500 mb-2">热备模型（按优先级排序，可拖拽调整）</div>
          <div id="pmc-hotspare-list" class="pmc-hotspare-list border border-slate-200 rounded-xl overflow-hidden min-h-[100px]"></div>

          <button class="pmc-btn-secondary w-full mt-3" data-action="add-model" type="button">
            <iconify-icon icon="carbon:add" width="16"></iconify-icon>
            添加模型
          </button>
        </div>

        <div class="px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-shrink-0">
          <button class="pmc-btn-secondary" data-action="cancel" type="button">取消</button>
          <button class="pmc-btn-save" data-action="save" type="button">
            <iconify-icon icon="carbon:save" width="16"></iconify-icon>
            保存
          </button>
        </div>
      </div>
    `;

    const close = () => popup.remove();
    popup.querySelector('.absolute.inset-0')?.addEventListener('click', close);
    popup.querySelector('[data-action="close"]')?.addEventListener('click', close);
    popup.querySelector('[data-action="cancel"]')?.addEventListener('click', close);

    popup.querySelector('[data-action="add-model"]')?.addEventListener('click', () => {
      openRoleAddPicker({
        roleId,
        rows,
        roleCfg: { ...roleCfg, [roleId]: currentList },
        onSave: (nextCfg) => {
          currentList = Array.isArray(nextCfg?.[roleId]) ? [...nextCfg[roleId]] : [];
          renderHotspareList();
        }
      });
    });

    popup.querySelector('[data-action="save"]')?.addEventListener('click', () => {
      const nextCfg = { ...roleCfg, [roleId]: currentList };
      if (typeof onSave === 'function') onSave(nextCfg);
      showSaveSuccess(`「${ROLE_NAMES[roleId] || roleId}」热备配置已保存`);
      close();
    });

    document.body.appendChild(popup);
    renderHotspareList();
  }

  function openRoleAddPicker({ roleId, rows, roleCfg, onSave } = {}) {
    if (!roleId) return;

    const popup = document.createElement('div');
    popup.className = 'fixed inset-0 flex items-center justify-center';
    popup.style.zIndex = '11000';

    const rowsById = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));
    const current = new Set(Array.isArray(roleCfg?.[roleId]) ? roleCfg[roleId] : []);

    popup.innerHTML = `
      <div class="absolute inset-0 bg-black/40"></div>
      <div class="relative w-[min(720px,95vw)] max-h-[85vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200" style="display:flex; flex-direction:column;">
        <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 flex-shrink-0">
          <div class="text-sm font-semibold text-slate-900">添加到「${safe(ROLE_NAMES[roleId] || roleId)}」</div>
          <button class="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500" data-action="close" type="button" title="关闭">
            <iconify-icon icon="carbon:close" width="20"></iconify-icon>
          </button>
        </div>
        <div class="p-5 flex-shrink-0 border-b border-slate-100 bg-slate-50/50">
          <div class="pmc-form-group">
            <input class="pmc-input w-full" id="pmc-role-add-search" placeholder="搜索模型..." autocomplete="off">
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <div id="pmc-role-add-list" class="border border-slate-200 rounded-xl overflow-hidden"></div>
        </div>
      </div>
    `;

    const close = () => popup.remove();
    const backdrop = popup.querySelector('.absolute.inset-0');
    backdrop?.addEventListener('click', close);
    popup.querySelector('[data-action="close"]')?.addEventListener('click', close);

    const searchEl = popup.querySelector('#pmc-role-add-search');
    const listEl = popup.querySelector('#pmc-role-add-list');

    const renderList = () => {
      const q = String(searchEl?.value || '').trim().toLowerCase();
      const candidates = (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!r?.id || current.has(r.id)) return false;
        if (!q) return true;
        return (
          String(r.modelId || '').toLowerCase().includes(q) ||
          String(r.sourceName || '').toLowerCase().includes(q) ||
          String(r.id || '').toLowerCase().includes(q)
        );
      });

      listEl.innerHTML = candidates.length
        ? candidates.slice(0, 200).map((r) => `
            <button class="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-b-0" data-full-key="${safe(r.id)}" type="button">
              <div class="text-sm font-medium text-slate-900">${safe(r.modelId)}</div>
              <div class="text-xs text-slate-500">${safe(r.sourceName)} · <span class="font-mono">${safe(r.sourceKey)}</span></div>
            </button>
          `).join('')
        : `<div class="px-4 py-10 text-center text-sm text-slate-400">没有可添加的模型</div>`;
    };

    listEl?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-full-key]');
      const fullKey = btn?.getAttribute?.('data-full-key');
      if (!fullKey) return;

      const next = Array.isArray(roleCfg[roleId]) ? roleCfg[roleId].slice() : [];
      next.push(fullKey);
      roleCfg[roleId] = Array.from(new Set(next));
      if (typeof onSave === 'function') onSave(roleCfg);
      close();
    });

    searchEl?.addEventListener('input', renderList);

    renderList();
    document.body.appendChild(popup);
  }

  function renderRoleOverview(container, rows, onChange) {
    if (!container) return;

    const roleCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));
    const rowsById = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r]));

    const renderRoleColumn = (r) => {
      const list = Array.isArray(roleCfg[r.id]) ? roleCfg[r.id] : [];
      const modelCount = list.length;
      const items = list.map((fullKey, idx) => {
        const label = getModelLabelForFullKey(fullKey, rowsById);
        return `
          <div class="pmc-drag-item pmc-role-column-item" draggable="true" data-model-key="${safe(fullKey)}">
            <span class="priority-num">${safe(String(idx + 1))}.</span>
            <span class="model-name">${safe(label.title || fullKey)}</span>
            <button class="pmc-drag-item-remove remove-btn" title="移除" data-remove-key="${safe(fullKey)}" type="button">
              <iconify-icon icon="carbon:trash-can" width="14"></iconify-icon>
            </button>
          </div>
        `;
      }).join('');

      return `
        <div class="pmc-role-column">
          <div class="pmc-role-column-header">
            <div class="pmc-role-column-title">
              <iconify-icon icon="${safe(r.icon)}" width="14"></iconify-icon>
              <span class="pmc-role-column-name">${safe(ROLE_NAMES[r.id] || r.name)}</span>
              <span class="pmc-role-column-count">(${modelCount})</span>
            </div>
            <button class="pmc-role-config-btn" data-action="config-role" data-role-id="${safe(r.id)}" title="配置热备" type="button">
              <iconify-icon icon="carbon:settings" width="14"></iconify-icon>
            </button>
          </div>
          <div class="pmc-role-column-list pmc-role-dnd-list" data-role-id="${safe(r.id)}">
            ${items || `<div class="pmc-role-column-empty" data-action="add-to-role" data-role-id="${safe(r.id)}">（空） 点击添加</div>`}
          </div>
        </div>
      `;
    };

    const roleById = new Map(ROLES.map(r => [r.id, r]));

    const nextOverviewHtml = `
      <div class="pmc-role-overview">
        <div class="pmc-role-overview-title">
          <iconify-icon icon="carbon:user-role" width="16"></iconify-icon>
          角色配置概览
        </div>
        ${Object.entries(ROLE_GROUPS).map(([groupKey, group]) => `
          <div class="pmc-role-group">
            <div class="pmc-role-group-header">${safe(group.name)}</div>
            <div class="pmc-role-columns">
              ${group.roles.map(rid => roleById.get(rid)).filter(Boolean).map(renderRoleColumn).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    if (container.innerHTML !== nextOverviewHtml) {
        container.innerHTML = nextOverviewHtml;
    } else {
        return; // 内容没变，跳过事件绑定，节省性能
    }

    const columns = Array.from(container.querySelectorAll('.pmc-role-dnd-list'));
    columns.forEach((col) => {
      const roleId = col.getAttribute('data-role-id');
      if (!roleId) return;
      setupDragAndDrop(col, () => {
        const next = Array.from(col.querySelectorAll('.pmc-drag-item'))
          .map((el) => el.getAttribute('data-model-key'))
          .filter(Boolean);
        const nextCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));
        nextCfg[roleId] = next;
        saveConfig('rolePriority', nextCfg);
        if (typeof onChange === 'function') onChange();
      });
    });

    container.querySelectorAll('[data-action="add-to-role"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roleId = btn.getAttribute('data-role-id');
        if (!roleId) return;
        openRoleAddPicker({
          roleId,
          rows,
          roleCfg: normalizeRolePriorityConfig(loadConfig('rolePriority')),
          onSave: (nextCfg) => {
            saveConfig('rolePriority', nextCfg);
            if (typeof onChange === 'function') onChange();
          }
        });
      });
    });

    container.querySelectorAll('[data-remove-key]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 从父级 .pmc-role-dnd-list 获取 roleId
        const roleList = btn.closest('.pmc-role-dnd-list');
        const roleId = roleList?.getAttribute?.('data-role-id') || '';

        const fullKey = btn.getAttribute('data-remove-key');
        if (!fullKey || !roleId) return;

        const nextCfg = normalizeRolePriorityConfig(loadConfig('rolePriority'));
        nextCfg[roleId] = (Array.isArray(nextCfg[roleId]) ? nextCfg[roleId] : []).filter((x) => x !== fullKey);
        saveConfig('rolePriority', nextCfg);
        if (typeof onChange === 'function') onChange();
      });
    });

    // 齿轮按钮 - 打开角色热备配置弹窗
    container.querySelectorAll('[data-action="config-role"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const roleId = btn.getAttribute('data-role-id');
        if (!roleId) return;
        openRoleHotspareConfig({
          roleId,
          rows,
          roleCfg: normalizeRolePriorityConfig(loadConfig('rolePriority')),
          onSave: (nextCfg) => {
            saveConfig('rolePriority', nextCfg);
            if (typeof onChange === 'function') onChange();
          }
        });
      });
    });
  }




  function normalizeRolePriorityConfig(raw) {
    const obj = normalizeObject(raw);
    const out = {};
    for (const r of ROLES) {
      const list = obj[r.id];
      out[r.id] = Array.isArray(list) ? list.map((x) => String(x || '').trim()).filter(Boolean) : [];
    }
    return out;
  }



  function setupDragAndDrop(container, onReorder) {
    if (!container) return;
    container.__pmcOnReorder = onReorder;
    if (container.dataset.dndBound === '1') return;
    container.dataset.dndBound = '1';

    let dragging = null;

    const clearIndicators = () => {
      container.querySelectorAll('.drag-above, .drag-below').forEach((el) => {
        el.classList.remove('drag-above', 'drag-below');
      });
    };

    container.addEventListener('dragstart', (e) => {
      const item = e.target?.closest?.('.pmc-drag-item');
      if (!item) return;
      dragging = item;
      item.classList.add('dragging');
      e.dataTransfer?.setData?.('text/plain', item.getAttribute('data-model-key') || '');
      e.dataTransfer?.setDragImage?.(item, 12, 12);
    });

    container.addEventListener('dragend', () => {
      if (dragging) dragging.classList.remove('dragging');
      dragging = null;
      clearIndicators();
      const cb = container.__pmcOnReorder;
      if (typeof cb === 'function') cb();
    });

    container.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();

      const target = e.target?.closest?.('.pmc-drag-item');
      if (!target || target === dragging) return;

      const rect = target.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      clearIndicators();
      target.classList.add(before ? 'drag-above' : 'drag-below');

      if (before) {
        container.insertBefore(dragging, target);
      } else {
        container.insertBefore(dragging, target.nextSibling);
      }
    });

    container.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      clearIndicators();
    });
  }

  // ========== Tab 3: 音频配置 ==========


  Object.assign(ns.roles, {
    renderRoleOverview,
    openRoleHotspareConfig,
    openRoleAddPicker,
    getModelLabelForFullKey,
    normalizeRolePriorityConfig,
    setupDragAndDrop
  });
})(typeof window !== 'undefined' ? window : globalThis);
