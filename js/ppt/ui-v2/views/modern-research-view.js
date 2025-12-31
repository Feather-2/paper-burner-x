/**
 * Modern Research View - UI V2
 * 三栏式布局：左侧文件系统、中间 Flow 背景、右侧 Cursor 式时间线 + Chat
 */

import BaseView from './base-view.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/`/g, '&#096;');
}

const STATUS_META = {
  reading: { icon: 'carbon:document-view', title: '深度阅读', desc: 'AI 正在分析文档结构' },
  researching: { icon: 'carbon:search', title: '研究分析', desc: '正在扫描资料、识别知识空白' },
  scripting: { icon: 'carbon:edit', title: '构建大纲', desc: '正在梳理逻辑结构' },
  designer: { icon: 'carbon:paint-brush', title: '视觉设计', desc: '正在生成页面布局' },
  idle: { icon: 'carbon:bot', title: '准备就绪', desc: '请开始您的研究任务' }
};

export class ModernResearchView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
    this._flowCanvasId = 'modernFlowCanvas';
    this._commandState = { visible: false, query: '', selectedIndex: 0, matches: [] };
    this._runsCache = { ts: 0, value: null, promise: null };
    this._globalKeydownHandler = null;
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._adapter?.mountActiveFlowVisualizers?.();
    this._syncState();
    this._bindChatUi();
    this._bindGlobalCommandShortcut();

    this.subscribeState((event) => {
      if (!this._mounted) return;
      
      // 当文件、大纲或工作流状态变化时更新
      if (event.path.startsWith('data.') || event.path.startsWith('workflow.') || event.path.startsWith('ui.')) {
        this._syncState();
      }
    });
  }

  onUnmount() {
    this._adapter?.destroyFlowViz?.('deepsearch');
    this._adapter?.destroyFlowViz?.('design');
    this._unbindGlobalCommandShortcut();
  }

  _syncState() {
    const state = this._getWorkflowState();
    const data = this.getState('data') || {};
    const ui = this.getState('ui') || {};
    
    this._updateStatusUI(state);
    this._updateFileSystem(data.files || []);
    this._updateTimeline(state, data, ui);
    this._adapter?.updateCompressionPanel?.();
  }

  _getWorkflowState() {
    const state = this.getState('workflow.state');
    return (typeof state === 'string' && state) ? state : (this._adapter?.getWorkflowState?.() || 'idle');
  }

  _updateStatusUI(state) {
    const meta = STATUS_META[state] || STATUS_META.idle;
    const titleEl = this.$('#modernStatusTitle');
    if (titleEl) titleEl.textContent = meta.title;
  }

  _updateFileSystem(files) {
    const fsEl = this.$('#modernFileSystem');
    if (!fsEl) return;

    if (files.length === 0) {
      fsEl.innerHTML = '<div class="empty-state">暂无素材</div>';
      return;
    }

    fsEl.innerHTML = files.map(file => `
      <div class="file-item">
        <iconify-icon icon="carbon:document"></iconify-icon>
        <div class="file-info">
          <div class="file-name">${file.name}</div>
          <div class="file-meta">${file.size}</div>
        </div>
      </div>
    `).join('');
  }

  _updateTimeline(state, data, ui) {
    const timelineEl = this.$('#modernTimeline');
    if (!timelineEl) return;

    const meta = STATUS_META[state] || STATUS_META.idle;
    const runLogs = Array.isArray(data?.runLogs) ? data.runLogs : [];
    const items = runLogs.slice(-18).reverse().map((log) => {
      const level = typeof log?.level === 'string' ? log.level : 'info';
      const scope = typeof log?.scope === 'string' ? log.scope : 'system';
      const stage = typeof log?.stage === 'string' ? log.stage : '';
      const title = stage ? `${scope}:${stage}` : scope;
      const desc = typeof log?.message === 'string' ? log.message : '';
      const active = level === 'error' || level === 'warning';
      return { title, desc, active };
    });

    if (!items.length) {
      items.push({ title: meta.title, desc: meta.desc, active: state !== 'idle' });
    }

    timelineEl.innerHTML = items.map(item => `
        <div class="timeline-item ${item.active ? 'active' : ''}">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-title">${item.title}</div>
            <div class="timeline-desc">${item.desc}</div>
          </div>
        </div>
      `).join('');
  }

  render() {
    const state = this._getWorkflowState();
    const meta = STATUS_META[state] || STATUS_META.idle;

    return `
      <div class="modern-research-layout">
        <!-- 左侧：文件系统 -->
        <aside class="modern-sidebar-left">
          <div class="sidebar-header">
            <iconify-icon icon="carbon:inventory-management"></iconify-icon>
            <span>研究素材</span>
          </div>
          <div class="file-system-tree" id="modernFileSystem">
            <div class="empty-state">暂无素材</div>
          </div>
        </aside>

        <!-- 中间：ReactFlow 背景层 -->
        <main class="modern-center-stage">
          <div id="${this._flowCanvasId}" class="modern-flow-canvas"></div>
          
          <!-- 悬浮状态指示器 -->
          <div class="modern-floating-status">
            <div class="status-badge pulse"></div>
            <span id="modernStatusTitle">${meta.title}</span>
          </div>
        </main>

        <!-- 右侧：Cursor 式时间线 + Chat -->
        <aside class="modern-sidebar-right">
          <div class="timeline-container">
            <div class="timeline-header">执行记录</div>
            <div class="modern-timeline" id="modernTimeline">
              <!-- 时间线节点动态插入 -->
              <div class="timeline-item active">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-title">${meta.title}</div>
                  <div class="timeline-desc">${meta.desc}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="chat-interface">
            <div class="chat-messages" id="modernChatMessages">
              <div class="chat-msg ai">
                AI: 我正在处理您的请求，请稍候...
              </div>
            </div>
            <div class="chat-command-palette" id="modernChatCommandPalette"></div>
            <div class="chat-input-area">
              <textarea id="modernChatInput" placeholder="询问 AI 或输入指令（/help）..." rows="1"></textarea>
              <button class="chat-send-btn" type="button" id="modernChatSendBtn">
                <iconify-icon icon="carbon:send-filled"></iconify-icon>
              </button>
            </div>
          </div>
        </aside>
      </div>
    `;
  }

  _bindChatUi() {
    const input = this.$('#modernChatInput');
    const sendBtn = this.$('#modernChatSendBtn');
    const palette = this.$('#modernChatCommandPalette');
    if (!input || !sendBtn || !palette) return;

    const onInput = () => {
      this._updateCommandPalette(input.value);
      this._autoGrowTextArea(input);
    };

    const onKeyDown = (e) => {
      if (!e) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._handleChatSend();
        return;
      }

      if (!this._commandState.visible) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._selectCommandDelta(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._selectCommandDelta(-1);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this._applySelectedCommandToInput();
      }
    };

    const onSend = () => this._handleChatSend();
    const onPaletteClick = (e) => {
      const el = e?.target?.closest?.('.chat-command-item');
      if (!el || !palette.contains(el)) return;
      const kind = el.getAttribute('data-kind') || '';
      if (kind === 'complete') {
        const value = el.getAttribute('data-value') || '';
        input.value = value;
        input.focus();
        this._updateCommandPalette(input.value);
        return;
      }
      const cmd = el.getAttribute('data-cmd') || '';
      if (cmd) this._executeSlashCommand(cmd);
    };

    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    sendBtn.addEventListener('click', onSend);
    palette.addEventListener('click', onPaletteClick);

    this._subscriptions.push(() => {
      try { input.removeEventListener('input', onInput); } catch { }
      try { input.removeEventListener('keydown', onKeyDown); } catch { }
      try { sendBtn.removeEventListener('click', onSend); } catch { }
      try { palette.removeEventListener('click', onPaletteClick); } catch { }
    });

    // Initial render
    this._updateCommandPalette(input.value);
    this._autoGrowTextArea(input);
  }

  _bindGlobalCommandShortcut() {
    if (this._globalKeydownHandler) return;
    this._globalKeydownHandler = (e) => {
      // Cmd/Ctrl + K -> focus chat and open palette
      const isK = e?.key?.toLowerCase?.() === 'k';
      const wants = isK && (e.metaKey || e.ctrlKey);
      if (!wants) return;
      const input = this.$('#modernChatInput');
      if (!input) return;
      e.preventDefault();
      input.focus();
      if (!String(input.value || '').trim()) {
        input.value = '/';
        this._updateCommandPalette(input.value);
      }
    };
    document.addEventListener('keydown', this._globalKeydownHandler);
  }

  _unbindGlobalCommandShortcut() {
    if (!this._globalKeydownHandler) return;
    try {
      document.removeEventListener('keydown', this._globalKeydownHandler);
    } catch { }
    this._globalKeydownHandler = null;
  }

  _autoGrowTextArea(textarea) {
    if (!textarea) return;
    try {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(100, textarea.scrollHeight)}px`;
    } catch { }
  }

  _getSlashCommands() {
    return [
      { cmd: '/help', desc: '显示可用命令' },
      { cmd: '/reset', desc: '清空当前 Chat 记录（仅本页 UI）' },
      { cmd: '/undo', desc: '撤销最近 N 次文件写入（默认 1）：/undo 3', action: { type: 'undoLastVfsCheckpoint' } },
      { cmd: '/changes', desc: '显示 VFS 写入 diffstat（默认最近 200 次）：/changes [run_xxx] [200]', action: { type: 'getVfsChangesSummary' } },
      { cmd: '/plans', desc: '打开 Plans Manager（可选 runId）：/plans run_xxx', action: { type: 'openPlansManager' } },
      { cmd: '/artifacts', desc: '打开 Artifacts Browser（可选 runId）：/artifacts run_xxx', action: { type: 'openArtifactsBrowser' } },
      { cmd: '/export-run', desc: '导出 Run Zip（可选 runId）：/export-run [run_xxx]', action: { type: 'exportCurrentRunZip' } },
      { cmd: '/import-run', desc: '导入 Run Zip（file picker）', action: { type: 'importRunZip' } },
      { cmd: '/replay', desc: '回放指定 run：/replay run_xxx', action: { type: 'startReplay' } },
      { cmd: '/resume', desc: '从 plan 恢复执行：/resume run_xxx [stepIdOrIndex]', action: { type: 'resumeWorkflowFromPlan' } },
      { cmd: '/approvals', desc: '打开 Approvals', action: { type: 'openApprovalsModal' } },
      { cmd: '/policy', desc: '打开 Policy Rules', action: { type: 'openPolicyRulesManager' } },
      { cmd: '/skills', desc: '打开 Skills Manager', action: { type: 'openSkillsManager' } },
      { cmd: '/history', desc: '打开 Run History（含导入/导出）', action: { type: 'openHistorySelector' } },
      { cmd: '/paste', desc: '粘贴文档开始', action: { type: 'openPasteDocumentModal' } },
      { cmd: '/url', desc: '添加 URL', action: { type: 'openUrlInput' } },
      { cmd: '/status', desc: '显示当前状态' },
    ];
  }

  _getGenerator() {
    return this._adapter?.generator || (typeof window !== 'undefined' ? window.PPTGenerator : null);
  }

  async _ensureRunsCached() {
    const now = Date.now();
    const ttlMs = 5000;
    if (Array.isArray(this._runsCache.value) && now - this._runsCache.ts < ttlMs) {
      return this._runsCache.value;
    }

    if (this._runsCache.promise) return this._runsCache.promise;

    const generator = this._getGenerator();
    if (!generator || typeof generator.listRuns !== 'function') {
      this._runsCache = { ts: now, value: [], promise: null };
      return [];
    }

    this._runsCache.promise = Promise.resolve()
      .then(() => generator.listRuns())
      .then((runs) => {
        const list = Array.isArray(runs) ? runs : [];
        this._runsCache = { ts: Date.now(), value: list, promise: null };
        return list;
      })
      .catch(() => {
        this._runsCache = { ts: Date.now(), value: [], promise: null };
        return [];
      });

    return this._runsCache.promise;
  }

  async _buildRunCompletionItems({ cmd, partialRunId = '' } = {}) {
    const runs = await this._ensureRunsCached();
    const needle = String(partialRunId || '').trim().toLowerCase();

    const sorted = runs
      .slice()
      .sort((a, b) => String(b?.createdAt || b?.startedAt || '').localeCompare(String(a?.createdAt || a?.startedAt || '')));

    const filtered = needle
      ? sorted.filter((r) => {
        const id = String(r?.runId || '').toLowerCase();
        const title = String(r?.title || r?.taskGoal || '').toLowerCase();
        return id.startsWith(needle) || title.includes(needle);
      })
      : sorted;

    return filtered
      .slice(0, 12)
      .map((r) => {
        const runId = String(r?.runId || '').trim();
        const title = String(r?.title || r?.taskGoal || '').trim();
        const when = String(r?.createdAt || r?.startedAt || '').trim();
        const label = title ? `${runId} · ${title}` : runId;
        const value = `${cmd} ${runId}${cmd === '/resume' ? ' ' : ''}`;
        return {
          kind: 'complete',
          value,
          label,
          desc: when ? new Date(when).toLocaleString() : '',
        };
      })
      .filter((i) => i.value && i.label);
  }

  _buildUndoCompletionItems({ cmd, partial = '' } = {}) {
    const needle = String(partial || '').trim();
    const base = [1, 2, 3, 5, 8].map((n) => String(n));
    const filtered = needle ? base.filter((n) => n.startsWith(needle)) : base;
    return filtered.map((n) => ({
      kind: 'complete',
      value: `${cmd} ${n} `,
      label: `${cmd} ${n}`,
      desc: 'steps',
    }));
  }

  _updateCommandPalette(rawValue) {
    const palette = this.$('#modernChatCommandPalette');
    if (!palette) return;

    const value = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
    const trimmed = value.trimStart();
    const isSlash = trimmed.startsWith('/');

    if (!isSlash) {
      this._commandState = { visible: false, query: '', selectedIndex: 0, matches: [] };
      palette.classList.remove('visible');
      palette.innerHTML = '';
      return;
    }

    const hasTrailingSpace = /\s$/.test(trimmed);
    const tokens = trimmed.trim().split(/\s+/).filter(Boolean);
    const token0 = (tokens[0] || '').toLowerCase();
    const arg1 = tokens[1] || '';
    const wantsArgs = tokens.length >= 2 || hasTrailingSpace;

    const commands = this._getSlashCommands();

    const renderItems = (items) => {
      const list = Array.isArray(items) ? items : [];
      this._commandState.visible = true;
      this._commandState.query = token0;
      this._commandState.matches = list;
      this._commandState.selectedIndex = Math.max(0, Math.min(this._commandState.selectedIndex, Math.max(0, list.length - 1)));

      palette.classList.add('visible');
      palette.innerHTML = list.length
        ? list
          .map((c, idx) => {
            const active = idx === this._commandState.selectedIndex ? 'active' : '';
            if (c.kind === 'complete') {
              return `
                <div class="chat-command-item ${active}" data-kind="complete" data-value="${escapeAttr(c.value)}">
                  <div class="chat-command-cmd">${escapeHtml(c.label || c.value)}</div>
                  <div class="chat-command-desc">${escapeHtml(c.desc || '')}</div>
                </div>
              `;
            }
            return `
              <div class="chat-command-item ${active}" data-kind="command" data-cmd="${escapeAttr(c.cmd)}">
                <div class="chat-command-cmd">${escapeHtml(c.cmd)}</div>
                <div class="chat-command-desc">${escapeHtml(c.desc || '')}</div>
              </div>
            `;
          })
          .join('')
        : `<div class="chat-command-empty">无匹配命令（输入 /help 查看）。</div>`;
    };

    if (token0 === '/undo' && wantsArgs) {
      renderItems(this._buildUndoCompletionItems({ cmd: token0, partial: arg1 }));
      return;
    }

    if ((token0 === '/replay' || token0 === '/plans' || token0 === '/artifacts' || token0 === '/resume' || token0 === '/export-run') && wantsArgs) {
      // Optimistic loading UI; runs list is fetched async.
      palette.classList.add('visible');
      palette.innerHTML = '<div class="chat-command-empty">加载 Runs...</div>';

      const snapshot = trimmed;
      void (async () => {
        const items = await this._buildRunCompletionItems({ cmd: token0, partialRunId: arg1 });
        const inputEl = this.$('#modernChatInput');
        if (!inputEl) return;
        const latest = String(inputEl.value || '').trimStart();
        if (latest !== snapshot) return;
        renderItems(items);
      })();
      return;
    }

    const matches = commands
      .filter((c) => c.cmd.startsWith(token0))
      .map((c) => ({ kind: 'command', cmd: c.cmd, desc: c.desc || '' }));
    renderItems(matches);
  }

  _selectCommandDelta(delta) {
    const matches = Array.isArray(this._commandState.matches) ? this._commandState.matches : [];
    if (matches.length === 0) return;
    const next = (this._commandState.selectedIndex || 0) + (delta || 0);
    this._commandState.selectedIndex = Math.max(0, Math.min(matches.length - 1, next));
    const input = this.$('#modernChatInput');
    this._updateCommandPalette(input?.value || '');
  }

  _applySelectedCommandToInput() {
    const input = this.$('#modernChatInput');
    if (!input) return;
    const matches = Array.isArray(this._commandState.matches) ? this._commandState.matches : [];
    if (matches.length === 0) return;
    const selected = matches[this._commandState.selectedIndex || 0];
    if (selected?.kind === 'complete' && selected.value) {
      input.value = String(selected.value);
    } else if (selected?.cmd) {
      input.value = `${selected.cmd} `;
    } else {
      return;
    }
    input.focus();
    this._updateCommandPalette(input.value);
  }

  _appendChatMessage(text, { role = 'ai' } = {}) {
    const host = this.$('#modernChatMessages');
    if (!host) return;
    const msg = typeof text === 'string' ? text : String(text ?? '');
    const el = document.createElement('div');
    el.className = `chat-msg ${role === 'user' ? 'user' : 'ai'}`;
    el.textContent = msg;
    host.appendChild(el);
    try {
      host.scrollTop = host.scrollHeight;
    } catch { }
  }

  _handleChatSend() {
    const input = this.$('#modernChatInput');
    if (!input) return;
    const value = typeof input.value === 'string' ? input.value.trim() : '';
    if (!value) return;

    if (value.startsWith('/')) {
      void this._executeSlashCommand(value);
      input.value = '';
      this._updateCommandPalette('');
      this._autoGrowTextArea(input);
      return;
    }

    this._appendChatMessage(value, { role: 'user' });
    this._appendChatMessage('当前 Chat 仅支持 slash commands（输入 /help）。', { role: 'ai' });
    input.value = '';
    this._autoGrowTextArea(input);
  }

  async _executeSlashCommand(raw) {
    const input = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    const parts = input.split(/\s+/).filter(Boolean);
    const cmd = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);
    const commands = this._getSlashCommands();
    const entry = commands.find((c) => c.cmd === cmd);

    this._appendChatMessage(cmd, { role: 'user' });

    if (!entry) {
      this._appendChatMessage(`未知命令：${cmd}（输入 /help 查看）。`, { role: 'ai' });
      return;
    }

    if (cmd === '/help') {
      const lines = commands.map((c) => `${c.cmd} - ${c.desc || ''}`).join('\n');
      this._appendChatMessage(lines, { role: 'ai' });
      return;
    }

    if (cmd === '/reset') {
      const host = this.$('#modernChatMessages');
      if (host) host.innerHTML = '';
      this._appendChatMessage('已清空当前 Chat 记录。', { role: 'ai' });
      return;
    }

    if (cmd === '/status') {
      const wf = this.getState('workflow') || {};
      const data = this.getState('data') || {};
      const runId = typeof wf?.runId === 'string' ? wf.runId : (this._adapter?.getRunId?.() || '');
      const state = typeof wf?.state === 'string' ? wf.state : this._getWorkflowState();
      const fileCount = Array.isArray(data?.files) ? data.files.length : 0;
      const msg = `state=${state || 'unknown'}\nrunId=${runId || 'n/a'}\nfiles=${fileCount}`;
      this._appendChatMessage(msg, { role: 'ai' });
      return;
    }

    if (cmd === '/undo') {
      const n = parseInt(String(args[0] || ''), 10);
      const steps = Number.isFinite(n) && n > 0 ? n : 1;
      const requestId = `undo_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;

      const off = this.subscribeEvent('ui.undo.result', (_name, payload) => {
        if (payload?.requestId !== requestId) return;
        off?.();
        const ok = payload?.ok !== false;
        const rolledBack = typeof payload?.rolledBack === 'number' ? payload.rolledBack : 0;
        const failures = Array.isArray(payload?.failures) ? payload.failures : [];
        const msg = ok
          ? `撤销完成：rolledBack=${rolledBack}${failures.length ? `（failures=${failures.length}）` : ''}`
          : `撤销失败：${payload?.error || payload?.reason || 'unknown'}`;
        this._appendChatMessage(msg, { role: 'ai' });
      });

      this.emit('ui.action', { type: 'undoLastVfsCheckpoint', steps, reason: 'ui:/undo', requestId });
      this._appendChatMessage(`已请求撤销最近 ${steps} 次文件写入...`, { role: 'ai' });
      return;
    }

    if (cmd === '/changes') {
      const a0 = typeof args[0] === 'string' ? args[0].trim() : '';
      const a1 = typeof args[1] === 'string' ? args[1].trim() : '';
      let runId = '';
      let maxEntries = undefined;

      if (a0) {
        const n0 = parseInt(a0, 10);
        if (Number.isFinite(n0) && String(n0) === a0) maxEntries = n0;
        else runId = a0;
      }
      if (a1) {
        const n1 = parseInt(a1, 10);
        if (Number.isFinite(n1) && String(n1) === a1) maxEntries = n1;
      }

      const cap = Number.isFinite(Number(maxEntries)) ? Math.max(1, Math.min(2000, Math.floor(Number(maxEntries)))) : 200;
      const requestId = `changes_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;

      const off = this.subscribeEvent('ui.changes.result', (_name, payload) => {
        if (payload?.requestId !== requestId) return;
        off?.();
        const ok = payload?.ok !== false;
        if (!ok) {
          this._appendChatMessage(`变更统计失败：${payload?.error || payload?.reason || 'unknown'}`, { role: 'ai' });
          return;
        }

        const filesChanged = typeof payload?.filesChanged === 'number' ? payload.filesChanged : 0;
        const writes = typeof payload?.writes === 'number' ? payload.writes : 0;
        const insertions = typeof payload?.insertions === 'number' ? payload.insertions : 0;
        const deletions = typeof payload?.deletions === 'number' ? payload.deletions : 0;
        const missingDiffs = typeof payload?.missingDiffs === 'number' ? payload.missingDiffs : 0;
        const files = Array.isArray(payload?.files) ? payload.files : [];

        const lines = [];
        lines.push(`runId=${payload?.runId || 'n/a'}`);
        lines.push(`filesChanged=${filesChanged} writes=${writes}`);
        lines.push(`+${insertions} -${deletions}${missingDiffs ? ` (missingDiffs=${missingDiffs})` : ''}`);

        const top = files.slice(0, 8);
        if (top.length) {
          lines.push('');
          for (const row of top) {
            const p = typeof row?.path === 'string' ? row.path : '';
            const w = typeof row?.writes === 'number' ? row.writes : 0;
            const ins = typeof row?.insertions === 'number' ? row.insertions : 0;
            const del = typeof row?.deletions === 'number' ? row.deletions : 0;
            if (!p) continue;
            lines.push(`${p} (writes=${w}, +${ins}, -${del})`);
          }
        }

        this._appendChatMessage(lines.join('\n'), { role: 'ai' });
      });

      this.emit('ui.action', {
        type: 'getVfsChangesSummary',
        requestId,
        ...(runId ? { runId } : {}),
        maxEntries: cap,
      });
      this._appendChatMessage(`已请求变更统计（最近 ${cap} 次）...`, { role: 'ai' });
      return;
    }

    if (cmd === '/replay') {
      const runId = typeof args[0] === 'string' ? args[0].trim() : '';
      if (!runId) {
        this._appendChatMessage('用法：/replay run_xxx', { role: 'ai' });
        return;
      }
      this.emit('ui.action', { type: 'startReplay', runId });
      this._appendChatMessage(`已请求回放：${runId}`, { role: 'ai' });
      return;
    }

    if (cmd === '/resume') {
      const runId = typeof args[0] === 'string' ? args[0].trim() : '';
      const rawStep = typeof args[1] === 'string' ? args[1].trim() : '';
      let stepIdOrIndex = undefined;
      if (rawStep) {
        const n = parseInt(rawStep, 10);
        stepIdOrIndex = Number.isFinite(n) && String(n) === rawStep ? n : rawStep;
      }
      this.emit('ui.action', {
        type: 'resumeWorkflowFromPlan',
        ...(runId ? { runId } : {}),
        ...(stepIdOrIndex !== undefined ? { stepIdOrIndex } : {}),
      });
      this._appendChatMessage(`已请求恢复执行：${runId || '(current)'}${rawStep ? ` ${rawStep}` : ''}`, { role: 'ai' });
      return;
    }

    if (cmd === '/plans' || cmd === '/artifacts') {
      const runId = typeof args[0] === 'string' ? args[0].trim() : '';
      if (entry.action) {
        this.emit('ui.action', runId ? { ...entry.action, runId } : entry.action);
        this._appendChatMessage(entry.desc || '已执行。', { role: 'ai' });
        return;
      }
    }

    if (cmd === '/export-run') {
      const runId = typeof args[0] === 'string' ? args[0].trim() : '';
      if (entry.action) {
        this.emit('ui.action', runId ? { ...entry.action, runId } : entry.action);
        this._appendChatMessage(entry.desc || '已执行。', { role: 'ai' });
        return;
      }
    }

    if (entry.action) {
      this.emit('ui.action', entry.action);
      this._appendChatMessage(entry.desc || '已执行。', { role: 'ai' });
      return;
    }

    this._appendChatMessage('命令已识别，但未绑定动作。', { role: 'ai' });
  }
}

export default ModernResearchView;
