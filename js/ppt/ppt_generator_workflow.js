const PPTGeneratorWorkflow = {
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
        this.state = 'reading';
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'active' },
            { text: '关键需求分析与确认', status: 'pending' },
            { text: '生成演示大纲与脚本', status: 'pending' },
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);
        this.renderPreviewArea();

        await this.phase1_DeepReading();
    },

    // --- Phase 1: Reader Agent (Deep Metadata Extraction) ---
    async phase1_DeepReading() {
        this._setAgentStatus('reader', 'active', 'Analyzing document structure...');

        const files = (this.workflowData.files && this.workflowData.files.length > 0) ? this.workflowData.files : [
            { name: 'Project_Nebula_Specs.pdf', size: '2.4MB', type: 'file' },
            { name: 'Market_Research_2025.docx', size: '1.1MB', type: 'file' }
        ];
        this._renderFileGrid(files);

        // Step 1.1: Initial 3000 chars scan
        await this.logTerminal('AI 阅读', `正在并行扫描 ${files.length} 个资源 (前 3000 字符)...`, 'normal');
        await this._simulateParallelReading(files, 30); // 30% progress

        // Simulate finding incomplete info
        await new Promise(r => setTimeout(r, 800));
        const firstFile = files[0] || { name: 'Document' };
        await this.logTerminal('AI 阅读', `提示: "${firstFile.name}" 摘要不完整，正在深入扫描...`, 'warning');

        // Step 1.2: Extended 10000 chars scan
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('AI 阅读', '扩展扫描范围至 10,000 字符...', 'highlight');
        await this._simulateParallelReading(files, 70); // 70% progress
        await this.logTerminal('AI 阅读', '信息确认: 已定位 "预算" 相关章节。上下文置信度: 85%。', 'normal');

        // Step 1.3: Search Agent fallback (Simulated)
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('AI 阅读', '正在调用搜索助手补充 "竞品分析" 数据...', 'highlight');
        await this.logTerminal('AI 搜索', '正在查询内部知识库...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 搜索', '找到 2 份相关报告，正在合并上下文。', 'success');

        // Finish Phase 1
        this._renderFileGrid(files, 100); // 100% progress
        this._setAgentStatus('reader', 'idle', 'Metadata Extracted');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'active' },
            { text: '生成演示大纲与脚本', status: 'pending' },
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase2_QuestionGeneration();
    },

    // --- Phase 2: Analyst Agent (Question Generation) ---
    async phase2_QuestionGeneration() {
        this.state = 'questioning';
        this._setAgentStatus('analyst', 'active', 'Formulating strategy questions...');

        await this.logTerminal('AI 分析', '正在分析内容密度...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 分析', '识别出 3 个关键决策点，需要用户确认。', 'success');

        // Mock Questions
        this.workflowData.questions = [
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

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'active' }, // Still active as outline is part of this
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);
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
        this._setAgentStatus('analyst', 'active', 'Drafting presentation script...');

        await this.logTerminal('AI 分析', '正在处理用户反馈...', 'normal');
        await this.logTerminal('AI 分析', '构建叙事结构: 问题 -> 解决方案 -> 价值影响', 'highlight');

        // Simulate batch processing of script generation
        const sections = ['引言', '市场痛点', '解决方案', '技术架构', '未来规划'];
        for (const sec of sections) {
            await new Promise(r => setTimeout(r, 600));
            await this.logTerminal('AI 分析', `正在撰写章节: ${sec}...`, 'normal');
        }

        await this.logTerminal('AI 分析', '演讲稿脚本生成完成。共 2500 字。', 'success');
        this._setAgentStatus('analyst', 'idle', 'Script Ready');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'active' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase4_Segmentation();
    },

    // --- Phase 4: Designer Agent (Segmentation & Mapping) ---
    async phase4_Segmentation() {
        this._setAgentStatus('designer', 'active', 'Segmenting script into slides...');

        await this.logTerminal('AI 设计', '正在分析语义边界...', 'normal');
        await this.logTerminal('AI 设计', '正在建立内容溯源映射...', 'highlight');

        // Simulate segmentation
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 设计', '已生成 12 个幻灯片分段。', 'success');

        // Mock Source Mapping
        const sourceFiles = this.workflowData.files.length > 0 ? this.workflowData.files : [{name: 'Project_Nebula_Specs.pdf'}];
        await this.logTerminal('AI 设计', `分段 3 已关联至 "${sourceFiles[0].name}" (p.14)`, 'normal');
        if (sourceFiles.length > 1) {
            await this.logTerminal('AI 设计', `分段 7 已关联至 "${sourceFiles[1].name}" (line 45)`, 'normal');
        }

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'active' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase5_DesignOptimization();
    },

    // --- Phase 5: Designer Agent (Design Optimization) ---
    async phase5_DesignOptimization() {
        this._setAgentStatus('designer', 'active', 'Optimizing visual layout...');

        // Simulate batch design decision making (JSON output)
        const designSteps = [
            { msg: '正在评估幻灯片 1-12 的文本密度...', type: 'normal' },
            { msg: '决策: 幻灯片 4 需要柱状图 (检测到数据)。', type: 'highlight' },
            { msg: '决策: 幻灯片 2 需要首图 (概念性内容)。', type: 'highlight' },
            { msg: '决策: 幻灯片 8 使用分栏布局 (检测到对比内容)。', type: 'highlight' },
            { msg: '正在应用 "深色科技" 风格主题...', type: 'normal' }
        ];

        for (const step of designSteps) {
            await new Promise(r => setTimeout(r, 800));
            await this.logTerminal('AI 设计', step.msg, step.type);
        }

        this._setAgentStatus('designer', 'idle', 'Design Complete');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'completed' },
            { text: '最终渲染与质量检查', status: 'active' }
        ]);

        this.phase6_FinalReview();
    },

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        this._setAgentStatus('reviewer', 'active', 'Final compliance check...');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 审查', '所有约束条件已满足。', 'success');
        this._setAgentStatus('reviewer', 'idle', 'Approved');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'completed' },
            { text: '最终渲染与质量检查', status: 'completed' }
        ]);

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
