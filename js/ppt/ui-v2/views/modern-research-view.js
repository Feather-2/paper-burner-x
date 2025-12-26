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
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._adapter?.mountActiveFlowVisualizers?.();
    this._syncState();

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
            <div class="chat-input-area">
              <textarea placeholder="询问 AI 或输入指令..." rows="1"></textarea>
              <button class="chat-send-btn">
                <iconify-icon icon="carbon:send-filled"></iconify-icon>
              </button>
            </div>
          </div>
        </aside>
      </div>
    `;
  }
}

export default ModernResearchView;
