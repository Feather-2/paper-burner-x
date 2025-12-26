/**
 * PPT Generator adapter (bridge UI V2 <-> legacy runtime)
 */

import { getUIEventBus } from '../core/event-bus.js';
import { getStateStore } from '../core/state-store.js';

const DEFAULT_BRIEF = {
  taskGoal: '',
  projectSummary: '',
  audience: '',
  tone: ''
};

const DEFAULT_REPORT_CONFIG = {
  reportLength: 'standard',
  tone: 'business',
  audience: 'general',
  language: 'auto',
  enableReviewer: false
};

const designPrefs = typeof globalThis !== 'undefined' && globalThis.PPTDesignPreferences
  ? globalThis.PPTDesignPreferences
  : null;

const DesignVisualMode = designPrefs?.DesignVisualMode || Object.freeze({
  AI_FIRST: 'ai-first',
  SVG_FIRST: 'svg-first',
  BALANCED: 'balanced'
});

const DesignDensity = designPrefs?.DesignDensity || Object.freeze({
  COMPACT: 'compact',
  BALANCED: 'balanced',
  SPACIOUS: 'spacious'
});

const StyleReferenceStatus = designPrefs?.StyleReferenceStatus || Object.freeze({
  ANALYZING: 'analyzing',
  DONE: 'done',
  ERROR: 'error'
});

const normalizeDesignVisualMode = designPrefs?.normalizeDesignVisualMode || ((value, fallback = DesignVisualMode.BALANCED) => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.values(DesignVisualMode).includes(v) ? v : fallback;
});

const normalizeDesignDensity = designPrefs?.normalizeDesignDensity || ((value, fallback = DesignDensity.BALANCED) => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.values(DesignDensity).includes(v) ? v : fallback;
});

const isValidDesignVisualMode = designPrefs?.isValidDesignVisualMode || ((value) => Object.values(DesignVisualMode).includes(value));
const isValidDesignDensity = designPrefs?.isValidDesignDensity || ((value) => Object.values(DesignDensity).includes(value));

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBrief(value) {
  const brief = value && typeof value === 'object' ? value : {};
  return {
    taskGoal: normalizeText(brief.taskGoal),
    projectSummary: normalizeText(brief.projectSummary),
    audience: normalizeText(brief.audience),
    tone: normalizeText(brief.tone)
  };
}

