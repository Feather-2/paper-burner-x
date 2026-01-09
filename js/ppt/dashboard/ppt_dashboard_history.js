(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.history = NS.history || {};
  Object.assign(NS.history, {
	    async openHistorySelector() {
	        // Ensure files array exists
	        if (!this.workflowData.files) this.workflowData.files = [];
	
	        const modalId = 'pptHistorySelectorModal';
	        let existing = document.getElementById(modalId);
	        if (existing) {
	            if (existing._pptRemoveTimer) {
	                clearTimeout(existing._pptRemoveTimer);
	                existing._pptRemoveTimer = null;
	            }
	            existing.classList.add('open');
	            this._loadHistoryData();
	            return;
	        }

        // Create modal
        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'ppt-modal-overlay';
        overlay.innerHTML = `
            <div class="ppt-modal ppt-history-selector-modal">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title">
                        <iconify-icon icon="solar:history-bold-duotone"></iconify-icon>
                        <span>历史项目</span>
                    </div>
                    <button class="ppt-modal-close" data-action="closeHistoryModal">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-modal-body">
                    <div class="ppt-history-tabs">
                        <button class="ppt-history-tab active" data-tab="deepsearch">
                            <iconify-icon icon="solar:magnifer-bold-duotone"></iconify-icon>
                            深度研究项目
                        </button>
                        <button class="ppt-history-tab" data-tab="documents">
                            <iconify-icon icon="solar:document-bold-duotone"></iconify-icon>
                            历史文档
                        </button>
                    </div>
                    <div class="ppt-history-content">
                        <div class="ppt-history-panel active" data-panel="deepsearch">
                            <div class="ppt-history-list" id="pptHistoryDeepsearchList">
                                <div class="ppt-history-loading">
                                    <iconify-icon icon="svg-spinners:180-ring"></iconify-icon>
                                    加载中...
                                </div>
                            </div>
                        </div>
                        <div class="ppt-history-panel" data-panel="documents">
                            <div class="ppt-history-list" id="pptHistoryDocumentsList">
                                <div class="ppt-history-loading">
                                    <iconify-icon icon="svg-spinners:180-ring"></iconify-icon>
                                    加载中...
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ppt-modal-footer">
                    <button class="ppt-btn ppt-btn-secondary" data-action="closeHistoryModal">取消</button>
                    <button class="ppt-btn ppt-btn-primary" id="pptHistoryImportBtn" disabled>
                        导入选中项目
                    </button>
                </div>
            </div>
        `;
	
	        document.body.appendChild(overlay);

	        const closeAndRemoveModal = () => {
	            const modal = document.getElementById(modalId);
	            if (!modal) return;
	            modal.classList.remove('open');
	            if (modal._pptRemoveTimer) clearTimeout(modal._pptRemoveTimer);
	            modal._pptRemoveTimer = setTimeout(() => modal.remove(), 300);
	        };

	        if (window.PPTUIActions?.bindActions) {
	            window.PPTUIActions.bindActions(overlay, {
	                closeHistoryModal: closeAndRemoveModal,
	            });
	        }

        // Tab switching
        overlay.querySelectorAll('.ppt-history-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.ppt-history-tab').forEach(t => t.classList.remove('active'));
                overlay.querySelectorAll('.ppt-history-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                overlay.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
            });
        });

        // Import button
	        const importBtn = document.getElementById('pptHistoryImportBtn');
	        importBtn.addEventListener('click', () => {
	            this._importSelectedHistoryItems();
	            closeAndRemoveModal();
	        });

        // Close on overlay click
	        overlay.addEventListener('click', (e) => {
	            if (e.target === overlay) closeAndRemoveModal();
	        });

        overlay.classList.add('open');
        this._loadHistoryData();
    },

    _selectedHistoryItems: new Set(),


    async _loadHistoryData() {
        this._selectedHistoryItems.clear();
        document.getElementById('pptHistoryImportBtn').disabled = true;

        // Load DeepSearch checkpoints
        const dsListEl = document.getElementById('pptHistoryDeepsearchList');
        try {
            const checkpoints = this._getAllCheckpoints();
            if (checkpoints.length === 0) {
                dsListEl.innerHTML = '<div class="ppt-history-empty"><iconify-icon icon="solar:folder-open-linear" style="font-size:32px;margin-bottom:8px;display:block;"></iconify-icon>暂无深度研究项目</div>';
            } else {
                dsListEl.innerHTML = checkpoints.map(cp => this._renderHistoryItem(cp, 'checkpoint')).join('');
            }
        } catch (e) {
            dsListEl.innerHTML = '<div class="ppt-history-empty">加载失败</div>';
        }

        // Load document history from IndexedDB
        const docListEl = document.getElementById('pptHistoryDocumentsList');
        try {
            const results = typeof window.getAllResultsFromDB === 'function'
                ? await window.getAllResultsFromDB()
                : [];
            if (!results || results.length === 0) {
                docListEl.innerHTML = '<div class="ppt-history-empty"><iconify-icon icon="solar:folder-open-linear" style="font-size:32px;margin-bottom:8px;display:block;"></iconify-icon>暂无历史文档</div>';
            } else {
                const sorted = results.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
                docListEl.innerHTML = sorted.map(doc => this._renderHistoryItem(doc, 'document')).join('');
            }
        } catch (e) {
            docListEl.innerHTML = '<div class="ppt-history-empty">加载失败</div>';
        }

        // Bind click handlers
        document.querySelectorAll('.ppt-history-item').forEach(item => {
            item.addEventListener('click', () => {
                const key = item.dataset.key;
                if (this._selectedHistoryItems.has(key)) {
                    this._selectedHistoryItems.delete(key);
                    item.classList.remove('selected');
                } else {
                    this._selectedHistoryItems.add(key);
                    item.classList.add('selected');
                }
                document.getElementById('pptHistoryImportBtn').disabled = this._selectedHistoryItems.size === 0;
            });
        });
    },


    _getAllCheckpoints() {
        const checkpoints = [];
        const prefix = 'ppt_checkpoint_';
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (Array.isArray(data) && data.length > 0) {
                        const latest = data[data.length - 1];
                        const projectId = key.replace(prefix, '');
                        checkpoints.push({
                            projectId,
                            storageKey: key,
                            ...latest,
                            title: latest.metadata?.title || latest.state?.userConfig?.taskGoal || `项目 ${projectId}`,
                        });
                    }
                } catch {}
            }
        }
        return checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    },


    _renderHistoryItem(item, type) {
        const key = type === 'checkpoint' ? `cp:${item.storageKey}` : `doc:${item.id}`;
        const title = type === 'checkpoint'
            ? this._escapeHtml(item.title || '未命名项目')
            : this._escapeHtml(item.name || '未命名文档');
        const time = type === 'checkpoint' ? item.timestamp : item.time;
        const timeStr = time ? new Date(time).toLocaleString() : '';
        const badge = type === 'checkpoint'
            ? (item.stage || 'unknown').replace('deepsearch.', '').replace('design.', '')
            : (item.type || 'document');

        return `
            <div class="ppt-history-item" data-key="${this._escapeHtml(key)}" data-type="${type}">
                <div class="ppt-history-item-check">
                    <iconify-icon icon="carbon:checkmark" width="12"></iconify-icon>
                </div>
                <div class="ppt-history-item-info">
                    <div class="ppt-history-item-title">${title}</div>
                    <div class="ppt-history-item-meta">
                        <span><iconify-icon icon="carbon:time"></iconify-icon>${this._escapeHtml(timeStr)}</span>
                        <span class="ppt-history-item-badge">${this._escapeHtml(badge)}</span>
                    </div>
                </div>
            </div>
        `;
    },


    async _importSelectedHistoryItems() {
        for (const key of this._selectedHistoryItems) {
            const [type, id] = key.split(':');
            if (type === 'cp') {
                // Checkpoint - extract report + original sources
                try {
                    const data = JSON.parse(localStorage.getItem(id));
                    const latest = Array.isArray(data) ? data[data.length - 1] : null;
                    if (latest?.state) {
                        const title = latest.metadata?.title || latest.state?.userConfig?.taskGoal || '深度研究项目';
                        const report = latest.state?.report?.markdown || latest.state?.L1?.report?.markdown || '';

                        // 1. 添加报告 markdown 作为参考
                        if (report) {
                            this.workflowData.files.push({
                                name: `${title} - 研究报告`,
                                type: 'history-report',
                                size: '参考报告',
                                content: report,
                                checkpointKey: id,
                            });
                        }

                        // 2. 提取原始源内容（L0.sources）
                        const sources = Array.isArray(latest.state?.L0?.sources) ? latest.state.L0.sources : [];
                        for (const src of sources) {
                            const text = src?.sourceTextNormalized || '';
                            if (!text || text.length < 100) continue; // 跳过空内容

                            const srcTitle = src?.title || src?.uri || '未知来源';
                            const srcUri = src?.uri || '';

                            let sizeLabel = '历史来源';
                            try {
                                if (srcUri) sizeLabel = `来源: ${new URL(srcUri).hostname}`;
                            } catch {}

                            this.workflowData.files.push({
                                name: srcTitle,
                                type: 'history-source',
                                size: sizeLabel,
                                content: text,
                                sourceUri: srcUri,
                                sourceId: src?.sourceId,
                            });
                        }

                        // 3. 如果没有报告也没有源，fallback 到 JSON
                        if (!report && sources.length === 0) {
                            this.workflowData.files.push({
                                name: title,
                                type: 'history-checkpoint',
                                size: '研究项目',
                                content: JSON.stringify(latest.state, null, 2).slice(0, 5000),
                                checkpointKey: id,
                            });
                        }
                    }
                } catch (e) { console.warn('[HistoryImport] checkpoint parse error:', e); }
            } else if (type === 'doc') {
                // Document from IndexedDB
                try {
                    const doc = typeof window.getResultFromDB === 'function'
                        ? await window.getResultFromDB(id)
                        : null;
                    if (doc) {
                        this.workflowData.files.push({
                            name: doc.name || '历史文档',
                            type: 'history-document',
                            size: '历史文档',
                            content: doc.result || doc.text || '',
                            documentId: id,
                        });
                    }
                } catch {}
            }
        }
        this._selectedHistoryItems.clear();
        this.renderPreviewArea();
    },

  });
})();

// ESM 导出
