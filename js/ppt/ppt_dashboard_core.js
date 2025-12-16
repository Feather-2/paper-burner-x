(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;

  const PPTGeneratorAgentDashboard = {};
  Object.assign(PPTGeneratorAgentDashboard,
    NS.utils || {},
    NS.upload || {},
    NS.history || {},
    NS.urlInput || {},
    NS.paste || {},
    NS.modals || {},
    NS.deepsearch || {},
    NS.pageLayout || {},
    NS.designSpec || {},
    NS.outline || {},
    {
    renderPreviewArea() {
        const container = document.getElementById('pptPreviewArea');
        if (!container) return;

        // Ensure report review UI is mounted (fixed button + floating panel).
        try {
            const panel = this._ensureReportReviewPanel?.();
            const host = this.elements?.overlay || document.getElementById('pptGeneratorOverlay') || document.body;
            panel?.mount?.(host);
        } catch {
            // ignore
        }

        this._syncWorkflowModeAndBriefFromData();
        const prevState = this._prevState;

        // Flow vizzes mount React roots; always destroy before we replace innerHTML.
        this._destroyFlowViz?.('deepsearch');
        this._destroyFlowViz?.('design');

        if (this.state === 'completed') {
            if (prevState === 'script_review' && typeof VditorAdapter !== 'undefined') VditorAdapter.destroy();
            this._prevState = this.state;
            this.renderPresentationMode(container);
            return;
        }

        // Determine what to show in the central visualization area based on state
        let visContent = '';

        if (this.state === 'idle') {
            if (this._uploadStep !== 1 && this._uploadStep !== 2) this._uploadStep = 1;
            visContent = this._renderUploadView();
        } else if (this.state === 'briefing') {
            visContent = this._renderProjectBriefForm();
        } else if (this.state === 'script_review') {
            visContent = this._renderScriptReview();
        } else if (this.state === 'page_layout') {
            visContent = this._renderPageLayoutReview();
        } else if (this.state === 'deepsearch_review') {
            visContent = this._renderDeepSearchReview();
        } else if (this.state === 'questioning') {
            visContent = this._renderQuestionForm();
        } else if (this.state === 'outline_review') {
            visContent = this._renderOutlineReview();
        } else {
            // Default: DeepSearch Premium UI (researching/designer states)
            visContent = this._renderDeepSearchPremiumUI();
        }

        // Render Simplified Dashboard (No more grid layout)
        container.innerHTML = visContent;

        if (this.state === 'script_review') {
            this._mountScriptEditor();
        } else if (prevState === 'script_review' && typeof VditorAdapter !== 'undefined') {
            VditorAdapter.destroy();
        }

        if (this.state === 'page_layout') {
            try { this._setupSlideIntentDrag?.(); } catch (e) { /* ignore */ }
        }
        this._prevState = this.state;

        // Restore logs if terminal exists
        const term = document.getElementById('agentTerminal');
        if (term) {
            this.processLogs.forEach(log => this._appendLogToTerminal(log));
        }

        // Mount premium flow visualizers (async).
        this._mountActiveFlowVisualizers?.();
    },


    _syncWorkflowModeAndBriefFromData() {
        const allowed = new Set(['auto', 'guided', 'manual']);
        const dataMode = typeof this.workflowData?.workflowMode === 'string' ? this.workflowData.workflowMode : '';
        const nextMode = allowed.has(dataMode) ? dataMode : (allowed.has(this.workflowMode) ? this.workflowMode : 'auto');
        if (!allowed.has(this.workflowMode)) this.workflowMode = nextMode;
        if (allowed.has(nextMode) && this.workflowMode !== nextMode) this.workflowMode = nextMode;

        const dataBrief = this.workflowData?.projectBrief && typeof this.workflowData.projectBrief === 'object' ? this.workflowData.projectBrief : null;
        if (dataBrief && (!this.projectBrief || typeof this.projectBrief !== 'object')) {
            this.projectBrief = { taskGoal: '', projectSummary: '', audience: '', tone: '' };
        }
        if (dataBrief) {
            this.projectBrief = {
                taskGoal: typeof dataBrief.taskGoal === 'string' ? dataBrief.taskGoal : (this.projectBrief?.taskGoal || ''),
                projectSummary: typeof dataBrief.projectSummary === 'string' ? dataBrief.projectSummary : (this.projectBrief?.projectSummary || ''),
                audience: typeof dataBrief.audience === 'string' ? dataBrief.audience : (this.projectBrief?.audience || ''),
                tone: typeof dataBrief.tone === 'string' ? dataBrief.tone : (this.projectBrief?.tone || ''),
            };
        }
    },


    _renderQuestionForm() {
        const questions = this.workflowData.questions || [];
        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:user-speaker"></iconify-icon> 需求确认</h3>
                    <p>AI 已分析文档，请确认以下关键策略以定制演示文稿：</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${questions.map((q, i) => `
                        <div class="form-group">
                            <label>${i + 1}. ${q.text}</label>
                            <div class="form-options-wrapper">
                                <div class="form-radio-group">
                                    ${q.options.map(opt => `
                                        <label class="radio-option">
                                            <input type="radio" name="q_${i}" value="${opt}" ${opt === q.default ? 'checked' : ''}>
                                            <div class="radio-content">
                                                <span class="radio-label">${opt}</span>
                                                <iconify-icon icon="carbon:checkmark-filled" class="radio-check-icon"></iconify-icon>
                                            </div>
                                        </label>
                                    `).join('')}
                                </div>
                                <div class="form-custom-input-wrapper">
                                    <input type="text" class="ppt-input-field" placeholder="或输入自定义回答..." name="q_${i}_custom">
                                    <button class="ppt-icon-btn" title="咨询 AI 助手" onclick="window.PPTGenerator.askAssistantAboutQuestion(${i})">
                                        <iconify-icon icon="carbon:chat-bot"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="form-footer">
                    <div style="flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ppt-text-secondary);">
                        <iconify-icon icon="carbon:information"></iconify-icon>
                        <span>您也可以在右侧聊天栏直接提出修改意见</span>
                    </div>
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.autoFillAnswers()">
                        <iconify-icon icon="carbon:magic-wand"></iconify-icon> AI 自动决策
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.submitAnswers()">
                        确认并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },


    askAssistantAboutQuestion(index) {
        const question = this.workflowData.questions[index];
        this.addChatMessage('ai', `关于问题 **"${question.text}"**，根据文档分析，我建议选择 **"${question.default}"**，因为文档主要侧重于...`);
    },


    _renderScriptReview() {
        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:document"></iconify-icon> 研究报告（可编辑）</h3>
                    <p>这是 DeepSearch 生成的研究报告脚本，您可以直接编辑后进入页面规划。</p>
                </div>
                <div class="form-body custom-scrollbar">
                    <div id="vditorScriptEditor"></div>
                </div>
                <div class="form-footer">
                    <div style="flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ppt-text-secondary);">
                        <iconify-icon icon="carbon:information"></iconify-icon>
                        <span>请先在「报告审阅」面板中确认后进入页面规划</span>
                    </div>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmScript()">
                        打开审阅并确认 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },


    async _mountScriptEditor() {
        const container = document.getElementById('vditorScriptEditor');
        if (!container) return;

        const md = typeof this.workflowData?.reportMarkdown === 'string' ? this.workflowData.reportMarkdown : (this.workflowData?.report?.markdown || '');

        if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
            VditorAdapter.mount({
                container: 'vditorScriptEditor',
                value: md,
                onInput: (value) => this.updateReportMarkdown(value),
                mode: 'ir'
            });
        } else if (typeof VditorAdapter !== 'undefined') {
            container.innerHTML = VditorAdapter.renderFallbackTextarea({
                value: md,
                onInput: 'window.PPTGenerator.updateReportMarkdown(this.value)'
            });
        }
    },


    _renderStep(stepState, num, label) {
        // Simple logic to determine active/completed state
        const states = ['idle', 'reading', 'researching', 'script_review', 'page_layout', 'designer', 'reviewer', 'completed', 'failed'];
        const currentIndex = states.indexOf(this.state);
        const stepIndex = states.indexOf(stepState);

        let className = 'gen-step';
        if (this.state === stepState) className += ' active';
        if (currentIndex > stepIndex) className += ' completed';

        return `
            <div class="${className}">
                <div class="gen-step-icon">
                    ${currentIndex > stepIndex ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num}
                </div>
                <span class="gen-step-label">${label}</span>
            </div>
        `;
    },


    _getCurrentStatusIcon() {
        if (this.state === 'reading') return 'carbon:document-view';
        if (this.state === 'researching') return 'carbon:search';
        if (this.state === 'script_review') return 'carbon:document';
        if (this.state === 'page_layout') return 'carbon:layout';
        if (this.state === 'scripting') return 'carbon:edit';
        if (this.state === 'designer') return 'carbon:paint-brush';
        if (this.state === 'failed') return 'carbon:warning';
        return 'carbon:bot';
    },


    _getCurrentStatusTitle() {
        if (this.state === 'reading') return '正在深度阅读文档...';
        if (this.state === 'researching') return '正在进行研究分析...';
        if (this.state === 'script_review') return '脚本审阅与编辑';
        if (this.state === 'page_layout') return '正在规划页面结构...';
        if (this.state === 'outline_review') return '大纲确认';
        if (this.state === 'scripting') return '正在构建演示大纲...';
        if (this.state === 'designer') return '正在进行视觉设计...';
        if (this.state === 'failed') return '流程已中止';
        return '准备就绪';
    },


    _getCurrentStatusDesc() {
        if (this.state === 'reading') return 'AI 正在分析文档结构并提取关键信息';
        if (this.state === 'researching') return 'AI 正在扫描资料、识别知识空白并生成研究报告';
        if (this.state === 'script_review') return '请确认研究报告脚本，必要时可直接编辑';
        if (this.state === 'page_layout') return '正在将内容结构映射到幻灯片布局意图';
        if (this.state === 'outline_review') return 'AI 已根据您的需求生成演示大纲，请确认或调整';
        if (this.state === 'scripting') return '正在梳理逻辑结构并撰写演讲备注';
        if (this.state === 'designer') return '正在匹配最佳模板并生成页面布局';
        if (this.state === 'failed') return '发生错误，请调整输入后重试';
        return '请上传文档或输入主题开始';
    }
    }
  );

  NS.PPTGeneratorAgentDashboard = PPTGeneratorAgentDashboard;

  try {
    Object.assign(PPTGenerator.prototype, PPTGeneratorAgentDashboard);
  } catch {
    // ignore (PPTGenerator may not be defined yet)
  }
})();
