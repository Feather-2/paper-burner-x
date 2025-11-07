// js/ui/reference-manager-detail.js
// 参考文献管理器 - 详情页专用版本

(function(global) {
    'use strict';

    let currentDocumentId = null;
    let currentReferences = [];
    let isFloatingPanelOpen = false;
    let citationLocations = {}; // 记录每个文献的引用位置 {refIndex: [citationElementIds]}
    let activeTooltipLinkElement = null; // 记录当前激活tooltip的链接元素
    let hideTooltipTimer = null; // 记录隐藏tooltip的定时器

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

        // 监听子块分割完成事件（如果存在）
        document.addEventListener('subBlocksSegmented', () => {
            console.log('[ReferenceManagerDetail] 子块分割完成，重新标记引用');
            if (currentReferences.length > 0) {
                appendReferencesToContent(currentReferences);
            }
        });

        // 使用MutationObserver监听DOM变化，自动重新标记引用
        setupDOMMutationObserver();

        // 创建悬浮面板
        createFloatingPanel();

        // 处理页面刷新：仅在内容已就绪或数据已可用时尝试一次，
        // 否则等待 contentRendered 事件再处理，避免早期取不到内容
        setTimeout(() => {
            const hasData = !!(window.data && (window.data.ocr || window.data.translation || (Array.isArray(window.data.ocrChunks) && window.data.ocrChunks.length > 0)));
            if (window.contentReady || hasData) {
                loadAndDisplayReferences();
            } else {
                console.log('[ReferenceManagerDetail] 等待内容渲染完成后再尝试提取参考文献');
            }
        }, 200);

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
    async function loadAndDisplayReferences() {
        // 从存储加载
        const data = await global.ReferenceStorage?.loadReferences(currentDocumentId);

        if (data && data.references) {
            currentReferences = data.references;
            updateReferenceCount(currentReferences.length);
            appendReferencesToContent(currentReferences);
            addToTOC();
        } else {
            // 尝试自动提取
            await autoExtractReferences();
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

        // 显示提取方式选择对话框
        await showExtractionMethodDialog(section, markdown);
    }

    /**
     * 显示提取方式选择对话框
     */
    async function showExtractionMethodDialog(section, markdown) {
        const message = `检测到 ${section.entries.length} 条文献\n\n` +
                       `请选择提取方式：\n` +
                       `1. 正则表达式（快速，适合标准格式）\n` +
                       `2. AI智能提取（准确，适合任意格式）\n` +
                       `3. 混合模式（推荐，先正则再AI）\n\n` +
                       `请输入数字 1、2 或 3（取消将不再提示）：`;

        const choice = prompt(message);

        // 用户点击取消：保存空数组，避免反复提示
        if (!choice) {
            console.log('[ReferenceManagerDetail] User cancelled extraction, saving empty state');
            if (global.ReferenceStorage) {
                await global.ReferenceStorage.saveReferences(currentDocumentId, [], {
                    extractionSkipped: true,
                    skippedAt: new Date().toISOString()
                });
                console.log('[ReferenceManagerDetail] Empty state saved successfully');
            }
            return;
        }

        switch (choice.trim()) {
            case '1':
                extractWithRegex(section, markdown);
                break;
            case '2':
                extractWithAI(section, markdown);
                break;
            case '3':
                extractWithHybrid(section, markdown);
                break;
            default:
                alert('无效的选择，请重新打开文档并输入 1、2 或 3');
        }
    }

    /**
     * 使用正则表达式提取
     */
    function extractWithRegex(section, markdown) {
        const extracted = global.ReferenceExtractor?.batchExtract(section.entries) || section.entries;

        // 建立索引
        let indexed = extracted;
        if (global.ReferenceIndexer) {
            indexed = global.ReferenceIndexer.buildIndex(
                currentDocumentId,
                markdown,
                extracted
            );
        }

        // 保存
        global.ReferenceStorage?.saveReferences(
            currentDocumentId,
            indexed,
            {
                extractedAt: new Date().toISOString(),
                method: 'regex'
            }
        );

        // 显示
        currentReferences = indexed;
        updateReferenceCount(indexed.length);
        appendReferencesToContent(indexed);
        addToTOC();

        alert(`正则提取完成\n成功提取 ${indexed.length} 条文献`);
    }

    /**
     * 使用AI提取
     */
    async function extractWithAI(section, markdown) {
        const simpleEntries = section.entries.map((e, idx) => ({
            index: idx,
            rawText: e.rawText || e,
            needsAIProcessing: true
        }));

        await processWithAI(simpleEntries, markdown);
    }

    /**
     * 使用混合模式提取
     */
    async function extractWithHybrid(section, markdown) {
        // 先用正则提取
        const extracted = global.ReferenceExtractor?.batchExtract(section.entries) || section.entries;

        // 找出需要AI处理的
        const needsAI = extracted.filter(e => e.needsAIProcessing);

        if (needsAI.length > 0) {
            const message = `正则提取: ${extracted.length - needsAI.length}/${extracted.length} 成功\n` +
                          `需要AI处理: ${needsAI.length} 条\n\n` +
                          `是否继续使用AI处理剩余文献？`;

            if (confirm(message)) {
                await processWithAI(extracted, markdown);
            } else {
                // 只保存正则提取的结果
                saveExtractedReferences(extracted, markdown);
            }
        } else {
            // 全部正则提取成功
            saveExtractedReferences(extracted, markdown);
            alert(`提取完成\n全部 ${extracted.length} 条文献已通过正则成功提取`);
        }
    }

    /**
     * 在原文中标记引用（不插入参考文献列表）
     */
    function appendReferencesToContent(references) {
        console.log('[appendReferencesToContent] 开始标记引用，references.length:', references.length);

        if (!references || references.length === 0) {
            console.warn('[appendReferencesToContent] 没有参考文献数据');
            return;
        }

        // 查找内容容器（使用正确的ID）
        const containers = ['#ocr-content-wrapper', '#translation-content-wrapper'];

        containers.forEach(selector => {
            const container = document.querySelector(selector);
            if (!container) {
                console.log('[appendReferencesToContent] 容器不存在:', selector);
                return;
            }

            console.log('[appendReferencesToContent] 找到容器:', selector);

            // 清除之前的标记（避免重复标记）
            const existingCitations = container.querySelectorAll('.reference-citation');
            console.log('[appendReferencesToContent] 清除现有引用:', existingCitations.length);
            existingCitations.forEach(citation => {
                // 将链接替换回原始文本
                const text = document.createTextNode(citation.textContent);
                citation.parentNode.replaceChild(text, citation);
            });

            // 标记原文中的引用（如[1], [2]）
            markCitationsInContent(container, references.length);

            // 使用事件委托，在容器级别监听引用链接的鼠标事件
            setupCitationEventDelegation(container);

            console.log('[appendReferencesToContent] 已标记原文中的引用，不插入文献列表');
        });

        // 更新悬浮面板内容
        updatePanelContent();
    }

    /**
     * 设置DOM变化监听器，自动重新标记引用
     */
    function setupDOMMutationObserver() {
        const containers = ['#ocr-content-wrapper', '#translation-content-wrapper'];
        let remarkerTimer = null;

        containers.forEach(selector => {
            const container = document.querySelector(selector);
            if (!container) return;

            const observer = new MutationObserver((mutations) => {
                // 检查是否有子块被添加或修改
                let needRemark = false;
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' || mutation.type === 'subtree') {
                        // 检查是否有新增的子块
                        if (mutation.addedNodes.length > 0) {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE &&
                                    (node.classList?.contains('sub-block') ||
                                     node.querySelector?.('.sub-block'))) {
                                    needRemark = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (needRemark) break;
                }

                if (needRemark && currentReferences.length > 0) {
                    // 防抖：延迟执行，避免频繁重新标记
                    if (remarkerTimer) clearTimeout(remarkerTimer);
                    remarkerTimer = setTimeout(() => {
                        console.log('[MutationObserver] 检测到DOM变化，重新标记引用');
                        appendReferencesToContent(currentReferences);
                    }, 500);
                }
            });

            observer.observe(container, {
                childList: true,
                subtree: true
            });

            console.log('[setupDOMMutationObserver] 已设置DOM监听器:', selector);
        });
    }

    /**
     * 设置引用链接的事件委托
     */
    function setupCitationEventDelegation(container) {
        // 移除旧的事件监听器（如果存在）
        if (container._citationEventSetup) {
            return; // 已经设置过了
        }
        container._citationEventSetup = true;

        // 使用事件委托监听mouseenter
        container.addEventListener('mouseover', (e) => {
            const target = e.target;
            if (target.classList && target.classList.contains('reference-citation')) {
                // 获取所有文献编号
                const refNumbers = target.dataset.refNumbers;
                if (refNumbers) {
                    console.log('[delegation mouseenter] 触发悬停事件，refNumbers:', refNumbers);
                    // 清除之前的隐藏定时器
                    if (hideTooltipTimer) {
                        clearTimeout(hideTooltipTimer);
                        hideTooltipTimer = null;
                    }
                    showReferenceDetailTooltip(target, refNumbers);
                }
            }
        });

        // 使用事件委托监听mouseleave
        container.addEventListener('mouseout', (e) => {
            const target = e.target;
            if (target.classList && target.classList.contains('reference-citation')) {
                // 从 dataset 获取引用编号
                const refNumbers = target.dataset.refNumbers;
                if (refNumbers) {
                    console.log('[delegation mouseleave] 触发离开事件，refNumbers:', refNumbers, 'activeElement:', activeTooltipLinkElement === target);
                    // 延迟隐藏，给用户时间移动到tooltip上
                    hideTooltipTimer = setTimeout(() => {
                        const tooltip = document.getElementById('reference-detail-tooltip');
                        const tooltipHover = tooltip ? tooltip.matches(':hover') : false;
                        const isActive = activeTooltipLinkElement === target;
                        console.log('[delegation mouseleave timer] refNumbers:', refNumbers, 'tooltip hover:', tooltipHover, 'is active:', isActive);
                        // 只有当鼠标既不在tooltip上且当前链接不再是活跃链接时才隐藏
                        if (tooltip && !tooltipHover && !isActive) {
                            hideReferenceDetailTooltip();
                        }
                    }, 100);
                }
            }
        });

        // 监听点击事件
        container.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList && target.classList.contains('reference-citation')) {
                e.preventDefault();
                const refIndex = parseInt(target.dataset.refIndex, 10);
                if (!isNaN(refIndex)) {
                    window.scrollToReferenceItem(refIndex);
                }
            }
        });

        console.log('[setupCitationEventDelegation] 已设置事件委托');
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
        return references.map((ref, idx) => {
            const authors = ref.authors && ref.authors.length > 0
                ? (ref.authors.length > 2
                    ? `${ref.authors.slice(0, 2).join(', ')} 等`
                    : ref.authors.join(', '))
                : '作者未知';

            const citationCount = citationLocations[idx] ? citationLocations[idx].length : 0;

            return `
                <div class="ref-panel-item">
                    <div class="ref-panel-header">
                        <div class="ref-panel-number">[${idx + 1}]</div>
                        <div class="ref-panel-title">${ref.title || '未提取标题'}</div>
                    </div>
                    <div class="ref-panel-meta">
                        <div class="ref-panel-authors">${authors}</div>
                        ${ref.year ? `<span class="ref-panel-year">${ref.year}</span>` : ''}
                        ${ref.journal ? `<span class="ref-panel-journal">${ref.journal}</span>` : ''}
                    </div>
                    ${citationCount > 0 ? `
                        <div class="ref-panel-citations">
                            <i class="fa fa-quote-left"></i> 引用 ${citationCount} 次
                        </div>
                    ` : ''}
                    <div class="ref-panel-actions">
                        <button class="ref-panel-action-btn" onclick="window.scrollToCitationInText(${idx})" title="跳转到原文">
                            <i class="fa fa-arrow-up"></i> 原文
                        </button>
                        <button class="ref-panel-action-btn" onclick="window.scrollToReferenceItem(${idx})" title="查看详情">
                            <i class="fa fa-eye"></i> 详情
                        </button>
                        ${ref.doi ? `
                            <a href="https://doi.org/${ref.doi}" target="_blank" class="ref-panel-action-btn" title="打开DOI">
                                <i class="fa fa-external-link"></i> DOI
                            </a>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * 滚动到文献详情（原References区域的具体文献条目）
     */
    global.scrollToReferenceItem = function(index) {
        // 查找原文中的References标题
        const containers = ['#ocr-content-wrapper', '#translation-content-wrapper'];

        for (const selector of containers) {
            const container = document.querySelector(selector);
            if (!container) continue;

            const referenceHeading = findReferenceHeading(container);
            if (referenceHeading) {
                // 先滚动到References标题
                referenceHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });

                // 高亮整个References区域
                setTimeout(() => {
                    let currentElement = referenceHeading.nextElementSibling;
                    let highlightElements = [];

                    // 收集References区域的所有元素
                    while (currentElement) {
                        const isNextSection = currentElement.tagName && /^H[1-3]$/i.test(currentElement.tagName);
                        if (isNextSection) {
                            const headingText = currentElement.textContent.trim().toLowerCase();
                            const sectionKeywords = ['acknowledgment', 'appendix', 'supplementary', '致谢', '附录'];
                            const isNewSection = sectionKeywords.some(keyword => headingText.includes(keyword));
                            if (isNewSection) break;
                        }
                        highlightElements.push(currentElement);
                        currentElement = currentElement.nextElementSibling;
                    }

                    // 添加高亮
                    highlightElements.forEach(el => {
                        el.style.backgroundColor = '#fff3cd';
                        el.style.transition = 'background-color 0.3s';
                    });

                    // 3秒后移除高亮
                    setTimeout(() => {
                        highlightElements.forEach(el => {
                            el.style.backgroundColor = '';
                        });
                    }, 3000);
                }, 500);

                console.log('[scrollToReferenceItem] 已跳转到References区域并高亮文献', index + 1);
                return;
            }
        }

        alert('未找到References区域');
    };

    /**
     * 查找参考文献标题元素
     */
    function findReferenceHeading(container) {
        if (!container) return null;

        // 参考文献标题的常见关键词
        const keywords = [
            'references', 'reference', 'bibliography', 'works cited',
            'literature cited', 'citations',
            '参考文献', '引用文献', '文献引用', '参考资料'
        ];

        // 查找所有标题元素
        const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');

        for (const heading of headings) {
            const text = heading.textContent.trim().toLowerCase();

            // 检查是否包含参考文献关键词
            for (const keyword of keywords) {
                if (text === keyword || text === keyword + 's') {
                    return heading;
                }
            }
        }

        return null;
    }

    /**
     * 在原文中标记引用并添加点击跳转功能
     */
    function markCitationsInContent(container, refCount) {
        if (!container) return;

        // 重置引用位置记录
        citationLocations = {};
        for (let i = 0; i < refCount; i++) {
            citationLocations[i] = [];
        }

        // 使用TreeWalker遍历文本节点
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    // 跳过参考文献区域本身
                    if (node.parentElement.closest('.reference-section')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // 跳过已经处理过的引用链接
                    if (node.parentElement.classList?.contains('reference-citation')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // 跳过注解系统创建的高亮span
                    if (node.parentElement.classList?.contains('annotated-block') ||
                        node.parentElement.classList?.contains('annotated-sub-block') ||
                        node.parentElement.classList?.contains('partial-subblock-highlight')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // 跳过公式
                    let p = node.parentElement;
                    while (p) {
                        if (p.classList && (p.classList.contains('katex') ||
                            p.classList.contains('katex-display') ||
                            p.classList.contains('katex-inline'))) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        p = p.parentElement;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        // 正则匹配引用标记：[1], [2,3], [1-5], [1~5] 等
        // 支持的分隔符：逗号(,)、短横线(-)、en dash(–)、波浪号(~)
        const citationPattern = /\[(\d+(?:\s*[-–,~]\s*\d+)*)\]/g;

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const matches = [];
            let match;

            // 收集所有匹配
            while ((match = citationPattern.exec(text)) !== null) {
                const numbers = parseReferenceNumbers(match[1]);
                // 只处理有效的引用（编号在范围内）
                const validNumbers = numbers.filter(num => num > 0 && num <= refCount);
                if (validNumbers.length > 0) {
                    matches.push({
                        index: match.index,
                        length: match[0].length,
                        text: match[0],
                        numbers: validNumbers
                    });
                }
            }

            // 如果有匹配，替换为链接
            if (matches.length > 0) {
                const parent = textNode.parentElement;
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;

                matches.forEach(m => {
                    // 添加前面的文本
                    if (m.index > lastIndex) {
                        fragment.appendChild(document.createTextNode(text.substring(lastIndex, m.index)));
                    }

                    // 为整个引用创建一个链接（不管它包含多少个文献编号）
                    const firstRefNum = m.numbers[0];
                    const refIndex = firstRefNum - 1;
                    const occurrenceIndex = citationLocations[refIndex] ? citationLocations[refIndex].length : 0;
                    const citationId = `citation-source-${refIndex}-${occurrenceIndex}`;

                    // 创建引用链接
                    const link = document.createElement('a');
                    link.href = `#ref-${firstRefNum}`;
                    link.className = 'reference-citation';
                    link.id = citationId;
                    link.textContent = m.text;  // 显示完整的引用文本，如 [1] 或 [1,2,3]
                    link.dataset.refIndex = refIndex;
                    // 保存0-based索引（用于数组访问）
                    link.dataset.refNumbers = m.numbers.map(num => num - 1).join(',');

                    // 不在这里绑定事件，而是使用事件委托
                    // 事件委托在setupCitationEventDelegation中设置

                    fragment.appendChild(link);
                    console.log('[markCitationsInContent] 创建链接:', citationId, '文本:', m.text, 'refIndex:', refIndex);

                    // 记录所有引用的文献的位置
                    m.numbers.forEach(num => {
                        const idx = num - 1;
                        if (!citationLocations[idx]) {
                            citationLocations[idx] = [];
                        }
                        citationLocations[idx].push(citationId);
                    });

                    lastIndex = m.index + m.length;
                });

                // 添加剩余的文本
                if (lastIndex < text.length) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
                }

                // 替换原文本节点
                parent.replaceChild(fragment, textNode);
                console.log('[markCitationsInContent] 替换了', matches.length, '个引用链接');
            }
        });

        console.log('[markCitationsInContent] 已标记原文中的引用', citationLocations);

        // 验证链接是否真的在DOM中
        setTimeout(() => {
            const allLinks = container.querySelectorAll('.reference-citation');
            console.log('[markCitationsInContent] DOM中的引用链接数量:', allLinks.length);
            if (allLinks.length > 0) {
                console.log('[markCitationsInContent] 第一个链接样例:', allLinks[0], '文本:', allLinks[0].textContent);
                console.log('[markCitationsInContent] 第一个链接的计算样式 color:', window.getComputedStyle(allLinks[0]).color);
                console.log('[markCitationsInContent] 第一个链接的计算样式 cursor:', window.getComputedStyle(allLinks[0]).cursor);
            }
        }, 100);
    }

    /**
     * 解析引用编号字符串
     */
    function parseReferenceNumbers(numbersStr) {
        const result = [];
        const parts = numbersStr.split(/\s*,\s*/);

        parts.forEach(part => {
            // 检查是否是范围（如 2-5, 2~5, 2–5）
            const rangeMatch = part.match(/(\d+)\s*[-–~]\s*(\d+)/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                for (let i = start; i <= end; i++) {
                    result.push(i);
                }
            } else {
                const num = parseInt(part);
                if (!isNaN(num)) {
                    result.push(num);
                }
            }
        });

        return result;
    }

    /**
     * 滚动到指定的文献条目
     */
    function scrollToReferenceItem(index) {
        const refItem = document.querySelector(`[data-ref-id="ref-${index + 1}"]`);
        if (refItem) {
            refItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 添加高亮动画
            refItem.classList.add('reference-item-highlight');
            setTimeout(() => {
                refItem.classList.remove('reference-item-highlight');
            }, 3000);

            console.log('[scrollToReferenceItem] 已定位到文献:', index + 1);
        } else {
            console.warn('[scrollToReferenceItem] 未找到文献:', index + 1);
        }
    }

    /**
     * 显示引用详细悬浮卡片（改进版，显示更多信息）
     * @param {HTMLElement} linkElement - 引用链接元素
     * @param {string} refNumbersStr - 文献编号字符串，如 "0,1,2" (0-based索引)
     */
    function showReferenceDetailTooltip(linkElement, refNumbersStr) {
        // 解析文献编号
        const refIndices = refNumbersStr.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));

        console.log('[showReferenceDetailTooltip] 开始显示tooltip，refIndices:', refIndices, 'currentReferences.length:', currentReferences.length);

        if (refIndices.length === 0) {
            console.warn('[showReferenceDetailTooltip] 没有有效的文献编号');
            return;
        }

        // 记录当前激活的链接
        activeTooltipLinkElement = linkElement;

        // 创建或获取tooltip元素
        let tooltip = document.getElementById('reference-detail-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'reference-detail-tooltip';
            tooltip.className = 'reference-detail-tooltip';
            document.body.appendChild(tooltip);

            // 鼠标移出tooltip时隐藏
            tooltip.addEventListener('mouseleave', () => {
                console.log('[tooltip mouseleave] 触发');
                hideTooltipTimer = setTimeout(() => {
                    console.log('[tooltip mouseleave timer] 准备隐藏');
                    hideReferenceDetailTooltip();
                }, 100);
            });

            // 鼠标进入tooltip时取消隐藏
            tooltip.addEventListener('mouseenter', () => {
                console.log('[tooltip mouseenter] 取消隐藏定时器');
                if (hideTooltipTimer) {
                    clearTimeout(hideTooltipTimer);
                    hideTooltipTimer = null;
                }
            });
        }

        // 构建多个文献的详细内容
        let contentHTML = '';

        if (refIndices.length === 1) {
            // 单个文献，显示完整信息
            const refIndex = refIndices[0];
            const ref = currentReferences[refIndex];

            if (!ref) {
                console.warn('[showReferenceDetailTooltip] 未找到参考文献数据，refIndex:', refIndex);
                return;
            }

            const authors = ref.authors && ref.authors.length > 0
                ? ref.authors.join(', ')
                : '作者未知';

            const citationCount = citationLocations[refIndex] ? citationLocations[refIndex].length : 0;

            contentHTML = `
                <div class="tooltip-detail-header">
                    <span class="tooltip-detail-number">[${refIndex + 1}]</span>
                    <button class="tooltip-detail-close" onclick="document.getElementById('reference-detail-tooltip').classList.remove('show')">
                        <i class="fa fa-times"></i>
                    </button>
                </div>
                <div class="tooltip-detail-content">
                    ${ref.title ? `<h4 class="tooltip-detail-title">${ref.title}</h4>` : '<h4 class="tooltip-detail-title">未提取标题</h4>'}

                    <div class="tooltip-detail-authors">
                        <i class="fa fa-user"></i> ${authors}
                    </div>

                    <div class="tooltip-detail-meta">
                        ${ref.year ? `<span><i class="fa fa-calendar"></i> ${ref.year}</span>` : ''}
                        ${ref.journal ? `<span><i class="fa fa-book"></i> ${ref.journal}</span>` : ''}
                        ${ref.volume ? `<span>Vol. ${ref.volume}</span>` : ''}
                    </div>

                    ${ref.abstract ? `
                        <div class="tooltip-detail-abstract">
                            <strong>摘要：</strong>
                            <p>${ref.abstract}</p>
                        </div>
                    ` : ''}

                    ${ref.doi ? `
                        <div class="tooltip-detail-doi">
                            <strong>DOI:</strong>
                            <a href="https://doi.org/${ref.doi}" target="_blank">${ref.doi} <i class="fa fa-external-link"></i></a>
                        </div>
                    ` : ''}

                    ${citationCount > 0 ? `
                        <div class="tooltip-detail-citations">
                            <i class="fa fa-quote-left"></i> 本文引用 <strong>${citationCount}</strong> 次
                        </div>
                    ` : ''}
                </div>
                <div class="tooltip-detail-actions">
                    <button class="tooltip-action-btn" onclick="window.scrollToCitationInText(${refIndex}); document.getElementById('reference-detail-tooltip').classList.remove('show');">
                        <i class="fa fa-arrow-up"></i> 跳转引用
                    </button>
                    <button class="tooltip-action-btn" onclick="window.scrollToReferenceItem(${refIndex}); document.getElementById('reference-detail-tooltip').classList.remove('show');">
                        <i class="fa fa-list"></i> 查看详情
                    </button>
                </div>
            `;
        } else {
            // 多个文献，显示简化列表
            const refNumbersDisplay = refIndices.map(i => i + 1).join(', ');

            contentHTML = `
                <div class="tooltip-detail-header">
                    <span class="tooltip-detail-number">[${refNumbersDisplay}]</span>
                    <button class="tooltip-detail-close" onclick="document.getElementById('reference-detail-tooltip').classList.remove('show')">
                        <i class="fa fa-times"></i>
                    </button>
                </div>
                <div class="tooltip-detail-content" style="padding: 12px 14px;">
                    <div style="margin-bottom: 8px; color: #64748b; font-size: 12px;">
                        <i class="fa fa-info-circle"></i> 共 ${refIndices.length} 篇文献，点击展开查看详情
                    </div>
                    <div class="tooltip-multiple-refs">
                        ${refIndices.map(refIndex => {
                            const ref = currentReferences[refIndex];
                            if (!ref) return '';

                            const authors = ref.authors && ref.authors.length > 0
                                ? ref.authors.slice(0, 2).join(', ') + (ref.authors.length > 2 ? ' 等' : '')
                                : '作者未知';

                            const allAuthors = ref.authors && ref.authors.length > 0
                                ? ref.authors.join(', ')
                                : '作者未知';

                            const citationCount = citationLocations[refIndex] ? citationLocations[refIndex].length : 0;

                            return `
                                <div class="tooltip-ref-item" data-ref-index="${refIndex}">
                                    <div class="tooltip-ref-header" onclick="window.toggleReferenceDetail(${refIndex})">
                                        <div class="tooltip-ref-number">[${refIndex + 1}]</div>
                                        <div class="tooltip-ref-info">
                                            <div class="tooltip-ref-title">${ref.title || '未提取标题'}</div>
                                            <div class="tooltip-ref-authors">${authors}${ref.year ? ` · ${ref.year}` : ''}</div>
                                        </div>
                                        <i class="fa fa-chevron-down tooltip-ref-toggle"></i>
                                    </div>
                                    <div class="tooltip-ref-detail" style="display: none;">
                                        <div class="tooltip-ref-detail-section">
                                            <strong><i class="fa fa-user"></i> 作者：</strong>
                                            <span>${allAuthors}</span>
                                        </div>
                                        ${ref.year ? `
                                            <div class="tooltip-ref-detail-section">
                                                <strong><i class="fa fa-calendar"></i> 年份：</strong>
                                                <span>${ref.year}</span>
                                            </div>
                                        ` : ''}
                                        ${ref.journal ? `
                                            <div class="tooltip-ref-detail-section">
                                                <strong><i class="fa fa-book"></i> 期刊：</strong>
                                                <span>${ref.journal}${ref.volume ? ` Vol. ${ref.volume}` : ''}</span>
                                            </div>
                                        ` : ''}
                                        ${ref.abstract ? `
                                            <div class="tooltip-ref-detail-section">
                                                <strong><i class="fa fa-file-text-o"></i> 摘要：</strong>
                                                <p style="margin: 4px 0 0 0; line-height: 1.4; color: #475569;">${ref.abstract}</p>
                                            </div>
                                        ` : ''}
                                        ${ref.doi ? `
                                            <div class="tooltip-ref-detail-section">
                                                <strong><i class="fa fa-link"></i> DOI：</strong>
                                                <a href="https://doi.org/${ref.doi}" target="_blank" style="color: #3b82f6; text-decoration: none;">
                                                    ${ref.doi} <i class="fa fa-external-link" style="font-size: 10px;"></i>
                                                </a>
                                            </div>
                                        ` : ''}
                                        ${citationCount > 0 ? `
                                            <div class="tooltip-ref-detail-section">
                                                <strong><i class="fa fa-quote-left"></i> 引用：</strong>
                                                <span>本文引用 ${citationCount} 次</span>
                                            </div>
                                        ` : ''}
                                        <div class="tooltip-ref-detail-actions">
                                            <button onclick="window.scrollToCitationInText(${refIndex}); event.stopPropagation();" class="tooltip-ref-action-btn">
                                                <i class="fa fa-arrow-up"></i> 跳转引用
                                            </button>
                                            <button onclick="window.scrollToReferenceItem(${refIndex}); document.getElementById('reference-detail-tooltip').classList.remove('show'); event.stopPropagation();" class="tooltip-ref-action-btn">
                                                <i class="fa fa-list"></i> 查看原文
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        tooltip.innerHTML = contentHTML;

        // 先移除show类（重置状态）
        const wasVisible = tooltip.classList.contains('show');
        tooltip.classList.remove('show');
        console.log('[showReferenceDetailTooltip] 重置show类，之前是否可见:', wasVisible);

        // 使用requestAnimationFrame确保布局完成后再定位
        requestAnimationFrame(() => {
            // 获取链接和tooltip的位置信息
            const linkRect = linkElement.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            // 默认显示在链接右侧
            let top = linkRect.top + window.scrollY;
            let left = linkRect.right + window.scrollX + 10;

            // 如果右侧空间不足，显示在左侧
            if (left + tooltipRect.width > window.innerWidth - 20) {
                left = linkRect.left + window.scrollX - tooltipRect.width - 10;
            }

            // 如果左侧也不够，显示在下方
            if (left < 20) {
                left = linkRect.left + window.scrollX;
                top = linkRect.bottom + window.scrollY + 10;
            }

            // 防止tooltip超出视口顶部
            if (top < window.scrollY + 20) {
                top = window.scrollY + 20;
            }

            // 防止tooltip超出视口底部
            if (top + tooltipRect.height > window.scrollY + window.innerHeight - 20) {
                top = window.scrollY + window.innerHeight - tooltipRect.height - 20;
            }

            // 设置位置
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';

            // 下一帧添加show类，触发过渡动画
            requestAnimationFrame(() => {
                tooltip.classList.add('show');
            });

            console.log('[showReferenceDetailTooltip] 显示详细tooltip，文献编号:', refIndices.map(i => i + 1).join(','));
        });
    }

    /**
     * 隐藏详细悬浮卡片
     */
    function hideReferenceDetailTooltip() {
        const tooltip = document.getElementById('reference-detail-tooltip');
        if (tooltip) {
            tooltip.classList.remove('show');
            activeTooltipLinkElement = null;
        }
        if (hideTooltipTimer) {
            clearTimeout(hideTooltipTimer);
            hideTooltipTimer = null;
        }
        console.log('[hideReferenceDetailTooltip] 隐藏tooltip');
    }

    /**
     * 切换文献详情的展开/收起状态
     */
    global.toggleReferenceDetail = function(refIndex) {
        const item = document.querySelector(`.tooltip-ref-item[data-ref-index="${refIndex}"]`);
        if (!item) return;

        const detail = item.querySelector('.tooltip-ref-detail');
        const toggle = item.querySelector('.tooltip-ref-toggle');

        if (!detail || !toggle) return;

        if (detail.style.display === 'none') {
            // 展开
            detail.style.display = 'block';
            toggle.classList.add('expanded');
            item.classList.add('expanded');

            // 平滑滚动到该项
            setTimeout(() => {
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        } else {
            // 收起
            detail.style.display = 'none';
            toggle.classList.remove('expanded');
            item.classList.remove('expanded');
        }
    };

    /**
     * 显示参考文献详细卡片（模态框）
     */
    function showReferenceDetailCard(refIndex) {
        if (!currentReferences[refIndex]) return;

        const ref = currentReferences[refIndex];

        // 先隐藏tooltip
        hideReferenceTooltip();

        // 创建或获取模态框
        let modal = document.getElementById('reference-detail-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'reference-detail-modal';
            modal.className = 'reference-detail-modal';
            document.body.appendChild(modal);

            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('show');
                }
            });
        }

        // 构建详细内容
        const authors = ref.authors && ref.authors.length > 0
            ? ref.authors.join(', ')
            : '作者未知';

        const citationCount = citationLocations[refIndex] ? citationLocations[refIndex].length : 0;

        modal.innerHTML = `
            <div class="reference-detail-card">
                <div class="reference-detail-header">
                    <div class="reference-detail-number">[${refIndex + 1}]</div>
                    <button class="reference-detail-close" onclick="document.getElementById('reference-detail-modal').classList.remove('show')">
                        <i class="fa fa-times"></i>
                    </button>
                </div>
                <div class="reference-detail-content">
                    ${ref.title ? `<h3 class="reference-detail-title">${ref.title}</h3>` : '<h3 class="reference-detail-title">未提取标题</h3>'}

                    <div class="reference-detail-meta">
                        <div class="reference-detail-authors">
                            <i class="fa fa-user"></i> ${authors}
                        </div>
                        ${ref.year ? `<div class="reference-detail-year"><i class="fa fa-calendar"></i> ${ref.year}</div>` : ''}
                        ${ref.journal ? `<div class="reference-detail-journal"><i class="fa fa-book"></i> ${ref.journal}</div>` : ''}
                    </div>

                    ${ref.volume || ref.issue || ref.pages ? `
                        <div class="reference-detail-publication">
                            ${ref.volume ? `<span>Vol. ${ref.volume}</span>` : ''}
                            ${ref.issue ? `<span>No. ${ref.issue}</span>` : ''}
                            ${ref.pages ? `<span>pp. ${ref.pages}</span>` : ''}
                        </div>
                    ` : ''}

                    ${ref.abstract ? `
                        <div class="reference-detail-abstract">
                            <h4><i class="fa fa-file-text"></i> 摘要</h4>
                            <p>${ref.abstract}</p>
                        </div>
                    ` : ''}

                    ${ref.doi ? `
                        <div class="reference-detail-doi">
                            <strong>DOI:</strong>
                            <a href="https://doi.org/${ref.doi}" target="_blank">${ref.doi} <i class="fa fa-external-link"></i></a>
                        </div>
                    ` : ''}

                    ${citationCount > 0 ? `
                        <div class="reference-detail-citations">
                            <i class="fa fa-quote-left"></i> 本文引用此文献 <strong>${citationCount}</strong> 次
                        </div>
                    ` : ''}
                </div>
                <div class="reference-detail-actions">
                    <button class="ref-detail-btn" onclick="window.scrollToCitationInText(${refIndex})">
                        <i class="fa fa-arrow-up"></i> 跳转到原文引用
                    </button>
                    <button class="ref-detail-btn" onclick="window.scrollToReferenceItem(${refIndex})">
                        <i class="fa fa-list"></i> 查看References区域
                    </button>
                    ${ref.doi ? `
                        <a href="https://doi.org/${ref.doi}" target="_blank" class="ref-detail-btn ref-detail-btn-primary">
                            <i class="fa fa-external-link"></i> 打开DOI链接
                        </a>
                    ` : ''}
                </div>
            </div>
        `;

        // 显示模态框
        requestAnimationFrame(() => {
            modal.classList.add('show');
        });

        console.log('[showReferenceDetailCard] 显示详细卡片:', refIndex + 1);
    }

    /**
     * 隐藏引用悬浮卡片
     */
    function hideReferenceTooltip() {
        const tooltip = document.getElementById('reference-citation-tooltip');
        if (tooltip) {
            tooltip.classList.remove('show');
        }
    }

    /**
     * 跳转到原文中的引用位置
     */
    function scrollToCitationInText(refIndex) {
        const citationIds = citationLocations[refIndex];
        if (!citationIds || citationIds.length === 0) {
            console.warn('[scrollToCitationInText] 未找到引用位置:', refIndex);
            alert('未找到该文献在原文中的引用位置');
            return;
        }

        // 跳转到第一个引用位置
        const firstCitationId = citationIds[0];
        const citationElement = document.getElementById(firstCitationId);

        if (citationElement) {
            citationElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 添加临时高亮
            citationElement.style.backgroundColor = '#fff3cd';
            citationElement.style.padding = '2px 4px';
            citationElement.style.borderRadius = '3px';

            setTimeout(() => {
                citationElement.style.backgroundColor = '';
                citationElement.style.padding = '';
                citationElement.style.borderRadius = '';
            }, 2000);

            console.log('[scrollToCitationInText] 已跳转到引用位置:', firstCitationId);
        } else {
            console.warn('[scrollToCitationInText] 未找到引用元素:', firstCitationId);
        }
    }

    // 暴露给全局，供HTML按钮调用
    global.scrollToCitationInText = scrollToCitationInText;

    /**
     * 添加到TOC - 点击打开悬浮面板
     */
    function addToTOC() {
        const tocList = document.getElementById('toc-list');
        if (!tocList) return;

        // 移除已存在的文献链接
        const existing = tocList.querySelector('.toc-reference-link');
        if (existing) {
            existing.remove();
        }

        // 添加新链接（点击打开悬浮面板）
        const li = document.createElement('li');
        li.className = 'toc-reference-link';
        li.innerHTML = `
            <a href="#" class="toc-ref-link" onclick="window.toggleReferencePanel(); return false;">
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
        } else {
            // 如果元素还不存在，延迟重试
            console.warn('[ReferenceManagerDetail] reference-count element not found, retrying...');
            setTimeout(() => {
                const retryCountEl = document.getElementById('reference-count');
                if (retryCountEl) {
                    retryCountEl.textContent = count;
                }
            }, 500);
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

            // 在拖动开始前，将bottom定位转换为top定位
            if (panel.style.bottom || getComputedStyle(panel).bottom !== 'auto') {
                const rect = panel.getBoundingClientRect();
                panel.style.top = rect.top + 'px';
                panel.style.left = rect.left + 'px';
                panel.style.bottom = 'auto';
                panel.style.right = 'auto';
            }

            initialX = e.clientX - panel.offsetLeft;
            initialY = e.clientY - panel.offsetTop;
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            // 限制面板在视口内
            const maxX = window.innerWidth - panel.offsetWidth;
            const maxY = window.innerHeight - panel.offsetHeight;

            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));

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

            // 打开时重新加载数据（如果还没有加载）
            if (currentReferences.length === 0) {
                const data = global.ReferenceStorage?.loadReferences(currentDocumentId);
                if (data && data.references) {
                    currentReferences = data.references;
                    console.log('[toggleFloatingPanel] 重新加载文献数据:', currentReferences.length);
                }
            }

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
     * 获取当前Markdown内容
     */
    async function getCurrentMarkdownContent() {
        const active = window.globalCurrentContentIdentifier || window.currentVisibleTabId || 'ocr';

        // 优先：根据当前可见内容获取（translation 优先使用译文）
        if (window.data) {
            if (active === 'translation' && typeof window.data.translation === 'string' && window.data.translation.length > 0) {
                console.log('[ReferenceManagerDetail] 使用 window.data.translation，长度:', window.data.translation.length);
                return window.data.translation;
            }
            if (typeof window.data.ocr === 'string' && window.data.ocr.length > 0) {
                console.log('[ReferenceManagerDetail] 使用 window.data.ocr，长度:', window.data.ocr.length);
                return window.data.ocr;
            }
            // 备用：从分块重建
            if (Array.isArray(window.data.ocrChunks) && window.data.ocrChunks.length > 0) {
                const joined = window.data.ocrChunks.filter(Boolean).join('\n\n');
                if (joined && joined.trim().length > 0) {
                    console.log('[ReferenceManagerDetail] 使用 window.data.ocrChunks 重建内容，块数:', window.data.ocrChunks.length);
                    return joined;
                }
            }
        }

        // 方式：历史数据（若存在）
        if (window.currentHistoryData && window.currentHistoryData.ocrResult) {
            console.log('[ReferenceManagerDetail] 使用 currentHistoryData.ocrResult');
            return window.currentHistoryData.ocrResult;
        }

        // 方式：从DOM中的文本内容获取（依据当前标签）
        const selector = active === 'translation'
            ? '#translation-content-wrapper'
            : '#tab-ocr-content, #ocr-content-wrapper';
        const contentEl = document.querySelector(selector) || document.querySelector('#tabContent .markdown-body');
        if (contentEl && contentEl.textContent && contentEl.textContent.trim()) {
            console.log('[ReferenceManagerDetail] 使用 DOM textContent, selector:', selector);
            return contentEl.textContent;
        }

        console.error('[ReferenceManagerDetail] 无法获取文档内容，尝试的方法:', {
            active,
            hasWindowData: !!window.data,
            hasOcr: !!(window.data && window.data.ocr),
            hasTranslation: !!(window.data && window.data.translation),
            hasOcrChunks: !!(window.data && Array.isArray(window.data.ocrChunks) && window.data.ocrChunks.length > 0),
            contentReady: !!window.contentReady,
            hasCurrentHistoryData: !!window.currentHistoryData,
            hasDOMContent: !!document.querySelector(selector) || !!document.querySelector('#tabContent .markdown-body')
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

        // 使用统一的提取方式选择对话框
        await showExtractionMethodDialog(section, markdown);
    };

    /**
     * 保存提取的文献
     */
    function saveExtractedReferences(references, markdown) {
        // 建立索引
        let indexed = references;
        if (markdown && global.ReferenceIndexer) {
            indexed = global.ReferenceIndexer.buildIndex(
                currentDocumentId,
                markdown,
                references
            );
        }

        // 保存
        global.ReferenceStorage?.saveReferences(
            currentDocumentId,
            indexed,
            {
                extractedAt: new Date().toISOString(),
                method: 'hybrid'
            }
        );

        // 显示
        currentReferences = indexed;
        updateReferenceCount(indexed.length);
        appendReferencesToContent(indexed);
        addToTOC();
        updatePanelContent();
    }

    /**
     * 使用AI处理文献
     */
    async function processWithAI(extracted, markdown) {
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

            saveExtractedReferences(finalReferences, markdown);
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
            ref.doi || (ref.doiFallback ? '(未找到)' : '')
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

    console.log('[ReferenceManagerDetail] Module loaded. v1.0.1 - Fixed refIndex error');

})(window);
