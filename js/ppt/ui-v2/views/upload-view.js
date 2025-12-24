/**
 * Upload view (Start new research)
 */

import BaseView from './base-view.js';
import { ViewType } from '../core/state-store.js';
import { escapeHtml, escapeAttr, getFileIcon } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

const DEFAULT_REPORT_CONFIG = {
  reportLength: 'standard',
  tone: 'business',
  audience: 'general',
  language: 'auto'
};

export class UploadView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (
        event.path === '' ||
        event.path === 'ui.uploadStep' ||
        event.path.startsWith('data.')
      ) {
        this._container.innerHTML = this.render();
      }
    });
  }

  render() {
    return this._renderUploadView();
  }

  _renderUploadView() {
    const step = this.getState('ui.uploadStep') || 1;
    if (step === 1) return this._renderUploadStep1();
    return this._renderUploadStep2();
  }

  _renderGenerationModeCard(key, title, desc, icon) {
    const currentMode = this._getGenerationMode();
    const selected = currentMode === key;
    return `
      <div class="rd-mode-card ${selected ? 'active' : ''}" data-action="setGenerationMode" data-mode="${key}">
          <div class="rd-mode-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
          <div class="rd-mode-title">${title}</div>
          <div class="rd-mode-desc">${desc}</div>
      </div>
    `;
  }

  _renderFileSidebar() {
    const files = this._getFiles();
    const hasFiles = files.length > 0;

    return `
      <div class="rd-sidebar">
        <div class="rd-sidebar-card">
          <div class="rd-sidebar-title">
            <iconify-icon icon="solar:folder-with-files-bold-duotone"></iconify-icon>
            已添加资源
          </div>
          ${hasFiles ? `
            <div class="rd-sidebar-list">
              ${files.map((f, i) => `
                <div class="rd-file-item">
                  <iconify-icon icon="${getFileIcon(f?.type)}" class="rd-file-icon"></iconify-icon>
                  <div class="rd-file-info">
                    <div class="rd-file-name" title="${escapeAttr(String(f?.name ?? ''))}">${escapeHtml(String(f?.name ?? ''))}</div>
                    <div class="rd-file-meta">${escapeHtml(String(f?.size ?? ''))}</div>
                  </div>
                  <iconify-icon icon="solar:close-circle-linear" class="rd-file-remove" data-action="removeFile" data-index="${i}"></iconify-icon>
                </div>
              `).join('')}
            </div>
            <div class="rd-sidebar-count">${files.length} 个资源</div>
          ` : `
            <div class="rd-sidebar-empty">
              <iconify-icon icon="solar:inbox-line-bold-duotone"></iconify-icon>
              <div>暂无资源</div>
              <div style="margin-top: 4px;">请上传文档或导入链接</div>
            </div>
          `}
        </div>
      </div>
    `;
  }

  _renderUploadStep1() {
    const files = this._getFiles();
    const hasFiles = files.length > 0;

    return `
      <div class="rd-layout">
        ${this._renderFileSidebar()}
        <div class="rd-main">
          <div class="rd-card">
            <div class="rd-header">
              <h2 class="rd-title">开始新的研究</h2>
              <p class="rd-subtitle">上传文档或导入链接，AI 将为您生成深度报告</p>
            </div>

            <div class="rd-dropzone" data-action="triggerFilePicker">
              <iconify-icon icon="solar:cloud-upload-bold-duotone" class="rd-dropzone-icon"></iconify-icon>
              <div class="rd-dropzone-title">点击或拖拽文件至此处</div>
              <div class="rd-dropzone-hint">支持 PDF, DOCX, MD, TXT (最大 50MB)</div>
              <input type="file" id="pptFileInput" style="display:none;" multiple data-action="handleFileUpload" data-event="change">
            </div>

            <div class="rd-upload-grid">
              <button class="rd-source-btn" type="button" data-action="openHistorySelector">
                <div class="rd-source-icon">
                  <iconify-icon icon="solar:history-bold-duotone"></iconify-icon>
                </div>
                <div class="rd-source-info">
                  <h3>历史项目</h3>
                  <p>从过往项目提取</p>
                </div>
              </button>
              <button class="rd-source-btn" type="button" data-action="openUrlInput">
                <div class="rd-source-icon">
                  <iconify-icon icon="solar:link-circle-bold-duotone"></iconify-icon>
                </div>
                <div class="rd-source-info">
                  <h3>网页链接</h3>
                  <p>解析 URL 内容</p>
                </div>
              </button>
              <button class="rd-source-btn" type="button" data-action="openPasteDocumentModal">
                <div class="rd-source-icon">
                  <iconify-icon icon="carbon:paste"></iconify-icon>
                </div>
                <div class="rd-source-info">
                  <h3>直接粘贴文档</h3>
                  <p>粘贴 / 输入内容</p>
                </div>
              </button>
              <button class="rd-source-btn" type="button" data-action="importPptxAsDeckFromPicker">
                <div class="rd-source-icon">
                  <iconify-icon icon="solar:file-text-bold-duotone"></iconify-icon>
                </div>
                <div class="rd-source-info">
                  <h3>导入模板</h3>
                  <p>使用现有 PPTX</p>
                </div>
              </button>
            </div>

            <div class="rd-footer">
              <button class="rd-btn rd-btn-primary" ${hasFiles ? 'data-action="setUploadStep" data-step="2"' : 'disabled'}>
                下一步：配置选项 <iconify-icon icon="solar:arrow-right-linear"></iconify-icon>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderUploadStep2() {
    const mode = this._getWorkflowMode();
    const brief = this._getProjectBrief();
    const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal.trim() : '';
    const summary = typeof brief.projectSummary === 'string' ? brief.projectSummary.trim() : '';

    const reportCfg = this._getReportConfig();
    const reportLength = reportCfg.reportLength;
    const tone = reportCfg.tone;
    const audience = reportCfg.audience;
    const language = reportCfg.language;
    const modeCard = (key, title, desc, icon) => {
      const selected = mode === key;
      return `
        <div class="rd-mode-card ${selected ? 'active' : ''}" data-action="setWorkflowMode" data-mode="${key}">
          <div class="rd-mode-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
          <div class="rd-mode-title">${title}</div>
          <div class="rd-mode-desc">${desc}</div>
        </div>
      `;
    };

    const startAction = taskGoal ? 'startWorkflow' : 'openProjectBrief';

    return `
      <div class="rd-layout">
        ${this._renderFileSidebar()}
        <div class="rd-main">
          <div class="rd-card">
            <div class="rd-header">
              <h2 class="rd-title">生成配置</h2>
              <p class="rd-subtitle">选择生成模式并调整参数</p>
            </div>

            <div class="rd-section-title">生成模式</div>
            <div class="rd-mode-grid" style="margin-bottom: 20px;">
              ${this._renderGenerationModeCard('simple', '快速生成', '直接通读素材，按结构生成页面', 'solar:bolt-bold-duotone')}
              ${this._renderGenerationModeCard('planned', '规划模式', 'AI 扫描后，您来配置每页内容和参考资料', 'solar:clipboard-list-bold-duotone')}
              ${this._renderGenerationModeCard('deepsearch', '深度研究', 'DeepSearch 深度分析、联网扩展信息', 'solar:magnifer-zoom-in-bold-duotone')}
            </div>

            <div class="rd-section-title">工作模式</div>
            <div class="rd-mode-grid">
              ${modeCard('auto', 'Auto-pilot', '全自动执行', 'solar:rocket-2-bold-duotone')}
              ${modeCard('guided', 'Guided', '关键节点确认', 'solar:map-point-wave-bold-duotone')}
              ${modeCard('manual', 'Manual', '每步确认', 'solar:slider-minimalistic-horizontal-bold-duotone')}
            </div>

            <div class="rd-section-title" style="margin-top: 24px;">报告参数</div>
            <div class="rd-form-panel">
              <div class="rd-form-grid">
                <div class="rd-form-cell">
                  <label class="rd-form-label">报告长度</label>
                  <select class="rd-select" data-action="updateReportLength" data-event="change">
                    <option value="brief" ${reportLength === 'brief' ? 'selected' : ''}>简要</option>
                    <option value="standard" ${reportLength === 'standard' ? 'selected' : ''}>标准</option>
                    <option value="detailed" ${reportLength === 'detailed' ? 'selected' : ''}>详细</option>
                    <option value="comprehensive" ${reportLength === 'comprehensive' ? 'selected' : ''}>全面</option>
                  </select>
                </div>
                <div class="rd-form-cell">
                  <label class="rd-form-label">写作风格</label>
                  <select class="rd-select" data-action="updateWriteTone" data-event="change">
                    <option value="business" ${tone === 'business' ? 'selected' : ''}>商务专业</option>
                    <option value="academic" ${tone === 'academic' ? 'selected' : ''}>学术严谨</option>
                    <option value="casual" ${tone === 'casual' ? 'selected' : ''}>通俗易懂</option>
                  </select>
                </div>
                <div class="rd-form-cell">
                  <label class="rd-form-label">目标受众</label>
                  <select class="rd-select" data-action="updateWriteAudience" data-event="change">
                    <option value="general" ${audience === 'general' ? 'selected' : ''}>一般读者</option>
                    <option value="expert" ${audience === 'expert' ? 'selected' : ''}>专业人士</option>
                    <option value="executive" ${audience === 'executive' ? 'selected' : ''}>高管决策层</option>
                  </select>
                </div>
                <div class="rd-form-cell">
                  <label class="rd-form-label">输出语言</label>
                  <select class="rd-select" data-action="updateWriteLanguage" data-event="change">
                    <option value="auto" ${language === 'auto' ? 'selected' : ''}>自动检测</option>
                    <option value="zh" ${language === 'zh' ? 'selected' : ''}>简体中文</option>
                    <option value="en" ${language === 'en' ? 'selected' : ''}>English</option>
                  </select>
                </div>
              </div>
            </div>

            ${taskGoal || summary ? `
              <div class="rd-brief-info">
                <div class="rd-brief-title">
                  <iconify-icon icon="solar:info-circle-bold-duotone"></iconify-icon>
                  <span>当前需求：${taskGoal ? escapeHtml(taskGoal) : '未填写'}</span>
                </div>
                ${summary ? `<div class="rd-brief-summary">${escapeHtml(summary)}</div>` : ''}
              </div>
            ` : ''}

            <div class="rd-footer">
              <button class="rd-btn rd-btn-ghost" data-action="setUploadStep" data-step="1">
                <iconify-icon icon="solar:arrow-left-linear"></iconify-icon> 返回
              </button>
              <button class="rd-btn rd-btn-ghost" data-action="openProjectBrief">
                <iconify-icon icon="solar:pen-2-linear"></iconify-icon> 编辑需求
              </button>
              <button class="rd-btn rd-btn-primary" data-action="${startAction}">
                <iconify-icon icon="solar:rocket-bold-duotone"></iconify-icon> ${taskGoal ? '开始分析' : '填写需求'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _onTriggerFilePicker() {
    this.$('#pptFileInput')?.click();
  }

  _onHandleFileUpload({ target }) {
    const files = target?.files;
    if (!files || files.length === 0) return;
    if (this._adapter?.handleFileUpload) {
      this._adapter.handleFileUpload(files);
    } else {
      this._addFilesToState(files);
    }
    target.value = '';
  }

  _onOpenHistorySelector() {
    if (this._adapter?.openHistorySelector) {
      this._adapter.openHistorySelector();
    } else {
      this.emit('ui.action', { type: 'openHistorySelector' });
    }
  }

  _onOpenUrlInput() {
    if (this._adapter?.openUrlInput) {
      this._adapter.openUrlInput();
    } else {
      this.emit('ui.action', { type: 'openUrlInput' });
    }
  }

  _onOpenPasteDocumentModal() {
    if (this._adapter?.openPasteDocumentModal) {
      this._adapter.openPasteDocumentModal();
    } else {
      this.emit('ui.action', { type: 'openPasteDocumentModal' });
    }
  }

  _onImportPptxAsDeckFromPicker() {
    if (this._adapter?.importPptxAsDeckFromPicker) {
      this._adapter.importPptxAsDeckFromPicker();
    } else {
      this.emit('ui.action', { type: 'importPptxAsDeckFromPicker' });
    }
  }

  _onSetUploadStep({ payload }) {
    const step = Number(payload?.step);
    const files = this._getFiles();
    if (step === 2 && files.length === 0) return;
    if (step === 1 || step === 2) {
      this.setState('ui.uploadStep', step);
      this._adapter?.setUploadStep?.(step);
    }
  }

  _onSetGenerationMode({ payload }) {
    const mode = payload?.mode;
    if (!mode) return;
    this.setState('data.generationMode', mode);
    this._adapter?.setGenerationMode?.(mode);
  }

  _onSetWorkflowMode({ payload }) {
    const mode = payload?.mode;
    if (!mode) return;
    this.setState('data.workflowMode', mode);
    this._adapter?.setWorkflowMode?.(mode);
  }

  _onUpdateReportLength({ value }) {
    if (!value) return;
    this._updateReportConfig({ reportLength: value });
    this._adapter?.updateReportLength?.(value);
  }

  _onUpdateWriteTone({ value }) {
    if (!value) return;
    this._updateReportConfig({ tone: value });
    this._adapter?.updateWriteTone?.(value);
  }

  _onUpdateWriteAudience({ value }) {
    if (!value) return;
    this._updateReportConfig({ audience: value });
    this._adapter?.updateWriteAudience?.(value);
  }

  _onUpdateWriteLanguage({ value }) {
    if (!value) return;
    this._updateReportConfig({ language: value });
    this._adapter?.updateWriteLanguage?.(value);
  }

  _onOpenProjectBrief() {
    this.setState('ui.pendingStart', false);
    const modalManager = window.PPTUIV2?.instance?.modalManager;
    if (modalManager && typeof modalManager.openBriefingModal === 'function') {
      modalManager.openBriefingModal();
    } else if (this._adapter?.openProjectBriefForm) {
      this._adapter.openProjectBriefForm();
    } else {
      this.navigate(ViewType.BRIEFING);
    }
  }

  _onStartWorkflow() {
    const brief = this._getProjectBrief();
    const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal.trim() : '';
    if (!taskGoal) {
      this.setState('ui.pendingStart', true);
      const modalManager = window.PPTUIV2?.instance?.modalManager;
      if (modalManager && typeof modalManager.openBriefingModal === 'function') {
        modalManager.openBriefingModal();
      } else if (this._adapter?.openProjectBriefForm) {
        this._adapter.openProjectBriefForm();
      } else {
        this.navigate(ViewType.BRIEFING);
      }
      return;
    }
    this.setState('ui.pendingStart', false);
    this._adapter?.startWorkflow?.();
    this.emit('ui.workflow.start', { taskGoal });
  }

  _onRemoveFile({ payload }) {
    const index = Number(payload?.index);
    if (!Number.isFinite(index)) return;
    if (this._adapter?.removeFile) {
      this._adapter.removeFile(index);
    } else {
      const files = this._getFiles();
      const next = files.filter((_, i) => i !== index);
      this.setState('data.files', next);
    }
  }

  _getFiles() {
    const files = this.getState('data.files');
    return Array.isArray(files) ? files : [];
  }

  _getGenerationMode() {
    return this.getState('data.generationMode') || 'deepsearch';
  }

  _getWorkflowMode() {
    return this.getState('data.workflowMode') || 'auto';
  }

  _getProjectBrief() {
    const brief = this.getState('data.projectBrief');
    return brief && typeof brief === 'object' ? brief : {};
  }

  _getReportConfig() {
    const cfg = this.getState('data.reportConfig');
    if (!cfg || typeof cfg !== 'object') return { ...DEFAULT_REPORT_CONFIG };
    return {
      reportLength: typeof cfg.reportLength === 'string' ? cfg.reportLength : DEFAULT_REPORT_CONFIG.reportLength,
      tone: typeof cfg.tone === 'string' ? cfg.tone : DEFAULT_REPORT_CONFIG.tone,
      audience: typeof cfg.audience === 'string' ? cfg.audience : DEFAULT_REPORT_CONFIG.audience,
      language: typeof cfg.language === 'string' ? cfg.language : DEFAULT_REPORT_CONFIG.language
    };
  }

  _updateReportConfig(patch) {
    const cfg = this._getReportConfig();
    const next = { ...cfg, ...(patch || {}) };
    this.setState('data.reportConfig', next);
  }

  _addFilesToState(fileList) {
    const files = Array.from(fileList || []).map((f) => ({
      name: f.name,
      size: this._formatSize(f.size),
      rawSize: f.size,
      mimeType: f.type,
      type: 'file',
      file: f
    }));
    if (files.length === 0) return;
    const current = this._getFiles();
    this.setState('data.files', [...current, ...files]);
  }

  _formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(value) / Math.log(k));
    return `${parseFloat((value / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
}

export default UploadView;
