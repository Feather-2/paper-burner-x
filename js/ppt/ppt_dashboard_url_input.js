(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.urlInput = NS.urlInput || {};
  Object.assign(NS.urlInput, {
    async openUrlInput() {
        const modalId = 'pptUrlInputModal';
        let existing = document.getElementById(modalId);
        const bindModalActions = (modal) => {
            if (!modal || modal.dataset.actionsBound === '1') return;
            if (!window.PPTUIActions?.bindActions) return;
            modal.dataset.actionsBound = '1';
            window.PPTUIActions.bindActions(modal, {
                closeUrlModal: () => modal.classList.remove('open'),
                switchUrlTab: ({ payload }) => {
                    const tab = payload.tabValue || payload.tab;
                    if (tab) this._switchUrlTab(tab);
                },
                fetchUrlPreview: ({ event }) => {
                    if (event?.type === 'keydown' && event.key !== 'Enter') return;
                    this._fetchUrlPreview();
                },
                batchFetchUrls: () => this._batchFetchUrls(),
                deleteCurrentUrl: () => this._deleteCurrentUrl(),
                saveCurrentUrl: () => this._saveCurrentUrl(),
                selectUrl: ({ payload }) => {
                    if (Number.isFinite(payload.index)) this._selectUrl(payload.index);
                },
                confirmUrlImport: () => this._confirmUrlImport(),
            });
        };
        if (existing) {
            existing.classList.add('open');
            this._pendingUrls = [];
            this._selectedUrlIndex = -1;
            this._renderUrlSidebar();
            bindModalActions(existing);
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = modalId;
        overlay.className = 'ppt-modal-overlay';
        overlay.innerHTML = `
            <div class="ppt-modal ppt-url-parser-modal">
                <div class="ppt-modal-header">
                    <div class="ppt-modal-title">
                        <iconify-icon icon="solar:link-circle-bold-duotone"></iconify-icon>
                        <span>网页链接解析</span>
                    </div>
                    <button class="ppt-modal-close" data-action="closeUrlModal">
                        <iconify-icon icon="carbon:close"></iconify-icon>
                    </button>
                </div>
                <div class="ppt-url-parser-body">
                    <!-- 左侧：已添加链接列表 -->
                    <div class="ppt-url-sidebar">
                        <div class="ppt-url-sidebar-header">
                            <span>已添加链接</span>
                            <span class="ppt-url-count" id="pptUrlCount">0</span>
                        </div>
                        <div class="ppt-url-sidebar-list" id="pptUrlSidebarList">
                            <div class="ppt-url-sidebar-empty">
                                <iconify-icon icon="solar:link-broken-linear"></iconify-icon>
                                <span>暂无链接</span>
                            </div>
                        </div>
                    </div>
                    <!-- 右侧：输入和编辑区 -->
                    <div class="ppt-url-main">
                        <!-- 输入区 -->
                        <div class="ppt-url-input-area">
                            <div class="ppt-url-input-tabs">
                                <button class="ppt-url-input-tab active" data-tab="single" data-action="switchUrlTab" data-tab-value="single">
                                    单个链接
                                </button>
                                <button class="ppt-url-input-tab" data-tab="batch" data-action="switchUrlTab" data-tab-value="batch">
                                    批量导入
                                </button>
                            </div>
                            <div class="ppt-url-input-panel active" data-panel="single">
                                <div class="ppt-url-input-row">
                                    <input type="url" id="pptUrlInputField" class="ppt-url-input"
                                           placeholder="https://example.com/article"
                                           data-action="fetchUrlPreview" data-event="keydown">
                                    <button class="ppt-btn ppt-btn-primary" data-action="fetchUrlPreview">
                                        <iconify-icon icon="solar:magnifer-linear"></iconify-icon>
                                        解析
                                    </button>
                                </div>
                            </div>
                            <div class="ppt-url-input-panel" data-panel="batch">
                                <textarea id="pptUrlBatchInput" class="ppt-url-batch-input"
                                          placeholder="每行一个链接，例如：&#10;https://example.com/article1&#10;https://example.com/article2&#10;https://example.com/article3"></textarea>
                                <button class="ppt-btn ppt-btn-primary" style="margin-top:8px;" data-action="batchFetchUrls">
                                    <iconify-icon icon="solar:play-bold"></iconify-icon>
                                    批量解析
                                </button>
                            </div>
                        </div>
                        <!-- 内容编辑区 -->
                        <div class="ppt-url-editor-area" id="pptUrlEditorArea">
                            <div class="ppt-url-editor-empty" id="pptUrlEditorEmpty">
                                <iconify-icon icon="solar:document-add-linear"></iconify-icon>
                                <p>输入链接并点击解析，或从左侧选择已添加的链接进行编辑</p>
                            </div>
                            <div class="ppt-url-editor-content" id="pptUrlEditorContent" style="display:none;">
                                <div class="ppt-url-editor-header">
                                    <input type="text" id="pptUrlEditorTitle" class="ppt-url-editor-title" placeholder="标题">
                                    <div class="ppt-url-editor-meta">
                                        <span id="pptUrlEditorUrl"></span>
                                        <span id="pptUrlEditorWordCount"></span>
                                    </div>
                                </div>
                                <textarea id="pptUrlEditorText" class="ppt-url-editor-text" placeholder="解析的内容..."></textarea>
                                <div class="ppt-url-editor-actions">
                                    <button class="ppt-btn ppt-btn-secondary" data-action="deleteCurrentUrl">
                                        <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                        删除
                                    </button>
                                    <button class="ppt-btn ppt-btn-primary" data-action="saveCurrentUrl">
                                        <iconify-icon icon="carbon:checkmark"></iconify-icon>
                                        保存修改
                                    </button>
                                </div>
                            </div>
                            <div class="ppt-url-loading" id="pptUrlLoading" style="display:none;">
                                <iconify-icon icon="svg-spinners:180-ring"></iconify-icon>
                                <span id="pptUrlLoadingText">正在解析...</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ppt-modal-footer">
                    <button class="ppt-btn ppt-btn-secondary" data-action="closeUrlModal">取消</button>
                    <button class="ppt-btn ppt-btn-primary" id="pptUrlConfirmBtn" data-action="confirmUrlImport">
                        确认添加 (<span id="pptUrlConfirmCount">0</span> 个)
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        bindModalActions(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });

        overlay.classList.add('open');
        this._pendingUrls = [];
        this._selectedUrlIndex = -1;
        document.getElementById('pptUrlInputField')?.focus();
    },

    _pendingUrls: [],
    _selectedUrlIndex: -1,


    _switchUrlTab(tab) {
        document.querySelectorAll('.ppt-url-input-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.ppt-url-input-panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`.ppt-url-input-tab[data-tab="${tab}"]`)?.classList.add('active');
        document.querySelector(`.ppt-url-input-panel[data-panel="${tab}"]`)?.classList.add('active');
    },


    async _fetchUrlPreview() {
        const input = document.getElementById('pptUrlInputField');
        const url = input?.value?.trim();
        if (!url) return;

        try { new URL(url); } catch { alert('请输入有效的网址'); return; }

        await this._parseAndAddUrl(url);
        input.value = '';
        input.focus();
    },


    async _batchFetchUrls() {
        const textarea = document.getElementById('pptUrlBatchInput');
        const text = textarea?.value?.trim();
        if (!text) return;

        const urls = text.split(/[\n,]/).map(s => s.trim()).filter(s => {
            try { new URL(s); return true; } catch { return false; }
        });

        if (urls.length === 0) {
            alert('未找到有效的链接');
            return;
        }

        // Parse all URLs
        for (let i = 0; i < urls.length; i++) {
            document.getElementById('pptUrlLoadingText').textContent = `正在解析 ${i + 1}/${urls.length}...`;
            await this._parseAndAddUrl(urls[i]);
        }

        textarea.value = '';
    },


    async _parseAndAddUrl(url) {
        const loading = document.getElementById('pptUrlLoading');
        loading.style.display = 'flex';

        // Add to list first with pending status
        const newItem = {
            url,
            title: new URL(url).hostname,
            text: '',
            wordCount: 0,
            status: 'parsing',
        };
        this._pendingUrls.push(newItem);
        const itemIndex = this._pendingUrls.length - 1;
        this._renderUrlSidebar();

        try {
            const { LocalMcpProvider } = await import('../agents/mcp/local-mcp-provider.js');
            const provider = new LocalMcpProvider({
                workerEndpoint: window.CF_WORKER_ENDPOINT || null,
            });

            const result = await provider.callTool('fetch_content', { url });

            if (!result.success) throw new Error(result.error || '解析失败');

            const jsonContent = result.content.find(c => c?.type === 'json');
            const textContent = result.content.find(c => c?.type === 'text');
            const metadata = jsonContent?.data?.metadata || {};
            const text = textContent?.text || jsonContent?.data?.text || '';

            this._pendingUrls[itemIndex] = {
                url,
                title: metadata.title || new URL(url).hostname,
                text: text.slice(0, 15000),
                wordCount: text.length,
                status: 'success',
            };
        } catch (err) {
            this._pendingUrls[itemIndex] = {
                url,
                title: new URL(url).hostname,
                text: '',
                wordCount: 0,
                status: 'error',
                error: err.message,
            };
        }

        loading.style.display = 'none';
        this._renderUrlSidebar();
        this._selectUrl(itemIndex);
    },


    _renderUrlSidebar() {
        const list = document.getElementById('pptUrlSidebarList');
        const count = document.getElementById('pptUrlCount');
        const confirmCount = document.getElementById('pptUrlConfirmCount');

        if (!list) return;

        const successCount = this._pendingUrls.filter(u => u.status === 'success').length;
        count.textContent = this._pendingUrls.length;
        confirmCount.textContent = successCount;

        if (this._pendingUrls.length === 0) {
            list.innerHTML = `
                <div class="ppt-url-sidebar-empty">
                    <iconify-icon icon="solar:link-broken-linear"></iconify-icon>
                    <span>暂无链接</span>
                </div>
            `;
            return;
        }

        list.innerHTML = this._pendingUrls.map((item, i) => {
            const statusIcon = item.status === 'success' ? 'solar:check-circle-bold'
                : item.status === 'error' ? 'solar:close-circle-bold'
                : 'svg-spinners:180-ring';
            const statusClass = item.status || 'pending';
            return `
                <div class="ppt-url-sidebar-item ${i === this._selectedUrlIndex ? 'active' : ''} ${item.status === 'parsing' ? 'parsing' : ''}"
                     data-action="selectUrl" data-index="${i}">
                    <div class="ppt-url-sidebar-item-title">${this._escapeHtml(item.title)}</div>
                    <div class="ppt-url-sidebar-item-url">${this._escapeHtml(new URL(item.url).hostname)}</div>
                    <div class="ppt-url-sidebar-item-status ${statusClass}">
                        <iconify-icon icon="${statusIcon}"></iconify-icon>
                        ${item.status === 'success' ? `${item.wordCount} 字符` : item.status === 'error' ? '解析失败' : '解析中...'}
                    </div>
                </div>
            `;
        }).join('');
    },


    _selectUrl(index) {
        this._selectedUrlIndex = index;
        this._renderUrlSidebar();

        const item = this._pendingUrls[index];
        const empty = document.getElementById('pptUrlEditorEmpty');
        const content = document.getElementById('pptUrlEditorContent');

        if (!item || item.status === 'parsing') {
            empty.style.display = 'flex';
            content.style.display = 'none';
            return;
        }

        empty.style.display = 'none';
        content.style.display = 'flex';

        document.getElementById('pptUrlEditorTitle').value = item.title || '';
        document.getElementById('pptUrlEditorUrl').textContent = item.url;
        document.getElementById('pptUrlEditorWordCount').textContent = `${item.wordCount} 字符`;
        document.getElementById('pptUrlEditorText').value = item.status === 'error'
            ? `解析失败: ${item.error || '未知错误'}\n\n您可以手动粘贴内容到此处。`
            : (item.text || '');
    },


    _saveCurrentUrl() {
        if (this._selectedUrlIndex < 0) return;
        const item = this._pendingUrls[this._selectedUrlIndex];
        if (!item) return;

        item.title = document.getElementById('pptUrlEditorTitle').value.trim() || item.title;
        item.text = document.getElementById('pptUrlEditorText').value;
        item.wordCount = item.text.length;
        if (item.text.length > 0) item.status = 'success';

        this._renderUrlSidebar();
    },


    _deleteCurrentUrl() {
        if (this._selectedUrlIndex < 0) return;
        this._pendingUrls.splice(this._selectedUrlIndex, 1);
        this._selectedUrlIndex = Math.min(this._selectedUrlIndex, this._pendingUrls.length - 1);
        this._renderUrlSidebar();

        if (this._selectedUrlIndex >= 0) {
            this._selectUrl(this._selectedUrlIndex);
        } else {
            document.getElementById('pptUrlEditorEmpty').style.display = 'flex';
            document.getElementById('pptUrlEditorContent').style.display = 'none';
        }
    },


    _confirmUrlImport() {
        if (!this.workflowData.files) this.workflowData.files = [];

        const successUrls = this._pendingUrls.filter(u => u.status === 'success' && u.text);
        for (const item of successUrls) {
            this.workflowData.files.push({
                name: item.title || item.url,
                type: 'link',
                size: `${item.wordCount} 字符`,
                url: item.url,
                content: item.text,
            });
        }

        this._pendingUrls = [];
        this._selectedUrlIndex = -1;
        document.getElementById('pptUrlInputModal')?.classList.remove('open');
        this.renderPreviewArea();
    },

  });
})();
