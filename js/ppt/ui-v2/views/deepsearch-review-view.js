/**
 * DeepSearch review view
 */

import BaseView from './base-view.js';
import { escapeHtml } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

export class DeepsearchReviewView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._adapter?.mountActiveFlowVisualizers?.();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (event.path === '' || event.path.startsWith('data.report') || event.path.startsWith('ui.')) {
        this._adapter?.destroyFlowViz?.('deepsearch');
        this._container.innerHTML = this.render();
        this._adapter?.mountActiveFlowVisualizers?.();
      }
    });
  }

  onUnmount() {
    this._adapter?.destroyFlowViz?.('deepsearch');
  }

  render() {
    const markdown = this._getReportMarkdown();
    const hasContinue = typeof this._adapter?.continueDeepSearchIteration === 'function';
    const hasProceed = typeof this._adapter?.proceedToScriptReview === 'function';
    const logs = this._getLogs();
    const runLogs = this._getRunLogs();

    return `
      <div class="ppt-question-form">
        <div class="form-header">
          <h3><iconify-icon icon="carbon:search"></iconify-icon> DeepSearch 结果审阅</h3>
          <p>查看 gaps 覆盖情况与迭代进度；可继续下一轮或进入脚本编辑。</p>
        </div>
        <div class="form-body custom-scrollbar">
          ${this._renderDeepSearchVisualization()}
          ${this._renderLogsPanel(logs, runLogs)}

          <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--ppt-border);">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px;">
              <div style="font-weight:650; color: var(--ppt-text);">研究报告预览</div>
              <div style="font-size:12px; color: var(--ppt-text-secondary);">可在下一步编辑全文</div>
            </div>
            <textarea class="ppt-input-field" style="width: 100%; min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;"
              readonly>${escapeHtml(markdown)}</textarea>
          </div>
        </div>
        <div class="form-footer">
          <button class="ppt-btn-secondary" ${hasContinue ? '' : 'disabled'} data-action="continueDeepSearchIteration">
            <iconify-icon icon="carbon:renew"></iconify-icon> 下一轮迭代
          </button>
          <button class="ppt-btn-primary" ${hasProceed ? '' : 'disabled'} data-action="proceedToScriptReview">
            进入脚本编辑 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
          </button>
        </div>
      </div>
    `;
  }

  _renderDeepSearchVisualization() {
    return `
      <div class="ppt-flow-embed">
        <div class="ppt-flow-embed-header">
          <div class="ppt-flow-embed-title">
            <iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon>
            <span>DeepSearch 流程</span>
          </div>
          <div class="ppt-flow-embed-hint">拖拽 / 缩放查看 · 自动聚焦最新节点</div>
        </div>
        <div id="pptDeepSearchFlowViz" class="ppt-flow-canvas" style="height:520px;"></div>
      </div>
    `;
  }

  _getReportMarkdown() {
    const stored = this.getState('data.reportMarkdown');
    if (typeof stored === 'string' && stored) return stored;
    return this._adapter?.getReportMarkdown?.() || '';
  }

  _getLogs() {
    const logs = this.getState('ui.logs');
    return Array.isArray(logs) ? logs : [];
  }

  _getRunLogs() {
    const logs = this.getState('data.runLogs');
    return Array.isArray(logs) ? logs : [];
  }

  _renderLogsPanel(logs, runLogs) {
    const source = Array.isArray(logs) && logs.length ? logs : (Array.isArray(runLogs) ? runLogs : []);
    const items = source.slice(-60).reverse();
    if (!items.length) return '';

    const badge = (level) => {
      const lv = String(level || 'info');
      if (lv === 'error') return { text: 'ERR', fg: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
      if (lv === 'warning' || lv === 'warn') return { text: 'WARN', fg: '#f59e0b', bg: 'rgba(245,158,11,0.14)' };
      if (lv === 'debug') return { text: 'DBG', fg: '#64748b', bg: 'rgba(100,116,139,0.12)' };
      return { text: 'INFO', fg: '#2563eb', bg: 'rgba(37,99,235,0.12)' };
    };

    const rows = items.map((log) => {
      const ts = typeof log?.timestamp === 'number' ? new Date(log.timestamp).toLocaleTimeString() : '';
      const lv = badge(log?.level);
      const scope = typeof log?.scope === 'string' ? log.scope : 'log';
      const stage = typeof log?.stage === 'string' && log.stage ? log.stage : '';
      const title = stage ? `${scope}:${stage}` : scope;
      const msg = escapeHtml(log?.message || '');
      return `
        <div style="display:flex; gap:10px; padding:10px 12px; border:1px solid var(--ppt-border); border-radius:10px; background:var(--ppt-panel-bg);">
          <span style="flex:0 0 auto; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:650; color:${lv.fg}; background:${lv.bg};">${lv.text}</span>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; color:var(--ppt-text-secondary);">${escapeHtml(title)}${ts ? ` · ${escapeHtml(ts)}` : ''}</div>
            <div style="margin-top:2px; color:var(--ppt-text); white-space:pre-wrap; word-break:break-word;">${msg}</div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-top: 14px; padding: 12px; border: 1px solid var(--ppt-border); border-radius: 12px; background: var(--ppt-panel-bg);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
          <div style="font-weight:650; color: var(--ppt-text);">执行日志</div>
          <div style="font-size:12px; color: var(--ppt-text-secondary);">最近 ${items.length} 条</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">${rows}</div>
      </div>
    `;
  }

  _onContinueDeepSearchIteration() {
    this._adapter?.continueDeepSearchIteration?.();
  }

  _onProceedToScriptReview() {
    this._adapter?.proceedToScriptReview?.();
  }
}

export default DeepsearchReviewView;
