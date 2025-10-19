// js/sub_block_segmenter.js
(function SubBlockSegmenter(global) {
    /**
     * 将块级元素内容按标点分割成子块 (span.sub-block)。
     * @param {HTMLElement} blockElement - 要分割的块级元素 (如 p, h1-h6)。
     * @param {string|number} parentBlockIndex - 父块的索引。
     */
    function segmentBlockIntoSubBlocks(blockElement, parentBlockIndex, force = false) {
        // 性能埋点：分块开始
        performance.mark('subBlock-start');
        // 调试开关：本文件的检测/一致性类日志统一受控
        const __SUBBLOCK_DEBUG__ = (function(){
            try {
                return !!(window && (window.ENABLE_SUBBLOCK_DEBUG || localStorage.getItem('ENABLE_SUBBLOCK_DEBUG') === 'true'));
            } catch { return false; }
        })();

        // ===== 新增：分割前检测 =====
        const preSubBlocks = Array.from(blockElement.querySelectorAll('.sub-block'));
        if (__SUBBLOCK_DEBUG__ && preSubBlocks.length > 0) {
            console.warn(`[SubBlockSegmenter][检测] 分割前已存在 ${preSubBlocks.length} 个 .sub-block，内容摘要：`, preSubBlocks.map(sb => (sb.textContent || '').substring(0, 30)));
        }
        const preTextContent = blockElement.textContent;

        // ===== 新增：详细日志 =====
        // console.log(`[SubBlockSegmenter] 开始分块 #${parentBlockIndex}, 元素类型: ${blockElement.tagName}, 内容前20字符: "${(blockElement.textContent || '').substring(0, 20)}..."`);

        // 检查是否已经有子块，如果有则记录它们
        const existingSubBlocks = blockElement.querySelectorAll('.sub-block');
        if (existingSubBlocks.length > 0) {
            // console.log(`[SubBlockSegmenter] 警告: 块 #${parentBlockIndex} 已有 ${existingSubBlocks.length} 个子块，这些将被重新生成`);
            // console.log(`[SubBlockSegmenter] 现有子块ID列表:`, Array.from(existingSubBlocks).map(sb => sb.dataset.subBlockId));
        }

        // 优化：只有当文本足够长且包含中文或英文句读符号才进行分块
        const rawText = (blockElement.textContent || '').trim();
        const containsCnPeriod = rawText.indexOf('。') !== -1;
        const containsEnPunct = /[\.!?;:]/.test(rawText);
        // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 文本长度: ${rawText.length}, CN句号: ${containsCnPeriod}, EN标点: ${containsEnPunct}`);

        // ===== 新增：公式感知检测 =====
        const hasFormula = checkForFormulas(blockElement, rawText);
        if (__SUBBLOCK_DEBUG__ && hasFormula) {
            console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 包含数学公式，启用公式感知分割`);
        }

        // 修改分割条件：包含公式的块使用不同的分割策略
        // 仅当文本很短且也不含中英文句读时才跳过；
        // 只要存在句读符，即使很短也执行分块以支持精确高亮。
        if (!force && !hasFormula && (rawText.length < 80 && (!containsCnPeriod && !containsEnPunct))) {
            // 跳过分割
            // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 不满足分块条件，跳过分块`);
            performance.mark('subBlock-end');
            performance.measure('subBlockSegmentSkipping', 'subBlock-start', 'subBlock-end');
            return;
        }

        // 如果块元素本身是表格，或者其内部有表格，则不进行分割处理
        if (blockElement.tagName === 'TABLE' || blockElement.querySelector('table')) {
            // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 是表格或包含表格，跳过分块`);
            return; // 直接返回，不修改表格内容
        }

        // ===== 新增：公式感知分割处理 =====
        if (hasFormula) {
            return segmentFormulaAwareBlock(blockElement, parentBlockIndex, rawText, __SUBBLOCK_DEBUG__);
        }

        // ===== 新增：保存原始内容，用于对比 =====
        const originalContent = blockElement.innerHTML;
        const originalTextContent = blockElement.textContent;

        let subBlockTrueCounter = 0; // Counter for non-empty sub-blocks
        const newChildNodesContainer = document.createDocumentFragment();
        let firstGeneratedSubBlockElement = null; // Store the first (potentially only) sub-block

        // Define delimiters: Chinese period or common English sentence punctuation
        // The regex captures the delimiter itself and any trailing whitespace.
        const delimiterRegex = /([。\.!?;:])(\s*)/g;

        let currentSpanContentNodes = []; // Nodes for the current sub-block being built

        function flushCurrentSpan(isEndOfBlock = false) {
            if (currentSpanContentNodes.length > 0) {
                const tempSpan = document.createElement('span'); // Temporary span to check if it's empty
                currentSpanContentNodes.forEach(n => tempSpan.appendChild(n.cloneNode(true))); // Use cloned nodes for check

                if (tempSpan.textContent.trim() !== "" || (isEndOfBlock && tempSpan.innerHTML.trim() !== "")) { // Ensure span is not just whitespace or empty HTML
                    const span = document.createElement('span');
                    span.className = 'sub-block';
                    const subBlockId = `${parentBlockIndex}.${subBlockTrueCounter}`;
                    span.dataset.subBlockId = subBlockId; // Corrected template literal

                    // ===== 新增：记录子块内容 =====
                    const subBlockContent = tempSpan.textContent;
                    // console.log(`[SubBlockSegmenter] 创建子块 #${subBlockId}, 内容前20字符: "${subBlockContent.substring(0, 20)}..."`);

                    currentSpanContentNodes.forEach(n => span.appendChild(n)); // Append original nodes
                    newChildNodesContainer.appendChild(span);

                    if (subBlockTrueCounter === 0) { // If this is the first non-empty sub-block
                        firstGeneratedSubBlockElement = span;
                    } else { // If we've already found one and now found another, it's not the only one
                        firstGeneratedSubBlockElement = null; // Invalidate, as there are multiple
                    }
                    subBlockTrueCounter++;
                } else {
                    // console.log(`[SubBlockSegmenter] 跳过空子块 #${parentBlockIndex}.${subBlockTrueCounter}`);
                }
                currentSpanContentNodes = [];
            }
        }

        function processNodesRecursive(nodes) {
            for (const node of nodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    let text = node.textContent;
                    let lastIndex = 0;
                    let match;
                    if (text.trim() === '' && currentSpanContentNodes.length === 0) { // Skip leading pure whitespace text nodes if current span is empty
                        continue;
                    }
                    while ((match = delimiterRegex.exec(text)) !== null) {
                        // Add text before delimiter
                        if (match.index > lastIndex) {
                            currentSpanContentNodes.push(document.createTextNode(text.substring(lastIndex, match.index)));
                        }
                        // Add the delimiter itself
                        currentSpanContentNodes.push(document.createTextNode(match[1]));
                        // Add trailing space if captured
                        if (match[2]) {
                            currentSpanContentNodes.push(document.createTextNode(match[2]));
                        }
                        flushCurrentSpan(); // End of a sub-block
                        lastIndex = match.index + match[0].length;
                    }
                    // Add remaining text after the last delimiter
                    if (lastIndex < text.length) {
                        currentSpanContentNodes.push(document.createTextNode(text.substring(lastIndex)));
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // For inline elements, clone them and add to current span content.
                    currentSpanContentNodes.push(node.cloneNode(true));
                } else {
                    // Other node types (comments, etc.), clone and add.
                    currentSpanContentNodes.push(node.cloneNode(true));
                }
            }
        }

        processNodesRecursive(Array.from(blockElement.childNodes));
        flushCurrentSpan(true); // Flush any remaining content, isEndOfBlock = true

        // ===== 新增：对比分块前后的内容 =====
        // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 分块前文本长度: ${originalTextContent.length}`);

        // Clear original content and append new sub-block spans
        blockElement.innerHTML = '';
        blockElement.appendChild(newChildNodesContainer);

        // ===== 新增：分割后检测 =====
        const postSubBlocks = Array.from(blockElement.querySelectorAll('.sub-block'));
        const postTextContent = blockElement.textContent;
        if (preSubBlocks.length > 0) {
            if (__SUBBLOCK_DEBUG__ && postSubBlocks.length < preSubBlocks.length) {
                console.error(`[SubBlockSegmenter][检测] 分割后子块数量变少！分割前: ${preSubBlocks.length}，分割后: ${postSubBlocks.length}`);
                console.error(`[SubBlockSegmenter][检测] 分割前内容摘要:`, preSubBlocks.map(sb => (sb.textContent || '').substring(0, 30)));
                console.error(`[SubBlockSegmenter][检测] 分割后内容摘要:`, postSubBlocks.map(sb => (sb.textContent || '').substring(0, 30)));
            }
            // 检查内容拼接（如前后内容合并到一个 span）
            if (__SUBBLOCK_DEBUG__ && postSubBlocks.length === 1 && preSubBlocks.length > 1) {
                const mergedContent = postSubBlocks[0].textContent || '';
                const preConcat = preSubBlocks.map(sb => sb.textContent || '').join('');
                if (mergedContent.replace(/\s+/g, '') === preConcat.replace(/\s+/g, '')) {
                    console.error(`[SubBlockSegmenter][检测] 分割后所有内容被合并到一个子块！内容：${mergedContent.substring(0, 50)}...`);
                }
            }
        }
        if (postSubBlocks.length > 0) {
            // 检查是否有异常长的子块（仅在开启调试时输出）
            const maxLen = Math.max(...postSubBlocks.map(sb => (sb.textContent || '').length));
            if (__SUBBLOCK_DEBUG__ && maxLen > 500 && postSubBlocks.length > 1) {
                console.warn(`[SubBlockSegmenter][检测] 存在异常长的子块，长度: ${maxLen}`);
            }
        }

        // ===== 新增：验证分块后的内容完整性 =====
        const newTextContent = blockElement.textContent;
        // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 分块后文本长度: ${newTextContent.length}`);

        if (__SUBBLOCK_DEBUG__ && originalTextContent.trim() !== newTextContent.trim()) {
            console.warn(`[SubBlockSegmenter] 警告: 块 #${parentBlockIndex} 分块前后内容不一致!`);
            console.warn(`[SubBlockSegmenter] 分块前内容: "${originalTextContent.substring(0, 50)}..."`);
            console.warn(`[SubBlockSegmenter] 分块后内容: "${newTextContent.substring(0, 50)}..."`);
        }

        // After all processing, if firstGeneratedSubBlockElement is still set (i.e., subBlockTrueCounter ended at 1)
        if (firstGeneratedSubBlockElement && subBlockTrueCounter === 1) {
            firstGeneratedSubBlockElement.dataset.isOnlySubBlock = "true";
            // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 只有一个子块，标记为 isOnlySubBlock=true`);
        }

        // ===== 新增：记录最终生成的子块 =====
        const finalSubBlocks = blockElement.querySelectorAll('.sub-block');
        // console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 最终生成 ${finalSubBlocks.length} 个子块`);
        // console.log(`[SubBlockSegmenter] 子块ID列表:`, Array.from(finalSubBlocks).map(sb => sb.dataset.subBlockId));

        // 分割后检测分割一致性
        if (window.data && window.data.annotations) {
            const allSubBlocks = Array.from(blockElement.querySelectorAll('.sub-block'));
            allSubBlocks.forEach(sb => {
                const subBlockId = sb.dataset.subBlockId;
                const content = (sb.textContent || '').trim();
                // 查找 annotation 里的 exact
                const ann = window.data.annotations.find(a => a.target && a.target.selector && a.target.selector[0] && a.target.selector[0].subBlockId === subBlockId);
                if (__SUBBLOCK_DEBUG__ && ann && ann.target.selector[0].exact) {
                    const exact = ann.target.selector[0].exact.trim();
                    if (content !== exact) {
                        console.warn(`[分割一致性检测] subBlockId=${subBlockId} 分割内容与 annotation.exact 不一致！\n分割内容: "${content}"\nannotation.exact: "${exact}"`);
                    }
                }
                //console.log(`[分割一致性] subBlockId=${subBlockId} 内容: "${content.substring(0, 40)}..."`);
            });
        }

        // 性能埋点：分块结束
        performance.mark('subBlock-end');
        performance.measure('subBlockSegment', 'subBlock-start', 'subBlock-end');
    }

    // Expose public interface
    // ===== 新增：公式检测函数 =====
    function checkForFormulas(blockElement, rawText) {
        // 检查LaTeX公式模式
        const latexPatterns = [
            /\$\$[\s\S]*?\$\$/,     // 块级公式 $$...$$
            /\\\[[\s\S]*?\\\]/,   // 块级公式 \[...\]
            /\$[^$\n]+\$/,          // 行内公式 $...$
            /\\\([^\n]*?\\\)/     // 行内公式 \(...\)
        ];
        
        // 检查是否包含数学公式
        for (const pattern of latexPatterns) {
            if (pattern.test(rawText)) {
                return true;
            }
        }
        
        // 检查是否已经渲染的KaTeX元素
        if (blockElement.querySelector('.katex, .katex-display, .katex-inline')) {
            return true;
        }
        
        return false;
    }

    // ===== 新增：将整个块包装为单一子块（保留内部 DOM，不破坏 KaTeX） =====
    function wrapAsSingleSubBlock(blockElement, parentBlockIndex) {
        // 若已经是单一子块则跳过
        const existing = blockElement.querySelectorAll(':scope > .sub-block');
        if (existing.length === 1 && existing[0].dataset && existing[0].dataset.isOnlySubBlock === 'true') {
            return;
        }
        const span = document.createElement('span');
        span.className = 'sub-block';
        span.dataset.subBlockId = `${parentBlockIndex}.0`;
        span.dataset.isOnlySubBlock = 'true';
        while (blockElement.firstChild) {
            span.appendChild(blockElement.firstChild);
        }
        blockElement.appendChild(span);
    }

    // ===== 新增：公式感知的分割函数 =====
    function segmentFormulaAwareBlock(blockElement, parentBlockIndex, rawText, debug) {
        if (debug) {
            console.log(`[SubBlockSegmenter] 开始公式感知分割，块 #${parentBlockIndex}`);
        }

        // 检测公式位置和类型
        const formulaInfo = analyzeFormulas(blockElement, rawText);

        // 为了避免切断 KaTeX 或将 $$...$$ 拆分为多个子块，
        // 对包含公式的块统一包装为一个原子子块。
        if (formulaInfo.hasBlockFormula || formulaInfo.renderedFormulas.length > 0) {
            if (debug) {
                console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 含块级/已渲染公式，包装为单一子块（原子）。`);
            }
            wrapAsSingleSubBlock(blockElement, parentBlockIndex);
            return;
        }

        if (formulaInfo.hasInlineFormula) {
            // 只有行内公式：使用保守分割策略，仅按句号分割且保留 DOM
            return segmentWithInlineFormulaProtection(blockElement, parentBlockIndex, debug);
        }

        // 没有检测到公式，交由普通分割逻辑（由调用方继续执行）
        return;
    }

    // ===== 新增：分析公式信息 =====
    function analyzeFormulas(blockElement, rawText) {
        const info = {
            hasBlockFormula: false,
            hasInlineFormula: false,
            blockFormulas: [],
            inlineFormulas: [],
            renderedFormulas: []
        };

        // 检测块级公式
        const blockFormulaRegex = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g;
        let match;
        while ((match = blockFormulaRegex.exec(rawText)) !== null) {
            info.hasBlockFormula = true;
            info.blockFormulas.push({
                content: match[0],
                start: match.index,
                end: match.index + match[0].length
            });
        }

        // 检测行内公式
        const inlineFormulaRegex = /\$[^$\n]+\$|\\\([^\n]*?\\\)/g;
        while ((match = inlineFormulaRegex.exec(rawText)) !== null) {
            info.hasInlineFormula = true;
            info.inlineFormulas.push({
                content: match[0],
                start: match.index,
                end: match.index + match[0].length
            });
        }

        // 检测已渲染的公式
        const katexElements = blockElement.querySelectorAll('.katex, .katex-display, .katex-inline');
        if (katexElements.length > 0) {
            Array.from(katexElements).forEach(el => {
                info.renderedFormulas.push({
                    element: el,
                    type: el.classList.contains('katex-display') ? 'block' : 'inline'
                });
            });
        }

        return info;
    }

    // ===== 新增：按公式边界分割 =====
    function segmentByFormulaBreaks(blockElement, parentBlockIndex, formulaInfo, debug) {
        if (debug) {
            console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 按公式边界分割，发现${formulaInfo.blockFormulas.length}个块级公式`);
        }

        // 获取所有分割点（句号 + 块级公式边界）
        const rawText = blockElement.textContent || '';
        const breakPoints = [];
        
        // 添加句号分割点
        let sentenceMatch;
        const sentenceRegex = /[。]/g;
        while ((sentenceMatch = sentenceRegex.exec(rawText)) !== null) {
            breakPoints.push(sentenceMatch.index + 1); // +1 to include the period
        }
        
        // 添加公式边界分割点
        formulaInfo.blockFormulas.forEach(formula => {
            breakPoints.push(formula.start);
            breakPoints.push(formula.end);
        });
        
        // 排序并去重
        const uniqueBreakPoints = [...new Set(breakPoints)].sort((a, b) => a - b);
        
        if (uniqueBreakPoints.length <= 2) {
            // 分割点太少，跳过分割
            return;
        }
        
        // 执行分割
        return performSmartSegmentation(blockElement, parentBlockIndex, uniqueBreakPoints, rawText, debug);
    }

    // ===== 新增：行内公式保护分割 =====
    function segmentWithInlineFormulaProtection(blockElement, parentBlockIndex, debug) {
        if (debug) {
            console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 使用行内公式保护分割`);
        }
        
        // 只在句号处分割，避免切断行内公式
        const rawText = blockElement.textContent || '';
        const breakPoints = [0]; // 起始点
        
        let match;
        const sentenceRegex = /[。]/g;
        while ((match = sentenceRegex.exec(rawText)) !== null) {
            breakPoints.push(match.index + 1);
        }
        
        breakPoints.push(rawText.length); // 结束点
        
        if (breakPoints.length <= 2) {
            return; // 没有有效分割点
        }
        
        return performSmartSegmentation(blockElement, parentBlockIndex, breakPoints, rawText, debug);
    }

    // ===== 新增：智能分割执行 =====
    function performSmartSegmentation(blockElement, parentBlockIndex, breakPoints, rawText, debug) {
        let subBlockTrueCounter = 0;
        const newChildNodesContainer = document.createDocumentFragment();
        let firstGeneratedSubBlockElement = null;

        for (let i = 0; i < breakPoints.length - 1; i++) {
            const start = breakPoints[i];
            const end = breakPoints[i + 1];
            const segmentText = rawText.substring(start, end).trim();
            
            if (segmentText.length === 0) continue;
            
            // 创建子块
            const span = document.createElement('span');
            span.className = 'sub-block';
            const subBlockId = `${parentBlockIndex}.${subBlockTrueCounter}`;
            span.dataset.subBlockId = subBlockId;
            span.textContent = segmentText;
            
            if (debug) {
                console.log(`[SubBlockSegmenter] 创建智能子块 #${subBlockId}, 内容: "${segmentText.substring(0, 30)}..."`);
            }
            
            newChildNodesContainer.appendChild(span);
            
            if (subBlockTrueCounter === 0) {
                firstGeneratedSubBlockElement = span;
            } else {
                firstGeneratedSubBlockElement = null;
            }
            
            subBlockTrueCounter++;
        }
        
        if (subBlockTrueCounter > 0) {
            blockElement.innerHTML = '';
            blockElement.appendChild(newChildNodesContainer);
            
            // 标记唯一子块
            if (firstGeneratedSubBlockElement && subBlockTrueCounter === 1) {
                firstGeneratedSubBlockElement.dataset.isOnlySubBlock = "true";
            }
            
            if (debug) {
                console.log(`[SubBlockSegmenter] 块 #${parentBlockIndex} 智能分割完成，生成 ${subBlockTrueCounter} 个子块`);
            }
        }
    }

    global.SubBlockSegmenter = {
        segment: segmentBlockIntoSubBlocks,
        // 暴露新功能用于测试
        checkForFormulas: checkForFormulas,
        analyzeFormulas: analyzeFormulas
    };

})(window);
