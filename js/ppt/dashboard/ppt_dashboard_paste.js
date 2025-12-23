(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.paste = NS.paste || {};
  Object.assign(NS.paste, {
    /**
     * 打开大纲规划器 Modal
     * @param {Array} suggestedOutline - 建议的大纲结构
     */
    openOutlinePlanner(suggestedOutline) {
        const modalId = 'pptOutlinePlannerModal';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        // 存储大纲数据供后续使用
        this._plannerOutline = suggestedOutline || [];

        const renderSectionItem = (section, idx) => `
            <div class="ppt-planner-section" data-index="${idx}">
                <div class="ppt-planner-section-header">
                    <div class="ppt-planner-section-drag">
                        <iconify-icon icon="carbon:draggable"></iconify-icon>
                    </div>
                    <div class="ppt-planner-section-num">${idx + 1}</div>
                    <input type="text" class="ppt-planner-section-title" value="${this._escapeAttr(section.title)}" placeholder="章节标题">
                    <div class="ppt-planner-pages">
                        <label>页数:</label>
                        <input type="number" class="ppt-planner-page-count" value="${section.suggestedPages || 1}" min="1" max="10">
                    </div>
                    <button class="ppt-planner-section-delete" title="删除章节">
                        <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-planner-section-body">
                    <div class="ppt-planner-content-preview">${this._escapeHtml((section.content || '').slice(0, 200))}${(section.content || '').length > 200 ? '...' : ''}</div>
                    <div class="ppt-planner-files-zone" data-section="${idx}">
                        <div class="ppt-planner-files-label">
                            <iconify-icon icon="carbon:document-add"></iconify-icon>
                            拖入参考资料 (可选)
                        </div>
                        <div class="ppt-planner-files-list"></div>
                    </div>
                    <textarea class="ppt-planner-notes" placeholder="补充说明 (可选)...">${section.notes || ''}</textarea>
                </div>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'ppt-modal-overlay open';
        overlay.innerHTML = `
            <div class="ppt-modal ppt-planner-modal">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title">
                        <iconify-icon icon="carbon:list-checked"></iconify-icon>
                        大纲规划
                    </div>
                    <button class="ppt-modal-close" data-action="closeOutlinePlanner" aria-label="关闭">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-modal-body ppt-planner-body">
                    <div class="ppt-planner-info">
                        <iconify-icon icon="carbon:information"></iconify-icon>
                        AI 已识别以下章节结构。您可以调整每个章节的页数、添加参考资料，或修改内容后再生成。
                    </div>
                    <div class="ppt-planner-sections" id="pptPlannerSections">
                        ${this._plannerOutline.map(renderSectionItem).join('')}
                    </div>
                    <button class="ppt-planner-add-section" data-action="addPlannerSection">
                        <iconify-icon icon="carbon:add"></iconify-icon>
                        添加章节
                    </button>
                </div>
                <div class="ppt-modal-footer">
                    <div class="ppt-planner-summary">
                        共 <span id="pptPlannerTotalPages">${this._plannerOutline.reduce((sum, s) => sum + (s.suggestedPages || 1), 0)}</span> 页
                    </div>
                    <button class="ppt-btn-secondary" data-action="closeOutlinePlanner">取消</button>
                    <button class="ppt-btn-primary" data-action="confirmOutlinePlanner">
                        <iconify-icon icon="carbon:rocket"></iconify-icon>
                        开始生成
                    </button>
                </div>
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeOutlinePlanner();
        });

        const host = this.elements?.overlay || document.body;
        host.appendChild(overlay);

        if (window.PPTUIActions?.bindActions) {
            window.PPTUIActions.bindActions(overlay, {
                closeOutlinePlanner: () => this.closeOutlinePlanner(),
                addPlannerSection: () => this.addPlannerSection(),
                confirmOutlinePlanner: () => this.confirmOutlinePlanner(),
            });
        }

        // 绑定事件
        this._bindPlannerEvents();
    },

    _bindPlannerEvents() {
        const container = document.getElementById('pptPlannerSections');
        if (!container) return;

        // 页数变更事件
        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('ppt-planner-page-count')) {
                this._updatePlannerTotalPages();
            }
        });

        // 标题变更事件
        container.addEventListener('input', (e) => {
            if (e.target.classList.contains('ppt-planner-section-title')) {
                const section = e.target.closest('.ppt-planner-section');
                const idx = parseInt(section?.dataset.index, 10);
                if (!isNaN(idx) && this._plannerOutline[idx]) {
                    this._plannerOutline[idx].title = e.target.value;
                }
            }
            if (e.target.classList.contains('ppt-planner-notes')) {
                const section = e.target.closest('.ppt-planner-section');
                const idx = parseInt(section?.dataset.index, 10);
                if (!isNaN(idx) && this._plannerOutline[idx]) {
                    this._plannerOutline[idx].notes = e.target.value;
                }
            }
        });

        // 删除章节
        container.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.ppt-planner-section-delete');
            if (deleteBtn) {
                const section = deleteBtn.closest('.ppt-planner-section');
                const idx = parseInt(section?.dataset.index, 10);
                if (!isNaN(idx)) {
                    this.deletePlannerSection(idx);
                }
            }
        });

        // 文件拖放区域
        container.querySelectorAll('.ppt-planner-files-zone').forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const sectionIdx = parseInt(zone.dataset.section, 10);
                const files = Array.from(e.dataTransfer.files);
                this._addFilesToPlannerSection(sectionIdx, files);
            });
            zone.addEventListener('click', () => {
                const sectionIdx = parseInt(zone.dataset.section, 10);
                this._openFilePicker(sectionIdx);
            });
        });
    },

    _updatePlannerTotalPages() {
        const container = document.getElementById('pptPlannerSections');
        const totalEl = document.getElementById('pptPlannerTotalPages');
        if (!container || !totalEl) return;

        let total = 0;
        container.querySelectorAll('.ppt-planner-page-count').forEach(input => {
            total += parseInt(input.value, 10) || 1;
        });
        totalEl.textContent = total;
    },

    addPlannerSection() {
        const newSection = {
            id: `section_${Date.now()}`,
            title: `新章节`,
            suggestedPages: 1,
            content: '',
            sourceFiles: [],
            notes: ''
        };
        this._plannerOutline.push(newSection);
        this._rerenderPlannerSections();
    },

    deletePlannerSection(idx) {
        if (this._plannerOutline.length <= 1) {
            alert('至少保留一个章节');
            return;
        }
        this._plannerOutline.splice(idx, 1);
        this._rerenderPlannerSections();
    },

    _rerenderPlannerSections() {
        const container = document.getElementById('pptPlannerSections');
        if (!container) return;

        const renderSectionItem = (section, idx) => `
            <div class="ppt-planner-section" data-index="${idx}">
                <div class="ppt-planner-section-header">
                    <div class="ppt-planner-section-drag">
                        <iconify-icon icon="carbon:draggable"></iconify-icon>
                    </div>
                    <div class="ppt-planner-section-num">${idx + 1}</div>
                    <input type="text" class="ppt-planner-section-title" value="${this._escapeAttr(section.title)}" placeholder="章节标题">
                    <div class="ppt-planner-pages">
                        <label>页数:</label>
                        <input type="number" class="ppt-planner-page-count" value="${section.suggestedPages || 1}" min="1" max="10">
                    </div>
                    <button class="ppt-planner-section-delete" title="删除章节">
                        <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-planner-section-body">
                    <div class="ppt-planner-content-preview">${this._escapeHtml((section.content || '').slice(0, 200))}${(section.content || '').length > 200 ? '...' : ''}</div>
                    <div class="ppt-planner-files-zone" data-section="${idx}">
                        <div class="ppt-planner-files-label">
                            <iconify-icon icon="carbon:document-add"></iconify-icon>
                            拖入参考资料 (可选)
                        </div>
                        <div class="ppt-planner-files-list">${this._renderSectionFiles(section.sourceFiles)}</div>
                    </div>
                    <textarea class="ppt-planner-notes" placeholder="补充说明 (可选)...">${section.notes || ''}</textarea>
                </div>
            </div>
        `;

        container.innerHTML = this._plannerOutline.map(renderSectionItem).join('');
        this._bindPlannerEvents();
        this._updatePlannerTotalPages();
    },

    _renderSectionFiles(files) {
        if (!files || files.length === 0) return '';
        return files.map((f, i) => `
            <div class="ppt-planner-file-item">
                <iconify-icon icon="carbon:document"></iconify-icon>
                <span>${this._escapeHtml(f.name)}</span>
                <button class="ppt-planner-file-remove" data-file-idx="${i}">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
            </div>
        `).join('');
    },

    _addFilesToPlannerSection(sectionIdx, files) {
        if (!this._plannerOutline[sectionIdx]) return;
        if (!this._plannerOutline[sectionIdx].sourceFiles) {
            this._plannerOutline[sectionIdx].sourceFiles = [];
        }
        files.forEach(f => {
            this._plannerOutline[sectionIdx].sourceFiles.push({
                name: f.name,
                file: f,
                type: f.type
            });
        });
        this._rerenderPlannerSections();
    },

    _openFilePicker(sectionIdx) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.pdf,.docx,.txt,.md,.pptx,image/*';
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            this._addFilesToPlannerSection(sectionIdx, files);
        };
        input.click();
    },

    closeOutlinePlanner() {
        const modal = document.getElementById('pptOutlinePlannerModal');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => modal.remove(), 300);
        }
    },

    confirmOutlinePlanner() {
        // 收集最终配置
        const container = document.getElementById('pptPlannerSections');
        if (!container) return;

        const sections = [];
        container.querySelectorAll('.ppt-planner-section').forEach((el, idx) => {
            const title = el.querySelector('.ppt-planner-section-title')?.value || `章节 ${idx + 1}`;
            const pages = parseInt(el.querySelector('.ppt-planner-page-count')?.value, 10) || 1;
            const notes = el.querySelector('.ppt-planner-notes')?.value || '';
            const original = this._plannerOutline[idx] || {};

            sections.push({
                ...original,
                title,
                suggestedPages: pages,
                notes
            });
        });

        // 保存到 workflowData
        this.workflowData.plannedOutline = sections;
        this.workflowData._mode = 'planned';

        this.closeOutlinePlanner();

        // 开始批量生成
        if (typeof this._executePlannedGeneration === 'function') {
            this._executePlannedGeneration(sections);
        } else {
            this.addChatMessage?.('ai', '大纲已确认，正在启动批量生成...');
            this._startPlannedBatchGeneration(sections);
        }
    },

    async _startPlannedBatchGeneration(sections) {
        if (typeof this.logTerminal === 'function') {
            this.logTerminal('系统', `开始按大纲生成 ${sections.length} 个章节...`, 'normal');
        }

        // 构建 slideIntents
        const slideIntents = [];
        let slideIndex = 0;

        for (const section of sections) {
            const pageCount = section.suggestedPages || 1;
            for (let p = 0; p < pageCount; p++) {
                slideIntents.push({
                    slideIntentId: `planned_${section.id}_p${p}`,
                    index: slideIndex++,
                    pageType: slideIndex === 1 ? 'cover' : 'content',
                    title: pageCount > 1 ? `${section.title} (${p + 1}/${pageCount})` : section.title,
                    content: section.content || '',
                    keyPoints: [],
                    objective: section.notes || '',
                    sourceFiles: section.sourceFiles || [],
                    claimIds: [],
                    dataTableIds: []
                });
            }
        }

        // 更新 workflowData
        if (!this.workflowData.contentPackage) {
            this.workflowData.contentPackage = { schemaVersion: '0.1' };
        }
        this.workflowData.contentPackage.slideIntents = slideIntents;
        this.workflowData.slideIntents = slideIntents;

        // 调用设计引擎
        try {
            await this._ensureRuntime?.({ mode: 'textprep' });
            window.transitionWorkflow(this, window.WorkflowState.DESIGNER);
            this.renderPreviewArea?.();

            await this._orchestrator?.runStage?.('design.batch', {
                contentPackage: this.workflowData.contentPackage
            });

            window.transitionWorkflow(this, window.WorkflowState.COMPLETED);
            this.renderPreviewArea?.();
            this.addChatMessage?.('ai', `已完成 ${slideIntents.length} 页幻灯片的生成。`);
        } catch (err) {
            console.error('[PlannedGeneration] Error:', err);
            this.addChatMessage?.('ai', `生成出错: ${err.message}`);
            window.forceWorkflowState(this, window.WorkflowState.IDLE);
            this.renderPreviewArea?.();
        }
    },

    _escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    _escapeAttr(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    openPasteDocumentModal() {
        const modalId = 'pptPasteDocumentModal';
        const existing = document.getElementById(modalId);
        const bindPasteActions = (modal) => {
            if (!modal || modal.dataset.actionsBound === '1') return;
            if (!window.PPTUIActions?.bindActions) return;
            modal.dataset.actionsBound = '1';
            window.PPTUIActions.bindActions(modal, {
                closePasteDocumentModal: () => this.closePasteDocumentModal(),
                confirmPasteDocument: () => this.confirmPasteDocument(),
            });
        };
        if (existing) {
            existing.classList.add('open');
            bindPasteActions(existing);
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'ppt-modal-overlay open';
        overlay.innerHTML = `
            <div class="ppt-modal" style="width: min(800px, 90vw); max-height: 80vh; display: flex; flex-direction: column;">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title">
                        <iconify-icon icon="carbon:paste"></iconify-icon>
                        粘贴文档内容
                    </div>
                    <button class="ppt-modal-close" data-action="closePasteDocumentModal" aria-label="关闭">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-modal-body" style="flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px;">
                    <div class="ppt-paste-hint" style="display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--ppt-primary-subtle, #eef2ff); border-radius: 8px; font-size: 13px; color: var(--ppt-text-secondary, #64748b);">
                        <iconify-icon icon="carbon:information" style="font-size: 16px; color: var(--ppt-primary, #4f46e5);"></iconify-icon>
                        粘贴 Markdown 或纯文本，将作为素材添加到文件列表。可多次粘贴。
                    </div>
                    <!-- 标题输入 -->
                    <div style="flex-shrink: 0;">
                        <input type="text" id="pasteDocumentTitle" class="ppt-input-field" style="width: 100%; padding: 10px 14px; font-size: 14px;" placeholder="文档标题（可选，留空将自动提取）">
                    </div>
                    <!-- 编辑器 -->
                    <div style="flex: 1; min-height: 0;">
                        <div id="pasteDocumentEditor" style="min-height: 280px; height: 100%;"></div>
                        <div id="pasteDocumentFallback" style="display: none;">
                            <textarea id="pasteDocumentTextarea" class="ppt-input-field" style="width: 100%; min-height: 280px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;" placeholder="在此粘贴 Markdown/纯文本内容..."></textarea>
                        </div>
                    </div>
                </div>
                <div class="ppt-modal-footer">
                    <button class="ppt-btn-secondary" data-action="closePasteDocumentModal">取消</button>
                    <button class="ppt-btn-primary" data-action="confirmPasteDocument">
                        <iconify-icon icon="carbon:add"></iconify-icon> 添加到素材
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
        bindPasteActions(overlay);

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

        if (!content || !content.trim()) {
            alert('请输入文档内容');
            return;
        }

        // 获取用户输入的标题，或自动提取
        let title = document.getElementById('pasteDocumentTitle')?.value?.trim();
        if (!title) {
            // 自动提取标题：优先取第一个 # 标题，否则取前50字
            const match = content.match(/^#\s+(.+)/m);
            title = match ? match[1].trim() : content.slice(0, 50).split('\n')[0].trim();
            if (!title) title = '粘贴文档';
        }

        // 添加到 workflowData.files
        if (!this.workflowData) this.workflowData = {};
        if (!this.workflowData.files) this.workflowData.files = [];

        const pasteItem = {
            name: title,
            size: this._formatSize ? this._formatSize(content.length) : `${content.length} 字符`,
            rawSize: content.length,
            mimeType: 'text/markdown',
            type: 'paste',
            content: content,
            timestamp: Date.now()
        };

        this.workflowData.files.push(pasteItem);

        if (typeof this.startFromPastedText === 'function') {
            this.startFromPastedText(content);
        }

        this.closePasteDocumentModal();

        // 刷新界面显示
        if (typeof this.renderPreviewArea === 'function') {
            this.renderPreviewArea();
        }

        // 提示用户
        if (typeof this.addChatMessage === 'function') {
            this.addChatMessage('ai', `已添加文档「${title}」到素材列表。您可以继续添加更多素材，或进入下一步配置。`);
        }
    },
  });
})();
