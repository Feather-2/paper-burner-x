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


    _renderUploadSharedStyles() {
        return `
            <style>
                /* 父容器调整 - 确保可以绝对定位 */
                #pptPreviewArea {
                    position: relative;
                }
                /* Two-column Layout - 绝对定位与 chat 对齐 */
                /* chat: top:80px, header:64px, 所以 top = 80-64 = 16px */
                /* preview-area margin-right 到 chat 间距 = 16px，gap 统一 16px */
                .rd-layout {
                    position: absolute;
                    top: 16px;
                    bottom: 24px;
                    left: 24px;
                    right: 0; /* 紧贴 preview-area 右边界，由 preview-area margin-right 控制与 chat 间距 */
                    display: flex;
                    gap: 16px;
                    box-sizing: border-box;
                }
                /* chat 隐藏时 (ppt-preview-area.expanded)，居中且限制宽度 */
                .ppt-preview-area.expanded .rd-layout {
                    left: 50%;
                    right: auto;
                    width: min(1100px, calc(100% - 48px));
                    transform: translateX(-50%);
                }
                .rd-sidebar {
                    width: 280px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }
                .rd-sidebar-card {
                    background: rgba(255, 255, 255, 0.78);
                    backdrop-filter: blur(16px);
                    border: 1px solid rgba(255, 255, 255, 0.7);
                    border-radius: 18px;
                    padding: 20px;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    box-shadow:
                        0 4px 12px rgba(0, 0, 0, 0.04),
                        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
                    overflow: hidden;
                    min-height: 0;
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
                    font-size: 20px;
                    color: var(--ppt-primary);
                }
                .rd-sidebar-list {
                    flex: 1;
                    overflow-y: auto;
                    margin: 0 -8px;
                    padding: 0 8px 4px;
                    min-height: 0;
                }
                /* Custom Scrollbar */
                .rd-sidebar-list::-webkit-scrollbar {
                    width: 6px;
                }
                .rd-sidebar-list::-webkit-scrollbar-track {
                    background: transparent;
                }
                .rd-sidebar-list::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.12);
                    border-radius: 3px;
                }
                .rd-sidebar-list::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.2);
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
                    display: flex;
                    flex-direction: column;
                }
                /* Redesigned Card Container (rd-card) */
                .rd-card {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
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
                    grid-template-columns: repeat(4, 1fr);
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
                    border-radius: 16px;
                    background: rgba(255, 255, 255, 0.5);
                    padding: 48px 24px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    margin-bottom: 20px;
                    position: relative;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 180px;
                }
                .rd-dropzone:hover {
                    border-color: var(--ppt-primary);
                    background: var(--ppt-primary-subtle, rgba(79, 70, 229, 0.05));
                }
                .rd-dropzone-icon {
                    font-size: 56px;
                    color: var(--ppt-primary);
                    opacity: 0.8;
                    margin-bottom: 16px;
                }
                .rd-dropzone-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--ppt-text-main);
                    margin-bottom: 8px;
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
                .rd-form-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 16px;
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
                .rd-form-cell {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .rd-form-cell .rd-select {
                    width: 100%;
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
                                    <iconify-icon icon="${this._getFileIcon(f.type)}" class="rd-file-icon"></iconify-icon>
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
                                    <iconify-icon icon="carbon:paste"></iconify-icon>
                                </div>
                                <div class="rd-source-info">
                                    <h3>直接粘贴文档</h3>
                                    <p>粘贴 / 输入内容</p>
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
                            <div class="rd-form-grid">
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">报告长度</label>
                                    <select class="rd-select" onchange="window.PPTGenerator.updateReportLength(this.value)">
                                        <option value="brief" ${reportLength === 'brief' ? 'selected' : ''}>简要</option>
                                        <option value="standard" ${reportLength === 'standard' ? 'selected' : ''}>标准</option>
                                        <option value="detailed" ${reportLength === 'detailed' ? 'selected' : ''}>详细</option>
                                        <option value="comprehensive" ${reportLength === 'comprehensive' ? 'selected' : ''}>全面</option>
                                    </select>
                                </div>
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">写作风格</label>
                                    <select class="rd-select" onchange="window.PPTGenerator.updateWriteTone(this.value)">
                                        <option value="business" ${tone === 'business' ? 'selected' : ''}>商务专业</option>
                                        <option value="academic" ${tone === 'academic' ? 'selected' : ''}>学术严谨</option>
                                        <option value="casual" ${tone === 'casual' ? 'selected' : ''}>通俗易懂</option>
                                    </select>
                                </div>
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">目标受众</label>
                                    <select class="rd-select" onchange="window.PPTGenerator.updateWriteAudience(this.value)">
                                        <option value="general" ${audience === 'general' ? 'selected' : ''}>一般读者</option>
                                        <option value="expert" ${audience === 'expert' ? 'selected' : ''}>专业人士</option>
                                        <option value="executive" ${audience === 'executive' ? 'selected' : ''}>高管决策层</option>
                                    </select>
                                </div>
                                <div class="rd-form-cell">
                                    <label class="rd-form-label">输出语言</label>
                                    <select class="rd-select" onchange="window.PPTGenerator.updateWriteLanguage(this.value)">
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


    removeFile(index) {
        this.workflowData.files.splice(index, 1);
        this.renderPreviewArea();
    },

  });
})();
