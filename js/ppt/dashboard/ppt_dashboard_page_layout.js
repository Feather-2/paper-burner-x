(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.pageLayout = NS.pageLayout || {};
  Object.assign(NS.pageLayout, {
    _renderPageLayoutReview() {
        const maxTab = 2;
        let activeTab = Number.isInteger(this._pageLayoutTab) ? this._pageLayoutTab : 2;
        activeTab = Math.max(0, Math.min(maxTab, Math.floor(activeTab)));
        if (this._pageLayoutTab !== activeTab) this._pageLayoutTab = activeTab;
        return `
            <div class="ppt-question-form page-layout">
                <div class="ppt-page-layout-editor">
                    ${this._renderDesignPhaseProgress?.() || ''}
                    <div class="ppt-page-layout-tabs">
                        <div class="ppt-page-layout-tab ${activeTab === 0 ? 'active' : ''}" data-action="setPageLayoutTab" data-tab="0">
                            <iconify-icon icon="carbon:list"></iconify-icon> 页面规划
                        </div>
                        <div class="ppt-page-layout-tab ${activeTab === 1 ? 'active' : ''}" data-action="setPageLayoutTab" data-tab="1">
                            <iconify-icon icon="carbon:edit"></iconify-icon> 页面详情
                        </div>
                        <div class="ppt-page-layout-tab ${activeTab === 2 ? 'active' : ''}" data-action="setPageLayoutTab" data-tab="2">
                            <iconify-icon icon="carbon:color-palette"></iconify-icon> 设计规范
                        </div>
                    </div>
                    <div class="ppt-page-layout-content custom-scrollbar">
                        ${activeTab === 0 ? this._renderPagePlanTab() :
                          activeTab === 1 ? this._renderPageDetailTab() :
                          this._renderDesignSpecView()}
                    </div>
                    <div class="ppt-page-layout-footer">
                        <button class="ppt-btn-secondary" data-action="backToScriptReview">
                            <iconify-icon icon="carbon:arrow-left"></iconify-icon> 返回脚本
                        </button>
                        <button class="ppt-btn-primary" data-action="phase5DesignOptimization">
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
        this._pageLayoutTab = Math.max(0, Math.min(2, Math.floor(i)));
        this.renderPreviewArea?.();
    },

    _renderDesignPhaseProgress() {
        const phase = typeof this.workflowData?.designPhase?.status === 'string'
            ? this.workflowData.designPhase.status
            : (typeof this.workflowData?.designPhase?.to === 'string' ? this.workflowData.designPhase.to : '');
        const labels = {
            outline_parsing: '解析大纲',
            outline_confirming: '确认大纲',
            style_extracting: '提取风格',
            style_confirming: '确认风格',
            generating: '生成页面',
            generating_paused: '生成暂停',
            reviewing: '质量审阅',
            fixing: '修复页面',
            visual_filling: '填充视觉',
            completed: '完成设计',
            failed: '设计失败',
            editing: '进入编辑'
        };
        const ordered = [
            'outline_parsing',
            'outline_confirming',
            'style_extracting',
            'style_confirming',
            'generating',
            'reviewing',
            'visual_filling',
            'completed'
        ];
        const idx = ordered.indexOf(phase);
        const percent = idx >= 0 ? Math.round(((idx + 1) / ordered.length) * 100) : 0;
        const label = phase ? (labels[phase] || phase) : '未开始';
        const subtitle = phase ? `当前阶段：${label}` : '等待设计阶段启动';

        return `
            <div style="margin-bottom: 14px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--ppt-border); background: var(--ppt-surface);">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div style="font-weight: 800; color: var(--ppt-text-main); display:flex; align-items:center; gap:8px;">
                        <iconify-icon icon="carbon:flag"></iconify-icon>
                        <span>设计阶段进度</span>
                    </div>
                    <div style="font-size: 12px; color: var(--ppt-text-secondary); font-weight: 600;">${subtitle}</div>
                </div>
                <div style="margin-top: 10px; height: 8px; border-radius: 999px; background: rgba(148,163,184,0.2); overflow: hidden;">
                    <div style="height: 100%; width: ${percent}%; background: linear-gradient(90deg, #22c55e, #0ea5e9); transition: width 0.3s ease;"></div>
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
        const statusStore = this.workflowData?.slideStatuses && typeof this.workflowData.slideStatuses === 'object'
            ? this.workflowData.slideStatuses
            : {};
        const statusById = statusStore.bySlideIntentId && typeof statusStore.bySlideIntentId === 'object'
            ? statusStore.bySlideIntentId
            : {};
        const statusByIndex = statusStore.byIndex && typeof statusStore.byIndex === 'object'
            ? statusStore.byIndex
            : {};
        const escapeAttr = (v) => (typeof this._escapeAttr === 'function' ? this._escapeAttr(v) : String(v ?? ''));
        const statusMeta = {
            generating: { label: '生成中', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
            completed: { label: '已完成', color: '#16a34a', bg: 'rgba(22,163,74,0.12)', border: 'rgba(22,163,74,0.3)' },
            failed: { label: '失败', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
            degraded: { label: '降级', color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)' }
        };
        const getStatusEntry = (slideId, index) => {
            if (slideId && statusById[slideId]) return statusById[slideId];
            if (Number.isFinite(index) && statusByIndex[index]) return statusByIndex[index];
            return null;
        };
        const renderStatusBadge = (entry) => {
            if (!entry) return '';
            const statusKey = entry.degraded ? 'degraded' : entry.status;
            const meta = statusKey ? statusMeta[statusKey] : null;
            if (!meta) return '';
            const titleParts = [];
            if (entry.step) titleParts.push(`step: ${entry.step}`);
            if (entry.msg) titleParts.push(entry.msg);
            if (entry.error) titleParts.push(`error: ${entry.error}`);
            const title = titleParts.length ? ` title="${escapeAttr(titleParts.join(' | '))}"` : '';
            return `
                <span${title} style="flex-shrink:0; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid ${meta.border}; color: ${meta.color}; background: ${meta.bg};">
                    ${meta.label}
                </span>
            `;
        };

        const renderCard = (s, i) => {
            const id = String(s?.slideIntentId || '');
            const title = this._escapeHtml(s?.title || '未命名页面');
            const pageType = this._escapeHtml(s?.pageType || 'overview');
            const keyPoints = Array.isArray(s?.keyPoints) ? s.keyPoints : [];
            const keyPointsPreview = keyPoints.slice(0, 3).map((k) => `<div>• ${this._escapeHtml(k)}</div>`).join('');
            const isSelected = selectedId && id === selectedId;
            const statusEntry = getStatusEntry(id, i);
            const statusBadge = renderStatusBadge(statusEntry);

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
                                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                                    ${statusBadge}
                                    <span style="flex-shrink:0; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid var(--ppt-border); color: var(--ppt-text-secondary); background: var(--ppt-surface);">
                                        ${pageType}
                                    </span>
                                </div>
                            </div>
                            ${keyPointsPreview ? `<div style="margin-top: 8px; color: var(--ppt-text-secondary); font-size: 13px; line-height: 1.5;">${keyPointsPreview}</div>` : `<div style="margin-top: 8px; color: var(--ppt-text-muted); font-size: 13px;">（暂无要点）</div>`}
                        </div>
                        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                            <button class="ppt-icon-btn" title="编辑" data-action="selectSlideIntent" data-id="${this._escapeAttr(id)}">
                                <iconify-icon icon="carbon:edit"></iconify-icon>
                            </button>
                            <button class="ppt-icon-btn" title="复制" data-action="duplicateSlideIntent" data-id="${this._escapeAttr(id)}">
                                <iconify-icon icon="carbon:copy"></iconify-icon>
                            </button>
                            <button class="ppt-icon-btn" title="删除" data-action="deleteSlideIntent" data-id="${this._escapeAttr(id)}">
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
                <button class="ppt-btn-secondary" data-action="addSlideIntent">
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
                        data-action="updateSlideIntentField" data-event="input" data-id="${this._escapeAttr(id)}" data-field="title">
                </div>

                <div>
                    <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">页面类型</div>
                    <select class="ppt-input-field" data-action="updateSlideIntentField" data-event="change" data-id="${this._escapeAttr(id)}" data-field="pageType">
                        ${typeOptions.map((t) => `<option value="${this._escapeAttr(t)}" ${t === currentType ? 'selected' : ''}>${this._escapeHtml(t)}</option>`).join('')}
                    </select>
                </div>

                <div>
                    <div style="font-size: 13px; font-weight: 800; margin-bottom: 6px; color: var(--ppt-text-main);">目标说明</div>
                    <textarea class="ppt-input-field" rows="4" style="line-height: 1.5;"
                        data-action="updateSlideIntentField" data-event="input" data-id="${this._escapeAttr(id)}" data-field="objective">${objective}</textarea>
                </div>

                <div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom: 8px;">
                        <div style="font-size: 13px; font-weight: 800; color: var(--ppt-text-main);">要点（KeyPoints）</div>
                        <button class="ppt-btn-secondary" data-action="addSlideIntentKeyPoint" data-id="${this._escapeAttr(id)}">
                            <iconify-icon icon="carbon:add"></iconify-icon> 添加要点
                        </button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${keyPoints.length ? keyPoints.map((kp, i) => `
                            <div style="display:flex; gap:8px; align-items:center;">
                                <input class="ppt-input-field" type="text" style="flex:1;" value="${this._escapeAttr(kp || '')}"
                                    data-action="updateSlideIntentKeyPoint" data-event="input" data-id="${this._escapeAttr(id)}" data-index="${i}">
                                <button class="ppt-icon-btn" title="删除要点" data-action="removeSlideIntentKeyPoint" data-id="${this._escapeAttr(id)}" data-index="${i}">
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
                    <button class="ppt-btn-secondary" ${prevId ? 'data-action="mergeSlideIntents" data-from="' + this._escapeAttr(prevId) + '" data-to="' + this._escapeAttr(id) + '"' : 'disabled'} title="将当前页合并到上一页">
                        <iconify-icon icon="carbon:arrow-up"></iconify-icon> 合并到上一页
                    </button>
                    <button class="ppt-btn-secondary" ${nextId ? 'data-action="mergeSlideIntents" data-from="' + this._escapeAttr(id) + '" data-to="' + this._escapeAttr(nextId) + '"' : 'disabled'} title="将下一页合并到当前页">
                        <iconify-icon icon="carbon:arrow-down"></iconify-icon> 合并下一页
                    </button>
                    <button class="ppt-btn-secondary" data-action="splitSlideIntent" data-id="${this._escapeAttr(id)}" title="按要点拆分为多页">
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

  const getPageLayoutActions = (ctx) => ({
    setPageLayoutTab: ({ payload }) => ctx._setPageLayoutTab?.(payload.tab),
    backToScriptReview: () => ctx._backToScriptReview?.(),
    phase5DesignOptimization: () => ctx.phase5_DesignOptimization?.(),
    addSlideIntent: () => ctx.addSlideIntent?.(),
    selectSlideIntent: ({ payload }) => ctx._selectSlideIntent?.(payload.id),
    duplicateSlideIntent: ({ payload }) => ctx.duplicateSlideIntent?.(payload.id),
    deleteSlideIntent: ({ payload }) => ctx.deleteSlideIntent?.(payload.id),
    updateSlideIntentField: ({ payload, value }) => {
      if (!payload?.field) return;
      const patch = { [payload.field]: value };
      ctx.updateSlideIntent?.(payload.id, patch);
    },
    addSlideIntentKeyPoint: ({ payload }) => ctx.addSlideIntentKeyPoint?.(payload.id),
    updateSlideIntentKeyPoint: ({ payload, value }) => ctx.updateSlideIntentKeyPoint?.(payload.id, payload.index, value),
    removeSlideIntentKeyPoint: ({ payload }) => ctx.removeSlideIntentKeyPoint?.(payload.id, payload.index),
    mergeSlideIntents: ({ payload }) => ctx.mergeSlideIntents?.(payload.from, payload.to),
    splitSlideIntent: ({ payload }) => ctx.splitSlideIntent?.(payload.id),
    updateDesignSystemColor: ({ payload, value }) => ctx.updateDesignSystemColor?.(payload.key, value),
    updateDesignSystemFont: ({ payload, value }) => ctx.updateDesignSystemFont?.(payload.key, value),
    updateDesignSystemFontSize: ({ value }) => ctx.updateDesignSystemFontSize?.(value),
    updateVisualPreferenceMode: ({ payload }) => ctx.updateVisualPreferenceMode?.(payload.mode),
    updateRefineEnabled: ({ payload }) => ctx.updateRefineEnabled?.(payload.enabled),
    updateDesignSystemDensity: ({ payload }) => ctx.updateDesignSystemDensity?.(payload.mode),
    updateBatchSize: ({ payload }) => ctx.updateBatchSize?.(payload.size),
    openModelConfig: () => ctx.openModelConfig?.(),
    removeStyleReference: ({ payload }) => ctx.removeStyleReference?.(payload.id),
    updateStyleReferenceNotes: ({ value }) => ctx.updateStyleReferenceNotes?.(value),
  });

  if (window.PPTFlowViews?.register) {
    window.PPTFlowViews.register('page_layout', {
      render: (ctx) => ctx._renderPageLayoutReview?.(),
      actions: getPageLayoutActions,
      onMount: (ctx) => {
        if (typeof ctx._bindDesignSpecInteractions === 'function') {
          ctx._bindDesignSpecInteractions();
        }
      },
    });
  }

})();
