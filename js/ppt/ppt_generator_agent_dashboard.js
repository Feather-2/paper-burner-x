const PPTGeneratorAgentDashboard = {
    // ============================================================
    // Agent Dashboard Rendering
    // ============================================================

    renderPreviewArea() {
        const container = document.getElementById('pptPreviewArea');
        if (!container) return;

        this._syncWorkflowModeAndBriefFromData();
        const prevState = this._prevState;

        if (this.state === 'completed') {
            if (prevState === 'script_review' && typeof VditorAdapter !== 'undefined') VditorAdapter.destroy();
            this._prevState = this.state;
            this.renderPresentationMode(container);
            return;
        }

        // Determine what to show in the central visualization area based on state
        let visContent = '';

        if (this.state === 'idle') {
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
            // Default: Simplified Generation View
            visContent = `
                <div class="generation-container" style="background: transparent;">
                    <!-- Progress Stepper -->
                    <div class="gen-stepper">
                        ${this._renderStep('reading', '1', '阅读')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('researching', '2', '研究')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('script_review', '3', '脚本')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('page_layout', '4', '规划')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('designer', '5', '设计')}
                    </div>

                    <!-- Main Visualizer -->
                    <div class="gen-visualizer" style="background: white; border: 1px solid var(--ppt-border); box-shadow: var(--ppt-shadow-lg);">
                        <div class="gen-status-icon">
                            <iconify-icon icon="${this._getCurrentStatusIcon()}"></iconify-icon>
                        </div>
                        <h2 class="gen-title">${this._getCurrentStatusTitle()}</h2>
                        <p class="gen-subtitle">${this._getCurrentStatusDesc()}</p>

                        ${this.state === 'researching' ? this._renderDeepSearchVisualization({ compact: true }) : ''}

                        <!-- File List (Only show during reading) -->
                        <div id="fileProcessingGrid" class="gen-file-list" style="display: ${this.state === 'reading' ? 'flex' : 'none'}">
                            <!-- Dynamic File Nodes -->
                        </div>

                        <!-- Minimal Log Ticker -->
                        <div class="gen-log-ticker" id="agentTerminal">
                            <!-- Logs go here -->
                        </div>
                    </div>
                </div>
            `;
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

    _renderUploadView() {
        const files = this.workflowData.files || [];
        const hasFiles = files.length > 0;

        const mode = this.workflowMode || this.workflowData?.workflowMode || 'auto';
        const brief = this.workflowData?.projectBrief || this.projectBrief || {};
        const taskGoal = typeof brief.taskGoal === 'string' ? brief.taskGoal.trim() : '';
        const summary = typeof brief.projectSummary === 'string' ? brief.projectSummary.trim() : '';

        const modeCard = (key, title, desc) => {
            const selected = mode === key;
            const bg = selected ? 'rgba(79, 70, 229, 0.08)' : 'white';
            const border = selected ? '1px solid var(--ppt-primary)' : '1px solid var(--ppt-border)';
            const ring = selected ? '0 0 0 3px rgba(79, 70, 229, 0.12)' : 'none';
            return `
                <div
                    onclick="window.PPTGenerator.setWorkflowMode && window.PPTGenerator.setWorkflowMode('${key}')"
                    style="cursor:pointer; padding:14px 14px 12px; border-radius:14px; background:${bg}; border:${border}; box-shadow:${ring}; flex:1; min-width: 180px;"
                >
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:28px; height:28px; border-radius:10px; display:flex; align-items:center; justify-content:center; background: ${selected ? 'var(--ppt-primary)' : 'var(--ppt-bg-app)'}; color:${selected ? 'white' : 'var(--ppt-text-secondary)'};">
                            <iconify-icon icon="${key === 'auto' ? 'carbon:rocket' : key === 'guided' ? 'carbon:map' : 'carbon:cursor-1'}"></iconify-icon>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:650; color: var(--ppt-text);">${title}</div>
                            <div style="font-size:12px; color: var(--ppt-text-secondary); line-height:1.35; margin-top:2px;">${desc}</div>
                        </div>
                    </div>
                </div>
            `;
        };

        return `
            <div class="generation-container" style="background: transparent;">
                <!-- Workflow Mode -->
                <div style="width:100%; max-width: 860px; margin: 0 auto 16px;">
                    <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:10px;">
                        <div>
                            <div style="font-weight:700; color: var(--ppt-text); font-size: 14px;">选择工作模式</div>
                            <div style="color: var(--ppt-text-secondary); font-size: 12px; margin-top:2px;">Auto-pilot 自动流转；Guided/Manual 将在关键节点等待确认</div>
                        </div>
                        <button class="ppt-upload-btn" style="padding:8px 10px;" onclick="window.PPTGenerator.openProjectBriefForm && window.PPTGenerator.openProjectBriefForm()">
                            <iconify-icon icon="carbon:edit"></iconify-icon> 编辑需求
                        </button>
                    </div>
                    <div style="display:flex; gap:12px; flex-wrap:wrap;">
                        ${modeCard('auto', 'Auto-pilot', '默认自动推进，适合快速生成')}
                        ${modeCard('guided', 'Guided', '关键节点确认，适合可控迭代')}
                        ${modeCard('manual', 'Manual', '一步一确认，适合精细调参')}
                    </div>

                    <div style="margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: var(--ppt-bg-app); border: 1px solid var(--ppt-border);">
                        <div style="display:flex; align-items:center; gap:8px; color: var(--ppt-text-secondary); font-size: 12px;">
                            <iconify-icon icon="carbon:information"></iconify-icon>
                            <span>当前需求：${taskGoal ? this._escapeHtml(taskGoal) : '未填写（将无法开始 DeepSearch）'}</span>
                        </div>
                        ${summary ? `<div style="margin-top:8px; color: var(--ppt-text); font-size: 13px; line-height: 1.5;">${this._escapeHtml(summary)}</div>` : ''}
                    </div>
                </div>

                <div class="ppt-upload-zone" id="pptUploadZone" style="background: var(--ppt-bg-app); border: 2px dashed var(--ppt-primary-light);">
                    <iconify-icon icon="carbon:cloud-upload" class="ppt-upload-icon" style="color: var(--ppt-primary);"></iconify-icon>
                    <div class="ppt-upload-text">点击或拖拽上传文档</div>
                    <div class="ppt-upload-subtext">支持 PDF, DOCX, MD, TXT (最大 50MB)</div>
                    <input type="file" id="pptFileInput" class="ppt-file-input" multiple onchange="window.PPTGenerator.handleFileUpload(this.files)">
                </div>

                <div class="ppt-upload-actions">
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openHistorySelector()">
                        <iconify-icon icon="carbon:time"></iconify-icon> 从历史项目选择
                    </button>
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openUrlInput()">
                        <iconify-icon icon="carbon:link"></iconify-icon> 添加链接资源
                    </button>
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openPasteDocumentModal()">
                        <iconify-icon icon="carbon:paste"></iconify-icon> 直接粘贴文档
                    </button>
                </div>

                ${hasFiles ? `
                    <div class="ppt-upload-list">
                        ${files.map((f, i) => `
                            <div class="ppt-upload-item">
                                <iconify-icon icon="${f.type === 'history' ? 'carbon:time' : 'carbon:document'}" class="ppt-upload-item-icon"></iconify-icon>
                                <div class="ppt-upload-item-info">
                                    <div class="ppt-upload-item-name">${f.name}</div>
                                    <div class="ppt-upload-item-meta">${f.size || 'History Project'}</div>
                                </div>
                                <iconify-icon icon="carbon:close" class="ppt-upload-item-remove" onclick="window.PPTGenerator.removeFile(${i})"></iconify-icon>
                            </div>
                        `).join('')}
                    </div>
                    <button class="ppt-btn-primary" style="margin-top: 24px; width: 100%; max-width: 600px; justify-content: center; padding: 16px; font-size: 16px;" onclick="window.PPTGenerator.startMultiAgentWorkflow()">
                        <iconify-icon icon="${taskGoal ? 'carbon:rocket' : 'carbon:edit'}"></iconify-icon> ${taskGoal ? `开始分析 (${files.length} 个资源)` : '下一步：填写需求'}
                    </button>
                ` : `
                    <div style="margin-top: 24px; text-align: center; color: var(--ppt-text-secondary); font-size: 13px;">
                        <p>AI 将自动分析文档结构、提取关键信息并生成演示大纲</p>
                    </div>
                `}
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
        const viz = this.workflowData?.deepsearchViz && typeof this.workflowData.deepsearchViz === 'object' ? this.workflowData.deepsearchViz : {};
        const iteration = typeof viz.iteration === 'number' ? viz.iteration : 0;
        const maxIterations = typeof viz.maxIterations === 'number' ? viz.maxIterations : 1;
        const completedIteration = typeof viz.lastCompletedIteration === 'number' ? viz.lastCompletedIteration : null;

        const gaps = Array.isArray(viz.gaps) ? viz.gaps : [];
        const openCount = typeof viz.openGapCount === 'number'
            ? viz.openGapCount
            : gaps.filter(g => (g?.status ? String(g.status) : 'open') === 'open').length;

        const safeMax = Math.max(1, maxIterations);
        const pct = Math.max(0, Math.min(1, iteration / safeMax));

        const header = `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                    <div style="width:28px; height:28px; border-radius:10px; display:flex; align-items:center; justify-content:center; background: rgba(16, 185, 129, 0.12); color: var(--ppt-success);">
                        <iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon>
                    </div>
                    <div style="min-width:0;">
                        <div style="font-weight:650; color: var(--ppt-text);">DeepSearch 进度</div>
                        <div style="font-size:12px; color: var(--ppt-text-secondary); margin-top:2px;">
                            ${completedIteration !== null ? `已完成第 ${completedIteration + 1} 轮` : '运行中'} · open gaps: ${openCount}/${gaps.length || '—'}
                        </div>
                    </div>
                </div>
                <div style="font-size:12px; color: var(--ppt-text-secondary); white-space:nowrap;">迭代 ${iteration}/${safeMax}</div>
            </div>
        `;

        const progress = `
            <div style="height:10px; border-radius:999px; background: rgba(148, 163, 184, 0.25); overflow:hidden;">
                <div style="height:10px; width:${(pct * 100).toFixed(1)}%; background: linear-gradient(90deg, var(--ppt-primary), rgba(79, 70, 229, 0.55));"></div>
            </div>
        `;

        const gapRow = (g) => {
            const status = g?.status ? String(g.status) : 'open';
            const isOpen = status === 'open';
            const isBlocked = status === 'blocked' || Boolean(g?.blockedReason);
            const icon = isOpen ? 'carbon:circle-dash' : (isBlocked ? 'carbon:warning-alt' : 'carbon:checkmark-filled');
            const color = isOpen ? 'var(--ppt-text-secondary)' : (isBlocked ? 'var(--ppt-warning)' : 'var(--ppt-success)');
            const title = this._escapeHtml(String(g?.question || g?.gapId || 'gap'));
            const meta = [
                g?.gapId ? String(g.gapId) : null,
                g?.priority ? String(g.priority) : null,
                typeof g?.missCount === 'number' ? `miss:${g.missCount}` : null,
            ].filter(Boolean).join(' · ');

            return `
                <div style="display:flex; gap:10px; padding:10px 10px; border-radius:12px; border: 1px solid var(--ppt-border); background: white;">
                    <div style="margin-top:2px; color:${color};">
                        <iconify-icon icon="${icon}"></iconify-icon>
                    </div>
                    <div style="min-width:0;">
                        <div style="font-size:13px; color: var(--ppt-text); line-height:1.35;">${title}</div>
                        ${meta ? `<div style="margin-top:4px; font-size:12px; color: var(--ppt-text-secondary);">${this._escapeHtml(meta)}</div>` : ''}
                        ${isBlocked && g?.blockedReason ? `<div style="margin-top:6px; font-size:12px; color: var(--ppt-warning);">${this._escapeHtml(String(g.blockedReason))}</div>` : ''}
                    </div>
                </div>
            `;
        };

        const list = gaps.length ? gaps.map(gapRow).join('') : `
            <div style="padding: 12px; border-radius: 12px; border: 1px dashed var(--ppt-border); color: var(--ppt-text-secondary); font-size: 12px;">
                暂无 gaps 数据（等待 DeepSearch gaps 阶段输出）。
            </div>
        `;

        const wrapperStyle = compact
            ? 'margin-top: 14px; width: 100%; text-align:left;'
            : 'width: 100%; text-align:left;';

        return `
            <div style="${wrapperStyle}">
                <div style="padding: 12px 14px; border-radius: 14px; border: 1px solid var(--ppt-border); background: var(--ppt-bg-app);">
                    ${header}
                    ${progress}
                    <div style="margin-top: 12px;">
                        <div style="font-weight: 650; color: var(--ppt-text); font-size: 13px; margin-bottom: 8px;">Gaps</div>
                        <div style="display:flex; flex-direction:column; gap:10px;">
                            ${list}
                        </div>
                    </div>
                </div>
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
                        <span>确认后将使用 slideIntents 进行页面规划</span>
                    </div>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmScript()">
                        确认并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
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
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.phase5_DesignOptimization()">
                        继续设计 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
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
