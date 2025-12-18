/**
 * Workflow Runtime Mixin
 * 设计系统、报告审阅面板、运行时 orchestrator 与事件处理
 */

let _TextPrepStage = null;
async function getTextPrepStage() {
    if (!_TextPrepStage) {
        const mod = await import('../../agents/stages/textprep/index.js');
        _TextPrepStage = mod.TextPrepStage;
    }
    return _TextPrepStage;
}

function toNonEmptyString(v) {
    if (v === undefined || v === null) return '';
    const s = String(v).trim();
    return s.length ? s : '';
}

function buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide) {
    const rows = Array.isArray(candidatesBySlide) ? candidatesBySlide : [];
    return rows
        .map((row) => {
            const slideIntentId = toNonEmptyString(row?.slideIntentId);
            if (!slideIntentId) return null;
            const slideIndex = Number.isFinite(row?.slideIndex) ? row.slideIndex : undefined;
            const selectedCandidate = row?.selectedCandidate && typeof row.selectedCandidate === 'object' ? row.selectedCandidate : null;
            return {
                slideIntentId,
                ...(slideIndex !== undefined ? { slideIndex } : {}),
                candidateId: toNonEmptyString(row?.selectedCandidateId) || toNonEmptyString(selectedCandidate?.candidateId),
                atmosphere: selectedCandidate?.atmosphere,
                elementsMarkdown: selectedCandidate?.elementsMarkdown,
                visualSlots: selectedCandidate?.visualSlots,
                scores: selectedCandidate?.scores,
                composite: selectedCandidate?.composite,
            };
        })
        .filter(Boolean);
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

        this.state = 'page_layout';
        this.renderPreviewArea?.();
        this.updateTodos?.(this._runtimeTodoTexts.map((text, i) => {
            if (i < 3) return { text, status: 'completed' };
            if (i === 3) return { text, status: 'active' };
            return { text, status: 'pending' };
        }));
        this.phase3_PageLayout?.();
    },
    confirmReport() {
        this._reportReviewPanel?.close?.();
        this._confirmScriptToPageLayout();
    },
    async regenerateBrainstormForSlide(slideIntentId, { keepOthers = true } = {}) {
        const contentPackage = this.workflowData?.contentPackage;
        const designSystem = this.workflowData?.deckPackage?.designSystem;
        const constraints = this._orchestrator?.runContext?.constraints || contentPackage?.constraints || {};

        if (!contentPackage) throw new Error('regenerateBrainstormForSlide: contentPackage not ready');
        if (!designSystem) throw new Error('regenerateBrainstormForSlide: designSystem not ready');

        const { brainstormRegenerate } = await import('../../agents/stages/design/brainstorm.js');
        const cached = this.workflowData?.brainstormCandidates;
        const pkg = contentPackage && typeof contentPackage === 'object' ? { ...contentPackage, brainstormCandidates: cached } : contentPackage;

        const emit = this._orchestrator?.eventBus?.emit
            ? (name, record) => this._orchestrator.eventBus.emit(name, record)
            : null;

        const aiApiService =
            this._orchestrator?._services?.aiApiService ||
            (typeof window !== 'undefined' && window.aiApiService ? window.aiApiService : null);

        const modelRouter =
            this._orchestrator?._services?.modelRouter ||
            (typeof window !== 'undefined' && window.modelRouter ? window.modelRouter : null);

        const res = await brainstormRegenerate(slideIntentId, pkg, designSystem, constraints, { keepOthers, emit, aiApiService, modelRouter });

        if (!emit) {
            const row = {
                slideIntentId: res?.slideIntentId,
                candidates: res?.candidates,
                selectedCandidateId: res?.selectedCandidate?.candidateId,
                selectedCandidate: res?.selectedCandidate,
            };
            const existing = Array.isArray(this.workflowData?.brainstormCandidates?.candidatesBySlide)
                ? this.workflowData.brainstormCandidates.candidatesBySlide
                : [];
            const candidatesBySlide = keepOthers
                ? (() => {
                    const next = existing.map(r => (r?.slideIntentId === row.slideIntentId ? row : r));
                    if (!next.some(r => r?.slideIntentId === row.slideIntentId)) next.push(row);
                    return next;
                })()
                : [row];
            this.workflowData.brainstormCandidates = {
                schemaVersion: '0.1',
                candidatesBySlide,
                selectedIdeas: buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide),
                updatedAt: Date.now(),
                source: typeof this.workflowData?.brainstormCandidates?.source === 'string' ? this.workflowData.brainstormCandidates.source : 'auto',
            };
        }

        return res;
    },
    selectBrainstormCandidate(slideIntentId, candidateId) {
        const bc = this.workflowData?.brainstormCandidates;
        if (!bc?.candidatesBySlide) return false;

        const targetSlideIntentId = toNonEmptyString(slideIntentId);
        const targetCandidateId = toNonEmptyString(candidateId);
        if (!targetSlideIntentId || !targetCandidateId) return false;

        const rows = Array.isArray(bc.candidatesBySlide) ? bc.candidatesBySlide : null;
        if (!rows) return false;

        const rowIndex = rows.findIndex((r) => toNonEmptyString(r?.slideIntentId) === targetSlideIntentId);
        if (rowIndex < 0) return false;

        const row = rows[rowIndex] && typeof rows[rowIndex] === 'object' ? rows[rowIndex] : {};
        const candidates = Array.isArray(row?.candidates) ? row.candidates : [];
        const picked = candidates.find((c) => toNonEmptyString(c?.candidateId) === targetCandidateId);
        if (!picked) return false;

        const nextCandidates = candidates.map((c) => ({
            ...(c && typeof c === 'object' ? c : {}),
            selected: toNonEmptyString(c?.candidateId) === targetCandidateId,
        }));

        const nextSelectedCandidate = { ...(picked && typeof picked === 'object' ? picked : {}), selected: true };
        const nextRow = {
            ...row,
            selectedCandidateId: targetCandidateId,
            selectedCandidate: nextSelectedCandidate,
            candidates: nextCandidates,
        };

        rows[rowIndex] = nextRow;
        bc.candidatesBySlide = rows;
        bc.schemaVersion = typeof bc.schemaVersion === 'string' ? bc.schemaVersion : '0.1';
        bc.selectedIdeas = buildSelectedIdeasFromCandidatesBySlide(rows);
        bc.source = 'user';
        bc.updatedAt = Date.now();
        this.setAutoSaveNeeded?.();
        this._scheduleVizRerender?.();
        return true;
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

        // Compat: totalCandidates vs totalIdeas
        const totalIdeas = normalizedPayload.totalIdeas ?? normalizedPayload.totalCandidates;

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
            'design.brainstorm.started': '正在进行创意脑暴',
            'design.brainstorm.completed': `脑暴完成：${Number.isFinite(totalIdeas) ? totalIdeas : 0} 个候选`,
            'design.image.planning.completed': `图片规划完成：计划 ${normalizedPayload?.planned || 0} 张`,
            'design.generate.ended': `页面生成完成：${normalizedPayload?.slides || 0} 页`,
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
        };

        const text = eventDescriptions[name];
        if (!text) return; // Skip events we don't want to show

        this.addProcessPanelStep({
            name,
            text,
            details:
                normalizedPayload?.totalGaps ? { gaps: normalizedPayload.totalGaps } :
                normalizedPayload?.iteration !== undefined ? { iteration: normalizedPayload.iteration + 1 } :
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
        const allowedVisualModes = new Set(['ai-first', 'svg-first', 'balanced']);
        if (typeof overrides.visualPreference.mode !== 'string' || !allowedVisualModes.has(overrides.visualPreference.mode)) {
            overrides.visualPreference.mode = 'balanced';
        }

        // Legacy aliases (kept for existing UI + stored projects)
        ds.colors = overrides.colors;
        ds.fonts = overrides.typography;
        ds.visualPreference = overrides.visualPreference;

        const allowedDensity = new Set(['compact', 'balanced', 'spacious']);
        if (typeof ds.density !== 'string' || !allowedDensity.has(ds.density)) ds.density = 'balanced';

        if (typeof ds.model !== 'string') ds.model = 'gemini-1.5-pro';

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
        this.state = 'briefing';
        this.renderPreviewArea?.();
    },
    cancelProjectBrief() {
        this.state = 'idle';
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
        this.state = 'idle';
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

                                return await baseAiApiService._callApi(config, messages, temperature, maxTokens);
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

        this._orchestrator = new AgentOrchestrator({
            mode,
            scenario,
            constraints,
            services
        });

        // Stage order drives todo/agent updates via subscribed events.
        this._runtimeStageUi = {
            'deepsearch.ingest': { todoIndex: 0, agentId: 'reader', state: 'reading', started: 'Analyzing document structure...', ended: 'Sources Ingested' },
            'deepsearch.pipeline': { todoIndex: 1, agentId: 'analyst', state: 'researching', started: 'Researching and generating report...', ended: 'Report Ready' },
            'textprep.align': { todoIndex: 3, agentId: 'designer', state: 'page_layout', started: 'Planning slide layout...', ended: 'Layout Ready' },
            'design.batch': { todoIndex: 4, agentId: 'designer', state: 'designer', started: 'Optimizing visual layout...', ended: 'Design Complete' },
            'evaluate.hardgates': { todoIndex: 5, agentId: 'reviewer', state: 'reviewer', started: 'Final compliance check...', ended: 'Approved' }
        };

        this._runtimeDesignSubStageUi = {
            'design.tokens': { label: '设计规范提取', agentId: 'designer' },
            'design.brainstorm': { label: '创意构思', agentId: 'designer' },
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
    _attachRuntimeEventHandlers() {
        if (this._runtimeUnsubs) {
            this._runtimeUnsubs.forEach(fn => fn());
        }
        this._runtimeUnsubs = [];

        const bus = this._orchestrator?.eventBus;
        if (!bus) return;

        this._runtimeUnsubs.push(bus.on('*', (evt) => this._handleRuntimeEvent(evt)));
    },
    _handleRuntimeEvent(evt) {
        const name = evt?.name || '';
        const payload = evt?.payload || {};

        if (name === 'run.started') {
            this._resetFlowVizEventStore();
            this.state = 'reading';
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({ text, status: i === 0 ? 'active' : 'pending' })));
            this.renderPreviewArea();
            return;
        }

        // Capture flow events for premium visualizers (store minimal {name,payload} only).
        if (name.startsWith('deepsearch.') || name === 'iteration.completed' || name === 'deepsearch.iteration.completed') {
            this._pushFlowVizEvent('deepsearch', name, payload);
            // Also push to floating process panel
            this._pushToProcessPanel(name, payload);
        } else if (name.startsWith('design.')) {
            this._pushFlowVizEvent('design', name, payload);
            this._pushToProcessPanel(name, payload);
        }

        // Design sub-stage UI: update agent activity based on fine-grained events.
        // (These events don't match _runtimeStageUi, so we handle them separately.)
        if (name.startsWith('design.') && this._runtimeDesignSubStageUi && typeof this._setAgentStatus === 'function') {
            const m = name.match(/^(.*)\.(started|ended|completed|failed)$/);
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

            if (name === 'design.degraded') {
                const ui = this._runtimeDesignSubStageUi['design.qa'] || { label: '质量检查', agentId: 'designer' };
                const detail =
                    typeof payload?.slideNo === 'number' ? `第 ${payload.slideNo} 页` :
                    typeof payload?.degradedCount === 'number' ? `${payload.degradedCount} 页` :
                    '';
                this._setAgentStatus(ui.agentId, 'active', `降级渲染${detail ? ` (${detail})` : ''}`);
            }
        }

        if (name === 'design.brainstorm.candidates') {
            if (!this.workflowData) this.workflowData = {};
            const prev = this.workflowData.brainstormCandidates && typeof this.workflowData.brainstormCandidates === 'object'
                ? this.workflowData.brainstormCandidates
                : {};
            const sourceCandidate = typeof payload?.source === 'string' ? payload.source : prev.source;
            const source = String(sourceCandidate || 'auto').trim() === 'user' ? 'user' : 'auto';
            this.workflowData.brainstormCandidates = {
                schemaVersion: typeof prev.schemaVersion === 'string' ? prev.schemaVersion : '0.1',
                candidatesBySlide: Array.isArray(payload?.candidatesBySlide) ? payload.candidatesBySlide : [],
                selectedIdeas: Array.isArray(payload?.selectedIdeas) ? payload.selectedIdeas : [],
                updatedAt: Date.now(),
                source,
            };
            this._scheduleVizRerender?.();
        }

        // DeepSearch UI integration (T1 event bus)
        if (name === 'iteration.completed' || name === 'deepsearch.iteration.completed') {
            this._ensureDeepSearchViz();
            const viz = this.workflowData.deepsearchViz;
            const completed = typeof payload.iteration === 'number' ? payload.iteration : null;
            if (completed !== null) viz.lastCompletedIteration = completed;
            if (typeof payload.openGapCount === 'number') viz.openGapCount = payload.openGapCount;
            if (typeof payload.iteration === 'number') viz.iteration = payload.iteration + 1;
            viz.updatedAt = Date.now();
            this._scheduleVizRerender();
        }

        if (name === 'deepsearch.started') {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.runId = payload?.runId || this.workflowData.deepsearchViz.runId;
            this.workflowData.deepsearchViz.startedAt = Date.now();
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        }

        if (name === 'deepsearch.completed') {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.completedAt = Date.now();
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        }

        if (name === 'deepsearch.gaps.completed') {
            this._ensureDeepSearchViz();
            if (typeof payload.gapCount === 'number') this.workflowData.deepsearchViz.openGapCount = payload.gapCount;
            if (typeof payload.totalGaps === 'number') this.workflowData.deepsearchViz.totalGaps = payload.totalGaps;
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            if (this._deepsearchState) this._syncDeepSearchVizFromState(this._deepsearchState);
            this._scheduleVizRerender();
        }

        if (name === 'deepsearch.checkpoint.saved') {
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
        }

        // === 外搜事件追踪 ===
        if (name === 'deepsearch.external.triggered') {
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
        }

        if (name === 'deepsearch.external.started') {
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
        }

        if (name === 'deepsearch.external.completed') {
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
        }

        if (name === 'deepsearch.external.error') {
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
        }

        if (name === 'deepsearch.external.skipped') {
            this._ensureDeepSearchViz();
            this.workflowData.deepsearchViz.externalSearch = {
                status: 'skipped',
                reason: payload?.reason || 'unknown',
                localHitCount: payload?.localHitCount,
                skippedAt: Date.now(),
            };
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        }
        // === 外搜事件追踪结束 ===

        // Allow DeepSearch stages to update gaps list, then fall through to progress logger.
        if (name === 'deepsearch.gaps.progress') {
            this._ensureDeepSearchViz();
            const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : null;
            if (detail?.gapId) this._upsertDeepSearchVizGap(detail);
            this.workflowData.deepsearchViz.updatedAt = Date.now();
            this._scheduleVizRerender();
        }

        // 追踪阶段变化
        if (name.endsWith('.progress') && payload.phase) {
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

        if (name.endsWith('.progress')) {
            const msg = payload.msg;
            const agent =
                payload.agent ||
                (payload.phase === 'scan' ? 'AI 研究' :
                    payload.phase === 'gaps' ? 'AI 分析' :
                        payload.phase === 'retrieve' ? 'AI 搜索' :
                            payload.phase === 'understand' ? 'AI 提取' :
                                payload.phase === 'write' ? 'AI 写作' :
                                    (evt?.actor === 'ingest' ? 'AI 阅读' :
                                        evt?.actor === 'deepsearch' ? 'AI 研究' :
                                            evt?.actor === 'textprep' ? 'AI 分析' :
                                                evt?.actor === 'design' ? 'AI 设计' :
                                                    evt?.actor === 'evaluate' ? 'AI 审查' : 'AI'));
            const type = payload.type || (payload.phase ? 'normal' : 'normal');
            if (agent && msg) this.logTerminal(agent, msg, type);
            return;
        }

        const match = name.match(/^(.*)\.(started|ended|failed)$/);
        if (!match) return;

        const stageName = match[1];
        const stageStatus = match[2];
        const ui = this._runtimeStageUi?.[stageName];
        if (!ui) return;

        if (ui.state && stageStatus === 'started') {
            this.state = ui.state;
        }

        if (stageStatus === 'started') {
            this._setAgentStatus(ui.agentId, 'active', ui.started);
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
                if (i < ui.todoIndex) return { text, status: 'completed' };
                if (i === ui.todoIndex) return { text, status: 'active' };
                return { text, status: 'pending' };
            }));
        }

        if (stageStatus === 'ended') {
            this._setAgentStatus(ui.agentId, 'idle', ui.ended);
            // Some steps have a user-confirmation gap after the model finishes generating.
            if (stageName !== 'deepsearch.questions') {
                this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
                    if (i <= ui.todoIndex) return { text, status: 'completed' };
                    return { text, status: 'pending' };
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

                const out = await stage.execute(ctx, input, {
                    emit: forwardEmit,
                    signal: api.signal,
                    checkCancelled: api.checkCancelled,
                    storageAdapter: api.storageAdapter,
                    ocr: api.ocr,
                    aiApiService: api.aiApiService,
                    modelRouter: api.modelRouter,
                    visionApi: api.visionApi,
                    whisperApi: api.whisperApi
                });
                return out;
            }, { actor: 'deepsearch', timeoutMs: 120_000 });

            // Real DeepSearch pipeline (scan/gaps/retrieve/understand/write/condense + build ContentPackage).
            const { registerDeepSearchStages } = await import('../../agents/stages/deepsearch/index.js');
            registerDeepSearchStages(orch, { timeoutMs: 900_000 }); // 15 minutes for real LLM calls

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
            const brainstormCandidates =
                Object.prototype.hasOwnProperty.call(input || {}, 'brainstormCandidates')
                    ? input.brainstormCandidates
                    : this.workflowData?.brainstormCandidates;
            const baseContentPackage = input?.contentPackage || this.workflowData?.contentPackage;
            const contentPackage =
                baseContentPackage && typeof baseContentPackage === 'object' && brainstormCandidates && typeof brainstormCandidates === 'object'
                    ? { ...baseContentPackage, brainstormCandidates }
                    : baseContentPackage;
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
                if (eventName === 'design.brainstorm.started') {
                    progress('正在进行创意脑暴...', 'normal');
                }
                if (eventName === 'design.brainstorm.completed') {
                    const p = recordOrPayload?.payload || recordOrPayload || {};
                    progress(`脑暴完成：${p.totalIdeas || 0} 个创意，${p.imageSlots || 0} 个图像槽位`, 'highlight');
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

                this.workflowData.deckPackage = deckPackage;
                this.workflowData.deckHtmlDsl = templateDeckHtmlDsl;
                this.sampleHTML = templateDeckHtmlDsl;
                parseAndStoreSlides(templateDeckHtmlDsl);
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

                this.workflowData.deckPackage = deckPackage;
                this.workflowData.deckHtmlDsl = deckHtmlDsl;
                this.sampleHTML = deckHtmlDsl;
                parseAndStoreSlides(deckHtmlDsl);
                return deckPackage;
            }

            try {
                progress(slideCount ? `正在生成 ${slideCount} 页的页面布局...` : '正在生成页面布局...', 'normal');

                const { DesignStage } = await import('../../agents/stages/design/index.js');
                const batchSize = Number(this.workflowData?.batchSize) || Number(this.workflowData?.designBatchSize) || undefined;
                const stage = new DesignStage(batchSize ? { batchSize } : undefined);

                const deckPackage = await stage.run(contentPackage, {
                    runContext: { ...(ctx || {}), userConfig: this._getDesignStageUserConfig() },
                    emit: forwardEmit,
                    signal: api.signal,
                    aiApiService: api.aiApiService,
                    modelRouter: api.modelRouter
                });

                const deckHtmlDsl = deckPackage?.deckHtmlDsl;
                if (typeof deckHtmlDsl !== 'string' || !deckHtmlDsl.includes('<section')) {
                    throw new Error('DesignStage returned invalid deckHtmlDsl');
                }

                this.workflowData.deckPackage = deckPackage;
                this.workflowData.deckHtmlDsl = deckHtmlDsl;
                this.sampleHTML = deckHtmlDsl;
                parseAndStoreSlides(deckHtmlDsl);

                progress(`设计完成：已生成 ${Array.isArray(deckPackage?.slidesMeta) ? deckPackage.slidesMeta.length : slideCount} 页`, 'success');
                return deckPackage;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err || 'unknown error');
                console.warn('[design.batch] DesignStage.run failed, falling back to mock:', err);
                progress(`设计引擎异常，降级为模板：${msg}`, 'warning');

                const deckHtmlDsl = makeMockDeckHtmlDsl();
                const deckPackage = {
                    schemaVersion: '0.1',
                    runId: ctx?.runId || 'run_unknown',
                    deckHtmlDsl,
                    slidesMeta: []
                };

                this.workflowData.deckPackage = deckPackage;
                this.workflowData.deckHtmlDsl = deckHtmlDsl;
                this.sampleHTML = deckHtmlDsl;
                parseAndStoreSlides(deckHtmlDsl);
                return deckPackage;
            }
        }, { actor: 'design', timeoutMs: 600_000 }); // 10 minutes for complex decks

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
