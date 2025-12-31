/**
 * Workflow Runtime Mixin
 * 设计系统、报告审阅面板、运行时 orchestrator 与事件处理
 */

import { WorkflowState, transitionWorkflow, forceWorkflowState } from './workflow-states.js';
import { WorkflowTodoStatus } from '../../agents/runtime/core/constants.js';
import { StagePausedError } from '../../agents/runtime/core/stage-errors.js';
import { StepStatus } from '../../agents/runtime/core/agent-status.js';
import { RunStoreAdapter } from '../../agents/runtime/events/event-bus.js';
import { subscribeTelemetry } from '../../agents/runtime/telemetry/runstore-telemetry.js';
import { RunReplayController } from '../../agents/runtime/telemetry/replay-controller.js';
import { StageApiFactory } from '../../agents/runtime/api/stage-api-factory.js';
import { RunStore } from '../../agents/storage/run-store.js';
import { exportRunAsZip, importRunFromZip } from '../../agents/storage/run-exporter.js';
import { DesignDensity, DesignVisualMode, normalizeDesignDensity, normalizeDesignVisualMode } from '../design/design-preferences.js';
import { AgentEventBridge } from './agent-event-bridge.js';
import { EventHandlerRegistry, createWorkflowEventRegistry } from './event-handler-registry.js';
import { StateSynchronizer, inferWorkflowStateFromEvent } from './unified-state-mapping.js';
import { PLAN_ARTIFACT_TYPE, PlanLifecycleStatus, createPlan, savePlan, setPlanLifecycleStatus, setPlanStepStatus } from '../../agents/runtime/plan/plan-store.js';

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

const WORKFLOW_PLAN_KIND = "workflow_plan";
const WORKFLOW_PLAN_STEP_ORDER = Object.freeze([
    "deepsearch.ingest",
    "deepsearch.pipeline",
    "workflow.script_review",
    "textprep.align",
    "design.batch",
    "evaluate.hardgates",
]);

const WORKFLOW_PLAN_STEP_TODO_INDEX = Object.freeze({
    "deepsearch.ingest": 0,
    "deepsearch.pipeline": 1,
    "workflow.script_review": 2,
    "textprep.align": 3,
    "design.batch": 4,
    "evaluate.hardgates": 5,
});

