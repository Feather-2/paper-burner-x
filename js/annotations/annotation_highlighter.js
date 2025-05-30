/**
 * 应用块级或子块级元素的高亮和交互。
 * 容器中的任何块级元素（段落、标题、列表等）应具有 'data-block-index' 属性。
 * 块级元素内部的子块 (span) 应具有 'data-sub-block-id' 属性 (格式如 'parentIndex.subIndex')。
 * 批注应通过 'ann.target.selector[0].subBlockId' 或 'ann.target.selector[0].blockIndex' 来定位这些元素。
 *
 * @param {HTMLElement} containerElement - 内容的父容器元素。
 * @param {Array<Object>} allAnnotations - 文档的所有批注数据列表。
 * @param {string} contentIdentifier - 当前内容类型的标识符 ('ocr' 或 'translation')。
 */
function applyBlockAnnotations(containerElement, allAnnotations, contentIdentifier) {
    // ====== 调用时机日志 ======
    console.log('[applyBlockAnnotations] 被调用', {
        contentIdentifier,
        containerElement,
        annotationCount: allAnnotations ? allAnnotations.length : 0,
        callStack: (new Error().stack)
    });

    // ====== 新增：4.1日志（入口） ======
    try {
        const sub41 = containerElement.querySelector('.sub-block[data-sub-block-id="4.1"]');
        if (sub41) {
            console.log('[调试][入口] 4.1 outerHTML:', sub41.outerHTML);
            console.log('[调试][入口] 4.1 textContent:', sub41.textContent);
        } else {
            console.log('[调试][入口] 4.1 不存在');
        }
    } catch (e) { console.error('[调试][入口] 4.1 日志异常', e); }

    // ====== 新增：高亮应用前全局检测 ======
    const allBlocksPre = document.querySelectorAll('[data-block-index]');
    allBlocksPre.forEach(block => {
        const subs = block.querySelectorAll('.sub-block');
        console.log(`[检测][applyBlockAnnotations前] block#${block.dataset.blockIndex} 有${subs.length}个sub-block:`, Array.from(subs).map(sb => (sb.textContent || '').substring(0, 20)));
    });

    // 打印所有 sub-block 的内容（分割后）
    if (containerElement) {
        const allSubBlocks = containerElement.querySelectorAll('.sub-block');
        allSubBlocks.forEach(sb => {
            console.log('[applyBlockAnnotations][分割后] sub-block', sb.dataset.subBlockId, '内容：', sb.textContent);
        });
    }

    // ====== 日志：高亮应用开始 ======
    console.log(`[BlockHighlighter] 开始应用高亮，contentIdentifier=${contentIdentifier}`);
    const allSubBlocks = containerElement.querySelectorAll('.sub-block');
    console.log(`[BlockHighlighter] 当前子块数量: ${allSubBlocks.length}`);
    console.log(`[BlockHighlighter] 当前子块ID:`, Array.from(allSubBlocks).map(sb => sb.dataset.subBlockId));

    performance.mark('applyAnnotations-start');
    if (window.currentVisibleTabId === 'chunk-compare') {
        return;
    }
    if (!containerElement || !allAnnotations) {
        console.log("[BlockHighlighter] 未提供容器元素或批注数据。");
        return;
    }
    // ====== 日志：去重前 ======
    console.log('[BlockHighlighter] 去重前 annotation 数量:', allAnnotations.length);
    const beforeAnnList = allAnnotations.map(ann => ann.target && ann.target.selector && ann.target.selector[0] && ann.target.selector[0].subBlockId).filter(Boolean);
    console.log('[BlockHighlighter] 去重前 subBlockId 列表:', beforeAnnList);
    // ========== 去重 ==========
    const seen = new Set();
    const dedupedAnnotations = [];
    for (const ann of allAnnotations) {
        if (ann.targetType !== contentIdentifier) {
            dedupedAnnotations.push(ann);
            continue;
        }
        let key = '';
        if (ann.target && ann.target.selector && ann.target.selector[0]) {
            if (ann.target.selector[0].subBlockId) {
                key = 'subBlockId:' + ann.target.selector[0].subBlockId;
            } else if (ann.target.selector[0].blockIndex !== undefined) {
                key = 'blockIndex:' + ann.target.selector[0].blockIndex;
            }
        }
        if (!key) {
            dedupedAnnotations.push(ann);
            continue;
        }
        if (!seen.has(key)) {
            seen.add(key);
            dedupedAnnotations.push(ann);
        }
    }
    allAnnotations = dedupedAnnotations;
    // ====== 日志：去重后 ======
    console.log('[BlockHighlighter] 去重后 annotation 数量:', allAnnotations.length);
    const afterAnnList = allAnnotations.map(ann => ann.target && ann.target.selector && ann.target.selector[0] && ann.target.selector[0].subBlockId).filter(Boolean);
    console.log('[BlockHighlighter] 去重后 subBlockId 列表:', afterAnnList);

    // ====== 日志：清理高亮前 ======
    const beforeCleanSubBlocks = containerElement.querySelectorAll('.sub-block');
    console.log(`[BlockHighlighter] 清理前子块数量: ${beforeCleanSubBlocks.length}`);

    // 1. 只移除高亮样式和属性，不删除子块
    const existingAnnotationSpans = containerElement.querySelectorAll('[data-annotation-id]');
    function hasSubBlockDescendant(node) {
        if (!node || !node.querySelectorAll) return false;
        return node.querySelectorAll('.sub-block').length > 0;
    }

    existingAnnotationSpans.forEach(span => {
        if (span.classList.contains('sub-block')) {
            // 只移除高亮样式和批注属性，不删除子块
            span.style.backgroundColor = '';
            span.style.border = '';
            span.style.padding = '';
            span.style.borderRadius = '';
            span.style.boxShadow = '';
            span.classList.remove('annotated-sub-block', 'has-note');
            span.removeAttribute('data-annotation-id');
            span.removeAttribute('title');
        } else if (span.classList.contains('annotation-wrapper')) {
            const parent = span.parentNode;
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            span.remove();
        } else if (span.classList.contains('pre-annotated')) {
            // 只清理属性，不删除节点
            span.style.backgroundColor = '';
            span.style.border = '';
            span.style.padding = '';
            span.style.borderRadius = '';
            span.style.boxShadow = '';
            span.classList.remove('pre-annotated', 'annotated-block', 'annotated-sub-block', 'has-annotation', 'has-highlight', 'has-note');
            span.removeAttribute('data-annotation-id');
            span.removeAttribute('data-highlight-color');
            span.removeAttribute('title');
        } else {
            // 递归检测所有后代是否包含 .sub-block
            if (hasSubBlockDescendant(span)) {
                console.warn('[高亮清理保护-递归] 跳过包含 sub-block 的节点:', span.outerHTML);
                return;
            } else {
                span.remove();
            }
        }
    });

    // 2. 移除所有带有批注相关类的元素上的类和样式
    const existingHighlights = containerElement.querySelectorAll('.annotated-block, .annotated-sub-block');
    existingHighlights.forEach(el => {
        el.style.backgroundColor = '';
        el.style.border = '';
        el.style.padding = '';
        el.style.borderRadius = '';
        el.style.boxShadow = '';
        if (el.classList.contains('katex-display') || el.tagName === 'IMG' || el.tagName === 'TABLE') {
            el.style.display = '';
            el.style.width = '';
            el.style.marginLeft = '';
            el.style.marginRight = '';
        }
        const katexChild = el.querySelector('.katex-display');
        if (katexChild) {
            katexChild.style.border = ''; katexChild.style.padding = '';
            katexChild.style.display = ''; katexChild.style.width = '';
            katexChild.style.marginLeft = ''; katexChild.style.marginRight = '';
            katexChild.style.borderRadius = ''; katexChild.style.boxShadow = '';
        }
        const imgChild = el.querySelector('img');
        if (imgChild) {
            imgChild.style.border = ''; imgChild.style.padding = '';
            imgChild.style.display = ''; imgChild.style.width = '';
            imgChild.style.marginLeft = ''; imgChild.style.marginRight = '';
            imgChild.style.borderRadius = ''; imgChild.style.boxShadow = '';
        }
        const tableChild = el.querySelector('table');
        if (tableChild) {
            tableChild.style.border = ''; tableChild.style.padding = '';
            tableChild.style.display = ''; tableChild.style.width = '';
            tableChild.style.marginLeft = ''; tableChild.style.marginRight = '';
            tableChild.style.borderRadius = ''; tableChild.style.boxShadow = '';
        }
        el.classList.remove('annotated-block', 'annotated-sub-block', 'has-annotation', 'has-highlight');
        if (el.hasAttribute('data-annotation-id')) {
            el.removeAttribute('data-annotation-id');
        }
        if (el.hasAttribute('data-highlight-color')) {
            el.removeAttribute('data-highlight-color');
        }
        if (el.tagName === 'SPAN' && el.classList.contains('sub-block') &&
            el.parentElement && el.parentElement.tagName === 'TABLE') {
            const subBlockId = el.dataset.subBlockId;
            if (subBlockId) {
                const subBlockIdPrefix = subBlockId.split('.')[0];
                if (el.parentElement.dataset.blockIndex === subBlockIdPrefix) {
                    el.parentElement.style.border = '';
                    el.parentElement.style.padding = '';
                    el.parentElement.style.display = '';
                    el.parentElement.style.width = '';
                    el.parentElement.style.marginLeft = '';
                    el.parentElement.style.marginRight = '';
                    el.parentElement.style.borderRadius = '';
                    el.parentElement.style.boxShadow = '';
                }
            }
        }
        el.classList.remove('annotated-block', 'annotated-sub-block', 'has-note');
        el.removeAttribute('title');
        el.removeAttribute('data-annotation-id');
    });

    // ====== 日志：高亮应用前后子块对比 ======
    const afterCleanSubBlocks = containerElement.querySelectorAll('.sub-block');
    console.log(`[BlockHighlighter] 清理后子块数量: ${afterCleanSubBlocks.length}`);
    console.log(`[BlockHighlighter] 清理后子块ID:`, Array.from(afterCleanSubBlocks).map(sb => sb.dataset.subBlockId));

    // ====== 新增：4.1日志（高亮清理后） ======
    try {
        const sub41 = containerElement.querySelector('.sub-block[data-sub-block-id="4.1"]');
        if (sub41) {
            console.log('[调试][高亮清理后] 4.1 outerHTML:', sub41.outerHTML);
            console.log('[调试][高亮清理后] 4.1 textContent:', sub41.textContent);
        } else {
            console.log('[调试][高亮清理后] 4.1 不存在');
        }
    } catch (e) { console.error('[调试][高亮清理后] 4.1 日志异常', e); }

    // ====== 新增：高亮清理后全局检测 ======
    const allBlocksAfterHighlight = document.querySelectorAll('[data-block-index]');
    allBlocksAfterHighlight.forEach(block => {
        const subs = block.querySelectorAll('.sub-block');
        console.log(`[检测][高亮清理后] block#${block.dataset.blockIndex} 有${subs.length}个sub-block:`, Array.from(subs).map(sb => (sb.textContent || '').substring(0, 20)));
    });

    // 优先处理子块批注
    const subBlockElements = containerElement.querySelectorAll('span.sub-block[data-sub-block-id]');
    subBlockElements.forEach((subBlockElement) => {
        const subBlockId = subBlockElement.dataset.subBlockId;
        if (typeof subBlockId === 'undefined') {
            return;
        }
        // 新增：高亮循环前日志
        console.log('[高亮循环] subBlockId:', subBlockId, '内容:', subBlockElement.textContent);
        // 先用 subBlockId 匹配
        let annotation = allAnnotations.find(ann =>
            ann.targetType === contentIdentifier &&
            ann.target && Array.isArray(ann.target.selector) &&
            ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlockId &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );
        if (!annotation) {
            // fallback: 用 exact 匹配
            annotation = allAnnotations.find(ann =>
                ann.targetType === contentIdentifier &&
                ann.target && Array.isArray(ann.target.selector) &&
                ann.target.selector[0] &&
                ann.target.selector[0].exact &&
                subBlockElement.textContent &&
                subBlockElement.textContent.trim().replace(/\s+/g, '') === ann.target.selector[0].exact.trim().replace(/\s+/g, '') &&
                (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
            );
            if (annotation) {
                console.warn(`[高亮fallback] subBlockId未命中，使用exact文本匹配成功: "${subBlockElement.textContent.trim()}"`);
            }
        } else if (
            annotation.target && annotation.target.selector && annotation.target.selector[0] &&
            annotation.target.selector[0].exact &&
            subBlockElement.textContent.trim().replace(/\s+/g, '') !== annotation.target.selector[0].exact.trim().replace(/\s+/g, '')
        ) {
            // subBlockId 命中但内容和 exact 不一致，输出警告，但依然允许高亮
            console.warn(`[高亮警告] subBlockId 命中但内容和 exact 不一致: subBlockId=${subBlockId}, span内容="${subBlockElement.textContent.trim()}", exact="${annotation.target.selector[0].exact.trim()}"`);
        }
        if (annotation) {
            applyAnnotationToElement(subBlockElement, annotation, contentIdentifier, subBlockId, 'subBlock');
        }
    });

    // 块级批注
    const blockElements = containerElement.querySelectorAll('[data-block-index]');
    blockElements.forEach((blockElement) => {
        if (blockElement.querySelector('.annotated-sub-block')) {
            return;
        }
        const blockIdentifier = blockElement.dataset.blockIndex;
        if (typeof blockIdentifier === 'undefined') {
            return;
        }
        const annotation = allAnnotations.find(ann =>
            ann.targetType === contentIdentifier &&
            ann.target &&
            Array.isArray(ann.target.selector) &&
            ann.target.selector[0] &&
            !ann.target.selector[0].subBlockId &&
            (ann.target.selector[0].blockIndex === blockIdentifier || String(ann.target.selector[0].blockIndex) === blockIdentifier) &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );
        if (annotation) {
            applyAnnotationToElement(blockElement, annotation, contentIdentifier, blockIdentifier, 'block');
        }
    });

    // ====== 日志：高亮应用后子块对比 ======
    const afterHighlightSubBlocks = containerElement.querySelectorAll('.sub-block');
    console.log(`[BlockHighlighter] 高亮后子块数量: ${afterHighlightSubBlocks.length}`);
    console.log(`[BlockHighlighter] 高亮后子块ID:`, Array.from(afterHighlightSubBlocks).map(sb => sb.dataset.subBlockId));

    // ====== 新增：4.1日志（高亮应用后） ======
    try {
        const sub41 = containerElement.querySelector('.sub-block[data-sub-block-id="4.1"]');
        if (sub41) {
            console.log('[调试][高亮应用后] 4.1 outerHTML:', sub41.outerHTML);
            console.log('[调试][高亮应用后] 4.1 textContent:', sub41.textContent);
        } else {
            console.log('[调试][高亮应用后] 4.1 不存在');
        }
    } catch (e) { console.error('[调试][高亮应用后] 4.1 日志异常', e); }

    // ====== 新增：高亮应用后全局检测 ======
    allBlocksAfterHighlight.forEach(block => {
        const subs = block.querySelectorAll('.sub-block');
        console.log(`[检测][高亮应用后] block#${block.dataset.blockIndex} 有${subs.length}个sub-block:`, Array.from(subs).map(sb => (sb.textContent || '').substring(0, 20)));
    });

    // 只在 annotation 没有对应 DOM 时报警
    allAnnotations.forEach(ann => {
        if (ann.targetType === contentIdentifier && ann.target && ann.target.selector && ann.target.selector[0] && ann.target.selector[0].subBlockId) {
            const subBlockId = ann.target.selector[0].subBlockId;
            const dom = containerElement.querySelector(`.sub-block[data-sub-block-id=\"${subBlockId}\"]`);
            if (!dom) {
                console.warn(`[BlockHighlighter] annotation 指向的子块 ${subBlockId} 页面上不存在！`);
            }
        }
    });

    performance.mark('applyAnnotations-end');
    performance.measure('applyAnnotations', 'applyAnnotations-start', 'applyAnnotations-end');
}

/**
 * 辅助函数，将批注样式和事件应用到指定的元素 (块或子块)
 * @param {HTMLElement} element - 目标DOM元素
 * @param {Object} annotation - 批注对象
 * @param {string} contentIdentifier - 内容标识符 ('ocr' 或 'translation')
 * @param {string} elementIdentifier - 元素标识符 (blockIndex 或 subBlockId)
 * @param {'block'|'subBlock'} elementType - 元素类型
 */
function applyAnnotationToElement(element, annotation, contentIdentifier, elementIdentifier, elementType) {
    // ====== 高亮空内容保护 ======
    if ((!element.textContent || !element.textContent.trim()) && !element.querySelector('img')) {
        console.warn(`[高亮保护] 跳过空内容的${elementType}，subBlockId/blockIndex: ${elementIdentifier}，annotationId: ${annotation.id}`);
        return;
    }
    // ====== 高亮前日志 ======
    console.log(`[高亮应用] ${elementType}(${elementIdentifier}) 高亮前内容: "${element.textContent}"`);

    // ====== 精确高亮逻辑，仅对 subBlock 生效 ======
    if (elementType === 'subBlock' && annotation.target && annotation.target.selector && annotation.target.selector[0] && annotation.target.selector[0].exact) {
        const exact = annotation.target.selector[0].exact.trim();
        const elementText = element.textContent.trim();
        if (exact && elementText !== exact) {
            // 只高亮 exact 部分
            const idx = elementText.indexOf(exact);
            if (idx !== -1) {
                // 构造新的 HTML，exact 部分用 span 包裹
                const before = elementText.slice(0, idx);
                const match = elementText.slice(idx, idx + exact.length);
                const after = elementText.slice(idx + exact.length);
                // 构造高亮 span
                const highlightSpan = document.createElement('span');
                highlightSpan.className = 'exact-highlight annotated-sub-block';
                highlightSpan.style.backgroundColor = getHighlightColor(annotation.highlightColor || 'yellow');
                highlightSpan.style.borderRadius = '6px';
                highlightSpan.style.boxShadow = `0 0 5px ${getHighlightColor(annotation.highlightColor || 'yellow')}`;
                highlightSpan.style.padding = '0 3px';
                highlightSpan.textContent = match;
                if (annotation.body && annotation.body.length > 0 && annotation.body[0].value) {
                    highlightSpan.title = annotation.body[0].value;
                    highlightSpan.classList.add('has-note');
                }
                highlightSpan.dataset.annotationId = annotation.id;
                // 事件绑定
                if (!highlightSpan._annotationEventBound) {
                    highlightSpan.addEventListener('click', function handleClick(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const range = document.createRange();
                        range.selectNodeContents(this);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(range);
                        window.globalCurrentSelection = {
                            text: this.textContent,
                            range: range.cloneRange(),
                            annotationId: this.dataset.annotationId,
                            targetElement: this,
                            subBlockId: elementIdentifier
                        };
                        const parentBlock = this.closest('[data-block-index]');
                        if (parentBlock) {
                            window.globalCurrentSelection.blockIndex = parentBlock.dataset.blockIndex;
                        }
                        if (typeof window.checkIfTargetIsHighlighted === 'function' &&
                            typeof window.checkIfTargetHasNote === 'function' &&
                            typeof window.updateContextMenuOptions === 'function' &&
                            typeof window.showContextMenu === 'function') {
                            const isHighlighted = window.checkIfTargetIsHighlighted(annotation.id, contentIdentifier, elementIdentifier, 'subBlockId');
                            const hasNoteForClick = window.checkIfTargetHasNote(annotation.id, contentIdentifier, elementIdentifier, 'subBlockId');
                            window.updateContextMenuOptions(isHighlighted, hasNoteForClick);
                            window.showContextMenu(e.pageX, e.pageY);
                        }
                    });
                    highlightSpan._annotationEventBound = true;
                }
                // 构造新内容
                element.innerHTML = '';
                if (before) element.appendChild(document.createTextNode(before));
                element.appendChild(highlightSpan);
                if (after) element.appendChild(document.createTextNode(after));
                // 只做精确高亮，不再整体高亮
                return;
            } else {
                // 没找到 exact，降级为整体高亮
                console.warn(`[精确高亮] exact 未在 subBlock 中找到，降级为整体高亮: subBlockId=${elementIdentifier}, exact="${exact}", span内容="${elementText}"`);
            }
        }
    }

    // 获取原始颜色并调整为更浅的荧光色
    const originalColor = annotation.highlightColor || 'yellow';
    // 转换颜色为荧光浅色
    const color = getHighlightColor(originalColor);

    const note = annotation.body && annotation.body.length > 0 && annotation.body[0].value ? annotation.body[0].value : '';

    // 清除元素上的已有样式
    element.style.backgroundColor = '';
    element.style.border = '';
    element.style.padding = '';
    element.style.borderRadius = '';
    element.style.boxShadow = '';

    const katexDisplayElement = element.classList.contains('katex-display') ? element : element.querySelector('.katex-display');
    const imgElement = element.querySelector('img'); // Image *inside* current element (span or block)
    let effectiveTableToStyle = null;

    if (element.tagName === 'TABLE') {
        effectiveTableToStyle = element;
    } else if (element.parentElement && element.parentElement.tagName === 'TABLE' &&
               element.classList.contains('sub-block') && element.dataset.subBlockId) {
        // Crucial case: element is a span.sub-block inside a table.
        const parentTable = element.parentElement;
        const subBlockIdPrefix = element.dataset.subBlockId.split('.')[0];
        if (parentTable.dataset.blockIndex === subBlockIdPrefix) {
            effectiveTableToStyle = parentTable; // Style the parent table
        } else {
            // Span is in a table, but not its "block parent". Check if span itself contains a table.
            const tableInsideSpan = element.querySelector('table');
            if (tableInsideSpan) effectiveTableToStyle = tableInsideSpan;
        }
    } else {
        // Element is not a table, nor a span in a table matching above. Does it *contain* a table?
        const tableInsideElement = element.querySelector('table');
        if (tableInsideElement) effectiveTableToStyle = tableInsideElement;
    }

    // 为特殊元素类型应用现代化的荧光样式
    if (katexDisplayElement) {
        katexDisplayElement.style.border = `2px dashed ${color}`;
        katexDisplayElement.style.padding = '4px';
        katexDisplayElement.style.display = 'block';
        katexDisplayElement.style.width = 'fit-content';
        katexDisplayElement.style.marginLeft = 'auto';
        katexDisplayElement.style.marginRight = 'auto';
        katexDisplayElement.style.borderRadius = '12px';
    } else if (imgElement) {
        console.log('[图片高亮] imgElement:', imgElement);
        console.log('[图片高亮] 应用颜色:', color);
        console.log('[图片高亮] 父元素 (element) tagName:', element.tagName); // 查看父元素类型

        imgElement.style.setProperty('border', `2px dashed ${color}`, 'important');
        imgElement.style.padding = '4px';
        imgElement.style.display = 'block';
        imgElement.style.width = 'fit-content';
        imgElement.style.marginLeft = 'auto';
        imgElement.style.marginRight = 'auto';
        imgElement.style.borderRadius = '12px';
        imgElement.style.boxShadow = `0 0 5px ${color}`;
        console.log('[图片高亮] imgElement.style.border after set:', imgElement.style.border); // 确认样式是否应用
    } else if (effectiveTableToStyle) {
        effectiveTableToStyle.style.border = `2px dashed ${color}`;
        effectiveTableToStyle.style.padding = '4px';
        effectiveTableToStyle.style.display = 'block';
        effectiveTableToStyle.style.width = 'fit-content';
        effectiveTableToStyle.style.marginLeft = 'auto';
        effectiveTableToStyle.style.marginRight = 'auto';
        effectiveTableToStyle.style.borderRadius = '12px';
    } else {
        // 默认: 为普通文本元素应用背景色和荧光效果
        element.style.backgroundColor = color;
        element.style.borderRadius = '6px';
        element.style.boxShadow = `0 0 5px ${color}`;
        // 保持文本内边距以保持原有行高
        element.style.padding = '0 3px';
    }

    element.classList.add(elementType === 'subBlock' ? 'annotated-sub-block' : 'annotated-block');
    if (note) {
        element.title = note;
        element.classList.add('has-note');
    }
    element.dataset.annotationId = annotation.id;

    // 只绑定一次事件，避免内容丢失
    if (!element._annotationEventBound) {
        element.addEventListener('click', function handleClick(e) {
            e.preventDefault();
            e.stopPropagation();

            const range = document.createRange();
            range.selectNodeContents(this);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            window.globalCurrentSelection = {
                text: this.textContent,
                range: range.cloneRange(),
                annotationId: this.dataset.annotationId,
                targetElement: this
            };

            if (elementType === 'subBlock') {
                window.globalCurrentSelection.subBlockId = elementIdentifier;
                // 尝试从父元素获取 blockIndex
                const parentBlock = this.closest('[data-block-index]');
                if (parentBlock) {
                    window.globalCurrentSelection.blockIndex = parentBlock.dataset.blockIndex;
                }
            } else { // block
                window.globalCurrentSelection.blockIndex = elementIdentifier;
            }
            // console.log(`[BlockHighlighter] ${elementType} 点击，全局选区已设置:`, window.globalCurrentSelection);

            // 检查 annotation_logic.js 中的函数是否已更新
            // 优先使用 subBlockId (如果存在)，否则使用 blockIndex
            const idToCheck = this.dataset.annotationId;
            const identifierForCheck = elementType === 'subBlock' ? window.globalCurrentSelection.subBlockId : window.globalCurrentSelection.blockIndex;
            const typeForCheck = elementType === 'subBlock' ? 'subBlockId' : 'blockIndex';


            if (typeof window.checkIfTargetIsHighlighted === 'function' &&
                typeof window.checkIfTargetHasNote === 'function' &&
                typeof window.updateContextMenuOptions === 'function' &&
                typeof window.showContextMenu === 'function') {

                const isHighlighted = window.checkIfTargetIsHighlighted(idToCheck, contentIdentifier, identifierForCheck, typeForCheck);
                const hasNoteForClick = window.checkIfTargetHasNote(idToCheck, contentIdentifier, identifierForCheck, typeForCheck);

                window.updateContextMenuOptions(isHighlighted, hasNoteForClick);
                window.showContextMenu(e.pageX, e.pageY);
            } else {
                 // Fallback or error for older/missing functions from annotation_logic.js
                console.error("[BlockHighlighter] 上下文菜单相关函数 (checkIfTargetIsHighlighted, checkIfTargetHasNote) 未从 annotation_logic.js 中正确加载或未更新。");
                // Fallback to old block/paragraph logic if new generic functions are not available
                const oldBlockIndex = window.globalCurrentSelection.blockIndex; // Use blockIndex for fallback
                if (oldBlockIndex && typeof window.checkIfBlockIsHighlighted === 'function' && typeof window.checkIfBlockHasNote === 'function') {
                    console.log('[BlockHighlighter] 回退使用 checkIfBlockIsHighlighted/checkIfBlockHasNote');
                    const isHighlighted = window.checkIfBlockIsHighlighted(idToCheck, contentIdentifier, oldBlockIndex);
                    const hasNoteForClick = window.checkIfBlockHasNote(idToCheck, contentIdentifier, oldBlockIndex);
                    window.updateContextMenuOptions(isHighlighted, hasNoteForClick);
                    window.showContextMenu(e.pageX, e.pageY);
                } else {
                     console.error("[BlockHighlighter] 无法找到合适的上下文菜单检查函数。");
                }
            }
        });
        element._annotationEventBound = true;
    }

    // ====== 高亮后日志 ======
    setTimeout(() => {
        console.log(`[高亮应用] ${elementType}(${elementIdentifier}) 高亮后内容: "${element.textContent}"`);
    }, 0);
}

/**
 * 将颜色转换为更浅的荧光版本
 * @param {string} color - 原始颜色
 * @returns {string} - 转换后的荧光浅色
 */
function getHighlightColor(color) {
    // 颜色映射表 - 确保与CSS中的颜色匹配，调整亮度平衡
    const colorMap = {
        'yellow': 'rgba(255, 255, 0, 0.75)',      // 增加不透明度
        'pink': 'rgba(253, 170, 200, 0.75)',      // 增加不透明度
        'lightblue': 'rgba(95, 211, 250, 0.75)',  // 增加不透明度
        'blue': 'rgba(95, 211, 250, 0.75)',       // 增加不透明度
        'lightgreen': 'rgba(178, 253, 178, 0.75)',// 增加不透明度
        'green': 'rgba(178, 253, 178, 0.75)',     // 增加不透明度
        'purple': 'rgba(221, 160, 221, 0.75)',    // 增加不透明度
        'orange': 'rgba(255, 165, 0, 0.75)',      // 增加不透明度
        'red': 'rgba(255, 99, 71, 0.75)',         // 增加不透明度
        'cyan': 'rgba(0, 204, 204, 0.75)'         // 增加不透明度
    };

    // 如果是常见颜色，使用映射表
    if (colorMap[color.toLowerCase()]) {
        return colorMap[color.toLowerCase()];
    }

    // 如果是十六进制颜色，转换为半透明的RGBA
    if (color.startsWith('#')) {
        let r = 0, g = 0, b = 0;
        if (color.length === 4) {
            // #RGB格式
            r = parseInt(color[1] + color[1], 16);
            g = parseInt(color[2] + color[2], 16);
            b = parseInt(color[3] + color[3], 16);
        } else if (color.length === 7) {
            // #RRGGBB格式
            r = parseInt(color.substring(1, 3), 16);
            g = parseInt(color.substring(3, 5), 16);
            b = parseInt(color.substring(5, 7), 16);
        }
        return `rgba(${r}, ${g}, ${b}, 0.75)`;
    }

    // 如果是RGB或RGBA格式，转换为更透明的版本
    if (color.startsWith('rgb')) {
        if (color.startsWith('rgba')) {
            // 已经是RGBA格式，调整其不透明度
            const rgbaMatch = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
            if (rgbaMatch) {
                const [, r, g, b, a] = rgbaMatch;
                // 调整不透明度，最小0.75
                const newAlpha = Math.max(parseFloat(a), 0.75);
                return `rgba(${r}, ${g}, ${b}, ${newAlpha})`;
            }
        } else {
            // RGB格式，转换为RGBA
            const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
            if (rgbMatch) {
                const [, r, g, b] = rgbMatch;
                return `rgba(${r}, ${g}, ${b}, 0.75)`;
            }
        }
    }

    // 默认返回与CSS匹配的黄色高亮
    return 'rgba(255, 255, 0, 0.75)';
}

// ========== 新增：单个块/子块高亮/取消高亮 ==========
/**
 * 只高亮一个块或子块
 * @param {HTMLElement} element - 目标DOM元素
 * @param {Object} annotation - 批注对象
 * @param {string} contentIdentifier - 内容标识符 ('ocr' 或 'translation')
 * @param {string} elementIdentifier - 元素标识符 (blockIndex 或 subBlockId)
 * @param {'block'|'subBlock'} elementType - 元素类型
 */
function highlightBlockOrSubBlock(element, annotation, contentIdentifier, elementIdentifier, elementType) {
    applyAnnotationToElement(element, annotation, contentIdentifier, elementIdentifier, elementType);
}

/**
 * 只移除一个块或子块的高亮
 * @param {HTMLElement} element - 目标DOM元素
 */
function removeHighlightFromBlockOrSubBlock(element) {
    if (!element) return;
    element.style.backgroundColor = '';
    element.style.border = '';
    element.style.padding = '';
    element.style.borderRadius = '';
    element.style.boxShadow = '';
    element.classList.remove('annotated-block', 'annotated-sub-block', 'has-note', 'has-highlight');
    element.removeAttribute('title');
    element.removeAttribute('data-annotation-id');
    element.removeAttribute('data-highlight-color');
    // 还原特殊元素样式（如有）
    const katexDisplayElement = element.classList.contains('katex-display') ? element : element.querySelector('.katex-display');
    const imgElement = element.querySelector('img');
    const tableElement = element.tagName === 'TABLE' ? element : element.querySelector('table');
    [katexDisplayElement, imgElement, tableElement].forEach(el => {
        if (el) {
            el.style.border = '';
            el.style.padding = '';
            el.style.display = '';
            el.style.width = '';
            el.style.marginLeft = '';
            el.style.marginRight = '';
            el.style.borderRadius = '';
            el.style.boxShadow = '';
        }
    });
}

// 暴露新函数
window.applyBlockAnnotations = applyBlockAnnotations;

// 暂时保留旧的函数别名以便兼容 (尽管其内部逻辑已更新)
window.applyParagraphAnnotations = applyBlockAnnotations;

// 移除原始的applyPreprocessedAnnotations (如果存在)
if (window.applyPreprocessedAnnotations) {
    delete window.applyPreprocessedAnnotations;
}

// 导出到 window
window.highlightBlockOrSubBlock = highlightBlockOrSubBlock;
window.removeHighlightFromBlockOrSubBlock = removeHighlightFromBlockOrSubBlock;