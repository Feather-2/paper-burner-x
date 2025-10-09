// js/ui/reference-manager-detail.js
// 参考文献管理器 - 详情页专用版本

(function(global) {
    'use strict';

    let currentDocumentId = null;
    let currentReferences = [];
    let isFloatingPanelOpen = false;

    /**
     * 初始化参考文献管理器（详情页版本）
     */
    function initReferenceManagerForDetail() {
        // 获取文档ID
        const urlParams = new URLSearchParams(window.location.search);
        currentDocumentId = urlParams.get('id');

        if (!currentDocumentId) {
            console.warn('[ReferenceManagerDetail] No document ID found');
            return;
        }

        // 绑定dock点击事件
        bindDockClickEvent();

        // 监听内容渲染完成事件
        document.addEventListener('contentRendered', () => {
            loadAndDisplayReferences();
        });

        // 创建悬浮面板
        createFloatingPanel();

        console.log('[ReferenceManagerDetail] Initialized for document:', currentDocumentId);
    }

    /**
     * 绑定dock点击事件
     */
    function bindDockClickEvent() {
        const refStat = document.querySelector('[data-stat-type="reference"]');
        if (refStat) {
            refStat.addEventListener('click', (e) => {
                e.preventDefault();
                toggleFloatingPanel();
            });
            refStat.style.cursor = 'pointer';
        }
    }

    /**
     * 加载并显示参考文献
     */
    function loadAndDisplayReferences() {
        // 从存储加载
        const data = global.ReferenceStorage?.loadReferences(currentDocumentId);

        if (data && data.references) {
            currentReferences = data.references;
            updateReferenceCount(currentReferences.length);
            appendReferencesToContent(currentReferences);
            addToTOC();
        } else {
            // 尝试自动提取
            autoExtractReferences();
        }
    }

    /**
     * 自动提取参考文献
     */
    async function autoExtractReferences() {
        const markdown = await getCurrentMarkdownContent();
        if (!markdown) return;

        const section = global.ReferenceDetector?.detectReferenceSection(markdown);
        if (!section || section.entries.length === 0) {
            console.log('[ReferenceManagerDetail] No references detected');
            return;
        }

        console.log(`[ReferenceManagerDetail] Auto-detected ${section.entries.length} references`);

        // 正则提取
        const extracted = global.ReferenceExtractor?.batchExtract(section.entries) || section.entries;

        // 建立索引
        if (global.ReferenceIndexer) {
            currentReferences = global.ReferenceIndexer.buildIndex(
                currentDocumentId,
                markdown,
                extracted
            );
        } else {
            currentReferences = extracted;
        }

        // 保存
        global.ReferenceStorage?.saveReferences(
            currentDocumentId,
            currentReferences,
            {
                extractedAt: new Date().toISOString(),
                method: 'auto'
            }
        );

        // 显示
        updateReferenceCount(currentReferences.length);
        appendReferencesToContent(currentReferences);
        addToTOC();
    }

    /**
     * 在内容末尾添加参考文献列表
     */
    function appendReferencesToContent(references) {
        if (!references || references.length === 0) return;

        // 查找内容容器
        const containers = ['#tab-ocr-content', '#tab-translation-content'];

        containers.forEach(selector => {
            const container = document.querySelector(selector);
            if (!container) return;

            // 移除已存在的参考文献区域
            const existing = container.querySelector('.reference-section');
            if (existing) {
                existing.remove();
            }

            // 创建参考文献区域
            const refSection = document.createElement('div');
            refSection.className = 'reference-section';
            refSection.id = 'references-section';
            refSection.innerHTML = `
                <div class="reference-section-header">
                    <h2>参考文献 (${references.length})</h2>
                    <div class="reference-section-actions">
                        <button class="ref-manage-btn" onclick="window.toggleReferencePanel()">
                            <i class="fa fa-cog"></i> 管理
                        </button>
                        <button class="ref-extract-btn" onclick="window.extractReferencesFromContent()">
                            <i class="fa fa-sync"></i> 重新提取
                        </button>
                    </div>
                </div>
                <div class="reference-list">
                    ${renderReferenceList(references)}
                </div>
            `;

            container.appendChild(refSection);
        });
    }

    /**
     * 渲染参考文献列表
     */
    function renderReferenceList(references) {
        return references.map((ref, idx) => `
            <div class="reference-item" data-ref-index="${idx}" data-ref-id="ref-${idx + 1}">
                <div class="reference-number">[${idx + 1}]</div>
                <div class="reference-content">
                    <div class="reference-meta">
                        ${renderAuthors(ref.authors)}
                        ${ref.year ? `<span class="ref-year">(${ref.year})</span>` : ''}
                    </div>
                    ${ref.title ? `<div class="reference-title">${ref.title}</div>` : ''}
                    ${ref.journal ? `<div class="reference-journal"><em>${ref.journal}</em></div>` : ''}
                    ${renderDetails(ref)}
                    ${ref.doi ? `<div class="reference-doi">DOI: <a href="https://doi.org/${ref.doi}" target="_blank">${ref.doi}</a></div>` : ''}
                    ${renderTags(ref.tags)}
                </div>
                <div class="reference-actions">
                    <button class="ref-action-icon" onclick="window.viewReferenceInText(${idx})" title="查看原文位置">
                        <i class="fa fa-eye"></i>
                    </button>
                    <button class="ref-action-icon" onclick="window.editReference(${idx})" title="编辑">
                        <i class="fa fa-edit"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    /**
     * 渲染作者
     */
    function renderAuthors(authors) {
        if (!authors || authors.length === 0) return '<span class="ref-authors">作者未知</span>';

        if (authors.length === 1) {
            return `<span class="ref-authors">${authors[0]}</span>`;
        }

        return `<span class="ref-authors">${authors[0]} 等 ${authors.length} 人</span>`;
    }

    /**
     * 渲染详细信息
     */
    function renderDetails(ref) {
        const parts = [];
        if (ref.volume) parts.push(`Vol. ${ref.volume}`);
        if (ref.issue) parts.push(`No. ${ref.issue}`);
        if (ref.pages) parts.push(`pp. ${ref.pages}`);

        return parts.length > 0 ? `<div class="reference-details">${parts.join(', ')}</div>` : '';
    }

    /**
     * 渲染标签
     */
    function renderTags(tags) {
        if (!tags || tags.length === 0) return '';

        return `<div class="reference-tags">
            ${tags.map(tag => `<span class="ref-tag-small">${tag}</span>`).join('')}
        </div>`;
    }

    /**
     * 添加到TOC
     */
    function addToTOC() {
        const tocList = document.getElementById('toc-list');
        if (!tocList) return;

        // 移除已存在的文献链接
        const existing = tocList.querySelector('.toc-reference-link');
        if (existing) {
            existing.remove();
        }

        // 添加新链接
        const li = document.createElement('li');
        li.className = 'toc-reference-link';
        li.innerHTML = `
            <a href="#references-section" class="toc-ref-link">
                <i class="fa fa-book"></i> 参考文献 (${currentReferences.length})
            </a>
        `;
        tocList.appendChild(li);
    }

    /**
     * 更新文献计数
     */
    function updateReferenceCount(count) {
        const countEl = document.getElementById('reference-count');
        if (countEl) {
            countEl.textContent = count;
        }
    }

    /**
     * 创建悬浮面板（类似chatbot）
     */
    function createFloatingPanel() {
        const panel = document.createElement('div');
        panel.id = 'reference-floating-panel';
        panel.className = 'reference-floating-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
            <div class="reference-panel-header">
                <h3><i class="fa fa-book"></i> 参考文献管理</h3>
                <div class="reference-panel-actions">
                    <button class="ref-panel-minimize" onclick="window.toggleReferencePanel()">
                        <i class="fa fa-minus"></i>
                    </button>
                    <button class="ref-panel-close" onclick="window.toggleReferencePanel()">
                        <i class="fa fa-times"></i>
                    </button>
                </div>
            </div>
            <div class="reference-panel-toolbar">
                <button class="ref-toolbar-btn" onclick="window.extractReferencesFromContent()">
                    <i class="fa fa-sync"></i> 提取
                </button>
                <button class="ref-toolbar-btn" onclick="window.showFullReferenceManager()">
                    <i class="fa fa-th"></i> 完整管理
                </button>
                <button class="ref-toolbar-btn" onclick="window.exportReferences()">
                    <i class="fa fa-download"></i> 导出
                </button>
            </div>
            <div class="reference-panel-content" id="reference-panel-content">
                <div class="ref-panel-placeholder">
                    <i class="fa fa-book fa-3x"></i>
                    <p>暂无文献数据</p>
                    <button onclick="window.extractReferencesFromContent()">提取文献</button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // 使面板可拖拽
        makePanelDraggable(panel);
    }

    /**
     * 使面板可拖拽
     */
    function makePanelDraggable(panel) {
        const header = panel.querySelector('.reference-panel-header');
        let isDragging = false;
        let currentX, currentY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;

            isDragging = true;
            initialX = e.clientX - panel.offsetLeft;
            initialY = e.clientY - panel.offsetTop;
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            panel.style.left = currentX + 'px';
            panel.style.top = currentY + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            header.style.cursor = 'grab';
        });
    }

    /**
     * 切换悬浮面板
     */
    function toggleFloatingPanel() {
        const panel = document.getElementById('reference-floating-panel');
        if (!panel) return;

        if (isFloatingPanelOpen) {
            panel.style.display = 'none';
            isFloatingPanelOpen = false;
        } else {
            panel.style.display = 'flex';
            isFloatingPanelOpen = true;
            updatePanelContent();
        }
    }

    /**
     * 更新面板内容
     */
    function updatePanelContent() {
        const content = document.getElementById('reference-panel-content');
        if (!content) return;

        if (currentReferences.length === 0) {
            content.innerHTML = `
                <div class="ref-panel-placeholder">
                    <i class="fa fa-book fa-3x"></i>
                    <p>暂无文献数据</p>
                    <button onclick="window.extractReferencesFromContent()">提取文献</button>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div class="ref-panel-list">
                    ${renderPanelList(currentReferences)}
                </div>
            `;
        }
    }

    /**
     * 渲染面板列表
     */
    function renderPanelList(references) {
        return references.map((ref, idx) => `
            <div class="ref-panel-item" onclick="window.viewReferenceInText(${idx})">
                <div class="ref-panel-number">[${idx + 1}]</div>
                <div class="ref-panel-info">
                    <div class="ref-panel-title">${ref.title || '未提取标题'}</div>
                    <div class="ref-panel-authors">${renderAuthors(ref.authors)}</div>
                    ${ref.year ? `<div class="ref-panel-year">${ref.year}</div>` : ''}
                </div>
            </div>
        `).join('');
    }

    /**
     * 获取当前Markdown内容
     */
    async function getCurrentMarkdownContent() {
        // 方式1: 从 window.data 获取（详情页使用）
        if (window.data && window.data.ocr) {
            console.log('[ReferenceManagerDetail] 使用 window.data.ocr，长度:', window.data.ocr.length);
            return window.data.ocr;
        }

        // 方式2: 从currentHistoryData获取
        if (window.currentHistoryData && window.currentHistoryData.ocrResult) {
            console.log('[ReferenceManagerDetail] 使用 currentHistoryData.ocrResult');
            return window.currentHistoryData.ocrResult;
        }

        // 方式3: 从DOM中的文本内容获取
        const ocrContent = document.querySelector('#tab-ocr-content, #ocr-content-wrapper');
        if (ocrContent && ocrContent.textContent) {
            console.log('[ReferenceManagerDetail] 使用 DOM textContent');
            return ocrContent.textContent;
        }

        console.error('[ReferenceManagerDetail] 无法获取文档内容，尝试的方法:', {
            hasWindowData: !!window.data,
            hasOcr: !!(window.data && window.data.ocr),
            hasCurrentHistoryData: !!window.currentHistoryData,
            hasDOMContent: !!document.querySelector('#tab-ocr-content, #ocr-content-wrapper')
        });
        return null;
    }

    /**
     * 全局函数：切换面板
     */
    global.toggleReferencePanel = function() {
        toggleFloatingPanel();
    };

    /**
     * 全局函数：提取文献
     */
    global.extractReferencesFromContent = async function() {
        const markdown = await getCurrentMarkdownContent();
        if (!markdown) {
            alert('无法获取文档内容');
            return;
        }

        const section = global.ReferenceDetector?.detectReferenceSection(markdown);
        if (!section) {
            alert('未检测到参考文献部分');
            return;
        }

        // 显示处理选项
        showExtractionDialog(section.entries);
    };

    /**
     * 显示提取对话框
     */
    function showExtractionDialog(entries) {
        const message = `检测到 ${entries.length} 条文献\n\n` +
                       `将使用AI批量提取完整信息\n` +
                       `（每批10条，并发处理）\n\n` +
                       `是否继续？`;

        if (confirm(message)) {
            // 直接使用AI处理全部文献
            const simpleEntries = entries.map((e, idx) => ({
                index: idx,
                rawText: e.rawText || e
            }));
            processWithAI(simpleEntries);
        }
    }

    /**
     * 使用AI处理文献
     */
    async function processWithAI(extracted) {
        // 获取API配置（使用与Chatbot相同的方式）
        const apiConfig = await getAPIConfig();
        if (!apiConfig) {
            return;
        }

        console.log('[ReferenceManagerDetail] 开始AI批量处理，总数:', extracted.length);

        try {
            // 提取原始文本
            const rawTexts = extracted.map(e => e.rawText || (typeof e === 'string' ? e : ''));

            // 使用批量处理API
            const processed = await global.ReferenceAIProcessor.batchProcessReferences(
                rawTexts,
                apiConfig,
                'auto',
                (progress) => {
                    const percent = Math.round((progress.processed / progress.total) * 100);
                    console.log(`[AI处理] ${progress.processed}/${progress.total} (${percent}%) - 批次 ${progress.batchIndex + 1}/${progress.totalBatches}`);
                }
            );

            // 合并原始信息
            const finalReferences = processed.map((ref, idx) => ({
                ...ref,
                index: idx,
                rawText: rawTexts[idx],
                extractedBy: 'ai',
                confidence: 0.9
            }));

            saveExtractedReferences(finalReferences);
            alert(`AI处理完成\n共提取 ${finalReferences.length} 条文献`);
        } catch (error) {
            console.error('[ReferenceManagerDetail] AI处理失败:', error);
            alert('AI处理失败: ' + error.message + '\n\n请检查模型配置和API Key');
        }
    }

    /**
     * 获取API配置（使用与Chatbot相同的方式）
     */
    async function getAPIConfig() {
        // 使用Chatbot的配置获取函数
        if (typeof window.MessageSender?.getChatbotConfig === 'function') {
            const config = window.MessageSender.getChatbotConfig();

            if (!config || !config.apiKey) {
                alert('请先配置AI模型和API Key\n\n提示：打开Chatbot设置配置模型');
                return null;
            }

            console.log('[ReferenceManagerDetail] 获取到配置:', {
                model: config.model,
                hasApiKey: !!config.apiKey,
                cms: config.cms
            });

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

                    console.log('[ReferenceManagerDetail] 使用buildCustomApiConfig构建的配置:', builtConfig);
                    return builtConfig;
                }

                console.error('[ReferenceManagerDetail] buildCustomApiConfig函数不可用');
                return null;
            }

            // 预设模型
            return global.ReferenceAIProcessor.buildAPIConfig(config.model, config.apiKey);
        }

        alert('无法获取AI配置，请确保Chatbot模块已加载');
        return null;
    }

    /**
     * 保存提取的文献
     */
    async function saveExtractedReferences(references) {
        const markdown = await getCurrentMarkdownContent();

        // 建立索引
        if (markdown && global.ReferenceIndexer) {
            references = global.ReferenceIndexer.buildIndex(
                currentDocumentId,
                markdown,
                references
            );
        }

        // 保存
        global.ReferenceStorage?.saveReferences(
            currentDocumentId,
            references,
            {
                extractedAt: new Date().toISOString(),
                method: 'auto'
            }
        );

        currentReferences = references;
        updateReferenceCount(references.length);
        appendReferencesToContent(references);
        addToTOC();
        updatePanelContent();

        alert(`成功提取 ${references.length} 条文献`);
    }

    /**
     * 全局函数：查看文献在原文中的位置
     */
    global.viewReferenceInText = function(index) {
        if (global.ReferenceIndexer) {
            global.ReferenceIndexer.scrollToReference(currentDocumentId, index);
        }
    };

    /**
     * 全局函数：编辑文献
     */
    global.editReference = function(index) {
        // 打开完整管理器并定位到该文献
        if (global.ReferenceManagerUI) {
            global.ReferenceManagerUI.show(currentDocumentId);
            // TODO: 定位到特定文献
        }
    };

    /**
     * 全局函数：显示完整管理器
     */
    global.showFullReferenceManager = function() {
        if (global.ReferenceManagerUI) {
            global.ReferenceManagerUI.show(currentDocumentId);
        }
    };

    /**
     * 全局函数：导出文献
     */
    global.exportReferences = function() {
        const format = prompt('选择导出格式:\n1. BibTeX\n2. JSON\n3. CSV\n\n请输入数字:');

        if (!format) return;

        let content = '';
        let filename = '';

        switch (format) {
            case '1':
                content = global.ReferenceStorage?.exportToBibTeX(currentDocumentId) || '';
                filename = 'references.bib';
                break;
            case '2':
                content = global.ReferenceStorage?.exportToJSON(currentDocumentId) || '';
                filename = 'references.json';
                break;
            case '3':
                content = exportToCSV();
                filename = 'references.csv';
                break;
            default:
                alert('无效的选择');
                return;
        }

        if (content) {
            downloadFile(content, filename);
        }
    };

    /**
     * 导出为CSV
     */
    function exportToCSV() {
        const headers = ['Index', 'Authors', 'Title', 'Year', 'Journal', 'DOI'];
        const rows = currentReferences.map((ref, idx) => [
            idx + 1,
            (ref.authors || []).join('; '),
            ref.title || '',
            ref.year || '',
            ref.journal || '',
            ref.doi || ''
        ]);

        const csv = [headers, ...rows].map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        return csv;
    }

    /**
     * 下载文件
     */
    function downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initReferenceManagerForDetail);
    } else {
        initReferenceManagerForDetail();
    }

    console.log('[ReferenceManagerDetail] Module loaded.');

})(window);

