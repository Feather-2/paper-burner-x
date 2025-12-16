const PPTGeneratorAgentDashboard = {
    // ============================================================
    // Agent Dashboard Rendering
    // ============================================================

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

    _goToUploadStep(step) {
        const nextStep = step === 2 ? 2 : 1;
        const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
        if (nextStep === 2 && files.length === 0) return;
        this._uploadStep = nextStep;
        this.renderPreviewArea();
    },

    _renderUploadSharedStyles() {
        return `
            <style>
                /* Two-column Layout */
                .rd-layout {
                    display: flex;
                    gap: 24px;
                    padding: 20px;
                    max-width: 1000px;
                    margin: 0 auto;
                    min-height: 480px;
                }
                .rd-sidebar {
                    width: 260px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                }
                .rd-sidebar-card {
                    background: rgba(255, 255, 255, 0.75);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.6);
                    border-radius: 16px;
                    padding: 20px;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }
                .rd-sidebar-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--ppt-text-main);
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .rd-sidebar-title iconify-icon {
                    font-size: 18px;
                    color: var(--ppt-primary);
                }
                .rd-sidebar-list {
                    flex: 1;
                    overflow-y: auto;
                    margin: 0 -8px;
                    padding: 0 8px;
                }
                .rd-sidebar-empty {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: var(--ppt-text-muted);
                    font-size: 13px;
                    text-align: center;
                    padding: 20px;
                }
                .rd-sidebar-empty iconify-icon {
                    font-size: 40px;
                    opacity: 0.4;
                    margin-bottom: 12px;
                }
                .rd-sidebar-count {
                    font-size: 12px;
                    color: var(--ppt-text-secondary);
                    margin-top: auto;
                    padding-top: 12px;
                    border-top: 1px solid var(--ppt-border);
                }
                .rd-main {
                    flex: 1;
                    min-width: 0;
                }
                /* Redesigned Card Container (rd-card) */
                .rd-card {
                    background: rgba(255, 255, 255, 0.82);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.6);
                    border-radius: 20px;
                    box-shadow:
                        0 4px 6px -1px rgba(0, 0, 0, 0.05),
                        0 10px 15px -3px rgba(0, 0, 0, 0.05),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
                    padding: 32px;
                    width: 100%;
                    position: relative;
                }
                .rd-header {
                    text-align: center;
                    margin-bottom: 24px;
                }
                .rd-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: var(--ppt-text-main);
                    margin: 0 0 6px;
                    letter-spacing: -0.02em;
                }
                .rd-subtitle {
                    font-size: 14px;
                    color: var(--ppt-text-secondary);
                    margin: 0;
                }
                /* Source Buttons Grid */
                .rd-upload-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                    margin-bottom: 20px;
                }
                .rd-source-btn {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px 16px;
                    background: white;
                    border: 1px solid var(--ppt-border);
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                    text-align: left;
                }
                .rd-source-btn:hover {
                    border-color: var(--ppt-primary);
                    box-shadow: var(--ppt-shadow-md);
                    transform: translateY(-2px);
                }
                .rd-source-icon {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    background: var(--ppt-bg-subtle);
                    color: var(--ppt-primary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    transition: all 0.2s;
                    flex-shrink: 0;
                }
                .rd-source-btn:hover .rd-source-icon {
                    background: var(--ppt-primary);
                    color: white;
                }
                .rd-source-info h3 {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--ppt-text-main);
                    margin: 0 0 2px 0;
                }
                .rd-source-info p {
                    font-size: 12px;
                    color: var(--ppt-text-secondary);
                    margin: 0;
                }
                /* Dropzone */
                .rd-dropzone {
                    border: 2px dashed var(--ppt-border);
                    border-radius: 14px;
                    background: rgba(255, 255, 255, 0.5);
                    padding: 28px 20px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-bottom: 20px;
                    position: relative;
                }
                .rd-dropzone:hover {
                    border-color: var(--ppt-primary);
                    background: var(--ppt-primary-subtle, rgba(79, 70, 229, 0.05));
                }
                .rd-dropzone-icon {
                    font-size: 48px;
                    color: var(--ppt-primary);
                    opacity: 0.8;
                    margin-bottom: 12px;
                }
                .rd-dropzone-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: var(--ppt-text-main);
                    margin-bottom: 6px;
                }
                .rd-dropzone-hint {
                    font-size: 13px;
                    color: var(--ppt-text-muted);
                }
                /* Mode Cards */
                .rd-mode-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 12px;
                    margin-bottom: 24px;
                }
                .rd-mode-card {
                    background: white;
                    border: 2px solid transparent;
                    border-radius: 12px;
                    padding: 16px;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.2s;
                    box-shadow: var(--ppt-shadow-sm);
                }
                .rd-mode-card:hover {
                    transform: translateY(-2px);
                    box-shadow: var(--ppt-shadow-md);
                }
                .rd-mode-card.active {
                    border-color: var(--ppt-primary);
                    background: #f5f3ff;
                }
                .rd-mode-icon {
                    font-size: 28px;
                    color: var(--ppt-text-muted);
                    margin-bottom: 8px;
                }
                .rd-mode-card.active .rd-mode-icon {
                    color: var(--ppt-primary);
                }
                .rd-mode-title {
                    font-weight: 700;
                    font-size: 14px;
                    color: var(--ppt-text-main);
                    margin-bottom: 4px;
                }
                .rd-mode-desc {
                    font-size: 11px;
                    color: var(--ppt-text-secondary);
                    line-height: 1.4;
                }
                /* Section Title */
                .rd-section-title {
                    font-size: 13px;
                    font-weight: 700;
                    color: var(--ppt-text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 12px;
                    padding-left: 4px;
                }
                /* Form Elements */
                .rd-form-panel {
                    background: white;
                    border: 1px solid var(--ppt-border);
                    border-radius: 12px;
                    padding: 16px;
                }
                .rd-form-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 4px 0;
                    margin-bottom: 8px;
                }
                .rd-form-row:last-child {
                    margin-bottom: 0;
                }
                .rd-form-label {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--ppt-text-main);
                }
                .rd-select {
                    padding: 6px 28px 6px 10px;
                    border-radius: 6px;
                    border: 1px solid var(--ppt-border);
                    font-size: 13px;
                    color: var(--ppt-text-main);
                    background-color: white;
                    cursor: pointer;
                    outline: none;
                    appearance: none;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
                    background-repeat: no-repeat;
                    background-position: right 6px center;
                    min-width: 160px;
                }
                .rd-select:focus {
                    border-color: var(--ppt-primary);
                    box-shadow: 0 0 0 2px var(--ppt-primary-light, rgba(79, 70, 229, 0.15));
                }
                /* Footer Actions */
                .rd-footer {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 12px;
                    margin-top: 28px;
                    padding-top: 20px;
                    border-top: 1px solid var(--ppt-border);
                }
                .rd-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 10px 20px;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    border: none;
                }
                .rd-btn-primary {
                    background: linear-gradient(135deg, var(--ppt-primary) 0%, var(--ppt-primary-hover, #6366f1) 100%);
                    color: white;
                    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
                }
                .rd-btn-primary:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(79, 70, 229, 0.35);
                }
                .rd-btn-primary:disabled {
                    opacity: 0.55;
                    cursor: not-allowed;
                    transform: none;
                }
                .rd-btn-ghost {
                    background: transparent;
                    color: var(--ppt-text-secondary);
                }
                .rd-btn-ghost:hover {
                    background: var(--ppt-bg-subtle);
                    color: var(--ppt-text-main);
                }
                /* Sidebar File Item */
                .rd-file-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    background: white;
                    border-radius: 8px;
                    margin-bottom: 8px;
                    border: 1px solid var(--ppt-border);
                }
                .rd-file-item:last-child {
                    margin-bottom: 0;
                }
                .rd-file-icon {
                    font-size: 18px;
                    color: var(--ppt-primary);
                    flex-shrink: 0;
                }
                .rd-file-info {
                    flex: 1;
                    min-width: 0;
                }
                .rd-file-name {
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--ppt-text-main);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .rd-file-meta {
                    font-size: 11px;
                    color: var(--ppt-text-secondary);
                }
                .rd-file-remove {
                    font-size: 16px;
                    color: var(--ppt-text-muted);
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 4px;
                    transition: all 0.15s;
                    flex-shrink: 0;
                }
                .rd-file-remove:hover {
                    color: #ef4444;
                    background: rgba(239, 68, 68, 0.1);
                }
                /* Brief Info */
                .rd-brief-info {
                    background: var(--ppt-bg-subtle);
                    border-radius: 10px;
                    padding: 14px;
                    margin-top: 20px;
                }
                .rd-brief-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--ppt-text-main);
                }
                .rd-brief-title iconify-icon {
                    color: var(--ppt-primary);
                }
                .rd-brief-summary {
                    margin-top: 6px;
                    font-size: 12px;
                    color: var(--ppt-text-secondary);
                    line-height: 1.5;
                }
            </style>
        `;
    },

    _renderUploadView() {
        const step = this._uploadStep || 1;
        if (step === 1) return this._renderUploadStep1();
        return this._renderUploadStep2();
    },

    _renderFileSidebar() {
        const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
        const hasFiles = files.length > 0;

        return `
            <div class="rd-sidebar">
                <div class="rd-sidebar-card">
                    <div class="rd-sidebar-title">
                        <iconify-icon icon="solar:folder-with-files-bold-duotone"></iconify-icon>
                        已添加资源
                    </div>
                    ${hasFiles ? `
                        <div class="rd-sidebar-list">
                            ${files.map((f, i) => `
                                <div class="rd-file-item">
                                    <iconify-icon icon="${f.type === 'history' ? 'solar:history-bold-duotone' : f.type === 'url' ? 'solar:link-circle-bold-duotone' : 'solar:document-bold-duotone'}" class="rd-file-icon"></iconify-icon>
                                    <div class="rd-file-info">
                                        <div class="rd-file-name" title="${this._escapeAttr(String(f?.name ?? ''))}">${this._escapeHtml(String(f?.name ?? ''))}</div>
                                        <div class="rd-file-meta">${this._escapeHtml(String(f?.size ?? ''))}</div>
                                    </div>
                                    <iconify-icon icon="solar:close-circle-linear" class="rd-file-remove" onclick="window.PPTGenerator.removeFile(${i})"></iconify-icon>
                                </div>
                            `).join('')}
                        </div>
                        <div class="rd-sidebar-count">${files.length} 个资源</div>
                    ` : `
                        <div class="rd-sidebar-empty">
                            <iconify-icon icon="solar:inbox-line-bold-duotone"></iconify-icon>
                            <div>暂无资源</div>
                            <div style="margin-top: 4px;">请上传文档或导入链接</div>
                        </div>
                    `}
                </div>
            </div>
        `;
    },

    _renderUploadStep1() {
        const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
        const hasFiles = files.length > 0;

        return `
            ${this._renderUploadSharedStyles()}
            <div class="rd-layout">
                ${this._renderFileSidebar()}
                <div class="rd-main">
                    <div class="rd-card">
                        <div class="rd-header">
                            <h2 class="rd-title">开始新的研究</h2>
                            <p class="rd-subtitle">上传文档或导入链接，AI 将为您生成深度报告</p>
                        </div>

                        <div class="rd-dropzone" onclick="document.getElementById('pptFileInput').click()">
                            <iconify-icon icon="solar:cloud-upload-bold-duotone" class="rd-dropzone-icon"></iconify-icon>
                            <div class="rd-dropzone-title">点击或拖拽文件至此处</div>
                            <div class="rd-dropzone-hint">支持 PDF, DOCX, MD, TXT (最大 50MB)</div>
                            <input type="file" id="pptFileInput" style="display:none;" multiple onchange="window.PPTGenerator.handleFileUpload(this.files)">
                        </div>

                        <div class="rd-upload-grid">
                            <button class="rd-source-btn" type="button" onclick="window.PPTGenerator.openHistorySelector()">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="solar:history-bold-duotone"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>历史项目</h3>
                                    <p>从过往项目提取</p>
                                </div>
                            </button>
                            <button class="rd-source-btn" type="button" onclick="window.PPTGenerator.openUrlInput()">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="solar:link-circle-bold-duotone"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>网页链接</h3>
                                    <p>解析 URL 内容</p>
                                </div>
                            </button>
                            <button class="rd-source-btn" type="button" onclick="window.PPTGenerator.openPasteDocumentModal()">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="solar:clipboard-text-bold-duotone"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>粘贴文本</h3>
                                    <p>直接输入内容</p>
                                </div>
                            </button>
                            <button class="rd-source-btn" type="button" onclick="window.PPTGenerator.importPptxAsDeckFromPicker && window.PPTGenerator.importPptxAsDeckFromPicker()">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="solar:file-text-bold-duotone"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>导入模板</h3>
                                    <p>使用现有 PPTX</p>
                                </div>
                            </button>
                        </div>

                        <div class="rd-footer">
                            <button class="rd-btn rd-btn-primary" ${hasFiles ? 'onclick="window.PPTGenerator._goToUploadStep(2)"' : 'disabled'}>
                                下一步：配置选项 <iconify-icon icon="solar:arrow-right-linear"></iconify-icon>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    _renderUploadStep2() {
        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        const brief = this.workflowData?.projectBrief || this.projectBrief || {};
        const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal.trim() : '';
        const summary = typeof brief.projectSummary === 'string' ? brief.projectSummary.trim() : '';

        const reportCfg = this.workflowData?.reportConfig && typeof this.workflowData.reportConfig === 'object'
            ? this.workflowData.reportConfig
            : {};
        const reportLength = typeof reportCfg.reportLength === 'string' ? reportCfg.reportLength : 'standard';
        const tone = typeof reportCfg.tone === 'string' ? reportCfg.tone : 'business';
        const audience = typeof reportCfg.audience === 'string' ? reportCfg.audience : 'general';
        const language = reportCfg.language || 'auto';
        const enableReviewer = !!reportCfg.enableReviewer;

        const modeCard = (key, title, desc, icon) => {
            const selected = mode === key;
            return `
                <div class="rd-mode-card ${selected ? 'active' : ''}" onclick="window.PPTGenerator.setWorkflowMode && window.PPTGenerator.setWorkflowMode('${key}')">
                    <div class="rd-mode-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
                    <div class="rd-mode-title">${title}</div>
                    <div class="rd-mode-desc">${desc}</div>
                </div>
            `;
        };

        const startOnClick = taskGoal
            ? 'window.PPTGenerator.startMultiAgentWorkflow()'
            : '(window.PPTGenerator.openProjectBriefForm && window.PPTGenerator.openProjectBriefForm())';

        return `
            ${this._renderUploadSharedStyles()}
            <div class="rd-layout">
                ${this._renderFileSidebar()}
                <div class="rd-main">
                    <div class="rd-card">
                        <div class="rd-header">
                            <h2 class="rd-title">生成配置</h2>
                            <p class="rd-subtitle">选择工作模式并调整报告参数</p>
                        </div>

                        <div class="rd-section-title">工作模式</div>
                        <div class="rd-mode-grid">
                            ${modeCard('auto', 'Auto-pilot', '全自动执行', 'solar:rocket-2-bold-duotone')}
                            ${modeCard('guided', 'Guided', '关键节点确认', 'solar:map-point-wave-bold-duotone')}
                            ${modeCard('manual', 'Manual', '每步确认', 'solar:slider-minimalistic-horizontal-bold-duotone')}
                        </div>

                        <div class="rd-section-title" style="margin-top: 24px;">报告参数</div>
                        <div class="rd-form-panel">
                            <div class="rd-form-row">
                                <label class="rd-form-label">报告长度</label>
                                <select class="rd-select" onchange="window.PPTGenerator.updateReportLength(this.value)">
                                    <option value="brief" ${reportLength === 'brief' ? 'selected' : ''}>简要 (800-2000字)</option>
                                    <option value="standard" ${reportLength === 'standard' ? 'selected' : ''}>标准 (2000-5000字)</option>
                                    <option value="detailed" ${reportLength === 'detailed' ? 'selected' : ''}>详细 (5000-10000字)</option>
                                    <option value="comprehensive" ${reportLength === 'comprehensive' ? 'selected' : ''}>全面 (10000-20000字)</option>
                                </select>
                            </div>
                            <div class="rd-form-row">
                                <label class="rd-form-label">写作风格</label>
                                <select class="rd-select" onchange="window.PPTGenerator.updateWriteTone(this.value)">
                                    <option value="business" ${tone === 'business' ? 'selected' : ''}>商务专业</option>
                                    <option value="academic" ${tone === 'academic' ? 'selected' : ''}>学术严谨</option>
                                    <option value="casual" ${tone === 'casual' ? 'selected' : ''}>通俗易懂</option>
                                </select>
                            </div>
                            <div class="rd-form-row">
                                <label class="rd-form-label">目标受众</label>
                                <select class="rd-select" onchange="window.PPTGenerator.updateWriteAudience(this.value)">
                                    <option value="general" ${audience === 'general' ? 'selected' : ''}>一般读者</option>
                                    <option value="expert" ${audience === 'expert' ? 'selected' : ''}>专业人士</option>
                                    <option value="executive" ${audience === 'executive' ? 'selected' : ''}>高管决策层</option>
                                </select>
                            </div>
                            <div class="rd-form-row">
                                <label class="rd-form-label">输出语言</label>
                                <select class="rd-select" onchange="window.PPTGenerator.updateWriteLanguage(this.value)">
                                    <option value="auto" ${language === 'auto' ? 'selected' : ''}>自动检测</option>
                                    <option value="zh" ${language === 'zh' ? 'selected' : ''}>简体中文</option>
                                    <option value="en" ${language === 'en' ? 'selected' : ''}>English</option>
                                </select>
                            </div>
                        </div>

                        ${taskGoal || summary ? `
                            <div class="rd-brief-info">
                                <div class="rd-brief-title">
                                    <iconify-icon icon="solar:info-circle-bold-duotone"></iconify-icon>
                                    <span>当前需求：${taskGoal ? this._escapeHtml(taskGoal) : '未填写'}</span>
                                </div>
                                ${summary ? `<div class="rd-brief-summary">${this._escapeHtml(summary)}</div>` : ''}
                            </div>
                        ` : ''}

                        <div class="rd-footer">
                            <button class="rd-btn rd-btn-ghost" onclick="window.PPTGenerator._goToUploadStep(1)">
                                <iconify-icon icon="solar:arrow-left-linear"></iconify-icon> 返回
                            </button>
                            <button class="rd-btn rd-btn-ghost" onclick="window.PPTGenerator.openProjectBriefForm && window.PPTGenerator.openProjectBriefForm()">
                                <iconify-icon icon="solar:pen-2-linear"></iconify-icon> 编辑需求
                            </button>
                            <button class="rd-btn rd-btn-primary" onclick="${startOnClick}">
                                <iconify-icon icon="solar:rocket-bold-duotone"></iconify-icon> ${taskGoal ? '开始分析' : '填写需求'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    _renderProjectBriefForm() {
        const brief = this.workflowData?.projectBrief || this.projectBrief || {};
        const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal : '';
        const projectSummary = typeof brief.projectSummary === 'string' ? brief.projectSummary : '';
        const audience = typeof brief.audience === 'string' ? brief.audience : '';
        const tone = typeof brief.tone === 'string' ? brief.tone : '';
        const modeLabel = (this.workflowMode || 'auto') === 'auto' ? 'Auto-pilot' : (this.workflowMode === 'guided' ? 'Guided' : 'Manual');

        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:target"></iconify-icon> 项目需求（ProjectBrief）</h3>
                    <p>用于约束 DeepSearch 与 PPT 生成方向（当前模式：${modeLabel}）。</p>
                </div>
                <div class="form-body custom-scrollbar">
                    <div class="form-group">
                        <label>1. 任务目标（必填）</label>
                        <input id="pptBriefTaskGoal" type="text" class="ppt-input-field" placeholder="例如：生成一份面向高管的市场分析汇报，突出竞争格局与关键指标" value="${this._escapeAttr(taskGoal)}">
                    </div>
                    <div class="form-group">
                        <label>2. 侧重点 / 项目摘要（写入 projectSummary）</label>
                        <textarea id="pptBriefProjectSummary" class="ppt-input-field" style="min-height: 140px; line-height: 1.5;" placeholder="希望重点关注哪些结论、证据、结构或风格？">${this._escapeHtml(projectSummary)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>3. 受众（可选）</label>
                        <input id="pptBriefAudience" type="text" class="ppt-input-field" placeholder="例如：非技术高管 / 技术团队 / 混合受众" value="${this._escapeAttr(audience)}">
                    </div>
                    <div class="form-group">
                        <label>4. 语气（可选）</label>
                        <input id="pptBriefTone" type="text" class="ppt-input-field" placeholder="例如：商务严谨 / 学术 / 科技感" value="${this._escapeAttr(tone)}">
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.cancelProjectBrief && window.PPTGenerator.cancelProjectBrief()">
                        <iconify-icon icon="carbon:arrow-left"></iconify-icon> 返回
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.submitProjectBrief && window.PPTGenerator.submitProjectBrief()">
                        保存并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },

    _renderDeepSearchReview() {
        const md = typeof this.workflowData?.reportMarkdown === 'string'
            ? this.workflowData.reportMarkdown
            : (this.workflowData?.report?.markdown || '');

        const hasContinue = typeof window !== 'undefined' && window.PPTGenerator && typeof window.PPTGenerator.continueDeepSearchIteration === 'function';
        const hasProceed = typeof window !== 'undefined' && window.PPTGenerator && typeof window.PPTGenerator.proceedToScriptReview === 'function';

        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:search"></iconify-icon> DeepSearch 结果审阅</h3>
                    <p>查看 gaps 覆盖情况与迭代进度；可继续下一轮或进入脚本编辑。</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${this._renderDeepSearchVisualization({ compact: false })}

                    <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--ppt-border);">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px;">
                            <div style="font-weight:650; color: var(--ppt-text);">研究报告预览</div>
                            <div style="font-size:12px; color: var(--ppt-text-secondary);">可在下一步编辑全文</div>
                        </div>
                        <textarea class="ppt-input-field" style="width: 100%; min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;"
                            readonly>${this._escapeHtml(md)}</textarea>
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-secondary" ${hasContinue ? '' : 'disabled'} onclick="${hasContinue ? 'window.PPTGenerator.continueDeepSearchIteration()' : ''}">
                        <iconify-icon icon="carbon:renew"></iconify-icon> 下一轮迭代
                    </button>
                    <button class="ppt-btn-primary" ${hasProceed ? '' : 'disabled'} onclick="${hasProceed ? 'window.PPTGenerator.proceedToScriptReview()' : ''}">
                        进入脚本编辑 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },

    _renderDeepSearchVisualization({ compact } = {}) {
        const id = compact ? 'pptDeepSearchFlowVizCompact' : 'pptDeepSearchFlowViz';
        const height = compact ? 320 : 520;
        const wrapClass = compact ? 'ppt-flow-embed compact' : 'ppt-flow-embed';
        return `
            <div class="${wrapClass}">
                <div class="ppt-flow-embed-header">
                    <div class="ppt-flow-embed-title">
                        <iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon>
                        <span>DeepSearch 流程</span>
                    </div>
                    <div class="ppt-flow-embed-hint">拖拽 / 缩放查看 · 自动聚焦最新节点</div>
                </div>
                <div id="${id}" class="ppt-flow-canvas" style="height:${height}px;"></div>
            </div>
        `;
    },

    /**
     * Premium DeepSearch UI - Flow fullscreen, Stepper top-center, Status bottom-left, Logs center
     */
    _renderDeepSearchPremiumUI() {
        const isDesigner = this.state === 'designer';
        const flowCanvasId = isDesigner ? 'pptDesignFlowVizFull' : 'pptDeepSearchFlowVizFull';

        return `
            <div class="ds-research-stage">
                <!-- Flow Canvas - Full Screen Background -->
                <div class="ds-viz-panel">
                    <div id="${flowCanvasId}" class="ppt-flow-canvas"></div>
                </div>

                <!-- Stepper Bar - Top Center -->
                <div class="ds-stepper-bar">
                    <div class="ds-stepper-left">
                        ${this._renderDsStep('reading', '1', '阅读')}
                        <div class="ds-step-line ${this._isStepCompleted('reading') ? 'completed' : ''}"></div>
                        ${this._renderDsStep('researching', '2', '研究')}
                        <div class="ds-step-line ${this._isStepCompleted('researching') ? 'completed' : ''}"></div>
                        ${this._renderDsStep('script_review', '3', '脚本')}
                        <div class="ds-step-line ${this._isStepCompleted('script_review') ? 'completed' : ''}"></div>
                        ${this._renderDsStep('page_layout', '4', '规划')}
                        <div class="ds-step-line ${this._isStepCompleted('page_layout') ? 'completed' : ''}"></div>
                        ${this._renderDsStep('designer', '5', '设计')}
                    </div>
                </div>

                <!-- Status Card - Bottom Left -->
                <div class="ds-stepper-status">
                    <div class="ds-status-badge-sm" id="dsPanelStatusBadge">
                        <iconify-icon icon="${this._getCurrentStatusIcon()}"></iconify-icon>
                    </div>
                    <span class="ds-status-label" id="dsPanelStatusTitle">${this._getCurrentStatusTitle()}</span>
                </div>

                <!-- Process Panel - Full Screen Center (execution logs) -->
                <div class="ds-process-panel">
                    <div class="ds-panel-header">
                        <span class="ds-panel-title">执行日志</span>
                        <span class="ds-panel-hint" id="dsPanelStatusSub">${this._getCurrentStatusDesc()}</span>
                    </div>
                    <div class="ds-process-content" id="dsProcessList">
                        <!-- Step items will be appended here -->
                    </div>
                </div>
            </div>
        `;
    },

    _renderDsStep(stepState, num, label) {
        const states = ['idle', 'reading', 'researching', 'script_review', 'page_layout', 'designer', 'reviewer', 'completed', 'failed'];
        const currentIndex = states.indexOf(this.state);
        const stepIndex = states.indexOf(stepState);

        let className = 'ds-step';
        if (this.state === stepState) className += ' active';
        if (currentIndex > stepIndex) className += ' completed';

        const icon = currentIndex > stepIndex ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num;

        return `
            <div class="${className}">
                <div class="ds-step-num">${icon}</div>
                <span class="ds-step-text">${label}</span>
            </div>
        `;
    },

    _isStepCompleted(stepState) {
        const states = ['idle', 'reading', 'researching', 'script_review', 'page_layout', 'designer', 'reviewer', 'completed', 'failed'];
        const currentIndex = states.indexOf(this.state);
        const stepIndex = states.indexOf(stepState);
        return currentIndex > stepIndex;
    },

    /**
     * Add a step item to the floating process panel
     * Merges consecutive progress items (e.g., "提取论点 1/20", "2/20"...) into single updating row
     */
    addProcessPanelStep(event) {
        const list = document.getElementById('dsProcessList');
        if (!list || !event?.text) return;

        // Check if this is a progress update that should merge with previous
        const progressMatch = event.text.match(/(\d+)\s*\/\s*(\d+)/);
        if (progressMatch) {
            const lastItem = list.querySelector('.ds-step-item.progress-item:last-of-type');
            if (lastItem) {
                // Check if same type of progress (same prefix before the numbers)
                const prefix = event.text.replace(/\d+\s*\/\s*\d+.*$/, '').trim();
                const lastPrefix = lastItem.dataset.progressPrefix;
                if (lastPrefix === prefix) {
                    // Update existing progress item
                    const descEl = lastItem.querySelector('.ds-step-desc');
                    const timeEl = lastItem.querySelector('.ds-step-time');
                    if (descEl) descEl.textContent = event.text;
                    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                    list.scrollTop = list.scrollHeight;
                    return;
                }
            }
        }

        const div = document.createElement('div');
        div.className = 'ds-step-item';

        // Mark as progress item if it contains X/Y pattern
        if (progressMatch) {
            div.classList.add('progress-item');
            div.dataset.progressPrefix = event.text.replace(/\d+\s*\/\s*\d+.*$/, '').trim();
        }

        // Determine step status
        if (event.name?.includes('completed') || event.name?.includes('upserted')) {
            div.classList.add('completed');
        } else if (event.name?.includes('started') && !event.name?.includes('node')) {
            div.classList.add('running');
        } else if (event.name?.includes('external')) {
            div.classList.add('info');
        } else if (event.name?.includes('warning') || event.name?.includes('error')) {
            div.classList.add('warning');
        }

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const stageName = event.name?.split('.')[1] || 'event';

        // Determine icon
        let icon = '<iconify-icon icon="solar:record-circle-outline"></iconify-icon>';
        if (div.classList.contains('completed')) icon = '<iconify-icon icon="solar:check-circle-bold"></iconify-icon>';
        if (div.classList.contains('running')) icon = '<iconify-icon icon="solar:refresh-circle-bold"></iconify-icon>';
        if (div.classList.contains('info')) icon = '<iconify-icon icon="solar:info-circle-bold"></iconify-icon>';
        if (div.classList.contains('warning')) icon = '<iconify-icon icon="solar:danger-triangle-bold"></iconify-icon>';

        // Build details HTML (skip for progress items to keep compact)
        let detailsHtml = '';
        if (!progressMatch && event.details && Object.keys(event.details).length > 0) {
            detailsHtml = `
                <div class="ds-step-details">
                    ${Object.entries(event.details).map(([k, v]) => `
                        <div class="ds-detail-row">
                            <span class="ds-detail-label">${this._escapeHtml(k)}:</span>
                            <span class="ds-detail-val">${this._escapeHtml(String(v))}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        div.innerHTML = `
            <div class="ds-step-icon">${icon}</div>
            <div class="ds-step-info">
                <div class="ds-step-header-line">
                    <span class="ds-step-name">${this._escapeHtml(stageName)}</span>
                    <span class="ds-step-time">${time}</span>
                </div>
                <div class="ds-step-desc">${this._escapeHtml(event.text)}</div>
                ${detailsHtml}
            </div>
        `;

        list.appendChild(div);
        list.scrollTop = list.scrollHeight;

        // Update status header
        this._updatePanelStatus(event);
    },

    _updatePanelStatus(event) {
        const badge = document.getElementById('dsPanelStatusBadge');
        const title = document.getElementById('dsPanelStatusTitle');
        const sub = document.getElementById('dsPanelStatusSub');

        if (!badge || !title || !sub) return;

        // Update based on event type
        if (event.name?.includes('scan')) {
            sub.textContent = '正在扫描文档...';
            badge.innerHTML = '<iconify-icon icon="solar:scanner-outline"></iconify-icon>';
        } else if (event.name?.includes('gaps')) {
            sub.textContent = '正在分析知识空白...';
            badge.innerHTML = '<iconify-icon icon="solar:atom-outline"></iconify-icon>';
        } else if (event.name?.includes('retrieve')) {
            sub.textContent = '正在检索相关内容...';
            badge.innerHTML = '<iconify-icon icon="solar:magnifer-outline"></iconify-icon>';
        } else if (event.name?.includes('understand')) {
            sub.textContent = '正在理解和提取要点...';
            badge.innerHTML = '<iconify-icon icon="solar:brain-outline"></iconify-icon>';
        } else if (event.name?.includes('write')) {
            sub.textContent = '正在撰写报告...';
            badge.innerHTML = '<iconify-icon icon="solar:pen-new-square-outline"></iconify-icon>';
        } else if (event.name?.includes('design')) {
            sub.textContent = '正在设计页面...';
            badge.innerHTML = '<iconify-icon icon="solar:pallete-outline"></iconify-icon>';
        }

        if (event.name === 'deepsearch.completed') {
            title.textContent = '研究完成';
            sub.textContent = '报告已生成';
            badge.innerHTML = '<iconify-icon icon="solar:check-circle-bold"></iconify-icon>';
            badge.classList.add('success');
        }
    },

    _renderDesignVisualization({ compact } = {}) {
        const id = compact ? 'pptDesignFlowVizCompact' : 'pptDesignFlowViz';
        const height = compact ? 360 : 560;
        const wrapClass = compact ? 'ppt-flow-embed compact' : 'ppt-flow-embed';
        return `
            <div class="${wrapClass}">
                <div class="ppt-flow-embed-header">
                    <div class="ppt-flow-embed-title">
                        <iconify-icon icon="carbon:paint-brush"></iconify-icon>
                        <span>Design 流程</span>
                    </div>
                    <div class="ppt-flow-embed-hint">拖拽 / 缩放查看 · 生成中会持续更新</div>
                </div>
                <div id="${id}" class="ppt-flow-canvas" style="height:${height}px;"></div>
            </div>
        `;
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },

    _escapeAttr(value) {
        return this._escapeHtml(value).replaceAll('\n', ' ').replaceAll('\r', ' ');
    },

    _destroyFlowViz(kind) {
        const k = kind === 'design' ? 'design' : 'deepsearch';
        if (!this._flowVizUnsubs || typeof this._flowVizUnsubs !== 'object') this._flowVizUnsubs = {};

        try {
            const off = this._flowVizUnsubs[k];
            if (typeof off === 'function') off();
        } catch {
            // ignore
        }
        this._flowVizUnsubs[k] = null;

        const viz = k === 'design' ? this._designFlowViz : this._deepsearchFlowViz;
        try {
            viz?.destroy?.();
        } catch {
            // ignore
        }

        if (k === 'design') this._designFlowViz = null;
        else this._deepsearchFlowViz = null;
    },

    async _getFlowVizModule() {
        if (this._flowVizModulePromise) return this._flowVizModulePromise;
        // This file is loaded as a classic script; resolve import relative to the document.
        this._flowVizModulePromise = import(new URL('js/ppt/deepsearch-flow-visualizer.js', document.baseURI).href);
        return this._flowVizModulePromise;
    },

    async _mountFlowViz({ kind, containerId, direction, height }) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const k = kind === 'design' ? 'design' : 'deepsearch';
        this._destroyFlowViz(k);
        el.innerHTML = ''; // Clear without loading message

        let mod = null;
        try {
            mod = await this._getFlowVizModule();
        } catch (e) {
            console.warn('[flow-viz] failed to import visualizer:', e);
            const hint = location?.protocol === 'file:'
                ? '检测到 file:// 打开页面。请用本地服务打开（例如 npm run dev:fe，然后访问 http://localhost:5173/ppt.html）。'
                : '请刷新页面或查看控制台错误信息。';
            el.innerHTML = `<div style="padding:12px 14px; color: var(--ppt-warning); font-size:12px; line-height:1.5;">流程可视化加载失败（模块导入失败）。${this._escapeHtml(hint)}</div>`;
            return;
        }

        const init = mod?.initDeepSearchFlow;
        if (typeof init !== 'function') {
            el.innerHTML = `<div style="padding:12px 14px; color: var(--ppt-warning); font-size:12px; line-height:1.5;">流程可视化加载失败（initDeepSearchFlow 不存在）。</div>`;
            return;
        }

        let viz = null;
        try {
            viz = await init(containerId, {
                direction,
                height,
                acceptPrefixes: k === 'design' ? ['design.'] : ['deepsearch.'],
                acceptNames: k === 'design' ? [] : ['iteration.completed'],
            });
        } catch (e) {
            console.warn('[flow-viz] init failed:', e);
            el.innerHTML = `<div style="padding:12px 14px; color: var(--ppt-warning); font-size:12px; line-height:1.5;">流程可视化初始化失败。请查看控制台错误信息。</div>`;
            return;
        }
        if (!viz) return;

        // Replay stored events (minimal {name,payload}) to rebuild graph.
        const events = this.workflowData?.flowVizEvents?.[k];
        if (Array.isArray(events) && events.length) {
            try {
                viz.processEvents(events);
            } catch (e) {
                console.warn('[flow-viz] replay failed:', e);
            }
        }

        // Live subscribe.
        const bus = this._orchestrator?.eventBus;
        if (!this._flowVizUnsubs || typeof this._flowVizUnsubs !== 'object') this._flowVizUnsubs = {};
        if (bus && typeof viz.subscribe === 'function') {
            try {
                this._flowVizUnsubs[k] = viz.subscribe(bus);
            } catch (e) {
                console.warn('[flow-viz] subscribe failed:', e);
            }
        }

        if (k === 'design') this._designFlowViz = viz;
        else this._deepsearchFlowViz = viz;
    },

    _mountActiveFlowVisualizers() {
        if (this.state === 'researching') {
            // Mount full-screen canvas
            const fullEl = document.getElementById('pptDeepSearchFlowVizFull');
            if (fullEl) {
                this._mountFlowViz({ kind: 'deepsearch', containerId: 'pptDeepSearchFlowVizFull', direction: 'LR', height: null });
            } else {
                this._mountFlowViz({ kind: 'deepsearch', containerId: 'pptDeepSearchFlowVizCompact', direction: 'LR', height: 400 });
            }
            return;
        }
        if (this.state === 'deepsearch_review') {
            this._mountFlowViz({ kind: 'deepsearch', containerId: 'pptDeepSearchFlowViz', direction: 'LR', height: 520 });
            return;
        }
        if (this.state === 'designer') {
            // Mount full-screen canvas
            const fullEl = document.getElementById('pptDesignFlowVizFull');
            if (fullEl) {
                this._mountFlowViz({ kind: 'design', containerId: 'pptDesignFlowVizFull', direction: 'TB', height: null });
            } else {
                this._mountFlowViz({ kind: 'design', containerId: 'pptDesignFlowVizCompact', direction: 'TB', height: 400 });
            }
        }
    },

    openHistorySelector() {
        // Ensure files array exists
        if (!this.workflowData.files) this.workflowData.files = [];

        // Mock adding a history project
        this.workflowData.files.push({
            name: "Q3 财务报表分析 (History)",
            type: "history",
            size: "Project"
        });
        this.renderPreviewArea();
    },

    openUrlInput() {
        const url = prompt("请输入文章或文档链接:");
        if (url && url.trim()) {
            if (!this.workflowData.files) this.workflowData.files = [];
            this.workflowData.files.push({
                name: url,
                type: "link",
                size: "URL"
            });
            this.renderPreviewArea();
        }
    },

    removeFile(index) {
        this.workflowData.files.splice(index, 1);
        this.renderPreviewArea();
    },

    // ============================================================
    // Paste Document Modal (Task 3)
    // ============================================================

    openPasteDocumentModal() {
        const modalId = 'pptPasteDocumentModal';
        const existing = document.getElementById(modalId);
        if (existing) {
            existing.classList.add('open');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'ppt-modal-overlay open';
        overlay.innerHTML = `
            <div class="ppt-modal" style="width: min(900px, 90vw); max-height: 80vh; display: flex; flex-direction: column;">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title" id="pptPasteDocumentModalTitle">粘贴文档内容</div>
                    <button class="ppt-modal-close" onclick="window.PPTGenerator.closePasteDocumentModal()" aria-label="关闭">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-modal-body" style="flex: 1; min-height: 0;">
                    <div id="pasteDocumentEditor" style="min-height: 360px;"></div>
                    <div id="pasteDocumentFallback" style="display: none;">
                        <textarea id="pasteDocumentTextarea" class="ppt-input-field" style="width: 100%; min-height: 360px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;" placeholder="在此粘贴 Markdown/纯文本内容..."></textarea>
                    </div>
                </div>
                <div class="ppt-modal-footer">
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closePasteDocumentModal()">取消</button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmPasteDocument()">
                        <iconify-icon icon="carbon:rocket"></iconify-icon> 开始生成
                    </button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePasteDocumentModal();
        });

        this._pasteDocumentModalKeyHandler = (e) => {
            if (e.key === 'Escape') this.closePasteDocumentModal();
        };
        document.addEventListener('keydown', this._pasteDocumentModalKeyHandler);

        const host = this.elements?.overlay || document.body;
        host.appendChild(overlay);

        this._pasteDocumentModalTimer = setTimeout(() => {
            const fallback = document.getElementById('pasteDocumentFallback');
            const textarea = document.getElementById('pasteDocumentTextarea');

            if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
                const mounted = VditorAdapter.mount({
                    container: 'pasteDocumentEditor',
                    value: '',
                    onInput: () => {},
                    mode: 'ir'
                });
                if (mounted) {
                    if (fallback) fallback.style.display = 'none';
                } else if (fallback && textarea) {
                    fallback.style.display = 'block';
                    textarea.focus?.();
                }
            } else if (fallback && textarea) {
                fallback.style.display = 'block';
                textarea.focus?.();
            }
        }, 100);
    },

    closePasteDocumentModal() {
        if (this._pasteDocumentModalTimer) {
            clearTimeout(this._pasteDocumentModalTimer);
            this._pasteDocumentModalTimer = null;
        }

        if (this._pasteDocumentModalKeyHandler) {
            document.removeEventListener('keydown', this._pasteDocumentModalKeyHandler);
            this._pasteDocumentModalKeyHandler = null;
        }

        if (typeof VditorAdapter !== 'undefined') {
            try {
                VditorAdapter.destroy();
            } catch (e) {
                // ignore
            }
        }

        const modal = document.getElementById('pptPasteDocumentModal');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => modal.remove(), 300);
        }
    },

    confirmPasteDocument() {
        let content = '';

        if (typeof VditorAdapter !== 'undefined' && VditorAdapter.isAvailable()) {
            content = VditorAdapter.getValue();
        } else {
            content = document.getElementById('pasteDocumentTextarea')?.value || '';
        }

        if (typeof this.startFromPastedText === 'function') {
            this.startFromPastedText(content);
        } else {
            console.warn('[PPTGenerator] startFromPastedText() not implemented yet (Task 4).');
        }

        this.closePasteDocumentModal();
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

    _renderPageLayoutReview() {
        const pkg = this.workflowData?.contentPackage;
        const slides = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents : [];
        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:layout"></iconify-icon> 页面规划</h3>
                    <p>DeepSearch 已输出 ${slides.length} 个 SlideIntent，将用于后续布局与视觉设计。</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${slides.length ? `
                        <div style="display: flex; flex-direction: column; gap: 10px;">
                            ${slides.map((s, i) => `
                                <div style="border: 1px solid var(--ppt-border); border-radius: 12px; padding: 10px 12px; background: var(--ppt-bg-app);">
                                    <div style="font-weight: 700;">${i + 1}. ${s.title || '(untitled)'} <span style="font-weight: 500; color: var(--ppt-text-secondary);">(${s.pageType || 'overview'})</span></div>
                                    ${Array.isArray(s.keyPoints) && s.keyPoints.length ? `<div style="margin-top: 6px; color: var(--ppt-text-secondary); font-size: 13px;">${s.keyPoints.slice(0, 4).map(k => `• ${k}`).join('<br/>')}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : `
                        <div style="color: var(--ppt-text-secondary);">未检测到 slideIntents。</div>
                    `}

                    <div style="margin-top: 16px;">
                        ${this._renderDesignSpecView()}
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.phase5_DesignOptimization()">
                        继续设计 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },

    _ensureDesignSpecInitialized() {
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.designSystem || typeof this.workflowData.designSystem !== 'object') {
            this.workflowData.designSystem = {};
        }

        const ds = this.workflowData.designSystem;

        // === DesignSystem UI v2 userConfig model ===
        // Keep backwards compatibility with legacy {colors,fonts,...} by migrating into designSystemOverrides.
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

        // Legacy aliases (UI code historically reads ds.colors / ds.fonts)
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

        // Initialize styleReference
        if (!ds.styleReference || typeof ds.styleReference !== 'object') {
            ds.styleReference = {
                images: [],
                extracted: null,
                userNotes: ''
            };
        }

        const allowedBatch = new Set([1, 2, 4]);
        const batchSize = Number(this.workflowData.batchSize);
        if (!allowedBatch.has(batchSize)) this.workflowData.batchSize = 4;

        return ds;
    },

    _coerceHexColor(value, fallback) {
        const v = typeof value === 'string' ? value.trim() : '';
        if (/^#([0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
        if (/^#([0-9a-f]{3})$/i.test(v)) {
            const m = v.toLowerCase().slice(1);
            return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`;
        }
        return fallback;
    },

    updateDesignSystemColor(key, value) {
        const ds = this._ensureDesignSpecInitialized();
        const k = String(key || '').trim();
        if (!k) return;
        const colors = ds.designSystemOverrides?.colors || ds.colors || {};
        const prev = this._coerceHexColor(colors?.[k], '#000000');
        const next = this._coerceHexColor(value, prev);
        if (ds.designSystemOverrides?.colors) ds.designSystemOverrides.colors[k] = next;
        ds.colors[k] = next;
        this.renderPreviewArea?.();
    },

    updateDesignSystemFont(key, value) {
        const ds = this._ensureDesignSpecInitialized();
        const k = String(key || '').trim();
        if (!k) return;
        const typography = ds.designSystemOverrides?.typography || ds.fonts || {};
        const next = typeof value === 'string' ? value : String(value ?? '');
        if (ds.designSystemOverrides?.typography) ds.designSystemOverrides.typography[k] = next;
        typography[k] = next;
        ds.fonts[k] = next;
        this.renderPreviewArea?.();
    },

    updateDesignSystemFontSize(value) {
        const ds = this._ensureDesignSpecInitialized();
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const next = Math.max(10, Math.min(60, Math.round(n)));
        if (ds.designSystemOverrides?.typography) ds.designSystemOverrides.typography.fontSize = next;
        ds.fonts.fontSize = next;
        this.renderPreviewArea?.();
    },

    updateVisualPreferenceMode(mode) {
        const ds = this._ensureDesignSpecInitialized();
        const v = String(mode || '').trim();
        if (!new Set(['ai-first', 'svg-first', 'balanced']).has(v)) return;
        if (ds.designSystemOverrides?.visualPreference) ds.designSystemOverrides.visualPreference.mode = v;
        if (ds.visualPreference) ds.visualPreference.mode = v;
        this.renderPreviewArea?.();
    },

    updateRefineEnabled(enabled) {
        this.workflowData.designSystem = this.workflowData.designSystem || {};
        this.workflowData.designSystem.refine = this.workflowData.designSystem.refine || {};
        this.workflowData.designSystem.refine.enabled = !!enabled;
        this.renderPreviewArea();
    },

    updateDesignSystemDensity(value) {
        const ds = this._ensureDesignSpecInitialized();
        const v = String(value || '').trim();
        if (!new Set(['compact', 'balanced', 'spacious']).has(v)) return;
        ds.density = v;
        this.renderPreviewArea?.();
    },

    updateBatchSize(value) {
        if (!this.workflowData) this.workflowData = {};
        const n = Number(value);
        if (![1, 2, 4].includes(n)) return;
        this.workflowData.batchSize = n;
        this.renderPreviewArea?.();
    },

    updateDesignSystemModel(value) {
        const ds = this._ensureDesignSpecInitialized();
        ds.model = String(value || '').trim() || ds.model;
        this.renderPreviewArea?.();
    },

    // Style Reference methods
    async addStyleReference(imageData) {
        const ds = this._ensureDesignSpecInitialized();
        if (!ds.styleReference.images) ds.styleReference.images = [];
        if (ds.styleReference.images.length >= 3) {
            console.warn('Maximum 3 style reference images allowed');
            return { ok: false, error: 'max_images' };
        }

        const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const imageEntry = { id, thumbnail: imageData, original: imageData, status: 'analyzing' };
        ds.styleReference.images.push(imageEntry);
        this.renderPreviewArea?.();

        // Call VLM to extract style
        try {
            const { analyzeImage } = await import('./vision/layout-from-image.js');
            const context = {
                intentHint: 'style_reference',
                modelRouter: window.modelRouter || this._modelRouter,
                visionApi: window.visionApi || this._visionApi
            };
            const result = await analyzeImage(imageData, context);

            // Merge extracted data
            const prev = ds.styleReference.extracted || {};
            ds.styleReference.extracted = {
                colorTone: result.styleDescription?.colorTone || prev.colorTone || '',
                mood: result.styleDescription?.mood || prev.mood || '',
                layoutStyle: result.styleDescription?.layoutStyle || prev.layoutStyle || '',
                typography: result.styleDescription?.typography || prev.typography || '',
                effects: result.styleDescription?.effects || prev.effects || '',
                palette: [...(prev.palette || []), ...(result.extractedPalette || [])].slice(0, 10)
            };

            // Update status
            const entry = ds.styleReference.images.find(e => e.id === id);
            if (entry) entry.status = 'done';

            this.renderPreviewArea?.();
            return { ok: true, id, extracted: ds.styleReference.extracted };
        } catch (err) {
            console.error('Style extraction failed:', err);
            const entry = ds.styleReference.images.find(e => e.id === id);
            if (entry) entry.status = 'error';
            this.renderPreviewArea?.();
            return { ok: false, error: err.message };
        }
    },

    removeStyleReference(id) {
        const ds = this._ensureDesignSpecInitialized();
        if (!ds.styleReference.images) return;
        const idx = ds.styleReference.images.findIndex(e => e.id === id);
        if (idx >= 0) {
            ds.styleReference.images.splice(idx, 1);
            // Clear extracted if no images left
            if (ds.styleReference.images.length === 0) {
                ds.styleReference.extracted = null;
            }
            this.renderPreviewArea?.();
        }
    },

    updateStyleReferenceNotes(notes) {
        const ds = this._ensureDesignSpecInitialized();
        ds.styleReference.userNotes = String(notes || '');
        // No re-render needed for notes
    },

    _handleStyleRefDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        if (!dt?.files?.length) return;
        const file = dt.files[0];
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                this.addStyleReference(reader.result);
            }
        };
        reader.readAsDataURL(file);
    },

    _handleStyleRefFileSelect(e) {
        const file = e.target?.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                this.addStyleReference(reader.result);
            }
        };
        reader.readAsDataURL(file);
    },

    _renderDesignSpecView() {
        const ds = this._ensureDesignSpecInitialized();
        const overrides = ds.designSystemOverrides || {};
        const colors = overrides.colors || ds.colors || {};
        const fonts = overrides.typography || ds.fonts || {};
        const visualMode = typeof overrides?.visualPreference?.mode === 'string' ? overrides.visualPreference.mode : (ds.visualPreference?.mode || 'balanced');
        const refineEnabled = !!ds.refine?.enabled;
        const density = ds.density || 'balanced';
        const batchSize = Number(this.workflowData?.batchSize) || 4;

        const primary = this._coerceHexColor(colors.primary, '#0ea5e9');
        const secondary = this._coerceHexColor(colors.secondary, '#7c3aed');
        const bg = this._coerceHexColor(colors.bg, '#ffffff');
        const text = this._coerceHexColor(colors.text, '#0f172a');
        const accent = this._coerceHexColor(colors.accent, '#22c55e');

        const titleFont = typeof fonts.titleFont === 'string' ? fonts.titleFont : 'Inter';
        const bodyFont = typeof fonts.bodyFont === 'string' ? fonts.bodyFont : 'Inter';
        const fontSize = Number.isFinite(Number(fonts.fontSize)) ? Number(fonts.fontSize) : 16;

        const densityPad = density === 'compact' ? 10 : (density === 'spacious' ? 18 : 14);

        const modelOptions = [
            { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
            { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
            { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
            { value: 'gpt-4o', label: 'GPT-4o' }
        ];
        const selectedModel = typeof ds.model === 'string' && ds.model.trim() ? ds.model.trim() : 'gemini-1.5-pro';

        const colorRow = (key, label, value) => `
            <div class="ppt-design-spec-color-row" data-design-color="${this._escapeAttr(key)}">
                <div class="ppt-design-spec-swatch" style="background: ${this._escapeAttr(value)};"></div>
                <div class="ppt-design-spec-color-meta">
                    <div class="ppt-design-spec-color-label">${this._escapeHtml(label)}</div>
                    <div class="ppt-design-spec-color-value">${this._escapeHtml(value)}</div>
                </div>
                <input id="pptDesignColor-${this._escapeAttr(key)}" class="ppt-design-spec-color-input" type="color" value="${this._escapeAttr(value)}"
                    oninput="window.PPTGenerator.updateDesignSystemColor('${this._escapeAttr(key)}', this.value)">
            </div>
        `;

        const segBtn = (group, value, label, active) => `
            <button class="ppt-design-spec-seg-btn ${active ? 'active' : ''}" type="button"
                onclick="window.PPTGenerator.${group}('${this._escapeAttr(value)}')">${this._escapeHtml(label)}</button>
        `;

        const segBtnNum = (group, value, label, active) => `
            <button class="ppt-design-spec-seg-btn ${active ? 'active' : ''}" type="button"
                onclick="window.PPTGenerator.${group}(${Number(value)})">${this._escapeHtml(label)}</button>
        `;

        return `
            <div class="ppt-design-spec">
                <div class="ppt-design-spec-header">
                    <div class="ppt-design-spec-title">
                        <iconify-icon icon="carbon:color-palette"></iconify-icon>
                        <span>Design Spec</span>
                    </div>
                    <div class="ppt-design-spec-subtitle">配置色板/字体/密度/批量与模型，并实时预览</div>
                </div>

                <div class="ppt-design-spec-grid">
                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Colors</div>
                        <div class="ppt-design-spec-colors">
                            ${colorRow('primary', 'Primary', primary)}
                            ${colorRow('secondary', 'Secondary', secondary)}
                            ${colorRow('bg', 'Background', bg)}
                            ${colorRow('text', 'Text', text)}
                            ${colorRow('accent', 'Accent', accent)}
                        </div>
                    </div>

                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Typography</div>
                        <div class="ppt-design-spec-form">
                            <label class="ppt-design-spec-field">
                                <span>Title Font</span>
                                <input id="pptDesignFont-titleFont" class="ppt-input-field" value="${this._escapeAttr(titleFont)}"
                                    oninput="window.PPTGenerator.updateDesignSystemFont('titleFont', this.value)">
                            </label>
                            <label class="ppt-design-spec-field">
                                <span>Body Font</span>
                                <input id="pptDesignFont-bodyFont" class="ppt-input-field" value="${this._escapeAttr(bodyFont)}"
                                    oninput="window.PPTGenerator.updateDesignSystemFont('bodyFont', this.value)">
                            </label>
                            <label class="ppt-design-spec-field">
                                <span>Font Size</span>
                                <input id="pptDesignFont-fontSize" class="ppt-input-field" type="number" min="10" max="60" step="1"
                                    value="${this._escapeAttr(String(fontSize))}"
                                    oninput="window.PPTGenerator.updateDesignSystemFontSize(this.value)">
                            </label>
                        </div>
                    </div>

                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Visual Preference</div>
                        <div class="ppt-design-spec-seg">
                            ${segBtn('updateVisualPreferenceMode', 'ai-first', 'AI-first', visualMode === 'ai-first')}
                            ${segBtn('updateVisualPreferenceMode', 'svg-first', 'SVG-first', visualMode === 'svg-first')}
                            ${segBtn('updateVisualPreferenceMode', 'balanced', 'Balanced', visualMode === 'balanced')}
                        </div>

                        <div class="ppt-design-spec-row">
                            <label>Refiner (ReAct)</label>
                            <div class="ppt-design-spec-toggle">
                                <button onclick="window.PPTGenerator.updateRefineEnabled(false)" class="ppt-design-spec-seg-btn ${!refineEnabled ? 'active' : ''}">关闭</button>
                                <button onclick="window.PPTGenerator.updateRefineEnabled(true)" class="ppt-design-spec-seg-btn ${refineEnabled ? 'active' : ''}">启用</button>
                            </div>
                        </div>
                    </div>

                    <div class="ppt-design-spec-section">
                        <div class="ppt-design-spec-section-title">Density</div>
                        <div class="ppt-design-spec-seg">
                            ${segBtn('updateDesignSystemDensity', 'compact', 'Compact', density === 'compact')}
                            ${segBtn('updateDesignSystemDensity', 'balanced', 'Balanced', density === 'balanced')}
                            ${segBtn('updateDesignSystemDensity', 'spacious', 'Spacious', density === 'spacious')}
                        </div>

                        <div class="ppt-design-spec-section-title" style="margin-top: 14px;">Batch Size</div>
                        <div class="ppt-design-spec-seg">
                            ${segBtnNum('updateBatchSize', 1, '1', batchSize === 1)}
                            ${segBtnNum('updateBatchSize', 2, '2', batchSize === 2)}
                            ${segBtnNum('updateBatchSize', 4, '4', batchSize === 4)}
                        </div>

                        <div class="ppt-design-spec-section-title" style="margin-top: 14px;">Model</div>
                        <select id="pptDesignModel" class="ppt-input-field" onchange="window.PPTGenerator.updateDesignSystemModel(this.value)">
                            ${modelOptions.map(o => `
                                <option value="${this._escapeAttr(o.value)}" ${o.value === selectedModel ? 'selected' : ''}>
                                    ${this._escapeHtml(o.label)}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="ppt-design-spec-preview" data-density="${this._escapeAttr(density)}"
                        style="--ds-bg:${this._escapeAttr(bg)}; --ds-text:${this._escapeAttr(text)}; --ds-primary:${this._escapeAttr(primary)}; --ds-secondary:${this._escapeAttr(secondary)}; --ds-accent:${this._escapeAttr(accent)}; padding:${densityPad}px;">
                        <div class="ppt-design-spec-preview-card">
                            <div class="ppt-design-spec-preview-title" style="font-family:${this._escapeAttr(titleFont)}; font-size:${Math.round(fontSize * 1.7)}px;">
                                Preview Title
                            </div>
                            <div class="ppt-design-spec-preview-body" style="font-family:${this._escapeAttr(bodyFont)}; font-size:${this._escapeAttr(String(fontSize))}px;">
                                这是正文预览。Primary/Accent 用于强调信息与按钮。
                            </div>
                            <div class="ppt-design-spec-preview-tags">
                                <span class="ppt-design-spec-tag primary">Primary</span>
                                <span class="ppt-design-spec-tag secondary">Secondary</span>
                                <span class="ppt-design-spec-tag accent">Accent</span>
                            </div>
                        </div>
                    </div>
                </div>

                ${this._renderStyleReferenceSection()}
            </div>
        `;
    },

    _renderStyleReferenceSection() {
        const ds = this._ensureDesignSpecInitialized();
        const sr = ds.styleReference || { images: [], extracted: null, userNotes: '' };
        const images = sr.images || [];
        const extracted = sr.extracted || {};
        const notes = sr.userNotes || '';

        const hasExtracted = extracted.colorTone || extracted.mood || extracted.layoutStyle || extracted.typography || extracted.effects;

        const imageList = images.map(img => `
            <div class="ppt-style-ref-thumb ${img.status === 'analyzing' ? 'analyzing' : ''}" data-ref-id="${this._escapeAttr(img.id)}">
                <img src="${this._escapeAttr(img.thumbnail)}" alt="参考图">
                ${img.status === 'analyzing' ? '<div class="ppt-style-ref-loading"><iconify-icon icon="carbon:loading"></iconify-icon></div>' : ''}
                ${img.status === 'error' ? '<div class="ppt-style-ref-error"><iconify-icon icon="carbon:warning-alt"></iconify-icon></div>' : ''}
                <button class="ppt-style-ref-remove" onclick="window.PPTGenerator.removeStyleReference('${this._escapeAttr(img.id)}')" title="删除">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
            </div>
        `).join('');

        const extractedFields = hasExtracted ? `
            <div class="ppt-style-ref-extracted">
                ${extracted.colorTone ? `<div class="ppt-style-ref-field"><span class="label">色调</span><span class="value">${this._escapeHtml(extracted.colorTone)}</span></div>` : ''}
                ${extracted.mood ? `<div class="ppt-style-ref-field"><span class="label">氛围</span><span class="value">${this._escapeHtml(extracted.mood)}</span></div>` : ''}
                ${extracted.layoutStyle ? `<div class="ppt-style-ref-field"><span class="label">布局</span><span class="value">${this._escapeHtml(extracted.layoutStyle)}</span></div>` : ''}
                ${extracted.typography ? `<div class="ppt-style-ref-field"><span class="label">字体</span><span class="value">${this._escapeHtml(extracted.typography)}</span></div>` : ''}
                ${extracted.effects ? `<div class="ppt-style-ref-field"><span class="label">效果</span><span class="value">${this._escapeHtml(extracted.effects)}</span></div>` : ''}
                ${extracted.palette?.length ? `
                    <div class="ppt-style-ref-field">
                        <span class="label">色板</span>
                        <div class="ppt-style-ref-palette">
                            ${extracted.palette.map(c => `<div class="ppt-style-ref-swatch" style="background:${this._escapeAttr(c)}" title="${this._escapeAttr(c)}"></div>`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        ` : '';

        return `
            <div class="ppt-style-ref-section">
                <div class="ppt-style-ref-header">
                    <div class="ppt-style-ref-title">
                        <iconify-icon icon="carbon:image-reference"></iconify-icon>
                        <span>风格参考</span>
                    </div>
                    <div class="ppt-style-ref-subtitle">上传参考图，AI 自动提取风格（最多 3 张）</div>
                </div>

                <div class="ppt-style-ref-body">
                    <div class="ppt-style-ref-upload"
                        ondrop="window.PPTGenerator._handleStyleRefDrop(event)"
                        ondragover="event.preventDefault(); event.currentTarget.classList.add('dragover')"
                        ondragleave="event.currentTarget.classList.remove('dragover')"
                        onclick="document.getElementById('pptStyleRefInput').click()">
                        <iconify-icon icon="carbon:cloud-upload"></iconify-icon>
                        <span>拖拽图片到此处，或点击上传</span>
                        <input type="file" id="pptStyleRefInput" accept="image/*" style="display:none"
                            onchange="window.PPTGenerator._handleStyleRefFileSelect(event)">
                    </div>

                    ${images.length > 0 ? `
                        <div class="ppt-style-ref-thumbs">
                            ${imageList}
                        </div>
                    ` : ''}

                    ${extractedFields}

                    <div class="ppt-style-ref-notes">
                        <label>
                            <span>备注（可选）</span>
                            <textarea id="pptStyleRefNotes" class="ppt-input-field" rows="2"
                                placeholder="例如：参考 Apple 发布会风格"
                                onchange="window.PPTGenerator.updateStyleReferenceNotes(this.value)">${this._escapeHtml(notes)}</textarea>
                        </label>
                    </div>
                </div>
            </div>
        `;
    },

    _renderOutlineReview() {
        // Mock outline data if not present or empty
        let outline = this.workflowData.outline;
        if (!outline || outline.length === 0) {
            outline = [
                { title: "项目背景与痛点", subs: ["当前文档处理效率低下", "非结构化数据提取困难"] },
                { title: "核心解决方案", subs: ["AI 深度阅读引擎", "多智能体协同架构"] },
                { title: "技术优势", subs: ["上下文语义理解", "跨文档知识融合"] },
                { title: "商业价值", subs: ["降低 80% 人力成本", "提升 40% 准确率"] }
            ];
            // Save the mock outline so edits are preserved
            this.workflowData.outline = outline;
        }

        const html = `
            <div class="ppt-question-form">
                <div class="form-header" style="padding-bottom: 16px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <iconify-icon icon="carbon:tree-view-alt" style="font-size: 20px; color: var(--ppt-primary);"></iconify-icon>
                            <h3 style="margin: 0; font-size: 18px;">大纲确认</h3>
                            <span style="font-size: 13px; color: var(--ppt-text-muted);">请确认或调整</span>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addOutlineItem()" style="font-size: 12px; padding: 6px 12px;">
                                <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加章节
                            </button>
                            <button class="ppt-btn-secondary" onclick="window.PPTGenerator.toggleOutlineEditMode()" style="font-size: 12px; padding: 6px 12px;">
                                <iconify-icon icon="carbon:edit"></iconify-icon> Markdown
                            </button>
                        </div>
                    </div>
                </div>
                <div class="form-body custom-scrollbar">

                    <div id="pptOutlineVisualEditor" class="ppt-outline-editor" style="padding-bottom: 100px;">
                        ${outline.map((item, i) => `
                            <div class="outline-node-card" draggable="true" ondragstart="window.PPTGenerator.handleDragStart(event, ${i})" ondragover="window.PPTGenerator.handleDragOver(event)" ondrop="window.PPTGenerator.handleDrop(event, ${i})" style="margin-bottom: 16px; padding: 16px; border: 1px solid var(--ppt-border); border-radius: 8px; position: relative; cursor: grab;">
                                <button class="ppt-icon-btn" onclick="window.PPTGenerator.removeOutlineItem(${i})" title="删除章节" style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 4px; z-index: 10;">
                                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                </button>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-right: 30px;">
                                    <span style="font-weight: 600; color: var(--ppt-accent); cursor: move;"><iconify-icon icon="carbon:draggable"></iconify-icon> ${i + 1}.</span>
                                    <input type="text" class="ppt-input-field" value="${item.title}" style="flex: 1; min-width: 0; font-weight: 600;" onchange="window.PPTGenerator.updateOutlineTitle(${i}, this.value)">
                                </div>
                                <div style="padding-left: 24px;">
                                    ${item.subs.map((sub, j) => `
                                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                            <iconify-icon icon="carbon:dot-mark" style="color: var(--ppt-text-muted); font-size: 10px;"></iconify-icon>
                                            <input type="text" class="ppt-input-field" value="${sub}" style="flex: 1; min-width: 0; font-size: 13px; padding: 6px 8px;" onchange="window.PPTGenerator.updateOutlineSub(${i}, ${j}, this.value)">
                                            <button class="ppt-icon-btn" onclick="window.PPTGenerator.removeOutlineSub(${i}, ${j})" title="删除子项" style="padding: 4px; width: 24px; height: 24px; flex-shrink: 0;">
                                                <iconify-icon icon="carbon:close"></iconify-icon>
                                            </button>
                                        </div>
                                    `).join('')}
                                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addOutlineSub(${i})" style="margin-top: 8px; padding: 4px 12px; font-size: 12px;">
                                        <iconify-icon icon="carbon:add"></iconify-icon> 添加子项
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div id="pptOutlineMarkdownEditor" class="hidden" style="flex: 1; min-height: 0; gap: 20px; display: none;">
                        <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                            <textarea id="pptOutlineMarkdownInput" class="w-full p-4 border border-slate-200 rounded-lg font-mono text-sm" style="flex: 1; resize: none; margin-bottom: 8px;" placeholder="# 章节标题&#10;- 子项内容" oninput="window.PPTGenerator.updateMindMapPreview()"></textarea>
                            <div style="text-align: right; flex-shrink: 0;">
                                <button class="ppt-btn-primary" onclick="window.PPTGenerator.saveMarkdownOutline()">
                                    <iconify-icon icon="carbon:save"></iconify-icon> 保存并返回
                                </button>
                            </div>
                        </div>
                        <div class="mindmap-preview" style="flex: 2; border: 1px solid var(--ppt-border); border-radius: 8px; background: #f8fafc; overflow: hidden; display: flex; flex-direction: column; min-height: 0;">
                            <div style="padding: 8px 12px; background: white; border-bottom: 1px solid var(--ppt-border); font-size: 12px; font-weight: 600; color: var(--ppt-text-secondary);">
                                <iconify-icon icon="carbon:mindmap"></iconify-icon> 思维导图预览
                            </div>
                            <div id="pptMindMapContainer" style="flex: 1; overflow: auto; padding: 20px; position: relative;">
                                <!-- Mindmap SVG will be rendered here -->
                                <div style="color: var(--ppt-text-muted); font-size: 12px; text-align: center; margin-top: 40px;">输入内容以生成预览</div>
                            </div>
                            <div style="padding: 8px 12px; background: #f1f5f9; border-top: 1px solid var(--ppt-border); font-size: 11px; color: var(--ppt-text-secondary); display: flex; justify-content: space-between;">
                                <span><iconify-icon icon="carbon:mouse-right-click"></iconify-icon> 右键点击节点可添加/删除</span>
                                <span><iconify-icon icon="carbon:touch-1"></iconify-icon> 左键点击编辑文本</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.regenerateOutline()">
                        <iconify-icon icon="carbon:renew"></iconify-icon> 重新生成
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmOutline()">
                        确认大纲 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>

            <!-- Context Menu -->
            <div id="pptMindMapContextMenu" class="ppt-context-menu">
                <div class="ppt-context-menu-item" onclick="window.PPTGenerator.triggerContextAction('edit')">
                    <iconify-icon icon="carbon:edit"></iconify-icon> 编辑内容
                </div>
                <div class="ppt-context-menu-item" onclick="window.PPTGenerator.triggerContextAction('add')">
                    <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加子节点
                </div>
                <div class="ppt-context-menu-divider"></div>
                <div class="ppt-context-menu-item danger" onclick="window.PPTGenerator.triggerContextAction('delete')">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon> 删除节点
                </div>
            </div>
        `;

        // Add global click listener to close menu
        setTimeout(() => {
            document.removeEventListener('click', this._closeContextMenuHandler);
            document.addEventListener('click', this._closeContextMenuHandler);
        }, 0);

        return html;
    },

    _closeContextMenuHandler: (e) => {
        const menu = document.getElementById('pptMindMapContextMenu');
        if (menu && !menu.contains(e.target)) {
            menu.style.display = 'none';
        }
    },

    // Drag and Drop Handlers
    handleDragStart(e, index) {
        this.draggedItemIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
    },

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        return false;
    },

    handleDrop(e, targetIndex) {
        e.stopPropagation();
        const draggedIndex = this.draggedItemIndex;

        // Reset opacity
        const cards = document.querySelectorAll('.outline-node-card');
        if (cards[draggedIndex]) cards[draggedIndex].style.opacity = '1';

        if (draggedIndex !== targetIndex && this.workflowData.outline) {
            const item = this.workflowData.outline[draggedIndex];
            // Remove from old position
            this.workflowData.outline.splice(draggedIndex, 1);
            // Insert at new position
            this.workflowData.outline.splice(targetIndex, 0, item);
            this.renderPreviewArea();
        }
        return false;
    },

    updateMindMapPreview() {
        const input = document.getElementById('pptOutlineMarkdownInput');
        const container = document.getElementById('pptMindMapContainer');
        if (!input || !container) return;

        const text = input.value;
        if (!text.trim()) {
            container.innerHTML = '<div style="color: var(--ppt-text-muted); font-size: 12px;">输入内容以生成预览</div>';
            return;
        }

        // Simple Mermaid-like rendering logic (using pure SVG for zero-dependency)
        // Parse structure
        const lines = text.split('\n');
        const nodes = [];
        let currentParent = null;

        // Root node
        nodes.push({ id: 'root', text: this.currentProject.title || '演示文稿', level: 0, children: [] });

        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) {
                const title = trimmed.replace(/^#+\s*/, '');
                const node = { id: `h-${idx}`, text: title, level: 1, children: [] };
                nodes[0].children.push(node);
                currentParent = node;
            } else if ((trimmed.startsWith('-') || trimmed.startsWith('*')) && currentParent) {
                const sub = trimmed.replace(/^[-*]\s*/, '');
                currentParent.children.push({ id: `s-${idx}`, text: sub, level: 2 });
            }
        });

        // Render SVG
        const svg = this._generateMindMapSVG(nodes[0]);
        container.innerHTML = svg;
    },

    _generateMindMapSVG(root) {
        // Improved layout calculation for Mind Map
        const nodeHeight = 30;
        const nodeWidth = 120; // Increased width for better text visibility
        const xGap = 180; // Increased gap
        const yGap = 15;

        // Calculate subtree heights first
        function calculateHeight(node) {
            if (!node.children || node.children.length === 0) {
                node.subtreeHeight = nodeHeight + yGap;
                return node.subtreeHeight;
            }
            let h = 0;
            node.children.forEach(child => {
                h += calculateHeight(child);
            });
            node.subtreeHeight = h;
            return h;
        }

        calculateHeight(root);

        // Layout nodes based on subtree heights
        let maxX = 0;
        let maxY = 0;

        function layout(node, x, y) {
            node.x = x;
            node.y = y + node.subtreeHeight / 2 - nodeHeight / 2;

            if (x + nodeWidth > maxX) maxX = x + nodeWidth;
            if (y + node.subtreeHeight > maxY) maxY = y + node.subtreeHeight;

            let currentChildY = y;
            if (node.children) {
                node.children.forEach(child => {
                    layout(child, x + xGap, currentChildY);
                    currentChildY += child.subtreeHeight;
                });
            }
        }

        layout(root, 20, 20);

        // Dynamic SVG size with padding
        const width = maxX + 50;
        const height = maxY + 40;

        let svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: sans-serif; font-size: 12px; background-color: #f8fafc;">`;

        // Draw connections (Curved lines)
        function drawLines(node) {
            let lines = '';
            if (node.children) {
                node.children.forEach(child => {
                    // Bezier curve from right of parent to left of child
                    const startX = node.x + nodeWidth;
                    const startY = node.y + nodeHeight / 2;
                    const endX = child.x;
                    const endY = child.y + nodeHeight / 2;

                    const cp1X = startX + (endX - startX) / 2;
                    const cp1Y = startY;
                    const cp2X = startX + (endX - startX) / 2;
                    const cp2Y = endY;

                    const path = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
                    lines += `<path d="${path}" stroke="#cbd5e1" stroke-width="1.5" fill="none" />`;
                    lines += drawLines(child);
                });
            }
            return lines;
        }
        svgContent += drawLines(root);

        // Draw nodes
        function drawNodes(node) {
            let nodesSvg = '';
            const color = node.level === 0 ? '#4f46e5' : node.level === 1 ? '#0ea5e9' : '#64748b';
            const bgColor = node.level === 0 ? '#e0e7ff' : node.level === 1 ? '#e0f2fe' : '#ffffff';
            const textColor = node.level === 0 ? '#312e81' : node.level === 1 ? '#0369a1' : '#334155';
            const strokeWidth = node.level === 0 ? 2 : 1;

            // Truncate text if too long
            const maxChars = 14;
            const displayText = node.text.length > maxChars ? node.text.substring(0, maxChars) + '...' : node.text;

            // Add onclick event to update markdown
            const clickHandler = `window.PPTGenerator.handleMindMapNodeClick('${node.id}', '${node.text.replace(/'/g, "\\'")}')`;

            // Add context menu event for right click
            const contextMenuHandler = `window.PPTGenerator.handleMindMapContextMenu(event, '${node.id}')`;

            nodesSvg += `
                <g transform="translate(${node.x}, ${node.y})" onclick="${clickHandler}" oncontextmenu="${contextMenuHandler}" style="cursor: pointer;">
                    <rect width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="${bgColor}" stroke="${color}" stroke-width="${strokeWidth}" filter="drop-shadow(0 1px 2px rgb(0 0 0 / 0.05))" />
                    <text x="${nodeWidth/2}" y="19" text-anchor="middle" fill="${textColor}" style="pointer-events: none; font-weight: ${node.level === 0 ? '600' : '400'}">${displayText}</text>
                    <title>${node.text} (左键编辑，右键菜单)</title>
                </g>
            `;
            if (node.children) {
                node.children.forEach(child => nodesSvg += drawNodes(child));
            }
            return nodesSvg;
        }
        svgContent += drawNodes(root);

        svgContent += '</svg>';
        return svgContent;
    },

    handleMindMapContextMenu(e, nodeId) {
        e.preventDefault();
        e.stopPropagation();

        this.activeContextNodeId = nodeId;

        const menu = document.getElementById('pptMindMapContextMenu');
        if (!menu) return;

        // Position menu
        const rect = this.elements.overlay.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;

        // Adjust if close to edge
        if (x + 150 > window.innerWidth) x -= 150;
        if (y + 120 > window.innerHeight) y -= 120;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.display = 'block';
    },

    triggerContextAction(action) {
        const menu = document.getElementById('pptMindMapContextMenu');
        if (menu) menu.style.display = 'none';

        if (!this.activeContextNodeId) return;

        if (action === 'edit') {
            // Find current text to prepopulate
            // We don't have easy access to text here without parsing again or passing it in.
            // For now, let's just trigger the click handler which does the prompt.
            // A better way would be to store the text in the node element dataset.
            const nodeEl = document.querySelector(`g[onclick*="${this.activeContextNodeId}"] text`);
            const currentText = nodeEl ? nodeEl.textContent : "";
            this.handleMindMapNodeClick(this.activeContextNodeId, currentText);
        } else if (action === 'add') {
            this.addMindMapChild(this.activeContextNodeId);
        } else if (action === 'delete') {
            this.deleteMindMapNode(this.activeContextNodeId);
        }
    },

    addMindMapChild(parentId) {
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;

        // Instant add without prompt for better UX
        const newText = "新节点";

        const lines = mdInput.value.split('\n');

        // If root, append h1 at end? No, root is virtual in this simple parser usually,
        // but here root is the title.
        // If parent is h-X (header), we append a list item after it or after its last list item.
        // If parent is s-X (sub item), we can't nest deeper in this simple 2-level model.

        if (parentId === 'root') {
            // Add new H1 at end
            lines.push(`\n# ${newText}`);
        } else if (parentId.startsWith('h-')) {
            const lineIndex = parseInt(parentId.split('-')[1]);
            // Find where the next header starts to insert before it, or end of file
            let insertIndex = lineIndex + 1;
            while (insertIndex < lines.length && !lines[insertIndex].trim().startsWith('#')) {
                insertIndex++;
            }
            lines.splice(insertIndex, 0, `- ${newText}`);
        } else {
            alert("暂不支持三级嵌套");
            return;
        }

        mdInput.value = lines.join('\n');
        this.updateMindMapPreview();
    },

    deleteMindMapNode(nodeId) {
        if (nodeId === 'root') {
            alert("不能删除根节点");
            return;
        }

        // Only confirm for headers (sections), delete sub-items instantly
        if (nodeId.startsWith('h-')) {
            if (!confirm("确定要删除此章节及其所有子项吗？")) return;
        }

        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;

        const lineIndex = parseInt(nodeId.split('-')[1]);
        const lines = mdInput.value.split('\n');

        if (nodeId.startsWith('s-')) {
            // Just remove the line
            lines.splice(lineIndex, 1);
        } else if (nodeId.startsWith('h-')) {
            // Remove header and its children (until next header)
            let count = 1;
            while (lineIndex + count < lines.length && !lines[lineIndex + count].trim().startsWith('#')) {
                count++;
            }
            lines.splice(lineIndex, count);
        }

        mdInput.value = lines.join('\n');
        this.updateMindMapPreview();
    },

    handleMindMapNodeClick(nodeId, currentText) {
        const newText = prompt("编辑节点内容:", currentText);
        if (newText !== null && newText !== currentText) {
            const mdInput = document.getElementById('pptOutlineMarkdownInput');
            if (!mdInput) return;

            // Simple regex replacement based on line index stored in ID
            // Note: This is a basic implementation. For robust syncing, we'd need a better data model.
            // Here we rely on the fact that we generated IDs based on line index.
            const lineIndex = parseInt(nodeId.split('-')[1]);
            const lines = mdInput.value.split('\n');

            if (lines[lineIndex]) {
                if (nodeId.startsWith('h-')) {
                    lines[lineIndex] = lines[lineIndex].replace(/^#+\s*.*/, `# ${newText}`);
                } else if (nodeId.startsWith('s-')) {
                    lines[lineIndex] = lines[lineIndex].replace(/^([-*])\s*.*/, `$1 ${newText}`);
                }
                mdInput.value = lines.join('\n');
                this.updateMindMapPreview(); // Refresh preview
            }
        }
    },

    addOutlineItem() {
        if (!this.workflowData.outline) this.workflowData.outline = [];
        this.workflowData.outline.push({ title: "新章节", subs: ["新子项"] });
        this.renderPreviewArea();
    },

    removeOutlineItem(index) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline.splice(index, 1);
        this.renderPreviewArea();
    },

    toggleOutlineEditMode() {
        const visualEditor = document.getElementById('pptOutlineVisualEditor');
        const mdEditor = document.getElementById('pptOutlineMarkdownEditor');
        const mdInput = document.getElementById('pptOutlineMarkdownInput');

        if (visualEditor && mdEditor) {
            if (mdEditor.classList.contains('hidden')) {
                // Switch to Markdown
                const mdText = this.workflowData.outline.map(item => {
                    return `# ${item.title}\n${item.subs.map(sub => `- ${sub}`).join('\n')}`;
                }).join('\n\n');

                mdInput.value = mdText;
                visualEditor.classList.add('hidden');
                mdEditor.classList.remove('hidden');
                mdEditor.style.display = 'flex';

                // Trigger preview update
                this.updateMindMapPreview();
            } else {
                // Switch to Visual (Cancel)
                mdEditor.classList.add('hidden');
                mdEditor.style.display = 'none';
                visualEditor.classList.remove('hidden');
            }
        }
    },

    saveMarkdownOutline() {
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;

        const text = mdInput.value;
        const lines = text.split('\n');
        const newOutline = [];
        let currentItem = null;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) {
                if (currentItem) newOutline.push(currentItem);
                currentItem = { title: trimmed.replace(/^#+\s*/, ''), subs: [] };
            } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                if (currentItem) {
                    currentItem.subs.push(trimmed.replace(/^[-*]\s*/, ''));
                }
            } else if (trimmed.length > 0 && currentItem) {
                 // Treat plain text as sub item if under a header
                 currentItem.subs.push(trimmed);
            }
        });
        if (currentItem) newOutline.push(currentItem);

        this.workflowData.outline = newOutline;
        this.renderPreviewArea();
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
};

Object.assign(PPTGenerator.prototype, PPTGeneratorAgentDashboard);
