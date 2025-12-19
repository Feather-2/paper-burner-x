(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.pageLayout = NS.pageLayout || {};
  Object.assign(NS.pageLayout, {
    _renderPageLayoutReview() {
        const hasBrainstorm = this._hasBrainstormCandidates?.() || false;
        const maxTab = hasBrainstorm ? 3 : 2;
        let activeTab = Number.isInteger(this._pageLayoutTab) ? this._pageLayoutTab : 2;
        activeTab = Math.max(0, Math.min(maxTab, Math.floor(activeTab)));
        if (this._pageLayoutTab !== activeTab) this._pageLayoutTab = activeTab;
        return `
            <div class="ppt-question-form page-layout">
                <div class="ppt-page-layout-editor">
                    <div class="ppt-page-layout-tabs">
                        <div class="ppt-page-layout-tab ${activeTab === 0 ? 'active' : ''}" onclick="window.PPTGenerator._setPageLayoutTab(0)">
                            <iconify-icon icon="carbon:list"></iconify-icon> 页面规划
                        </div>
                        <div class="ppt-page-layout-tab ${activeTab === 1 ? 'active' : ''}" onclick="window.PPTGenerator._setPageLayoutTab(1)">
                            <iconify-icon icon="carbon:edit"></iconify-icon> 页面详情
                        </div>
                        <div class="ppt-page-layout-tab ${activeTab === 2 ? 'active' : ''}" onclick="window.PPTGenerator._setPageLayoutTab(2)">
                            <iconify-icon icon="carbon:color-palette"></iconify-icon> 设计规范
                        </div>
                        ${hasBrainstorm ? `
                            <div class="ppt-page-layout-tab ${activeTab === 3 ? 'active' : ''}" onclick="window.PPTGenerator._setPageLayoutTab(3)">
                                <iconify-icon icon="carbon:idea"></iconify-icon> 创意候选
                            </div>
                        ` : ''}
                    </div>
                    <div class="ppt-page-layout-content custom-scrollbar">
                        ${activeTab === 0 ? this._renderPagePlanTab() :
                          activeTab === 1 ? this._renderPageDetailTab() :
                          activeTab === 3 ? this._renderBrainstormCandidatesPanel() :
                          this._renderDesignSpecView()}
                    </div>
                    <div class="ppt-page-layout-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator._backToScriptReview()">
                            <iconify-icon icon="carbon:arrow-left"></iconify-icon> 返回脚本
                        </button>
                        <button class="ppt-btn-primary" onclick="window.PPTGenerator.phase5_DesignOptimization()">
                            继续设计 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                        </button>
                    </div>
                </div>
            </div>
        `;
    },


    _setPageLayoutTab(index) {
        const i = Number(index);
        if (!Number.isFinite(i)) return;
        const maxTab = this._hasBrainstormCandidates?.() ? 3 : 2;
        this._pageLayoutTab = Math.max(0, Math.min(maxTab, Math.floor(i)));
        this.renderPreviewArea?.();
    },

    _hasBrainstormCandidates() {
        const bc = this.workflowData?.brainstormCandidates;
        return Array.isArray(bc?.candidatesBySlide) && bc.candidatesBySlide.length > 0;
    },

    _selectBrainstormCandidateFromUI(slideIntentId, candidateId) {
        try {
            const ok = this.selectBrainstormCandidate?.(slideIntentId, candidateId);
            if (!ok) this.addChatMessage?.('ai', '选择失败：候选数据不存在或已过期。');
            this.renderPreviewArea?.();
            return !!ok;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.addChatMessage?.('ai', `选择失败：${msg}`);
            return false;
        }
    },

    async _regenerateBrainstormForSlideFromUI(slideIntentId) {
        const id = String(slideIntentId || '');
        if (!id) return false;
        if (!this._brainstormRegenInProgress || typeof this._brainstormRegenInProgress !== 'object') {
            this._brainstormRegenInProgress = Object.create(null);
        }
        if (this._brainstormRegenInProgress[id]) return false;
        this._brainstormRegenInProgress[id] = true;
        this.renderPreviewArea?.();
        let ok = false;
        try {
            await this.regenerateBrainstormForSlide?.(id, { keepOthers: true });
            ok = true;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.addChatMessage?.('ai', `Regenerate 失败：${msg}`);
        } finally {
            delete this._brainstormRegenInProgress[id];
            this.renderPreviewArea?.();
        }
        return ok;
    },

    _renderBrainstormCandidatesPanel() {
        const bc = this.workflowData?.brainstormCandidates;
        const rows = Array.isArray(bc?.candidatesBySlide) ? bc.candidatesBySlide : [];

        if (!rows.length) {
            return `
                <div class="brainstorm-candidates-panel">
                    <div class="brainstorm-empty">
                        暂无创意候选。请先运行设计阶段以生成 brainstormCandidates。
                    </div>
                </div>
            `;
        }

        const esc = (v) => (typeof this._escapeHtml === 'function' ? this._escapeHtml(v) : String(v ?? ''));
        const attr = (v) => (typeof this._escapeAttr === 'function' ? this._escapeAttr(v) : String(v ?? ''));

        const pkg = this.workflowData?.contentPackage;
        const slideIntents = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents : [];
        const slideMetaById = new Map(
            slideIntents.map((s, i) => {
                const id = String(s?.slideIntentId || '');
                const idx = Number.isFinite(Number(s?.index)) ? Number(s.index) : i;
                const title = typeof s?.title === 'string' && s.title.trim() ? s.title.trim() : `第 ${idx + 1} 页`;
                return [id, { idx, title }];
            })
        );

        const orderKey = (r) => {
            const id = String(r?.slideIntentId || '');
            const meta = slideMetaById.get(id);
            const idx = meta?.idx;
            if (Number.isFinite(idx)) return idx;
            return Number.isFinite(r?.slideIndex) ? r.slideIndex : 9999;
        };

        const sortedRows = [...rows].sort((a, b) => orderKey(a) - orderKey(b));

        const summarize = (candidate) => {
            const md = typeof candidate?.elementsMarkdown === 'string' ? candidate.elementsMarkdown : '';
            const lines = md
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => l.replace(/^\s*[-*]\s+/, '• '))
                .map((l) => l.replace(/\{\{(IMAGE|SVG|ASSET):[^}]+\}\}/g, '〔占位符〕'));
            return lines.slice(0, 3).join('\n');
        };

        const formatScore = (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return '';
            return `${Math.round(n * 100)}%`;
        };

        const renderCandidateCard = (slideIntentId, c, idxInSlide, selectedCandidateId) => {
            const candidateId = String(c?.candidateId || '');
            const isSelected = (String(selectedCandidateId || '') && candidateId === String(selectedCandidateId || '')) || !!c?.selected;
            const mood = typeof c?.atmosphere?.mood === 'string' ? c.atmosphere.mood : '';
            const title = `方案 ${String.fromCharCode(65 + Math.max(0, Math.min(25, idxInSlide)))}${mood ? ` · ${mood}` : ''}`;
            const summary = summarize(c);
            const composite = formatScore(c?.composite);

            return `
                <div class="brainstorm-card ${isSelected ? 'selected' : ''}"
                    data-slide-intent-id="${attr(slideIntentId)}" data-candidate-id="${attr(candidateId)}"
                    onclick="window.PPTGenerator._selectBrainstormCandidateFromUI(${JSON.stringify(slideIntentId)}, ${JSON.stringify(candidateId)})">
                    <div class="brainstorm-card-title">${esc(title)}</div>
                    ${composite ? `<div class="brainstorm-card-meta">综合得分：${esc(composite)}</div>` : ''}
                    ${summary ? `<pre class="brainstorm-card-summary">${esc(summary)}</pre>` : `<div class="brainstorm-card-summary muted">（暂无摘要）</div>`}
                    <div class="brainstorm-card-actions">
                        <button class="ppt-btn-secondary" type="button" ${isSelected ? 'disabled' : ''}
                            onclick="event.stopPropagation(); window.PPTGenerator._selectBrainstormCandidateFromUI(${JSON.stringify(slideIntentId)}, ${JSON.stringify(candidateId)})">
                            ${isSelected ? '已选择' : '选择'}
                        </button>
                    </div>
                </div>
            `;
        };

        const renderSlideGroup = (row) => {
            const slideIntentId = String(row?.slideIntentId || '');
            if (!slideIntentId) return '';
            const meta = slideMetaById.get(slideIntentId) || null;
            const title = meta?.title || slideIntentId;
            const idx = Number.isFinite(meta?.idx) ? meta.idx : (Number.isFinite(row?.slideIndex) ? row.slideIndex : undefined);
            const label = idx !== undefined ? `${idx + 1}. ${title}` : title;

            const candidates = Array.isArray(row?.candidates) ? row.candidates : [];
            const selectedCandidateId = row?.selectedCandidateId || row?.selectedCandidate?.candidateId || '';

            const regenBusy = !!this._brainstormRegenInProgress?.[slideIntentId];

            return `
                <div class="brainstorm-slide-group" data-slide-intent-id="${attr(slideIntentId)}">
                    <div class="brainstorm-slide-group-header">
                        <div class="brainstorm-slide-title">${esc(label)}</div>
                        <button class="ppt-btn-secondary" type="button" ${regenBusy ? 'disabled' : ''}
                            onclick="window.PPTGenerator._regenerateBrainstormForSlideFromUI(${JSON.stringify(slideIntentId)})">
                            <iconify-icon icon="carbon:renew"></iconify-icon> ${regenBusy ? 'Regenerating...' : 'Regenerate'}
                        </button>
                    </div>
                    <div class="brainstorm-card-grid">
                        ${candidates.map((c, i) => renderCandidateCard(slideIntentId, c, i, selectedCandidateId)).join('')}
                    </div>
                </div>
            `;
        };

        return `
            <div class="brainstorm-candidates-panel">
                <div class="brainstorm-panel-header">
                    <div class="brainstorm-panel-title">
                        <iconify-icon icon="carbon:idea"></iconify-icon>
                        <span>Brainstorm 候选（${sortedRows.length} 页）</span>
                    </div>
                    <div class="brainstorm-panel-subtitle">每页 2-3 个候选方案，点击卡片或「选择」进行保存</div>
                </div>
                <div class="brainstorm-slide-groups">
                    ${sortedRows.map(renderSlideGroup).join('')}
                </div>
            </div>
        `;
    },


    _backToScriptReview() {
        window.transitionWorkflow(this, window.WorkflowState.SCRIPT_REVIEW);
        this.renderPreviewArea?.();
    },


    _getEditableContentPackage() {
        if (!this.workflowData || typeof this.workflowData !== 'object') this.workflowData = {};
        if (!this.workflowData.contentPackage || typeof this.workflowData.contentPackage !== 'object') {
            this.workflowData.contentPackage = { slideIntents: [], claims: [] };
        }
        const pkg = this.workflowData.contentPackage;
        if (!Array.isArray(pkg.slideIntents)) pkg.slideIntents = [];
        try { this._ensureSlideIntentIds?.(pkg); } catch { /* ignore */ }
        return pkg;
    },


    _renderPagePlanTab() {
        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const selectedId = String(this._selectedSlideIntentId || '');

        const renderCard = (s, i) => {
            const id = String(s?.slideIntentId || '');
            const title = this._escapeHtml(s?.title || '未命名页面');
            const pageType = this._escapeHtml(s?.pageType || 'overview');
            const keyPoints = Array.isArray(s?.keyPoints) ? s.keyPoints : [];
            const keyPointsPreview = keyPoints.slice(0, 3).map((k) => `<div>• ${this._escapeHtml(k)}</div>`).join('');
            const isSelected = selectedId && id === selectedId;

            return `
                <div class="slide-intent-card ${isSelected ? 'selected' : ''}" data-slide-intent-id="${this._escapeAttr(id)}">
                    <div style="display:flex; align-items:flex-start; gap:12px;">
                        <div draggable="true" title="拖拽排序" style="padding: 6px 6px; border-radius: 10px; cursor: grab; color: var(--ppt-text-secondary);">
                            <iconify-icon icon="carbon:draggable"></iconify-icon>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                                <div style="font-weight: 800; color: var(--ppt-text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    ${i + 1}. ${title}
                                </div>
                                <span style="flex-shrink:0; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid var(--ppt-border); color: var(--ppt-text-secondary); background: var(--ppt-surface);">
                                    ${pageType}
                                </span>
                            </div>
                            ${keyPointsPreview ? `<div style="margin-top: 8px; color: var(--ppt-text-secondary); font-size: 13px; line-height: 1.5;">${keyPointsPreview}</div>` : `<div style="margin-top: 8px; color: var(--ppt-text-muted); font-size: 13px;">（暂无要点）</div>`}
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <button class="ppt-icon-btn" title="编辑" onclick="window.PPTGenerator._selectSlideIntent(${JSON.stringify(id)})">
                                <iconify-icon icon="carbon:edit"></iconify-icon>
                            </button>
                            <button class="ppt-icon-btn" title="复制" onclick="window.PPTGenerator.duplicateSlideIntent(${JSON.stringify(id)})">
                                <iconify-icon icon="carbon:copy"></iconify-icon>
                            </button>
                            <button class="ppt-icon-btn" title="删除" onclick="window.PPTGenerator.deleteSlideIntent(${JSON.stringify(id)})">
                                <iconify-icon icon="carbon:trash-can"></iconify-icon>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        };

        return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 12px;">
                <div style="font-weight: 900; color: var(--ppt-text-main); display:flex; align-items:center; gap:10px;">
                    <iconify-icon icon="carbon:layout"></iconify-icon>
                    <span>SlideIntents（${slides.length}）</span>
                </div>
                <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addSlideIntent()">
                    <iconify-icon icon="carbon:add"></iconify-icon> 添加页面
                </button>
            </div>
            ${slides.length ? `
                <div id="pptSlideIntentList" style="display:flex; flex-direction:column; gap:12px;">
                    ${slides.map(renderCard).join('')}
                </div>
            ` : `
                <div style="padding: 14px; border: 1px dashed var(--ppt-border); border-radius: var(--ppt-radius-lg); background: var(--ppt-surface); color: var(--ppt-text-secondary);">
                    暂无页面规划。点击右上角「添加页面」开始编辑。
                </div>
            `}
        `;
    },


    addSlideIntent(position) {
        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const insertIndex = Number.isFinite(Number(position)) ? Number(position) : slides.length;

        const ok = typeof this._insertSlideIntentAt === 'function'
            ? this._insertSlideIntentAt(pkg, insertIndex)
            : false;
        if (!ok) return;

        this.workflowData.slideIntents = pkg.slideIntents;
        this._selectedSlideIntentId = String(pkg.slideIntents[Math.max(0, Math.min(pkg.slideIntents.length - 1, insertIndex))]?.slideIntentId || '');
        this.renderPreviewArea?.();
    },


    deleteSlideIntent(slideIntentId) {
        const id = String(slideIntentId || '');
        if (!id) return;
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            const ok = window.confirm('确认删除该页面？此操作不可撤销。');
            if (!ok) return;
        }

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
        if (idx < 0) return;

        slides.splice(idx, 1);
        slides.forEach((s, i) => {
            if (s && typeof s === 'object') s.index = i;
        });
        this.workflowData.slideIntents = slides;

        if (String(this._selectedSlideIntentId || '') === id) {
            const next = slides[idx] || slides[idx - 1] || null;
            this._selectedSlideIntentId = next?.slideIntentId ? String(next.slideIntentId) : '';
        }
        this.renderPreviewArea?.();
    },


    duplicateSlideIntent(slideIntentId) {
        const id = String(slideIntentId || '');
        if (!id) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
        if (idx < 0) return;

        const src = slides[idx] && typeof slides[idx] === 'object' ? slides[idx] : null;
        if (!src) return;

        let clone = null;
        try {
            clone = JSON.parse(JSON.stringify(src));
        } catch {
            clone = { ...src };
        }
        clone.slideIntentId = `si_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        clone.title = `${String(src.title || '新页面')}（副本）`;

        slides.splice(idx + 1, 0, clone);
        slides.forEach((s, i) => {
            if (s && typeof s === 'object') s.index = i;
        });
        this.workflowData.slideIntents = slides;
        this.renderPreviewArea?.();
    },


    _setupSlideIntentDrag() {
        const container = document.getElementById('pptSlideIntentList');
        if (!container) return;
        if (container.dataset.dndBound === '1') return;
        container.dataset.dndBound = '1';

        let dragging = null;

        const clearIndicators = () => {
            container.querySelectorAll('.drag-above, .drag-below').forEach((el) => {
                el.classList.remove('drag-above', 'drag-below');
            });
        };

        container.addEventListener('dragstart', (e) => {
            const handle = e.target?.closest?.('[draggable="true"]');
            if (!handle) return;
            const item = e.target?.closest?.('.slide-intent-card');
            if (!item) return;
            dragging = item;
            item.classList.add('dragging');
            const sid = item.getAttribute('data-slide-intent-id') || '';
            e.dataTransfer?.setData?.('text/plain', sid);
            e.dataTransfer?.setDragImage?.(item, 12, 12);
        });

        container.addEventListener('dragend', () => {
            if (dragging) dragging.classList.remove('dragging');
            dragging = null;
            clearIndicators();
            this._commitSlideIntentOrder?.();
        });

        container.addEventListener('dragover', (e) => {
            if (!dragging) return;
            e.preventDefault();

            const target = e.target?.closest?.('.slide-intent-card');
            if (!target || target === dragging) return;

            const rect = target.getBoundingClientRect();
            const before = e.clientY < rect.top + rect.height / 2;

            clearIndicators();
            target.classList.add(before ? 'drag-above' : 'drag-below');

            if (before) {
                container.insertBefore(dragging, target);
            } else {
                container.insertBefore(dragging, target.nextSibling);
            }
        });

        container.addEventListener('drop', (e) => {
            if (!dragging) return;
            e.preventDefault();
            clearIndicators();
        });
    },


    _commitSlideIntentOrder() {
        const container = document.getElementById('pptSlideIntentList');
        if (!container) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        if (slides.length <= 1) return;

        const ids = Array.from(container.querySelectorAll('.slide-intent-card'))
            .map((el) => String(el.getAttribute('data-slide-intent-id') || ''))
            .filter(Boolean);
        if (!ids.length) return;

        const map = new Map(slides.map((s) => [String(s?.slideIntentId || ''), s]));
        const next = [];
        ids.forEach((id) => {
            const si = map.get(id);
            if (!si) return;
            next.push(si);
            map.delete(id);
        });
        for (const si of map.values()) next.push(si);

        pkg.slideIntents = next;
        next.forEach((s, i) => {
            if (s && typeof s === 'object') s.index = i;
        });
        this.workflowData.slideIntents = pkg.slideIntents;
        this.renderPreviewArea?.();
    },


    _selectSlideIntent(slideIntentId) {
        this._selectedSlideIntentId = String(slideIntentId || '');
        this._pageLayoutTab = 1;
        this.renderPreviewArea?.();
    },


    _renderPageDetailTab() {
        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const id = String(this._selectedSlideIntentId || '');
        const si = id ? slides.find((s) => String(s?.slideIntentId || '') === id) : null;

        if (!si) {
            return `
                <div style="padding: 14px; border: 1px dashed var(--ppt-border); border-radius: var(--ppt-radius-lg); background: var(--ppt-surface); color: var(--ppt-text-secondary); line-height: 1.6;">
                    未选择页面。请在「页面规划」中点击某个页面的编辑按钮进入详情编辑。
                </div>
            `;
        }

        const allowedTypes = ['cover', 'agenda', 'overview', 'comparison', 'process', 'summary', 'appendix'];
        const currentType = typeof si.pageType === 'string' && si.pageType.trim() ? si.pageType.trim() : 'overview';
        const typeOptions = (allowedTypes.includes(currentType) ? allowedTypes : [currentType, ...allowedTypes])
            .filter((v, i, arr) => arr.indexOf(v) === i);

        const title = this._escapeAttr(si.title || '');
        const objective = this._escapeHtml(si.objective || '');
        const keyPoints = Array.isArray(si.keyPoints) ? si.keyPoints : [];
        const claimIds = Array.isArray(si.claimIds) ? si.claimIds : [];

        const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
        const prevId = idx > 0 ? String(slides[idx - 1]?.slideIntentId || '') : '';
        const nextId = idx >= 0 && idx < slides.length - 1 ? String(slides[idx + 1]?.slideIntentId || '') : '';

        return `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div>
                    <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">标题</div>
                    <input class="ppt-input-field" type="text" value="${title}"
                        oninput="window.PPTGenerator.updateSlideIntent(${JSON.stringify(id)}, { title: this.value })">
                </div>

                <div>
                    <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">页面类型</div>
                    <select class="ppt-input-field" onchange="window.PPTGenerator.updateSlideIntent(${JSON.stringify(id)}, { pageType: this.value })">
                        ${typeOptions.map((t) => `<option value="${this._escapeAttr(t)}" ${t === currentType ? 'selected' : ''}>${this._escapeHtml(t)}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">目标说明</div>
                    <textarea class="ppt-input-field" rows="4" style="line-height: 1.5;"
                        oninput="window.PPTGenerator.updateSlideIntent(${JSON.stringify(id)}, { objective: this.value })">${objective}</textarea>
                </div>

                <div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 8px;">
                        <div style="font-size: 13px; font-weight: 800; color: var(--ppt-text-main);">要点（KeyPoints）</div>
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addSlideIntentKeyPoint(${JSON.stringify(id)})">
                            <iconify-icon icon="carbon:add"></iconify-icon> 添加要点
                        </button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${keyPoints.length ? keyPoints.map((kp, i) => `
                            <div style="display:flex; gap:8px; align-items:center;">
                                <input class="ppt-input-field" type="text" style="flex:1;" value="${this._escapeAttr(kp || '')}"
                                    oninput="window.PPTGenerator.updateSlideIntentKeyPoint(${JSON.stringify(id)}, ${i}, this.value)">
                                <button class="ppt-icon-btn" title="删除要点" onclick="window.PPTGenerator.removeSlideIntentKeyPoint(${JSON.stringify(id)}, ${i})">
                                    <iconify-icon icon="carbon:close"></iconify-icon>
                                </button>
                            </div>
                        `).join('') : `<div style="color: var(--ppt-text-muted); font-size: 13px;">暂无要点，可点击右上角添加。</div>`}
                    </div>
                </div>

                <div>
                    <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">关联 ClaimIds（只读）</div>
                    <div style="padding: 10px 12px; border: 1px solid var(--ppt-border); border-radius: var(--ppt-radius-md); background: var(--ppt-surface); color: var(--ppt-text-secondary); font-family: 'JetBrains Mono', monospace; font-size: 12px;">
                        ${claimIds.length ? this._escapeHtml(claimIds.join(', ')) : '（无）'}
                    </div>
                </div>

                <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding-top: 6px;">
                    <button class="ppt-btn-secondary" ${prevId ? '' : 'disabled'} onclick="window.PPTGenerator.mergeSlideIntents(${JSON.stringify(prevId)}, ${JSON.stringify(id)})" title="将当前页合并到上一页">
                        <iconify-icon icon="carbon:arrow-up"></iconify-icon> 合并到上一页
                    </button>
                    <button class="ppt-btn-secondary" ${nextId ? '' : 'disabled'} onclick="window.PPTGenerator.mergeSlideIntents(${JSON.stringify(id)}, ${JSON.stringify(nextId)})" title="将下一页合并到当前页">
                        <iconify-icon icon="carbon:arrow-down"></iconify-icon> 合并下一页
                    </button>
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.splitSlideIntent(${JSON.stringify(id)})" title="按要点拆分为多页">
                        <iconify-icon icon="carbon:split"></iconify-icon> 拆分为多页
                    </button>
                </div>
            </div>
        `;
    },


    updateSlideIntent(slideIntentId, patch) {
        const id = String(slideIntentId || '');
        if (!id || !patch || typeof patch !== 'object') return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const si = slides.find((s) => String(s?.slideIntentId || '') === id);
        if (!si || typeof si !== 'object') return;

        const allowed = new Set(['title', 'pageType', 'objective', 'keyPoints', 'claimIds', 'dataTableIds', 'content']);
        for (const [k, v] of Object.entries(patch)) {
            if (!allowed.has(k)) continue;
            if (k === 'keyPoints') {
                si.keyPoints = Array.isArray(v) ? v : si.keyPoints;
            } else if (k === 'claimIds') {
                si.claimIds = Array.isArray(v) ? v : si.claimIds;
            } else if (k === 'dataTableIds') {
                si.dataTableIds = Array.isArray(v) ? v : si.dataTableIds;
            } else if (k === 'title') {
                si.title = typeof v === 'string' ? v : String(v ?? '');
            } else if (k === 'pageType') {
                si.pageType = typeof v === 'string' ? v : String(v ?? '');
            } else if (k === 'objective') {
                si.objective = typeof v === 'string' ? v : String(v ?? '');
            } else if (k === 'content') {
                si.content = typeof v === 'string' ? v : String(v ?? '');
            }
        }
        this.workflowData.slideIntents = slides;
    },


    updateSlideIntentKeyPoint(slideIntentId, index, value) {
        const id = String(slideIntentId || '');
        const i = Number(index);
        if (!id || !Number.isFinite(i)) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const si = slides.find((s) => String(s?.slideIntentId || '') === id);
        if (!si || typeof si !== 'object') return;
        if (!Array.isArray(si.keyPoints)) si.keyPoints = [];
        if (i < 0 || i >= si.keyPoints.length) return;
        si.keyPoints[i] = typeof value === 'string' ? value : String(value ?? '');
        this.workflowData.slideIntents = slides;
    },


    addSlideIntentKeyPoint(slideIntentId) {
        const id = String(slideIntentId || '');
        if (!id) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const si = slides.find((s) => String(s?.slideIntentId || '') === id);
        if (!si || typeof si !== 'object') return;
        if (!Array.isArray(si.keyPoints)) si.keyPoints = [];
        si.keyPoints.push('');
        this.workflowData.slideIntents = slides;
        this.renderPreviewArea?.();
    },


    removeSlideIntentKeyPoint(slideIntentId, index) {
        const id = String(slideIntentId || '');
        const i = Number(index);
        if (!id || !Number.isFinite(i)) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const si = slides.find((s) => String(s?.slideIntentId || '') === id);
        if (!si || typeof si !== 'object') return;
        if (!Array.isArray(si.keyPoints)) si.keyPoints = [];
        if (i < 0 || i >= si.keyPoints.length) return;
        si.keyPoints.splice(i, 1);
        this.workflowData.slideIntents = slides;
        this.renderPreviewArea?.();
    },


    mergeSlideIntents(targetId, sourceId) {
        const tid = String(targetId || '');
        const sid = String(sourceId || '');
        if (!tid || !sid || tid === sid) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const tIdx = slides.findIndex((s) => String(s?.slideIntentId || '') === tid);
        const sIdx = slides.findIndex((s) => String(s?.slideIntentId || '') === sid);
        if (tIdx < 0 || sIdx < 0) return;

        const target = slides[tIdx];
        const source = slides[sIdx];
        if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return;

        const mergeUnique = (a, b) => {
            const out = [];
            const seen = new Set();
            const push = (x) => {
                const v = String(x || '').trim();
                if (!v || seen.has(v)) return;
                seen.add(v);
                out.push(v);
            };
            (Array.isArray(a) ? a : []).forEach(push);
            (Array.isArray(b) ? b : []).forEach(push);
            return out;
        };

        const objA = String(target.objective || '').trim();
        const objB = String(source.objective || '').trim();
        if (!objA && objB) target.objective = objB;
        else if (objA && objB && objA !== objB) target.objective = `${objA}\n${objB}`;

        target.keyPoints = mergeUnique(target.keyPoints, source.keyPoints);
        target.claimIds = mergeUnique(target.claimIds, source.claimIds);
        target.dataTableIds = mergeUnique(target.dataTableIds, source.dataTableIds);

        slides.splice(sIdx, 1);
        slides.forEach((s, i) => {
            if (s && typeof s === 'object') s.index = i;
        });
        this.workflowData.slideIntents = slides;

        this._selectedSlideIntentId = tid;
        this.renderPreviewArea?.();
    },


    splitSlideIntent(slideIntentId) {
        const id = String(slideIntentId || '');
        if (!id) return;

        const pkg = this._getEditableContentPackage();
        const slides = Array.isArray(pkg.slideIntents) ? pkg.slideIntents : [];
        const idx = slides.findIndex((s) => String(s?.slideIntentId || '') === id);
        if (idx < 0) return;

        const src = slides[idx];
        const keyPoints = Array.isArray(src?.keyPoints) ? src.keyPoints.filter((k) => String(k || '').trim()) : [];
        if (keyPoints.length < 2) {
            this.addChatMessage?.('ai', '当前页面要点不足以拆分（至少需要 2 条 KeyPoints）。');
            return;
        }

        const baseTitle = String(src?.title || '页面').trim() || '页面';
        const makeClone = (kp, i) => ({
            ...src,
            slideIntentId: `si_${Date.now()}_${i}_${Math.random().toString(16).slice(2)}`,
            title: `${baseTitle}（${i + 1}）`,
            objective: typeof src?.objective === 'string' ? src.objective : String(src?.objective ?? ''),
            keyPoints: [String(kp)],
            claimIds: Array.isArray(src?.claimIds) ? [...src.claimIds] : [],
            dataTableIds: Array.isArray(src?.dataTableIds) ? [...src.dataTableIds] : [],
        });

        const parts = keyPoints.map(makeClone);
        slides.splice(idx, 1, ...parts);
        slides.forEach((s, i) => {
            if (s && typeof s === 'object') s.index = i;
        });
        this.workflowData.slideIntents = slides;
        this._selectedSlideIntentId = String(parts[0]?.slideIntentId || '');
        this.renderPreviewArea?.();
    },

  });

})();
