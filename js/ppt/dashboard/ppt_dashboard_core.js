(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  const FlowConfig = NS.PPTFlowConfig || {};
  const getAliasedState = (state) => (
    typeof FlowConfig.getAliasedState === 'function' ? FlowConfig.getAliasedState(state) : state
  );
  const getStateIndex = (state) => (
    typeof FlowConfig.getStateIndex === 'function' ? FlowConfig.getStateIndex(state) : -1
  );
  const getViewKey = (state) => (
    typeof FlowConfig.getViewKey === 'function' ? FlowConfig.getViewKey(state) : (state || 'deepsearch_premium')
  );

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
        const prevViewKey = prevState ? getViewKey(getAliasedState(prevState)) : null;
        const effectiveState = getAliasedState(this.state);
        const viewKey = getViewKey(effectiveState);

        // Flow vizzes mount React roots; always destroy before we replace UI.
        this._destroyFlowViz?.('deepsearch');
        this._destroyFlowViz?.('design');

        const isResearchStage = effectiveState === 'reading' || effectiveState === 'scanning' || effectiveState === 'researching';
        const uiV2Views = new Set([
            'upload',
            'briefing',
            'deepsearch_premium',
            'deepsearch_review',
            'questioning',
            'script_review',
            'outline_review',
            'page_layout',
            'design_preferences',
            'designer',
            'failed'
        ]);
        const useUiV2 = uiV2Views.has(viewKey) && (viewKey !== 'deepsearch_premium' || isResearchStage);
        if (!useUiV2) {
            this._teardownUiV2?.();
        } else if (this._renderUiV2?.(viewKey, container)) {
            this._prevState = this.state;
            return;
        }

        if (this.state === 'completed') {
            if (prevViewKey === 'script_review' && typeof VditorAdapter !== 'undefined') VditorAdapter.destroy();
            this._prevState = this.state;
            this.renderPresentationMode(container);
            return;
        }

        // Determine what to show in the central visualization area based on state
        let visContent = '';

        if (viewKey === 'upload') {
            if (this._uploadStep !== 1 && this._uploadStep !== 2) this._uploadStep = 1;
            visContent = this._renderUploadView();
        } else if (viewKey === 'briefing') {
            visContent = this._renderProjectBriefForm();
        } else if (viewKey === 'script_review') {
            visContent = this._renderScriptReview();
        } else if (viewKey === 'page_layout') {
            visContent = this._renderPageLayoutReview();
        } else if (viewKey === 'deepsearch_review') {
            visContent = this._renderDeepSearchReview();
        } else if (viewKey === 'questioning') {
            visContent = this._renderQuestionForm();
        } else if (viewKey === 'outline_review') {
            visContent = this._renderOutlineReview();
        } else {
            // Default: DeepSearch Premium UI (researching/designer states)
            visContent = this._renderDeepSearchPremiumUI();
        }

        // Render Simplified Dashboard (No more grid layout)
        container.innerHTML = visContent;

        if (viewKey === 'script_review') {
            this._mountScriptEditor();
        } else if (prevViewKey === 'script_review' && typeof VditorAdapter !== 'undefined') {
            VditorAdapter.destroy();
        }

        if (viewKey === 'page_layout') {
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
        this._updateCompressionPanel?.(this.workflowData?.runtimeCompression);
    },

    _renderUiV2(viewKey, container) {
        const supported = viewKey === 'upload' || viewKey === 'briefing' || viewKey === 'deepsearch_premium'
            || viewKey === 'deepsearch_review' || viewKey === 'questioning'
            || viewKey === 'script_review' || viewKey === 'outline_review'
            || viewKey === 'page_layout' || viewKey === 'design_preferences'
            || viewKey === 'designer' || viewKey === 'failed';
        if (!container || !supported) return false;

        if (this._uiV2Instance) {
            if (!this._uiV2Mounted) {
                this._uiV2Instance.router?.mount?.(container);
                this._uiV2Mounted = true;
            }
            this._syncUiV2State?.(viewKey);
            return true;
        }

        if (this._uiV2Promise) return false;

        this._uiV2Promise = import('../ui-v2/index.js')
            .then((mod) => {
                const starter = mod?.startPptUiV2;
                if (typeof starter !== 'function') {
                    throw new Error('UI V2 starter not found');
                }
                this._uiV2Instance = starter({ container, generator: this });
                this._uiV2Mounted = true;
                this._syncUiV2State?.(viewKey);
            })
            .catch((err) => {
                console.warn('[PPT UI V2] Failed to load:', err);
            })
            .finally(() => {
                this._uiV2Promise = null;
            });

        return false;
    },

    _syncUiV2State(viewKey) {
        const instance = this._uiV2Instance;
        if (!instance || !instance.stateStore) return;

        instance.adapter?.setGenerator?.(this);
        instance.adapter?.syncFromGenerator?.();

        const step = this._uploadStep === 2 ? 2 : 1;
        const nextView = viewKey;
        instance.stateStore.set('ui.uploadStep', step);
        instance.stateStore.set('ui.pendingStart', !!this._pendingStartAfterBrief);
        if (typeof this.state === 'string') instance.stateStore.set('workflow.state', this.state);
        if (nextView) instance.stateStore.set('ui.view', nextView);
    },

    _teardownUiV2() {
        if (!this._uiV2Instance || !this._uiV2Mounted) return;
        try {
            this._uiV2Instance.router?.unmount?.();
        } catch {
            // ignore
        }
        this._uiV2Mounted = false;
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
                                    <button class="ppt-icon-btn" title="咨询 AI 助手" data-action="askAssistantAboutQuestion" data-index="${i}">
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
                    <button class="ppt-btn-secondary" data-action="autoFillAnswers">
                        <iconify-icon icon="carbon:magic-wand"></iconify-icon> AI 自动决策
                    </button>
                    <button class="ppt-btn-primary" data-action="submitAnswers">
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
            <div class="ppt-question-form script-review">
                <div class="form-header">
                    <div class="form-header-left">
                        <h3><iconify-icon icon="carbon:document"></iconify-icon> 研究报告（可编辑）</h3>
                    </div>
                    <div class="form-header-right">
                        <button class="ppt-btn-primary ppt-btn-sm" data-action="confirmScript">
                            打开审阅并确认 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                        </button>
                    </div>
                </div>
                <div class="form-header-hint script-review-hint">
                    <iconify-icon icon="carbon:information"></iconify-icon>
                    <span>请先在「报告审阅」面板中确认后进入页面规划</span>
                </div>
                <div class="form-body custom-scrollbar">
                    <div class="script-editor-toc custom-scrollbar">
                        <div class="toc-header">目录</div>
                        <div id="scriptTocContent"></div>
                    </div>
                    <div class="script-editor-main">
                        <div id="vditorScriptEditor"></div>
                    </div>
                </div>
            </div>
        `;
    },


    async _mountScriptEditor() {
        if (typeof document === 'undefined') return;
        const container = document.getElementById('vditorScriptEditor');
        if (!container) return;

        const md = typeof this.workflowData?.reportMarkdown === 'string' ? this.workflowData.reportMarkdown : (this.workflowData?.report?.markdown || '');

        const tocContainer = document.getElementById('scriptTocContent');
        const escapeHtml = (value) => String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

        const parseHeadings = (markdown) => {
            const lines = String(markdown ?? '').split(/\r?\n/);
            const headings = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
                if (!match) continue;
                const level = match[1].length;
                const text = String(match[2] || '').replace(/\s+#+\s*$/, '').trim();
                if (!text) continue;
                headings.push({ level, text, line: i });
            }
            return headings;
        };

        const renderToc = (markdown) => {
            if (!tocContainer) return [];
            const headings = parseHeadings(markdown);
            tocContainer.innerHTML = headings.map((h, index) => (
                `<div class="toc-item toc-h${h.level}" data-line="${h.line}" data-index="${index}">${escapeHtml(h.text)}</div>`
            )).join('');
            return headings;
        };

        const scrollToTocTarget = ({ index, line }) => {
            const editorRoot = document.getElementById('vditorScriptEditor');
            const vditorInstance = (typeof VditorAdapter !== 'undefined' && VditorAdapter) ? VditorAdapter._instance : null;

            const headingEls = editorRoot?.querySelectorAll?.([
                '.vditor-ir h1', '.vditor-ir h2', '.vditor-ir h3',
                '.vditor-wysiwyg h1', '.vditor-wysiwyg h2', '.vditor-wysiwyg h3',
                '.vditor-preview h1', '.vditor-preview h2', '.vditor-preview h3',
            ].join(','));
            const target = headingEls?.[index];
            if (target?.scrollIntoView) {
                try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { target.scrollIntoView(); }
                vditorInstance?.focus?.();
                return true;
            }

            const textarea = editorRoot?.querySelector?.('textarea');
            if (textarea && typeof textarea.value === 'string') {
                const text = textarea.value;
                let pos = 0;
                let currentLine = 0;
                while (currentLine < line && pos < text.length) {
                    const nextBreak = text.indexOf('\n', pos);
                    if (nextBreak === -1) break;
                    pos = nextBreak + 1;
                    currentLine++;
                }
                try {
                    textarea.focus?.();
                    textarea.setSelectionRange?.(pos, pos);
                } catch {
                    // ignore
                }
                const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
                textarea.scrollTop = Math.max(0, (line - 2)) * lineHeight;
                return true;
            }

            return false;
        };

        let tocTimer = null;
        const scheduleTocRender = (markdown) => {
            if (!tocContainer) return;
            if (tocTimer) clearTimeout(tocTimer);
            tocTimer = setTimeout(() => renderToc(markdown), 120);
        };

        if (tocContainer) {
            tocContainer.onclick = (e) => {
                const item = e.target?.closest?.('.toc-item');
                if (!item) return;
                const index = Number.parseInt(item.getAttribute('data-index') || '0', 10);
                const line = Number.parseInt(item.getAttribute('data-line') || '0', 10);
                scrollToTocTarget({ index, line });
            };
        }

        renderToc(md);

        if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
            VditorAdapter.mount({
                container: 'vditorScriptEditor',
                value: md,
                onInput: (value) => {
                    this.updateReportMarkdown(value);
                    scheduleTocRender(value);
                },
                mode: 'ir'
            });
            scheduleTocRender(VditorAdapter.getValue?.() ?? md);
        } else if (typeof VditorAdapter !== 'undefined') {
            container.innerHTML = VditorAdapter.renderFallbackTextarea({
                value: md,
                onInput: 'window.PPTGenerator.updateReportMarkdown(this.value)'
            });
            const textarea = container.querySelector?.('textarea');
            textarea?.addEventListener?.('input', () => scheduleTocRender(textarea.value));
            scheduleTocRender(md);
        }
    },


    _renderStep(stepState, num, label) {
        // Simple logic to determine active/completed state
        const currentIndex = getStateIndex(this.state);
        const stepIndex = getStateIndex(stepState);

        const isCompleted = currentIndex !== -1 && stepIndex !== -1 && currentIndex > stepIndex;
        let className = 'gen-step';
        if (getAliasedState(this.state) === getAliasedState(stepState)) className += ' active';
        if (isCompleted) className += ' completed';

        return `
            <div class="${className}">
                <div class="gen-step-icon">
                    ${isCompleted ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num}
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

  const getQuestionActions = (ctx) => ({
    askAssistantAboutQuestion: ({ payload }) => ctx.askAssistantAboutQuestion?.(payload.index),
    autoFillAnswers: () => ctx.autoFillAnswers?.(),
    submitAnswers: () => ctx.submitAnswers?.(),
  });

  const getScriptReviewActions = (ctx) => ({
    confirmScript: () => ctx.confirmScript?.(),
  });

  if (window.PPTFlowViews?.register) {
    window.PPTFlowViews.register('questioning', {
      render: (ctx) => ctx._renderQuestionForm?.(),
      actions: getQuestionActions,
    });
    window.PPTFlowViews.register('script_review', {
      render: (ctx) => ctx._renderScriptReview?.(),
      actions: getScriptReviewActions,
    });
  }

  NS.PPTGeneratorAgentDashboard = PPTGeneratorAgentDashboard;

  try {
    const ctor =
      (typeof globalThis !== 'undefined' && globalThis.PPTGeneratorCtor?.prototype)
        ? globalThis.PPTGeneratorCtor
        : ((typeof PPTGenerator !== 'undefined' && PPTGenerator?.prototype) ? PPTGenerator : null);
    if (ctor?.prototype) Object.assign(ctor.prototype, PPTGeneratorAgentDashboard);
  } catch {
    // ignore (PPTGenerator may not be defined yet)
  }
})();
