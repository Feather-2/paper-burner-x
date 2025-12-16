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
                    <button class="ppt-modal-close" onclick="document.getElementById('${modalId}').classList.remove('open')">
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
                    <button class="ppt-btn ppt-btn-secondary" onclick="document.getElementById('${modalId}').classList.remove('open')">取消</button>
                    <button class="ppt-btn ppt-btn-primary" id="pptHistoryImportBtn" disabled>
                        导入选中项目
                    </button>
                </div>
            </div>
            <style>
                .ppt-history-selector-modal {
                    width: min(720px, 90vw);
                    max-height: 80vh;
                }
                .ppt-history-tabs {
                    display: flex;
                    gap: 8px;
                    padding: 0 0 16px 0;
                    border-bottom: 1px solid var(--ppt-border);
                    margin-bottom: 16px;
                }
                .ppt-history-tab {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    background: transparent;
                    border: 1px solid var(--ppt-border);
                    border-radius: 8px;
                    font-size: 13px;
                    color: var(--ppt-text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .ppt-history-tab:hover {
                    background: var(--ppt-bg-subtle);
                    color: var(--ppt-text-main);
                }
                .ppt-history-tab.active {
                    background: var(--ppt-primary-subtle);
                    border-color: var(--ppt-primary);
                    color: var(--ppt-primary);
                }
                .ppt-history-tab iconify-icon {
                    font-size: 16px;
                }
                .ppt-history-content {
                    min-height: 300px;
                    max-height: 400px;
                    overflow-y: auto;
                }
                .ppt-history-panel {
                    display: none;
                }
                .ppt-history-panel.active {
                    display: block;
                }
                .ppt-history-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .ppt-history-loading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 40px;
                    color: var(--ppt-text-muted);
                    font-size: 13px;
                }
                .ppt-history-empty {
                    text-align: center;
                    padding: 40px;
                    color: var(--ppt-text-muted);
                    font-size: 13px;
                }
                .ppt-history-item {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    padding: 12px 14px;
                    background: var(--ppt-bg-subtle);
                    border: 1px solid transparent;
                    border-radius: 10px;
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .ppt-history-item:hover {
                    background: white;
                    border-color: var(--ppt-border);
                }
                .ppt-history-item.selected {
                    background: var(--ppt-primary-subtle);
                    border-color: var(--ppt-primary);
                }
                .ppt-history-item-check {
                    width: 18px;
                    height: 18px;
                    border: 2px solid var(--ppt-border);
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    margin-top: 2px;
                    transition: all 0.15s;
                }
                .ppt-history-item.selected .ppt-history-item-check {
                    background: var(--ppt-primary);
                    border-color: var(--ppt-primary);
                    color: white;
                }
                .ppt-history-item-info {
                    flex: 1;
                    min-width: 0;
                }
                .ppt-history-item-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--ppt-text-main);
                    margin-bottom: 4px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .ppt-history-item-meta {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 12px;
                    color: var(--ppt-text-muted);
                }
                .ppt-history-item-meta iconify-icon {
                    margin-right: 4px;
                }
                .ppt-history-item-badge {
                    padding: 2px 8px;
                    background: var(--ppt-bg-subtle);
                    border-radius: 4px;
                    font-size: 11px;
                    color: var(--ppt-text-secondary);
                }
                .ppt-history-item.selected .ppt-history-item-badge {
                    background: rgba(79, 70, 229, 0.15);
                    color: var(--ppt-primary);
                }
            </style>
        `;

        document.body.appendChild(overlay);

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
            overlay.classList.remove('open');
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
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

