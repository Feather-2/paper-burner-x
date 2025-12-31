/**
 * Modern Research View - UI V2
 * 三栏式布局：左侧文件系统、中间 Flow 背景、右侧 Cursor 式时间线 + Chat
 */

import BaseView from './base-view.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

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
      const el = e?.target?.closest?.('[data-cmd]');
      if (!el || !palette.contains(el)) return;
      const cmd = el.getAttribute('data-cmd') || '';
      this._executeSlashCommand(cmd);
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
      { cmd: '/undo', desc: '撤销最近 N 次文件写入（默认 1）：/undo 3', action: { type: 'undoLastVfsCheckpoint' } },
      { cmd: '/plans', desc: '打开 Plans Manager（可选 runId）：/plans run_xxx', action: { type: 'openPlansManager' } },
      { cmd: '/artifacts', desc: '打开 Artifacts Browser（可选 runId）：/artifacts run_xxx', action: { type: 'openArtifactsBrowser' } },
      { cmd: '/replay', desc: '回放指定 run：/replay run_xxx', action: { type: 'startReplay' } },
      { cmd: '/approvals', desc: '打开 Approvals', action: { type: 'openApprovalsModal' } },
      { cmd: '/policy', desc: '打开 Policy Rules', action: { type: 'openPolicyRulesManager' } },
      { cmd: '/skills', desc: '打开 Skills Manager', action: { type: 'openSkillsManager' } },
      { cmd: '/history', desc: '打开 Run History（含导入/导出）', action: { type: 'openHistorySelector' } },
      { cmd: '/paste', desc: '粘贴文档开始', action: { type: 'openPasteDocumentModal' } },
      { cmd: '/url', desc: '添加 URL', action: { type: 'openUrlInput' } },
      { cmd: '/status', desc: '显示当前状态' },
    ];
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

    const token = trimmed.split(/\s+/)[0].toLowerCase();
    const commands = this._getSlashCommands();
    const matches = commands.filter((c) => c.cmd.startsWith(token));

    this._commandState.visible = true;
    this._commandState.query = token;
    this._commandState.matches = matches;
    this._commandState.selectedIndex = Math.max(0, Math.min(this._commandState.selectedIndex, Math.max(0, matches.length - 1)));

    palette.classList.add('visible');
    palette.innerHTML = matches.length
      ? matches
        .map((c, idx) => `
            <div class="chat-command-item ${idx === this._commandState.selectedIndex ? 'active' : ''}" data-cmd="${c.cmd}">
              <div class="chat-command-cmd">${c.cmd}</div>
              <div class="chat-command-desc">${c.desc || ''}</div>
            </div>
          `)
        .join('')
      : `<div class="chat-command-empty">无匹配命令（输入 /help 查看）。</div>`;
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
    if (!selected?.cmd) return;
    input.value = `${selected.cmd} `;
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

    if (cmd === '/plans' || cmd === '/artifacts') {
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
