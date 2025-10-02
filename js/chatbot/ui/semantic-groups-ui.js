// js/chatbot/ui/semantic-groups-ui.js
(function(window, document) {
  'use strict';

  if (window.SemanticGroupsUIScriptLoaded) return;

  // 载入持久化设置
  try {
    const saved = localStorage.getItem('semanticGroupsSettings');
    if (saved) window.semanticGroupsSettings = JSON.parse(saved);
  } catch (_) {}

  function createModalIfNeeded() {
    let modal = document.getElementById('semantic-groups-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'semantic-groups-modal';
    modal.style.cssText = [
      'position: fixed',
      'right: 12px',
      'bottom: 12px',
      'width: 380px',
      'height: 60vh',
      'background: #fff',
      'border: 1px solid #e5e7eb',
      'border-radius: 8px',
      'box-shadow: 0 10px 25px rgba(0,0,0,0.08)',
      'display: none',
      'flex-direction: column',
      'z-index: 9999'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #f1f5f9;background:#f8fafc;gap:8px;';
    const title = document.createElement('div');
    title.id = 'semantic-groups-title';
    title.textContent = '意群预览';
    title.style.cssText = 'font-weight:600;color:#111827;font-size:13px;';
    const buttonsWrap = document.createElement('div');
    buttonsWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = '⚙';
    settingsBtn.style.cssText = 'border:none;background:transparent;font-size:14px;color:#6b7280;cursor:pointer;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'border:none;background:transparent;font-size:18px;color:#6b7280;cursor:pointer;';
    closeBtn.onclick = () => { modal.style.display = 'none'; };
    buttonsWrap.appendChild(settingsBtn);
    buttonsWrap.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(buttonsWrap);

    const searchBar = document.createElement('div');
    searchBar.style.cssText = 'padding:8px 12px;border-bottom:1px solid #f1f5f9;display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    const input = document.createElement('input');
    input.id = 'semantic-groups-search';
    input.placeholder = '搜索关键词（quick/全文）';
    input.style.cssText = 'flex:1;min-width:180px;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;';
    input.onkeydown = function(e){ if (e.key === 'Enter') renderList(input.value.trim()); };
    const scopeSel = document.createElement('select');
    scopeSel.id = 'semantic-groups-scope';
    scopeSel.style.cssText = 'padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;background:#fff;color:#374151;';
    ;['quick','summary','digest','full'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; scopeSel.appendChild(o); });
    const runBtn = document.createElement('button');
    runBtn.textContent = '搜索';
    runBtn.style.cssText = 'border:1px solid #e5e7eb;background:#fff;color:#111827;border-radius:6px;font-size:12px;padding:6px 10px;cursor:pointer;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空';
    clearBtn.style.cssText = 'border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:6px;font-size:12px;padding:6px 10px;cursor:pointer;';
    clearBtn.onclick = function(){ input.value=''; renderList(''); };
    runBtn.onclick = function(){
      const q = input.value.trim();
      const sc = scopeSel.value;
      if (!q) { renderList(''); return; }
      if (sc === 'quick') { renderList(q); return; }
      try {
        const results = (window.SemanticTools && typeof window.SemanticTools.findInGroups === 'function')
          ? window.SemanticTools.findInGroups(q, sc, 20) : [];
        renderSearchResults(results, q);
      } catch (e) { console.warn('[SemanticGroupsUI] findInGroups失败:', e); renderList(q); }
    };
    searchBar.appendChild(input);
    searchBar.appendChild(scopeSel);
    searchBar.appendChild(runBtn);
    searchBar.appendChild(clearBtn);

    const settings = document.createElement('div');
    settings.id = 'semantic-groups-settings';
    settings.style.cssText = 'display:none;padding:8px 12px;border-bottom:1px solid #f1f5f9;background:#fff;';
    settings.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:#374151;">
        <label>并发:<input id="sg-set-concurrency" type="number" min="1" max="50" step="1" style="width:70px;margin-left:4px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;"/></label>
        <label>目标字数:<input id="sg-set-target" type="number" min="1000" max="50000" step="500" style="width:90px;margin-left:4px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;"/></label>
        <label>最小字数:<input id="sg-set-min" type="number" min="1" max="40000" step="500" style="width:90px;margin-left:4px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;"/></label>
        <label>最大字数:<input id="sg-set-max" type="number" min="2000" max="50000" step="500" style="width:90px;margin-left:4px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;"/></label>
        <label>取材轮数:<input id="sg-set-maxrounds" type="number" min="1" max="6" step="1" style="width:70px;margin-left:4px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;"/></label>
        <button id="sg-set-save" style="border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:6px;font-size:12px;padding:4px 8px;cursor:pointer;">保存</button>
        <button id="sg-set-save-rebuild" style="border:1px solid #e5e7eb;background:#fff;color:#111827;border-radius:6px;font-size:12px;padding:4px 8px;cursor:pointer;">保存并重建</button>
      </div>`;

    const list = document.createElement('div');
    list.id = 'semantic-groups-list';
    list.style.cssText = 'flex:1;overflow:auto;padding:8px 8px 12px 8px;';

    modal.appendChild(header);
    modal.appendChild(settings);
    modal.appendChild(searchBar);
    modal.appendChild(list);
    document.body.appendChild(modal);

    // 交互：初始化设置值并绑定事件
    const initSettings = () => {
      const s = window.semanticGroupsSettings || {};
      const $ = (id) => document.getElementById(id);
      const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
      setVal('sg-set-concurrency', Number(s.concurrency) > 0 ? Number(s.concurrency) : 20);
      setVal('sg-set-target', Number(s.targetChars) > 0 ? Number(s.targetChars) : 5000);
      setVal('sg-set-min', Number(s.minChars) > 0 ? Number(s.minChars) : 2500);
      setVal('sg-set-max', Number(s.maxChars) > 0 ? Number(s.maxChars) : 6000);
      setVal('sg-set-maxrounds', Number(s.maxRounds) > 0 ? Number(s.maxRounds) : 3);
    };
    initSettings();

    settingsBtn.onclick = function(){
      settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
    };

    const getSettingsObj = () => {
      const $ = (id) => document.getElementById(id);
      return {
        concurrency: Number($('#sg-set-concurrency')?.value || 20),
        targetChars: Number($('#sg-set-target')?.value || 5000),
        minChars: Number($('#sg-set-min')?.value || 2500),
        maxChars: Number($('#sg-set-max')?.value || 6000),
        maxRounds: Number($('#sg-set-maxrounds')?.value || 3)
      };
    };
    const saveBtn = document.getElementById('sg-set-save');
    const saveRebuildBtn = document.getElementById('sg-set-save-rebuild');
    if (saveBtn) saveBtn.onclick = function(){ window.semanticGroupsSettings = getSettingsObj(); try { localStorage.setItem('semanticGroupsSettings', JSON.stringify(window.semanticGroupsSettings)); } catch(_){ } };
    if (saveRebuildBtn) saveRebuildBtn.onclick = async function(){
      window.semanticGroupsSettings = getSettingsObj();
      try { localStorage.setItem('semanticGroupsSettings', JSON.stringify(window.semanticGroupsSettings)); } catch(_){ }
      if (window.ChatbotCore && typeof window.ChatbotCore.regenerateSemanticGroups === 'function') {
        await window.ChatbotCore.regenerateSemanticGroups(window.semanticGroupsSettings);
      }
    };

    return modal;
  }

  function renderList(query) {
    const list = document.getElementById('semantic-groups-list');
    const title = document.getElementById('semantic-groups-title');
    if (!list) return;
    const groups = (window.data && Array.isArray(window.data.semanticGroups)) ? window.data.semanticGroups : [];

    const total = groups.length;
    title.textContent = `意群预览（${total}）`;

    let visibleGroups = groups;
    if (query && window.SemanticGrouper && typeof window.SemanticGrouper.quickMatch === 'function') {
      visibleGroups = window.SemanticGrouper.quickMatch(query, groups);
    }

    list.innerHTML = '';
    if (visibleGroups.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = query ? '未匹配到相关意群' : '暂无意群数据';
      empty.style.cssText = 'padding:12px;color:#6b7280;text-align:center;';
      list.appendChild(empty);
      return;
    }

    visibleGroups.forEach((group, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin:6px 0;background:#fff;';

      const h = document.createElement('div');
      h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
      const left = document.createElement('div');
      left.style.cssText = 'font-weight:600;color:#111827;font-size:12px;';
      left.textContent = `${group.groupId || 'group-' + idx} · ${group.charCount || 0} 字`;
      const right = document.createElement('div');
      right.style.cssText = 'color:#6b7280;font-size:11px;';
      right.textContent = (group.keywords && group.keywords.length) ? group.keywords.join('、') : '';
      h.appendChild(left); h.appendChild(right);

      const summary = document.createElement('div');
      summary.style.cssText = 'color:#374151;font-size:12px;line-height:1.5;margin-bottom:6px;';
      summary.textContent = group.summary || '';

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = '展开详细';
      toggleBtn.style.cssText = 'border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:6px;font-size:12px;padding:4px 8px;cursor:pointer;';
      const copyBtn = document.createElement('button');
      copyBtn.textContent = '复制摘要';
      copyBtn.style.cssText = 'border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:6px;font-size:12px;padding:4px 8px;cursor:pointer;';

      const detail = document.createElement('div');
      detail.style.cssText = 'display:none;margin-top:6px;padding:8px;border:1px dashed #e5e7eb;border-radius:6px;color:#4b5563;font-size:12px;white-space:pre-wrap;';
      detail.textContent = group.digest || group.fullText || '';

      toggleBtn.onclick = function(){
        if (detail.style.display === 'none') { detail.style.display = 'block'; toggleBtn.textContent = '收起详细'; }
        else { detail.style.display = 'none'; toggleBtn.textContent = '展开详细'; }
      };
      copyBtn.onclick = function(){
        try { navigator.clipboard.writeText(group.summary || ''); } catch {}
      };

      actions.appendChild(toggleBtn);
      actions.appendChild(copyBtn);

      card.appendChild(h);
      card.appendChild(summary);
      card.appendChild(actions);
      card.appendChild(detail);
      list.appendChild(card);
    });
  }

  function renderSearchResults(results, query) {
    const list = document.getElementById('semantic-groups-list');
    const title = document.getElementById('semantic-groups-title');
    if (!list) return;
    const groups = (window.data && Array.isArray(window.data.semanticGroups)) ? window.data.semanticGroups : [];
    const byId = new Map(groups.map(g => [g.groupId, g]));
    title.textContent = `意群预览（${groups.length}） - 全文搜索`;
    list.innerHTML = '';
    if (!Array.isArray(results) || results.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = query ? `未在全文中匹配到：“${query}”` : '暂无匹配结果';
      empty.style.cssText = 'padding:12px;color:#6b7280;text-align:center;';
      list.appendChild(empty);
      return;
    }
    results.forEach((r, idx) => {
      const g = byId.get(r.groupId);
      if (!g) return;
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin:6px 0;background:#fff;';

      const h = document.createElement('div');
      h.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
      const left = document.createElement('div');
      left.style.cssText = 'font-weight:600;color:#111827;font-size:12px;';
      left.textContent = `${g.groupId || 'group-' + idx} · ${g.charCount || 0} 字`;
      const right = document.createElement('div');
      right.style.cssText = 'color:#6b7280;font-size:11px;';
      right.textContent = (g.keywords && g.keywords.length) ? g.keywords.join('、') : '';
      h.appendChild(left); h.appendChild(right);

      const summary = document.createElement('div');
      summary.style.cssText = 'color:#374151;font-size:12px;line-height:1.5;margin-bottom:6px;';
      summary.textContent = `[匹配片段] ${r.snippet || g.summary || ''}`;

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = '展开详细';
      toggleBtn.style.cssText = 'border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:6px;font-size:12px;padding:4px 8px;cursor:pointer;';
      const copyBtn = document.createElement('button');
      copyBtn.textContent = '复制摘要';
      copyBtn.style.cssText = 'border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:6px;font-size:12px;padding:4px 8px;cursor:pointer;';

      const detail = document.createElement('div');
      detail.style.cssText = 'display:none;margin-top:6px;padding:8px;border:1px dashed #e5e7eb;border-radius:6px;color:#4b5563;font-size:12px;white-space:pre-wrap;';
      detail.textContent = g.digest || g.fullText || '';

      toggleBtn.onclick = function(){
        if (detail.style.display === 'none') { detail.style.display = 'block'; toggleBtn.textContent = '收起详细'; }
        else { detail.style.display = 'none'; toggleBtn.textContent = '展开详细'; }
      };
      copyBtn.onclick = function(){ try { navigator.clipboard.writeText(g.summary || ''); } catch {} };

      actions.appendChild(toggleBtn);
      actions.appendChild(copyBtn);

      card.appendChild(h);
      card.appendChild(summary);
      card.appendChild(actions);
      card.appendChild(detail);
      list.appendChild(card);
    });
  }

  function open() {
    const modal = createModalIfNeeded();
    renderList('');
    modal.style.display = 'flex';
  }
  function close() {
    const modal = document.getElementById('semantic-groups-modal');
    if (modal) modal.style.display = 'none';
  }
  function toggle() {
    const modal = createModalIfNeeded();
    if (modal.style.display === 'none' || !modal.style.display) { open(); }
    else { close(); }
  }
  function update() {
    const modal = document.getElementById('semantic-groups-modal');
    if (modal && modal.style.display !== 'none') renderList(document.getElementById('semantic-groups-search')?.value || '');
  }

  window.SemanticGroupsUI = { open, close, toggle, update };
  window.SemanticGroupsUIScriptLoaded = true;
})(window, document);
