/**
 * Project brief view
 */

import BaseView from './base-view.js';
import { ViewType } from '../core/state-store.js';
import { escapeHtml, escapeAttr } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

export class BriefingView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (event.path === '' || event.path.startsWith('data.') || event.path.startsWith('ui.')) {
        this._container.innerHTML = this.render();
      }
    });
  }

  render() {
    return this._renderProjectBriefForm();
  }

  _renderProjectBriefForm() {
    const brief = this._getProjectBrief();
    const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal : '';
    const projectSummary = typeof brief.projectSummary === 'string' ? brief.projectSummary : '';
    const audience = typeof brief.audience === 'string' ? brief.audience : '';
    const tone = typeof brief.tone === 'string' ? brief.tone : '';
    const workflowMode = this.getState('data.workflowMode') || 'auto';
    const modeLabel = workflowMode === 'auto'
      ? 'Auto-pilot'
      : (workflowMode === 'guided' ? 'Guided' : 'Manual');

    return `
      <div class="ppt-question-form">
        <div class="form-header">
          <h3><iconify-icon icon="carbon:target"></iconify-icon> 项目需求（ProjectBrief）</h3>
          <p>用于约束 DeepSearch 与 PPT 生成方向（当前模式：${modeLabel}）。</p>
        </div>
        <div class="form-body custom-scrollbar">
          <div class="form-group">
            <label>1. 任务目标（必填）</label>
            <input id="pptBriefTaskGoal" type="text" class="ppt-input-field" placeholder="例如：生成一份面向高管的市场分析汇报，突出竞争格局与关键指标" value="${escapeAttr(taskGoal)}">
          </div>
          <div class="form-group">
            <label>2. 侧重点 / 项目摘要（写入 projectSummary）</label>
            <textarea id="pptBriefProjectSummary" class="ppt-input-field" style="min-height: 140px; line-height: 1.5;" placeholder="希望重点关注哪些结论、证据、结构或风格？">${escapeHtml(projectSummary)}</textarea>
          </div>
          <div class="form-group">
            <label>3. 受众（可选）</label>
            <input id="pptBriefAudience" type="text" class="ppt-input-field" placeholder="例如：非技术高管 / 技术团队 / 混合受众" value="${escapeAttr(audience)}">
          </div>
          <div class="form-group">
            <label>4. 语气（可选）</label>
            <input id="pptBriefTone" type="text" class="ppt-input-field" placeholder="例如：商务严谨 / 学术 / 科技感" value="${escapeAttr(tone)}">
          </div>
        </div>
        <div class="form-footer">
          <button class="ppt-btn-secondary" data-action="cancelProjectBrief">
            <iconify-icon icon="carbon:arrow-left"></iconify-icon> 返回
          </button>
          <button class="ppt-btn-primary" data-action="submitProjectBrief">
            保存并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
          </button>
        </div>
      </div>
    `;
  }

  _onCancelProjectBrief() {
    this.setState('ui.pendingStart', false);
    if (this._adapter?.cancelProjectBrief) {
      this._adapter.cancelProjectBrief();
    } else {
      this.navigate(ViewType.UPLOAD);
    }
  }

  _onSubmitProjectBrief() {
    const taskGoal = this.$('#pptBriefTaskGoal')?.value?.trim() || '';
    if (!taskGoal) {
      alert('请填写「任务目标」(taskGoal)，否则无法开始 DeepSearch。');
      return;
    }

    const projectSummary = this.$('#pptBriefProjectSummary')?.value?.trim() || '';
    const audience = this.$('#pptBriefAudience')?.value?.trim() || '';
    const tone = this.$('#pptBriefTone')?.value?.trim() || '';

    const brief = { taskGoal, projectSummary, audience, tone };
    this._applyBrief(brief);

    const pendingStart = this.getState('ui.pendingStart');
    this.setState('ui.pendingStart', false);
    if (this._adapter?.cancelProjectBrief) {
      this._adapter.cancelProjectBrief();
    } else {
      this.navigate(ViewType.UPLOAD);
    }

    if (pendingStart) {
      this._adapter?.startWorkflow?.({ skipBriefCheck: true });
      this.emit('ui.workflow.start', { taskGoal });
    }
  }

  _applyBrief(brief) {
    this.setState('data.projectBrief', brief);
    this.setState('data.taskGoal', brief.taskGoal || '');
    this._adapter?.setProjectBrief?.(brief);
  }

  _getProjectBrief() {
    const brief = this.getState('data.projectBrief');
    return brief && typeof brief === 'object' ? brief : {};
  }
}

export default BriefingView;
