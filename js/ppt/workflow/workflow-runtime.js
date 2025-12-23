/**
 * Workflow Runtime Mixin
 * 设计系统、报告审阅面板、运行时 orchestrator 与事件处理
 */

import { WorkflowState, transitionWorkflow, forceWorkflowState } from './workflow-states.js';
import { WorkflowTodoStatus } from '../../agents/runtime/constants.js';
import { RunStoreAdapter } from '../../agents/runtime/event-bus.js';
import { subscribeTelemetry } from '../../agents/runtime/runstore-telemetry.js';
import { StageApiFactory } from '../../agents/runtime/stage-api-factory.js';
import { RunStore } from '../../agents/storage/run-store.js';
import { DesignDensity, DesignVisualMode, normalizeDesignDensity, normalizeDesignVisualMode } from '../design/design-preferences.js';
import { AgentEventBridge } from './agent-event-bridge.js';
import { EventHandlerRegistry, createWorkflowEventRegistry } from './event-handler-registry.js';
import { StateSynchronizer, inferWorkflowStateFromEvent } from './unified-state-mapping.js';

let _TextPrepStage = null;
async function getTextPrepStage() {
    if (!_TextPrepStage) {
        const mod = await import('../../agents/stages/textprep/index.js');
        _TextPrepStage = mod.TextPrepStage;
    }
    return _TextPrepStage;
}

const DESIGN_PHASE_LABELS = {
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

function formatDesignPhaseLabel(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key) return '';
    return DESIGN_PHASE_LABELS[key] || key;
}

function emitUiV2Event(name, payload) {
    if (typeof window === 'undefined') return;
    const bus = window.PPTUIV2?.instance?.eventBus;
    if (!bus || typeof bus.emit !== 'function') return;
    try {
        bus.emit(name, payload);
    } catch (err) {
        console.warn('[Workflow] UI V2 event bridge failed:', err);
    }
}

