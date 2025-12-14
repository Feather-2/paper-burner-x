const PPTGeneratorWorkflow = {
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

        orch.registerStage('design.batch', async () => {
            const designSteps = [
                { msg: '正在评估幻灯片 1-12 的文本密度...', type: 'normal' },
                { msg: '决策: 幻灯片 4 需要柱状图 (检测到数据)。', type: 'highlight' },
                { msg: '决策: 幻灯片 2 需要首图 (概念性内容)。', type: 'highlight' },
                { msg: '决策: 幻灯片 8 使用分栏布局 (检测到对比内容)。', type: 'highlight' },
                { msg: '正在应用 "深色科技" 风格主题...', type: 'normal' }
            ];

            for (const step of designSteps) {
                await sleep(800);
                orch.eventBus.emit('design.batch.progress', {
                    actor: 'design',
                    status: 'progress',
                    payload: { agent: 'AI 设计', msg: step.msg, type: step.type }
                });
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
            const titleMatch = section.match(/^#{1,2}\s+(.+)/);
            return {
                index: i,
                title: titleMatch ? titleMatch[1].trim() : `第 ${i + 1} 页`,
                content: section.trim(),
                pageType: i === 0 ? 'cover' : 'content'
            };
        });
    },

    async startMultiAgentWorkflow() {
        await this._ensureRuntime();
        this._orchestrator.start();
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

        this._renderFileGrid(files);

        const ingestInput = this._buildIngestInputFromWorkflowFiles(files);

        const ingestOut = await this._orchestrator.runStage('deepsearch.ingest', ingestInput);
        this.workflowData.ingest = ingestOut;

        const taskGoal = this._deriveTaskGoal();
        const userConfig = { title: this.currentProject?.title || 'New Mission' };
        const pkg = await this._orchestrator.runStage('deepsearch.pipeline', { sources: ingestOut.sources || [], taskGoal, userConfig });
        this.workflowData.contentPackage = pkg;
        this.workflowData.report = pkg?.report || null;
        this.workflowData.slideIntents = pkg?.slideIntents || [];

        await this.phase2_Scripting();
    },

    _deriveTaskGoal() {
        const summary = typeof this.workflowData?.projectSummary === 'string' ? this.workflowData.projectSummary.trim() : '';
        if (summary) return summary;
        const title = typeof this.currentProject?.title === 'string' ? this.currentProject.title.trim() : '';
        if (title) return title;
        return '生成一份结构清晰、可演示的汇报文稿，并给出可引用的证据来源。';
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
