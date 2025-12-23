/**
 * Failed view
 */

import BaseView from './base-view.js';
import { escapeHtml } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

export class FailedView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (event.path === '' || event.path === 'workflow.error') {
        this._container.innerHTML = this.render();
      }
    });
  }

  render() {
    const error = this.getState('workflow.error') || '';
    const message = error ? `错误信息：${escapeHtml(error)}` : '发生错误，请调整输入后重试。';

    return `
      <div class="ppt-question-form">
        <div class="form-header">
          <h3><iconify-icon icon="carbon:warning"></iconify-icon> 流程已中止</h3>
          <p>${message}</p>
        </div>
        <div class="form-footer">
          <button class="ppt-btn-secondary" data-action="returnHome">
            <iconify-icon icon="carbon:home"></iconify-icon> 返回主页
          </button>
          <button class="ppt-btn-primary" data-action="restartWorkflow">
            重新开始 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
          </button>
        </div>
      </div>
    `;
  }

  _onReturnHome() {
    this._adapter?.showProjectList?.();
  }

  _onRestartWorkflow() {
    this._adapter?.resetToIdle?.();
  }
}

export default FailedView;
