/**
 * Questioning view (需求确认)
 */

import BaseView from './base-view.js';
import { escapeHtml, escapeAttr } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

export class QuestioningView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (event.path === '' || event.path.startsWith('data.questions')) {
        this._container.innerHTML = this.render();
      }
    });
  }

  render() {
    const questions = this._getQuestions();

    return `
      <div class="ppt-question-form">
        <div class="form-header">
          <h3><iconify-icon icon="carbon:user-speaker"></iconify-icon> 需求确认</h3>
          <p>AI 已分析文档，请确认以下关键策略以定制演示文稿：</p>
        </div>
        <div class="form-body custom-scrollbar">
          ${questions.length ? questions.map((q, i) => this._renderQuestionItem(q, i)).join('') : this._renderEmpty()}
        </div>
        <div class="form-footer">
          <div style="flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ppt-text-secondary);">
            <iconify-icon icon="carbon:information"></iconify-icon>
            <span>您也可以在右侧聊天栏直接提出修改意见</span>
          </div>
          <button class="ppt-btn-secondary" data-action="autoFillAnswers">
            <iconify-icon icon="carbon:magic-wand"></iconify-icon> AI 自动决策
          </button>
          <button class="ppt-btn-primary" data-action="submitAnswers">
            确认并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
          </button>
        </div>
      </div>
    `;
  }

  _renderQuestionItem(question, index) {
    const q = question || {};
    const title = escapeHtml(q.text || `问题 ${index + 1}`);
    const options = Array.isArray(q.options) ? q.options : [];
    const defaultValue = q.default;

    return `
      <div class="form-group">
        <label>${index + 1}. ${title}</label>
        <div class="form-options-wrapper">
          <div class="form-radio-group">
            ${options.map((opt) => {
              const checked = opt === defaultValue ? 'checked' : '';
              return `
                <label class="radio-option">
                  <input type="radio" name="q_${index}" value="${escapeAttr(opt)}" ${checked}>
                  <div class="radio-content">
                    <span class="radio-label">${escapeHtml(opt)}</span>
                    <iconify-icon icon="carbon:checkmark-filled" class="radio-check-icon"></iconify-icon>
                  </div>
                </label>
              `;
            }).join('')}
          </div>
          <div class="form-custom-input-wrapper">
            <input type="text" class="ppt-input-field" placeholder="或输入自定义回答..." name="q_${index}_custom">
            <button class="ppt-icon-btn" title="咨询 AI 助手" data-action="askAssistantAboutQuestion" data-index="${index}">
              <iconify-icon icon="carbon:chat-bot"></iconify-icon>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderEmpty() {
    return `
      <div style="padding: 20px; border: 1px dashed var(--ppt-border); border-radius: 12px; color: var(--ppt-text-secondary);">
        暂无问题，请继续下一步。
      </div>
    `;
  }

  _getQuestions() {
    const stored = this.getState('data.questions');
    if (Array.isArray(stored) && stored.length) return stored;
    return this._adapter?.getWorkflowData?.()?.questions || [];
  }

  _onAskAssistantAboutQuestion({ payload }) {
    const index = Number(payload?.index);
    if (!Number.isFinite(index)) return;
    this._adapter?.askAssistantAboutQuestion?.(index);
  }

  _onAutoFillAnswers() {
    this._adapter?.autoFillAnswers?.();
  }

  _onSubmitAnswers() {
    this._adapter?.submitAnswers?.();
  }
}

export default QuestioningView;
