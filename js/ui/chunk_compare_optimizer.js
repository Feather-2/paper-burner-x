/**
 * 分块对比预览性能优化器
 * 解决历史详情页分块对比的渲染性能问题
 */

class ChunkCompareOptimizer {
    constructor() {
        this.renderCache = new Map();
        this.visibleChunks = new Set();
        this.currentScrollPosition = 0;
        this.observer = null;
        this.renderQueue = [];
        this.isRendering = false;
        this.batchSize = 3; // 每批渲染的分块数量
        this.chunkHeight = 300; // 估算的分块高度
        this.bufferSize = 2; // 缓冲区大小（上下各2个分块）
    }

    /**
     * 初始化优化器
     */
    init() {
        this.setupIntersectionObserver();
        this.setupPerformanceMonitor();
    }

    /**
     * 优化分块对比的渲染性能
     * @param {Array} ocrChunks OCR分块数据
     * @param {Array} translatedChunks 翻译分块数据
     * @param {Object} options 渲染选项
     * @returns {string} 优化后的HTML
     */
    optimizeChunkComparison(ocrChunks, translatedChunks, options = {}) {
        const startTime = performance.now();
        const chunkCount = ocrChunks.length;
        console.log(`[ChunkOptimizer] 开始优化渲染 ${chunkCount} 个分块`);

        // 创建带骨架屏的容器
        const containerHTML = this.createSkeletonContainer(chunkCount);
        
        // 异步开始渲染
        setTimeout(() => {
            this.scheduleProgressiveRender(ocrChunks, translatedChunks, options);
        }, 100);
        
        const endTime = performance.now();
        console.log(`[ChunkOptimizer] 初始化完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);
        
        return containerHTML;
    }

    /**
     * 创建带骨架屏的容器
     * @param {number} chunkCount 分块数量
     * @returns {string} 容器HTML
     */
    createSkeletonContainer(chunkCount) {
        return `
            <div class="chunk-compare-container" id="chunk-compare-container">
                <div class="visible-chunks-container" id="visible-chunks-container">
                    <!-- 分块将在这里渲染 -->
                </div>
            </div>
        `;
    }

    /**
     * 生成骨架屏分块
     * @param {number} count 骨架数量
     * @returns {string} 骨架HTML
     */
    generateSkeletonChunks(count) {
        let skeletonHTML = '';
        for (let i = 0; i < count; i++) {
            skeletonHTML += `
                <div class="chunk-pair skeleton-chunk">
                    <div class="block-outer">
                        <div class="chunk-header">
                            <div class="skeleton-line skeleton-title"></div>
                            <div class="skeleton-stats">
                                <div class="skeleton-line skeleton-stat"></div>
                                <div class="skeleton-line skeleton-stat"></div>
                            </div>
                        </div>
                        <div class="chunk-preview-container">
                            <div class="chunk-preview-row">
                                <div class="chunk-preview">
                                    <div class="skeleton-line skeleton-label"></div>
                                    <div class="skeleton-content">
                                        <div class="skeleton-line"></div>
                                        <div class="skeleton-line"></div>
                                        <div class="skeleton-line skeleton-short"></div>
                                    </div>
                                </div>
                                <div class="chunk-preview">
                                    <div class="skeleton-line skeleton-label"></div>
                                    <div class="skeleton-content">
                                        <div class="skeleton-line"></div>
                                        <div class="skeleton-line"></div>
                                        <div class="skeleton-line skeleton-short"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="skeleton-button"></div>
                        </div>
                    </div>
                </div>
            `;
        }
        return skeletonHTML;
    }

    /**
     * 为超大文档创建特殊容器
     * @param {number} chunkCount 分块数量
     * @param {Array} ocrChunks OCR分块
     * @param {Array} translatedChunks 翻译分块
     * @param {Object} options 选项
     * @returns {string} 容器HTML
     */
    createLargeDocumentContainer(chunkCount, ocrChunks, translatedChunks, options) {
        // 立即保存数据到window对象供后续使用
        window.largeDocumentData = {
            ocrChunks,
            translatedChunks,
            options,
            currentPage: 0,
            pageSize: 10 // 每页显示10个分块
        };

        const totalPages = Math.ceil(chunkCount / 10);
        
        return `
            <div class="chunk-compare-title-bar">
                <h3>分块对比 <span class="chunk-count">(${chunkCount}块)</span></h3>
                <div class="chunk-controls">
                    <button id="swap-chunks-btn" title="切换原文/译文位置">⇆</button>
                    <button id="performance-toggle-btn" title="切换性能模式" class="performance-btn active">⚡</button>
                </div>
            </div>
            <div class="large-document-notice">
                <i class="fas fa-info-circle"></i>
                <span>检测到大型文档，已启用高效浏览模式。使用分页浏览以获得更好的性能。</span>
            </div>
            <div class="chunk-pagination">
                <button id="prev-page-btn" onclick="ChunkCompareOptimizer.instance.navigateToPage(-1)" disabled>
                    ← 上一页
                </button>
                <span class="page-info">
                    第 <span id="current-page">1</span> 页，共 ${totalPages} 页
                </span>
                <button id="next-page-btn" onclick="ChunkCompareOptimizer.instance.navigateToPage(1)">
                    下一页 →
                </button>
                <div class="page-jump">
                    跳转到第 
                    <input type="number" id="page-input" min="1" max="${totalPages}" value="1" style="width: 60px;">
                    页
                    <button onclick="ChunkCompareOptimizer.instance.jumpToPage()">跳转</button>
                </div>
            </div>
            <div class="chunk-compare-container large-document-mode" id="chunk-compare-container">
                <div class="visible-chunks-container" id="visible-chunks-container">
                    ${this.renderPageChunks(0, ocrChunks, translatedChunks, options)}
                </div>
                <div class="chunk-loading-indicator" style="display: none;">
                    <div class="loading-spinner"></div>
                    <span>正在加载分块...</span>
                </div>
            </div>
        `;
    }

    /**
     * 渲染指定页的分块
     * @param {number} pageIndex 页索引
     * @param {Array} ocrChunks OCR分块
     * @param {Array} translatedChunks 翻译分块
     * @param {Object} options 选项
     * @returns {string} 分块HTML
     */
    renderPageChunks(pageIndex, ocrChunks, translatedChunks, options) {
        const pageSize = 10;
        const startIndex = pageIndex * pageSize;
        const endIndex = Math.min(startIndex + pageSize, ocrChunks.length);
        
        let html = '';
        for (let i = startIndex; i < endIndex; i++) {
            const chunkElement = this.renderSingleChunkImmediate({
                index: i,
                ocrChunk: ocrChunks[i],
                translatedChunk: translatedChunks[i],
                options
            });
            html += chunkElement;
        }
        
        return html;
    }

    /**
     * 立即渲染单个分块（用于分页模式）
     * @param {Object} item 分块数据
     * @returns {string} 分块HTML
     */
    renderSingleChunkImmediate(item) {
        const { index, ocrChunk, translatedChunk, options } = item;
        const ocrPreview = this.getContentPreview(ocrChunk);
        const transPreview = this.getContentPreview(translatedChunk);
        
        return `
            <div class="chunk-pair optimized-chunk large-doc-chunk" data-chunk-index="${index}" id="chunk-${index}">
                <div class="block-outer" data-block-index="${index}">
                    <div class="chunk-header">
                        <h4>第 ${index + 1} 块</h4>
                        <div class="chunk-stats">
                            <span class="char-count">原文: ${ocrChunk.length}字</span>
                            <span class="char-count">译文: ${translatedChunk.length}字</span>
                        </div>
                    </div>
                    <div class="chunk-preview-container" data-lazy-load="true">
                        <div class="chunk-preview-row">
                            <div class="chunk-preview ocr-preview">
                                <div class="preview-label">原文预览:</div>
                                <div class="preview-content">${ocrPreview}</div>
                            </div>
                            <div class="chunk-preview trans-preview">
                                <div class="preview-label">译文预览:</div>
                                <div class="preview-content">${transPreview}</div>
                            </div>
                        </div>
                        <div class="chunk-actions">
                            <button class="load-full-content-btn" onclick="ChunkCompareOptimizer.instance.loadFullChunk(${index})">
                                展开完整内容
                            </button>
                            <button class="copy-chunk-btn" onclick="ChunkCompareOptimizer.instance.copyChunkContent(${index})">
                                复制内容
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 导航到指定页面
     * @param {number} direction 方向 (-1上一页, 1下一页)
     */
    navigateToPage(direction) {
        if (!window.largeDocumentData) return;
        
        const data = window.largeDocumentData;
        const totalPages = Math.ceil(data.ocrChunks.length / data.pageSize);
        const newPage = Math.max(0, Math.min(totalPages - 1, data.currentPage + direction));
        
        if (newPage === data.currentPage) return;
        
        this.loadPage(newPage);
    }

    /**
     * 跳转到指定页面
     */
    jumpToPage() {
        const pageInput = document.getElementById('page-input');
        if (!pageInput || !window.largeDocumentData) return;
        
        const targetPage = parseInt(pageInput.value) - 1; // 转换为0基索引
        this.loadPage(targetPage);
    }

    /**
     * 加载指定页面
     * @param {number} pageIndex 页索引
     */
    loadPage(pageIndex) {
        if (!window.largeDocumentData) return;
        
        const data = window.largeDocumentData;
        const totalPages = Math.ceil(data.ocrChunks.length / data.pageSize);
        
        if (pageIndex < 0 || pageIndex >= totalPages) return;
        
        console.log(`[ChunkOptimizer] 加载第 ${pageIndex + 1} 页`);
        
        // 显示加载指示器
        const loadingIndicator = document.querySelector('.chunk-loading-indicator');
        if (loadingIndicator) loadingIndicator.style.display = 'flex';
        
        // 更新页面内容
        setTimeout(() => {
            const container = document.getElementById('visible-chunks-container');
            if (container) {
                container.innerHTML = this.renderPageChunks(
                    pageIndex, 
                    data.ocrChunks, 
                    data.translatedChunks, 
                    data.options
                );
            }
            
            // 更新页面状态
            data.currentPage = pageIndex;
            
            // 更新UI
            this.updatePageUI(pageIndex, totalPages);
            
            // 隐藏加载指示器
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            
            // 滚动到顶部
            const chunkContainer = document.getElementById('chunk-compare-container');
            if (chunkContainer) chunkContainer.scrollTop = 0;
            
        }, 100);
    }

    /**
     * 更新分页UI
     * @param {number} currentPage 当前页
     * @param {number} totalPages 总页数
     */
    updatePageUI(currentPage, totalPages) {
        const currentPageSpan = document.getElementById('current-page');
        const pageInput = document.getElementById('page-input');
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');
        
        if (currentPageSpan) currentPageSpan.textContent = currentPage + 1;
        if (pageInput) pageInput.value = currentPage + 1;
        if (prevBtn) prevBtn.disabled = currentPage === 0;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages - 1;
    }

    /**
     * 复制分块内容
     * @param {number} chunkIndex 分块索引
     */
    copyChunkContent(chunkIndex) {
        if (!window.largeDocumentData) return;
        
        const data = window.largeDocumentData;
        const ocrContent = data.ocrChunks[chunkIndex] || '';
        const transContent = data.translatedChunks[chunkIndex] || '';
        
        const contentToCopy = `第 ${chunkIndex + 1} 块内容:\n\n原文:\n${ocrContent}\n\n译文:\n${transContent}`;
        
        navigator.clipboard.writeText(contentToCopy)
            .then(() => {
                // 显示复制成功提示
                this.showTemporaryMessage(`第 ${chunkIndex + 1} 块内容已复制到剪贴板`);
            })
            .catch(err => {
                console.error('复制失败:', err);
                this.showTemporaryMessage('复制失败，请手动选择复制', 'error');
            });
    }

    /**
     * 显示临时消息
     * @param {string} message 消息内容
     * @param {string} type 消息类型
     */
    showTemporaryMessage(message, type = 'success') {
        const messageEl = document.createElement('div');
        messageEl.className = `temp-message temp-message-${type}`;
        messageEl.textContent = message;
        messageEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : '#ef4444'};
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000;
            font-size: 0.9em;
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s ease;
        `;
        
        document.body.appendChild(messageEl);
        
        // 显示动画
        setTimeout(() => {
            messageEl.style.opacity = '1';
            messageEl.style.transform = 'translateY(0)';
        }, 10);
        
        // 3秒后移除
        setTimeout(() => {
            messageEl.style.opacity = '0';
            messageEl.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (messageEl.parentElement) {
                    messageEl.remove();
                }
            }, 300);
        }, 3000);
    }

    /**
     * 创建虚拟化容器
     * @param {number} totalChunks 总分块数量
     * @returns {string} 容器HTML
     */
    createVirtualContainer(totalChunks) {
        // 对于大量分块，不使用虚拟化高度占位，避免巨大空白
        const useVirtualization = totalChunks > 20;
        const estimatedHeight = useVirtualization ? 0 : totalChunks * this.chunkHeight;
        
        return `
            <div class="chunk-compare-title-bar">
                <h3>分块对比 <span class="chunk-count">(${totalChunks}块)</span></h3>
                <div class="chunk-controls">
                    <button id="swap-chunks-btn" title="切换原文/译文位置">⇆</button>
                    <button id="performance-toggle-btn" title="切换性能模式" class="performance-btn">⚡</button>
                </div>
            </div>
            <div class="chunk-compare-container" id="chunk-compare-container" style="position: relative;">
                <div class="visible-chunks-container" id="visible-chunks-container">
                    <!-- 动态渲染的分块将出现在这里 -->
                </div>
                <div class="chunk-loading-indicator" style="display: none;">
                    <div class="loading-spinner"></div>
                    <span>正在渲染分块...</span>
                </div>
            </div>
        `;
    }

    /**
     * 计划分批渲染
     * @param {Array} ocrChunks OCR分块
     * @param {Array} translatedChunks 翻译分块
     * @param {Object} options 选项
     */
    scheduleProgressiveRender(ocrChunks, translatedChunks, options) {
        this.renderQueue = [];
        
        // 对于大量分块，采用更保守的渲染策略
        const isLargeDocument = ocrChunks.length > 50;
        const initialRenderCount = isLargeDocument ? 
            Math.min(3, ocrChunks.length) : // 大文档只渲染前3块
            Math.min(this.batchSize, ocrChunks.length);
        
        // 调整批次大小
        const dynamicBatchSize = isLargeDocument ? 2 : this.batchSize;
        
        for (let i = 0; i < ocrChunks.length; i++) {
            this.renderQueue.push({
                index: i,
                ocrChunk: ocrChunks[i],
                translatedChunk: translatedChunks[i],
                priority: i < initialRenderCount ? 'high' : 'normal',
                options
            });
        }

        // 更新批次大小
        this.currentBatchSize = dynamicBatchSize;

        // 开始渲染
        this.processRenderQueue();
    }

    /**
     * 处理渲染队列
     */
    async processRenderQueue() {
        if (this.isRendering) return;
        this.isRendering = true;

        const container = document.getElementById('visible-chunks-container');
        
        if (!container) {
            this.isRendering = false;
            return;
        }

        // 按优先级排序
        this.renderQueue.sort((a, b) => {
            if (a.priority === 'high' && b.priority !== 'high') return -1;
            if (a.priority !== 'high' && b.priority === 'high') return 1;
            return a.index - b.index;
        });

        let rendered = 0;
        const total = this.renderQueue.length;

        while (this.renderQueue.length > 0) {
            const currentBatchSize = this.currentBatchSize || this.batchSize;
            const batch = this.renderQueue.splice(0, currentBatchSize);
            
            // 使用 requestIdleCallback 进行空闲时间渲染
            await this.renderBatchWithIdleTime(batch, container);
            
            rendered += batch.length;

            // 给浏览器时间处理其他任务，对大文档增加更多延迟
            const delay = total > 100 ? 32 : 16; // 大文档使用更长延迟
            await this.delay(delay);
        }

        this.isRendering = false;
        
        // 设置交叉观察器
        this.observeChunks(container);
        
        console.log(`[ChunkOptimizer] 所有分块渲染完成`);
    }

    /**
     * 在空闲时间渲染批次
     * @param {Array} batch 待渲染的批次
     * @param {Element} container 容器元素
     */
    renderBatchWithIdleTime(batch, container) {
        return new Promise((resolve) => {
            const renderBatch = (deadline) => {
                while (batch.length > 0 && deadline.timeRemaining() > 5) {
                    const item = batch.shift();
                    const chunkElement = this.renderSingleChunk(item);
                    if (chunkElement) {
                        container.appendChild(chunkElement);
                    }
                }
                
                if (batch.length > 0) {
                    // 还有未完成的渲染，继续下一个空闲周期
                    if (window.requestIdleCallback) {
                        requestIdleCallback(renderBatch, { timeout: 100 });
                    } else {
                        setTimeout(() => renderBatch({ timeRemaining: () => 16 }), 16);
                    }
                } else {
                    resolve();
                }
            };

            if (window.requestIdleCallback) {
                requestIdleCallback(renderBatch, { timeout: 100 });
            } else {
                setTimeout(() => renderBatch({ timeRemaining: () => 16 }), 0);
            }
        });
    }

    /**
     * 渲染单个分块
     * @param {Object} item 分块数据
     * @returns {Element} 分块DOM元素
     */
    renderSingleChunk(item) {
        const { index, ocrChunk, translatedChunk, options } = item;
        const cacheKey = `${index}_${ocrChunk.length}_${translatedChunk.length}`;
        
        // 检查缓存
        if (this.renderCache.has(cacheKey)) {
            const cachedElement = this.renderCache.get(cacheKey).cloneNode(true);
            this.updateChunkElement(cachedElement, index);
            return cachedElement;
        }

        const startTime = performance.now();
        
        // 创建分块元素
        const chunkElement = document.createElement('div');
        chunkElement.className = 'chunk-pair optimized-chunk';
        chunkElement.dataset.chunkIndex = index;
        chunkElement.id = `chunk-${index}`;
        
        // 延迟渲染复杂内容
        chunkElement.innerHTML = this.createChunkPlaceholder(index, ocrChunk, translatedChunk);
        
        // 缓存元素
        this.renderCache.set(cacheKey, chunkElement.cloneNode(true));
        
        const endTime = performance.now();
        console.log(`[ChunkOptimizer] 分块 ${index} 渲染完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);
        
        return chunkElement;
    }

