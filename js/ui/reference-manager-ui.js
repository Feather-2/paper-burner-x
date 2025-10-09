// js/ui/reference-manager-ui.js
// 参考文献管理UI

(function(global) {
    'use strict';

    /**
     * 参考文献管理UI类
     */
    class ReferenceManagerUI {
        constructor() {
            this.currentDocumentId = null;
            this.references = [];
            this.filteredReferences = [];
            this.selectedReferences = new Set();
            this.sortColumn = 'index';
            this.sortDirection = 'asc';
        }

        /**
         * 初始化UI
         */
        initialize() {
            this.createManagerModal();
            this.attachEventListeners();
            console.log('[ReferenceManagerUI] Initialized.');
        }

        /**
         * 创建管理界面模态框
         */
        createManagerModal() {
            const modal = document.createElement('div');
            modal.id = 'reference-manager-modal';
            modal.className = 'reference-modal';
            modal.innerHTML = `
                <div class="reference-modal-content">
                    <div class="reference-modal-header">
                        <h2><i class="fa fa-book"></i> 参考文献管理</h2>
                        <button class="reference-modal-close" aria-label="关闭">&times;</button>
                    </div>

                    <div class="reference-toolbar">
                        <div class="reference-toolbar-left">
                            <button id="ref-extract-btn" class="ref-btn ref-btn-primary">
                                <i class="fa fa-search"></i> 提取文献
                            </button>
                            <button id="ref-add-btn" class="ref-btn">
                                <i class="fa fa-plus"></i> 添加
                            </button>
                            <button id="ref-import-btn" class="ref-btn">
                                <i class="fa fa-upload"></i> 导入
                            </button>
                            <button id="ref-export-btn" class="ref-btn">
                                <i class="fa fa-download"></i> 导出
                            </button>
                        </div>
                        <div class="reference-toolbar-right">
                            <input type="text" id="ref-search-input" placeholder="搜索文献..." />
                            <select id="ref-filter-select">
                                <option value="all">全部</option>
                                <option value="recent">最近</option>
                                <option value="classic">经典</option>
                                <option value="verified">已验证</option>
                            </select>
                        </div>
                    </div>

                    <div class="reference-stats" id="ref-stats">
                        <span>总计: <strong>0</strong></span>
                        <span>已验证: <strong>0</strong></span>
                        <span>平均置信度: <strong>0%</strong></span>
                    </div>

                    <div class="reference-table-container">
                        <table class="reference-table" id="ref-table">
                            <thead>
                                <tr>
                                    <th><input type="checkbox" id="ref-select-all" /></th>
                                    <th data-sort="index">#</th>
                                    <th data-sort="authors">作者</th>
                                    <th data-sort="title">标题</th>
                                    <th data-sort="year">年份</th>
                                    <th data-sort="journal">期刊/会议</th>
                                    <th data-sort="doi">DOI</th>
                                    <th data-sort="tags">标签</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody id="ref-table-body">
                                <tr class="ref-empty-state">
                                    <td colspan="9">暂无文献数据，请点击"提取文献"按钮开始</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="reference-modal-footer">
                        <div class="reference-footer-left">
                            <span id="ref-selection-info">未选中</span>
                        </div>
                        <div class="reference-footer-right">
                            <button id="ref-batch-delete-btn" class="ref-btn ref-btn-danger" disabled>
                                删除选中
                            </button>
                            <button id="ref-close-btn" class="ref-btn">关闭</button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
        }

        /**
         * 创建编辑模态框
         */
        createEditModal() {
            const modal = document.createElement('div');
            modal.id = 'reference-edit-modal';
            modal.className = 'reference-modal';
            modal.innerHTML = `
                <div class="reference-modal-content reference-edit-content">
                    <div class="reference-modal-header">
                        <h2><i class="fa fa-edit"></i> 编辑文献</h2>
                        <button class="reference-modal-close" aria-label="关闭">&times;</button>
                    </div>

                    <div class="reference-edit-form">
                        <div class="ref-form-row">
                            <label>作者 *</label>
                            <input type="text" id="edit-authors" placeholder="用逗号分隔多个作者" />
                        </div>
                        <div class="ref-form-row">
                            <label>标题 *</label>
                            <input type="text" id="edit-title" placeholder="文献标题" />
                        </div>
                        <div class="ref-form-row">
                            <label>年份</label>
                            <input type="number" id="edit-year" placeholder="发表年份" min="1900" max="2100" />
                        </div>
                        <div class="ref-form-row">
                            <label>期刊/会议</label>
                            <input type="text" id="edit-journal" placeholder="期刊或会议名称" />
                        </div>
                        <div class="ref-form-row ref-form-row-half">
                            <div>
                                <label>卷号</label>
                                <input type="text" id="edit-volume" placeholder="Vol." />
                            </div>
                            <div>
                                <label>期号</label>
                                <input type="text" id="edit-issue" placeholder="No." />
                            </div>
                        </div>
                        <div class="ref-form-row">
                            <label>页码</label>
                            <input type="text" id="edit-pages" placeholder="例: 1-10" />
                        </div>
                        <div class="ref-form-row">
                            <label>DOI</label>
                            <input type="text" id="edit-doi" placeholder="10.xxxx/xxxxx" />
                        </div>
                        <div class="ref-form-row">
                            <label>URL</label>
                            <input type="url" id="edit-url" placeholder="https://" />
                        </div>
                        <div class="ref-form-row">
                            <label>类型</label>
                            <select id="edit-type">
                                <option value="journal">期刊</option>
                                <option value="conference">会议</option>
                                <option value="book">书籍</option>
                                <option value="thesis">论文</option>
                                <option value="other">其他</option>
                            </select>
                        </div>
                        <div class="ref-form-row">
                            <label>标签</label>
                            <input type="text" id="edit-tags" placeholder="用逗号分隔标签" />
                        </div>
                    </div>

                    <div class="reference-modal-footer">
                        <button id="ref-edit-cancel-btn" class="ref-btn">取消</button>
                        <button id="ref-edit-save-btn" class="ref-btn ref-btn-primary">保存</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
        }

        /**
         * 绑定事件监听
         */
        attachEventListeners() {
            // 关闭按钮
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('reference-modal-close') ||
                    e.target.id === 'ref-close-btn') {
                    this.closeManager();
                }
            });

            // 提取文献
            document.getElementById('ref-extract-btn')?.addEventListener('click', () => {
                this.extractReferences();
            });

            // 添加文献
            document.getElementById('ref-add-btn')?.addEventListener('click', () => {
                this.showEditModal();
            });

            // 导出
            document.getElementById('ref-export-btn')?.addEventListener('click', () => {
                this.showExportMenu();
            });

            // 搜索
            document.getElementById('ref-search-input')?.addEventListener('input', (e) => {
                this.filterReferences(e.target.value);
            });

            // 筛选
            document.getElementById('ref-filter-select')?.addEventListener('change', (e) => {
                this.applyFilter(e.target.value);
            });

            // 全选
            document.getElementById('ref-select-all')?.addEventListener('change', (e) => {
                this.toggleSelectAll(e.target.checked);
            });

            // 批量删除
            document.getElementById('ref-batch-delete-btn')?.addEventListener('click', () => {
                this.batchDelete();
            });

            // 表格排序
            document.querySelectorAll('[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    this.sortTable(th.dataset.sort);
                });
            });
        }

        /**
         * 显示管理界面
         * @param {string} documentId - 文档ID
         */
        show(documentId) {
            this.currentDocumentId = documentId;
            this.loadReferences();

            const modal = document.getElementById('reference-manager-modal');
            if (modal) {
                modal.style.display = 'flex';
            }
        }

        /**
         * 关闭管理界面
         */
        closeManager() {
            const modal = document.getElementById('reference-manager-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        }

        /**
         * 加载文献数据
         */
        loadReferences() {
            if (!this.currentDocumentId) return;

            const data = global.ReferenceStorage.loadReferences(this.currentDocumentId);
            if (data && data.references) {
                this.references = data.references;
                this.filteredReferences = [...this.references];
                this.renderTable();
                this.updateStats();
            }
        }

        /**
         * 渲染表格
         */
        renderTable() {
            const tbody = document.getElementById('ref-table-body');
            if (!tbody) return;

            if (this.filteredReferences.length === 0) {
                tbody.innerHTML = `
                    <tr class="ref-empty-state">
                        <td colspan="9">暂无文献数据</td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = this.filteredReferences.map(ref => `
                <tr data-index="${ref.index}">
                    <td><input type="checkbox" class="ref-checkbox" data-index="${ref.index}" /></td>
                    <td>${ref.index + 1}</td>
                    <td class="ref-authors" title="${(ref.authors || []).join(', ')}">
                        ${this.formatAuthors(ref.authors)}
                    </td>
                    <td class="ref-title" title="${ref.title || ''}">
                        ${ref.title || '<em>未提取</em>'}
                    </td>
                    <td>${ref.year || '-'}</td>
                    <td class="ref-journal" title="${ref.journal || ''}">
                        ${ref.journal || '-'}
                    </td>
                    <td>
                        ${ref.doi ? `<a href="https://doi.org/${ref.doi}" target="_blank" class="ref-doi">${ref.doi}</a>` : '-'}
                    </td>
                    <td>
                        ${this.renderTags(ref.tags)}
                    </td>
                    <td class="ref-actions">
                        <button class="ref-action-btn" data-action="edit" data-index="${ref.index}" title="编辑"><i class="fa fa-edit"></i></button>
                        <button class="ref-action-btn" data-action="view" data-index="${ref.index}" title="查看原文"><i class="fa fa-eye"></i></button>
                        <button class="ref-action-btn" data-action="delete" data-index="${ref.index}" title="删除"><i class="fa fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');

            // 绑定操作按钮事件
            tbody.querySelectorAll('.ref-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.currentTarget.dataset.action;
                    const index = parseInt(e.currentTarget.dataset.index);
                    this.handleAction(action, index);
                });
            });

            // 绑定复选框事件
            tbody.querySelectorAll('.ref-checkbox').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const index = parseInt(e.currentTarget.dataset.index);
                    if (e.currentTarget.checked) {
                        this.selectedReferences.add(index);
                    } else {
                        this.selectedReferences.delete(index);
                    }
                    this.updateSelectionInfo();
                });
            });
        }

        /**
         * 格式化作者显示
         */
        formatAuthors(authors) {
            if (!authors || authors.length === 0) {
                return '<em>未提取</em>';
            }
            if (authors.length === 1) {
                return authors[0];
            }
            return `${authors[0]} 等 ${authors.length} 人`;
        }

        /**
         * 渲染标签
         */
        renderTags(tags) {
            if (!tags || tags.length === 0) {
                return '-';
            }
            return tags.map(tag => `<span class="ref-tag">${tag}</span>`).join(' ');
        }

        /**
         * 更新统计信息
         */
        updateStats() {
            const stats = global.ReferenceStorage.getStatistics(this.currentDocumentId);
            if (!stats) return;

            const statsEl = document.getElementById('ref-stats');
            if (statsEl) {
                statsEl.innerHTML = `
                    <span>总计: <strong>${stats.total}</strong></span>
                    <span>已验证: <strong>${stats.withDOI}</strong></span>
                    <span>平均置信度: <strong>${(stats.avgConfidence * 100).toFixed(0)}%</strong></span>
                `;
            }
        }

        /**
         * 更新选中信息
         */
        updateSelectionInfo() {
            const info = document.getElementById('ref-selection-info');
            const deleteBtn = document.getElementById('ref-batch-delete-btn');

            if (this.selectedReferences.size === 0) {
                info.textContent = '未选中';
                deleteBtn.disabled = true;
            } else {
                info.textContent = `已选中 ${this.selectedReferences.size} 项`;
                deleteBtn.disabled = false;
            }
        }

        /**
         * 提取文献
         */
        async extractReferences() {
            // 获取当前文档内容
            const markdown = await this.getCurrentDocumentContent();
            if (!markdown) {
                alert('无法获取文档内容');
                return;
            }

            // 检测参考文献
            const section = global.ReferenceDetector.detectReferenceSection(markdown);
            if (!section) {
                alert('未检测到参考文献部分。请确保文档包含"References"或"参考文献"等标题。');
                return;
            }

            console.log(`检测到 ${section.entries.length} 条文献`);

            // 正则提取
            const extracted = global.ReferenceExtractor.batchExtract(section.entries);

            // 显示处理选项
            this.showProcessingOptions(extracted);
        }

        /**
         * 显示处理选项
         */
        showProcessingOptions(extracted) {
            const needsAI = extracted.filter(e => e.needsAIProcessing).length;

            const message = `检测到 ${extracted.length} 条文献\n` +
                          `正则表达式成功提取: ${extracted.length - needsAI} 条\n` +
                          `需要AI处理: ${needsAI} 条\n\n` +
                          `是否使用AI处理剩余文献？`;

            if (needsAI > 0 && confirm(message)) {
                this.processWithAI(extracted);
            } else {
                // 直接保存正则提取的结果
                this.saveExtractedReferences(extracted);
            }
        }

        /**
         * AI处理文献
         */
        async processWithAI(extracted) {
            // 获取API配置
            const apiConfig = await this.getAPIConfig();
            if (!apiConfig) {
                alert('请先配置AI模型');
                return;
            }

            // 显示进度
            this.showProgress('正在使用AI处理文献...');

            try {
                const processed = await global.ReferenceAIProcessor.smartProcessReferences(
                    extracted,
                    apiConfig,
                    'auto',
                    (progress) => {
                        this.updateProgress(
                            `处理进度: ${progress.processed}/${progress.total} (${progress.batchIndex + 1}/${progress.totalBatches} 批)`
                        );
                    }
                );

                this.hideProgress();
                this.saveExtractedReferences(processed);
            } catch (error) {
                this.hideProgress();
                alert('AI处理失败: ' + error.message);
            }
        }

        /**
         * 保存提取的文献
         */
        async saveExtractedReferences(references) {
            // 建立索引
            const markdown = await this.getCurrentDocumentContent();
            if (markdown && window.ReferenceIndexer) {
                const indexedReferences = window.ReferenceIndexer.buildIndex(
                    this.currentDocumentId,
                    markdown,
                    references
                );
                references = indexedReferences;
            }

            const success = global.ReferenceStorage.saveReferences(
                this.currentDocumentId,
                references,
                {
                    extractedAt: new Date().toISOString(),
                    method: 'auto'
                }
            );

            if (success) {
                alert(`成功保存 ${references.length} 条文献`);
                this.loadReferences();
            } else {
                alert('保存失败');
            }
        }

        /**
         * 获取当前文档内容
         */
        async getCurrentDocumentContent() {
            // 方式1: 从 window.data 获取（详情页）
            if (window.data && window.data.ocr) {
                return window.data.ocr;
            }

            // 方式2: 从currentOcrResult获取（主页面）
            if (window.currentOcrResult && window.currentOcrResult.markdown) {
                return window.currentOcrResult.markdown;
            }

            // 方式3: 从currentHistoryData获取
            if (window.currentHistoryData && window.currentHistoryData.ocrResult) {
                return window.currentHistoryData.ocrResult;
            }

            console.error('[ReferenceManagerUI] 无法获取文档内容');
            return null;
        }

        /**
         * 获取API配置（使用与Chatbot相同的配置获取方式）
         */
        async getAPIConfig() {
            // 使用与Chatbot相同的配置获取函数
            if (typeof window.MessageSender?.getChatbotConfig === 'function') {
                const config = window.MessageSender.getChatbotConfig();

                if (!config || !config.apiKey) {
                    alert('请先配置AI模型和API Key');
                    return null;
                }

                // 如果是自定义模型，使用Chatbot的buildCustomApiConfig
                if (config.model === 'custom' || config.model.startsWith('custom_source_')) {
                    const endpoint = config.cms.apiEndpoint || config.cms.apiBaseUrl;

                    if (!endpoint || !config.cms.modelId) {
                        alert('自定义模型配置不完整');
                        return null;
                    }

                    // 使用Chatbot的buildCustomApiConfig函数（保证一致性）
                    if (typeof window.ApiConfigBuilder?.buildCustomApiConfig === 'function') {
                        const builtConfig = window.ApiConfigBuilder.buildCustomApiConfig(
                            config.apiKey,
                            endpoint,
                            config.cms.modelId || config.cms.preferredModelId,
                            config.cms.requestFormat,
                            parseFloat(config.cms.temperature) || 0.1,
                            parseInt(config.cms.max_tokens) || 4000,
                            {
                                endpointMode: config.cms.endpointMode || 'auto'
                            }
                        );

                        console.log('[ReferenceManagerUI] 使用buildCustomApiConfig构建的配置:', builtConfig);
                        return builtConfig;
                    }

                    console.error('[ReferenceManagerUI] buildCustomApiConfig函数不可用');
                    return null;
                }

                // 预设模型
                return global.ReferenceAIProcessor.buildAPIConfig(config.model, config.apiKey);
            }

            // 备用方案：使用旧的获取方式
            const settings = typeof loadSettings === 'function' ? loadSettings() : {};
            const model = settings.selectedTranslationModel || 'gemini';
            const apiKey = settings.apiKeys?.[model] || '';

            if (!apiKey) {
                alert('请先配置AI模型和API Key');
                return null;
            }

            return global.ReferenceAIProcessor.buildAPIConfig(model, apiKey);
        }

        /**
         * 处理操作
         */
        handleAction(action, index) {
            const ref = this.references.find(r => r.index === index);
            if (!ref) return;

            switch (action) {
                case 'edit':
                    this.showEditModal(ref);
                    break;
                case 'view':
                    this.viewInDocument(ref);
                    break;
                case 'delete':
                    if (confirm('确定要删除这条文献吗？')) {
                        this.deleteReference(index);
                    }
                    break;
            }
        }

        /**
         * 显示编辑模态框
         */
        showEditModal(ref = null) {
            if (!document.getElementById('reference-edit-modal')) {
                this.createEditModal();
            }

            const modal = document.getElementById('reference-edit-modal');

            // 填充数据
            if (ref) {
                document.getElementById('edit-authors').value = (ref.authors || []).join(', ');
                document.getElementById('edit-title').value = ref.title || '';
                document.getElementById('edit-year').value = ref.year || '';
                document.getElementById('edit-journal').value = ref.journal || '';
                document.getElementById('edit-volume').value = ref.volume || '';
                document.getElementById('edit-issue').value = ref.issue || '';
                document.getElementById('edit-pages').value = ref.pages || '';
                document.getElementById('edit-doi').value = ref.doi || '';
                document.getElementById('edit-url').value = ref.url || '';
                document.getElementById('edit-type').value = ref.type || 'journal';
                document.getElementById('edit-tags').value = (ref.tags || []).join(', ');
            }

            modal.style.display = 'flex';

            // 绑定保存按钮
            const saveBtn = document.getElementById('ref-edit-save-btn');
            saveBtn.onclick = () => this.saveEdit(ref);

            // 绑定取消按钮
            const cancelBtn = document.getElementById('ref-edit-cancel-btn');
            cancelBtn.onclick = () => {
                modal.style.display = 'none';
            };
        }

        /**
         * 保存编辑
         */
        saveEdit(originalRef) {
            const updates = {
                authors: document.getElementById('edit-authors').value.split(',').map(s => s.trim()).filter(Boolean),
                title: document.getElementById('edit-title').value,
                year: parseInt(document.getElementById('edit-year').value) || null,
                journal: document.getElementById('edit-journal').value,
                volume: document.getElementById('edit-volume').value,
                issue: document.getElementById('edit-issue').value,
                pages: document.getElementById('edit-pages').value,
                doi: document.getElementById('edit-doi').value,
                url: document.getElementById('edit-url').value,
                type: document.getElementById('edit-type').value,
                tags: document.getElementById('edit-tags').value.split(',').map(s => s.trim()).filter(Boolean)
            };

            if (originalRef) {
                // 更新现有文献
                global.ReferenceStorage.updateReference(this.currentDocumentId, originalRef.index, updates);
            } else {
                // 添加新文献
                global.ReferenceStorage.addReference(this.currentDocumentId, updates);
            }

            document.getElementById('reference-edit-modal').style.display = 'none';
            this.loadReferences();
        }

        /**
         * 在文档中查看
         */
        viewInDocument(ref) {
            // 使用索引器滚动到文献在原文中的位置
            if (window.ReferenceIndexer) {
                const success = window.ReferenceIndexer.scrollToReference(
                    this.currentDocumentId,
                    ref.index
                );

                if (success) {
                    // 关闭管理器以显示原文
                    this.closeManager();
                } else {
                    alert('无法定位到原文位置，文献可能不在当前文档中');
                }
            } else {
                console.error('[ReferenceManagerUI] Indexer not available');
                alert('索引器未加载，无法定位原文位置');
            }
        }

        /**
         * 删除文献
         */
        deleteReference(index) {
            global.ReferenceStorage.removeReference(this.currentDocumentId, index);
            this.loadReferences();
        }

        /**
         * 批量删除
         */
        batchDelete() {
            if (!confirm(`确定要删除选中的 ${this.selectedReferences.size} 条文献吗？`)) {
                return;
            }

            // 从大到小删除，避免索引变化
            const indices = Array.from(this.selectedReferences).sort((a, b) => b - a);
            indices.forEach(index => {
                global.ReferenceStorage.removeReference(this.currentDocumentId, index);
            });

            this.selectedReferences.clear();
            this.loadReferences();
        }

        /**
         * 筛选文献
         */
        filterReferences(query) {
            if (!query) {
                this.filteredReferences = [...this.references];
            } else {
                const lowerQuery = query.toLowerCase();
                this.filteredReferences = this.references.filter(ref => {
                    const searchText = [
                        ref.title,
                        ...(ref.authors || []),
                        ref.journal,
                        ref.doi
                    ].filter(Boolean).join(' ').toLowerCase();

                    return searchText.includes(lowerQuery);
                });
            }

            this.renderTable();
        }

        /**
         * 应用筛选器
         */
        applyFilter(filter) {
            switch (filter) {
                case 'all':
                    this.filteredReferences = [...this.references];
                    break;
                case 'recent':
                    this.filteredReferences = this.references.filter(ref =>
                        ref.tags && ref.tags.includes('Recent')
                    );
                    break;
                case 'classic':
                    this.filteredReferences = this.references.filter(ref =>
                        ref.tags && ref.tags.includes('Classic')
                    );
                    break;
                case 'verified':
                    this.filteredReferences = this.references.filter(ref => ref.doi);
                    break;
            }

            this.renderTable();
        }

        /**
         * 排序表格
         */
        sortTable(column) {
            if (this.sortColumn === column) {
                this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortColumn = column;
                this.sortDirection = 'asc';
            }

            this.filteredReferences.sort((a, b) => {
                let aVal = a[column];
                let bVal = b[column];

                if (column === 'authors') {
                    aVal = (a.authors || [])[0] || '';
                    bVal = (b.authors || [])[0] || '';
                }

                if (aVal === bVal) return 0;
                if (aVal == null) return 1;
                if (bVal == null) return -1;

                const comparison = aVal < bVal ? -1 : 1;
                return this.sortDirection === 'asc' ? comparison : -comparison;
            });

            this.renderTable();
        }

        /**
         * 全选/取消全选
         */
        toggleSelectAll(checked) {
            this.selectedReferences.clear();

            if (checked) {
                this.filteredReferences.forEach(ref => {
                    this.selectedReferences.add(ref.index);
                });
            }

            document.querySelectorAll('.ref-checkbox').forEach(checkbox => {
                checkbox.checked = checked;
            });

            this.updateSelectionInfo();
        }

        /**
         * 显示导出菜单
         */
        showExportMenu() {
            const options = ['BibTeX', 'JSON', 'CSV'];
            const choice = prompt(`选择导出格式:\n${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`);

            if (!choice) return;

            const index = parseInt(choice) - 1;
            if (index >= 0 && index < options.length) {
                this.exportReferences(options[index].toLowerCase());
            }
        }

        /**
         * 导出文献
         */
        exportReferences(format) {
            let content = '';
            let filename = '';

            switch (format) {
                case 'bibtex':
                    content = global.ReferenceStorage.exportToBibTeX(this.currentDocumentId);
                    filename = 'references.bib';
                    break;
                case 'json':
                    content = global.ReferenceStorage.exportToJSON(this.currentDocumentId);
                    filename = 'references.json';
                    break;
                case 'csv':
                    content = this.exportToCSV();
                    filename = 'references.csv';
                    break;
            }

            if (content) {
                this.downloadFile(content, filename);
            }
        }

        /**
         * 导出为CSV
         */
        exportToCSV() {
            const headers = ['Index', 'Authors', 'Title', 'Year', 'Journal', 'Volume', 'Issue', 'Pages', 'DOI', 'URL', 'Type', 'Tags'];
            const rows = this.references.map(ref => [
                ref.index + 1,
                (ref.authors || []).join('; '),
                ref.title || '',
                ref.year || '',
                ref.journal || '',
                ref.volume || '',
                ref.issue || '',
                ref.pages || '',
                ref.doi || '',
                ref.url || '',
                ref.type || '',
                (ref.tags || []).join('; ')
            ]);

            const csv = [headers, ...rows].map(row =>
                row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
            ).join('\n');

            return csv;
        }

        /**
         * 下载文件
         */
        downloadFile(content, filename) {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }

        /**
         * 显示进度
         */
        showProgress(message) {
            // 简单实现，可以改进为更好的进度条
            const progress = document.createElement('div');
            progress.id = 'ref-progress';
            progress.className = 'ref-progress';
            progress.innerHTML = `<div class="ref-progress-content">${message}</div>`;
            document.body.appendChild(progress);
        }

        /**
         * 更新进度
         */
        updateProgress(message) {
            const progress = document.getElementById('ref-progress');
            if (progress) {
                progress.querySelector('.ref-progress-content').textContent = message;
            }
        }

        /**
         * 隐藏进度
         */
        hideProgress() {
            const progress = document.getElementById('ref-progress');
            if (progress) {
                progress.remove();
            }
        }
    }

    // 创建全局实例
    const ui = new ReferenceManagerUI();

    // 导出API
    global.ReferenceManagerUI = ui;

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ui.initialize());
    } else {
        ui.initialize();
    }

    console.log('[ReferenceManagerUI] Reference manager UI loaded.');

})(window);

