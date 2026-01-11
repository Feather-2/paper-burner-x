/**
 * DeepSearch premium flow view
 */

import BaseView from './base-view.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

const DEFAULT_STEPS = [
  { state: 'reading', label: '阅读' },
  { state: 'researching', label: '研究' },
  { state: 'script_review', label: '脚本' },
  { state: 'page_layout', label: '规划' },
  { state: 'designer', label: '设计' }
];

const STATUS_META = {
  reading: {
    icon: 'carbon:document-view',
    title: '正在深度阅读文档...',
    desc: 'AI 正在分析文档结构并提取关键信息'
  },
  scanning: {
    icon: 'carbon:document-view',
    title: '正在深度阅读文档...',
    desc: 'AI 正在分析文档结构并提取关键信息'
  },
  researching: {
    icon: 'carbon:search',
    title: '正在进行研究分析...',
    desc: 'AI 正在扫描资料、识别知识空白并生成研究报告'
  },
  script_review: {
    icon: 'carbon:document',
    title: '脚本审阅与编辑',
    desc: '请确认研究报告脚本，必要时可直接编辑'
  },
  page_layout: {
    icon: 'carbon:layout',
    title: '正在规划页面结构...',
    desc: '正在将内容结构映射到幻灯片布局意图'
  },
  outline_review: {
    icon: 'carbon:tree-view-alt',
    title: '大纲确认',
    desc: 'AI 已根据您的需求生成演示大纲，请确认或调整'
  },
  scripting: {
    icon: 'carbon:edit',
    title: '正在构建演示大纲...',
    desc: '正在梳理逻辑结构并撰写演讲备注'
  },
  designer: {
    icon: 'carbon:paint-brush',
    title: '正在进行视觉设计...',
    desc: '正在匹配最佳模板并生成页面布局'
  },
  failed: {
    icon: 'carbon:warning',
    title: '流程已中止',
    desc: '发生错误，请调整输入后重试'
  },
  idle: {
    icon: 'carbon:bot',
    title: '准备就绪',
    desc: '请上传文档或输入主题开始'
  }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[ch]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function getFlowConfig() {
  return typeof window !== 'undefined'
    ? window.PPTDashboard?.PPTFlowConfig
    : null;
}

function getAliasedState(state) {
  const cfg = getFlowConfig();
  if (cfg?.getAliasedState) return cfg.getAliasedState(state);
  return state;
}

function getStateIndex(state) {
  const cfg = getFlowConfig();
  if (cfg?.getStateIndex) return cfg.getStateIndex(state);
  const order = DEFAULT_STEPS.map(step => step.state);
  return order.indexOf(state);
}

function getStepperSteps() {
  const cfg = getFlowConfig();
  if (cfg?.getDeepsearchStepper) {
    const steps = cfg.getDeepsearchStepper();
    if (Array.isArray(steps) && steps.length) return steps;
  }
  return DEFAULT_STEPS;
}

export class ResearchView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
    this._flowCanvasId = null;
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._flowCanvasId = this._getFlowCanvasId(this._getWorkflowState());
    this._adapter?.mountActiveFlowVisualizers?.();
    this._adapter?.updateCompressionPanel?.();
    this._syncStatusFromState();

    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (event.path === 'workflow.state' || event.path === '') {
        const state = this._getWorkflowState();
        const nextCanvasId = this._getFlowCanvasId(state);
        if (nextCanvasId !== this._flowCanvasId) {
          this._adapter?.destroyFlowViz?.('deepsearch');
          this._adapter?.destroyFlowViz?.('design');
          this._container.innerHTML = this.render();
          this._flowCanvasId = nextCanvasId;
          this._adapter?.mountActiveFlowVisualizers?.();
          this._adapter?.updateCompressionPanel?.();
        }
        this._syncStatusFromState();
      }
    });
  }

  onUnmount() {
    this._adapter?.destroyFlowViz?.('deepsearch');
    this._adapter?.destroyFlowViz?.('design');
  }

  render() {
    const state = this._getWorkflowState();
    const isDesigner = state === 'designer';
    const flowCanvasId = isDesigner ? 'pptDesignFlowVizFull' : 'pptDeepSearchFlowVizFull';
    const steps = getStepperSteps();
    const status = this._getStatusMeta(state);

    return `
      <div class="ds-research-stage">
        <div class="ds-viz-panel">
          <div id="${escapeAttr(flowCanvasId)}" class="ppt-flow-canvas"></div>
        </div>

        <div class="ds-stepper-bar">
          <div class="ds-stepper-left">
            ${steps.map((step, index) => this._renderStep(step, index, state, steps.length)).join('')}
          </div>
        </div>

        <div class="ds-stepper-status">
          <div class="ds-status-badge-sm" id="dsPanelStatusBadge">
            <iconify-icon icon="${status.icon}"></iconify-icon>
          </div>
          <span class="ds-status-label" id="dsPanelStatusTitle">${escapeHtml(status.title)}</span>
        </div>

        <div class="ds-process-panel">
          <div class="ds-panel-header">
            <span class="ds-panel-title">执行日志</span>
            <span class="ds-panel-hint" id="dsPanelStatusSub">${escapeHtml(status.desc)}</span>
          </div>
          <div class="ds-context-panel" id="dsContextPanel">
            <div class="ds-context-row">
              <span class="ds-context-title">上下文压力</span>
              <span class="ds-context-mode" id="dsContextMode">--</span>
            </div>
            <div class="ds-context-bar">
              <div class="ds-context-bar-fill" id="dsContextBarFill"></div>
            </div>
            <div class="ds-context-meta" id="dsContextMeta">暂无压缩指标</div>
            <div class="ds-context-spark is-empty" id="dsContextSpark"></div>
          </div>
          <div class="ds-process-content" id="dsProcessList"></div>
        </div>
      </div>
    `;
  }

  _renderStep(step, index, currentState, totalSteps) {
    const num = String(index + 1);
    const currentIndex = getStateIndex(currentState);
    const stepIndex = getStateIndex(step.state);
    const isCompleted = currentIndex !== -1 && stepIndex !== -1 && currentIndex > stepIndex;
    let className = 'ds-step';

    if (getAliasedState(currentState) === getAliasedState(step.state)) className += ' active';
    if (isCompleted) className += ' completed';

    const icon = isCompleted ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num;
    const line = index < totalSteps - 1
      ? `<div class="ds-step-line ${isCompleted ? 'completed' : ''}" data-step-state="${escapeAttr(step.state)}"></div>`
      : '';

    return `
      <div class="${className}" data-step-state="${escapeAttr(step.state)}">
        <div class="ds-step-num">${icon}</div>
        <span class="ds-step-text">${escapeHtml(step.label)}</span>
      </div>
      ${line}
    `;
  }

  _getWorkflowState() {
    const state = this.getState('workflow.state');
    if (typeof state === 'string' && state) return state;
    return this._adapter?.getWorkflowState?.() || 'idle';
  }

  _getFlowCanvasId(state) {
    return state === 'designer' ? 'pptDesignFlowVizFull' : 'pptDeepSearchFlowVizFull';
  }

  _getStatusMeta(state) {
    return STATUS_META[state] || STATUS_META.idle;
  }

  _syncStatusFromState() {
    const state = this._getWorkflowState();
    const status = this._getStatusMeta(state);

    const badge = this.$('#dsPanelStatusBadge');
    if (badge) badge.innerHTML = `<iconify-icon icon="${status.icon}"></iconify-icon>`;

    const title = this.$('#dsPanelStatusTitle');
    if (title) title.textContent = status.title;

    const desc = this.$('#dsPanelStatusSub');
    if (desc) desc.textContent = status.desc;

    const currentIndex = getStateIndex(state);
    this.$$('.ds-step').forEach((stepEl) => {
      const stepState = stepEl.dataset.stepState;
      const stepIndex = getStateIndex(stepState);
      stepEl.classList.toggle('active', getAliasedState(state) === getAliasedState(stepState));
      stepEl.classList.toggle('completed', currentIndex !== -1 && stepIndex !== -1 && currentIndex > stepIndex);
    });

    this.$$('.ds-step-line').forEach((lineEl) => {
      const stepState = lineEl.dataset.stepState;
      const stepIndex = getStateIndex(stepState);
      lineEl.classList.toggle('completed', currentIndex !== -1 && stepIndex !== -1 && currentIndex > stepIndex);
    });
  }
}

export default ResearchView;