export const runtimeMixin = {
    _getDesignStageUserConfig() {
        const ds = this._ensureDesignSystemInitialized();
        const prefs = ds?.designPreferences && typeof ds.designPreferences === 'object' ? ds.designPreferences : {};
        const overrides = ds?.designSystemOverrides && typeof ds.designSystemOverrides === 'object' ? ds.designSystemOverrides : {};
        return {
            designPreferences: prefs,
            designSystemOverrides: overrides,
            refine: {
                enabled: ds.refine?.enabled || false,
                recommendedSteps: ds.refine?.recommendedSteps || 5,
                hardLimit: ds.refine?.hardLimit || 15,
            },
        };
    },
    _parseAndStoreSlides(deckHtmlDsl) {
        if (!deckHtmlDsl) return;
        this.sampleHTML = deckHtmlDsl;

        const parser =
            (typeof SlideParser !== 'undefined' ? SlideParser : null) ||
            (typeof window !== 'undefined' && window?.SlideParser ? window.SlideParser : null);

        if (!parser || typeof parser.parse !== 'function') return;

        try {
            const parsed = parser.parse(deckHtmlDsl);
            if (Array.isArray(parsed) ? parsed.length > 0 : !!parsed) this.slides = parsed;
        } catch (e) {
            console.warn('[Workflow] SlideParser.parse failed:', e);
        }
    },
    _ensureReportReviewPanel() {
        if (this._reportReviewPanel) return this._reportReviewPanel;
        if (typeof ReportReviewPanel === 'undefined') return null;
        this._reportReviewPanel = new ReportReviewPanel();
        try {
            const host = this.elements?.overlay || (typeof document !== 'undefined' ? document.body : null);
            this._reportReviewPanel.mount?.(host);
        } catch {
            // ignore DOM mount failures (e.g. test environments)
        }
        return this._reportReviewPanel;
    },
    _onReportUpdated(markdown, label) {
        const panel = this._ensureReportReviewPanel();
        if (!panel) return;

        const md = typeof markdown === 'string' ? markdown : '';
        if (!md.trim()) return;

        const last = panel.versions?.[panel.versions.length - 1];
        if (last && last.markdown === md) return;

        panel.addVersion(md, label);
    },
    toggleReportReview() {
        const panel = this._ensureReportReviewPanel();
        if (!panel) return;
        panel.toggle();
    },
    selectReportVersion(index) {
        const panel = this._ensureReportReviewPanel();
        if (!panel) return;
        const idx = Number(index);
        if (!Number.isFinite(idx) || idx < 0 || idx >= panel.versions.length) return;

        panel.selectedVersionIndex = idx;
        const v = panel.versions[idx];
        if (v) v.isNew = false;
        panel.updateBadge();
        panel.render();
    },
    _confirmScriptToPageLayout() {
        // Save checkpoint for script confirmation (manual step, no orchestrator stage boundary).
        const contentPackage = this.workflowData?.contentPackage;
        this._saveCheckpoint?.('design.script', {
            reportTitle: contentPackage?.report?.title,
            slideCount: Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents.length : undefined,
            markdownLength: typeof this.workflowData?.reportMarkdown === 'string' ? this.workflowData.reportMarkdown.length : undefined,
        });

        transitionWorkflow(this, WorkflowState.PAGE_LAYOUT);
        this.renderPreviewArea?.();
        this.updateTodos?.(this._runtimeTodoTexts.map((text, i) => {
            if (i < 3) return { text, status: WorkflowTodoStatus.COMPLETED };
            if (i === 3) return { text, status: WorkflowTodoStatus.ACTIVE };
            return { text, status: WorkflowTodoStatus.PENDING };
        }));
        this.phase3_PageLayout?.();
    },
    confirmReport() {
        this._reportReviewPanel?.close?.();
        this._confirmScriptToPageLayout();
    },
    _ensureFlowVizEventStore() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.flowVizEvents || typeof this.workflowData.flowVizEvents !== 'object') {
            this.workflowData.flowVizEvents = { deepsearch: [], design: [] };
        }
        if (!Array.isArray(this.workflowData.flowVizEvents.deepsearch)) this.workflowData.flowVizEvents.deepsearch = [];
        if (!Array.isArray(this.workflowData.flowVizEvents.design)) this.workflowData.flowVizEvents.design = [];
    },
    _resetFlowVizEventStore() {
        this._ensureFlowVizEventStore();
        this.workflowData.flowVizEvents.deepsearch = [];
        this.workflowData.flowVizEvents.design = [];
    },
    _pushFlowVizEvent(kind, name, payload) {
        if (kind !== 'deepsearch' && kind !== 'design') return;
        if (typeof name !== 'string' || !name) return;
        this._ensureFlowVizEventStore();
        const list = this.workflowData.flowVizEvents[kind];
        list.push({ name, payload });
        const limit = kind === 'deepsearch' ? 600 : 600;
        if (list.length > limit) this.workflowData.flowVizEvents[kind] = list.slice(-limit);
    },
    _pushToProcessPanel(name, payload) {
        if (typeof this.addProcessPanelStep !== 'function') return;

        // Compat: slideIndexes (0-based) -> slideRange (1-based inclusive)
        const normalizedPayload = payload && typeof payload === 'object' ? { ...payload } : {};
        if (Array.isArray(normalizedPayload.slideIndexes)) {
            const nums = normalizedPayload.slideIndexes.map(Number).filter(Number.isFinite);
            if (nums.length && (!Array.isArray(normalizedPayload.slideRange) || normalizedPayload.slideRange.length !== 2)) {
                const min = Math.min(...nums);
                const max = Math.max(...nums);
                normalizedPayload.slideRange = [min + 1, max + 1];
            }
        }

        const totalIdeas = normalizedPayload.totalIdeas ?? normalizedPayload.totalCandidates;
        const phaseValue = typeof normalizedPayload?.to === 'string' ? normalizedPayload.to : normalizedPayload?.phase;
        const phaseLabel = formatDesignPhaseLabel(phaseValue);
        const pressure = typeof normalizedPayload?.pressure === 'number' ? normalizedPayload.pressure : null;
        const pressurePct = typeof pressure === 'number' ? Math.round(pressure * 100) : null;
        const predictedTokens = Number.isFinite(normalizedPayload?.predictedTokens) ? Math.round(normalizedPayload.predictedTokens) : null;
        const budgetTokens = Number.isFinite(normalizedPayload?.budgetTokens) ? Math.round(normalizedPayload.budgetTokens) : null;
        const headroomTokens = Number.isFinite(normalizedPayload?.headroomTokens) ? Math.round(normalizedPayload.headroomTokens) : null;
        const growthTokens = Number.isFinite(normalizedPayload?.growthTokens) ? Math.round(normalizedPayload.growthTokens) : null;
        const suggestedLayers = Array.isArray(normalizedPayload?.suggestedLayers) ? normalizedPayload.suggestedLayers : null;
        const layerText = suggestedLayers && suggestedLayers.length ? suggestedLayers.join(', ') : '';
        const compressionSummary = (mode) => {
            const parts = [];
            if (pressurePct !== null) parts.push(`上下文压力 ${pressurePct}%`);
            if (predictedTokens !== null && budgetTokens !== null) {
                parts.push(`预测 ${predictedTokens}/${budgetTokens} tokens`);
            }
            const prefix = parts.length ? parts.join('，') : '上下文压力较高';
            return mode === 'forced' ? `${prefix}，已强制压缩` : `${prefix}，建议压缩`;
        };
        const compressionDetails = (() => {
            if (!name.startsWith('compression.')) return null;
            const details = {};
            if (normalizedPayload?.stageId) details.stage = normalizedPayload.stageId;
            if (pressurePct !== null) details.pressure = `${pressurePct}%`;
            if (predictedTokens !== null && budgetTokens !== null) details.predicted = `${predictedTokens}/${budgetTokens}`;
            if (headroomTokens !== null) details.headroom = headroomTokens;
            if (growthTokens !== null) details.growth = growthTokens;
            if (layerText) details.layers = layerText;
            return Object.keys(details).length ? details : null;
        })();

        // Map event names to human-readable descriptions
        const eventDescriptions = {
            'deepsearch.started': '开始深度分析流程',
            'deepsearch.scan.started': '正在扫描文档结构',
            'deepsearch.scan.completed': '文档扫描完成',
            'deepsearch.gaps.started': '正在识别知识空白',
            'deepsearch.gaps.completed': `识别了 ${normalizedPayload?.totalGaps || 0} 个研究问题`,
            'deepsearch.retrieve.started': '正在检索相关内容',
            'deepsearch.retrieve.completed': '内容检索完成',
            'deepsearch.understand.started': '正在分析提取要点',
            'deepsearch.understand.completed': '要点提取完成',
            'deepsearch.write.started': '正在撰写研究报告',
            'deepsearch.write.progress': normalizedPayload?.msg || `写作进度: ${normalizedPayload?.current || 0}/${normalizedPayload?.total || 4}`,
            'deepsearch.write.mode': `写作模式: ${normalizedPayload?.mode === 'react' ? '问题驱动' : '传统模式'}`,
            'deepsearch.write.react.step': (() => {
                const step = normalizedPayload?.stepNumber || '?';
                const tool = normalizedPayload?.tool;
                const title = normalizedPayload?.toolParams?.title;
                const thought = normalizedPayload?.thought;
                const preview = normalizedPayload?.markdownPreview;
                const obs = normalizedPayload?.observationPreview;

                if (tool === 'writeSection' && title) {
                    return `[步骤${step}] 写入章节: ${title}${preview ? `\n${preview}` : ''}`;
                }
                if (tool === 'searchEvidence') {
                    return `[步骤${step}] 搜索证据...`;
                }
                if (tool === 'finishReport') {
                    return `[步骤${step}] 完成报告`;
                }
                if (thought) {
                    return `[步骤${step}] 思考: ${String(thought).slice(0, 80)}...`;
                }
                return `[步骤${step}] ${tool || '处理中'}${obs ? ` - ${obs}` : ''}`;
            })(),
            'deepsearch.write.react.failed': '问题驱动写作失败，回退到传统模式',
            'deepsearch.write.completed': '报告撰写完成',
            'deepsearch.completed': '深度分析完成',
            'iteration.completed': `完成第 ${(normalizedPayload?.iteration || 0) + 1} 轮迭代`,
            'deepsearch.iteration.completed': `完成第 ${(normalizedPayload?.iteration || 0) + 1} 轮迭代`,
            'design.started': '开始视觉设计',
            'design.tokens.started': '正在提取设计规范',
            'design.tokens.ended': '设计规范已确定',
            'design.image.planning.completed': `图片规划完成：计划 ${normalizedPayload?.planned || 0} 张`,
            'design.generate.ended': `页面生成完成：${normalizedPayload?.slides || 0} 页`,
            'design.phase.transition': phaseLabel ? `设计阶段：${phaseLabel}` : '设计阶段推进',
            'design.visual.render.started': `视觉渲染开始：${normalizedPayload?.planned?.total || 0} 个槽位`,
            'design.visual.render.completed': `视觉渲染完成：图片 ${normalizedPayload?.report?.completed?.['ai-image'] || 0}/${normalizedPayload?.report?.planned?.['ai-image'] || 0}`,
            'design.visual.render.failed': `视觉渲染失败：图片 ${normalizedPayload?.report?.completed?.['ai-image'] || 0}/${normalizedPayload?.report?.planned?.['ai-image'] || 0}`,
            'design.refine.started': '开始质量精炼',
            'design.refine.ended': '质量精炼完成',
            'design.qa.ended': '质量检查完成',
            'design.degraded': '发生降级渲染',
            'design.batch.started': `正在生成页面 ${normalizedPayload?.slideRange?.join?.('-') || ''}`,
            'design.batch.completed': '批次生成完成',
            'design.ended': '设计阶段完成',
            'compression.advised': compressionSummary('advised'),
            'compression.forced': compressionSummary('forced'),
        };

        const text = eventDescriptions[name];
        if (!text) return; // Skip events we don't want to show

        this.addProcessPanelStep({
            name,
            text,
            details:
                compressionDetails ? compressionDetails :
                normalizedPayload?.totalGaps ? { gaps: normalizedPayload.totalGaps } :
                normalizedPayload?.iteration !== undefined ? { iteration: normalizedPayload.iteration + 1 } :
                phaseLabel ? { phase: phaseLabel } :
                normalizedPayload?.slideRange ? { slides: normalizedPayload.slideRange.join('-') } :
                Number.isFinite(totalIdeas) ? { ideas: totalIdeas } :
                typeof normalizedPayload?.planned === 'number' ? { planned: normalizedPayload.planned } :
                typeof normalizedPayload?.slides === 'number' ? { slides: normalizedPayload.slides } :
                typeof normalizedPayload?.degradedCount === 'number' ? { degraded: normalizedPayload.degradedCount } :
                typeof normalizedPayload?.slideNo === 'number' ? { slide: normalizedPayload.slideNo } :
                null
        });
    },
    _ensureDesignSystemInitialized() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.designSystem || typeof this.workflowData.designSystem !== 'object') {
            this.workflowData.designSystem = {};
        }

        const ds = this.workflowData.designSystem;

        // DesignSystem UI v2 userConfig model: {designPreferences, designSystemOverrides}
        // Migrate legacy {colors,fonts,visualPreference} fields into designSystemOverrides.
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

        // Legacy aliases (kept for existing UI + stored projects)
        ds.colors = overrides.colors;
        ds.fonts = overrides.typography;
        ds.visualPreference = overrides.visualPreference;

        ds.density = normalizeDesignDensity(ds.density, DesignDensity.BALANCED);

        // Model selection is now centralized in PPT model config; drop legacy per-project setting.
        if (Object.prototype.hasOwnProperty.call(ds, 'model')) delete ds.model;

        // Initialize refiner config (ReAct)
        if (!ds.refine || typeof ds.refine !== 'object') ds.refine = {};
        if (typeof ds.refine.enabled !== 'boolean') ds.refine.enabled = false;
        if (!Number.isFinite(ds.refine.recommendedSteps) || ds.refine.recommendedSteps <= 0) ds.refine.recommendedSteps = 5;
        if (!Number.isFinite(ds.refine.hardLimit) || ds.refine.hardLimit <= 0) ds.refine.hardLimit = 15;

        const allowedBatch = new Set([1, 2, 4]);
        const batchSize = Number(this.workflowData.batchSize);
        if (!allowedBatch.has(batchSize)) this.workflowData.batchSize = 4;

        return ds;
    },
    openProjectBriefForm() {
        transitionWorkflow(this, WorkflowState.BRIEFING);
        this.renderPreviewArea?.();
    },
    cancelProjectBrief() {
        transitionWorkflow(this, WorkflowState.IDLE);
        this.renderPreviewArea?.();
    },
    submitProjectBrief() {
        const taskGoalEl = document.getElementById('pptBriefTaskGoal');
        const summaryEl = document.getElementById('pptBriefProjectSummary');
        const audienceEl = document.getElementById('pptBriefAudience');
        const toneEl = document.getElementById('pptBriefTone');

        const taskGoal = typeof taskGoalEl?.value === 'string' ? taskGoalEl.value.trim() : '';
        const projectSummary = typeof summaryEl?.value === 'string' ? summaryEl.value.trim() : '';
        const audience = typeof audienceEl?.value === 'string' ? audienceEl.value.trim() : '';
        const tone = typeof toneEl?.value === 'string' ? toneEl.value.trim() : '';

        if (!taskGoal) {
            alert('请填写「任务目标」(taskGoal)，否则无法开始 DeepSearch。');
            return;
        }

        this.setProjectBrief?.({ taskGoal, projectSummary, audience, tone });
        transitionWorkflow(this, WorkflowState.IDLE);
        this.renderPreviewArea?.();

        if (this._pendingStartAfterBrief) {
            this._pendingStartAfterBrief = false;
            this.startMultiAgentWorkflow({ skipBriefCheck: true });
        }
    },
    async _ensureRuntime({ mode = 'deepsearch', scenario = 'business', constraints = {} } = {}) {
        if (this._orchestrator && this._orchestrator.state === 'running') return;

        const mod = await import('../../agents/runtime/orchestrator.js');
        const { AgentOrchestrator } = mod;

        const baseAiApiService = typeof window !== 'undefined' && window.aiApiService ? window.aiApiService : null;
        const visionApi = typeof window !== 'undefined' && window.visionApi ? window.visionApi : null;
        const whisperApi = typeof window !== 'undefined' && window.whisperApi ? window.whisperApi : null;

        // Inject global AI services + ModelRouter (for pptRolePriority-aware routing)
        let aiApiService = baseAiApiService;
        let modelRouter = null;
        try {
            const { buildPptUsageConfigForModelRouter, createPptAwareAiApiService } = await import('../../agents/llm/ppt-model-bridge.js');
            aiApiService = typeof createPptAwareAiApiService === 'function' ? createPptAwareAiApiService(baseAiApiService) : baseAiApiService;

            const usageConfig = typeof buildPptUsageConfigForModelRouter === 'function' ? buildPptUsageConfigForModelRouter() : null;
            if (usageConfig && typeof usageConfig === 'object') {
                const { ModelRouter } = await import('../../agents/llm/model-router.js');

                const textUsages = ['worker', 'analyst', 'planner', 'writer', 'reviewer', 'designer'];
                const textSet = new Set();
                const visionSet = new Set();

                for (const u of textUsages) {
                    for (const id of Array.isArray(usageConfig?.[u]) ? usageConfig[u] : []) textSet.add(id);
                }
                for (const id of Array.isArray(usageConfig?.vision) ? usageConfig.vision : []) visionSet.add(id);

                const allModelIds = new Set([...textSet, ...visionSet]);

                const available = typeof baseAiApiService?.getAvailableModels === 'function' ? baseAiApiService.getAvailableModels() : [];
                for (const provider of Array.isArray(available) ? available : []) {
                    const providerId = String(provider?.id || '').trim();
                    if (providerId) allModelIds.add(providerId);
                    const modelNames = Array.isArray(provider?.models) ? provider.models : [];
                    for (const modelName of modelNames) {
                        const mn = String(modelName || '').trim();
                        if (!providerId || !mn) continue;
                        allModelIds.add(`${providerId}:${mn}`);
                    }
                }

                const models = Array.from(allModelIds).map((id) => {
                    const tags = [];
                    if (textSet.has(id)) tags.push('text');
                    if (visionSet.has(id)) tags.push('vision');
                    if (tags.length === 0) tags.push('text');
                    return { id, provider: 'ppt_ai_api_service', tags };
                });

                // Debug: Log ModelRouter configuration
                console.log('[PPTGeneratorWorkflow] ModelRouter config:', {
                    usageConfig,
                    textSet: Array.from(textSet),
                    visionSet: Array.from(visionSet),
                    allModelIds: Array.from(allModelIds),
                    modelsCount: models.length,
                });

                // 关键检查：验证每个 usage 都有模型配置
                const missingUsages = textUsages.filter(u => !usageConfig[u]?.length);
                if (missingUsages.length) {
                    console.warn('[PPTGeneratorWorkflow] WARNING: Missing models for usages:', missingUsages);
                }
                // 特别检查 writer
                if (!usageConfig.writer?.length) {
                    console.error('[PPTGeneratorWorkflow] CRITICAL: No models configured for writer!', {
                        writerConfig: usageConfig.writer,
                        allUsageConfigs: Object.fromEntries(textUsages.map(u => [u, usageConfig[u]?.length || 0]))
                    });
                }

                const providerCallContext = new WeakMap();
                const provider = {
                    id: 'ppt_ai_api_service',
                    name: 'PPT AI API Service',
                    chat: async ({ model, messages, images } = {}) => {
                        const modelId = typeof model === 'string' ? model.trim() : '';
                        console.log('[PPTGeneratorWorkflow] provider.chat called:', { modelId, hasMessages: !!messages?.length, hasImages: !!images?.length });
                        const hasImages = Array.isArray(images) && images.length > 0;
                        const ctx = (Array.isArray(messages) && providerCallContext.get(messages)) || {};
                        const temperature = typeof ctx?.temperature === 'number' && Number.isFinite(ctx.temperature) ? ctx.temperature : 0.7;
                        const maxTokens = typeof ctx?.maxTokens === 'number' && Number.isFinite(ctx.maxTokens) ? ctx.maxTokens : 4096;
                        const signal = ctx?.signal;

                        if (hasImages && visionApi?.describe) {
                            const promptMsg = Array.isArray(messages) ? messages[messages.length - 1]?.content : '';
                            const prompt = typeof promptMsg === 'string' ? promptMsg : JSON.stringify(promptMsg || '');
                            const resp = await visionApi.describe(images[0], prompt, signal ? { signal } : undefined);
                            if (resp && typeof resp === 'object' && typeof resp.content === 'string') return resp;
                            return { content: typeof resp === 'string' ? resp : JSON.stringify(resp ?? '') };
                        }

                        if (!baseAiApiService) throw new Error('aiApiService not available');

                        // 重试逻辑：对于 401/429 错误，等待后重试一次
                        const attemptCall = async () => {
                            if (typeof baseAiApiService?._resolveModelConfig === 'function' && typeof baseAiApiService?._callApi === 'function') {
                                const idx = modelId.indexOf(':');
                                const sourceKey = idx > 0 ? modelId.slice(0, idx) : modelId;
                                const specificModel = idx > 0 ? modelId.slice(idx + 1) : null;

                                console.log('[PPTGeneratorWorkflow] _resolveModelConfig:', { sourceKey, specificModel });
                                const config = baseAiApiService._resolveModelConfig(sourceKey || 'auto', specificModel);
                                if (!config) {
                                    console.error('[PPTGeneratorWorkflow] No model config found:', { modelId, sourceKey, specificModel });
                                    throw new Error(`No available model config for: ${modelId || 'auto'}`);
                                }

                                return await baseAiApiService._callApi(config, messages, temperature, maxTokens, { signal });
                            }

                            if (typeof baseAiApiService?.chat !== 'function') throw new Error('aiApiService.chat not available');
                            return await baseAiApiService.chat({ messages, model: modelId || 'auto', temperature, maxTokens });
                        };

                        try {
                            return await attemptCall();
                        } catch (err) {
                            const status = err?.status || err?.response?.status || (err?.message?.match?.(/4\d{2}/)?.[0]);
                            // 对于 401/429，等待 2 秒后重试一次（可能是限流）
                            if (status === 401 || status === 429 || status === '401' || status === '429') {
                                console.warn('[PPTGeneratorWorkflow] Rate limit detected, retrying in 2s...', { status });
                                await new Promise(r => setTimeout(r, 2000));
                                return await attemptCall();
                            }
                            throw err;
                        }
                    }
                };

                const router = new ModelRouter({
                    models,
                    usageConfig,
                    providers: new Map([[provider.id, provider]]),
                    cooldownMs: 5000  // 5秒冷却，避免限流误判导致长时间不可用
                });

                // Backward-compatible call signature: call(messagesOrPrompt, {usage, images})
                modelRouter = {
                    on: router.on.bind(router),
                    off: router.off.bind(router),
                    getModelEntry: router.getModelEntry.bind(router),
                    getHealth: router.getHealth.bind(router),
                    resetUnhealthy: router.resetUnhealthy.bind(router),
                    isAvailable: router.isAvailable.bind(router),
                    markUnhealthy: router.markUnhealthy.bind(router),
                    async call(arg1, arg2) {
                        if (arg2 === undefined && arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
                            return router.call(arg1);
                        }
                        const opts = arg2 && typeof arg2 === 'object' ? arg2 : {};
                        const usage = typeof opts.usage === 'string' && opts.usage ? opts.usage : 'worker';
                        const images = Array.isArray(opts.images) ? opts.images : undefined;
                        const messages = Array.isArray(arg1) ? arg1 : [{ role: 'user', content: String(arg1 ?? '') }];
                        const ctx = { temperature: opts.temperature, maxTokens: opts.maxTokens, signal: opts.signal };
                        providerCallContext.set(messages, ctx);
                        try {
                            return await router.call({ usage, messages, ...(images ? { images } : {}) });
                        } finally {
                            providerCallContext.delete(messages);
                        }
                    }
                };

                this._modelRouter = modelRouter;
                if (typeof window !== 'undefined') window.modelRouter = modelRouter;
            }
        } catch (e) {
            console.warn('[PPTGeneratorWorkflow] ModelRouter init skipped:', e);
            aiApiService = baseAiApiService;
            modelRouter = null;
        }

        const services = {
            aiApiService,
            modelRouter,
            visionApi,
            whisperApi,
        };

        // 生成 runId
        this._currentRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // 尝试创建持久化 EventBus，IndexedDB 不可用时降级为内存模式
        let persistenceAdapter = null;
        try {
            this._runStore = new RunStore({ dbName: 'PPTWorkflowDB' });
            await this._runStore.open();
            persistenceAdapter = new RunStoreAdapter(this._runStore);
        } catch (err) {
            console.warn('[Workflow] IndexedDB not available, running without persistence:', err?.message || err);
            this._runStore = null;
        }

        if (this._telemetrySubscription?.unsubscribe) {
            try {
                this._telemetrySubscription.unsubscribe();
            } catch {
                // ignore
            }
        }
        this._telemetrySubscription = null;

        // 创建 EventBus（有或没有持久化适配器）
        const { EventBus } = await import('../../agents/runtime/event-bus.js');
        const eventBus = new EventBus({
            runId: this._currentRunId,
            ...(persistenceAdapter ? { persistenceAdapter } : {})
        });

        this._ensureTelemetrySubscription?.(eventBus);

        this._orchestrator = new AgentOrchestrator({
            mode,
            scenario,
            constraints,
            services,
            eventBus,  // 传入带持久化的 eventBus
            runId: this._currentRunId
        });

        // Stage order drives todo/agent updates via subscribed events.
        this._runtimeStageUi = {
            'deepsearch.ingest': { todoIndex: 0, agentId: 'reader', state: WorkflowState.READING, started: 'Analyzing document structure...', ended: 'Sources Ingested' },
            'deepsearch.pipeline': { todoIndex: 1, agentId: 'analyst', state: WorkflowState.RESEARCHING, started: 'Researching and generating report...', ended: 'Report Ready' },
            'textprep.align': { todoIndex: 3, agentId: 'designer', state: WorkflowState.PAGE_LAYOUT, started: 'Planning slide layout...', ended: 'Layout Ready' },
            'design.batch': { todoIndex: 4, agentId: 'designer', state: WorkflowState.DESIGNER, started: 'Optimizing visual layout...', ended: 'Design Complete' },
            'evaluate.hardgates': { todoIndex: 5, agentId: 'reviewer', started: 'Final compliance check...', ended: 'Approved' }
        };

        this._runtimeDesignSubStageUi = {
            'design.tokens': { label: '设计规范提取', agentId: 'designer' },
            'design.image.planning': { label: '图片规划', agentId: 'designer' },
            'design.visual.render': { label: '视觉渲染', agentId: 'designer' },
            'design.refine': { label: '质量精炼', agentId: 'designer' },
            'design.qa': { label: '质量检查', agentId: 'designer' }
        };

        this._runtimeTodoTexts = [
            '深度阅读与信息提取',
            '研究分析与报告生成',
            '脚本审阅与编辑',
            '页面规划与内容映射',
            '视觉设计与排版优化',
            '最终渲染与质量检查'
        ];

        this._attachRuntimeEventHandlers();
        await this._registerWorkflowStages();
    },
    _getRunStorePath() {
        return 'PPTWorkflowDB';
    },
    _ensureTelemetrySubscription(eventBus) {
        if (this._telemetrySubscription) return this._telemetrySubscription;
        const bus = eventBus || this._orchestrator?.eventBus;
        if (!bus || !this._runStore) return null;

        try {
            this._telemetrySubscription = subscribeTelemetry(bus, this._runStore);
        } catch (err) {
            console.warn('[Workflow] Telemetry subscription failed:', err?.message || err);
            this._telemetrySubscription = null;
        }

        return this._telemetrySubscription;
    },

    async _loadFlowVizEvents() {
        if (!this._runStore || !this._currentRunId) {
            return { deepsearch: [], design: [] };
        }

        try {
            const events = await this._runStore.getEvents(this._currentRunId);
            const deepsearch = events.filter(e =>
                e.name?.startsWith('deepsearch.') ||
                e.name === 'iteration.completed'
            );
            const design = events.filter(e => e.name?.startsWith('design.'));

            return { deepsearch, design };
        } catch (err) {
            console.warn('[Workflow] Failed to load flow viz events:', err);
            return { deepsearch: [], design: [] };
        }
    },

    async replayRun(runId) {
        if (!this._orchestrator?.eventBus) {
            console.warn('[Workflow] Cannot replay: eventBus not available');
            return [];
        }

        try {
            const events = await this._orchestrator.eventBus.replay(runId);
            console.log(`[Workflow] Replayed ${events.length} events for run ${runId}`);

            // 触发可视化更新
            this._scheduleVizRerender?.();

            return events;
        } catch (err) {
            console.error('[Workflow] Replay failed:', err);
            return [];
        }
    },

    async listRuns() {
        if (!this._runStore) {
            return [];
        }

        try {
            return await this._runStore.listRuns();
        } catch (err) {
            console.warn('[Workflow] Failed to list runs:', err);
            return [];
        }
    },
    _attachRuntimeEventHandlers() {
        if (this._runtimeUnsubs) {
            this._runtimeUnsubs.forEach(fn => fn());
        }
        this._runtimeUnsubs = [];

        if (this._agentEventBridge) {
            try {
                this._agentEventBridge.stop?.();
            } catch {
                // ignore
            }
            this._agentEventBridge = null;
        }

        const bus = this._orchestrator?.eventBus;
        if (!bus) return;

        this._stateSynchronizer = new StateSynchronizer(this);

        if (this._eventRegistry instanceof EventHandlerRegistry) {
            this._eventRegistry.clear();
        }

        this._eventRegistry = createWorkflowEventRegistry({
            updateTodos: (todos) => {
                if (Array.isArray(todos)) this.updateTodos?.(todos);
            },
            onRunCompleted: (payload) => this._onRunCompleted?.(payload),
            onRunFailed: (payload) => this._onRunFailed?.(payload),
            onDesignPhaseChange: (from, to) => this._onDesignPhaseChange?.(from, to),
            logTerminal: (...args) => this.logTerminal?.(...args),
            onError: (eventName, error) => this._onError?.(eventName, error),
        });

        this._registerWorkflowEventHandlers();

        this._agentEventBridge = new AgentEventBridge(bus);
        this._agentEventBridge.start();
        this._runtimeUnsubs.push(() => this._agentEventBridge?.stop?.());
        this._runtimeUnsubs.push(this._agentEventBridge.on('*', (evt) => this._handleRuntimeEvent(evt)));
    },
    _registerWorkflowEventHandlers() {
        const registry = this._eventRegistry;
        if (!registry) return;

        const scheduleVizRerender = () => this._scheduleVizRerender?.();
        const captureFlowEvent = () => (eventName, payload) => {
            this._pushToProcessPanel(eventName, payload);
        };

        registry.register('run.started', () => {
            forceWorkflowState(this, WorkflowState.READING);
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({
                text,
                status: i === 0 ? WorkflowTodoStatus.ACTIVE : WorkflowTodoStatus.PENDING,
            })));
            this.renderPreviewArea();
        });

        // FlowViz 事件捕获
        registry.register('deepsearch.*', captureFlowEvent('deepsearch'));
        registry.register('iteration.completed', captureFlowEvent('deepsearch'));
        registry.register('design.*', captureFlowEvent('design'));
        registry.register('compression.*', captureFlowEvent('runtime'));

        // Design sub-stage UI: update agent activity based on fine-grained events.
        registry.register('design.*', (eventName, payload) => {
            if (!this._runtimeDesignSubStageUi || typeof this._setAgentStatus !== 'function') return;
            const m = eventName.match(/^(.*)\.(started|ended|completed|failed)$/);
            if (m) {
                const subStage = m[1];
                const status = m[2];
                const ui = this._runtimeDesignSubStageUi[subStage];
                if (ui) {
                    const suffix = status === 'started' ? '' : (status === 'failed' ? '失败' : '完成');
                    const activity = `${ui.label}${suffix}`;
                    const agentStatus = status === 'failed' ? 'idle' : 'active';
                    this._setAgentStatus(ui.agentId, agentStatus, activity);
                }
            }

            if (eventName === 'design.degraded') {
                const ui = this._runtimeDesignSubStageUi['design.qa'] || { label: '质量检查', agentId: 'designer' };
                const detail =
                    typeof payload?.slideNo === 'number' ? `第 ${payload.slideNo} 页` :
                    typeof payload?.degradedCount === 'number' ? `${payload.degradedCount} 页` :
                    '';
                this._setAgentStatus(ui.agentId, 'active', `降级渲染${detail ? ` (${detail})` : ''}`);
            }
        });

        registry.register('design.phase.transition', (eventName, payload) => {
            if (!this.workflowData) this.workflowData = {};
            const phase = typeof payload?.to === 'string' ? payload.to : payload?.phase;
            this.workflowData.designPhase = {
                status: typeof phase === 'string' ? phase : 'unknown',
                from: payload?.from,
                to: payload?.to,
                updatedAt: Date.now(),
            };
            const label = formatDesignPhaseLabel(phase);
            if (label && typeof this._setAgentStatus === 'function') {
                this._setAgentStatus('designer', 'active', `设计阶段：${label}`);
            }
            scheduleVizRerender();
        });

        const updateSlideStatus = (eventName, payload) => {
            if (!this.workflowData) this.workflowData = {};
            if (!this.workflowData.slideStatuses || typeof this.workflowData.slideStatuses !== 'object') {
                this.workflowData.slideStatuses = { schemaVersion: '0.1', bySlideIntentId: {}, byIndex: {}, updatedAt: 0 };
            }

            const slideIntentId = typeof payload?.slideIntent?.id === 'string'
                ? payload.slideIntent.id
                : (typeof payload?.slideIntentId === 'string' ? payload.slideIntentId : null);
            const slideIndex = Number.isFinite(payload?.slideIndex) ? payload.slideIndex : (Number.isFinite(payload?.slideNo) ? payload.slideNo - 1 : null);
            const keyId = slideIntentId ? String(slideIntentId) : null;
            const keyIndex = slideIndex !== null ? Number(slideIndex) : null;
            const now = Date.now();
            const current =
                (keyId && this.workflowData.slideStatuses.bySlideIntentId[keyId]) ||
                (keyIndex !== null && this.workflowData.slideStatuses.byIndex[keyIndex]) ||
                {};

            const next = {
                ...current,
                ...(keyId ? { slideIntentId: keyId } : {}),
                ...(keyIndex !== null ? { slideIndex: keyIndex } : {}),
                updatedAt: now,
            };

            if (eventName === 'design.slide.started') {
                next.status = 'generating';
            } else if (eventName === 'design.slide.completed') {
                next.status = 'completed';
                if (typeof payload?.source === 'string') next.source = payload.source;
                if (typeof payload?.duration === 'number') next.duration = payload.duration;
            } else if (eventName === 'design.slide.failed') {
                next.status = 'failed';
                next.error = payload?.error?.message || payload?.error || 'unknown';
            } else if (eventName === 'design.slide.retrying') {
                next.status = 'generating';
                if (Number.isFinite(payload?.attempt)) next.attempt = payload.attempt;
            } else if (eventName === 'design.slide.progress') {
                next.status = next.status || 'generating';
                if (typeof payload?.step === 'string') next.step = payload.step;
                if (typeof payload?.msg === 'string') next.msg = payload.msg;
            } else if (eventName === 'design.degraded') {
                next.degraded = true;
                next.degradedReason = payload?.reason || next.degradedReason;
            }

            if (keyId) this.workflowData.slideStatuses.bySlideIntentId[keyId] = next;
            if (keyIndex !== null) this.workflowData.slideStatuses.byIndex[keyIndex] = next;
            this.workflowData.slideStatuses.updatedAt = now;
            scheduleVizRerender();
        };

        registry.register('design.slide.*', updateSlideStatus);
        registry.register('design.degraded', updateSlideStatus);

        const updateDeepSearchIteration = (eventName, payload) => {
            this._ensureDeepSearchViz();
            const viz = this.workflowData.deepsearchViz;
            const completed = typeof payload.iteration === 'number' ? payload.iteration : null;
            if (completed !== null) viz.lastCompletedIteration = completed;
            if (typeof payload.openGapCount === 'number') viz.openGapCount = payload.openGapCount;
            if (typeof payload.iteration === 'number') viz.iteration = payload.iteration + 1;
            viz.updatedAt = Date.now();
            this._scheduleVizRerender();
        };

        registry.register('iteration.completed', updateDeepSearchIteration);
        registry.register('deepsearch.iteration.completed', updateDeepSearchIteration);

        registry.register('deepsearch.started', (eventName, payload) => {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.runId = payload?.runId || this.workflowData.deepsearchViz.runId;
            this.workflowData.deepsearchViz.startedAt = Date.now();
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.completed', () => {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.completedAt = Date.now();
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.gaps.completed', (eventName, payload) => {
            this._ensureDeepSearchViz();
            if (typeof payload.gapCount === 'number') this.workflowData.deepsearchViz.openGapCount = payload.gapCount;
            if (typeof payload.totalGaps === 'number') this.workflowData.deepsearchViz.totalGaps = payload.totalGaps;
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            if (this._deepsearchState) this._syncDeepSearchVizFromState(this._deepsearchState);
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.checkpoint.saved', (eventName, payload) => {
            this._ensureDeepSearchViz();
            const checkpoints = Array.isArray(this.workflowData.deepsearchViz.checkpoints) ? this.workflowData.deepsearchViz.checkpoints : [];
            const row = {
                checkpointId: payload?.checkpointId,
                iteration: payload?.iteration,
                trajectoryId: payload?.trajectoryId,
                ts: Date.now(),
            };
            checkpoints.push(row);
            this.workflowData.deepsearchViz.checkpoints = checkpoints.slice(-50);
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        });

        // === 外搜事件追踪 ===
        registry.register('deepsearch.external.triggered', (eventName, payload) => {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.externalSearch = {
                status: 'triggered',
                reason: payload?.reason || 'insufficient_local_hits',
                localHitCount: payload?.localHitCount,
                minLocalHits: payload?.minLocalHits,
                triggeredAt: Date.now(),
            };
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this.logTerminal('AI 搜索', `本地结果不足 (${payload?.localHitCount}/${payload?.minLocalHits})，启动外部搜索...`, 'info');
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.external.started', (eventName, payload) => {
            this._ensureDeepSearchViz();
            const ext = this.workflowData.deepsearchViz.externalSearch || {};
            this.workflowData.deepsearchViz.externalSearch = {
                ...ext,
                status: 'running',
                providers: payload?.providers || [],
                gapCount: payload?.gapCount,
                startedAt: Date.now(),
            };
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this.logTerminal('AI 搜索', `外搜启动：${(payload?.providers || []).join(', ')}`, 'normal');
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.external.completed', (eventName, payload) => {
            this._ensureDeepSearchViz();
            const ext = this.workflowData.deepsearchViz.externalSearch || {};
            this.workflowData.deepsearchViz.externalSearch = {
                ...ext,
                status: 'completed',
                chunksCount: payload?.chunksCount || 0,
                documentsCount: payload?.documentsCount || 0,
                evidencesCount: payload?.evidencesCount || 0,
                completedAt: Date.now(),
            };
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this.logTerminal('AI 搜索', `外搜完成：获取 ${payload?.documentsCount || 0} 个文档，${payload?.chunksCount || 0} 个片段`, 'success');
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.external.error', (eventName, payload) => {
            this._ensureDeepSearchViz();
            const ext = this.workflowData.deepsearchViz.externalSearch || {};
            this.workflowData.deepsearchViz.externalSearch = {
                ...ext,
                status: 'error',
                error: payload?.message,
                errorAt: Date.now(),
            };
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this.logTerminal('AI 搜索', `外搜错误：${payload?.message || '未知错误'}`, 'error');
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.external.skipped', (eventName, payload) => {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.externalSearch = {
                status: 'skipped',
                reason: payload?.reason || 'unknown',
                localHitCount: payload?.localHitCount,
                skippedAt: Date.now(),
            };
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        });
        // === 外搜事件追踪结束 ===

        // Allow DeepSearch stages to update gaps list, then fall through to progress logger.
        registry.register('deepsearch.gaps.progress', (eventName, payload) => {
            this._ensureDeepSearchViz();
            const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : null;
            if (detail?.gapId) this._upsertDeepSearchVizGap(detail);
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        });

        // 追踪阶段变化 + 进度日志
        registry.register('*.progress', (eventName, payload) => {
            if (payload.phase) {
                this._ensureDeepSearchViz();
                const viz = this.workflowData.deepsearchViz;
                const phase = payload.phase;

                // 更新当前阶段
                if (viz.currentPhase !== phase) {
                    // 记录上一阶段结束
                    if (viz.currentPhase && viz.stageMetrics[viz.currentPhase]) {
                        viz.stageMetrics[viz.currentPhase].status = 'completed';
                        viz.stageMetrics[viz.currentPhase].completedAt = Date.now();
                    }
                    // 开始新阶段
                    viz.currentPhase = phase;
                    if (viz.stageMetrics[phase]) {
                        viz.stageMetrics[phase].status = 'active';
                        viz.stageMetrics[phase].startedAt = Date.now();
                    }
                    // 添加到历史
                    viz.phaseHistory.push({ phase, iteration: viz.iteration, ts: Date.now() });
                }

                // 更新阶段详情
                if (viz.stageMetrics[phase]) {
                    viz.stageMetrics[phase].lastProgress = {
                        current: payload.current,
                        total: payload.total,
                        msg: payload.msg,
                        step: payload.step,
                    };
                }
            }

            const msg = payload.msg;
            const actor = this._runtimeEventMeta?.actor;
            const agent =
                payload.agent ||
                (payload.phase === 'scan' ? 'AI 研究' :
                    payload.phase === 'gaps' ? 'AI 分析' :
                        payload.phase === 'retrieve' ? 'AI 搜索' :
                            payload.phase === 'understand' ? 'AI 提取' :
                                payload.phase === 'write' ? 'AI 写作' :
                                    (actor === 'ingest' ? 'AI 阅读' :
                                        actor === 'deepsearch' ? 'AI 研究' :
                                            actor === 'textprep' ? 'AI 分析' :
                                                actor === 'design' ? 'AI 设计' :
                                                    actor === 'evaluate' ? 'AI 审查' : 'AI'));
            const type = payload.type || 'normal';
            if (agent && msg) this.logTerminal(agent, msg, type);
        });
    },
    _ensureCompressionMetrics() {
        if (!this.workflowData) this.workflowData = {};
        const existing = this.workflowData.runtimeCompression;
        if (!existing || typeof existing !== 'object') {
            this.workflowData.runtimeCompression = {
                history: [],
                latest: null,
                updatedAt: 0,
            };
        } else {
            if (!Array.isArray(existing.history)) existing.history = [];
        }
        return this.workflowData.runtimeCompression;
    },
    _recordCompressionEvent(eventName, payload) {
        if (typeof eventName !== 'string' || !eventName.startsWith('compression.')) return null;
        const metrics = this._ensureCompressionMetrics();

        const toNumber = (value) => (Number.isFinite(value) ? value : null);
        const predictedTokens = toNumber(payload?.predictedTokens);
        const budgetTokens = toNumber(payload?.budgetTokens);
        let pressure = toNumber(payload?.pressure);
        if (pressure === null && predictedTokens !== null && budgetTokens) {
            pressure = predictedTokens / budgetTokens;
        }
        if (!Number.isFinite(pressure)) pressure = null;

        const entry = {
            ts: Date.now(),
            event: eventName,
            mode:
                eventName.endsWith('.forced') ? 'forced' :
                eventName.endsWith('.advised') ? 'advised' :
                'info',
            stageId: typeof payload?.stageId === 'string' ? payload.stageId : null,
            pressure,
            predictedTokens,
            budgetTokens,
            headroomTokens: toNumber(payload?.headroomTokens),
            growthTokens: toNumber(payload?.growthTokens),
            maxContextTokens: toNumber(payload?.maxContextTokens),
            suggestedLayers: Array.isArray(payload?.suggestedLayers) ? payload.suggestedLayers : null,
        };

        metrics.latest = entry;
        metrics.updatedAt = entry.ts;

        if (pressure !== null) {
            metrics.history.push({ ts: entry.ts, pressure });
            if (metrics.history.length > 24) {
                metrics.history.splice(0, metrics.history.length - 24);
            }
        }

        return metrics;
    },
    _handleRuntimeEvent(evt) {
        if (!evt) return;
        const name = evt?.name || '';
        const payload = evt?.payload || {};

        this._runtimeEventMeta = evt;

        // 使用 StateSynchronizer 同步状态
        if (this._stateSynchronizer) {
            this._stateSynchronizer.handleAgentEvent(name, payload);
        } else {
            const suggested = inferWorkflowStateFromEvent(name, this.state, payload);
            if (suggested && suggested !== this.state) {
                transitionWorkflow(this, suggested, { triggeredBy: name });
            }
        }

        emitUiV2Event(name, payload);

        // 分发到 EventHandlerRegistry
        if (!this._eventRegistry) {
            this._eventRegistry = new EventHandlerRegistry(this);
            this._registerWorkflowEventHandlers();
        }
        this._eventRegistry?.dispatch(name, payload);
        if (name === 'compression.advised' || name === 'compression.forced') {
            const metrics = this._recordCompressionEvent(name, payload);
            if (metrics) this._updateCompressionPanel?.(metrics);
        }

        // 处理 stage 开始/结束/失败事件 (保留原逻辑用于 UI 更新)
        this._handleStageLifecycleEvent(name, payload, evt);
    },
    _handleStageLifecycleEvent(name, payload, evt) {
        const match = name.match(/^(.*)\.(started|ended|failed)$/);
        if (!match) return;

        const stageName = match[1];
        const stageStatus = match[2];
        const ui = this._runtimeStageUi?.[stageName];
        if (!ui) return;

        const ensureWorkflowState = (targetState, meta) => {
            if (!targetState || this.state === targetState) return;

            // Bridge common shortcuts used by some entry points/tests.
            // Example: directly running `design.batch` after `run.started` leaves state at `reading`,
            // while the UI state machine expects `page_layout → designer`.
            if (targetState === WorkflowState.PAGE_LAYOUT) {
                if (this.state === WorkflowState.READING) transitionWorkflow(this, WorkflowState.SCRIPT_REVIEW, meta);
                if (this.state === WorkflowState.SCRIPT_REVIEW) transitionWorkflow(this, WorkflowState.PAGE_LAYOUT, meta);
                if (this.state === targetState) return;
            } else if (targetState === WorkflowState.DESIGNER) {
                if (this.state === WorkflowState.READING) transitionWorkflow(this, WorkflowState.SCRIPT_REVIEW, meta);
                if (this.state === WorkflowState.SCRIPT_REVIEW) transitionWorkflow(this, WorkflowState.PAGE_LAYOUT, meta);
                if (this.state === WorkflowState.PAGE_LAYOUT) transitionWorkflow(this, WorkflowState.DESIGNER, meta);
                if (this.state === targetState) return;
            }

            const ok = transitionWorkflow(this, targetState, meta);
            if (!ok) forceWorkflowState(this, targetState);
        };

        if (ui.state && stageStatus === 'started') {
            ensureWorkflowState(ui.state, { stageName, event: name });
        }

        if (stageStatus === 'started') {
            this._setAgentStatus(ui.agentId, 'active', ui.started);
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
                if (i < ui.todoIndex) return { text, status: WorkflowTodoStatus.COMPLETED };
                if (i === ui.todoIndex) return { text, status: WorkflowTodoStatus.ACTIVE };
                return { text, status: WorkflowTodoStatus.PENDING };
            }));
        }

        if (stageStatus === 'ended') {
            this._setAgentStatus(ui.agentId, 'idle', ui.ended);
            // Some steps have a user-confirmation gap after the model finishes generating.
            if (stageName !== 'deepsearch.questions') {
                this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
                    if (i <= ui.todoIndex) return { text, status: WorkflowTodoStatus.COMPLETED };
                    return { text, status: WorkflowTodoStatus.PENDING };
                }));
            }
        }

        if (stageStatus === 'failed') {
            this._setAgentStatus(ui.agentId, 'idle', 'Failed');
            const msg = payload?.message || evt?.payload?.message || 'Stage failed';
            this.logTerminal('系统', `${stageName} 失败: ${msg}`, 'warning');
            try {
                this._orchestrator?.stop?.('stage_failed');
            } catch {
                // ignore
            }
        }
    },
    async _registerWorkflowStages() {
        const orch = this._orchestrator;
        if (!orch) return;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        const runtimeMode = orch?.runContext?.mode || 'deepsearch';

        // 创建统一的 StageApi 工厂
        const stageApiFactory = StageApiFactory.fromWorkflowContext({
            signal: orch.signal,
            eventBus: orch.eventBus,
            emit: orch.emit,
            aiApiService: orch.runContext?.aiApiService,
            modelRouter: orch.runContext?.modelRouter,
            localRetriever: orch.runContext?.localRetriever,
            externalSearchProvider: orch.runContext?.externalSearchProvider,
            storageAdapter: orch.runContext?.storageAdapter,
            ocr: orch.runContext?.ocr,
            imageProvider: orch.runContext?.imageProvider || orch.runContext?.imageService,
            svgGenerator: orch.runContext?.svgGenerator,
            archive: orch.runContext?.archive,
            logger: orch.runContext?.logger,
        });

        if (runtimeMode === 'deepsearch') {
            orch.registerStage('deepsearch.ingest', async (ctx, input, api) => {
                const baseEmit = api.emit;
                const forwardEmit = (eventName, record) => {
                    baseEmit?.(eventName, record);
                    const p = record?.payload || {};

                    if (eventName === 'ingest.started') {
                        api.progress({ agent: 'AI 阅读', msg: `开始解析 ${p.inputCount || 0} 个输入...`, type: 'normal' });
                    }
                    if (eventName === 'ingest.doc.started') {
                        api.progress({ agent: 'AI 阅读', msg: `正在解析: ${p.origin || 'document'}...`, type: 'normal' });
                    }
                    if (eventName === 'ingest.doc.completed') {
                        api.progress({ agent: 'AI 阅读', msg: `解析完成: ${p.docId || 'doc'} (chunks=${p.chunkCount || 0})`, type: 'success' });
                    }
                    if (eventName === 'ingest.doc.failed') {
                        api.progress({ agent: 'AI 阅读', msg: `解析失败: ${p.origin || 'document'} (${p.error || 'unknown error'})`, type: 'warning' });
                    }
                    if (eventName === 'ingest.assets.understanding.progress') {
                        const current = p.current || p.step || 0;
                        const total = p.total || p.steps || 0;
                        api.progress({ agent: 'AI 阅读', msg: `图像理解中... ${total ? `${current}/${total}` : ''}`.trim(), type: 'normal' });
                    }
                    if (eventName === 'ingest.completed') {
                        api.progress({ agent: 'AI 阅读', msg: `素材解析完成: sources=${p.sourceCount || 0}`, type: 'success' });
                    }
                };

                const { IngestStage } = await import('../../agents/ingest/ingest-stage.js');
                const stage = new IngestStage();

                const stageApi = stageApiFactory.createDeepSearchApi({
                    emit: forwardEmit,
                    signal: api.signal,
                    checkCancelled: api.checkCancelled,
                    visionApi: api.visionApi,
                    whisperApi: api.whisperApi,
                });
                const out = await stage.execute(ctx, input, stageApi);
                return out;
            }, { actor: 'deepsearch', timeoutMs: 120_000 });

            // DeepSearch Agent Loop (V2 架构：Agent 自主决策)
            orch.registerStage('deepsearch.pipeline', async (ctx, input, api) => {
                const baseEmit = api.emit;
                const forwardEmit = (eventName, record) => {
                    baseEmit?.(eventName, record);
                    const p = record?.payload || record || {};

                    // 转发关键进度事件到 UI
                    if (eventName === 'deepsearch.agent.started') {
                        api.progress?.({ agent: 'AI 分析', msg: '深度搜索引擎启动...', type: 'normal' });
                    }
                    if (eventName === 'deepsearch.agent.status.changed') {
                        const statusMap = {
                            'observing': '观察当前状态...',
                            'thinking': '分析与决策...',
                            'acting': '执行操作...',
                            'reviewing': '审查结果...',
                        };
                        const msg = statusMap[p.to] || p.to;
                        if (msg) api.progress?.({ agent: 'AI 分析', msg, type: 'normal' });
                    }
                    if (eventName.includes('.progress')) {
                        const msg = p.msg || p.message || p.step;
                        if (msg) api.progress?.({ agent: 'AI 分析', msg: String(msg), type: 'normal' });
                    }
                    if (eventName === 'deepsearch.agent.completed') {
                        api.progress?.({ agent: 'AI 分析', msg: '深度搜索完成', type: 'success' });
                    }
                    if (eventName === 'deepsearch.agent.failed') {
                        api.progress?.({ agent: 'AI 分析', msg: `搜索失败: ${p.error || '未知错误'}`, type: 'error' });
                    }
                };

                try {
                    const { DeepSearchAgentLoop } = await import('../../agents/stages/deepsearch/deepsearch-agent-loop.js');

                    const agentLoop = new DeepSearchAgentLoop({
                        eventBus: this._orchestrator?.eventBus,
                    });

                    const stageApi = stageApiFactory.createDeepSearchApi({
                        emit: forwardEmit,
                        signal: api.signal,
                        checkCancelled: api.checkCancelled,
                        aiApiService: api.aiApiService,
                        modelRouter: api.modelRouter,
                        localRetriever: api.localRetriever,
                        externalSearchProvider: api.externalSearchProvider,
                    });

                    // 从 ingest 阶段获取 sources
                    const sources = this.workflowData?.sources || [];
                    const taskGoal = this.workflowData?.taskGoal || this._projectBrief?.taskGoal || '';
                    const userConfig = {
                        title: this._projectBrief?.projectSummary || taskGoal,
                        audience: this._projectBrief?.audience,
                        tone: this._projectBrief?.tone,
                        ...this.workflowData?.userConfig,
                    };

                    const contentPackage = await agentLoop.execute(
                        { runId: ctx?.runId || this._currentRunId, mode: 'deepsearch' },
                        { sources, taskGoal, userConfig },
                        stageApi
                    );

                    // 保存结果
                    this.workflowData.contentPackage = contentPackage;
                    this.workflowData.reportMarkdown = contentPackage?.report?.markdown || '';
                    this._deepsearchState = agentLoop._state; // 保留状态用于可视化

                    return contentPackage;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                    console.error('[deepsearch.pipeline] DeepSearchAgentLoop failed:', err);
                    api.progress?.({ agent: 'AI 分析', msg: `深度搜索失败: ${msg}`, type: 'error' });
                    throw err;
                }
            }, { actor: 'deepsearch', timeoutMs: 900_000 }); // 15 minutes for real LLM calls

            orch.registerStage('deepsearch.questions', async (ctx, input, api) => {
                api.progress?.({ agent: 'AI 分析', msg: '正在分析内容特征...', type: 'normal' });

                const contentPackage = this.workflowData?.contentPackage;
                const reportMd = this.workflowData?.reportMarkdown || contentPackage?.report?.markdown || '';

                // 基于内容特征生成问题
                const questions = [];

                // Q1: 受众
                questions.push({
                    text: "目标受众的技术背景如何？",
                    options: ["非技术高管 (侧重商业价值)", "技术团队 (侧重架构细节)", "混合受众"],
                    default: "混合受众"
                });

                // Q2: 风格
                questions.push({
                    text: "演示文稿的色调风格偏好？",
                    options: ["深色科技风 (Dark Modern)", "学术严谨 (Academic)", "商务极简 (Business Light)"],
                    default: reportMd.length > 5000 ? "学术严谨 (Academic)" : "商务极简 (Business Light)"
                });

                // Q3: 根据内容动态生成
                const hasNumbers = /\d+%|\$[\d,]+|\d+\.\d+/.test(reportMd);
                const hasCode = /```|`[^`]+`/.test(reportMd);

                if (hasNumbers) {
                    questions.push({
                        text: "是否需要包含详细的数据图表？",
                        options: ["是，包含详细图表", "否，仅展示关键指标摘要"],
                        default: "否，仅展示关键指标摘要"
                    });
                }

                if (hasCode) {
                    questions.push({
                        text: "代码片段的展示方式？",
                        options: ["完整展示关键代码", "仅展示伪代码/流程图", "省略代码细节"],
                        default: "仅展示伪代码/流程图"
                    });
                }

                // 如果没有特殊内容，添加默认问题
                if (questions.length < 3) {
                    questions.push({
                        text: "演示文稿的详细程度？",
                        options: ["精简要点 (5-8页)", "标准详细 (10-15页)", "深入完整 (15页以上)"],
                        default: "标准详细 (10-15页)"
                    });
                }

                const slideCount = contentPackage?.slideIntents?.length || 0;
                api.progress?.({
                    agent: 'AI 分析',
                    msg: `识别出 ${questions.length} 个关键决策点，预计生成 ${slideCount || '若干'} 页`,
                    type: 'success'
                });

                return questions;
            }, { actor: 'deepsearch', timeoutMs: 30_000 });
        }

        orch.registerStage('textprep.slideplan', async (ctx, input, api) => {
            // 如果已有完整的 contentPackage（来自 DeepSearch），跳过
            const existingPkg = this.workflowData?.contentPackage;
            if (existingPkg?.claims?.length > 0 && existingPkg?.slideIntents?.length > 0) {
                api.progress?.({ agent: 'AI 分析', msg: '使用 DeepSearch 生成的内容包', type: 'highlight' });
                return existingPkg;
            }

            // 获取原始文本
            const rawText = this.workflowData?.reportMarkdown ||
                            this.workflowData?.report?.markdown ||
                            this.workflowData?.contentPackage?.report?.markdown || '';

            if (!rawText.trim()) {
                api.progress?.({ agent: 'AI 分析', msg: '无输入文本，跳过 TextPrep', type: 'warning' });
                return this.workflowData?.contentPackage || null;
            }

            api.progress?.({ agent: 'AI 分析', msg: '正在分析文档结构...', type: 'normal' });

            try {
                const TextPrepStage = await getTextPrepStage();
                const stage = new TextPrepStage();

                const contentPackage = await stage.execute(
                    ctx || { runId: 'run_textprep', constraints: {} },
                    rawText,
                    {
                        emit: api.emit,
                        signal: api.signal,
                        aiApiService: api.aiApiService,
                        checkCancelled: api.checkCancelled,
                    }
                );

                // 更新 workflowData
                this.workflowData.contentPackage = contentPackage;
                this.workflowData.slideIntents = contentPackage?.slideIntents || [];

                const slideCount = contentPackage?.slideIntents?.length || 0;
                const claimCount = contentPackage?.claims?.length || 0;
                api.progress?.({ agent: 'AI 分析', msg: `TextPrep 完成：${slideCount} 页，${claimCount} 个论点`, type: 'success' });

                return contentPackage;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                api.progress?.({ agent: 'AI 分析', msg: `TextPrep 失败: ${msg}`, type: 'warning' });
                console.warn('[textprep.slideplan] TextPrepStage failed:', err);
                // 保持现有的简单 contentPackage
                return this.workflowData?.contentPackage || null;
            }
        }, { actor: 'textprep', timeoutMs: 180_000 });

        orch.registerStage('textprep.align', async (ctx, input, api) => {
            // textprep.slideplan 已经完成了完整流程，这里只是验证和进度报告
            const pkg = this.workflowData?.contentPackage;
            const slideCount = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents.length : 0;
            const claimCount = Array.isArray(pkg?.claims) ? pkg.claims.length : 0;

            api.progress?.({ agent: 'AI 设计', msg: `已准备 ${slideCount} 页布局，${claimCount} 个论点已分配`, type: 'normal' });

            // 如果 slideIntents 缺少 claimIds，尝试重新对齐
            const needsAlign = pkg?.slideIntents?.some(s => !Array.isArray(s.claimIds));
            if (needsAlign && pkg?.claims?.length > 0) {
                api.progress?.({ agent: 'AI 设计', msg: '正在优化论点分配...', type: 'normal' });
                // alignClaimsToSlides 已在 textprep.slideplan 中完成
            }

            api.progress?.({ agent: 'AI 设计', msg: '内容对齐完成', type: 'success' });
            return pkg;
        }, { actor: 'textprep', timeoutMs: 60_000 });

        orch.registerStage('design.batch', async (ctx, input, api) => {
            if (!this.workflowData) this.workflowData = {};
            this._ensureDesignSystemInitialized();
            const baseContentPackage = input?.contentPackage || this.workflowData?.contentPackage;
            const contentPackage = baseContentPackage && typeof baseContentPackage === 'object' ? baseContentPackage : null;
            const slideCount = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents.length : 0;

            const getSlideParser = () => {
                if (typeof SlideParser !== 'undefined') return SlideParser;
                if (typeof window !== 'undefined' && window?.SlideParser) return window.SlideParser;
                return null;
            };

            const makeMockDeckHtmlDsl = () => {
                const intents = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [];
                const safeIntents = intents.length ? intents : [{ title: '内容', pageType: 'content', slideIntentId: 'mock-1' }];
                return safeIntents.map((si, idx) => {
                    const title = String(si?.title || `Slide ${idx + 1}`).replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `
<section data-type="freeform" id="mock-slide-${idx + 1}" data-bg="#ffffff" data-title="${title}" data-layout="content">
  <div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-h="auto" data-font="40" data-color="#0f172a" data-bold="true">${title}</div>
  <div data-el="text" data-x="8%" data-y="22%" data-w="84%" data-h="auto" data-font="16" data-color="#334155">（设计引擎降级：使用模板占位内容）</div>
</section>`.trim();
                }).join('\n\n');
            };

            const parseAndStoreSlides = (deckHtmlDsl) => {
                if (typeof this._parseAndStoreSlides === 'function') {
                    this._parseAndStoreSlides(deckHtmlDsl);
                    return;
                }

                const parser = getSlideParser();
                if (!parser || typeof parser.parse !== 'function') return;
                try {
                    const slides = parser.parse(deckHtmlDsl);
                    if (Array.isArray(slides) && slides.length > 0) {
                        this.slides = slides;
                    }
                } catch (e) {
                    console.warn('[design.batch] SlideParser.parse failed:', e);
                }
            };

            const progress = (msg, type = 'normal') => {
                api.progress?.({ agent: 'AI 设计', msg, type });
            };

            const isEventRecordLike = (v) =>
                !!v && typeof v === 'object' && !Array.isArray(v) && ('actor' in v || 'status' in v || 'payload' in v);

            const forwardEmit = (eventName, recordOrPayload, extra) => {
                // Support both emit(name, EventRecord) and emit(name, payload, {status}).
                if (extra && typeof extra === 'object' && !isEventRecordLike(recordOrPayload)) {
                    api.emit?.(eventName, { actor: 'design', status: extra.status, payload: recordOrPayload });
                } else {
                    api.emit?.(eventName, recordOrPayload);
                }

                // Translate internal design events into human-readable stage logs.
                if (eventName === 'design.started') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    progress(`正在生成 PPT HTML DSL... (slides=${p.slideCount || slideCount || 0})`, 'normal');
                }
                if (eventName === 'design.tokens.ended') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    if (p?.theme) progress(`主题已确定: ${p.theme}`, 'highlight');
                }
                if (eventName === 'design.phase.transition') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    const label = formatDesignPhaseLabel(p?.to || p?.phase);
                    if (label) progress(`设计阶段：${label}`, 'detail');
                }
                if (eventName === 'design.batch.started') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    const range = Array.isArray(p.slideRange) ? `${p.slideRange[0]}-${p.slideRange[1]}` : '';
                    progress(`正在生成批次 ${typeof p.batchIndex === 'number' ? p.batchIndex + 1 : ''} ${range ? `(${range})` : ''}`.trim(), 'normal');
                }
                if (eventName === 'design.batch.progress') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    if (typeof p.doneSlides === 'number' && typeof p.totalSlides === 'number') {
                        progress(`已生成 ${p.doneSlides}/${p.totalSlides} 页`, 'normal');
                    }
                }
                if (eventName === 'design.qa.ended') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    if (typeof p.degradedCount === 'number' && p.degradedCount > 0) {
                        progress(`质量检查完成：${p.degradedCount} 页已降级为安全模板`, 'highlight');
                    } else {
                        progress('质量检查完成', 'success');
                    }
                }
                if (eventName === 'design.ended') {
                    progress('设计阶段完成', 'success');
                }
            };

            const persistDeckPackage = (deckPackage) => {
                if (!deckPackage || typeof deckPackage !== 'object') return;
                const deckHtmlDsl = deckPackage.deckHtmlDsl;
                if (typeof deckHtmlDsl === 'string') {
                    this.workflowData.deckPackage = deckPackage;
                    this.workflowData.deckHtmlDsl = deckHtmlDsl;
                    this.sampleHTML = deckHtmlDsl;
                    parseAndStoreSlides(deckHtmlDsl);
                } else {
                    this.workflowData.deckPackage = deckPackage;
                }

                if (deckPackage?.degraded) {
                    forwardEmit('design.degraded', {
                        reason: deckPackage.degradedReason,
                        error: deckPackage.degradedError,
                        degradedAt: deckPackage.degradedAt,
                        ...(slideCount > 0 ? { degradedCount: slideCount } : {}),
                    }, { status: 'warn' });
                }
            };

            // PPTX deck branch: if upstream provides a ready HTML DSL template, skip generation.
            const templateDeckHtmlDsl =
                typeof contentPackage?.templateDeckHtmlDsl === 'string' ? contentPackage.templateDeckHtmlDsl : null;
            if (templateDeckHtmlDsl && templateDeckHtmlDsl.includes('<section')) {
                progress('检测到模板 Deck 输入（PPTX 导入），直接载入模板...', 'highlight');
                const slidesMeta = (Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : []).map((si, idx) => ({
                    slideNo: idx + 1,
                    slideIntentId: si?.slideIntentId,
                    pageType: si?.pageType,
                    title: si?.title,
                    degraded: false,
                    source: 'pptx_template',
                    qa: { pass: true, reasons: [] },
                }));

                const deckPackage = {
                    schemaVersion: '0.1',
                    runId: ctx?.runId || 'run_unknown',
                    deckHtmlDsl: templateDeckHtmlDsl,
                    slidesMeta,
                    editHints: { degradedCount: 0 },
                };

                persistDeckPackage(deckPackage);
                progress(`模板载入完成：${slidesMeta.length || slideCount || 0} 页`, 'success');
                return deckPackage;
            }

            if (!contentPackage || slideCount === 0) {
                progress('未检测到 slideIntents，使用模板占位内容', 'warning');
                const deckHtmlDsl = makeMockDeckHtmlDsl();
                const deckPackage = {
                    schemaVersion: '0.1',
                    runId: ctx?.runId || 'run_unknown',
                    deckHtmlDsl,
                    slidesMeta: []
                };

                persistDeckPackage(deckPackage);
                return deckPackage;
            }

            try {
                progress(slideCount ? `正在生成 ${slideCount} 页的页面布局...` : '正在生成页面布局...', 'normal');

                const { DesignAgentLoop } = await import('../../agents/stages/design/index.js');
                const batchSize = Number(this.workflowData?.batchSize) || Number(this.workflowData?.designBatchSize) || undefined;
                const stage = new DesignAgentLoop(batchSize ? { batchSize } : undefined);

                const deckPackage = await stage.execute(
                    { ...(ctx || {}), userConfig: this._getDesignStageUserConfig() },
                    contentPackage,
                    {
                        emit: forwardEmit,
                        eventBus: this._orchestrator?.eventBus,
                        signal: api.signal,
                        aiApiService: api.aiApiService,
                        modelRouter: api.modelRouter
                    }
                );

                const deckHtmlDsl = deckPackage?.deckHtmlDsl;
                if (typeof deckHtmlDsl !== 'string' || !deckHtmlDsl.includes('<section')) {
                    throw new Error('DesignAgentLoop returned invalid deckHtmlDsl');
                }

                persistDeckPackage(deckPackage);

                progress(`设计完成：已生成 ${Array.isArray(deckPackage?.slidesMeta) ? deckPackage.slidesMeta.length : slideCount} 页`, 'success');
                return deckPackage;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                console.warn('[design.batch] DesignAgentLoop failed, falling back to mock:', err);
                progress(`设计引擎异常，降级为模板：${msg}`, 'warning');

                const deckHtmlDsl = makeMockDeckHtmlDsl();
                const deckPackage = {
                    schemaVersion: '0.1',
                    runId: ctx?.runId || 'run_unknown',
                    deckHtmlDsl,
                    slidesMeta: [],
                    degraded: true,
                    degradedReason: 'design_failed',
                    degradedError: msg,
                    degradedAt: Date.now(),
                };

                persistDeckPackage(deckPackage);
                return deckPackage;
            }
        }, { actor: 'design', timeoutMs: (() => {
            try {
                const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ppt_designConcurrency') : null;
                if (raw) {
                    const cfg = JSON.parse(raw);
                    if (typeof cfg?.designTimeoutMs === 'number' && cfg.designTimeoutMs > 0) {
                        return cfg.designTimeoutMs;
                    }
                }
            } catch (_) {}
            return 600_000; // 10 minutes default
        })() });

        orch.registerStage('evaluate.hardgates', async (ctx, input, api) => {
            api.progress?.({ agent: 'AI 审查', msg: '正在验证输出质量...', type: 'normal' });

            try {
                const { EvaluateStage } = await import('../../agents/eval/index.js');
                const stage = new EvaluateStage();

                const contentPackage = this.workflowData?.contentPackage;
                const deckPackage = this.workflowData?.deckPackage;

                if (!deckPackage?.deckHtmlDsl) {
                    api.progress?.({ agent: 'AI 审查', msg: '跳过验证（无 deck 输出）', type: 'warning' });
                    return null;
                }

                const report = await stage.execute(
                    ctx || { runId: 'run_eval', constraints: {} },
                    { contentPackage, deckPackage },
                    undefined,
                    { emit: api.emit, signal: api.signal }
                );

                const pass = report?.hardGates?.pass ?? true;
                const failedCount = report?.hardGates?.failed?.length || 0;

                if (pass) {
                    api.progress?.({ agent: 'AI 审查', msg: '所有质量检查已通过', type: 'success' });
                } else {
                    api.progress?.({ agent: 'AI 审查', msg: `${failedCount} 项检查未通过，但继续生成`, type: 'warning' });
                }

                this.workflowData.evaluationReport = report;
                return report;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[evaluate.hardgates] EvaluateStage failed:', err);
                api.progress?.({ agent: 'AI 审查', msg: `验证跳过: ${msg}`, type: 'warning' });
                return null;
            }
        }, { actor: 'evaluate', timeoutMs: 60_000 });
    },
};
