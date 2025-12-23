(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.upload = NS.upload || {};
  Object.assign(NS.upload, {
    _goToUploadStep(step) {
        const nextStep = step === 2 ? 2 : 1;
        const files = Array.isArray(this.workflowData?.files) ? this.workflowData.files : [];
        if (nextStep === 2 && files.length === 0) return;
        this._uploadStep = nextStep;
        this.renderPreviewArea();
    },

    // ========== 生成模式管理 ==========
    setGenerationMode(mode) {
        if (!this.workflowData) this.workflowData = {};
        this.workflowData.generationMode = mode;
        this.renderPreviewArea();
    },

    getGenerationMode() {
        return this.workflowData?.generationMode || 'deepsearch';
    },

    _renderGenerationModeCard(key, title, desc, icon) {
        const currentMode = this.getGenerationMode();
        const selected = currentMode === key;
        return `
            <div class="rd-mode-card ${selected ? 'active' : ''}" data-action="setGenerationMode" data-mode="${key}">
                <div class="rd-mode-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
                <div class="rd-mode-title">${title}</div>
                <div class="rd-mode-desc">${desc}</div>
            </div>
        `;
    },

    _renderUploadSharedStyles() {
        return '';
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
                                    <iconify-icon icon="${this._getFileIcon(f.type)}" class="rd-file-icon"></iconify-icon>
                                    <div class="rd-file-info">
                                        <div class="rd-file-name" title="${this._escapeAttr(String(f?.name ?? ''))}">${this._escapeHtml(String(f?.name ?? ''))}</div>
                                        <div class="rd-file-meta">${this._escapeHtml(String(f?.size ?? ''))}</div>
                                    </div>
                                    <iconify-icon icon="solar:close-circle-linear" class="rd-file-remove" data-action="removeFile" data-index="${i}"></iconify-icon>
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

                        <div class="rd-dropzone" data-action="triggerFilePicker">
                            <iconify-icon icon="solar:cloud-upload-bold-duotone" class="rd-dropzone-icon"></iconify-icon>
                            <div class="rd-dropzone-title">点击或拖拽文件至此处</div>
                            <div class="rd-dropzone-hint">支持 PDF, DOCX, MD, TXT (最大 50MB)</div>
                            <input type="file" id="pptFileInput" style="display:none;" multiple data-action="handleFileUpload" data-event="change">
                        </div>

                        <div class="rd-upload-grid">
                            <button class="rd-source-btn" type="button" data-action="openHistorySelector">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="solar:history-bold-duotone"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>历史项目</h3>
                                    <p>从过往项目提取</p>
                                </div>
                            </button>
                            <button class="rd-source-btn" type="button" data-action="openUrlInput">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="solar:link-circle-bold-duotone"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>网页链接</h3>
                                    <p>解析 URL 内容</p>
                                </div>
                            </button>
                            <button class="rd-source-btn" type="button" data-action="openPasteDocumentModal">
                                <div class="rd-source-icon">
                                    <iconify-icon icon="carbon:paste"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>直接粘贴文档</h3>
                                    <p>粘贴 / 输入内容</p>
                                </div>
                            </button>
                            <button class="rd-source-btn" type="button" data-action="importPptxAsDeckFromPicker">
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
                            <button class="rd-btn rd-btn-primary" ${hasFiles ? 'data-action="setUploadStep" data-step="2"' : 'disabled'}>
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
        const modeCard = (key, title, desc, icon) => {
            const selected = mode === key;
            return `
                <div class="rd-mode-card ${selected ? 'active' : ''}" data-action="setWorkflowMode" data-mode="${key}">
                    <div class="rd-mode-icon"><iconify-icon icon="${icon}"></iconify-icon></div>
                    <div class="rd-mode-title">${title}</div>
                    <div class="rd-mode-desc">${desc}</div>
                </div>
            `;
        };

        const startAction = taskGoal ? 'startWorkflow' : 'openProjectBrief';

        return `
            ${this._renderUploadSharedStyles()}
            <div class="rd-layout">
                ${this._renderFileSidebar()}
                <div class="rd-main">
                    <div class="rd-card">
                        <div class="rd-header">
                            <h2 class="rd-title">生成配置</h2>
                            <p class="rd-subtitle">选择生成模式并调整参数</p>
                        </div>

                        <div class="rd-section-title">生成模式</div>
                        <div class="rd-mode-grid" style="margin-bottom: 20px;">
                            ${this._renderGenerationModeCard('simple', '快速生成', '直接通读素材，按结构生成页面', 'solar:bolt-bold-duotone')}
                            ${this._renderGenerationModeCard('planned', '规划模式', 'AI 扫描后，您来配置每页内容和参考资料', 'solar:clipboard-list-bold-duotone')}
                            ${this._renderGenerationModeCard('deepsearch', '深度研究', 'DeepSearch 深度分析、联网扩展信息', 'solar:magnifer-zoom-in-bold-duotone')}
                        </div>

                        <div class="rd-section-title">工作模式</div>
                        <div class="rd-mode-grid">
                            ${modeCard('auto', 'Auto-pilot', '全自动执行', 'solar:rocket-2-bold-duotone')}
                            ${modeCard('guided', 'Guided', '关键节点确认', 'solar:map-point-wave-bold-duotone')}
                            ${modeCard('manual', 'Manual', '每步确认', 'solar:slider-minimalistic-horizontal-bold-duotone')}
                        </div>

                        <div class="rd-section-title" style="margin-top: 24px;">报告参数</div>
                        <div class="rd-form-panel">
                            <div class="rd-form-grid">
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">报告长度</label>
                                    <select class="rd-select" data-action="updateReportLength" data-event="change">
                                        <option value="brief" ${reportLength === 'brief' ? 'selected' : ''}>简要</option>
                                        <option value="standard" ${reportLength === 'standard' ? 'selected' : ''}>标准</option>
                                        <option value="detailed" ${reportLength === 'detailed' ? 'selected' : ''}>详细</option>
                                        <option value="comprehensive" ${reportLength === 'comprehensive' ? 'selected' : ''}>全面</option>
                                    </select>
                                </div>
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">写作风格</label>
                                    <select class="rd-select" data-action="updateWriteTone" data-event="change">
                                        <option value="business" ${tone === 'business' ? 'selected' : ''}>商务专业</option>
                                        <option value="academic" ${tone === 'academic' ? 'selected' : ''}>学术严谨</option>
                                        <option value="casual" ${tone === 'casual' ? 'selected' : ''}>通俗易懂</option>
                                    </select>
                                </div>
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">目标受众</label>
                                    <select class="rd-select" data-action="updateWriteAudience" data-event="change">
                                        <option value="general" ${audience === 'general' ? 'selected' : ''}>一般读者</option>
                                        <option value="expert" ${audience === 'expert' ? 'selected' : ''}>专业人士</option>
                                        <option value="executive" ${audience === 'executive' ? 'selected' : ''}>高管决策层</option>
                                    </select>
                                </div>
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">输出语言</label>
                                    <select class="rd-select" data-action="updateWriteLanguage" data-event="change">
                                        <option value="auto" ${language === 'auto' ? 'selected' : ''}>自动检测</option>
                                        <option value="zh" ${language === 'zh' ? 'selected' : ''}>简体中文</option>
                                        <option value="en" ${language === 'en' ? 'selected' : ''}>English</option>
                                    </select>
                                </div>
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
                            <button class="rd-btn rd-btn-ghost" data-action="setUploadStep" data-step="1">
                                <iconify-icon icon="solar:arrow-left-linear"></iconify-icon> 返回
                            </button>
                            <button class="rd-btn rd-btn-ghost" data-action="openProjectBrief">
                                <iconify-icon icon="solar:pen-2-linear"></iconify-icon> 编辑需求
                            </button>
                            <button class="rd-btn rd-btn-primary" data-action="${startAction}">
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
                    <button class="ppt-btn-secondary" data-action="cancelProjectBrief">
                        <iconify-icon icon="carbon:arrow-left"></iconify-icon> 返回
                    </button>
                    <button class="ppt-btn-primary" data-action="submitProjectBrief">
                        保存并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },


    removeFile(index) {
        this.workflowData.files.splice(index, 1);
        this.renderPreviewArea();
    },

  });

  const getUploadActions = (ctx) => {
    return {
      triggerFilePicker: () => {
        document.getElementById('pptFileInput')?.click();
      },
      handleFileUpload: ({ target }) => {
        if (target?.files) ctx.handleFileUpload?.(target.files);
      },
      openHistorySelector: () => ctx.openHistorySelector?.(),
      openUrlInput: () => ctx.openUrlInput?.(),
      openPasteDocumentModal: () => ctx.openPasteDocumentModal?.(),
      importPptxAsDeckFromPicker: () => ctx.importPptxAsDeckFromPicker?.(),
      setUploadStep: ({ payload }) => ctx._goToUploadStep?.(payload.step),
      setGenerationMode: ({ payload }) => ctx.setGenerationMode?.(payload.mode),
      setWorkflowMode: ({ payload }) => ctx.setWorkflowMode?.(payload.mode),
      updateReportLength: ({ value }) => ctx.updateReportLength?.(value),
      updateWriteTone: ({ value }) => ctx.updateWriteTone?.(value),
      updateWriteAudience: ({ value }) => ctx.updateWriteAudience?.(value),
      updateWriteLanguage: ({ value }) => ctx.updateWriteLanguage?.(value),
      openProjectBrief: () => ctx.openProjectBriefForm?.(),
      startWorkflow: () => ctx.startMultiAgentWorkflow?.(),
      removeFile: ({ payload }) => ctx.removeFile?.(payload.index),
    };
  };

  const getBriefActions = (ctx) => {
    return {
      cancelProjectBrief: () => ctx.cancelProjectBrief?.(),
      submitProjectBrief: () => ctx.submitProjectBrief?.(),
    };
  };

  if (window.PPTFlowViews?.register) {
    window.PPTFlowViews.register('upload', {
      render: (ctx) => ctx._renderUploadView?.(),
      actions: getUploadActions,
    });
    window.PPTFlowViews.register('briefing', {
      render: (ctx) => ctx._renderProjectBriefForm?.(),
      actions: getBriefActions,
    });
  }
})();
