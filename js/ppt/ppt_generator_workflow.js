const DEFAULT_TASK_GOAL = '生成一份结构清晰、可演示的汇报文稿，并给出可引用的证据来源。';

let _TextPrepStage = null;
async function getTextPrepStage() {
    if (!_TextPrepStage) {
        const mod = await import('../agents/stages/textprep/index.js');
        _TextPrepStage = mod.TextPrepStage;
    }
    return _TextPrepStage;
}

const PPTGeneratorWorkflow = {
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

        const { brainstormRegenerate } = await import('../agents/stages/design/brainstorm.js');
        const cached = this.workflowData?.brainstormCandidates;
        const pkg = contentPackage && typeof contentPackage === 'object' ? { ...contentPackage, brainstormCandidates: cached } : contentPackage;

        const emit = this._orchestrator?.eventBus?.emit
            ? (name, record) => this._orchestrator.eventBus.emit(name, record)
            : null;

        const aiApiService =
            this._orchestrator?._services?.aiApiService ||
            (typeof window !== 'undefined' && window.aiApiService ? window.aiApiService : null);

        const res = await brainstormRegenerate(slideIntentId, pkg, designSystem, constraints, { keepOthers, emit, aiApiService });

        if (!emit) {
            const row = { slideIntentId: res?.slideIntentId, candidates: res?.candidates, selectedCandidate: res?.selectedCandidate };
            const existing = Array.isArray(this.workflowData?.brainstormCandidates?.candidatesBySlide)
                ? this.workflowData.brainstormCandidates.candidatesBySlide
                : [];
            this.workflowData.brainstormCandidates = {
                candidatesBySlide: keepOthers ? existing.map(r => (r?.slideIntentId === row.slideIntentId ? row : r)) : [row],
                selectedIdeas: Array.isArray(this.workflowData?.brainstormCandidates?.selectedIdeas) ? this.workflowData.brainstormCandidates.selectedIdeas : [],
                updatedAt: Date.now(),
            };
        }

        return res;
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

        // Map event names to human-readable descriptions
        const eventDescriptions = {
            'deepsearch.started': '开始深度分析流程',
            'deepsearch.scan.started': '正在扫描文档结构',
            'deepsearch.scan.completed': '文档扫描完成',
            'deepsearch.gaps.started': '正在识别知识空白',
            'deepsearch.gaps.completed': `识别了 ${payload?.totalGaps || 0} 个研究问题`,
            'deepsearch.retrieve.started': '正在检索相关内容',
            'deepsearch.retrieve.completed': '内容检索完成',
            'deepsearch.understand.started': '正在分析提取要点',
            'deepsearch.understand.completed': '要点提取完成',
            'deepsearch.write.started': '正在撰写研究报告',
            'deepsearch.write.completed': '报告撰写完成',
            'deepsearch.completed': '深度分析完成',
            'iteration.completed': `完成第 ${(payload?.iteration || 0) + 1} 轮迭代`,
            'design.started': '开始视觉设计',
            'design.tokens.started': '正在提取设计规范',
            'design.tokens.ended': '设计规范已确定',
            'design.brainstorm.started': '正在进行创意脑暴',
            'design.brainstorm.completed': `脑暴完成：${payload?.totalIdeas || 0} 个创意`,
            'design.batch.started': `正在生成页面 ${payload?.slideRange?.join?.('-') || ''}`,
            'design.batch.completed': '批次生成完成',
            'design.ended': '设计阶段完成',
        };

        const text = eventDescriptions[name];
        if (!text) return; // Skip events we don't want to show

        this.addProcessPanelStep({
            name,
            text,
            details: payload?.totalGaps ? { gaps: payload.totalGaps } :
                     payload?.iteration !== undefined ? { iteration: payload.iteration + 1 } :
                     payload?.slideRange ? { slides: payload.slideRange.join('-') } :
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

        const mod = await import('../agents/runtime/orchestrator.js');
        const { AgentOrchestrator } = mod;

        const baseAiApiService = typeof window !== 'undefined' && window.aiApiService ? window.aiApiService : null;
        const visionApi = typeof window !== 'undefined' && window.visionApi ? window.visionApi : null;
        const whisperApi = typeof window !== 'undefined' && window.whisperApi ? window.whisperApi : null;

        // Inject global AI services + ModelRouter (for pptRolePriority-aware routing)
        let aiApiService = baseAiApiService;
        let modelRouter = null;
        try {
            const { buildPptUsageConfigForModelRouter, createPptAwareAiApiService } = await import('../agents/llm/ppt-model-bridge.js');
            aiApiService = typeof createPptAwareAiApiService === 'function' ? createPptAwareAiApiService(baseAiApiService) : baseAiApiService;

            const usageConfig = typeof buildPptUsageConfigForModelRouter === 'function' ? buildPptUsageConfigForModelRouter() : null;
            if (usageConfig && typeof usageConfig === 'object') {
                const { ModelRouter } = await import('../agents/llm/model-router.js');

                const textUsages = ['worker', 'analyst', 'planner', 'writer', 'reviewer'];
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
        if (name.startsWith('deepsearch.') || name === 'iteration.completed') {
            this._pushFlowVizEvent('deepsearch', name, payload);
            // Also push to floating process panel
            this._pushToProcessPanel(name, payload);
        } else if (name.startsWith('design.')) {
            this._pushFlowVizEvent('design', name, payload);
            this._pushToProcessPanel(name, payload);
        }

        if (name === 'design.brainstorm.candidates') {
            if (!this.workflowData) this.workflowData = {};
            this.workflowData.brainstormCandidates = {
                candidatesBySlide: Array.isArray(payload?.candidatesBySlide) ? payload.candidatesBySlide : [],
                selectedIdeas: Array.isArray(payload?.selectedIdeas) ? payload.selectedIdeas : [],
                updatedAt: Date.now(),
            };
            this._scheduleVizRerender?.();
        }

        // DeepSearch UI integration (T1 event bus)
        if (name === 'iteration.completed') {
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

    _ensureDeepSearchViz() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.deepsearchViz) this._resetDeepSearchViz();
    },

    _upsertDeepSearchVizGap(detail) {
        if (!detail || typeof detail !== 'object') return;
        const gid = typeof detail.gapId === 'string' ? detail.gapId : String(detail.gapId || '').trim();
        if (!gid) return;

        const viz = this.workflowData.deepsearchViz;
        const gaps = Array.isArray(viz.gaps) ? viz.gaps : [];
        const idx = gaps.findIndex(g => g?.gapId === gid);
        const next = {
            ...(idx >= 0 && gaps[idx] && typeof gaps[idx] === 'object' ? gaps[idx] : {}),
            gapId: gid,
            ...(detail.type ? { type: detail.type } : {}),
            ...(detail.question ? { question: detail.question } : {}),
            ...(detail.priority ? { priority: detail.priority } : {}),
            ...(detail.status ? { status: detail.status } : {}),
            ...(typeof detail.missCount === 'number' ? { missCount: detail.missCount } : {}),
            ...(detail.blockedReason ? { blockedReason: detail.blockedReason } : {}),
        };
        if (idx >= 0) gaps[idx] = next;
        else gaps.push(next);
        viz.gaps = gaps;
    },

    _scheduleVizRerender() {
        if (this._vizRerenderTimer) return;
        this._vizRerenderTimer = setTimeout(() => {
            this._vizRerenderTimer = null;
            if (this._deepsearchFlowViz) return;
            if (this.state === 'researching' || this.state === 'deepsearch_review') {
                this.renderPreviewArea?.();
            }
        }, 200);
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

                const { IngestStage } = await import('../agents/ingest/ingest-stage.js');
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
            const { registerDeepSearchStages } = await import('../agents/stages/deepsearch/index.js');
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
            const contentPackage = input?.contentPackage || this.workflowData?.contentPackage;
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

                const { DesignStage } = await import('../agents/stages/design/index.js');
                const batchSize = Number(this.workflowData?.batchSize) || Number(this.workflowData?.designBatchSize) || undefined;
                const stage = new DesignStage(batchSize ? { batchSize } : undefined);

                const deckPackage = await stage.run(contentPackage, {
                    runContext: { ...(ctx || {}), userConfig: this._getDesignStageUserConfig() },
                    emit: forwardEmit,
                    signal: api.signal,
                    aiApiService: api.aiApiService
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
        }, { actor: 'design', timeoutMs: 300_000 });

        orch.registerStage('evaluate.hardgates', async (ctx, input, api) => {
            api.progress?.({ agent: 'AI 审查', msg: '正在验证输出质量...', type: 'normal' });

            try {
                const { EvaluateStage } = await import('../agents/eval/index.js');
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

    handleFileUpload(fileList) {
        const newFiles = Array.from(fileList).map(f => ({
            name: f.name,
            size: this._formatSize(f.size),
            rawSize: f.size,
            mimeType: f.type,
            type: 'file',
            file: f
        }));
        if (newFiles.length === 0) return;

        if (!this.workflowData.files) this.workflowData.files = [];
        this.workflowData.files = [...this.workflowData.files, ...newFiles];
        this.renderPreviewArea();
    },

    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    async startFromPastedText(pastedContent) {
        const content = typeof pastedContent === 'string' ? pastedContent : '';
        if (!content || !content.trim()) {
            if (typeof this.logTerminal === 'function') this.logTerminal('系统', '粘贴内容为空', 'warning');
            return;
        }

        this._ensureDesignSystemInitialized();

        const charCount = content.length;
        const DEEPSEARCH_THRESHOLD = 5000;
        const useDeepSearch = charCount > DEEPSEARCH_THRESHOLD;

        if (typeof this.logTerminal === 'function') {
            this.logTerminal('系统', `文档长度: ${charCount} 字，${useDeepSearch ? '将进行深度分析' : '使用快速处理'}`, 'normal');
        }

        if (useDeepSearch) {
            // 长文本：走 DeepSearch 流程
            await this._startFromPastedTextDeepSearch(content);
        } else {
            // 短文本：走简单 TextPrep 流程
            await this._startFromPastedTextSimple(content);
        }
    },

    async _startFromPastedTextDeepSearch(content) {
        const title = this._extractTitleFromText(content);

        // 创建 source 对象供 DeepSearch 使用
        const sourceId = `paste_${Date.now()}`;
        const source = {
            sourceId,
            kind: 'user_text',
            title,
            uri: null,
            sourceTextNormalized: content,
            metadata: { source: 'paste', timestamp: Date.now() }
        };

        // 初始化 workflowData
        if (!this.workflowData.files) this.workflowData.files = [];
        this.workflowData.files.push({
            name: title || '粘贴文档',
            size: this._formatSize(content.length),
            rawSize: content.length,
            mimeType: 'text/markdown',
            type: 'paste',
            content,
            _source: source
        });

        // 存储原始内容以供 DeepSearch 使用
        this.workflowData._pastedSources = [source];
        this.workflowData._useDeepSearch = true;
        this.workflowData.reportMarkdown = content;
        // 注意：不在这里调用 _onReportUpdated，原始输入不应记录为报告版本
        // 只有 AI 生成的报告才应该被版本化

        if (typeof this.logTerminal === 'function') {
            this.logTerminal('系统', '长文档已加载，将进行深度分析。请设置项目目标后开始。', 'normal');
        }

        // 进入 brief 收集阶段，让用户设置目标
        this.state = 'idle';
        this.renderPreviewArea();

        // 自动打开 brief 表单
        if (typeof this.openProjectBriefForm === 'function') {
            this.openProjectBriefForm();
        }
    },

    async _startFromPastedTextSimple(content) {
        await this._ensureRuntime({ mode: 'textprep' });

        if (typeof this.logTerminal === 'function') this.logTerminal('系统', '开始处理粘贴文档...', 'normal');
        this.state = 'reading';
        if (Array.isArray(this._runtimeTodoTexts) && typeof this.updateTodos === 'function') {
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({ text, status: i === 0 ? 'active' : 'pending' })));
        }
        this.renderPreviewArea();

        const title = this._extractTitleFromText(content);
        // 生成摘要：取 MD 的前 800 字符，去除标题行
        const summaryText = content.replace(/^#{1,6}\s+.+\n?/gm, '').trim().slice(0, 800);
        const contentPackage = {
            title,
            summary: summaryText,
            report: { markdown: content },
            slideIntents: this._generateSlideIntentsFromMarkdown(content),
            metadata: { source: 'paste', timestamp: Date.now() }
        };

        this.workflowData.contentPackage = contentPackage;
        this.workflowData.report = contentPackage.report;
        this.workflowData.slideIntents = contentPackage.slideIntents;
        this.workflowData.reportMarkdown = content;
        // 注意：不在这里调用 _onReportUpdated，初始输入不应记录为报告版本

        // 标记需要运行真正的 TextPrep（在 confirmScript 后执行）
        this.workflowData._needsTextPrep = true;
        this.workflowData._useDeepSearch = false;

        if (typeof this.logTerminal === 'function') this.logTerminal('系统', '文档已解析，点击确认后将进行 AI 分析', 'normal');
        this.state = 'script_review';
        if (Array.isArray(this._runtimeTodoTexts) && typeof this.updateTodos === 'function') {
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
                if (i < 2) return { text, status: 'completed' };
                if (i === 2) return { text, status: 'active' };
                return { text, status: 'pending' };
            }));
        }
        this.renderPreviewArea();
    },

    _extractTitleFromText(text) {
        const content = typeof text === 'string' ? text : '';
        const match = content.match(/^#\s+(.+)/m);
        if (match) return match[1].trim();
        return content.slice(0, 50).split('\n')[0].trim() || '粘贴文档';
    },

	    _generateSlideIntentsFromMarkdown(markdown) {
	        const md = typeof markdown === 'string' ? markdown : '';
	        const hasHeadings = /^#{1,2}\s/m.test(md);
	
	        // 辅助函数：从正文提取 keyPoints，优先取列表项和短段落
	        const extractKeyPoints = (text, max = 8) => {
	            const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
	            const bullets = lines.filter(l => /^[-*•]\s/.test(l)).map(l => l.replace(/^[-*•]\s*/, ''));
	            const numbered = lines.filter(l => /^\d+[.)]\s/.test(l)).map(l => l.replace(/^\d+[.)]\s*/, ''));
	            const shortParas = lines.filter(l => !l.startsWith('#') && l.length > 10 && l.length < 200);
	            // 优先级：列表项 > 编号项 > 短段落
	            return [...bullets, ...numbered, ...shortParas].slice(0, max);
	        };
	
	        if (!hasHeadings) {
	            const keyPoints = extractKeyPoints(md);
	            return [{
	                slideIntentId: 'si_0',
	                index: 0,
	                title: '内容',
	                content: md,
	                pageType: 'content',
	                keyPoints: keyPoints.length ? keyPoints : md.split(/\n+/).filter(l => l.trim()).slice(0, 8)
	            }];
	        }
	
	        const sections = md.split(/(?=^#{1,2}\s)/m).filter(Boolean);
	        return sections.map((section, i) => {
	            const titleMatch = section.match(/^#{1,2}\s+(.+)/m);
	            const bodyText = section.replace(/^#{1,2}\s+.+\n?/, '').trim();
	            const keyPoints = extractKeyPoints(bodyText);
	            return {
	                slideIntentId: `si_${i}`,
	                index: i,
	                title: titleMatch ? titleMatch[1].trim() : `第 ${i + 1} 页`,
	                content: section.trim(),
	                pageType: i === 0 ? 'cover' : 'content',
	                keyPoints: keyPoints.length ? keyPoints : bodyText.split(/\n+/).filter(l => l.trim() && !l.startsWith('#')).slice(0, 8),
	                objective: bodyText.slice(0, 200)  // 添加 objective 作为备用
	            };
	        });
	    },

    async _ensurePptxSlideParser() {
        if (typeof PPTXSlideParser !== 'undefined') return PPTXSlideParser;
        if (typeof window !== 'undefined' && window?.PPTXSlideParser) return window.PPTXSlideParser;

        // Browser runtime: load legacy script (non-module) on demand.
        if (typeof document !== 'undefined' && document?.createElement) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'js/ppt/slide-parser-pptx.js';
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('加载 slide-parser-pptx.js 失败'));
                document.head.appendChild(script);
            });
            if (typeof PPTXSlideParser !== 'undefined') return PPTXSlideParser;
            if (typeof window !== 'undefined' && window?.PPTXSlideParser) return window.PPTXSlideParser;
        }

        throw new Error('PPTXSlideParser 未加载');
    },

    _pptxSlidesToSlideIntents(slides = [], filename = 'slides.pptx') {
        const safeSlides = Array.isArray(slides) ? slides : [];

        const toText = (v) => (typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)));
        const slideTitle = (slide) => {
            const els = Array.isArray(slide?.elements) ? slide.elements : [];
            for (const el of els) {
                if (el?.type !== 'text') continue;
                const role = toText(el?.role).trim();
                const content = toText(el?.content).trim();
                if (role === 'title' && content) return content;
            }
            for (const el of els) {
                if (el?.type !== 'text') continue;
                const content = toText(el?.content).trim();
                if (content) return content;
            }
            return '';
        };

        const keyPointsFromSlide = (slide) => {
            const els = Array.isArray(slide?.elements) ? slide.elements : [];
            const lines = [];
            for (const el of els) {
                if (el?.type !== 'text') continue;
                const content = toText(el?.content).trim();
                if (!content) continue;
                lines.push(...content.split(/\n+/).map((s) => s.trim()).filter(Boolean));
            }
            return lines.slice(0, 8);
        };

        return safeSlides.map((slide, i) => {
            const title = slideTitle(slide) || `Slide ${i + 1}`;
            const keyPoints = keyPointsFromSlide(slide).filter((v) => v !== title).slice(0, 8);
            return {
                slideIntentId: `pptx_s${i + 1}`,
                index: i,
                pageType: i === 0 ? 'cover' : 'content',
                title,
                objective: '',
                keyPoints,
                claimIds: [],
                dataTableIds: [],
                source: { type: 'pptx', filename },
            };
        });
    },

    _pptxSlidesToDeckHtmlDsl(slides = []) {
        const safeSlides = Array.isArray(slides) ? slides : [];

        const escapeAttr = (v) =>
            String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

        const escapeHtml = (v) =>
            String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/\n/g, '<br>');

        const attr = (k, v) => {
            if (v === undefined || v === null) return '';
            const s = String(v).trim();
            if (!s) return '';
            return ` ${k}="${escapeAttr(s)}"`;
        };

        const elToHtml = (el) => {
            if (!el || typeof el !== 'object') return '';
            const type = String(el.type || '').trim();
            if (!type) return '';

            const id = el.id ? ` id="${escapeAttr(el.id)}"` : '';
            const pos = `${attr('data-x', el.x)}${attr('data-y', el.y)}${attr('data-w', el.w)}${attr('data-h', el.h)}`;
            const rotate = attr('data-rotate', el.rotate ?? el.rotation);

            if (type === 'text') {
                const role = attr('data-role', el.role);
                const font = attr('data-font', el.fontSize ?? el.font);
                const color = attr('data-color', el.color);
                const bold = el.bold ? ' data-bold="true"' : '';
                const italic = el.italic ? ' data-italic="true"' : '';
                const align = attr('data-align', el.align);
                return `<div data-el="text"${id}${pos}${rotate}${font}${color}${bold}${italic}${align}${role}>${escapeHtml(el.content || '')}</div>`;
            }

            if (type === 'image') {
                const src = el.src || '';
                const alt = el.alt || '图片';
                return `<div data-el="image"${id}${pos}${rotate}${attr('data-src', src)}${attr('data-alt', alt)}></div>`;
            }

            if (type === 'shape') {
                const shape = el.shape || el.shapeType || 'rect';
                const fill = el.fill || '#4f46e5';
                const stroke = attr('data-stroke', el.stroke);
                const strokeWidth = attr('data-stroke-width', el.strokeWidth);
                const role = attr('data-role', el.role);
                return `<div data-el="shape"${id}${pos}${rotate}${attr('data-shape', shape)}${attr('data-fill', fill)}${stroke}${strokeWidth}${role}></div>`;
            }

            if (type === 'chart') {
                return `<div data-el="chart"${id}${pos}${rotate}${attr('data-chart-type', el.chartType)}${attr('data-title', el.title)}${attr('data-chart-data', JSON.stringify(el.chartData || {}))}></div>`;
            }

            if (type === 'table') {
                return `<div data-el="table"${id}${pos}${rotate}${attr('data-data', JSON.stringify(el.data || []))}></div>`;
            }

            if (type === 'line') {
                return `<div data-el="line"${id}${attr('data-x1', el.x1)}${attr('data-y1', el.y1)}${attr('data-x2', el.x2)}${attr('data-y2', el.y2)}${attr('data-stroke', el.stroke)}${attr('data-stroke-width', el.strokeWidth)}></div>`;
            }

            return '';
        };

        return safeSlides
            .map((slide, i) => {
                const bg = String(slide?.background || '#ffffff');
                const bgAttr = bg.startsWith('linear-gradient') ? ` data-gradient="${escapeAttr(bg)}"` : ` data-bg="${escapeAttr(bg)}"`;
                const sectionId = `pptx-slide-${i + 1}`;
                const els = (Array.isArray(slide?.elements) ? slide.elements : []).map(elToHtml).filter(Boolean).join('\n  ');
                return `<section data-type="freeform" id="${sectionId}"${bgAttr}>\n  ${els}\n</section>`;
            })
            .join('\n\n');
    },

    async importPptxAsDeck(pptxFile, { autoOpenAfter = true } = {}) {
        try {
            if (!pptxFile) throw new Error('请选择 PPTX 文件');

            const filename = typeof pptxFile?.name === 'string' ? pptxFile.name : 'slides.pptx';
            const Parser = await this._ensurePptxSlideParser();
            const parser = new Parser();

            // slide-parser-pptx.js supports File/Blob/ArrayBuffer; tests may pass file-like.
            const input = typeof pptxFile?.arrayBuffer === 'function' ? await pptxFile.arrayBuffer() : pptxFile;
            const result = await parser.parse(input);

            const slides = Array.isArray(result?.slides) ? result.slides : [];
            if (!slides.length) throw new Error('PPTX 解析失败：未读取到幻灯片');

            const slideIntents = this._pptxSlidesToSlideIntents(slides, filename);
            const templateDeckHtmlDsl = this._pptxSlidesToDeckHtmlDsl(slides);

            if (!this.workflowData) this.workflowData = {};
            this.workflowData.slideIntents = slideIntents;
            this.workflowData.contentPackage = {
                schemaVersion: '0.1',
                title: filename,
                summary: 'Imported PPTX template',
                constraints: {},
                slideIntents,
                templateDeckHtmlDsl,
                templateMeta: result?.metadata || null,
            };

            // Run as a "design.batch" entry to keep the workflow consistent.
            await this._ensureRuntime({ mode: 'textprep' });
            this._orchestrator?.start?.();

            this.state = 'designer';
            this.renderPreviewArea?.();

            await this._orchestrator.runStage('design.batch', { contentPackage: this.workflowData.contentPackage });

            // For template import we can directly open the deck.
            if (autoOpenAfter) {
                this.state = 'completed';
                this.renderPreviewArea?.();
            }

            return { ok: true, slideCount: slides.length };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err || 'unknown error');
            console.warn('[importPptxAsDeck] failed:', err);
            this.addChatMessage?.('ai', `PPTX 导入失败：${msg}。已回退到手动输入流程。`);
            // Best-effort fallback to the manual/paste flow.
            this.state = 'idle';
            this.renderPreviewArea?.();
            try {
                this.openPasteDocumentModal?.();
            } catch {
                // ignore
            }
            return { ok: false, error: msg };
        }
    },

    async importPptxAsDeckFromPicker() {
        if (typeof document === 'undefined') {
            throw new Error('当前环境不支持文件选择器');
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pptx';
        input.onchange = async (e) => {
            const file = e?.target?.files?.[0];
            if (!file) return;
            await this.importPptxAsDeck(file);
        };
        input.click();
    },

    async startMultiAgentWorkflow({ skipBriefCheck = false } = {}) {
        // 防止重复触发
        if (this._workflowLock) {
            console.warn('[Workflow] startMultiAgentWorkflow 已在运行中，忽略重复调用');
            if (typeof this.logTerminal === 'function') {
                this.logTerminal('系统', '工作流已在运行中，请勿重复点击', 'warning');
            }
            return;
        }

        const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
        if (!files.length) {
            this.addChatMessage('ai', '请先上传至少一个文档或粘贴文本素材。');
            return;
        }

        this._ensureDesignSystemInitialized();
        const taskGoal = this._deriveTaskGoal();
        if (!skipBriefCheck && (!taskGoal || taskGoal === DEFAULT_TASK_GOAL)) {
            this._pendingStartAfterBrief = true;
            this.openProjectBriefForm();
            return;
        }

        // 设置锁
        this._workflowLock = true;
        console.log('[Workflow] startMultiAgentWorkflow 开始执行');

        const brief = this.workflowData?.projectBrief || {};
        const constraints = {
            ...(typeof brief?.audience === 'string' && brief.audience.trim() ? { audience: brief.audience.trim() } : {}),
            ...(typeof brief?.tone === 'string' && brief.tone.trim() ? { tone: brief.tone.trim() } : {}),
        };

        await this._ensureRuntime({ constraints });
        this._orchestrator.start();
        this._resetDeepSearchViz();

        try {
            await this.phase1_DeepReading();
        } catch (err) {
            this._abortWorkflow(err);
        } finally {
            // 释放锁
            this._workflowLock = false;
            console.log('[Workflow] startMultiAgentWorkflow 执行完毕');
        }
    },

    // --- Phase 1: Reader Agent (Deep Metadata Extraction) ---
    async phase1_DeepReading() {
        const files = Array.isArray(this.workflowData.files) ? this.workflowData.files : [];
        if (!files.length) {
            this.addChatMessage('ai', '请先上传至少一个文档或粘贴文本素材。');
            return;
        }

        const taskGoal = this._deriveTaskGoal();
        if (!taskGoal || taskGoal === DEFAULT_TASK_GOAL) {
            this._pendingStartAfterBrief = true;
            this.openProjectBriefForm();
            return;
        }

        this._renderFileGrid(files);

        const ingestInput = this._buildIngestInputFromWorkflowFiles(files);

        // 如果有预构建的 sources（来自粘贴的长文本），直接使用
        const prebuiltSources = Array.isArray(ingestInput.sources) ? ingestInput.sources : [];
        const hasPrebuiltSources = prebuiltSources.length > 0;

        let sources = [];
        if (hasPrebuiltSources && !ingestInput.files.length && !ingestInput.urls.length && !ingestInput.rawTexts.length && !ingestInput.historyIds.length) {
            // 只有预构建的 sources，跳过 ingest 阶段
            sources = prebuiltSources;
            this.workflowData.ingest = { sources, skipped: true };
            if (typeof this.logTerminal === 'function') {
                this.logTerminal('系统', '使用已解析的文档内容，跳过文件读取阶段', 'normal');
            }
        } else {
            // 正常运行 ingest 阶段
            const ingestOut = await this._orchestrator.runStage('deepsearch.ingest', ingestInput);
            this.workflowData.ingest = ingestOut;
            sources = Array.isArray(ingestOut?.sources) ? ingestOut.sources : [];
            // 合并预构建的 sources
            if (prebuiltSources.length) {
                sources = [...prebuiltSources, ...sources];
            }
        }

        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        const stepping = mode !== 'auto';

        // DeepSearch 优化参数配置
        const userConfig = {
            title: this.currentProject?.title || 'New Mission',
            ...(stepping ? { maxIterations: 1 } : {}),
            // Task 1: 工具链配置
            retrieval: {
                enableToolChain: true,  // 启用工具链
                minGrepHits: 15,        // 提高阈值，减少 BM25 调用
                bm25MinScore: 0.5,      // BM25 结果质量阈值
            },
            // Task 3: 迭代策略配置
            gaps: {
                blockAfterMisses: 5,    // 允许更多轮次尝试
            },
            // ReAct Writer: 问题驱动的渐进式写作
            write: {
                writerMode: 'react',    // 'react' | 'legacy'
            },
        };

        this.workflowData._deepsearchInput = { sources, taskGoal, userConfig };

        const { DeepSearchState } = await import('../agents/stages/deepsearch/state.js');
        const runId = this._orchestrator?.runContext?.runId || `run_${Date.now()}`;
        const state = new DeepSearchState({ runId, taskGoal, userConfig, L0: { sources } });
        this._deepsearchState = state;
        this._syncDeepSearchVizFromState(state);

        const pkg = await this._orchestrator.runStage('deepsearch.pipeline', { state });
        console.log('[Workflow] deepsearch.pipeline 完成，准备转换状态', { mode, hasPkg: !!pkg });

        this.workflowData.contentPackage = pkg;
        this.workflowData.report = pkg?.report || null;
        this.workflowData.slideIntents = pkg?.slideIntents || [];
        this._onReportUpdated?.(pkg?.report?.markdown || '', `DeepSearch 报告（第 ${(typeof state?.iteration === 'number' ? state.iteration : 0) + 1} 轮）`);

        this._syncDeepSearchVizFromState(state);

        if (mode === 'auto') {
            console.log('[Workflow] Auto 模式，继续执行 phase2_Scripting');
            await this.phase2_Scripting();
            return;
        }

        console.log('[Workflow] 非 Auto 模式，进入 deepsearch_review 状态');
        this.state = 'deepsearch_review';
        this.addChatMessage('ai', 'DeepSearch 已完成当前轮次。您可以继续下一轮迭代，或进入脚本编辑。');
        this.renderPreviewArea();
    },

    _deriveTaskGoal() {
        const briefGoal = typeof this.workflowData?.projectBrief?.taskGoal === 'string' ? this.workflowData.projectBrief.taskGoal.trim() : '';
        if (briefGoal) return briefGoal;

        // Legacy fallback: older UI may write taskGoal directly.
        const legacy = typeof this.workflowData?.taskGoal === 'string' ? this.workflowData.taskGoal.trim() : '';
        if (legacy) return legacy;

        return DEFAULT_TASK_GOAL;
    },

    async continueDeepSearchIteration() {
        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        if (mode === 'auto') {
            this.addChatMessage('ai', '当前为 Auto-pilot 模式，无需手动触发下一轮。');
            return;
        }

        if (!this._orchestrator || this._orchestrator.state !== 'running') {
            const brief = this.workflowData?.projectBrief || {};
            const constraints = {
                ...(typeof brief?.audience === 'string' && brief.audience.trim() ? { audience: brief.audience.trim() } : {}),
                ...(typeof brief?.tone === 'string' && brief.tone.trim() ? { tone: brief.tone.trim() } : {}),
            };
            await this._ensureRuntime({ constraints });
            this._orchestrator.start();
        }

        const input = this.workflowData?._deepsearchInput || {};
        const taskGoal = typeof input.taskGoal === 'string' ? input.taskGoal : this._deriveTaskGoal();
        const sources = Array.isArray(input.sources) ? input.sources : Array.isArray(this.workflowData?.ingest?.sources) ? this.workflowData.ingest.sources : [];

        // 优化参数配置（与 phase1_DeepReading 保持一致）
        const baseUserConfig = input.userConfig && typeof input.userConfig === 'object'
            ? input.userConfig
            : {
                title: this.currentProject?.title || 'New Mission',
                retrieval: { enableToolChain: true, minGrepHits: 15, bm25MinScore: 0.5 },
                gaps: { blockAfterMisses: 5 },
                write: { writerMode: 'react' },
            };

        if (!this._deepsearchState) {
            const { DeepSearchState } = await import('../agents/stages/deepsearch/state.js');
            const runId = this._orchestrator?.runContext?.runId || `run_${Date.now()}`;
            this._deepsearchState = new DeepSearchState({ runId, taskGoal, userConfig: baseUserConfig, L0: { sources } });
        }

        const state = this._deepsearchState;
        state.taskGoal = taskGoal;
        state.userConfig = { ...(state.userConfig || {}), ...(baseUserConfig || {}) };
        state.L0 = { ...(state.L0 || {}), sources };

        // Guided/Manual: run exactly one extra iteration each time.
        state.maxIterations = Math.max(1, (typeof state.iteration === 'number' ? state.iteration : 0) + 1);
        this._syncDeepSearchVizFromState(state);

        this.state = 'researching';
        this.renderPreviewArea();

        try {
            const pkg = await this._orchestrator.runStage('deepsearch.pipeline', { state });
            this.workflowData.contentPackage = pkg;
            this.workflowData.report = pkg?.report || null;
            this.workflowData.slideIntents = pkg?.slideIntents || [];
            this._onReportUpdated?.(pkg?.report?.markdown || '', `DeepSearch 报告（第 ${state.iteration + 1} 轮）`);
            this._syncDeepSearchVizFromState(state);
            this.state = 'deepsearch_review';
            this.renderPreviewArea();
        } catch (err) {
            this._abortWorkflow(err);
        }
    },

    proceedToScriptReview() {
        this.phase2_Scripting();
    },

    _resetDeepSearchViz() {
        if (!this.workflowData) this.workflowData = {};
        this.workflowData.deepsearchViz = {
            iteration: 0,
            maxIterations: 1,
            lastCompletedIteration: null,
            openGapCount: 0,
            gaps: [],
            updatedAt: Date.now(),
            // 新增：阶段追踪
            currentPhase: null,          // 当前阶段: scan, gaps, retrieve, understand, write, condense
            phaseHistory: [],             // 阶段历史记录
            stageMetrics: {               // 每个阶段的指标
                scan: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                gaps: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                retrieve: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                understand: { status: 'pending', startedAt: null, completedAt: null, detail: null },
                write: { status: 'pending', startedAt: null, completedAt: null, detail: null },
            },
        };
    },

    _syncDeepSearchVizFromState(state) {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.deepsearchViz) this._resetDeepSearchViz();
        const viz = this.workflowData.deepsearchViz;

        viz.iteration = typeof state?.iteration === 'number' ? state.iteration : 0;
        viz.maxIterations = typeof state?.maxIterations === 'number' ? state.maxIterations : viz.maxIterations;
        const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
        viz.gaps = gaps.map(g => ({
            gapId: g?.gapId,
            type: g?.type,
            question: g?.question,
            priority: g?.priority,
            status: g?.status,
            missCount: g?.missCount,
            blockedReason: g?.blockedReason,
        }));
        viz.openGapCount = gaps.filter(g => (g?.status ? String(g.status) : 'open') === 'open').length;
        viz.updatedAt = Date.now();
    },

    _buildIngestInputFromWorkflowFiles(files) {
        const out = { files: [], urls: [], historyIds: [], rawTexts: [], sources: [] };
        for (const item of Array.isArray(files) ? files : []) {
            if (!item) continue;
            if (item.type === 'link') {
                if (typeof item.name === 'string' && item.name.trim()) out.urls.push(item.name.trim());
                continue;
            }
            if (item.type === 'history') {
                if (typeof item.historyId === 'string' && item.historyId.trim()) out.historyIds.push(item.historyId.trim());
                continue;
            }
            if (item.type === 'rawText') {
                if (typeof item.text === 'string' && item.text.trim()) out.rawTexts.push({ title: item.name || 'User Input', text: item.text });
                continue;
            }
            // 支持粘贴的长文本（已转为 source）
            if (item.type === 'paste' && item._source) {
                out.sources.push(item._source);
                continue;
            }
            if (item.type === 'paste' && typeof item.content === 'string') {
                out.rawTexts.push({ title: item.name || '粘贴文档', text: item.content });
                continue;
            }
            if (item.file) {
                out.files.push(item.file);
                continue;
            }
            // Best-effort: treat as file-like object if it has text()/arrayBuffer().
            if (typeof item.text === 'function' || typeof item.arrayBuffer === 'function') out.files.push(item);
        }
        return out;
    },

    // --- Phase 2: Analyst Agent (Scripting) ---
    async phase2_Scripting() {
        console.log('[Workflow] phase2_Scripting 开始');
        const reportMd = this.workflowData?.report?.markdown || '';
        this.workflowData.reportMarkdown = reportMd;
        const iter = typeof this.workflowData?.deepsearchViz?.iteration === 'number' ? this.workflowData.deepsearchViz.iteration : null;
        this._onReportUpdated?.(reportMd, iter !== null ? `DeepSearch 报告（第 ${iter + 1} 轮）` : 'DeepSearch 报告');

        this.state = 'script_review';
        console.log('[Workflow] 进入 script_review 状态');
        this.addChatMessage('ai', '研究报告已生成。请在中间区域审阅并编辑脚本内容，确认后进入页面规划。');
        this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
            if (i < 2) return { text, status: 'completed' };
            if (i === 2) return { text, status: 'active' };
            return { text, status: 'pending' };
        }));
        this.renderPreviewArea();
    },

    updateReportMarkdown(value) {
        if (typeof value !== 'string') return;
        this.workflowData.reportMarkdown = value;
        if (this.workflowData.contentPackage?.report) {
            this.workflowData.contentPackage.report = { ...(this.workflowData.contentPackage.report || {}), markdown: value };
        }
    },

    confirmScript() {
        const md = typeof this.workflowData?.reportMarkdown === 'string'
            ? this.workflowData.reportMarkdown
            : (this.workflowData?.report?.markdown || '');

        this._onReportUpdated?.(md, '当前编辑稿');

        const panel = this._ensureReportReviewPanel?.();
        if (!panel) {
            this._confirmScriptToPageLayout();
            return;
        }

        if (panel.versions.length > 0) {
            panel.selectedVersionIndex = panel.versions.length - 1;
            const v = panel.versions[panel.selectedVersionIndex];
            if (v) v.isNew = false;
            panel.updateBadge();
        }
        panel.open();
    },

    autoFillAnswers() {
        // Simulate AI decision
        this.submitAnswers();
    },

    async submitAnswers() {
        // In a real app, we'd gather form data here.
        this.state = 'outline_review';
        this.renderPreviewArea(); // Show Outline Review
        this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
            if (i < 2) return { text, status: 'completed' };
            if (i === 2) return { text, status: 'active' };
            return { text, status: 'pending' };
        }));
    },

    confirmOutline() {
        this.state = 'scripting';
        this.renderPreviewArea(); // Switch back to terminal view
        this.phase3_Scripting();
    },

    regenerateOutline() {
        this.addChatMessage('ai', '正在重新生成大纲，请稍候...');
        // Mock regeneration delay
        setTimeout(() => {
            this.renderPreviewArea();
        }, 1000);
    },

    updateOutlineTitle(index, value) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[index].title = value;
    },

    updateOutlineSub(parentIndex, subIndex, value) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs[subIndex] = value;
    },

    addOutlineSub(parentIndex) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs.push("新子项");
        this.renderPreviewArea();
    },

    removeOutlineSub(parentIndex, subIndex) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs.splice(subIndex, 1);
        this.renderPreviewArea();
    },

    // --- Phase 3: Analyst Agent (Scripting) ---
    async phase3_Scripting() {
        await this._orchestrator.runStage('textprep.slideplan');
        this.phase4_Segmentation();
    },

    // --- Phase 3: Page Layout (uses DeepSearch slideIntents) ---
    async phase3_PageLayout() {
        console.log('[Workflow] phase3_PageLayout 开始');
        try {
            if (this.workflowData?._needsTextPrep) {
                console.log('[Workflow] 执行 textprep.slideplan');
                await this._orchestrator.runStage('textprep.slideplan');
                this.workflowData._needsTextPrep = false;
            }
            console.log('[Workflow] 执行 textprep.align');
            await this._orchestrator.runStage('textprep.align', { contentPackage: this.workflowData.contentPackage });
            this.phase5_DesignOptimization();
        } catch (err) {
            console.error('[Workflow] phase3_PageLayout 失败:', err);
            this._abortWorkflow(err);
        }
    },

    // --- Phase 4: Designer Agent (Segmentation & Mapping) ---
    async phase4_Segmentation() {
        await this._orchestrator.runStage('textprep.align');
        this.phase5_DesignOptimization();
    },

    // --- Phase 5: Designer Agent (Design Optimization) ---
    async phase5_DesignOptimization() {
        console.log('[Workflow] phase5_DesignOptimization 开始');
        try {
            this._ensureDesignSystemInitialized();
            console.log('[Workflow] 执行 design.batch');
            await this._orchestrator.runStage('design.batch');
            this.phase6_FinalReview();
        } catch (err) {
            console.error('[Workflow] phase5_DesignOptimization 失败:', err);
            this._abortWorkflow(err);
        }
    },

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        console.log('[Workflow] phase6_FinalReview 开始');
        try {
            console.log('[Workflow] 执行 evaluate.hardgates');
            await this._orchestrator.runStage('evaluate.hardgates');
            this._orchestrator.end();
        } catch (err) {
            console.error('[Workflow] phase6_FinalReview 失败:', err);
            this._abortWorkflow(err);
            return;
        }

        console.log('[Workflow] 工作流完成，进入 completed 状态');
        this.state = 'completed';
        this.currentProject.status = 'completed';
        this._saveProject();

        this.addChatMessage('ai', '任务完成。演示文稿已生成。');
        setTimeout(() => this.renderPreviewArea(), 1000);
    },

    _setAgentStatus(id, status, activity) {
        this.agents[id] = { status, activity };
        // Re-render just the agent cards if possible, or full area
        this.renderPreviewArea();
    },

    _renderFileGrid(files) {
        const grid = document.getElementById('fileProcessingGrid');
        if (!grid) return;

        grid.innerHTML = files.map((f, i) => `
            <div class="gen-file-item" id="file-node-${i}">
                <div class="gen-file-icon">
                    <iconify-icon icon="carbon:document"></iconify-icon>
                </div>
                <div class="gen-file-name">${f.name}</div>
                <div class="gen-file-status">
                    <span class="file-percent">0%</span>
                </div>
            </div>
        `).join('');
    },

    async _simulateParallelReading(files, targetProgress = 100) {
        // If we are continuing, we need to know current progress.
        // For simplicity in this simulation, we just animate from 0 or previous known state.
        // But here we'll just animate to targetProgress.

        const updates = files.map(() => ({ progress: 0 })); // Reset for demo or track properly

        return new Promise(resolve => {
            const interval = setInterval(() => {
                let allReached = true;
                files.forEach((_, i) => {
                    if (updates[i].progress < targetProgress) {
                        updates[i].progress += Math.random() * 5; // Slower
                        if (updates[i].progress > targetProgress) updates[i].progress = targetProgress;

                        // Update DOM
                        const node = document.getElementById(`file-node-${i}`);
                        if (node) {
                            // node.querySelector('.file-progress-bar').style.width = `${updates[i].progress}%`; // Removed bar
                            node.querySelector('.file-percent').innerText = `${Math.floor(updates[i].progress)}%`;
                            if (updates[i].progress === 100) {
                                node.querySelector('.gen-file-status').innerHTML = '<iconify-icon icon="carbon:checkmark-filled" style="color: var(--ppt-success)"></iconify-icon>';
                            }
                        }
                        allReached = false;
                    }
                });

                if (allReached) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    },

    async logTerminal(agent, msg, type = 'normal') {
        const entry = { time: new Date().toLocaleTimeString(), agent, msg, type };
        this.processLogs.push(entry);
        this.currentProject.logs = this.processLogs;
        this._saveProject();
        this._appendLogToTerminal(entry);

        // Update floating process panel if available
        if (typeof this.addProcessPanelStep === 'function') {
            this.addProcessPanelStep({
                name: `log.${type}`,
                text: msg,
                details: { agent }
            });
        }

        await new Promise(r => setTimeout(r, 300)); // Typing delay
    },

    _appendLogToTerminal(log) {
        const term = document.getElementById('agentTerminal');
        if (!term) return;

        // Minimal ticker style: just show the latest message with a dot
        term.innerHTML = `
            <div class="gen-log-dot"></div>
            <div class="gen-log-content">
                <span style="font-weight: 600; color: var(--ppt-accent);">${log.agent}:</span>
                <span>${log.msg}</span>
            </div>
        `;

        // Ensure the terminal scrolls to show the latest message if needed,
        // though currently it replaces content. If we want history, we'd append.
        // For now, just ensuring the container can handle the height.
    },

    _abortWorkflow(err) {
        const msg = err instanceof Error ? err.message : String(err || 'unknown error');
        try {
            this._orchestrator?.stop?.('workflow_failed');
        } catch {
            // ignore
        }
        this.state = 'failed';
        this.currentProject.status = 'failed';
        this._saveProject?.();
        this.addChatMessage('ai', `流程已中止：${msg}`);
        this.renderPreviewArea();
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorWorkflow);
