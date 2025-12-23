/**
 * Page layout review view
 */

import BaseView from './base-view.js';
import { escapeHtml, escapeAttr } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

export class PageLayoutView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
    this._pageLayoutTab = 2;
    this._selectedSlideIntentId = '';
    this._slideIntentDragCleanup = null;
    this._designSpecCleanup = null;
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._refresh();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (
        event.path === '' ||
        event.path === 'data.designSystem' ||
        event.path === 'data.designPhase' ||
        event.path === 'data.slideStatuses' ||
        event.path === 'data.batchSize'
      ) {
        this._refresh();
      }
    });
  }

  onUnmount() {
    this._cleanupInteractions();
  }

  render() {
    return this._renderPageLayoutReview();
  }

  _refresh() {
    if (!this._mounted) return;
    this._cleanupInteractions();
    this._container.innerHTML = this.render();
    this._setupSlideIntentDrag();
    this._bindDesignSpecInteractions();
  }

  _cleanupInteractions() {
    if (typeof this._slideIntentDragCleanup === 'function') {
      try { this._slideIntentDragCleanup(); } catch { /* ignore */ }
    }
    this._slideIntentDragCleanup = null;
    if (typeof this._designSpecCleanup === 'function') {
      try { this._designSpecCleanup(); } catch { /* ignore */ }
    }
    this._designSpecCleanup = null;
  }

  _getActiveTab() {
    const maxTab = 2;
    let activeTab = Number.isInteger(this._pageLayoutTab) ? this._pageLayoutTab : 2;
    activeTab = Math.max(0, Math.min(maxTab, Math.floor(activeTab)));
    if (this._pageLayoutTab !== activeTab) this._pageLayoutTab = activeTab;
    return activeTab;
  }

  _getWorkflowData() {
    return this._adapter?.getWorkflowData?.() || {};
  }

  _getSlideIntents() {
    const data = this._getWorkflowData();
    const pkg = data.contentPackage && typeof data.contentPackage === 'object' ? data.contentPackage : null;
    if (Array.isArray(pkg?.slideIntents)) return pkg.slideIntents;
    if (Array.isArray(data.slideIntents)) return data.slideIntents;
    return [];
  }

  _getSlideStatuses() {
    const stored = this.getState('data.slideStatuses');
    if (stored && typeof stored === 'object') return stored;
    const data = this._getWorkflowData();
    return data.slideStatuses && typeof data.slideStatuses === 'object' ? data.slideStatuses : {};
  }

  _getDesignPhase() {
    const stored = this.getState('data.designPhase');
    if (stored && typeof stored === 'object') return stored;
    const data = this._getWorkflowData();
    return data.designPhase && typeof data.designPhase === 'object' ? data.designPhase : null;
  }

  _getDesignSystem() {
    const stored = this.getState('data.designSystem');
    if (stored && typeof stored === 'object') return stored;
    return this._adapter?.getDesignSystem?.() || {};
  }

  _getBatchSize() {
    const stored = this.getState('data.batchSize');
    if (Number.isFinite(stored)) return stored;
    const data = this._getWorkflowData();
    const size = Number(data?.batchSize);
    return Number.isFinite(size) ? size : 4;
  }

  _renderPageLayoutReview() {
    const activeTab = this._getActiveTab();
    return `
      <div class="ppt-question-form page-layout">
        <div class="ppt-page-layout-editor">
          ${this._renderDesignPhaseProgress()}
          <div class="ppt-page-layout-tabs">
            <div class="ppt-page-layout-tab ${activeTab === 0 ? 'active' : ''}" data-action="setPageLayoutTab" data-tab="0">
              <iconify-icon icon="carbon:list"></iconify-icon> 页面规划
            </div>
            <div class="ppt-page-layout-tab ${activeTab === 1 ? 'active' : ''}" data-action="setPageLayoutTab" data-tab="1">
              <iconify-icon icon="carbon:edit"></iconify-icon> 页面详情
            </div>
            <div class="ppt-page-layout-tab ${activeTab === 2 ? 'active' : ''}" data-action="setPageLayoutTab" data-tab="2">
              <iconify-icon icon="carbon:color-palette"></iconify-icon> 设计规范
            </div>
          </div>
          <div class="ppt-page-layout-content custom-scrollbar">
            ${activeTab === 0 ? this._renderPagePlanTab() : activeTab === 1 ? this._renderPageDetailTab() : this._renderDesignSpecView()}
          </div>
          <div class="ppt-page-layout-footer">
            <button class="ppt-btn-secondary" data-action="backToScriptReview">
              <iconify-icon icon="carbon:arrow-left"></iconify-icon> 返回脚本
            </button>
            <button class="ppt-btn-primary" data-action="phase5DesignOptimization">
              继续设计 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _renderDesignPhaseProgress() {
    const phase = this._getDesignPhase();
    const status = typeof phase?.status === 'string'
      ? phase.status
      : (typeof phase?.to === 'string' ? phase.to : '');
    const labels = {
      outline_parsing: '解析大纲',
      outline_confirming: '确认大纲',
      style_extracting: '提取风格',
      style_confirming: '确认风格',
      generating: '生成页面',
      generating_paused: '生成暂停',
      reviewing: '质量审阅',
      fixing: '修复页面',
      visual_filling: '填充视觉',
      completed: '完成设计',
      failed: '设计失败',
      editing: '进入编辑'
    };
    const ordered = [
      'outline_parsing',
      'outline_confirming',
      'style_extracting',
      'style_confirming',
      'generating',
      'reviewing',
      'visual_filling',
      'completed'
    ];
    const idx = ordered.indexOf(status);
    const percent = idx >= 0 ? Math.round(((idx + 1) / ordered.length) * 100) : 0;
    const label = status ? (labels[status] || status) : '未开始';
    const subtitle = status ? `当前阶段：${label}` : '等待设计阶段启动';

    return `
      <div style="margin-bottom: 14px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--ppt-border); background: var(--ppt-surface);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="font-weight: 800; color: var(--ppt-text-main); display:flex; align-items:center; gap:8px;">
            <iconify-icon icon="carbon:flag"></iconify-icon>
            <span>设计阶段进度</span>
          </div>
          <div style="font-size: 12px; color: var(--ppt-text-secondary); font-weight: 600;">${escapeHtml(subtitle)}</div>
        </div>
        <div style="margin-top: 10px; height: 8px; border-radius: 999px; background: rgba(148,163,184,0.2); overflow: hidden;">
          <div style="height: 100%; width: ${percent}%; background: linear-gradient(90deg, #22c55e, #0ea5e9); transition: width 0.3s ease;"></div>
        </div>
      </div>
    `;
  }

  _renderPagePlanTab() {
    const slides = this._getSlideIntents();
    const selectedId = String(this._selectedSlideIntentId || '');
    const statusStore = this._getSlideStatuses();
    const statusById = statusStore.bySlideIntentId && typeof statusStore.bySlideIntentId === 'object'
      ? statusStore.bySlideIntentId
      : {};
    const statusByIndex = statusStore.byIndex && typeof statusStore.byIndex === 'object'
      ? statusStore.byIndex
      : {};

    const statusMeta = {
      generating: { label: '生成中', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
      completed: { label: '已完成', color: '#16a34a', bg: 'rgba(22,163,74,0.12)', border: 'rgba(22,163,74,0.3)' },
      failed: { label: '失败', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
      degraded: { label: '降级', color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)' }
    };

    const getStatusEntry = (slideId, index) => {
      if (slideId && statusById[slideId]) return statusById[slideId];
      if (Number.isFinite(index) && statusByIndex[index]) return statusByIndex[index];
      return null;
    };

    const renderStatusBadge = (entry) => {
      if (!entry) return '';
      const statusKey = entry.degraded ? 'degraded' : entry.status;
      const meta = statusKey ? statusMeta[statusKey] : null;
      if (!meta) return '';
      const titleParts = [];
      if (entry.step) titleParts.push(`step: ${entry.step}`);
      if (entry.msg) titleParts.push(entry.msg);
      if (entry.error) titleParts.push(`error: ${entry.error}`);
      const title = titleParts.length ? ` title="${escapeAttr(titleParts.join(' | '))}"` : '';
      return `
        <span${title} style="flex-shrink:0; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid ${meta.border}; color: ${meta.color}; background: ${meta.bg};">
          ${meta.label}
        </span>
      `;
    };

    const renderCard = (s, i) => {
      const id = String(s?.slideIntentId || '');
      const title = escapeHtml(s?.title || '未命名页面');
      const pageType = escapeHtml(s?.pageType || 'overview');
      const keyPoints = Array.isArray(s?.keyPoints) ? s.keyPoints : [];
      const keyPointsPreview = keyPoints.slice(0, 3).map((k) => `<div>• ${escapeHtml(k)}</div>`).join('');
      const isSelected = selectedId && id === selectedId;
      const statusEntry = getStatusEntry(id, i);
      const statusBadge = renderStatusBadge(statusEntry);

      return `
        <div class="slide-intent-card ${isSelected ? 'selected' : ''}" data-slide-intent-id="${escapeAttr(id)}">
          <div style="display:flex; align-items:flex-start; gap:12px;">
            <div draggable="true" title="拖拽排序" style="padding: 6px 6px; border-radius: 10px; cursor: grab; color: var(--ppt-text-secondary);">
              <iconify-icon icon="carbon:draggable"></iconify-icon>
            </div>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <div style="font-weight: 800; color: var(--ppt-text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${i + 1}. ${title}
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                  ${statusBadge}
                  <span style="flex-shrink:0; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid var(--ppt-border); color: var(--ppt-text-secondary); background: var(--ppt-surface);">
                    ${pageType}
                  </span>
                </div>
              </div>
              ${keyPointsPreview ? `<div style="margin-top: 8px; color: var(--ppt-text-secondary); font-size: 13px; line-height: 1.5;">${keyPointsPreview}</div>` : `<div style="margin-top: 8px; color: var(--ppt-text-muted); font-size: 13px;">（暂无要点）</div>`}
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <button class="ppt-icon-btn" title="编辑" data-action="selectSlideIntent" data-id="${escapeAttr(id)}">
                <iconify-icon icon="carbon:edit"></iconify-icon>
              </button>
              <button class="ppt-icon-btn" title="复制" data-action="duplicateSlideIntent" data-id="${escapeAttr(id)}">
                <iconify-icon icon="carbon:copy"></iconify-icon>
              </button>
              <button class="ppt-icon-btn" title="删除" data-action="deleteSlideIntent" data-id="${escapeAttr(id)}">
                <iconify-icon icon="carbon:trash-can"></iconify-icon>
              </button>
            </div>
          </div>
        </div>
      `;
    };

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 12px;">
        <div style="font-weight: 900; color: var(--ppt-text-main); display:flex; align-items:center; gap:10px;">
          <iconify-icon icon="carbon:layout"></iconify-icon>
          <span>SlideIntents（${slides.length}）</span>
        </div>
        <button class="ppt-btn-secondary" data-action="addSlideIntent">
          <iconify-icon icon="carbon:add"></iconify-icon> 添加页面
        </button>
      </div>
      ${slides.length ? `
        <div id="pptSlideIntentList" style="display:flex; flex-direction:column; gap:12px;">
          ${slides.map(renderCard).join('')}
        </div>
      ` : `
        <div style="padding: 14px; border: 1px dashed var(--ppt-border); border-radius: var(--ppt-radius-lg); background: var(--ppt-surface); color: var(--ppt-text-secondary);">
          暂无页面规划。点击右上角「添加页面」开始编辑。
        </div>
      `}
    `;
  }

  _renderPageDetailTab() {
    const slides = this._getSlideIntents();
    const id = String(this._selectedSlideIntentId || '');
    const si = id ? slides.find((s) => String(s?.slideIntentId || '') === id) : null;

    if (!si) {
      return `
        <div style="padding: 14px; border: 1px dashed var(--ppt-border); border-radius: var(--ppt-radius-lg); background: var(--ppt-surface); color: var(--ppt-text-secondary); line-height: 1.6;">
          未选择页面。请在「页面规划」中点击某个页面的编辑按钮进入详情编辑。
        </div>
      `;
    }

    const allowedTypes = ['cover', 'agenda', 'overview', 'comparison', 'process', 'summary', 'appendix'];
    const currentType = typeof si.pageType === 'string' && si.pageType.trim() ? si.pageType.trim() : 'overview';
    const typeOptions = (allowedTypes.includes(currentType) ? allowedTypes : [currentType, ...allowedTypes])
      .filter((v, i, arr) => arr.indexOf(v) === i);

    const title = escapeAttr(si.title || '');
    const objective = escapeHtml(si.objective || '');
    const keyPoints = Array.isArray(si.keyPoints) ? si.keyPoints : [];
    const claimIds = Array.isArray(si.claimIds) ? si.claimIds : [];

    const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
    const prevId = idx > 0 ? String(slides[idx - 1]?.slideIntentId || '') : '';
    const nextId = idx >= 0 && idx < slides.length - 1 ? String(slides[idx + 1]?.slideIntentId || '') : '';

    return `
      <div style="display:flex; flex-direction:column; gap:14px;">
        <div>
          <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">标题</div>
          <input class="ppt-input-field" type="text" value="${title}"
            data-action="updateSlideIntentField" data-event="input" data-id="${escapeAttr(id)}" data-field="title">
        </div>

        <div>
          <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">页面类型</div>
          <select class="ppt-input-field" data-action="updateSlideIntentField" data-event="change" data-id="${escapeAttr(id)}" data-field="pageType">
            ${typeOptions.map((t) => `<option value="${escapeAttr(t)}" ${t === currentType ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          </select>
        </div>

        <div>
          <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">目标说明</div>
          <textarea class="ppt-input-field" rows="4" style="line-height: 1.5;"
            data-action="updateSlideIntentField" data-event="input" data-id="${escapeAttr(id)}" data-field="objective">${objective}</textarea>
        </div>

        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 8px;">
            <div style="font-size: 13px; font-weight: 800; color: var(--ppt-text-main);">要点（KeyPoints）</div>
            <button class="ppt-btn-secondary" data-action="addSlideIntentKeyPoint" data-id="${escapeAttr(id)}">
              <iconify-icon icon="carbon:add"></iconify-icon> 添加要点
            </button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${keyPoints.length ? keyPoints.map((kp, i) => `
              <div style="display:flex; gap:8px; align-items:center;">
                <input class="ppt-input-field" type="text" style="flex:1;" value="${escapeAttr(kp || '')}"
                  data-action="updateSlideIntentKeyPoint" data-event="input" data-id="${escapeAttr(id)}" data-index="${i}">
                <button class="ppt-icon-btn" title="删除要点" data-action="removeSlideIntentKeyPoint" data-id="${escapeAttr(id)}" data-index="${i}">
                  <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
              </div>
            `).join('') : `<div style="color: var(--ppt-text-muted); font-size: 13px;">暂无要点，可点击右上角添加。</div>`}
          </div>
        </div>

        <div>
          <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">关联 ClaimIds（只读）</div>
          <div style="padding: 10px 12px; border: 1px solid var(--ppt-border); border-radius: var(--ppt-radius-md); background: var(--ppt-surface); color: var(--ppt-text-secondary); font-family: 'JetBrains Mono', monospace; font-size: 12px;">
            ${claimIds.length ? escapeHtml(claimIds.join(', ')) : '（无）'}
          </div>
        </div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding-top: 6px;">
          <button class="ppt-btn-secondary" ${prevId ? `data-action="mergeSlideIntents" data-from="${escapeAttr(prevId)}" data-to="${escapeAttr(id)}"` : 'disabled'} title="将当前页合并到上一页">
            <iconify-icon icon="carbon:arrow-up"></iconify-icon> 合并到上一页
          </button>
          <button class="ppt-btn-secondary" ${nextId ? `data-action="mergeSlideIntents" data-from="${escapeAttr(id)}" data-to="${escapeAttr(nextId)}"` : 'disabled'} title="将下一页合并到当前页">
            <iconify-icon icon="carbon:arrow-down"></iconify-icon> 合并下一页
          </button>
          <button class="ppt-btn-secondary" data-action="splitSlideIntent" data-id="${escapeAttr(id)}" title="按要点拆分为多页">
            <iconify-icon icon="carbon:split"></iconify-icon> 拆分为多页
          </button>
        </div>
      </div>
    `;
  }

  _renderDesignSpecView() {
    const ds = this._getDesignSystem();
    const overrides = ds.designSystemOverrides || {};
    const colors = overrides.colors || ds.colors || {};
    const fonts = overrides.typography || ds.fonts || {};
    const visualMode = typeof overrides?.visualPreference?.mode === 'string'
      ? overrides.visualPreference.mode
      : (ds.visualPreference?.mode || 'balanced');
    const refineEnabled = !!ds.refine?.enabled;
    const density = ds.density || 'balanced';
    const batchSize = this._getBatchSize();

    const primary = this._coerceHexColor(colors.primary, '#0ea5e9');
    const secondary = this._coerceHexColor(colors.secondary, '#7c3aed');
    const bg = this._coerceHexColor(colors.bg, '#ffffff');
    const text = this._coerceHexColor(colors.text, '#0f172a');
    const accent = this._coerceHexColor(colors.accent, '#22c55e');

    const titleFont = typeof fonts.titleFont === 'string' ? fonts.titleFont : 'Inter';
    const bodyFont = typeof fonts.bodyFont === 'string' ? fonts.bodyFont : 'Inter';
    const fontSize = Number.isFinite(Number(fonts.fontSize)) ? Number(fonts.fontSize) : 16;

    const densityPad = density === 'compact' ? 10 : (density === 'spacious' ? 18 : 14);

    const colorRow = (key, label, value) => `
      <div class="ppt-design-spec-color-row" data-design-color="${escapeAttr(key)}">
        <div class="ppt-design-spec-swatch" style="background: ${escapeAttr(value)};"></div>
        <div class="ppt-design-spec-color-meta">
          <div class="ppt-design-spec-color-label">${escapeHtml(label)}</div>
          <div class="ppt-design-spec-color-value">${escapeHtml(value)}</div>
        </div>
        <input id="pptDesignColor-${escapeAttr(key)}" class="ppt-design-spec-color-input" type="color" value="${escapeAttr(value)}"
          data-action="updateDesignSystemColor" data-event="input" data-key="${escapeAttr(key)}">
      </div>
    `;

    const segBtn = (group, value, label, active) => `
      <button class="ppt-design-spec-seg-btn ${active ? 'active' : ''}" type="button"
        data-action="${group}" data-mode="${escapeAttr(value)}">${escapeHtml(label)}</button>
    `;

    const segBtnNum = (group, value, label, active) => `
      <button class="ppt-design-spec-seg-btn ${active ? 'active' : ''}" type="button"
        data-action="${group}" data-size="${Number(value)}">${escapeHtml(label)}</button>
    `;

    return `
      <div class="ppt-design-spec">
        <div class="ppt-design-spec-header">
          <div class="ppt-design-spec-title">
            <iconify-icon icon="carbon:color-palette"></iconify-icon>
            <span>Design Spec</span>
          </div>
          <div class="ppt-design-spec-subtitle">配置色板/字体/密度/批量，模型由 PPT 模型配置统一管理</div>
        </div>

        <div class="ppt-design-spec-grid">
          <div class="ppt-design-spec-section">
            <div class="ppt-design-spec-section-title">Colors</div>
            <div class="ppt-design-spec-colors">
              ${colorRow('primary', 'Primary', primary)}
              ${colorRow('secondary', 'Secondary', secondary)}
              ${colorRow('bg', 'Background', bg)}
              ${colorRow('text', 'Text', text)}
              ${colorRow('accent', 'Accent', accent)}
            </div>
          </div>

          <div class="ppt-design-spec-section">
            <div class="ppt-design-spec-section-title">Typography</div>
            <div class="ppt-design-spec-form">
              <label class="ppt-design-spec-field">
                <span>Title Font</span>
                <input id="pptDesignFont-titleFont" class="ppt-input-field" value="${escapeAttr(titleFont)}"
                  data-action="updateDesignSystemFont" data-event="input" data-key="titleFont">
              </label>
              <label class="ppt-design-spec-field">
                <span>Body Font</span>
                <input id="pptDesignFont-bodyFont" class="ppt-input-field" value="${escapeAttr(bodyFont)}"
                  data-action="updateDesignSystemFont" data-event="input" data-key="bodyFont">
              </label>
              <label class="ppt-design-spec-field">
                <span>Font Size</span>
                <input id="pptDesignFont-fontSize" class="ppt-input-field" type="number" min="10" max="60" step="1"
                  value="${escapeAttr(String(fontSize))}"
                  data-action="updateDesignSystemFontSize" data-event="input">
              </label>
            </div>
          </div>

          <div class="ppt-design-spec-section">
            <div class="ppt-design-spec-section-title">Visual Preference</div>
            <div class="ppt-design-spec-seg">
              ${segBtn('updateVisualPreferenceMode', 'ai-first', 'AI-first', visualMode === 'ai-first')}
              ${segBtn('updateVisualPreferenceMode', 'svg-first', 'SVG-first', visualMode === 'svg-first')}
              ${segBtn('updateVisualPreferenceMode', 'balanced', 'Balanced', visualMode === 'balanced')}
            </div>

            <div class="ppt-design-spec-row">
              <label>Refiner (ReAct)</label>
              <div class="ppt-design-spec-toggle">
                <button data-action="updateRefineEnabled" data-enabled="false" class="ppt-design-spec-seg-btn ${!refineEnabled ? 'active' : ''}">关闭</button>
                <button data-action="updateRefineEnabled" data-enabled="true" class="ppt-design-spec-seg-btn ${refineEnabled ? 'active' : ''}">启用</button>
              </div>
            </div>
          </div>

          <div class="ppt-design-spec-section">
            <div class="ppt-design-spec-section-title">Density</div>
            <div class="ppt-design-spec-seg">
              ${segBtn('updateDesignSystemDensity', 'compact', 'Compact', density === 'compact')}
              ${segBtn('updateDesignSystemDensity', 'balanced', 'Balanced', density === 'balanced')}
              ${segBtn('updateDesignSystemDensity', 'spacious', 'Spacious', density === 'spacious')}
            </div>

            <div class="ppt-design-spec-section-title" style="margin-top: 14px;">Batch Size</div>
            <div class="ppt-design-spec-seg">
              ${segBtnNum('updateBatchSize', 1, '1', batchSize === 1)}
              ${segBtnNum('updateBatchSize', 2, '2', batchSize === 2)}
              ${segBtnNum('updateBatchSize', 4, '4', batchSize === 4)}
            </div>

            <div class="ppt-design-spec-section-title" style="margin-top: 14px;">Model</div>
            <div class="ppt-design-spec-row">
              <label>模型由「PPT 模型配置」统一管理</label>
              <button class="ppt-btn-secondary" type="button" data-action="openModelConfig">
                <iconify-icon icon="carbon:settings-adjust"></iconify-icon>
                打开模型配置
              </button>
            </div>
          </div>

          <div class="ppt-design-spec-preview" data-density="${escapeAttr(density)}"
            style="--ds-bg:${escapeAttr(bg)}; --ds-text:${escapeAttr(text)}; --ds-primary:${escapeAttr(primary)}; --ds-secondary:${escapeAttr(secondary)}; --ds-accent:${escapeAttr(accent)}; padding:${densityPad}px;">
            <div class="ppt-design-spec-preview-card">
              <div class="ppt-design-spec-preview-title" style="font-family:${escapeAttr(titleFont)}; font-size:${Math.round(fontSize * 1.7)}px;">
                Preview Title
              </div>
              <div class="ppt-design-spec-preview-body" style="font-family:${escapeAttr(bodyFont)}; font-size:${escapeAttr(String(fontSize))}px;">
                这是正文预览。Primary/Accent 用于强调信息与按钮。
              </div>
              <div class="ppt-design-spec-preview-tags">
                <span class="ppt-design-spec-tag primary">Primary</span>
                <span class="ppt-design-spec-tag secondary">Secondary</span>
                <span class="ppt-design-spec-tag accent">Accent</span>
              </div>
            </div>
          </div>
        </div>

        ${this._renderStyleReferenceSection(ds)}
      </div>
    `;
  }

  _renderStyleReferenceSection(ds) {
    const sr = ds.styleReference || { images: [], extracted: null, userNotes: '' };
    const images = sr.images || [];
    const extracted = sr.extracted || {};
    const notes = sr.userNotes || '';

    const hasExtracted = extracted.colorTone || extracted.mood || extracted.layoutStyle || extracted.typography || extracted.effects;

    const imageList = images.map(img => `
      <div class="ppt-style-ref-thumb ${img.status === 'analyzing' ? 'analyzing' : ''}" data-ref-id="${escapeAttr(img.id)}">
        <img src="${escapeAttr(img.thumbnail)}" alt="参考图">
        ${img.status === 'analyzing' ? '<div class="ppt-style-ref-loading"><iconify-icon icon="carbon:loading"></iconify-icon></div>' : ''}
        ${img.status === 'error' ? '<div class="ppt-style-ref-error"><iconify-icon icon="carbon:warning-alt"></iconify-icon></div>' : ''}
        <button class="ppt-style-ref-remove" data-action="removeStyleReference" data-id="${escapeAttr(img.id)}" title="删除">
          <iconify-icon icon="carbon:close"></iconify-icon>
        </button>
      </div>
    `).join('');

    const extractedFields = hasExtracted ? `
      <div class="ppt-style-ref-extracted">
        ${extracted.colorTone ? `<div class="ppt-style-ref-field"><span class="label">色调</span><span class="value">${escapeHtml(extracted.colorTone)}</span></div>` : ''}
        ${extracted.mood ? `<div class="ppt-style-ref-field"><span class="label">氛围</span><span class="value">${escapeHtml(extracted.mood)}</span></div>` : ''}
        ${extracted.layoutStyle ? `<div class="ppt-style-ref-field"><span class="label">布局</span><span class="value">${escapeHtml(extracted.layoutStyle)}</span></div>` : ''}
        ${extracted.typography ? `<div class="ppt-style-ref-field"><span class="label">字体</span><span class="value">${escapeHtml(extracted.typography)}</span></div>` : ''}
        ${extracted.effects ? `<div class="ppt-style-ref-field"><span class="label">效果</span><span class="value">${escapeHtml(extracted.effects)}</span></div>` : ''}
        ${extracted.palette?.length ? `
          <div class="ppt-style-ref-field">
            <span class="label">色板</span>
            <div class="ppt-style-ref-palette">
              ${extracted.palette.map(c => `<div class="ppt-style-ref-swatch" style="background:${escapeAttr(c)}" title="${escapeAttr(c)}"></div>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    ` : '';

    return `
      <div class="ppt-style-ref-section">
        <div class="ppt-style-ref-header">
          <div class="ppt-style-ref-title">
            <iconify-icon icon="carbon:image-reference"></iconify-icon>
            <span>风格参考</span>
          </div>
          <div class="ppt-style-ref-subtitle">上传参考图，AI 自动提取风格（最多 3 张）</div>
        </div>

        <div class="ppt-style-ref-body">
          <div class="ppt-style-ref-upload" id="pptStyleRefDropzone">
            <iconify-icon icon="carbon:cloud-upload"></iconify-icon>
            <span>拖拽图片到此处，或点击上传</span>
            <input type="file" id="pptStyleRefInput" accept="image/*" style="display:none">
          </div>

          ${images.length > 0 ? `
            <div class="ppt-style-ref-thumbs">
              ${imageList}
            </div>
          ` : ''}

          ${extractedFields}

          <div class="ppt-style-ref-notes">
            <label>
              <span>备注（可选）</span>
              <textarea id="pptStyleRefNotes" class="ppt-input-field" rows="2"
                placeholder="例如：参考 Apple 发布会风格"
                data-action="updateStyleReferenceNotes" data-event="change">${escapeHtml(notes)}</textarea>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  _setupSlideIntentDrag() {
    if (typeof this._slideIntentDragCleanup === 'function') {
      try { this._slideIntentDragCleanup(); } catch { /* ignore */ }
    }
    this._slideIntentDragCleanup = null;

    const container = this.$('#pptSlideIntentList');
    if (!container) return;

    let dragging = null;

    const clearIndicators = () => {
      container.querySelectorAll('.drag-above, .drag-below').forEach((el) => {
        el.classList.remove('drag-above', 'drag-below');
      });
    };

    const onDragStart = (e) => {
      const handle = e.target?.closest?.('[draggable="true"]');
      if (!handle) return;
      const item = e.target?.closest?.('.slide-intent-card');
      if (!item) return;
      dragging = item;
      item.classList.add('dragging');
      const sid = item.getAttribute('data-slide-intent-id') || '';
      e.dataTransfer?.setData?.('text/plain', sid);
      e.dataTransfer?.setDragImage?.(item, 12, 12);
    };

    const onDragEnd = () => {
      if (dragging) dragging.classList.remove('dragging');
      dragging = null;
      clearIndicators();
      this._commitSlideIntentOrder();
    };

    const onDragOver = (e) => {
      if (!dragging) return;
      e.preventDefault();

      const target = e.target?.closest?.('.slide-intent-card');
      if (!target || target === dragging) return;

      const rect = target.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      clearIndicators();
      target.classList.add(before ? 'drag-above' : 'drag-below');

      if (before) {
        container.insertBefore(dragging, target);
      } else {
        container.insertBefore(dragging, target.nextSibling);
      }
    };

    const onDrop = (e) => {
      if (!dragging) return;
      e.preventDefault();
      clearIndicators();
    };

    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragend', onDragEnd);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);

    this._slideIntentDragCleanup = () => {
      container.removeEventListener('dragstart', onDragStart);
      container.removeEventListener('dragend', onDragEnd);
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
    };
  }

  _commitSlideIntentOrder() {
    const container = this.$('#pptSlideIntentList');
    if (!container) return;

    const ids = Array.from(container.querySelectorAll('.slide-intent-card'))
      .map((el) => String(el.getAttribute('data-slide-intent-id') || ''))
      .filter(Boolean);
    if (!ids.length) return;

    this._adapter?.commitSlideIntentOrder?.(ids);
  }

  _bindDesignSpecInteractions() {
    const dropzone = this.$('#pptStyleRefDropzone');
    if (!dropzone || dropzone.dataset.bound === '1') return;
    dropzone.dataset.bound = '1';

    const onDragOver = (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    };
    const onDragLeave = () => {
      dropzone.classList.remove('dragover');
    };
    const onDrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      this._handleStyleRefDrop(e);
    };
    const onClick = () => {
      this.$('#pptStyleRefInput')?.click();
    };

    dropzone.addEventListener('dragover', onDragOver);
    dropzone.addEventListener('dragleave', onDragLeave);
    dropzone.addEventListener('drop', onDrop);
    dropzone.addEventListener('click', onClick);

    const input = this.$('#pptStyleRefInput');
    if (input && input.dataset.bound !== '1') {
      input.dataset.bound = '1';
      input.addEventListener('change', (event) => this._handleStyleRefFileSelect(event));
    }

    this._designSpecCleanup = () => {
      dropzone.removeEventListener('dragover', onDragOver);
      dropzone.removeEventListener('dragleave', onDragLeave);
      dropzone.removeEventListener('drop', onDrop);
      dropzone.removeEventListener('click', onClick);
    };
  }

  _handleStyleRefDrop(e) {
    const dt = e.dataTransfer;
    if (!dt?.files?.length) return;
    const file = dt.files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this._adapter?.addStyleReference?.(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  _handleStyleRefFileSelect(e) {
    const file = e.target?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this._adapter?.addStyleReference?.(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  _coerceHexColor(value, fallback) {
    const v = typeof value === 'string' ? value.trim() : '';
    if (/^#([0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
    if (/^#([0-9a-f]{3})$/i.test(v)) {
      const m = v.toLowerCase().slice(1);
      return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`;
    }
    return fallback;
  }

  _onSetPageLayoutTab({ payload }) {
    const tab = Number(payload?.tab);
    if (!Number.isFinite(tab)) return;
    this._pageLayoutTab = Math.max(0, Math.min(2, Math.floor(tab)));
    this._refresh();
  }

  _onBackToScriptReview() {
    this._adapter?.backToScriptReview?.();
  }

  _onPhase5DesignOptimization() {
    this._adapter?.phase5DesignOptimization?.();
  }

  _onAddSlideIntent() {
    const id = this._adapter?.addSlideIntent?.();
    if (id) this._selectedSlideIntentId = String(id);
    this._pageLayoutTab = 0;
    this._refresh();
  }

  _onSelectSlideIntent({ payload }) {
    const id = payload?.id ? String(payload.id) : '';
    if (!id) return;
    this._selectedSlideIntentId = id;
    this._pageLayoutTab = 1;
    this._refresh();
  }

  _onDuplicateSlideIntent({ payload }) {
    const id = payload?.id ? String(payload.id) : '';
    if (!id) return;
    const newId = this._adapter?.duplicateSlideIntent?.(id);
    if (newId) this._selectedSlideIntentId = String(newId);
    this._pageLayoutTab = 0;
    this._refresh();
  }

  _onDeleteSlideIntent({ payload }) {
    const id = payload?.id ? String(payload.id) : '';
    if (!id) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const ok = window.confirm('确认删除该页面？此操作不可撤销。');
      if (!ok) return;
    }
    const nextId = this._adapter?.deleteSlideIntent?.(id) || '';
    this._selectedSlideIntentId = nextId ? String(nextId) : '';
    this._pageLayoutTab = 0;
    this._refresh();
  }

  _onUpdateSlideIntentField({ payload, value }) {
    if (!payload?.field) return;
    this._adapter?.updateSlideIntent?.(payload.id, { [payload.field]: value });
  }

  _onAddSlideIntentKeyPoint({ payload }) {
    const id = payload?.id ? String(payload.id) : '';
    if (!id) return;
    this._adapter?.addSlideIntentKeyPoint?.(id);
    this._refresh();
  }

  _onUpdateSlideIntentKeyPoint({ payload, value }) {
    const id = payload?.id ? String(payload.id) : '';
    const index = Number(payload?.index);
    if (!id || !Number.isFinite(index)) return;
    this._adapter?.updateSlideIntentKeyPoint?.(id, index, value);
  }

  _onRemoveSlideIntentKeyPoint({ payload }) {
    const id = payload?.id ? String(payload.id) : '';
    const index = Number(payload?.index);
    if (!id || !Number.isFinite(index)) return;
    this._adapter?.removeSlideIntentKeyPoint?.(id, index);
    this._refresh();
  }

  _onMergeSlideIntents({ payload }) {
    const from = payload?.from ? String(payload.from) : '';
    const to = payload?.to ? String(payload.to) : '';
    if (!from || !to || from === to) return;
    this._adapter?.mergeSlideIntents?.(to, from);
    this._selectedSlideIntentId = to;
    this._refresh();
  }

  _onSplitSlideIntent({ payload }) {
    const id = payload?.id ? String(payload.id) : '';
    if (!id) return;
    const nextId = this._adapter?.splitSlideIntent?.(id);
    if (nextId) this._selectedSlideIntentId = String(nextId);
    this._refresh();
  }

  _onUpdateDesignSystemColor({ payload, value }) {
    if (!payload?.key) return;
    this._adapter?.updateDesignSystemColor?.(payload.key, value);
  }

  _onUpdateDesignSystemFont({ payload, value }) {
    if (!payload?.key) return;
    this._adapter?.updateDesignSystemFont?.(payload.key, value);
  }

  _onUpdateDesignSystemFontSize({ value }) {
    this._adapter?.updateDesignSystemFontSize?.(value);
  }

  _onUpdateVisualPreferenceMode({ payload }) {
    if (!payload?.mode) return;
    this._adapter?.updateVisualPreferenceMode?.(payload.mode);
  }

  _onUpdateRefineEnabled({ payload }) {
    if (typeof payload?.enabled === 'undefined') return;
    this._adapter?.updateRefineEnabled?.(payload.enabled);
  }

  _onUpdateDesignSystemDensity({ payload }) {
    if (!payload?.mode) return;
    this._adapter?.updateDesignSystemDensity?.(payload.mode);
  }

  _onUpdateBatchSize({ payload }) {
    if (!payload?.size) return;
    this._adapter?.updateBatchSize?.(payload.size);
  }

  _onOpenModelConfig() {
    const modal = typeof window !== 'undefined' ? window.PPTModelConfigModal : null;
    if (modal && typeof modal.openModal === 'function') {
      modal.openModal();
      return;
    }
    console.warn('[DesignSpec] PPTModelConfigModal not available');
  }

  _onRemoveStyleReference({ payload }) {
    if (!payload?.id) return;
    this._adapter?.removeStyleReference?.(payload.id);
  }

  _onUpdateStyleReferenceNotes({ value }) {
    this._adapter?.updateStyleReferenceNotes?.(value);
  }
}

export default PageLayoutView;