function normalizeReportConfig(value) {
  const cfg = value && typeof value === 'object' ? value : {};
  return {
    reportLength: typeof cfg.reportLength === 'string' ? cfg.reportLength : DEFAULT_REPORT_CONFIG.reportLength,
    tone: typeof cfg.tone === 'string' ? cfg.tone : DEFAULT_REPORT_CONFIG.tone,
    audience: typeof cfg.audience === 'string' ? cfg.audience : DEFAULT_REPORT_CONFIG.audience,
    language: typeof cfg.language === 'string' ? cfg.language : DEFAULT_REPORT_CONFIG.language,
    enableReviewer: typeof cfg.enableReviewer === 'boolean'
      ? cfg.enableReviewer
      : DEFAULT_REPORT_CONFIG.enableReviewer
  };
}

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(value) / Math.log(k));
  return `${parseFloat((value / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function safeClone(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(item => safeClone(item));
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return { ...value };
    }
  }
  return value;
}

function normalizeRunLogs(raw) {
  const logs = Array.isArray(raw) ? raw : [];
  return logs
    .filter((e) => e && typeof e === 'object' && typeof e.message === 'string' && e.message)
    .slice(-200)
    .map((e) => ({
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
      scope: typeof e.scope === 'string' ? e.scope : 'event',
      level: typeof e.level === 'string' ? e.level : 'info',
      message: e.message,
      stage: typeof e.stage === 'string' ? e.stage : null,
      iteration: typeof e.iteration === 'number' ? e.iteration : null,
      eventName: typeof e.eventName === 'string' ? e.eventName : null,
      details: e.details && typeof e.details === 'object' ? safeClone(e.details) : null
    }));
}

function ensureWorkflowData(generator) {
  if (!generator.workflowData) generator.workflowData = {};
  return generator.workflowData;
}

export class PptGeneratorAdapter {
  constructor({ generator, eventBus, stateStore } = {}) {
    this.generator = generator || (typeof window !== 'undefined' ? window.PPTGenerator : null);
    this.eventBus = eventBus || getUIEventBus();
    this.stateStore = stateStore || getStateStore();
  }

  setGenerator(generator) {
    this.generator = generator;
    return this;
  }

  syncFromGenerator() {
    const generator = this._ensureGenerator();
    if (!generator) return;

    const data = ensureWorkflowData(generator);
    const fallbackBrief = {
      taskGoal: data.taskGoal,
      projectSummary: data.projectSummary,
      audience: data.audience,
      tone: data.tone
    };
    const brief = normalizeBrief(data.projectBrief || generator.projectBrief || fallbackBrief || DEFAULT_BRIEF);
    const reportConfig = normalizeReportConfig(data.reportConfig);
    const files = Array.isArray(data.files) ? data.files : [];
    const generationMode = typeof data.generationMode === 'string' && data.generationMode
      ? data.generationMode
      : 'deepsearch';
    const workflowMode = typeof generator.workflowMode === 'string' && generator.workflowMode
      ? generator.workflowMode
      : (typeof data.workflowMode === 'string' ? data.workflowMode : 'auto');
    const runLogs = normalizeRunLogs(data.runLogs);

    this.stateStore.update({
      'data.files': [...files],
      'data.generationMode': generationMode,
      'data.workflowMode': workflowMode,
      'data.runLogs': runLogs,
      'data.reportConfig': reportConfig,
      'data.projectBrief': brief,
      'data.taskGoal': brief.taskGoal,
      'data.questions': safeClone(data.questions || []),
      'data.userAnswers': safeClone(data.userAnswers || {}),
      'data.reportMarkdown': typeof data.reportMarkdown === 'string'
        ? data.reportMarkdown
        : (typeof data.report?.markdown === 'string' ? data.report.markdown : ''),
      'data.report': safeClone(data.report || null),
      'data.outline': safeClone(data.outline || []),
      'data.plannedOutline': safeClone(data.plannedOutline || null),
      'data.contentPackage': safeClone(data.contentPackage || null),
      'data.slideIntents': safeClone(data.slideIntents || data.contentPackage?.slideIntents || []),
      'data.slideStatuses': safeClone(data.slideStatuses || null),
      'data.designPhase': safeClone(data.designPhase || null),
      'data.designSystem': safeClone(data.designSystem || null),
      'data.batchSize': Number.isFinite(Number(data.batchSize)) ? Number(data.batchSize) : 4
    });
  }

  setGenerationMode(mode) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const data = ensureWorkflowData(generator);
    data.generationMode = mode;
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.generationMode = mode;
    }
    generator.setAutoSaveNeeded?.();
    this.syncFromGenerator();
  }

  setWorkflowMode(mode) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const allowed = new Set(['auto', 'guided', 'manual']);
    const next = allowed.has(mode) ? mode : 'auto';
    generator.workflowMode = next;

    const data = ensureWorkflowData(generator);
    data.workflowMode = next;
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.workflowMode = next;
    }
    generator.setAutoSaveNeeded?.();
    this.syncFromGenerator();
  }

  setUploadStep(step) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const next = step === 2 ? 2 : 1;
    generator._uploadStep = next;
  }

  setProjectBrief(brief) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const normalized = normalizeBrief(brief);
    generator.projectBrief = { ...normalized };

    const data = ensureWorkflowData(generator);
    data.projectBrief = { ...normalized };
    if (normalized.projectSummary) data.projectSummary = normalized.projectSummary;
    if (normalized.taskGoal) data.taskGoal = normalized.taskGoal;
    if (normalized.audience) data.audience = normalized.audience;
    if (normalized.tone) data.tone = normalized.tone;

    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.projectBrief = { ...normalized };
      if (normalized.projectSummary) generator.currentProject.workflowData.projectSummary = normalized.projectSummary;
      if (normalized.taskGoal) generator.currentProject.workflowData.taskGoal = normalized.taskGoal;
      if (normalized.audience) generator.currentProject.workflowData.audience = normalized.audience;
      if (normalized.tone) generator.currentProject.workflowData.tone = normalized.tone;
    }

    generator.setAutoSaveNeeded?.();
    this.syncFromGenerator();
  }

  updateReportLength(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator.updateReportLength === 'function') {
      generator.updateReportLength(value);
    } else {
      this._patchReportConfig({ reportLength: value });
    }
    this.syncFromGenerator();
  }

  updateWriteTone(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator.updateWriteTone === 'function') {
      generator.updateWriteTone(value);
    } else {
      this._patchReportConfig({ tone: value });
    }
    this.syncFromGenerator();
  }

  updateWriteAudience(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator.updateWriteAudience === 'function') {
      generator.updateWriteAudience(value);
    } else {
      this._patchReportConfig({ audience: value });
    }
    this.syncFromGenerator();
  }

  updateWriteLanguage(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator.updateWriteLanguage === 'function') {
      generator.updateWriteLanguage(value);
    } else {
      this._patchReportConfig({ language: value });
    }
    this.syncFromGenerator();
  }

  updateReportMarkdown(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const text = typeof value === 'string' ? value : String(value ?? '');
    if (typeof generator.updateReportMarkdown === 'function') {
      generator.updateReportMarkdown(text);
    } else {
      const data = ensureWorkflowData(generator);
      data.reportMarkdown = text;
      if (data.contentPackage?.report) {
        data.contentPackage.report = { ...(data.contentPackage.report || {}), markdown: text };
      }
    }
    this.stateStore.set('data.reportMarkdown', text);
    generator.setAutoSaveNeeded?.();
  }

  renderDeepSearchPremiumUI() {
    const generator = this._ensureGenerator();
    if (typeof generator?._renderDeepSearchPremiumUI === 'function') {
      return generator._renderDeepSearchPremiumUI();
    }
    return '<div class="ds-research-stage"><div style="padding:16px; color: var(--ppt-text-secondary);">DeepSearch UI not available.</div></div>';
  }

  mountActiveFlowVisualizers() {
    const generator = this._ensureGenerator();
    if (typeof generator?._mountActiveFlowVisualizers === 'function') {
      generator._mountActiveFlowVisualizers();
    }
  }

  updateCompressionPanel() {
    const generator = this._ensureGenerator();
    if (typeof generator?._updateCompressionPanel === 'function') {
      generator._updateCompressionPanel(generator.workflowData?.runtimeCompression);
    }
  }

  destroyFlowViz(kind) {
    const generator = this._ensureGenerator();
    if (typeof generator?._destroyFlowViz === 'function') {
      generator._destroyFlowViz(kind);
    }
  }

  handleFileUpload(fileList) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const files = Array.from(fileList || []).map((f) => ({
      name: f.name,
      size: formatSize(f.size),
      rawSize: f.size,
      mimeType: f.type,
      type: 'file',
      file: f
    }));
    if (files.length === 0) return;

    const data = ensureWorkflowData(generator);
    const existing = Array.isArray(data.files) ? data.files : [];
    data.files = [...existing, ...files];
    generator.setAutoSaveNeeded?.();
    this.syncFromGenerator();
  }

  removeFile(index) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const data = ensureWorkflowData(generator);
    const files = Array.isArray(data.files) ? data.files : [];
    if (index < 0 || index >= files.length) return;
    files.splice(index, 1);
    data.files = files;
    generator.setAutoSaveNeeded?.();
    this.syncFromGenerator();
  }

  openHistorySelector() {
    const generator = this._ensureGenerator();
    if (typeof generator?.openHistorySelector === 'function') {
      generator.openHistorySelector();
      return;
    }
    this.eventBus.emit('ui.action', { type: 'openHistorySelector' });
  }

  openProjectBriefForm() {
    const generator = this._ensureGenerator();
    if (typeof generator?.openProjectBriefForm === 'function') {
      generator.openProjectBriefForm();
      return;
    }
    this.eventBus.emit('ui.action', { type: 'openProjectBriefForm' });
  }

  cancelProjectBrief() {
    const generator = this._ensureGenerator();
    if (typeof generator?.cancelProjectBrief === 'function') {
      generator.cancelProjectBrief();
      return;
    }
    this.eventBus.emit('ui.action', { type: 'cancelProjectBrief' });
  }

  openUrlInput() {
    const generator = this._ensureGenerator();
    if (typeof generator?.openUrlInput === 'function') {
      generator.openUrlInput();
      return;
    }
    this.eventBus.emit('ui.action', { type: 'openUrlInput' });
  }

  openPasteDocumentModal() {
    const generator = this._ensureGenerator();
    if (typeof generator?.openPasteDocumentModal === 'function') {
      generator.openPasteDocumentModal();
      return;
    }
    this.eventBus.emit('ui.action', { type: 'openPasteDocumentModal' });
  }

  startFromPastedText(content, options) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator.startFromPastedText === 'function') {
      return generator.startFromPastedText(content, options);
    }
    this.eventBus.emit('ui.action', { type: 'startFromPastedText', content, options });
  }

  importPptxAsDeckFromPicker() {
    const generator = this._ensureGenerator();
    if (typeof generator?.importPptxAsDeckFromPicker === 'function') {
      generator.importPptxAsDeckFromPicker();
      return;
    }
    this.eventBus.emit('ui.action', { type: 'importPptxAsDeckFromPicker' });
  }

  startWorkflow(options) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.startMultiAgentWorkflow?.(options);
  }

  executePlannedGeneration(sections) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator._executePlannedGeneration === 'function') {
      return generator._executePlannedGeneration(sections);
    }
    if (typeof generator._startPlannedBatchGeneration === 'function') {
      return generator._startPlannedBatchGeneration(sections);
    }
    if (typeof generator.startPlannedBatchGeneration === 'function') {
      return generator.startPlannedBatchGeneration(sections);
    }
    this.eventBus.emit('ui.action', { type: 'executePlannedGeneration', sections });
  }

  confirmScript() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.confirmScript?.();
  }

  confirmOutline() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.confirmOutline?.();
  }

  regenerateOutline() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.regenerateOutline?.();
  }

  setOutline(outline) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const data = ensureWorkflowData(generator);
    data.outline = Array.isArray(outline) ? outline : [];
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  addOutlineItem() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const data = ensureWorkflowData(generator);
    if (!Array.isArray(data.outline)) data.outline = [];
    data.outline.push({ title: '新章节', subs: ['新子项'] });
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  removeOutlineItem(index) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const i = Number(index);
    if (!Number.isFinite(i)) return;
    const data = ensureWorkflowData(generator);
    if (!Array.isArray(data.outline) || !data.outline[i]) return;
    data.outline.splice(i, 1);
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  updateOutlineTitle(index, value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const i = Number(index);
    if (!Number.isFinite(i)) return;
    const data = ensureWorkflowData(generator);
    if (!Array.isArray(data.outline) || !data.outline[i]) return;
    data.outline[i].title = typeof value === 'string' ? value : String(value ?? '');
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  updateOutlineSub(parentIndex, subIndex, value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const i = Number(parentIndex);
    const j = Number(subIndex);
    if (!Number.isFinite(i) || !Number.isFinite(j)) return;
    const data = ensureWorkflowData(generator);
    if (!Array.isArray(data.outline) || !data.outline[i]) return;
    if (!Array.isArray(data.outline[i].subs)) data.outline[i].subs = [];
    if (j < 0 || j >= data.outline[i].subs.length) return;
    data.outline[i].subs[j] = typeof value === 'string' ? value : String(value ?? '');
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  addOutlineSub(parentIndex) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const i = Number(parentIndex);
    if (!Number.isFinite(i)) return;
    const data = ensureWorkflowData(generator);
    if (!Array.isArray(data.outline) || !data.outline[i]) return;
    if (!Array.isArray(data.outline[i].subs)) data.outline[i].subs = [];
    data.outline[i].subs.push('新子项');
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  removeOutlineSub(parentIndex, subIndex) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const i = Number(parentIndex);
    const j = Number(subIndex);
    if (!Number.isFinite(i) || !Number.isFinite(j)) return;
    const data = ensureWorkflowData(generator);
    if (!Array.isArray(data.outline) || !data.outline[i]) return;
    if (!Array.isArray(data.outline[i].subs)) data.outline[i].subs = [];
    if (j < 0 || j >= data.outline[i].subs.length) return;
    data.outline[i].subs.splice(j, 1);
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.outline = data.outline;
    }
    this.stateStore.set('data.outline', safeClone(data.outline));
    generator.setAutoSaveNeeded?.();
  }

  backToScriptReview() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const target = typeof window !== 'undefined' && window.WorkflowState?.SCRIPT_REVIEW
      ? window.WorkflowState.SCRIPT_REVIEW
      : 'script_review';
    if (typeof generator._forceWorkflowStateSafe === 'function') {
      generator._forceWorkflowStateSafe(target);
    } else if (typeof window !== 'undefined' && typeof window.forceWorkflowState === 'function') {
      window.forceWorkflowState(generator, target);
    } else {
      generator.state = target;
    }
    generator.renderPreviewArea?.();
  }

  phase5DesignOptimization() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.phase5_DesignOptimization?.();
  }

  addSlideIntent(position) {
    const generator = this._ensureGenerator();
    if (!generator) return '';
    const pkg = this._ensureContentPackage(generator);
    const insertIndex = Number.isFinite(Number(position)) ? Number(position) : pkg.slideIntents.length;
    let ok = false;
    if (typeof generator._insertSlideIntentAt === 'function') {
      ok = generator._insertSlideIntentAt(pkg, insertIndex);
    } else {
      const newIntent = {
        slideIntentId: `si_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        pageType: 'content',
        title: '新页面',
        objective: '',
        keyPoints: [],
        claimIds: [],
        dataTableIds: [],
        content: '',
        index: insertIndex
      };
      pkg.slideIntents.splice(Math.max(0, Math.min(pkg.slideIntents.length, insertIndex)), 0, newIntent);
      pkg.slideIntents.forEach((si, i) => {
        if (si && typeof si === 'object') si.index = i;
      });
      ok = true;
    }
    if (!ok) return '';
    const nextIndex = Math.max(0, Math.min(pkg.slideIntents.length - 1, insertIndex));
    const selected = pkg.slideIntents[nextIndex];
    this._syncContentPackage(generator, pkg);
    return selected?.slideIntentId || '';
  }

  deleteSlideIntent(slideIntentId) {
    const generator = this._ensureGenerator();
    if (!generator) return '';
    const id = String(slideIntentId || '');
    if (!id) return '';
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
    if (idx < 0) return '';
    slides.splice(idx, 1);
    slides.forEach((s, i) => {
      if (s && typeof s === 'object') s.index = i;
    });
    const next = slides[idx] || slides[idx - 1] || null;
    this._syncContentPackage(generator, pkg);
    return next?.slideIntentId || '';
  }

  duplicateSlideIntent(slideIntentId) {
    const generator = this._ensureGenerator();
    if (!generator) return '';
    const id = String(slideIntentId || '');
    if (!id) return '';
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
    if (idx < 0) return '';
    const src = slides[idx] && typeof slides[idx] === 'object' ? slides[idx] : null;
    if (!src) return '';
    let clone = null;
    try {
      clone = JSON.parse(JSON.stringify(src));
    } catch {
      clone = { ...src };
    }
    clone.slideIntentId = `si_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    clone.title = `${String(src.title || '新页面')}（副本）`;
    slides.splice(idx + 1, 0, clone);
    slides.forEach((s, i) => {
      if (s && typeof s === 'object') s.index = i;
    });
    this._syncContentPackage(generator, pkg);
    return clone.slideIntentId || '';
  }

  updateSlideIntent(slideIntentId, patch) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const id = String(slideIntentId || '');
    if (!id || !patch || typeof patch !== 'object') return;
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const si = slides.find((s) => String(s?.slideIntentId || '') === id);
    if (!si || typeof si !== 'object') return;

    const allowed = new Set(['title', 'pageType', 'objective', 'keyPoints', 'claimIds', 'dataTableIds', 'content']);
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) continue;
      if (k === 'keyPoints') {
        si.keyPoints = Array.isArray(v) ? v : si.keyPoints;
      } else if (k === 'claimIds') {
        si.claimIds = Array.isArray(v) ? v : si.claimIds;
      } else if (k === 'dataTableIds') {
        si.dataTableIds = Array.isArray(v) ? v : si.dataTableIds;
      } else if (k === 'title') {
        si.title = typeof v === 'string' ? v : String(v ?? '');
      } else if (k === 'pageType') {
        si.pageType = typeof v === 'string' ? v : String(v ?? '');
      } else if (k === 'objective') {
        si.objective = typeof v === 'string' ? v : String(v ?? '');
      } else if (k === 'content') {
        si.content = typeof v === 'string' ? v : String(v ?? '');
      }
    }
    generator.setAutoSaveNeeded?.();
  }

  updateSlideIntentKeyPoint(slideIntentId, index, value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const id = String(slideIntentId || '');
    const i = Number(index);
    if (!id || !Number.isFinite(i)) return;
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const si = slides.find((s) => String(s?.slideIntentId || '') === id);
    if (!si || typeof si !== 'object') return;
    if (!Array.isArray(si.keyPoints)) si.keyPoints = [];
    if (i < 0 || i >= si.keyPoints.length) return;
    si.keyPoints[i] = typeof value === 'string' ? value : String(value ?? '');
    generator.setAutoSaveNeeded?.();
  }

  addSlideIntentKeyPoint(slideIntentId) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const id = String(slideIntentId || '');
    if (!id) return;
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const si = slides.find((s) => String(s?.slideIntentId || '') === id);
    if (!si || typeof si !== 'object') return;
    if (!Array.isArray(si.keyPoints)) si.keyPoints = [];
    si.keyPoints.push('');
    this._syncContentPackage(generator, pkg);
  }

  removeSlideIntentKeyPoint(slideIntentId, index) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const id = String(slideIntentId || '');
    const i = Number(index);
    if (!id || !Number.isFinite(i)) return;
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const si = slides.find((s) => String(s?.slideIntentId || '') === id);
    if (!si || typeof si !== 'object') return;
    if (!Array.isArray(si.keyPoints)) si.keyPoints = [];
    if (i < 0 || i >= si.keyPoints.length) return;
    si.keyPoints.splice(i, 1);
    this._syncContentPackage(generator, pkg);
  }

  mergeSlideIntents(targetId, sourceId) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const tid = String(targetId || '');
    const sid = String(sourceId || '');
    if (!tid || !sid || tid === sid) return;
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const tIdx = slides.findIndex((s) => String(s?.slideIntentId || '') === tid);
    const sIdx = slides.findIndex((s) => String(s?.slideIntentId || '') === sid);
    if (tIdx < 0 || sIdx < 0) return;
    const target = slides[tIdx];
    const source = slides[sIdx];
    if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return;

    const mergeUnique = (a, b) => {
      const out = [];
      const seen = new Set();
      const push = (x) => {
        const v = String(x || '').trim();
        if (!v || seen.has(v)) return;
        seen.add(v);
        out.push(v);
      };
      (Array.isArray(a) ? a : []).forEach(push);
      (Array.isArray(b) ? b : []).forEach(push);
      return out;
    };

    const objA = String(target.objective || '').trim();
    const objB = String(source.objective || '').trim();
    if (!objA && objB) target.objective = objB;
    else if (objA && objB && objA !== objB) target.objective = `${objA}\n${objB}`;

    target.keyPoints = mergeUnique(target.keyPoints, source.keyPoints);
    target.claimIds = mergeUnique(target.claimIds, source.claimIds);
    target.dataTableIds = mergeUnique(target.dataTableIds, source.dataTableIds);

    slides.splice(sIdx, 1);
    slides.forEach((s, i) => {
      if (s && typeof s === 'object') s.index = i;
    });
    this._syncContentPackage(generator, pkg);
  }

  splitSlideIntent(slideIntentId) {
    const generator = this._ensureGenerator();
    if (!generator) return '';
    const id = String(slideIntentId || '');
    if (!id) return '';
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
    if (idx < 0) return '';
    const src = slides[idx];
    const keyPoints = Array.isArray(src?.keyPoints) ? src.keyPoints.filter((k) => String(k || '').trim()) : [];
    if (keyPoints.length < 2) {
      generator.addChatMessage?.('ai', '当前页面要点不足以拆分（至少需要 2 条 KeyPoints）。');
      return '';
    }

    const baseTitle = String(src?.title || '页面').trim() || '页面';
    const makeClone = (kp, i) => ({
      ...src,
      slideIntentId: `si_${Date.now()}_${i}_${Math.random().toString(16).slice(2)}`,
      title: `${baseTitle}（${i + 1}）`,
      objective: typeof src?.objective === 'string' ? src.objective : String(src?.objective ?? ''),
      keyPoints: [String(kp)],
      claimIds: Array.isArray(src?.claimIds) ? [...src.claimIds] : [],
      dataTableIds: Array.isArray(src?.dataTableIds) ? [...src.dataTableIds] : [],
    });

    const parts = keyPoints.map(makeClone);
    slides.splice(idx, 1, ...parts);
    slides.forEach((s, i) => {
      if (s && typeof s === 'object') s.index = i;
    });
    this._syncContentPackage(generator, pkg);
    return parts[0]?.slideIntentId || '';
  }

  commitSlideIntentOrder(ids) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (!Array.isArray(ids) || !ids.length) return;
    const pkg = this._ensureContentPackage(generator);
    const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
    if (slides.length <= 1) return;

    const map = new Map(slides.map((s) => [String(s?.slideIntentId || ''), s]));
    const next = [];
    ids.forEach((id) => {
      const si = map.get(String(id || ''));
      if (!si) return;
      next.push(si);
      map.delete(String(id || ''));
    });
    for (const si of map.values()) next.push(si);

    pkg.slideIntents = next;
    next.forEach((s, i) => {
      if (s && typeof s === 'object') s.index = i;
    });
    this._syncContentPackage(generator, pkg);
  }

  getDesignSystem() {
    const generator = this._ensureGenerator();
    if (!generator) return null;
    const ds = this._ensureDesignSpecInitialized(generator);
    if (ds) this.stateStore.set('data.designSystem', safeClone(ds));
    return ds;
  }

  updateDesignSystemColor(key, value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    const k = String(key || '').trim();
    if (!k) return;
    const colors = ds.designSystemOverrides?.colors || ds.colors || {};
    const prev = this._coerceHexColor(colors?.[k], '#000000');
    const next = this._coerceHexColor(value, prev);
    if (ds.designSystemOverrides?.colors) ds.designSystemOverrides.colors[k] = next;
    ds.colors[k] = next;
    this._syncDesignSystemState(generator, ds);
  }

  updateDesignSystemFont(key, value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    const k = String(key || '').trim();
    if (!k) return;
    const typography = ds.designSystemOverrides?.typography || ds.fonts || {};
    const next = typeof value === 'string' ? value : String(value ?? '');
    if (ds.designSystemOverrides?.typography) ds.designSystemOverrides.typography[k] = next;
    typography[k] = next;
    ds.fonts[k] = next;
    this._syncDesignSystemState(generator, ds);
  }

  updateDesignSystemFontSize(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const next = Math.max(10, Math.min(60, Math.round(n)));
    if (ds.designSystemOverrides?.typography) ds.designSystemOverrides.typography.fontSize = next;
    ds.fonts.fontSize = next;
    this._syncDesignSystemState(generator, ds);
  }

  updateVisualPreferenceMode(mode) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    const v = String(mode || '').trim();
    if (!isValidDesignVisualMode(v)) return;
    if (ds.designSystemOverrides?.visualPreference) ds.designSystemOverrides.visualPreference.mode = v;
    if (ds.visualPreference) ds.visualPreference.mode = v;
    this._syncDesignSystemState(generator, ds);
  }

  updateRefineEnabled(enabled) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    ds.refine = ds.refine || {};
    ds.refine.enabled = !!enabled;
    this._syncDesignSystemState(generator, ds);
  }

  updateDesignSystemDensity(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    const v = String(value || '').trim();
    if (!isValidDesignDensity(v)) return;
    ds.density = v;
    this._syncDesignSystemState(generator, ds);
  }

  updateBatchSize(value) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const n = Number(value);
    if (![1, 2, 4].includes(n)) return;
    const data = ensureWorkflowData(generator);
    data.batchSize = n;
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.batchSize = n;
    }
    this.stateStore.set('data.batchSize', n);
    generator.setAutoSaveNeeded?.();
  }

  async addStyleReference(imageData) {
    const generator = this._ensureGenerator();
    if (!generator) return { ok: false, error: 'no_generator' };
    const ds = this._ensureDesignSpecInitialized(generator);
    if (!ds.styleReference.images) ds.styleReference.images = [];
    if (ds.styleReference.images.length >= 3) {
      console.warn('Maximum 3 style reference images allowed');
      return { ok: false, error: 'max_images' };
    }

    const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const imageEntry = { id, thumbnail: imageData, original: imageData, status: StyleReferenceStatus.ANALYZING };
    ds.styleReference.images.push(imageEntry);
    this._syncDesignSystemState(generator, ds);

    try {
      const { analyzeImage } = await import('../../vision/layout-from-image.js');
      const context = {
        intentHint: 'style_reference',
        modelRouter: typeof window !== 'undefined' ? (window.modelRouter || generator._modelRouter) : generator._modelRouter,
        visionApi: typeof window !== 'undefined' ? (window.visionApi || generator._visionApi) : generator._visionApi
      };
      const result = await analyzeImage(imageData, context);

      const prev = ds.styleReference.extracted || {};
      ds.styleReference.extracted = {
        colorTone: result.styleDescription?.colorTone || prev.colorTone || '',
        mood: result.styleDescription?.mood || prev.mood || '',
        layoutStyle: result.styleDescription?.layoutStyle || prev.layoutStyle || '',
        typography: result.styleDescription?.typography || prev.typography || '',
        effects: result.styleDescription?.effects || prev.effects || '',
        palette: [...(prev.palette || []), ...(result.extractedPalette || [])].slice(0, 10)
      };

      const entry = ds.styleReference.images.find(e => e.id === id);
      if (entry) entry.status = StyleReferenceStatus.DONE;

      this._syncDesignSystemState(generator, ds);
      return { ok: true, id, extracted: ds.styleReference.extracted };
    } catch (err) {
      console.error('Style extraction failed:', err);
      const entry = ds.styleReference.images.find(e => e.id === id);
      if (entry) entry.status = StyleReferenceStatus.ERROR;
      this._syncDesignSystemState(generator, ds);
      return { ok: false, error: err?.message || String(err || 'unknown') };
    }
  }

  removeStyleReference(id) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    if (!ds.styleReference.images) return;
    const idx = ds.styleReference.images.findIndex(e => e.id === id);
    if (idx >= 0) {
      ds.styleReference.images.splice(idx, 1);
      if (ds.styleReference.images.length === 0) {
        ds.styleReference.extracted = null;
      }
      this._syncDesignSystemState(generator, ds);
    }
  }

  updateStyleReferenceNotes(notes) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const ds = this._ensureDesignSpecInitialized(generator);
    ds.styleReference.userNotes = String(notes || '');
    this._syncDesignSystemState(generator, ds);
  }

  showProjectList() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    if (typeof generator.showProjectList === 'function') {
      generator.showProjectList();
    }
  }

  resetToIdle() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const target = typeof window !== 'undefined' && window.WorkflowState?.IDLE
      ? window.WorkflowState.IDLE
      : 'idle';
    if (typeof generator._forceWorkflowStateSafe === 'function') {
      generator._forceWorkflowStateSafe(target);
    } else if (typeof window !== 'undefined' && typeof window.forceWorkflowState === 'function') {
      window.forceWorkflowState(generator, target);
    } else {
      generator.state = target;
    }
    generator.renderPreviewArea?.();
  }

  _ensureContentPackage(generator) {
    const data = ensureWorkflowData(generator);
    if (!data.contentPackage || typeof data.contentPackage !== 'object') {
      data.contentPackage = {
        slideIntents: Array.isArray(data.slideIntents) ? data.slideIntents : [],
        claims: []
      };
    }
    if (!Array.isArray(data.contentPackage.slideIntents)) {
      data.contentPackage.slideIntents = Array.isArray(data.slideIntents) ? data.slideIntents : [];
    }
    try { generator._ensureSlideIntentIds?.(data.contentPackage); } catch { /* ignore */ }
    data.slideIntents = data.contentPackage.slideIntents;
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.contentPackage = data.contentPackage;
      generator.currentProject.workflowData.slideIntents = data.slideIntents;
    }
    return data.contentPackage;
  }

  _syncContentPackage(generator, pkg) {
    const data = ensureWorkflowData(generator);
    data.contentPackage = pkg;
    data.slideIntents = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents : [];
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.contentPackage = data.contentPackage;
      generator.currentProject.workflowData.slideIntents = data.slideIntents;
    }
    this.stateStore.update({
      'data.contentPackage': safeClone(data.contentPackage),
      'data.slideIntents': safeClone(data.slideIntents)
    });
    generator.setAutoSaveNeeded?.();
  }

  _ensureDesignSpecInitialized(generator) {
    const data = ensureWorkflowData(generator);
    if (!data.designSystem || typeof data.designSystem !== 'object') {
      data.designSystem = {};
    }

    const ds = data.designSystem;

    const legacyColors = ds.colors && typeof ds.colors === 'object' ? ds.colors : null;
    const legacyFonts = ds.fonts && typeof ds.fonts === 'object' ? ds.fonts : null;
    const legacyVisualPref = ds.visualPreference && typeof ds.visualPreference === 'object' ? ds.visualPreference : null;

    if (!ds.designPreferences || typeof ds.designPreferences !== 'object') ds.designPreferences = {};
    const prefs = ds.designPreferences;
    if (!Array.isArray(prefs.styleKeywords)) prefs.styleKeywords = [];
    if (typeof prefs.referenceImageSummary !== 'string') prefs.referenceImageSummary = '';
    if (typeof prefs.industry !== 'string') prefs.industry = '';
    if (typeof prefs.tone !== 'string') prefs.tone = '';

    if (!ds.designSystemOverrides || typeof ds.designSystemOverrides !== 'object') ds.designSystemOverrides = {};
    const overrides = ds.designSystemOverrides;

    if (!overrides.colors || typeof overrides.colors !== 'object') overrides.colors = {};
    if (legacyColors) {
      for (const [k, v] of Object.entries(legacyColors)) {
        if (typeof overrides.colors[k] !== 'string' && typeof v === 'string') overrides.colors[k] = v;
      }
    }
    if (typeof overrides.colors.primary !== 'string') overrides.colors.primary = '#0ea5e9';
    if (typeof overrides.colors.secondary !== 'string') overrides.colors.secondary = '#7c3aed';
    if (typeof overrides.colors.bg !== 'string') overrides.colors.bg = '#ffffff';
    if (typeof overrides.colors.text !== 'string') overrides.colors.text = '#0f172a';
    if (typeof overrides.colors.accent !== 'string') overrides.colors.accent = '#22c55e';

    if (!overrides.typography || typeof overrides.typography !== 'object') overrides.typography = {};
    if (legacyFonts) {
      for (const [k, v] of Object.entries(legacyFonts)) {
        if (typeof overrides.typography[k] === 'undefined') overrides.typography[k] = v;
      }
    }
    if (typeof overrides.typography.titleFont !== 'string') overrides.typography.titleFont = 'Inter';
    if (typeof overrides.typography.bodyFont !== 'string') overrides.typography.bodyFont = 'Inter';
    if (typeof overrides.typography.fontSize !== 'number') overrides.typography.fontSize = 16;

    if (!overrides.spacing || typeof overrides.spacing !== 'object') overrides.spacing = {};
    if (!overrides.effects || typeof overrides.effects !== 'object') overrides.effects = {};

    if (!overrides.visualPreference || typeof overrides.visualPreference !== 'object') overrides.visualPreference = {};
    if (legacyVisualPref && typeof overrides.visualPreference.mode !== 'string' && typeof legacyVisualPref.mode === 'string') {
      overrides.visualPreference.mode = legacyVisualPref.mode;
    }
    overrides.visualPreference.mode = normalizeDesignVisualMode(overrides.visualPreference.mode, DesignVisualMode.BALANCED);

    ds.colors = overrides.colors;
    ds.fonts = overrides.typography;
    ds.visualPreference = overrides.visualPreference;

    ds.density = normalizeDesignDensity(ds.density, DesignDensity.BALANCED);

    // Model selection moved to PPT model config; remove legacy per-project setting.
    if (Object.prototype.hasOwnProperty.call(ds, 'model')) delete ds.model;

    if (!ds.refine || typeof ds.refine !== 'object') ds.refine = {};
    if (typeof ds.refine.enabled !== 'boolean') ds.refine.enabled = false;
    if (!Number.isFinite(ds.refine.recommendedSteps) || ds.refine.recommendedSteps <= 0) ds.refine.recommendedSteps = 5;
    if (!Number.isFinite(ds.refine.hardLimit) || ds.refine.hardLimit <= 0) ds.refine.hardLimit = 15;

    if (!ds.styleReference || typeof ds.styleReference !== 'object') {
      ds.styleReference = {
        images: [],
        extracted: null,
        userNotes: ''
      };
    }

    const allowedBatch = new Set([1, 2, 4]);
    const batchSize = Number(data.batchSize);
    if (!allowedBatch.has(batchSize)) data.batchSize = 4;

    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.designSystem = ds;
      generator.currentProject.workflowData.batchSize = data.batchSize;
    }

    return ds;
  }

  _syncDesignSystemState(generator, ds) {
    if (generator.currentProject?.workflowData) {
      generator.currentProject.workflowData.designSystem = ds;
      if (generator.workflowData?.batchSize) {
        generator.currentProject.workflowData.batchSize = generator.workflowData.batchSize;
      }
    }
    this.stateStore.set('data.designSystem', safeClone(ds));
    if (Number.isFinite(generator.workflowData?.batchSize)) {
      this.stateStore.set('data.batchSize', generator.workflowData.batchSize);
    }
    generator.setAutoSaveNeeded?.();
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

  continueDeepSearchIteration() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.continueDeepSearchIteration?.();
  }

  proceedToScriptReview() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.proceedToScriptReview?.();
  }

  autoFillAnswers() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.autoFillAnswers?.();
  }

  submitAnswers() {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.submitAnswers?.();
  }

  askAssistantAboutQuestion(index) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    generator.askAssistantAboutQuestion?.(index);
  }

  getWorkflowState() {
    const generator = this._ensureGenerator();
    return generator?.state || 'idle';
  }

  getWorkflowData() {
    const generator = this._ensureGenerator();
    return generator?.workflowData || {};
  }

  getProjectTitle() {
    const generator = this._ensureGenerator();
    if (!generator) return '';
    const title = generator.currentProject?.title || generator.workflowData?.taskGoal || '';
    return typeof title === 'string' ? title : String(title ?? '');
  }

  getReportMarkdown() {
    const generator = this._ensureGenerator();
    const data = generator?.workflowData || {};
    return typeof data.reportMarkdown === 'string'
      ? data.reportMarkdown
      : (typeof data.report?.markdown === 'string' ? data.report.markdown : '');
  }

  _ensureGenerator() {
    if (!this.generator && typeof window !== 'undefined') {
      this.generator = window.PPTGenerator;
    }
    return this.generator;
  }

  _patchReportConfig(patch) {
    const generator = this._ensureGenerator();
    if (!generator) return;
    const data = ensureWorkflowData(generator);
    if (!data.reportConfig || typeof data.reportConfig !== 'object') {
      data.reportConfig = {};
    }
    Object.assign(data.reportConfig, patch);
    generator.setAutoSaveNeeded?.();
  }
}

let _instance = null;

export function getPptGeneratorAdapter(options = {}) {
  if (!_instance) {
    _instance = new PptGeneratorAdapter(options);
  } else if (options.generator) {
    _instance.setGenerator(options.generator);
  }
  return _instance;
}

export function resetPptGeneratorAdapter() {
  _instance = null;
}

export default PptGeneratorAdapter;