const WORKFLOW_PLAN_STAGE_MAP = Object.freeze({
    "deepsearch.ingest": { stepId: "deepsearch.ingest", completesStep: true },
    "deepsearch.pipeline": { stepId: "deepsearch.pipeline", completesStep: true },
    // textprep.slideplan is part of "page layout & mapping" but does not complete the step alone.
    "textprep.slideplan": { stepId: "textprep.align", completesStep: false },
    "textprep.align": { stepId: "textprep.align", completesStep: true },
    "design.batch": { stepId: "design.batch", completesStep: true },
    "evaluate.hardgates": { stepId: "evaluate.hardgates", completesStep: true },
});

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
    _ensureRunLogStore() {
        if (!this.workflowData) this.workflowData = {};
        if (!Array.isArray(this.workflowData.runLogs)) this.workflowData.runLogs = [];
        return this.workflowData.runLogs;
    },
    _appendRunLog(entry) {
        const logs = this._ensureRunLogStore();
        if (!entry || typeof entry !== 'object') return;
        const coalesceKey = typeof entry.coalesceKey === 'string' ? entry.coalesceKey : '';
        const last = logs.length ? logs[logs.length - 1] : null;
        if (coalesceKey && last && typeof last === 'object' && last.coalesceKey === coalesceKey) {
            last.timestamp = entry.timestamp;
            last.message = entry.message;
            last.details = entry.details;
            last.level = entry.level;
            last.eventName = entry.eventName;
        } else {
            logs.push(entry);
        }
        if (logs.length > 800) this.workflowData.runLogs = logs.slice(-800);
    },
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

        // Plan step boundary (manual confirmation step).
        this._setWorkflowPlanStepStatus?.("workflow.script_review", StepStatus.COMPLETED, {
            reason: "script_confirmed",
            select: false,
        })?.catch?.(() => { });
        this._setWorkflowPlanStepStatus?.("textprep.align", StepStatus.IN_PROGRESS, {
            reason: "script_confirmed.next",
            select: true,
        })?.catch?.(() => { });

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
        const canRenderPanel = typeof this.addProcessPanelStep === 'function';

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

        // Pipe agent-side structured logs into the same process panel (legacy dashboard).
        // Agents emit `deepsearch.log.<level>` and `design.log.<level>`; surface them as `log.*`.
        const logMatch = typeof name === 'string'
            ? name.match(/^(deepsearch|design)\.log\.(debug|info|warn|error)$/)
            : null;
        if (logMatch) {
            const domain = logMatch[1];
            const level = logMatch[2];
            const message = typeof normalizedPayload?.message === 'string' ? normalizedPayload.message : '';
            const stage = typeof normalizedPayload?.stage === 'string' ? normalizedPayload.stage : '';
            const details = {};
            const label = domain === 'design' ? 'Design' : 'DeepSearch';
            details.agent = stage ? `${label}:${stage}` : label;

            const extra = normalizedPayload?.data && typeof normalizedPayload.data === 'object' ? normalizedPayload.data : null;
            if (extra?.reason) details.reason = extra.reason;
            if (extra?.error) details.error = extra.error;
            if (typeof normalizedPayload?.iteration === 'number') details.iteration = normalizedPayload.iteration + 1;

            const mappedLevel = level === 'warn' ? 'warning' : level;
            if (message) {
                this._appendRunLog({
                    timestamp: Date.now(),
                    scope: domain,
                    level: mappedLevel,
                    eventName: name,
                    message,
                    stage: stage || null,
                    iteration: typeof normalizedPayload?.iteration === 'number' ? normalizedPayload.iteration + 1 : null,
                    details,
                });
            }
            if (mappedLevel === 'warning' || mappedLevel === 'error') {
                try {
                    this.logTerminal?.(details.agent || label, message, mappedLevel === 'error' ? 'warning' : 'normal');
                } catch {
                    // ignore
                }
            }
            if (message) {
                if (canRenderPanel) {
                    this.addProcessPanelStep({
                        name: `log.${mappedLevel}`,
                        text: message,
                        details,
                    });
                }
            }
            return;
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
            'deepsearch.todos.started': '正在生成研究待办',
            'deepsearch.todos.completed': `生成了 ${normalizedPayload?.todoCount || 0} 条研究待办`,
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

        const details =
            compressionDetails ? compressionDetails :
            normalizedPayload?.todoCount ? { todos: normalizedPayload.todoCount } :
            normalizedPayload?.totalTodos ? { todos: normalizedPayload.totalTodos } :
            normalizedPayload?.totalGaps ? { gaps: normalizedPayload.totalGaps } :
            normalizedPayload?.iteration !== undefined ? { iteration: normalizedPayload.iteration + 1 } :
            phaseLabel ? { phase: phaseLabel } :
            normalizedPayload?.slideRange ? { slides: normalizedPayload.slideRange.join('-') } :
            Number.isFinite(totalIdeas) ? { ideas: totalIdeas } :
            typeof normalizedPayload?.planned === 'number' ? { planned: normalizedPayload.planned } :
            typeof normalizedPayload?.slides === 'number' ? { slides: normalizedPayload.slides } :
            typeof normalizedPayload?.degradedCount === 'number' ? { degraded: normalizedPayload.degradedCount } :
            typeof normalizedPayload?.slideNo === 'number' ? { slide: normalizedPayload.slideNo } :
            null;

        const progressMatch = String(text).match(/(\d+)\s*\/\s*(\d+)/);
        const progressPrefix = progressMatch ? String(text).replace(/\d+\s*\/\s*\d+.*$/, '').trim() : '';
        const level =
            String(name).includes('failed') || String(name).includes('.error') ? 'error' :
            String(name).startsWith('compression.forced') ? 'warning' :
            String(name).includes('paused') ? 'warning' :
            'info';
        this._appendRunLog({
            timestamp: Date.now(),
            scope: String(name).split('.')[0] || 'event',
            level,
            eventName: name,
            message: text,
            details,
            ...(progressPrefix ? { coalesceKey: `progress:${progressPrefix}` } : {}),
        });

        if (!canRenderPanel) return;

        this.addProcessPanelStep({ name, text, details });
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
    async _ensureRuntime({ mode = 'deepsearch', scenario = 'business', constraints = {}, runId } = {}) {
        const requestedRunId = typeof runId === 'string' && runId.trim() ? runId.trim() : null;

        if (this._orchestrator && this._orchestrator.state === 'running') {
            const activeRunId = this._orchestrator?.runId || this._currentRunId;
            if (!requestedRunId || requestedRunId === activeRunId) return;
            throw new Error(`_ensureRuntime({ runId }): cannot switch runId while running (current=${activeRunId}, requested=${requestedRunId})`);
        }

        const mod = await import('../../agents/runtime/orchestrator.js');
        const { AgentOrchestrator } = mod;

	        const baseAiApiService = typeof window !== 'undefined' && window.aiApiService ? window.aiApiService : null;
	        const visionApi = typeof window !== 'undefined' && window.visionApi ? window.visionApi : null;
	        const whisperApi = typeof window !== 'undefined' && window.whisperApi ? window.whisperApi : null;
	        const isNode = typeof process !== 'undefined' && !!process.versions?.node;
	
	        // Browser-only LLM rate limiting (kept disabled in Node/test runs).
	        let llmRateLimiter = null;
	        if (!isNode) {
	            try {
	                const { TokenBucketRateLimiter, loadRateLimitConfig } = await import('../../agents/llm/rate-limit.js');
	                const cfg = loadRateLimitConfig();
	                if (cfg?.enabled !== false) {
	                    llmRateLimiter = new TokenBucketRateLimiter(cfg);
	                    this._llmRateLimiter = llmRateLimiter;
	                    if (typeof window !== 'undefined') window.pbLlmRateLimiter = llmRateLimiter;
	                }
	            } catch (err) {
	                console.warn('[PPTGeneratorWorkflow] RateLimiter init skipped:', err);
	                this._llmRateLimiter = null;
	            }
	        } else {
	            this._llmRateLimiter = null;
	        }
	
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
	
	                        const runAttempt = () => {
	                            if (!llmRateLimiter) return attemptCall();
	                            return llmRateLimiter.schedule(() => attemptCall(), {
	                                signal,
	                                label: `provider.chat:${modelId || 'auto'}`
	                            });
	                        };
	
	                        try {
	                            return await runAttempt();
	                        } catch (err) {
	                            if (err?.name === 'AbortError') throw err;
	                            const status = err?.status || err?.response?.status || (err?.message?.match?.(/4\d{2}/)?.[0]);
	                            // 对于 401/429，等待 2 秒后重试一次（可能是限流）
	                            if (status === 401 || status === 429 || status === '401' || status === '429') {
	                                console.warn('[PPTGeneratorWorkflow] Rate limit detected, retrying in 2s...', { status });
	                                if (llmRateLimiter) llmRateLimiter.blockFor(2000);
	                                else await new Promise(r => setTimeout(r, 2000));
	                                return await runAttempt();
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
	
	        if (llmRateLimiter && aiApiService && typeof aiApiService.chat === 'function') {
	            try {
	                const rawChat = aiApiService.chat.bind(aiApiService);
	                const rawCallApi = typeof aiApiService._callApi === 'function' ? aiApiService._callApi.bind(aiApiService) : null;
	
	                aiApiService = {
	                    ...aiApiService,
	                    chat: async (opts = {}) => {
	                        const signal = opts?.signal;
	                        try {
	                            return await llmRateLimiter.schedule(() => rawChat(opts), { signal, label: 'aiApiService.chat' });
	                        } catch (err) {
	                            if (err?.name === 'AbortError') throw err;
	                            const status = err?.status || err?.response?.status || (err?.message?.match?.(/4\\d{2}/)?.[0]);
	                            if (status === 429 || status === '429') llmRateLimiter.blockFor(2000);
	                            throw err;
	                        }
	                    },
	                    ...(rawCallApi ? {
	                        _callApi: (...args) => {
	                            const maybeOpts = args?.[4];
	                            const signal = maybeOpts?.signal;
	                            return llmRateLimiter.schedule(() => rawCallApi(...args), { signal, label: 'aiApiService._callApi' });
	                        }
	                    } : {})
	                };
	            } catch (err) {
	                console.warn('[PPTGeneratorWorkflow] Rate-limited aiApiService wrapper failed:', err);
	            }
	        }
	
	        const services = {
	            aiApiService,
	            modelRouter,
	            visionApi,
            whisperApi,
        };

        // Browser-only workspace VFS (OPFS preferred). This stays optional and never blocks runtime boot.
        if (!services.vfs) {
            try {
                const { createVfs } = await import('../../agents/vfs/index.js');
                const vfs = await createVfs({ kind: 'opfs', rootDirName: 'paper-burner-workspace' });
                services.vfs = vfs;
                this._vfs = vfs;
            } catch (err) {
                // In Node/tests or older browsers, OPFS may be unavailable.
                this._vfs = null;
            }
        }

        // runId: allow resuming an existing run (browser-only).
        const resolvedRunId = requestedRunId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this._currentRunId = resolvedRunId;

        const keepPlan = this._workflowPlan && this._workflowPlan.runId === resolvedRunId;
        if (!keepPlan) {
            this._workflowPlan = null;
            this._workflowPlanLatestArtifactId = null;
        }

        // 尝试创建持久化 EventBus，IndexedDB 不可用时降级为内存模式
	        let persistenceAdapter = null;
	        try {
	            this._runStore = new RunStore({ dbName: 'PPTWorkflowDB' });
	            await this._runStore.open();
	            persistenceAdapter = new RunStoreAdapter(this._runStore);
                services.runStore = this._runStore;

            // Best-effort run registry (enables listRuns() to work for locally created runs).
            if (typeof this._runStore?.getRun === 'function' && typeof this._runStore?.createRun === 'function') {
                try {
                    const existing = await this._runStore.getRun(this._currentRunId);
                    if (!existing) {
                        const now = new Date().toISOString();
                        const briefGoal = typeof this.workflowData?.projectBrief?.taskGoal === 'string' ? this.workflowData.projectBrief.taskGoal.trim() : '';
                        const legacyGoal = typeof this.workflowData?.taskGoal === 'string' ? this.workflowData.taskGoal.trim() : '';
                        const taskGoal = briefGoal || legacyGoal || '';
                        const title = taskGoal || '';

                        await this._runStore.createRun({
                            schemaVersion: '0.1',
                            runId: this._currentRunId,
                            mode,
                            scenario,
                            constraints,
                            startedAt: now,
                            createdAt: now,
                            ...(title ? { title, taskGoal } : {}),
                            tags: [],
                        });
                    }
                } catch {
                    // ignore
                }
            }
	        } catch (err) {
	            console.warn('[Workflow] IndexedDB not available, running without persistence:', err?.message || err);
	            this._runStore = null;
	        }

            // Persistent Archive for checkpoints (Design resume). IndexedDB preferred; memory fallback.
            if (!services.archive) {
                try {
                    const { Archive, FallbackAdapter, MapAdapter } = await import('../../agents/shared/archive/archive.js');
                    const adapter =
                        typeof indexedDB !== 'undefined'
                            ? new FallbackAdapter('PPTArchiveDB', 'checkpoints')
                            : new MapAdapter();
                    services.archive = new Archive(adapter);
                } catch {
                    // ignore
                }
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

        // Policy/Approval manager (optional, browser-first). Emits policy.* events onto the same EventBus for audit/replay.
        try {
            const { PolicyManager } = await import('../../agents/runtime/policy/manager.js');
            services.policy = new PolicyManager({
                eventBus,
                runStore: this._runStore,
                runId: this._currentRunId,
                defaultEffect: 'prompt',
            });
        } catch {
            // ignore (policy is optional)
        }

        // SideEffectJournal (optional): track reversible side effects (e.g. VFS writes via vfs_checkpoint.json)
        // so Backtrack/undo can restore "physical" state along with in-memory state.
        try {
            const { SideEffectJournal } = await import('../../agents/runtime/side-effects/side-effect-journal.js');
            const sideEffects = new SideEffectJournal({
                runStore: this._runStore,
                runId: this._currentRunId,
                vfs: services.vfs,
                eventBus,
                logger: console,
            });
            sideEffects.attachEventBus(eventBus);
            // Best-effort hydration when resuming a run.
            await sideEffects.loadFromRunStore({ runId: this._currentRunId }).catch(() => { });
            services.sideEffects = sideEffects;
            this._sideEffects = sideEffects;
            if (typeof window !== 'undefined') window.pbSideEffects = sideEffects;
        } catch {
            // ignore
        }

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

    _emitPlanEvent(name, payload, { status = "info", actor = "system" } = {}) {
        const bus = this._orchestrator?.eventBus;
        if (!bus || typeof bus.emit !== "function") return null;
        try {
            return bus.emit(name, { actor, status, payload });
        } catch (err) {
            console.warn("[Workflow] Failed to emit plan event:", err?.message || err);
            return null;
        }
    },

    _getWorkflowPlanTitle() {
        const mode = this._orchestrator?.runContext?.mode;
        if (typeof mode === "string" && mode) return `Workflow Plan (${mode})`;
        return "Workflow Plan";
    },

    _getWorkflowPlanStepTitle(stepId) {
        const idx = WORKFLOW_PLAN_STEP_TODO_INDEX[stepId];
        const rows = Array.isArray(this._runtimeTodoTexts) ? this._runtimeTodoTexts : [];
        if (Number.isFinite(idx) && typeof rows[idx] === "string" && rows[idx]) return rows[idx];
        return stepId;
    },

    async _ensureWorkflowPlan({ runId } = {}) {
        const id = typeof runId === "string" && runId ? runId : (this._currentRunId || this._orchestrator?.runId);
        if (!id) return null;

        if (this._workflowPlan && this._workflowPlan.runId === id) return this._workflowPlan;

        const steps = WORKFLOW_PLAN_STEP_ORDER.map((stepId, i) => ({
            stepId,
            title: this._getWorkflowPlanStepTitle(stepId),
            status: StepStatus.PENDING,
        }));

        const plan = createPlan({
            runId: id,
            kind: WORKFLOW_PLAN_KIND,
            title: this._getWorkflowPlanTitle(),
            steps,
            selectedStepIndex: 0,
            lifecycleStatus: PlanLifecycleStatus.APPROVED,
            meta: {
                mode: this._orchestrator?.runContext?.mode,
                scenario: this._orchestrator?.runContext?.scenario,
            },
        });

        this._workflowPlan = plan;

        if (this._runStore) {
            try {
                const artifactId = await savePlan({ runStore: this._runStore, runId: id, plan, type: PLAN_ARTIFACT_TYPE });
                this._workflowPlanLatestArtifactId = artifactId;
                this._emitPlanEvent("plan.created", {
                    runId: id,
                    planId: plan.planId,
                    kind: plan.kind,
                    title: plan.title,
                    lifecycleStatus: plan.lifecycleStatus,
                    artifactId,
                    stepCount: plan.steps.length,
                }, { status: "created" });
            } catch (err) {
                console.warn("[Workflow] Failed to persist initial plan:", err?.message || err);
            }
        } else {
            this._emitPlanEvent("plan.created", {
                runId: id,
                planId: plan.planId,
                kind: plan.kind,
                title: plan.title,
                lifecycleStatus: plan.lifecycleStatus,
                artifactId: null,
                stepCount: plan.steps.length,
            }, { status: "created" });
        }

        return this._workflowPlan;
    },

    async _persistWorkflowPlan({ reason, eventName } = {}) {
        const plan = this._workflowPlan;
        const runId = this._currentRunId || plan?.runId;
        if (!plan || !runId) return null;

        let artifactId = this._workflowPlanLatestArtifactId || null;
        if (this._runStore) {
            try {
                artifactId = await savePlan({ runStore: this._runStore, runId, plan, type: PLAN_ARTIFACT_TYPE });
                this._workflowPlanLatestArtifactId = artifactId;
            } catch (err) {
                console.warn("[Workflow] Failed to persist plan:", err?.message || err);
            }
        }

        const steps = Array.isArray(plan.steps) ? plan.steps : [];
        this._emitPlanEvent("plan.updated", {
            runId,
            planId: plan.planId,
            kind: plan.kind,
            title: plan.title,
            artifactId,
            lifecycleStatus: plan.lifecycleStatus,
            selectedStepIndex: plan.selectedStepIndex,
            stepCount: steps.length,
            steps: steps.map((s) => ({ stepId: s.stepId, status: s.status })),
            reason: typeof reason === "string" ? reason : null,
            eventName: typeof eventName === "string" ? eventName : null,
        }, { status: "updated" });

        return artifactId;
    },

    async _setWorkflowPlanLifecycleStatus(status, { reason, runId, force = false } = {}) {
        const plan = await this._ensureWorkflowPlan({ runId: typeof runId === "string" ? runId : this._currentRunId });
        if (!plan) return null;

        let next;
        try {
            next = setPlanLifecycleStatus(plan, status, { force });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Workflow] Failed to update plan lifecycleStatus: ${msg}`);
            return null;
        }

        if (next === plan) return null;
        this._workflowPlan = next;
        return await this._persistWorkflowPlan({
            reason: typeof reason === "string" ? reason : `lifecycle:${String(status)}`,
        });
    },

    async _setWorkflowPlanStepStatus(stepId, status, { reason, select = true } = {}) {
        const plan = await this._ensureWorkflowPlan({ runId: this._currentRunId });
        if (!plan) return null;

        const next = setPlanStepStatus(plan, stepId, status, { select });
        if (next === plan) return null;
        this._workflowPlan = next;

        return await this._persistWorkflowPlan({
            reason: typeof reason === "string" ? reason : `manual:${String(stepId)}`,
        });
    },

    _updateWorkflowPlanFromStageLifecycle(stageName, stageStatus, payload, evt) {
        const stage = typeof stageName === "string" ? stageName : "";
        const mapping = WORKFLOW_PLAN_STAGE_MAP[stage];
        if (!mapping) return;

        const status = typeof stageStatus === "string" ? stageStatus : "";
        const runId = this._currentRunId || payload?.runId;

        const doUpdate = async () => {
            await this._ensureWorkflowPlan({ runId });

            let plan = this._workflowPlan;
            if (!plan) return;

            if (status === "started") {
                plan = setPlanStepStatus(plan, mapping.stepId, StepStatus.IN_PROGRESS);
                try {
                    plan = setPlanLifecycleStatus(plan, PlanLifecycleStatus.IN_PROGRESS);
                } catch {
                    plan = setPlanLifecycleStatus(plan, PlanLifecycleStatus.IN_PROGRESS, { force: true });
                }
            } else if (status === "failed") {
                plan = setPlanStepStatus(plan, mapping.stepId, StepStatus.FAILED);
                try {
                    plan = setPlanLifecycleStatus(plan, PlanLifecycleStatus.FAILED);
                } catch {
                    plan = setPlanLifecycleStatus(plan, PlanLifecycleStatus.FAILED, { force: true });
                }
            } else if (status === "ended") {
                if (mapping.completesStep) {
                    plan = setPlanStepStatus(plan, mapping.stepId, StepStatus.COMPLETED, { select: false });
                }
            }

            // Manual gap: deepsearch pipeline ends -> script review begins (no stage boundary).
            if (stage === "deepsearch.pipeline" && status === "ended") {
                plan = setPlanStepStatus(plan, "workflow.script_review", StepStatus.IN_PROGRESS);
            }

            // When all steps are completed, mark the plan as completed.
            if (status === "ended") {
                const steps = Array.isArray(plan.steps) ? plan.steps : [];
                const allDone = steps.length > 0 && steps.every((s) => s?.status === StepStatus.COMPLETED);
                if (allDone) {
                    try {
                        plan = setPlanLifecycleStatus(plan, PlanLifecycleStatus.COMPLETED);
                    } catch {
                        plan = setPlanLifecycleStatus(plan, PlanLifecycleStatus.COMPLETED, { force: true });
                    }
                }
            }

            if (plan !== this._workflowPlan) {
                this._workflowPlan = plan;
                await this._persistWorkflowPlan({
                    reason: `stage:${stage}.${status}`,
                    eventName: evt?.name,
                });
            }
        };

        return doUpdate().catch(() => { });
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

    async getReplayController({ runId, speed, maxDelayMs } = {}) {
        if (!this._orchestrator?.eventBus || !this._runStore) {
            console.warn('[Workflow] Cannot replay: runStore/eventBus not available');
            return null;
        }

        if (!this._replayController) {
            this._replayController = new RunReplayController({
                runStore: this._runStore,
                eventBus: this._orchestrator.eventBus,
                speed,
                maxDelayMs,
            });
        } else {
            if (Number.isFinite(speed)) this._replayController.setSpeed(speed);
            if (Number.isFinite(maxDelayMs)) this._replayController.maxDelayMs = Math.max(0, Number(maxDelayMs));
        }

        if (runId) {
            await this._replayController.load(runId);
        }

        return this._replayController;
    },

    async startReplay(runId, options = {}) {
        const controller = await this.getReplayController({ runId, ...options });
        if (!controller) return null;
        controller.play({ fromIndex: options.fromIndex, speed: options.speed });
        return controller;
    },

    pauseReplay() {
        this._replayController?.pause();
    },

    resumeReplay() {
        this._replayController?.play();
    },

    stopReplay() {
        this._replayController?.stop();
    },

    seekReplay({ index, offsetMs } = {}) {
        this._replayController?.seek({ index, offsetMs });
    },

    stepReplay() {
        this._replayController?.step();
    },

    getReplayState() {
        return this._replayController?.state || null;
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

    async getRunContext(runId) {
        const store = await this._ensureRunStoreOpen();
        const id = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
        if (!store || !id || typeof store.getRun !== 'function') return null;
        try {
            return await store.getRun(id);
        } catch (err) {
            console.warn('[Workflow] Failed to get run context:', err);
            return null;
        }
    },

    async updateRunContext(runId, patch, options = {}) {
        const store = await this._ensureRunStoreOpen();
        const id = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
        if (!store || !id || typeof store.updateRunContext !== 'function') {
            throw new Error('updateRunContext(runId, patch): RunStore unavailable');
        }
        return await store.updateRunContext(id, patch, options);
    },

    async deleteRun(runId) {
        const store = await this._ensureRunStoreOpen();
        const id = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
        if (!store || !id || typeof store.deleteRun !== 'function') {
            throw new Error('deleteRun(runId): RunStore unavailable');
        }

        const activeRunId = this._orchestrator?.runId || this._currentRunId;
        if (id && activeRunId && id === activeRunId) {
            throw new Error(`deleteRun(runId): cannot delete active run (${id})`);
        }

        await store.deleteRun(id);
        return { ok: true, runId: id };
    },

    async exportRunZip(runId) {
        if (!this._runStore) {
            throw new Error('RunStore not available (IndexedDB unavailable?)');
        }
        const id = typeof runId === 'string' && runId ? runId : this._currentRunId;
        if (!id) throw new Error('exportRunZip(runId): missing runId');
        return exportRunAsZip(id, { runStore: this._runStore });
    },

    async downloadRunZip(runId) {
        const blob = await this.exportRunZip(runId);
        const id = typeof runId === 'string' && runId ? runId : this._currentRunId;

        if (typeof document === 'undefined' || typeof URL === 'undefined') return blob;
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `paper-burner-run-${id || Date.now()}.zip`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }

        return blob;
    },

    async importRunZip(file, { overwrite = true } = {}) {
        if (!file) throw new Error('importRunZip(file): file is required');

        if (!this._runStore) {
            try {
                this._runStore = new RunStore({ dbName: 'PPTWorkflowDB' });
                await this._runStore.open();
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`importRunZip(file): RunStore unavailable: ${msg}`);
            }
        }

        const runId = await importRunFromZip(file, { runStore: this._runStore, overwrite });
        return runId;
    },

    async _ensureRunStoreOpen() {
        if (this._runStore) return this._runStore;
        try {
            this._runStore = new RunStore({ dbName: 'PPTWorkflowDB' });
            await this._runStore.open();
        } catch (err) {
            console.warn('[Workflow] RunStore unavailable:', err?.message || err);
            this._runStore = null;
        }
        return this._runStore;
    },

    async _loadLatestWorkflowPlanArtifact(runId) {
        const store = await this._ensureRunStoreOpen();
        const id = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
        if (!store || !id || typeof store.listArtifacts !== 'function') return null;

        let latest = null;
        try {
            if (typeof store.getLatestArtifactSummary === 'function') {
                latest = await store.getLatestArtifactSummary(id, PLAN_ARTIFACT_TYPE);
            } else {
                let artifacts = [];
                try {
                    artifacts = await store.listArtifacts(id);
                } catch {
                    artifacts = [];
                }

                const plans = artifacts
                    .filter((a) => a && typeof a === 'object' && a.type === PLAN_ARTIFACT_TYPE && typeof a.artifactId === 'string')
                    .sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));

                latest = plans[0] || null;
            }
        } catch {
            latest = null;
        }

        if (!latest || typeof latest.artifactId !== 'string' || !latest.artifactId) return null;

        let plan = null;
        try {
            plan =
                typeof store.getArtifactById === 'function'
                    ? await store.getArtifactById(latest.artifactId)
                    : await store.getArtifact(id, PLAN_ARTIFACT_TYPE);
        } catch {
            plan = null;
        }

        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
        this._workflowPlan = plan;
        this._workflowPlanLatestArtifactId = latest.artifactId;
        return plan;
    },

    async _hydrateWorkflowFromRunArtifacts(runId) {
        const store = await this._ensureRunStoreOpen();
        const id = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
        if (!store || !id) return null;

        if (!this.workflowData) this.workflowData = {};

        const readJson = async (type) => {
            try {
                const data = await store.getArtifact(id, type);
                if (!data) return null;
                if (typeof data === 'string') {
                    try { return JSON.parse(data); } catch { return null; }
                }
                return data;
            } catch {
                return null;
            }
        };

        const contentPackage = await readJson('content_package.json');
        if (contentPackage && typeof contentPackage === 'object' && !Array.isArray(contentPackage)) {
            this.workflowData.contentPackage = contentPackage;
            this.workflowData.report = contentPackage.report || null;
            this.workflowData.slideIntents = contentPackage.slideIntents || [];
            this.workflowData.reportMarkdown = contentPackage?.report?.markdown || this.workflowData.reportMarkdown || '';
        }

        const deckPackage = await readJson('deck_package.json');
        if (deckPackage && typeof deckPackage === 'object' && !Array.isArray(deckPackage)) {
            this.workflowData.deckPackage = deckPackage;
            if (typeof deckPackage.deckHtmlDsl === 'string' && deckPackage.deckHtmlDsl) {
                this.workflowData.deckHtmlDsl = deckPackage.deckHtmlDsl;
                this._parseAndStoreSlides?.(deckPackage.deckHtmlDsl);
            }
        }

        const evaluationReport = await readJson('evaluation_report.json');
        if (evaluationReport && typeof evaluationReport === 'object' && !Array.isArray(evaluationReport)) {
            this.workflowData.evaluationReport = evaluationReport;
        }

        const deepsearchStateJson = await readJson('deepsearch_state.json');
        if (deepsearchStateJson && typeof deepsearchStateJson === 'object' && !Array.isArray(deepsearchStateJson)) {
            try {
                const { DeepSearchState } = await import('../../agents/stages/deepsearch/state.js');
                this._deepsearchState = DeepSearchState.fromJSON(deepsearchStateJson);
                this._syncDeepSearchVizFromState?.(this._deepsearchState);
            } catch {
                // ignore
            }
        }

        return { contentPackage, deckPackage, evaluationReport, deepsearchState: this._deepsearchState || null };
    },

    async resumeWorkflowFromPlan({ runId, stepIdOrIndex } = {}) {
        const requestedRunId = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
        const id =
            requestedRunId ||
            (typeof this._workflowPlan?.runId === 'string' ? this._workflowPlan.runId : null) ||
            this._currentRunId;

        if (!id) throw new Error('resumeWorkflowFromPlan({ runId }): missing runId');

        // Ensure plan is loaded (prefer current plan; fallback to latest artifact).
        if (!this._workflowPlan || this._workflowPlan.runId !== id) {
            await this._loadLatestWorkflowPlanArtifact(id);
        }

        // Boot a runtime for this runId (keeps the existing plan object if it matches runId).
        const planMeta = this._workflowPlan?.meta && typeof this._workflowPlan.meta === 'object' ? this._workflowPlan.meta : {};
        const brief = this.workflowData?.projectBrief || {};
        const constraints = {
            ...(typeof brief?.audience === 'string' && brief.audience.trim() ? { audience: brief.audience.trim() } : {}),
            ...(typeof brief?.tone === 'string' && brief.tone.trim() ? { tone: brief.tone.trim() } : {}),
        };

        await this._ensureRuntime({
            mode: typeof planMeta?.mode === 'string' && planMeta.mode ? planMeta.mode : 'deepsearch',
            scenario: typeof planMeta?.scenario === 'string' && planMeta.scenario ? planMeta.scenario : 'business',
            constraints,
            runId: id,
        });

        await this._hydrateWorkflowFromRunArtifacts(id);

        // Ensure orchestrator is running (emits run.started, which will NOT create a new plan if we already loaded one).
        this._orchestrator?.start?.();

        // Determine resume step.
        const plan = this._workflowPlan;
        const steps = Array.isArray(plan?.steps) ? plan.steps : [];
        const pickStepId = () => {
            if (typeof stepIdOrIndex === 'string' && stepIdOrIndex.trim()) return stepIdOrIndex.trim();
            if (typeof stepIdOrIndex === 'number' && Number.isFinite(stepIdOrIndex)) {
                const idx = Math.max(0, Math.floor(stepIdOrIndex));
                return steps[idx]?.stepId || steps[0]?.stepId || null;
            }

            const selected = typeof plan?.selectedStepIndex === 'number' ? plan.selectedStepIndex : 0;
            const selectedStep = steps[selected];
            if (selectedStep && selectedStep.status !== StepStatus.COMPLETED) return selectedStep.stepId;
            const firstOpen = steps.find((s) => s?.status !== StepStatus.COMPLETED);
            return firstOpen?.stepId || steps.at(-1)?.stepId || null;
        };

        const stepId = pickStepId();
        if (!stepId) throw new Error('resumeWorkflowFromPlan(): plan has no steps');

        // Ensure plan lifecycle allows execution.
        const lifecycle = typeof plan?.lifecycleStatus === 'string' ? plan.lifecycleStatus : PlanLifecycleStatus.DRAFT;
        if (lifecycle === PlanLifecycleStatus.DRAFT) {
            await this._setWorkflowPlanLifecycleStatus(PlanLifecycleStatus.APPROVED, { runId: id, reason: 'resume.approve', force: true });
        }
        await this._setWorkflowPlanLifecycleStatus(PlanLifecycleStatus.IN_PROGRESS, { runId: id, reason: `resume:${stepId}`, force: true });

        // Resume execution.
        if (stepId === 'deepsearch.ingest') {
            await this.phase1_DeepReading?.();
            return { runId: id, resumedAt: stepId };
        }
        if (stepId === 'deepsearch.pipeline') {
            if (this._deepsearchState) {
                await this._orchestrator?.runStage?.('deepsearch.pipeline', { state: this._deepsearchState });
            } else {
                await this.phase1_DeepReading?.();
            }
            await this.phase2_Scripting?.();
            return { runId: id, resumedAt: stepId };
        }
        if (stepId === 'workflow.script_review') {
            await this.phase2_Scripting?.();
            return { runId: id, resumedAt: stepId };
        }
        if (stepId === 'textprep.align') {
            await this.phase3_PageLayout?.();
            return { runId: id, resumedAt: stepId };
        }
        if (stepId === 'design.batch') {
            await this.phase5_DesignOptimization?.();
            return { runId: id, resumedAt: stepId };
        }
        if (stepId === 'evaluate.hardgates') {
            await this.phase6_FinalReview?.();
            return { runId: id, resumedAt: stepId };
        }

        throw new Error(`resumeWorkflowFromPlan(): unsupported stepId: ${stepId}`);
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

        registry.register('run.started', (_eventName, payload) => {
            forceWorkflowState(this, WorkflowState.READING);
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({
                text,
                status: i === 0 ? WorkflowTodoStatus.ACTIVE : WorkflowTodoStatus.PENDING,
            })));
            this.renderPreviewArea();

            // Create the workflow plan on first run start (skip during replay to avoid generating new artifacts).
            const isReplay = Boolean(this._runtimeEventMeta?.meta?.replay);
            if (!isReplay) {
                const runId = typeof payload?.runId === "string" ? payload.runId : this._currentRunId;
                this._ensureWorkflowPlan({ runId }).catch(() => { });
            }
        });

        registry.register('run.completed', (_eventName, payload) => {
            const isReplay = Boolean(this._runtimeEventMeta?.meta?.replay);
            if (isReplay) return;
            const runId = typeof payload?.runId === "string" ? payload.runId : this._currentRunId;
            this._setWorkflowPlanLifecycleStatus?.(PlanLifecycleStatus.COMPLETED, { runId, reason: 'run.completed', force: true })?.catch?.(() => { });
        });

        registry.register('run.failed', (_eventName, payload) => {
            const isReplay = Boolean(this._runtimeEventMeta?.meta?.replay);
            if (isReplay) return;
            const runId = typeof payload?.runId === "string" ? payload.runId : this._currentRunId;
            this._setWorkflowPlanLifecycleStatus?.(PlanLifecycleStatus.FAILED, { runId, reason: 'run.failed', force: true })?.catch?.(() => { });
        });

        registry.register('run.cancelled', (_eventName, payload) => {
            const isReplay = Boolean(this._runtimeEventMeta?.meta?.replay);
            if (isReplay) return;
            const runId = typeof payload?.runId === "string" ? payload.runId : this._currentRunId;
            this._setWorkflowPlanLifecycleStatus?.(PlanLifecycleStatus.CANCELLED, { runId, reason: 'run.cancelled', force: true })?.catch?.(() => { });
        });

        // FlowViz 事件捕获
        registry.register('deepsearch.*', captureFlowEvent('deepsearch'));
        registry.register('iteration.completed', captureFlowEvent('deepsearch'));
        registry.register('design.*', captureFlowEvent('design'));
        registry.register('compression.*', captureFlowEvent('runtime'));
        registry.register('policy.*', captureFlowEvent('runtime'));
        registry.register('vfs.*', captureFlowEvent('runtime'));

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
            if (typeof payload.openTodoCount === 'number') viz.openTodoCount = payload.openTodoCount;
            if (typeof payload.completedTodoCount === 'number') viz.completedTodoCount = payload.completedTodoCount;
            if (typeof payload.blockedTodoCount === 'number') viz.blockedTodoCount = payload.blockedTodoCount;
            if (typeof payload.totalTodos === 'number') viz.totalTodos = payload.totalTodos;
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

        registry.register('deepsearch.todos.completed', (eventName, payload) => {
            this._ensureDeepSearchViz();
            if (typeof payload.todoCount === 'number') this.workflowData.deepsearchViz.totalTodos = payload.todoCount;
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            if (this._deepsearchState) this._syncDeepSearchVizFromState(this._deepsearchState);
            this._scheduleVizRerender();
        });

        registry.register('deepsearch.gaps.completed', (eventName, payload) => {
            this._ensureDeepSearchViz();
            if (typeof payload.gapCount === 'number') this.workflowData.deepsearchViz.openGapCount = payload.gapCount;
            if (typeof payload.totalGaps === 'number') this.workflowData.deepsearchViz.totalGaps = payload.totalGaps;
            if (typeof payload.todoCount === 'number') this.workflowData.deepsearchViz.totalTodos = payload.todoCount;
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

        registry.register('deepsearch.todo.created', (eventName, payload) => {
            this._ensureDeepSearchViz();
            if (payload?.todoId) {
                this._upsertDeepSearchVizTodo({
                    todoId: payload.todoId,
                    text: payload.text,
                    status: payload.status,
                    priority: payload.priority,
                    source: payload.source,
                });
                this.workflowData.deepsearchViz.updatedAt = Date.now();
                this._scheduleVizRerender();
            }
        });

        registry.register('deepsearch.todo.status.changed', (eventName, payload) => {
            this._ensureDeepSearchViz();
            if (payload?.todoId) {
                this._upsertDeepSearchVizTodo({
                    todoId: payload.todoId,
                    status: payload.to,
                });
                this.workflowData.deepsearchViz.updatedAt = Date.now();
                this._scheduleVizRerender();
            }
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
                    payload.phase === 'todos' ? 'AI 规划' :
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
        const rawPayload = Object.prototype.hasOwnProperty.call(evt, 'payload') ? evt.payload : undefined;
        const runId = typeof evt?.runId === 'string' ? evt.runId : null;
        let payload = rawPayload === undefined || rawPayload === null ? {} : rawPayload;

        // Ensure UI/workflow handlers can always access runId from payload (AgentEventBridge strips record meta)
        if (runId && payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.runId !== 'string') {
            payload = { ...payload, runId };
        }

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
        const match = name.match(/^(.*)\.(started|ended|completed|failed)$/);
        if (!match) return;

        const stageName = match[1];
        const stageStatus = match[2] === 'completed' ? 'ended' : match[2];
        this._updateWorkflowPlanFromStageLifecycle(stageName, stageStatus, payload, evt);
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
            const msg =
                payload?.message ||
                payload?.error ||
                evt?.payload?.message ||
                evt?.payload?.error ||
                'Stage failed';
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
            aiApiService: orch._services?.aiApiService,
            modelRouter: orch._services?.modelRouter,
            localRetriever: orch._services?.localRetriever,
            externalSearchProvider: orch._services?.externalSearchProvider,
            vfs: orch._services?.vfs,
            policy: orch._services?.policy,
            storageAdapter: orch._services?.storageAdapter,
            ocr: orch._services?.ocr,
            imageProvider: orch._services?.imageProvider || orch._services?.imageService,
            svgGenerator: orch._services?.svgGenerator,
            archive: orch._services?.archive,
            logger: orch._services?.logger,
        });

        const saveArtifact = async (runId, type, data, options = {}) => {
            const store = this._runStore;
            const id = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
            const t = typeof type === 'string' && type.trim() ? type.trim() : null;
            if (!store || !id || !t || typeof store.saveArtifact !== 'function') return null;
            try {
                return await store.saveArtifact(id, t, data, options);
            } catch (err) {
                console.warn(`[Workflow] Failed to persist artifact: ${t}`, err?.message || err);
                return null;
            }
        };

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
                    runStore: this._runStore,
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
                    const { DeepSearchState } = await import('../../agents/stages/deepsearch/state.js');

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
                        runStore: this._runStore,
                    });

                    const runId = ctx?.runId || this._currentRunId;

                    // Prefer an explicit DeepSearchState (phase1/continueDeepSearchIteration passes { state }).
                    const rawState = input?.state ?? input;
                    let state = null;
                    try {
                        if (rawState instanceof DeepSearchState) {
                            state = rawState;
                        } else if (rawState && typeof rawState === 'object' && !Array.isArray(rawState)) {
                            // Backward-compat: some callers used `{sources, taskGoal, userConfig}` (no L0),
                            // normalize it into the DeepSearchState snapshot shape.
                            const hasL0 = rawState && typeof rawState.L0 === 'object' && rawState.L0 !== null;
                            const normalized = hasL0 ? rawState : {
                                ...rawState,
                                ...(Array.isArray(rawState.sources) ? { L0: { sources: rawState.sources } } : {}),
                            };
                            state = DeepSearchState.fromJSON(normalized);
                        }
                    } catch {
                        state = null;
                    }

                    if (!state) {
                        const sources =
                            Array.isArray(this.workflowData?._deepsearchInput?.sources) ? this.workflowData._deepsearchInput.sources :
                            Array.isArray(this.workflowData?.ingest?.sources) ? this.workflowData.ingest.sources :
                            [];
                        const assets =
                            Array.isArray(this.workflowData?._deepsearchInput?.assets) ? this.workflowData._deepsearchInput.assets :
                            Array.isArray(this.workflowData?.ingest?.assets) ? this.workflowData.ingest.assets :
                            [];
                        const taskGoal = this._deriveTaskGoal?.() || this.workflowData?.taskGoal || this._projectBrief?.taskGoal || '';
                        const userConfig = {
                            title: this._projectBrief?.projectSummary || taskGoal,
                            audience: this._projectBrief?.audience,
                            tone: this._projectBrief?.tone,
                            ...this.workflowData?.userConfig,
                        };
                        state = new DeepSearchState({ runId, taskGoal, userConfig, L0: { sources, assets } });
                    }

                    if (typeof state.runId !== 'string' || !state.runId || state.runId === 'run_unknown') {
                        state.runId = runId || state.runId;
                    }

                    let contentPackage;
                    try {
                        contentPackage = await agentLoop.execute(
                            { runId, mode: 'deepsearch' },
                            state,
                            stageApi
                        );
                    } catch (err) {
                        if (err instanceof StagePausedError) {
                            const reason = err.reason || 'Awaiting user input';
                            api.progress?.({ agent: 'AI 分析', msg: `深度搜索已暂停：${reason}`, type: 'warning' });
                            this.workflowData.deepsearchPaused = {
                                reason,
                                checkpointId: err.checkpointId,
                                pausedAt: Date.now(),
                            };
                            this._deepsearchState = agentLoop._state;
                            return { paused: true, reason, checkpointId: err.checkpointId };
                        }
                        throw err;
                    }

                    // 保存结果
                    this.workflowData.contentPackage = contentPackage;
                    this.workflowData.report = contentPackage?.report || null;
                    this.workflowData.slideIntents = contentPackage?.slideIntents || [];
                    this.workflowData.reportMarkdown = contentPackage?.report?.markdown || '';
                    this._deepsearchState = agentLoop._state; // 保留状态用于可视化

                    // Persist artifacts for export/resume (best-effort, browser-only).
                    await saveArtifact(runId, 'content_package.json', contentPackage, { mime: 'application/json' });
                    if (agentLoop?._state && typeof agentLoop._state.toJSON === 'function') {
                        await saveArtifact(runId, 'deepsearch_state.json', agentLoop._state.toJSON({ includeCheckpoints: false }), { mime: 'application/json' });
                    }

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

                // Persist content package for export/resume (best-effort).
                const runId = ctx?.runId || this._currentRunId;
                await saveArtifact(runId, 'content_package.json', contentPackage, { mime: 'application/json' });

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
                const stage = new DesignAgentLoop({
                    ...(batchSize ? { batchSize } : {}),
                    archive: api.archive,
                });

                const deckPackage = await stage.execute(
                    { ...(ctx || {}), userConfig: this._getDesignStageUserConfig() },
                    contentPackage,
                    {
                        emit: forwardEmit,
                        eventBus: this._orchestrator?.eventBus,
                        signal: api.signal,
                        aiApiService: api.aiApiService,
                        modelRouter: api.modelRouter,
                        archive: api.archive,
                    }
                );

                const deckHtmlDsl = deckPackage?.deckHtmlDsl;
                if (typeof deckHtmlDsl !== 'string' || !deckHtmlDsl.includes('<section')) {
                    throw new Error('DesignAgentLoop returned invalid deckHtmlDsl');
                }

                persistDeckPackage(deckPackage);

                // Persist deck package for export/resume (best-effort).
                const runId = ctx?.runId || this._currentRunId;
                await saveArtifact(runId, 'deck_package.json', deckPackage, { mime: 'application/json' });

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
                const runId = ctx?.runId || this._currentRunId;
                await saveArtifact(runId, 'deck_package.json', deckPackage, { mime: 'application/json' });
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
                const runId = ctx?.runId || this._currentRunId;
                await saveArtifact(runId, 'evaluation_report.json', report, { mime: 'application/json' });
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
