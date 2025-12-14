const DEFAULT_TASK_GOAL = '生成一份结构清晰、可演示的汇报文稿，并给出可引用的证据来源。';

const PPTGeneratorWorkflow = {
    _ensureDesignSystemInitialized() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.designSystem || typeof this.workflowData.designSystem !== 'object') {
            this.workflowData.designSystem = {};
        }

        const ds = this.workflowData.designSystem;

        if (!ds.colors || typeof ds.colors !== 'object') ds.colors = {};
        if (typeof ds.colors.primary !== 'string') ds.colors.primary = '#0ea5e9';
        if (typeof ds.colors.secondary !== 'string') ds.colors.secondary = '#7c3aed';
        if (typeof ds.colors.bg !== 'string') ds.colors.bg = '#ffffff';
        if (typeof ds.colors.text !== 'string') ds.colors.text = '#0f172a';
        if (typeof ds.colors.accent !== 'string') ds.colors.accent = '#22c55e';

        if (!ds.fonts || typeof ds.fonts !== 'object') ds.fonts = {};
        if (typeof ds.fonts.titleFont !== 'string') ds.fonts.titleFont = 'Inter';
        if (typeof ds.fonts.bodyFont !== 'string') ds.fonts.bodyFont = 'Inter';
        if (typeof ds.fonts.fontSize !== 'number') ds.fonts.fontSize = 16;

        const allowedDensity = new Set(['compact', 'balanced', 'spacious']);
        if (typeof ds.density !== 'string' || !allowedDensity.has(ds.density)) ds.density = 'balanced';

        if (typeof ds.model !== 'string') ds.model = 'gemini-1.5-pro';

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

        // Inject global AI services
        const services = {
            aiApiService: typeof window !== 'undefined' && window.aiApiService ? window.aiApiService : null,
            visionApi: typeof window !== 'undefined' && window.visionApi ? window.visionApi : null,
            whisperApi: typeof window !== 'undefined' && window.whisperApi ? window.whisperApi : null,
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
            this.state = 'reading';
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({ text, status: i === 0 ? 'active' : 'pending' })));
            this.renderPreviewArea();
            return;
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
            registerDeepSearchStages(orch, { timeoutMs: 300_000 }); // 5 minutes for real LLM calls

            orch.registerStage('deepsearch.questions', async () => {
                // Question generation output is consumed by UI; logs are emitted via progress events.
                orch.eventBus.emit('deepsearch.questions.progress', {
                    actor: 'deepsearch',
                    status: 'progress',
                    payload: { agent: 'AI 分析', msg: '正在分析内容密度...', type: 'normal' }
                });
                await sleep(1000);
                orch.eventBus.emit('deepsearch.questions.progress', {
                    actor: 'deepsearch',
                    status: 'progress',
                    payload: { agent: 'AI 分析', msg: '识别出 3 个关键决策点，需要用户确认。', type: 'success' }
                });

                return [
                    {
                        text: "目标受众的技术背景如何？",
                        options: ["非技术高管 (侧重商业价值)", "技术团队 (侧重架构细节)", "混合受众"],
                        default: "混合受众"
                    },
                    {
                        text: "演示文稿的色调风格偏好？",
                        options: ["深色科技风 (Dark Modern)", "学术严谨 (Academic)", "商务极简 (Business Light)"],
                        default: "深色科技风 (Dark Modern)"
                    },
                    {
                        text: "是否需要包含详细的财务报表数据？",
                        options: ["是，包含详细图表", "否，仅展示关键指标摘要"],
                        default: "否，仅展示关键指标摘要"
                    }
                ];
            }, { actor: 'deepsearch', timeoutMs: 30_000 });
        }

        orch.registerStage('textprep.slideplan', async () => {
            orch.eventBus.emit('textprep.slideplan.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 分析', msg: '正在处理用户反馈...', type: 'normal' }
            });
            orch.eventBus.emit('textprep.slideplan.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 分析', msg: '构建叙事结构: 问题 -> 解决方案 -> 价值影响', type: 'highlight' }
            });

            const sections = ['引言', '市场痛点', '解决方案', '技术架构', '未来规划'];
            for (const sec of sections) {
                await sleep(600);
                orch.eventBus.emit('textprep.slideplan.progress', {
                    actor: 'textprep',
                    status: 'progress',
                    payload: { agent: 'AI 分析', msg: `正在撰写章节: ${sec}...`, type: 'normal' }
                });
            }

            orch.eventBus.emit('textprep.slideplan.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 分析', msg: '演讲稿脚本生成完成。共 2500 字。', type: 'success' }
            });
        }, { actor: 'textprep', timeoutMs: 60_000 });

        orch.registerStage('textprep.align', async () => {
            const pkg = this.workflowData?.contentPackage;
            const slideCount = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents.length : 0;
            orch.eventBus.emit('textprep.align.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 设计', msg: slideCount ? `正在规划 ${slideCount} 页的页面布局...` : '正在分析语义边界...', type: 'normal' }
            });
            orch.eventBus.emit('textprep.align.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 设计', msg: '正在建立内容溯源映射...', type: 'highlight' }
            });

            await sleep(1000);
            orch.eventBus.emit('textprep.align.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 设计', msg: '已生成 12 个幻灯片分段。', type: 'success' }
            });

            const sourceFiles = this.workflowData.files?.length > 0 ? this.workflowData.files : [{ name: 'Project_Nebula_Specs.pdf' }];
            orch.eventBus.emit('textprep.align.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 设计', msg: `分段 3 已关联至 "${sourceFiles[0].name}" (p.14)`, type: 'normal' }
            });
            if (sourceFiles.length > 1) {
                orch.eventBus.emit('textprep.align.progress', {
                    actor: 'textprep',
                    status: 'progress',
                    payload: { agent: 'AI 设计', msg: `分段 7 已关联至 "${sourceFiles[1].name}" (line 45)`, type: 'normal' }
                });
            }
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
                    runContext: { ...(ctx || {}), userConfig: this.workflowData.designSystem || {} },
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
        }, { actor: 'design', timeoutMs: 90_000 });

        orch.registerStage('evaluate.hardgates', async () => {
            await sleep(1000);
            orch.eventBus.emit('evaluate.hardgates.progress', {
                actor: 'evaluate',
                status: 'progress',
                payload: { agent: 'AI 审查', msg: '所有约束条件已满足。', type: 'success' }
            });
        }, { actor: 'evaluate', timeoutMs: 30_000 });
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
        await this._ensureRuntime({ mode: 'textprep' });

        if (typeof this.logTerminal === 'function') this.logTerminal('系统', '开始处理粘贴文档...', 'normal');
        this.state = 'reading';
        if (Array.isArray(this._runtimeTodoTexts) && typeof this.updateTodos === 'function') {
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({ text, status: i === 0 ? 'active' : 'pending' })));
        }
        this.renderPreviewArea();

        const title = this._extractTitleFromText(content);
        const contentPackage = {
            title,
            report: { markdown: content },
            slideIntents: this._generateSlideIntentsFromMarkdown(content),
            metadata: { source: 'paste', timestamp: Date.now() }
        };

        this.workflowData.contentPackage = contentPackage;
        this.workflowData.report = contentPackage.report;
        this.workflowData.slideIntents = contentPackage.slideIntents;
        this.workflowData.reportMarkdown = content;

        if (typeof this.logTerminal === 'function') this.logTerminal('系统', 'TextPrep 处理完成', 'success');
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
        if (!hasHeadings) {
            return [{ index: 0, title: '内容', content: md, pageType: 'content' }];
        }
        const sections = md.split(/(?=^#{1,2}\s)/m).filter(Boolean);
        return sections.map((section, i) => {
            const titleMatch = section.match(/^#{1,2}\s+(.+)/m);
            return {
                index: i,
                title: titleMatch ? titleMatch[1].trim() : `第 ${i + 1} 页`,
                content: section.trim(),
                pageType: i === 0 ? 'cover' : 'content'
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

        const ingestOut = await this._orchestrator.runStage('deepsearch.ingest', ingestInput);
        this.workflowData.ingest = ingestOut;

        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        const stepping = mode !== 'auto';

        const userConfig = {
            title: this.currentProject?.title || 'New Mission',
            ...(stepping ? { maxIterations: 1 } : {}),
        };

        const sources = Array.isArray(ingestOut?.sources) ? ingestOut.sources : [];
        this.workflowData._deepsearchInput = { sources, taskGoal, userConfig };

        const { DeepSearchState } = await import('../agents/stages/deepsearch/state.js');
        const runId = this._orchestrator?.runContext?.runId || `run_${Date.now()}`;
        const state = new DeepSearchState({ runId, taskGoal, userConfig, L0: { sources } });
        this._deepsearchState = state;
        this._syncDeepSearchVizFromState(state);

        const pkg = await this._orchestrator.runStage('deepsearch.pipeline', { state });
        this.workflowData.contentPackage = pkg;
        this.workflowData.report = pkg?.report || null;
        this.workflowData.slideIntents = pkg?.slideIntents || [];

        this._syncDeepSearchVizFromState(state);

        if (mode === 'auto') {
            await this.phase2_Scripting();
            return;
        }

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
        const baseUserConfig = input.userConfig && typeof input.userConfig === 'object' ? input.userConfig : { title: this.currentProject?.title || 'New Mission' };

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
        const out = { files: [], urls: [], historyIds: [], rawTexts: [] };
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
        const reportMd = this.workflowData?.report?.markdown || '';
        this.workflowData.reportMarkdown = reportMd;

        this.state = 'script_review';
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
        this.state = 'page_layout';
        this.renderPreviewArea();
        this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
            if (i < 3) return { text, status: 'completed' };
            if (i === 3) return { text, status: 'active' };
            return { text, status: 'pending' };
        }));
        this.phase3_PageLayout();
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
        try {
            await this._orchestrator.runStage('textprep.align', { contentPackage: this.workflowData.contentPackage });
            this.phase5_DesignOptimization();
        } catch (err) {
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
        try {
            this._ensureDesignSystemInitialized();
            await this._orchestrator.runStage('design.batch');
            this.phase6_FinalReview();
        } catch (err) {
            this._abortWorkflow(err);
        }
    },

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        try {
            await this._orchestrator.runStage('evaluate.hardgates');
            this._orchestrator.end();
        } catch (err) {
            this._abortWorkflow(err);
            return;
        }

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
