const PPTGeneratorWorkflow = {
    async _ensureRuntime({ mode = 'deepsearch', scenario = 'business', constraints = {} } = {}) {
        if (this._orchestrator && this._orchestrator.state === 'running') return;

        const mod = await import('../agents/runtime/orchestrator.js');
        const { AgentOrchestrator } = mod;

        this._orchestrator = new AgentOrchestrator({
            mode,
            scenario,
            constraints
        });

        // Stage order drives todo/agent updates via subscribed events.
        this._runtimeStageUi = {
            'deepsearch.ingest': { todoIndex: 0, agentId: 'reader', state: 'reading', started: 'Analyzing document structure...', ended: 'Metadata Extracted' },
            'deepsearch.questions': { todoIndex: 1, agentId: 'analyst', state: 'questioning', started: 'Formulating strategy questions...', ended: 'Questions Ready' },
            'textprep.slideplan': { todoIndex: 2, agentId: 'analyst', state: 'scripting', started: 'Drafting presentation script...', ended: 'Script Ready' },
            'textprep.align': { todoIndex: 3, agentId: 'designer', state: 'designer', started: 'Segmenting script into slides...', ended: 'Segmentation Complete' },
            'design.batch': { todoIndex: 4, agentId: 'designer', state: 'designer', started: 'Optimizing visual layout...', ended: 'Design Complete' },
            'evaluate.hardgates': { todoIndex: 5, agentId: 'reviewer', state: 'reviewer', started: 'Final compliance check...', ended: 'Approved' }
        };

        this._runtimeTodoTexts = [
            '深度阅读与信息提取',
            '关键需求分析与确认',
            '生成演示大纲与脚本',
            '智能分段与内容映射',
            '视觉设计与排版优化',
            '最终渲染与质量检查'
        ];

        this._attachRuntimeEventHandlers();
        this._registerWorkflowStages();
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
            const agent = payload.agent;
            const msg = payload.msg;
            const type = payload.type || 'normal';
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
        }
    },

    _registerWorkflowStages() {
        const orch = this._orchestrator;
        if (!orch) return;

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        orch.registerStage('deepsearch.ingest', async (_ctx, input, api) => {
            const files = input?.files || [];
            api.progress({ agent: 'AI 阅读', msg: `正在并行扫描 ${files.length} 个资源 (前 3000 字符)...`, type: 'normal' });
            await this._simulateParallelReading(files, 30);
            api.checkCancelled();

            await sleep(800);
            const firstFile = files[0] || { name: 'Document' };
            api.progress({ agent: 'AI 阅读', msg: `提示: "${firstFile.name}" 摘要不完整，正在深入扫描...`, type: 'warning' });

            await sleep(800);
            api.progress({ agent: 'AI 阅读', msg: '扩展扫描范围至 10,000 字符...', type: 'highlight' });
            await this._simulateParallelReading(files, 70);
            api.progress({ agent: 'AI 阅读', msg: '信息确认: 已定位 "预算" 相关章节。上下文置信度: 85%。', type: 'normal' });

            await sleep(800);
            api.progress({ agent: 'AI 阅读', msg: '正在调用搜索助手补充 "竞品分析" 数据...', type: 'highlight' });
            api.progress({ agent: 'AI 搜索', msg: '正在查询内部知识库...', type: 'normal' });
            await sleep(1000);
            api.progress({ agent: 'AI 搜索', msg: '找到 2 份相关报告，正在合并上下文。', type: 'success' });

            await this._simulateParallelReading(files, 100);
        }, { actor: 'deepsearch', timeoutMs: 60_000 });

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
            orch.eventBus.emit('textprep.align.progress', {
                actor: 'textprep',
                status: 'progress',
                payload: { agent: 'AI 设计', msg: '正在分析语义边界...', type: 'normal' }
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
        // Convert FileList to array and mock processing
        const newFiles = Array.from(fileList).map(f => ({ name: f.name, size: this._formatSize(f.size), type: 'file' }));
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

    async startMultiAgentWorkflow() {
        await this._ensureRuntime();
        this._orchestrator.start();
        await this.phase1_DeepReading();
    },

    // --- Phase 1: Reader Agent (Deep Metadata Extraction) ---
    async phase1_DeepReading() {
        const files = (this.workflowData.files && this.workflowData.files.length > 0) ? this.workflowData.files : [
            { name: 'Project_Nebula_Specs.pdf', size: '2.4MB', type: 'file' },
            { name: 'Market_Research_2025.docx', size: '1.1MB', type: 'file' }
        ];
        this._renderFileGrid(files);
        await this._orchestrator.runStage('deepsearch.ingest', { files });
        this.phase2_QuestionGeneration();
    },

    // --- Phase 2: Analyst Agent (Question Generation) ---
    async phase2_QuestionGeneration() {
        const questions = await this._orchestrator.runStage('deepsearch.questions');
        this.workflowData.questions = questions;

        this.addChatMessage('ai', '已完成深度扫描。为了生成更精准的演示文稿，请确认右侧的关键选项。');
        this.renderPreviewArea(); // Will render Question Form
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

    // --- Phase 4: Designer Agent (Segmentation & Mapping) ---
    async phase4_Segmentation() {
        await this._orchestrator.runStage('textprep.align');
        this.phase5_DesignOptimization();
    },

    // --- Phase 5: Designer Agent (Design Optimization) ---
    async phase5_DesignOptimization() {
        await this._orchestrator.runStage('design.batch');
        this.phase6_FinalReview();
    },

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        await this._orchestrator.runStage('evaluate.hardgates');
        this._orchestrator.end();

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
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorWorkflow);