    /**
     * 创建分块占位符
     * @param {number} index 分块索引
     * @param {string} ocrChunk OCR内容
     * @param {string} translatedChunk 翻译内容
     * @returns {string} 占位符HTML
     */
    createChunkPlaceholder(index, ocrChunk, translatedChunk) {
        const ocrPreview = this.getContentPreview(ocrChunk);
        const transPreview = this.getContentPreview(translatedChunk);
        
        return `
            <div class="block-outer" data-block-index="${index}">
                <div class="chunk-header">
                    <h4>分块 ${index + 1}</h4>
                    <div class="chunk-stats">
                        <span class="char-count">原文: ${ocrChunk.length}字</span>
                        <span class="char-count">译文: ${translatedChunk.length}字</span>
                    </div>
                </div>
                <div class="chunk-preview-container" data-lazy-load="true">
                    <div class="chunk-preview ocr-preview">
                        <div class="preview-label">原文预览:</div>
                        <div class="preview-content">${ocrPreview}</div>
                    </div>
                    <div class="chunk-preview trans-preview">
                        <div class="preview-label">译文预览:</div>
                        <div class="preview-content">${transPreview}</div>
                    </div>
                    <div class="load-full-content-btn" onclick="ChunkCompareOptimizer.instance.loadFullChunk(${index})">
                        点击加载完整内容
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 获取内容预览
     * @param {string} content 原始内容
     * @returns {string} 预览内容
     */
    getContentPreview(content) {
        if (!content) return '(空内容)';
        
        // 移除Markdown语法和特殊字符，获取纯文本预览
        const plainText = content
            .replace(/[#*`]/g, '') // 移除Markdown符号
            .replace(/\s+/g, ' ')  // 合并空白字符
            .trim();
            
        return plainText.length > 100 
            ? plainText.substring(0, 100) + '...' 
            : plainText;
    }

    /**
     * 加载完整分块内容
     * @param {number} index 分块索引
     */
    async loadFullChunk(index) {
        const chunkElement = document.getElementById(`chunk-${index}`);
        if (!chunkElement) return;

        const lazyContainer = chunkElement.querySelector('[data-lazy-load="true"]');
        if (!lazyContainer) return;

        // 显示加载状态
        lazyContainer.innerHTML = '<div class="chunk-loading">正在加载完整内容...</div>';

        try {
            // 获取原始数据
            const ocrChunk = window.data?.ocrChunks?.[index] || '';
            const translatedChunk = window.data?.translatedChunks?.[index] || '';
            
            // 渲染完整内容
            const fullContent = await this.renderFullChunkContent(
                ocrChunk, 
                translatedChunk, 
                window.data?.images || [], 
                index, 
                window.data?.ocrChunks?.length || 0
            );

            lazyContainer.innerHTML = fullContent;
            lazyContainer.removeAttribute('data-lazy-load');

            // 绑定事件
            this.bindChunkEvents(chunkElement);

        } catch (error) {
            console.error(`加载分块 ${index} 失败:`, error);
            lazyContainer.innerHTML = '<div class="chunk-error">加载失败，请重试</div>';
        }
    }

    /**
     * 渲染完整分块内容
     * @param {string} ocrChunk OCR内容
     * @param {string} translatedChunk 翻译内容
     * @param {Array} images 图片数据
     * @param {number} blockIndex 分块索引
     * @param {number} totalBlocks 总分块数
     * @returns {string} 完整内容HTML
     */
    async renderFullChunkContent(ocrChunk, translatedChunk, images, blockIndex, totalBlocks) {
        // 使用原有的渲染逻辑，但进行性能优化
        const isOriginalFirstInChunkCompare = window.isOriginalFirstInChunkCompare !== false;
        
        // 使用 Web Worker 进行 Markdown 解析（如果可用）
        const ocrBlocks = await this.parseMarkdownAsync(ocrChunk);
        const transBlocks = await this.parseMarkdownAsync(translatedChunk);
        const aligned = this.alignBlocks(ocrBlocks, transBlocks);

        let showMode = window[`showMode_block_${blockIndex}`] || 'both';

        // 渲染工具栏
        let html = `
            <div class="block-toolbar" data-block-toolbar="${blockIndex}">
                <div class="block-toolbar-left">
                    <span class="block-mode-btn ${showMode === 'both' ? 'active' : ''}" data-mode="both" data-block="${blockIndex}">对比</span>
                    <span class="block-mode-btn ${showMode === 'ocr' ? 'active' : ''}" data-mode="ocr" data-block="${blockIndex}">原文</span>
                    <span class="block-mode-btn ${showMode === 'trans' ? 'active' : ''}" data-mode="trans" data-block="${blockIndex}">译文</span>
                    <button class="block-copy-btn" data-block="${blockIndex}" title="复制本块内容">复制本块</button>
                </div>
                <div class="block-toolbar-right">
                    ${blockIndex > 0 ? `<button class="block-nav-btn" data-dir="prev" data-block="${blockIndex}" title="上一段">↑</button>` : ''}
                    ${blockIndex < totalBlocks-1 ? `<button class="block-nav-btn" data-dir="next" data-block="${blockIndex}" title="下一段">↓</button>` : ''}
                </div>
            </div>
        `;

        // 批量渲染对齐的内容
        const alignedHTML = await this.renderAlignedContentAsync(aligned, images, blockIndex, isOriginalFirstInChunkCompare);
        html += alignedHTML;

        // 保存原始内容供复制使用
        window[`blockRawContent_${blockIndex}`] = aligned;

        return html;
    }

    /**
     * 异步解析Markdown
     * @param {string} markdown Markdown内容
     * @returns {Promise<Array>} 解析结果
     */
    parseMarkdownAsync(markdown) {
        return new Promise((resolve) => {
            // 简化的Markdown解析，避免阻塞主线程
            const lines = (markdown || '').split(/\r?\n/);
            const blocks = [];
            let buffer = [];
            let inCode = false;
            let isFirstBlock = true;

            const parseChunk = (startIndex) => {
                const endIndex = Math.min(startIndex + 50, lines.length); // 每次处理50行
                
                for (let i = startIndex; i < endIndex; i++) {
                    const line = lines[i];
                    if (/^\s*```/.test(line)) {
                        inCode = !inCode;
                        buffer.push(line);
                        continue;
                    }
                    if (inCode) {
                        buffer.push(line);
                        continue;
                    }
                    if (/^\s*#/.test(line)) {
                        if (!isFirstBlock && buffer.length) {
                            blocks.push({ content: buffer.join('\n') });
                            buffer = [];
                        }
                        isFirstBlock = false;
                        buffer.push(line);
                        continue;
                    }
                    buffer.push(line);
                }

                if (endIndex < lines.length) {
                    // 继续下一批
                    setTimeout(() => parseChunk(endIndex), 0);
                } else {
                    // 完成解析
                    if (buffer.length) {
                        blocks.push({ content: buffer.join('\n') });
                    }
                    resolve(blocks);
                }
            };

            parseChunk(0);
        });
    }

    /**
     * 异步渲染对齐内容
     */
    async renderAlignedContentAsync(aligned, images, blockIndex, isOriginalFirstInChunkCompare) {
        const alignedHTML = [];
        const batchSize = 3; // 每批处理3个对齐块

        for (let i = 0; i < aligned.length; i += batchSize) {
            const batch = aligned.slice(i, i + batchSize);
            const batchHTML = await this.renderAlignedBatch(batch, i, images, blockIndex, isOriginalFirstInChunkCompare);
            alignedHTML.push(...batchHTML);
            
            // 让出控制权
            if (i + batchSize < aligned.length) {
                await this.delay(0);
            }
        }

        return alignedHTML.join('');
    }

    /**
     * 渲染对齐批次
     */
    async renderAlignedBatch(batch, startIndex, images, blockIndex, isOriginalFirstInChunkCompare) {
        return batch.map((alignedPair, batchIndex) => {
            const actualIndex = startIndex + batchIndex;
            const showMode = window[`showMode_block_${blockIndex}`] || 'both';
            
            return `
                <div class="align-flex block-flex block-flex-${blockIndex} ${showMode==='ocr'?'block-mode-ocr-only':showMode==='trans'?'block-mode-trans-only':'block-mode-both'}" data-block="${blockIndex}" data-align-index="${actualIndex}">
                    <div class="align-block align-block-ocr">
                        <div class="align-title">
                            <span>原文</span>
                            <button class="block-struct-copy-btn" data-block="${blockIndex}" data-type="ocr" data-idx="${actualIndex}" title="复制原文结构">复制</button>
                        </div>
                        <div class="align-content markdown-body">${this.renderContentSafely(alignedPair[0], images)}</div>
                    </div>
                    <div class="splitter" title="拖动调整比例"></div>
                    <div class="align-block align-block-trans">
                        <div class="align-title">
                            <span>译文</span>
                            <button class="block-struct-copy-btn" data-block="${blockIndex}" data-type="trans" data-idx="${actualIndex}" title="复制译文结构">复制</button>
                        </div>
                        <div class="align-content markdown-body">${this.renderContentSafely(alignedPair[1], images)}</div>
                    </div>
                </div>
            `;
        });
    }

    /**
     * 安全渲染内容
     */
    renderContentSafely(content, images) {
        try {
            if (!content || content.trim() === '') return '';
            
            // 使用简化的渲染避免复杂的KaTeX解析
            if (window.MarkdownProcessor?.renderWithKatexFailback) {
                const safeContent = window.MarkdownProcessor.safeMarkdown(content, images);
                return window.MarkdownProcessor.renderWithKatexFailback(safeContent);
            } else {
                // 回退到简单的文本渲染
                return content.replace(/\n/g, '<br>');
            }
        } catch (error) {
            console.warn('内容渲染失败，使用简单模式:', error);
            return content.replace(/\n/g, '<br>');
        }
    }

    /**
     * 对齐分块
     */
    alignBlocks(blocks1, blocks2) {
        const maxLen = Math.max(blocks1.length, blocks2.length);
        const aligned = [];
        for (let i = 0; i < maxLen; i++) {
            aligned.push([
                blocks1[i] ? blocks1[i].content : '',
                blocks2[i] ? blocks2[i].content : ''
            ]);
        }
        return aligned;
    }

    /**
     * 绑定分块事件
     */
    bindChunkEvents(chunkElement) {
        // 这里可以添加特定的事件绑定逻辑
        // 例如模式切换、复制按钮等
    }

    /**
     * 设置交叉观察器进行懒加载
     */
    setupIntersectionObserver() {
        if (!window.IntersectionObserver) return;

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const chunkIndex = parseInt(entry.target.dataset.chunkIndex);
                    const lazyContainer = entry.target.querySelector('[data-lazy-load="true"]');
                    
                    if (lazyContainer) {
                        // 自动加载进入视口的分块
                        this.loadFullChunk(chunkIndex);
                    }
                }
            });
        }, {
            rootMargin: '200px', // 提前200px开始加载
            threshold: 0.1
        });
    }

    /**
     * 观察分块元素
     */
    observeChunks(container) {
        if (!this.observer) return;

        const chunks = container.querySelectorAll('.chunk-pair');
        chunks.forEach(chunk => {
            this.observer.observe(chunk);
        });
    }

    /**
     * 设置性能监控
     */
    setupPerformanceMonitor() {
        // 监控内存使用
        if (performance.memory) {
            setInterval(() => {
                const memory = performance.memory;
                console.log(`[ChunkOptimizer] 内存使用: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
            }, 30000); // 每30秒检查一次
        }
    }

    /**
     * 更新进度
     */
    updateProgress(rendered, total) {
        const progress = Math.round((rendered / total) * 100);
        console.log(`[ChunkOptimizer] 渲染进度: ${progress}% (${rendered}/${total})`);
        
        // 可以在这里更新UI进度条
        const progressBar = document.querySelector('.chunk-progress-bar');
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
    }

    /**
     * 延迟函数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.renderCache.clear();
        this.visibleChunks.clear();
    }
}

// 创建全局实例
ChunkCompareOptimizer.instance = new ChunkCompareOptimizer();

// 在页面加载时初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        ChunkCompareOptimizer.instance.init();
    });
} else {
    ChunkCompareOptimizer.instance.init();
}

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChunkCompareOptimizer;
} else {
    window.ChunkCompareOptimizer = ChunkCompareOptimizer;
}