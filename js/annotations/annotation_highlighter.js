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
    const __ANNOTATION_DEBUG__ = (function(){
        try { return !!(window && (window.ENABLE_ANNOTATION_DEBUG || localStorage.getItem('ENABLE_ANNOTATION_DEBUG') === 'true')); } catch { return false; }
    })();
    // ====== 调用时机日志 ======
    // console.log('[applyBlockAnnotations] 被调用', {
    //    contentIdentifier,
    //    containerElement,
    //    annotationCount: allAnnotations ? allAnnotations.length : 0,
    //    callStack: (new Error().stack)
    //});

    // ====== 新增：4.1日志（入口） ======
    try {
        const sub41 = containerElement.querySelector('.sub-block[data-sub-block-id="4.1"]');
        if (sub41) {
            //console.log('[调试][入口] 4.1 outerHTML:', sub41.outerHTML);
            //console.log('[调试][入口] 4.1 textContent:', sub41.textContent);
        } else {
            //console.log('[调试][入口] 4.1 不存在');
        }
    } catch (e) { console.error('[调试][入口] 4.1 日志异常', e); }

    // ====== 新增：高亮应用前全局检测 ======
    if (__ANNOTATION_DEBUG__) {
        const allBlocksPre = containerElement.querySelectorAll('[data-block-index]');
        allBlocksPre.forEach(block => {
            const subs = block.querySelectorAll('.sub-block');
            // console.log(`[检测][applyBlockAnnotations前] block#${block.dataset.blockIndex} 有${subs.length}个sub-block:`, Array.from(subs).map(sb => (sb.textContent || '').substring(0, 20)));
        });
    }

    // 打印所有 sub-block 的内容（分割后）
    if (__ANNOTATION_DEBUG__) {
        if (containerElement) {
            const allSubBlocks = containerElement.querySelectorAll('.sub-block');
            allSubBlocks.forEach(sb => {
                // console.log('[applyBlockAnnotations][分割后] sub-block', sb.dataset.subBlockId, '内容：', sb.textContent);
            });
        }
    }

    // ====== 日志：高亮应用开始 ======
    //console.log(`[BlockHighlighter] 开始应用高亮，contentIdentifier=${contentIdentifier}`);
    const allSubBlocks = containerElement.querySelectorAll('.sub-block');
    //console.log(`[BlockHighlighter] 当前子块数量: ${allSubBlocks.length}`);
    //console.log(`[BlockHighlighter] 当前子块ID:`, Array.from(allSubBlocks).map(sb => sb.dataset.subBlockId));

    performance.mark('applyAnnotations-start');
    if (window.currentVisibleTabId === 'chunk-compare') {
        return;
    }
    if (!containerElement || !allAnnotations) {
        //console.log("[BlockHighlighter] 未提供容器元素或批注数据。");
        return;
    }
    // ====== 日志：去重前 ======
    //console.log('[BlockHighlighter] 去重前 annotation 数量:', allAnnotations.length);
    const beforeAnnList = __ANNOTATION_DEBUG__ ? allAnnotations.map(ann => ann.target && ann.target.selector && ann.target.selector[0] && ann.target.selector[0].subBlockId).filter(Boolean) : [];
    //console.log('[BlockHighlighter] 去重前 subBlockId 列表:', beforeAnnList);
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
                if (ann.target.selector[0].type === 'SubBlockRangeSelector' && (Number.isFinite(ann.target.selector[0].startOffset) || Number.isFinite(ann.target.selector[0].endOffset))) {
                    key = 'subBlockRange:' + ann.target.selector[0].subBlockId + ':' + (ann.target.selector[0].startOffset || 0) + ':' + (ann.target.selector[0].endOffset || 0);
                } else {
                    key = 'subBlockId:' + ann.target.selector[0].subBlockId;
                }
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
    //console.log('[BlockHighlighter] 去重后 annotation 数量:', allAnnotations.length);
    const afterAnnList = __ANNOTATION_DEBUG__ ? allAnnotations.map(ann => ann.target && ann.target.selector && ann.target.selector[0] && ann.target.selector[0].subBlockId).filter(Boolean) : [];
    //console.log('[BlockHighlighter] 去重后 subBlockId 列表:', afterAnnList);

    // ====== 日志：清理高亮前 ======
    const beforeCleanSubBlocks = __ANNOTATION_DEBUG__ ? containerElement.querySelectorAll('.sub-block') : [];
    //console.log(`[BlockHighlighter] 清理前子块数量: ${beforeCleanSubBlocks.length}`);

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
            span.classList.remove('annotated-sub-block', 'has-note', 'cross-block-highlight');
            span.removeAttribute('data-annotation-id');
            span.removeAttribute('title');
            // 移除跨子块标识
            const indicator = span.querySelector('.cross-block-indicator');
            if (indicator) indicator.remove();
        } else if (span.classList.contains('annotation-wrapper')) {
            const parent = span.parentNode;
            // 清掉内部的跨子块指示器
            const indicator = span.querySelector('.cross-block-indicator');
            if (indicator) indicator.remove();
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
            span.classList.remove('pre-annotated', 'annotated-block', 'annotated-sub-block', 'has-annotation', 'has-highlight', 'has-note', 'cross-block-highlight');
            span.removeAttribute('data-annotation-id');
            span.removeAttribute('data-highlight-color');
            span.removeAttribute('title');
        } else {
            // 递归检测所有后代是否包含 .sub-block
            if (hasSubBlockDescendant(span)) {
                if (__ANNOTATION_DEBUG__) console.warn('[高亮清理保护-递归] 跳过包含 sub-block 的节点:', span.outerHTML);
                return;
            } else {
                // 通用“安全解包”：保留文本内容，不删正文
                const parent = span.parentNode;
                // 移除内部跨子块指示器
                const indicator = span.querySelector && span.querySelector('.cross-block-indicator');
                if (indicator) indicator.remove();
                if (span.childNodes && span.childNodes.length > 0) {
                    while (span.firstChild) {
                        parent.insertBefore(span.firstChild, span);
                    }
                    span.remove();
                } else {
                    // 仅文本内容（或为空）：将文本节点放回去
                    const text = span.textContent || '';
                    if (text) parent.insertBefore(document.createTextNode(text), span);
                    span.remove();
                }
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
        el.classList.remove('annotated-block', 'annotated-sub-block', 'has-annotation', 'has-highlight', 'cross-block-highlight');
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
        el.classList.remove('annotated-block', 'annotated-sub-block', 'has-note', 'cross-block-highlight');
        el.removeAttribute('title');
        el.removeAttribute('data-annotation-id');
        // 移除跨子块标识
        const indicator = el.querySelector('.cross-block-indicator');
        if (indicator) indicator.remove();
    });

    // ====== 日志：高亮应用前后子块对比 ======
    const afterCleanSubBlocks = __ANNOTATION_DEBUG__ ? containerElement.querySelectorAll('.sub-block') : [];
    //console.log(`[BlockHighlighter] 清理后子块数量: ${afterCleanSubBlocks.length}`);
    //console.log(`[BlockHighlighter] 清理后子块ID:`, Array.from(afterCleanSubBlocks).map(sb => sb.dataset.subBlockId));

    // ====== 新增：4.1日志（高亮清理后） ======
    try {
        const sub41 = containerElement.querySelector('.sub-block[data-sub-block-id="4.1"]');
        if (sub41) {
            //console.log('[调试][高亮清理后] 4.1 outerHTML:', sub41.outerHTML);
            //console.log('[调试][高亮清理后] 4.1 textContent:', sub41.textContent);
        } else {
            //console.log('[调试][高亮清理后] 4.1 不存在');
        }
    } catch (e) { console.error('[调试][高亮清理后] 4.1 日志异常', e); }

    // ====== 新增：高亮清理后全局检测 ======
    if (__ANNOTATION_DEBUG__) {
        const allBlocksAfterHighlight = containerElement.querySelectorAll('[data-block-index]');
        allBlocksAfterHighlight.forEach(block => {
            const subs = block.querySelectorAll('.sub-block');
            //console.log(`[检测][高亮清理后] block#${block.dataset.blockIndex} 有${subs.length}个sub-block:`, Array.from(subs).map(sb => (sb.textContent || '').substring(0, 20)));
        });
    }

    // 优先处理子块批注
    // 先构建索引，避免每个元素 O(n) 查找
    const subBlockMap = new Map();
    const blockIndexMap = new Map();
    if (Array.isArray(allAnnotations)) {
        for (const ann of allAnnotations) {
            if (!ann || ann.targetType !== contentIdentifier || !ann.target || !Array.isArray(ann.target.selector)) continue;
            const sel = ann.target.selector[0];
            if (!sel) continue;
            if (sel.subBlockId && (ann.motivation === 'highlighting' || ann.motivation === 'commenting')) {
                // 支持同一子块多个注解（尤其是区间标注）
                if (!subBlockMap.has(sel.subBlockId)) subBlockMap.set(sel.subBlockId, []);
                subBlockMap.get(sel.subBlockId).push(ann);
            } else if ((sel.blockIndex !== undefined) && (ann.motivation === 'highlighting' || ann.motivation === 'commenting')) {
                const key = String(sel.blockIndex);
                if (!blockIndexMap.has(key)) blockIndexMap.set(key, ann);
            }
        }
    }

    // 支持真实子块(span)与虚拟子块(段落等被临时标记了 data-sub-block-id)
    const subBlockElements = containerElement.querySelectorAll('[data-sub-block-id]');
    subBlockElements.forEach((subBlockElement) => {
        const subBlockId = subBlockElement.dataset.subBlockId;
        if (typeof subBlockId === 'undefined') return;
        let annotationsForThis = subBlockMap.get(subBlockId);
        if (!annotationsForThis || annotationsForThis.length === 0) {
            // fallback: exact 文本匹配（仅在调试或确有 exact 才考虑）
            const text = subBlockElement.textContent && subBlockElement.textContent.trim();
            if (text) {
                const annotation = allAnnotations && allAnnotations.find(ann =>
                    ann.targetType === contentIdentifier && ann.target && Array.isArray(ann.target.selector) &&
                    ann.target.selector[0] && ann.target.selector[0].exact &&
                    text.replace(/\s+/g, '') === ann.target.selector[0].exact.trim().replace(/\s+/g, '') &&
                    (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
                );
                if (annotation) {
                    annotationsForThis = [annotation];
                    if (__ANNOTATION_DEBUG__) console.warn(`[高亮fallback] subBlockId未命中，使用exact文本匹配成功: "${text}"`);
                }
            }
        } else {
            // 检查 exact 一致性（仅非区间注解提示）；区间注解不依赖 exact
            if (annotationsForThis.length === 1) {
                const ann = annotationsForThis[0];
                const s0 = ann && ann.target && ann.target.selector && ann.target.selector[0];
                const isRange = s0 && s0.type === 'SubBlockRangeSelector';
                if (!isRange && s0 && s0.exact && subBlockElement.textContent) {
                    const now = subBlockElement.textContent.trim().replace(/\s+/g, '');
                    const old = String(s0.exact).trim().replace(/\s+/g, '');
                    if (now !== old) {
                        if (__ANNOTATION_DEBUG__) console.warn(`[高亮提示] subBlockId=${subBlockId} 内容与 exact 不一致，已临时纠正 exact 以避免误差`);
                        try { ann.target.selector[0].exact = subBlockElement.textContent.trim(); } catch { /* noop */ }
                    }
                }
            }
        }
        if (annotationsForThis && annotationsForThis.length) {
            annotationsForThis.forEach(ann => applyAnnotationToElement(subBlockElement, ann, contentIdentifier, subBlockId, 'subBlock'));
        }
    });

    // 已移除：整块高亮渲染（统一为跨子块/子块内区间模式）

    // ====== 日志：高亮应用后子块对比 ======
    const afterHighlightSubBlocks = __ANNOTATION_DEBUG__ ? containerElement.querySelectorAll('.sub-block') : [];
    ////console.log(`[BlockHighlighter] 高亮后子块数量: ${afterHighlightSubBlocks.length}`);
    ////console.log(`[BlockHighlighter] 高亮后子块ID:`, Array.from(afterHighlightSubBlocks).map(sb => sb.dataset.subBlockId));

    // ====== 新增：4.1日志（高亮应用后） ======
    try {
        const sub41 = containerElement.querySelector('.sub-block[data-sub-block-id="4.1"]');
        if (sub41) {
            //console.log('[调试][高亮应用后] 4.1 outerHTML:', sub41.outerHTML);
            //console.log('[调试][高亮应用后] 4.1 textContent:', sub41.textContent);
        } else {
            //console.log('[调试][高亮应用后] 4.1 不存在');
        }
    } catch (e) { console.error('[调试][高亮应用后] 4.1 日志异常', e); }

    // ====== 新增：高亮应用后全局检测 ======
    if (__ANNOTATION_DEBUG__) {
        const allBlocksAfterHighlight = containerElement.querySelectorAll('[data-block-index]');
        allBlocksAfterHighlight.forEach(block => {
            const subs = block.querySelectorAll('.sub-block');
            //console.log(`[检测][高亮应用后] block#${block.dataset.blockIndex} 有${subs.length}个sub-block:`, Array.from(subs).map(sb => (sb.textContent || '').substring(0, 20)));
        });
    }

    // ====== 新增：处理跨子块批注 ======
    if (Array.isArray(allAnnotations)) {
        let crossBlockAnnotations = allAnnotations.filter(ann => 
            ann && ann.isCrossBlock === true && 
            ann.targetType === contentIdentifier &&
            ann.target && Array.isArray(ann.target.selector) &&
            ann.target.selector[0] && ann.target.selector[0].type === 'CrossBlockRangeSelector' &&
            Array.isArray(ann.target.selector[0].affectedSubBlocks)
        );

        // 跨子块去重：按 id 优先，其次按子块集合+偏移
        const seenCross = new Set();
        const deduped = [];
        crossBlockAnnotations.forEach(ann => {
            const sel = ann.target.selector[0];
            const keyId = ann.id || '';
            const keySet = (sel.affectedSubBlocks.slice().sort().join('|') + ':' + (sel.startOffset||'') + ':' + (sel.endOffset||''));
            const key = keyId ? ('id:' + keyId) : ('set:' + keySet);
            if (!seenCross.has(key)) { seenCross.add(key); deduped.push(ann); }
        });
        crossBlockAnnotations = deduped;

        console.log(`[跨子块高亮] 找到 ${crossBlockAnnotations.length} 个跨子块批注`);

        crossBlockAnnotations.forEach(annotation => {
            const selector = annotation.target.selector[0];
            const affectedSubBlocks = selector.affectedSubBlocks;
            
            console.log(`[跨子块高亮] 处理跨子块批注 ${annotation.id}，涉及子块:`, affectedSubBlocks);

            // 调用跨子块高亮功能
            if (typeof window.applyCrossBlockAnnotation === 'function') {
                console.log(`[跨子块高亮] 调用 applyCrossBlockAnnotation，参数:`, {
                    containerElement,
                    annotation: annotation.id,
                    contentIdentifier,
                    affectedSubBlocks
                });
                window.applyCrossBlockAnnotation(containerElement, annotation, contentIdentifier);
            } else {
                console.error('[跨子块高亮] applyCrossBlockAnnotation 函数未找到');
            }
        });
    }

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
    
    // ====== 新增：公式类型检测（仅当元素本身就是公式容器时才走公式高亮） ======
    // 子块内含有公式时，不在这里整体套用公式高亮；而是交给后续"局部文本包裹 + 公式外层高亮"的组合逻辑处理。
    const isFormulaElement = element.classList && (element.classList.contains('katex') || element.classList.contains('katex-display') || element.classList.contains('katex-inline'));
    
    // 检查是否是跨子块标注的中间子块
    const isCrossBlockAnnotation = annotation.target && 
        annotation.target.selector && 
        annotation.target.selector[0] && 
        annotation.target.selector[0].type === 'CrossBlockRangeSelector';
    
    if (isFormulaElement && !isCrossBlockAnnotation) {
        // 只有非跨子块标注才走公式专用高亮
        const formulaInfo = detectFormulaType(element);
        if (formulaInfo && formulaInfo.hasFormula) {
            return applyFormulaAnnotation(element, annotation, contentIdentifier, elementIdentifier, elementType, formulaInfo);
        }
    }
    
    // ====== 高亮前日志 ======
    //console.log(`[高亮应用] ${elementType}(${elementIdentifier}) 高亮前内容: "${element.textContent}"`);

    // ====== 子块内区间高亮（优先于 exact 文本） ======
    if (elementType === 'subBlock' && annotation.target && annotation.target.selector && annotation.target.selector[0]) {
        const sel0 = annotation.target.selector[0];
        if (sel0.type === 'SubBlockRangeSelector' && (Number.isFinite(sel0.startOffset) || Number.isFinite(sel0.endOffset))) {
            const fullLen = (element.textContent || '').length;
            const s = Math.max(0, Math.min(Number(sel0.startOffset) || 0, fullLen));
            const e = Math.max(0, Math.min(Number(sel0.endOffset) || fullLen, fullLen));
            if (e > s) {
                applyPartialCrossBlockHighlight(element, annotation, getHighlightColor(annotation.highlightColor || 'yellow'),
                    (annotation.body && annotation.body[0] && annotation.body[0].value) ? annotation.body[0].value : '',
                    s, e, 0, 1, false, 'ocr');
                return; // 已完成局部高亮
            }
        }
    }

    // ====== 精确高亮逻辑，仅对 subBlock 生效 ======
    if (elementType === 'subBlock' && annotation.target && annotation.target.selector && annotation.target.selector[0] && annotation.target.selector[0].exact) {
        const exact = annotation.target.selector[0].exact.trim();
        const elementText = extractTextIgnoringFormulas(element).trim();
        
        console.log('[精确高亮-DOM] 目标文本:', exact);
        console.log('[精确高亮-DOM] 元素文本(忽略公式):', elementText);
        
        if (exact && elementText !== exact) {
            // 在逻辑文本中查找匹配位置
            const idx = elementText.indexOf(exact);
            if (idx !== -1) {
                console.log('[精确高亮-DOM] 找到匹配位置:', idx, '长度:', exact.length);
                
                // 尝试新的文本搜索方法
                const range = createRangeByTextSearch(element, exact);
                if (range) {
                    console.log('[精确高亮-DOM] 文本搜索成功创建Range');
                    // 应用结构化高亮，保持DOM结构
                    const highlightElement = applyStructuredHighlight(range, annotation, 'exact-highlight');
                    if (highlightElement) {
                        // 绑定事件
                        bindStandardAnnotationEvents(highlightElement, annotation, elementType, elementIdentifier);
                        console.log('[精确高亮-DOM] 成功应用文本搜索精确高亮');
                        return;
                    } else {
                        console.warn('[精确高亮-DOM] applyStructuredHighlight失败');
                    }
                } else {
                    console.warn('[精确高亮-DOM] 文本搜索创建Range失败');
                }
                
                console.warn('[精确高亮-DOM] 文本搜索方法失败，fallback到字符串方法');
                
                // Fallback：使用原来的字符串方法
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

    // 应用标准高亮样式
    applyStandardHighlight(element, annotation, elementIdentifier, elementType);
}

// ===== DOM树精确分析工具函数 =====

// 检查节点是否在公式内部
function isInsideFormula(node) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (current) {
        if (current.classList && (
            current.classList.contains('katex') || 
            current.classList.contains('katex-display') || 
            current.classList.contains('katex-inline')
        )) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

// 提取元素的纯文本内容（忽略公式）
function extractTextIgnoringFormulas(element) {
    let text = '';
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let node;
    while (node = walker.nextNode()) {
        text += node.textContent;
    }
    return text;
}

// 将逻辑文本偏移映射到实际DOM位置（改进版：处理公式间隙）
function mapLogicalToDOM(element, logicalOffset) {
    let currentOffset = 0;
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_ALL, // 检查所有节点类型
        {
            acceptNode: function(node) {
                // 文本节点：如果不在公式内，接受
                if (node.nodeType === Node.TEXT_NODE) {
                    return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                }
                // 元素节点：如果是公式，跳过；否则继续遍历子节点
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && (
                        node.classList.contains('katex') || 
                        node.classList.contains('katex-display') || 
                        node.classList.contains('katex-inline')
                    )) {
                        return NodeFilter.FILTER_REJECT; // 跳过整个公式子树
                    }
                    return NodeFilter.FILTER_SKIP; // 继续遍历子节点
                }
                return NodeFilter.FILTER_REJECT;
            }
        }
    );
    
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
            const nodeLength = node.textContent.length;
            console.log(`[逻辑映射] 检查文本节点: "${node.textContent}" 长度:${nodeLength} 当前偏移:${currentOffset} 目标:${logicalOffset}`);
            
            if (currentOffset + nodeLength >= logicalOffset) {
                const result = {
                    container: node,
                    offset: logicalOffset - currentOffset
                };
                console.log(`[逻辑映射] 找到目标位置:`, result);
                return result;
            }
            currentOffset += nodeLength;
        }
    }
    
    // 如果超出范围，返回最后一个文本节点的末尾
    console.warn(`[逻辑映射] 逻辑偏移${logicalOffset}超出范围，当前偏移${currentOffset}`);
    
    // 重新遍历找到最后一个文本节点
    const lastWalker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let lastNode = null;
    while (node = lastWalker.nextNode()) {
        lastNode = node;
    }
    
    if (lastNode) {
        return {
            container: lastNode,
            offset: lastNode.textContent.length
        };
    }
    
    return null;
}

// 创建跨越公式的精确Range（新方法：直接在DOM中查找文本）
function createRangeByTextSearch(element, targetText, startOffset = 0) {
    console.log(`[文本搜索Range] 在元素中搜索: "${targetText}" 起始偏移: ${startOffset}`);
    
    // 使用浏览器原生的文本搜索功能
    const tempSelection = window.getSelection();
    const originalRanges = [];
    
    // 保存当前选择
    for (let i = 0; i < tempSelection.rangeCount; i++) {
        originalRanges.push(tempSelection.getRangeAt(i).cloneRange());
    }
    
    tempSelection.removeAllRanges();
    
    try {
        // 创建搜索范围
        const searchRange = document.createRange();
        searchRange.selectNodeContents(element);
        
        // 搜索目标文本
        if (window.find) {
            // 使用window.find进行搜索
            const found = window.find(targetText, false, false, false, false, true, false);
            if (found && tempSelection.rangeCount > 0) {
                const foundRange = tempSelection.getRangeAt(0);
                console.log('[文本搜索Range] 使用window.find找到文本');
                return foundRange.cloneRange();
            }
        }
        
        // Fallback: 手动搜索
        console.log('[文本搜索Range] window.find失败，使用手动搜索');
        return findTextInDOMRange(element, targetText);
        
    } finally {
        // 恢复原始选择
        tempSelection.removeAllRanges();
        originalRanges.forEach(range => tempSelection.addRange(range));
    }
}

// 手动在DOM中搜索文本并返回Range
function findTextInDOMRange(element, targetText) {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let fullText = '';
    const textNodes = [];
    let node;
    
    // 收集所有非公式文本节点
    while (node = walker.nextNode()) {
        textNodes.push({
            node: node,
            startOffset: fullText.length,
            endOffset: fullText.length + node.textContent.length
        });
        fullText += node.textContent;
    }
    
    console.log(`[手动搜索] 完整文本: "${fullText}"`);
    console.log(`[手动搜索] 搜索目标: "${targetText}"`);
    
    // 在完整文本中查找目标
    const textIndex = fullText.indexOf(targetText);
    if (textIndex === -1) {
        console.warn('[手动搜索] 未找到目标文本');
        return null;
    }
    
    const textEndIndex = textIndex + targetText.length;
    console.log(`[手动搜索] 找到文本位置: ${textIndex} - ${textEndIndex}`);
    
    // 找到起始和结束的文本节点
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;
    
    for (const nodeInfo of textNodes) {
        // 找到起始位置
        if (startNode === null && textIndex >= nodeInfo.startOffset && textIndex < nodeInfo.endOffset) {
            startNode = nodeInfo.node;
            startOffset = textIndex - nodeInfo.startOffset;
            console.log(`[手动搜索] 起始节点: "${nodeInfo.node.textContent}" 偏移: ${startOffset}`);
        }
        
        // 找到结束位置
        if (textEndIndex > nodeInfo.startOffset && textEndIndex <= nodeInfo.endOffset) {
            endNode = nodeInfo.node;
            endOffset = textEndIndex - nodeInfo.startOffset;
            console.log(`[手动搜索] 结束节点: "${nodeInfo.node.textContent}" 偏移: ${endOffset}`);
            break;
        }
    }
    
    if (startNode && endNode) {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        console.log('[手动搜索] 成功创建Range');
        return range;
    }
    
    console.warn('[手动搜索] 无法创建Range');
    return null;
}

// 绑定标准标注事件
function bindStandardAnnotationEvents(element, annotation, elementType, elementIdentifier) {
    if (element._annotationEventBound) return;
    
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
            const isHighlighted = window.checkIfTargetIsHighlighted(annotation.id, 'ocr', elementIdentifier, 'subBlockId');
            const hasNoteForClick = window.checkIfTargetHasNote(annotation.id, 'ocr', elementIdentifier, 'subBlockId');
            window.updateContextMenuOptions(isHighlighted, hasNoteForClick);
            window.showContextMenu(e.pageX, e.pageY);
        }
    });
    
    element._annotationEventBound = true;
    console.log('[事件绑定] 成功绑定标注事件到元素:', element);
}

// 应用结构化高亮（保持DOM结构）
function applyStructuredHighlight(range, annotation, className = 'structured-highlight') {
    if (!range || range.collapsed) {
        console.warn('[结构化高亮] Range无效或为空');
        return null;
    }
    
    try {
        // 创建高亮包装器
        const highlightWrapper = document.createElement('span');
        highlightWrapper.className = className + ' annotated-sub-block';
        highlightWrapper.style.backgroundColor = getHighlightColor(annotation.highlightColor || 'yellow');
        highlightWrapper.style.borderRadius = '6px';
        highlightWrapper.style.boxShadow = `0 0 5px ${getHighlightColor(annotation.highlightColor || 'yellow')}`;
        highlightWrapper.style.padding = '0 3px';
        highlightWrapper.dataset.annotationId = annotation.id;
        
        // 添加笔记
        if (annotation.body && annotation.body.length > 0 && annotation.body[0].value) {
            highlightWrapper.title = annotation.body[0].value;
            highlightWrapper.classList.add('has-note');
        }
        
        // 提取并包装内容
        const contents = range.extractContents();
        highlightWrapper.appendChild(contents);
        
        // 插入高亮元素
        range.insertNode(highlightWrapper);
        
        console.log('[结构化高亮] 成功应用高亮:', highlightWrapper);
        return highlightWrapper;
        
    } catch (e) {
        console.error('[结构化高亮] 应用失败:', e);
        return null;
    }
}

// ===== 新增：标准高亮应用函数 =====
function applyStandardHighlight(element, annotation, elementIdentifier, elementType) {
    const originalColor = annotation.highlightColor || 'yellow';
    const color = getHighlightColor(originalColor);
    const note = annotation.body && annotation.body.length > 0 && annotation.body[0].value ? annotation.body[0].value : '';

    // 清除元素上的已有样式
    element.style.backgroundColor = '';
    element.style.border = '';
    element.style.padding = '';
    element.style.borderRadius = '';
    element.style.boxShadow = '';

    const katexDisplayElement = element.classList.contains('katex-display') ? element : element.querySelector('.katex-display');
    const imgElement = element.querySelector('img');
    let effectiveTableToStyle = null;

    if (element.tagName === 'TABLE') {
        effectiveTableToStyle = element;
    } else if (element.parentElement && element.parentElement.tagName === 'TABLE' &&
               element.classList.contains('sub-block') && element.dataset.subBlockId) {
        const parentTable = element.parentElement;
        const subBlockIdPrefix = element.dataset.subBlockId.split('.')[0];
        if (parentTable.dataset.blockIndex === subBlockIdPrefix) {
            effectiveTableToStyle = parentTable;
        } else {
            const tableInsideSpan = element.querySelector('table');
            if (tableInsideSpan) effectiveTableToStyle = tableInsideSpan;
        }
    } else {
        const tableInsideElement = element.querySelector('table');
        if (tableInsideElement) effectiveTableToStyle = tableInsideElement;
    }

    if (katexDisplayElement && !effectiveTableToStyle) {
        katexDisplayElement.style.border = '2px solid ' + color.replace('0.75)', '1)');
        katexDisplayElement.style.borderRadius = '12px';
        katexDisplayElement.style.padding = '8px';
        katexDisplayElement.style.backgroundColor = color;
        katexDisplayElement.style.display = 'block';
        katexDisplayElement.style.width = 'fit-content';
        katexDisplayElement.style.marginLeft = 'auto';
        katexDisplayElement.style.marginRight = 'auto';
        katexDisplayElement.style.boxShadow = `0 0 8px ${color}`;
    } else if (imgElement && !effectiveTableToStyle) {
        element.style.border = '3px solid ' + color.replace('0.75)', '1)');
        element.style.borderRadius = '12px';
        element.style.padding = '8px';
        element.style.backgroundColor = color.replace('0.75)', '0.1)');
        element.style.display = 'inline-block';
        element.style.boxShadow = `0 0 10px ${color}`;
    } else if (effectiveTableToStyle) {
        effectiveTableToStyle.style.border = '2px solid ' + color.replace('0.75)', '1)');
        effectiveTableToStyle.style.borderRadius = '12px';
        effectiveTableToStyle.style.padding = '8px';
        effectiveTableToStyle.style.backgroundColor = color.replace('0.75)', '0.1)');
        effectiveTableToStyle.style.display = 'block';
        effectiveTableToStyle.style.width = 'fit-content';
        effectiveTableToStyle.style.marginLeft = 'auto';
        effectiveTableToStyle.style.marginRight = 'auto';
    } else {
        element.style.backgroundColor = color;
        element.style.borderRadius = '6px';
        element.style.boxShadow = `0 0 5px ${color}`;
        element.style.padding = '0 3px';
    }

    element.classList.add(elementType === 'subBlock' ? 'annotated-sub-block' : 'annotated-block');
    if (note) {
        element.title = note;
        element.classList.add('has-note');
    }
    element.dataset.annotationId = annotation.id;

    // 绑定标准事件
    bindStandardAnnotationEvents(element, annotation, elementType, elementIdentifier);
}

// ===== 新增：标准标注事件绑定函数 =====
function bindStandardAnnotationEvents(element, annotation, elementType, elementIdentifier) {
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
                const parentBlock = this.closest('[data-block-index]');
                if (parentBlock) {
                    window.globalCurrentSelection.blockIndex = parentBlock.dataset.blockIndex;
                }
            } else {
                window.globalCurrentSelection.blockIndex = elementIdentifier;
            }

            const idToCheck = this.dataset.annotationId;
            const identifierForCheck = elementType === 'subBlock' ? window.globalCurrentSelection.subBlockId : window.globalCurrentSelection.blockIndex;
            const typeForCheck = elementType === 'subBlock' ? 'subBlockId' : 'blockIndex';

            if (typeof window.checkIfTargetIsHighlighted === 'function' &&
                typeof window.checkIfTargetHasNote === 'function' &&
                typeof window.updateContextMenuOptions === 'function' &&
                typeof window.showContextMenu === 'function') {

                const isHighlighted = window.checkIfTargetIsHighlighted(idToCheck, window.globalCurrentContentIdentifier, identifierForCheck, typeForCheck);
                const hasNoteForClick = window.checkIfTargetHasNote(idToCheck, window.globalCurrentContentIdentifier, identifierForCheck, typeForCheck);

                window.updateContextMenuOptions(isHighlighted, hasNoteForClick);
                window.showContextMenu(e.pageX, e.pageY);
            } else {
                console.error("[标注高亮] 上下文菜单相关函数未找到");
            }
        });
        element._annotationEventBound = true;
    }
}

// ===== 新增：公式类型检测函数 =====
function detectFormulaType(element) {
    const info = {
        hasFormula: false,
        type: null, // 'block', 'inline', 'mixed'
        elements: []
    };
    
    const katexDisplay = element.querySelector('.katex-display');
    const katexInline = element.querySelector('.katex-inline, .katex:not(.katex-display)');
    const hasKatex = element.classList.contains('katex-display') || element.classList.contains('katex');
    
    if (katexDisplay || hasKatex) {
        info.hasFormula = true;
        info.type = 'block';
        info.elements.push(katexDisplay || element);
    } else if (katexInline) {
        info.hasFormula = true;
        info.type = 'inline';
        info.elements.push(katexInline);
    }
    
    // 检测混合内容（同时有行内和块级公式）
    if (katexDisplay && katexInline) {
        info.type = 'mixed';
        info.elements = [katexDisplay, katexInline];
    }
    
    return info;
}

// ===== 新增：公式标注应用函数 =====
function applyFormulaAnnotation(element, annotation, contentIdentifier, elementIdentifier, elementType, formulaInfo) {
    const color = getHighlightColor(annotation.highlightColor || 'yellow');
    const note = annotation.body && annotation.body.length > 0 && annotation.body[0].value ? annotation.body[0].value : '';
    
    console.log(`[公式高亮] 应用公式标注，类型: ${formulaInfo.type}, 元素: ${elementType}`);
    
    switch (formulaInfo.type) {
        case 'block':
            applyBlockFormulaHighlight(element, annotation, formulaInfo.elements[0], color, note);
            break;
        case 'inline':
            applyInlineFormulaHighlight(element, annotation, formulaInfo.elements[0], color, note);
            break;
        case 'mixed':
            applyMixedFormulaHighlight(element, annotation, formulaInfo.elements, color, note);
            break;
        default:
            // 降级到标准高亮
            applyStandardHighlight(element, annotation, elementIdentifier, elementType);
    }
    
    // 添加公式标注标识
    element.classList.add('annotated-formula', elementType === 'subBlock' ? 'annotated-sub-block' : 'annotated-block');
    element.dataset.annotationId = annotation.id;
    
    if (note) {
        element.title = note;
        element.classList.add('has-note');
    }
    
    // 绑定事件
    bindFormulaAnnotationEvents(element, annotation, contentIdentifier, elementIdentifier, elementType);
}

// ===== 新增：块级公式高亮 =====
function applyBlockFormulaHighlight(element, annotation, formulaElement, color, note) {
    const targetFormula = formulaElement || element;
    
    // 增强的边框和阴影效果
    targetFormula.style.border = `3px solid ${color.replace('0.75)', '1)')}`;  // 更不透明的边框
    targetFormula.style.borderRadius = '12px';
    targetFormula.style.padding = '12px';
    targetFormula.style.margin = '8px 0';
    targetFormula.style.boxShadow = `0 0 12px ${color.replace('0.75)', '0.4)')}, inset 0 0 0 1px ${color.replace('0.75)', '0.2)')}`;  // 内外阴影
    targetFormula.style.backgroundColor = color.replace('0.75)', '0.05)');  // 极淡的背景色
    
    // 添加动画效果
    targetFormula.style.transition = 'all 0.2s ease';
    
    console.log(`[公式高亮] 块级公式高亮已应用，颜色: ${color}`);
}

// ===== 新增：行内公式高亮 =====
function applyInlineFormulaHighlight(element, annotation, formulaElement, color, note) {
    const targetFormula = formulaElement || element;
    
    // 行内公式使用更轻量的样式
    targetFormula.style.border = `2px solid ${color.replace('0.75)', '0.8)')}`;  
    targetFormula.style.borderRadius = '6px';
    targetFormula.style.padding = '2px 6px';
    targetFormula.style.margin = '0 2px';
    targetFormula.style.backgroundColor = color.replace('0.75)', '0.1)');  
    targetFormula.style.boxShadow = `0 0 4px ${color.replace('0.75)', '0.3)')}`;  
    
    console.log(`[公式高亮] 行内公式高亮已应用`);
}

// ===== 新增：混合公式高亮 =====
function applyMixedFormulaHighlight(element, annotation, formulaElements, color, note) {
    // 为包含元素添加整体边框
    element.style.border = `2px dashed ${color.replace('0.75)', '0.6)')}`;  
    element.style.borderRadius = '8px';
    element.style.padding = '8px';
    element.style.backgroundColor = color.replace('0.75)', '0.03)');  
    
    // 为每个公式元素添加独立高亮
    formulaElements.forEach(formula => {
        if (formula.classList.contains('katex-display')) {
            applyBlockFormulaHighlight(null, annotation, formula, color, note);
        } else {
            applyInlineFormulaHighlight(null, annotation, formula, color, note);
        }
    });
    
    console.log(`[公式高亮] 混合公式高亮已应用，包含 ${formulaElements.length} 个公式`);
}

// ===== 新增：公式标注事件绑定 =====
function bindFormulaAnnotationEvents(element, annotation, contentIdentifier, elementIdentifier, elementType) {
    if (!element._annotationEventBound) {
        element.addEventListener('click', function handleFormulaClick(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // 公式选择策略：选择整个包含元素
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
                isFormula: true  // 标识这是公式选择
            };
            
            if (elementType === 'subBlock') {
                window.globalCurrentSelection.subBlockId = elementIdentifier;
                const parentBlock = this.closest('[data-block-index]');
                if (parentBlock) {
                    window.globalCurrentSelection.blockIndex = parentBlock.dataset.blockIndex;
                }
            } else {
                window.globalCurrentSelection.blockIndex = elementIdentifier;
            }
            
            console.log(`[公式高亮] 公式${elementType}点击，全局选区已设置`);
            
            // 调用上下文菜单
            if (typeof window.checkIfTargetIsHighlighted === 'function' &&
                typeof window.checkIfTargetHasNote === 'function' &&
                typeof window.updateContextMenuOptions === 'function' &&
                typeof window.showContextMenu === 'function') {
                
                const idToCheck = this.dataset.annotationId;
                const identifierForCheck = elementType === 'subBlock' ? window.globalCurrentSelection.subBlockId : window.globalCurrentSelection.blockIndex;
                const typeForCheck = elementType === 'subBlock' ? 'subBlockId' : 'blockIndex';
                
                const isHighlighted = window.checkIfTargetIsHighlighted(idToCheck, contentIdentifier, identifierForCheck, typeForCheck);
                const hasNoteForClick = window.checkIfTargetHasNote(idToCheck, contentIdentifier, identifierForCheck, typeForCheck);
                
                window.updateContextMenuOptions(isHighlighted, hasNoteForClick);
                window.showContextMenu(e.pageX, e.pageY);
            }
        });
        
        // 公式悬停效果
        element.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.02)';
            this.style.zIndex = '10';
        });
        
        element.addEventListener('mouseleave', function() {
            this.style.transform = '';
            this.style.zIndex = '';
        });
        
        element._annotationEventBound = true;
    }
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

// ===== 新增：跨子块标注渲染函数 =====
function applyCrossBlockAnnotation(containerElement, annotation, contentIdentifier) {
    if (!annotation.target || !annotation.target.selector || !annotation.target.selector[0]) {
        console.warn('[跨子块高亮] 标注数据结构不完整:', annotation);
        return;
    }

    const selector = annotation.target.selector[0];
    const affectedSubBlocks = selector.affectedSubBlocks || [];

    if (affectedSubBlocks.length === 0) {
        console.warn('[跨子块高亮] 没有找到影响的子块:', annotation);
        return;
    }

    const __DEBUG__ = (function(){
        try { return !!(window && (window.ENABLE_ANNOTATION_DEBUG || localStorage.getItem('ENABLE_ANNOTATION_DEBUG') === 'true')); } catch { return false; }
    })();
    if (__DEBUG__) console.log(`[跨子块高亮] 渲染跨子块标注，影响 ${affectedSubBlocks.length} 个子块:`, affectedSubBlocks);

    const color = getHighlightColor(annotation.highlightColor || 'yellow');
    const note = annotation.body && annotation.body.length > 0 && annotation.body[0].value ? annotation.body[0].value : '';

    let startId = selector.startSubBlockId || affectedSubBlocks[0];
    let endId = selector.endSubBlockId || affectedSubBlocks[affectedSubBlocks.length - 1];
    let hasStartOffset = Number.isFinite(selector.startOffset);
    let hasEndOffset = Number.isFinite(selector.endOffset);
    let startOffset = hasStartOffset ? selector.startOffset : 0;
    let endOffset = hasEndOffset ? selector.endOffset : 0;
    
    // 防御性检查：如果endOffset为0且不是单字符选择，可能有问题
    if (hasEndOffset && endOffset === 0 && startId !== endId) {
        console.warn(`[跨子块高亮] endOffset为0但这是跨子块选择，可能有数据问题`, {
            startId, endId, startOffset, endOffset, affectedSubBlocks
        });
        // 尝试从容器中计算endOffset
        const endBlockIndex = endId.split('.')[0];
        const endElement = containerElement.querySelector(`[data-sub-block-id="${endId}"]`) || 
                          containerElement.querySelector(`[data-block-index="${endBlockIndex}"]`);
        if (endElement) {
            const endText = extractTextIgnoringFormulas(endElement);
            console.log(`[跨子块高亮] 尾元素文本长度: ${endText.length}, 设置endOffset为文本长度`);
            endOffset = endText.length;
            hasEndOffset = true;
        }
    }

    // 可选：使用 exact 精准对齐（若存在）
    if (selector.exact && typeof selector.exact === 'string') {
        const texts = [];
        for (const id of affectedSubBlocks) {
            const el = containerElement.querySelector(`[data-sub-block-id="${id}"]`);
            texts.push(el ? (el.textContent || '') : '');
        }
        const combined = texts.join('');
        const exact = selector.exact;

        // 先尝试直接匹配
        let pos = combined.indexOf(exact);
        let used = 'direct';
        if (pos === -1) {
            // 忽略空白匹配
            const isWs = (ch) => /[\s\u200B-\u200D\uFEFF]/.test(ch);
            const buildNormalized = (s) => {
                const norm = [];
                const map = [];
                for (let i = 0; i < s.length; i++) {
                    const ch = s[i];
                    if (!isWs(ch)) { norm.push(ch); map.push(i); }
                }
                return { norm: norm.join(''), map };
            };
            const comb = buildNormalized(combined);
            const ex = buildNormalized(exact);
            const posNorm = comb.norm.indexOf(ex.norm);
            if (posNorm !== -1) {
                const origStart = comb.map[posNorm];
                const origEndExclusive = comb.map[posNorm + ex.norm.length - 1] + 1;
                pos = origStart;
                used = 'ignore-space';
                // 映射为子块与偏移
                let acc = 0, startBlockIdx = 0, localStart = 0;
                for (let i = 0; i < texts.length; i++) {
                    const L = texts[i].length;
                    if (origStart < acc + L) { startBlockIdx = i; localStart = origStart - acc; break; }
                    acc += L;
                }
                const endGlobal = origEndExclusive;
                acc = 0; let endBlockIdx = texts.length - 1; let localEnd = texts[endBlockIdx].length;
                for (let i = 0; i < texts.length; i++) {
                    const L = texts[i].length;
                    if (endGlobal <= acc + L) { endBlockIdx = i; localEnd = endGlobal - acc; break; }
                    acc += L;
                }
                startId = affectedSubBlocks[startBlockIdx];
                endId = affectedSubBlocks[endBlockIdx];
                startOffset = localStart;
                endOffset = localEnd;
                hasStartOffset = true;
                hasEndOffset = true;
            }
        }
        if (pos !== -1) {
            // 若是直接匹配路径，需要从 pos 反推子块与偏移
            if (used === 'direct') {
                let acc = 0, startBlockIdx = 0, localStart = 0;
                for (let i = 0; i < texts.length; i++) {
                    const L = texts[i].length;
                    if (pos < acc + L) { startBlockIdx = i; localStart = pos - acc; break; }
                    acc += L;
                }
                const endGlobal = pos + exact.length;
                acc = 0; let endBlockIdx = texts.length - 1; let localEnd = texts[endBlockIdx].length;
                for (let i = 0; i < texts.length; i++) {
                    const L = texts[i].length;
                    if (endGlobal <= acc + L) { endBlockIdx = i; localEnd = endGlobal - acc; break; }
                    acc += L;
                }
                startId = affectedSubBlocks[startBlockIdx];
                endId = affectedSubBlocks[endBlockIdx];
                startOffset = localStart;
                endOffset = localEnd;
                hasStartOffset = true;
                hasEndOffset = true;
            }
            if (__DEBUG__) console.log(`[跨子块对齐] 使用 exact(${used === 'direct' ? '直接' : '忽略空白'}) 重算偏移:`, { startId, endId, startOffset, endOffset });
        }
    }

    // 只对[startId..endId]之间的子块应用高亮
    let startIdxInList = affectedSubBlocks.indexOf(startId);
    let endIdxInList = affectedSubBlocks.lastIndexOf(endId);
    
    // 改进：处理 exact 重计算导致的 ID 不匹配问题
    if (startIdxInList === -1 || endIdxInList === -1) {
        console.warn(`[跨子块高亮] startId(${startId})或endId(${endId})不在affectedSubBlocks中，使用全部子块`);
        console.warn('[跨子块高亮] 这通常是exact重计算导致的问题');
        startIdxInList = 0;
        endIdxInList = affectedSubBlocks.length - 1;
    }
    
    const effectiveSubBlocks = affectedSubBlocks.slice(startIdxInList, endIdxInList + 1);
    
    if (__DEBUG__) {
        console.log('[跨子块调试] effectiveSubBlocks计算:', {
            affectedSubBlocks: affectedSubBlocks,
            startId: startId,
            endId: endId,
            startIdxInList: startIdxInList,
            endIdxInList: endIdxInList,
            effectiveCount: effectiveSubBlocks.length,
            effectiveSubBlocks: effectiveSubBlocks
        });
    }

    // 为每个有效子块应用跨子块高亮样式（首尾按偏移做部分高亮）
    let firstSubBlock = null;
    let lastSubBlock = null;
    const createdHighlightElements = [];

    effectiveSubBlocks.forEach((subBlockId, index) => {
        // 查找子块元素；若不存在，尝试块级元素（虚拟子块）
        // 优先匹配真实子块，再回退虚拟子块或块级元素
        let subBlockElement = containerElement.querySelector(`.sub-block[data-sub-block-id="${subBlockId}"]`) ||
                               containerElement.querySelector(`[data-sub-block-id="${subBlockId}"]`);
        if (!subBlockElement) {
            const blockIndex = subBlockId.split('.')[0];
            subBlockElement = containerElement.querySelector(`[data-block-index="${blockIndex}"]`);
            if (__DEBUG__) console.log(`[跨子块高亮] 通过块级元素查找: data-block-index="${blockIndex}"`, subBlockElement);
            
            // 如果还是找不到，尝试查找虚拟子块
            if (!subBlockElement) {
                // 查找具有虚拟子块ID的元素
                subBlockElement = containerElement.querySelector(`[data-sub-block-id*="${blockIndex}."]`);
                if (subBlockElement && __DEBUG__) console.log(`[跨子块高亮] 通过虚拟子块查找找到:`, subBlockElement);
                
                // 最后尝试：查找任何包含该块索引的元素
                if (!subBlockElement) {
                    const allElements = containerElement.querySelectorAll('[data-block-index], [data-sub-block-id]');
                    for (const el of allElements) {
                        const elBlockIndex = el.dataset.blockIndex || el.dataset.subBlockId?.split('.')[0];
                        if (elBlockIndex === blockIndex) {
                            subBlockElement = el;
                            if (__DEBUG__) console.log(`[跨子块高亮] 通过遍历找到匹配元素:`, el);
                            break;
                        }
                    }
                }
            }
        }

        if (!subBlockElement) {
            console.warn(`[跨子块高亮] 找不到子块元素: ${subBlockId}`);
            return;
        }

        if (index === 0) firstSubBlock = subBlockElement;
        if (index === effectiveSubBlocks.length - 1) lastSubBlock = subBlockElement;

        const isRealSubBlock = subBlockElement.classList && subBlockElement.classList.contains('sub-block');
        if (__DEBUG__ && (subBlockId === startId || subBlockId === endId)) {
            const t = subBlockElement.textContent || '';
            if (subBlockId === startId && hasStartOffset) {
                console.log(`[跨子块调试] 首子块(${startId}) 长度=${t.length}, startOffset=${startOffset}, 边界字符='${t[startOffset]||''}'(#${t.charCodeAt(startOffset)||''})`);
            }
            if (subBlockId === endId && hasEndOffset) {
                console.log(`[跨子块调试] 尾子块(${endId}) 长度=${t.length}, endOffset=${endOffset}, 边界字符='${t[endOffset-1]||''}'(#${t.charCodeAt(endOffset-1)||''})`);
            }
        }

        // 单子块跨块场景：仅在同一子块内局部高亮
        if (hasStartOffset && hasEndOffset && startId === endId && subBlockId === startId) {
            const created = applyPartialCrossBlockHighlight(subBlockElement, annotation, color, note, startOffset, endOffset, index, effectiveSubBlocks.length, true, contentIdentifier);
            if (index === 0 && created) created.id = `ann-${annotation.id}`;
            if (created) createdHighlightElements.push(created);
            return;
        }

        // 首子块：从 startOffset 到末尾
        if (hasStartOffset && subBlockId === startId) {
            const fullLen = (subBlockElement.textContent || '').length;
            const safeStart = Math.max(0, Math.min(startOffset, fullLen));
            const created = applyPartialCrossBlockHighlight(subBlockElement, annotation, color, note, safeStart, fullLen, index, effectiveSubBlocks.length, true, contentIdentifier);
            if (index === 0 && created) created.id = `ann-${annotation.id}`;
            if (created) createdHighlightElements.push(created);
            return;
        }

        // 尾子块：从0到 endOffset
        if (hasEndOffset && subBlockId === endId) {
            const fullLen = (subBlockElement.textContent || '').length;
            const safeEnd = Math.max(0, Math.min(endOffset, fullLen));
            const created = applyPartialCrossBlockHighlight(subBlockElement, annotation, color, note, 0, safeEnd, index, effectiveSubBlocks.length, true, contentIdentifier);
            if (index === 0 && created) created.id = `ann-${annotation.id}`;
            if (created) createdHighlightElements.push(created);
            return;
        }

        // 中间子块或虚拟子块：整块高亮
        const created = applyCrossBlockHighlightStyle(subBlockElement, annotation, color, note, index, effectiveSubBlocks.length);
        if (index === 0 && created) created.id = `ann-${annotation.id}`;
        if (created) createdHighlightElements.push(created);
    });

    // 为所有创建的高亮元素绑定事件（任意片段点击都可重新选择整段）
    if (createdHighlightElements.length) {
        createdHighlightElements.forEach(el => bindCrossBlockAnnotationEvents(el, annotation, contentIdentifier, effectiveSubBlocks));
    } else if (firstSubBlock) {
        // 兜底：至少绑定在首子块
        bindCrossBlockAnnotationEvents(firstSubBlock, annotation, contentIdentifier, effectiveSubBlocks);
    }

    // 调试自检：拼接已高亮文本与 exact 比对
    const __DEBUG__CHECK__ = (function(){
        try { return !!(window && (window.ENABLE_ANNOTATION_DEBUG || localStorage.getItem('ENABLE_ANNOTATION_DEBUG') === 'true')); } catch { return false; }
    })();
    if (__DEBUG__CHECK__ && selector.exact) {
        try {
            const spans = [];
            effectiveSubBlocks.forEach(id => {
                const host = containerElement.querySelector(`[data-sub-block-id="${id}"]`) || containerElement.querySelector(`[data-block-index="${String(id).split('.')[0]}"]`);
                if (!host) return;
                // 包含 host 自身（用于整块高亮的中间段）
                if (host.matches && host.matches(`[data-annotation-id="${annotation.id}"]`)) spans.push(host);
                const nodes = host.querySelectorAll(`[data-annotation-id="${annotation.id}"]`);
                nodes.forEach(n => spans.push(n));
            });
            const actual = spans.map(s => s.textContent || '').join('');
            
            // 更宽容的文本比较：提取纯文本内容进行比较
            const extractPureText = (text) => {
                return String(text)
                    .replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ') // 标准化空白
                    .replace(/\s+/g, ' ') // 多个空格合并为一个
                    .trim();
            };
            
            const expectedPure = extractPureText(selector.exact);
            const actualPure = extractPureText(actual);
            
            const ok = expectedPure === actualPure;
            if (!ok) {
                console.warn('[跨子块自检] 高亮结果与 exact 不一致', {
                    annId: annotation.id,
                    startId, endId, startOffset, endOffset,
                    expectedPreview: expectedPure.substring(0, 80),
                    actualPreview: actualPure.substring(0, 80),
                    expectedLength: expectedPure.length,
                    actualLength: actualPure.length,
                    spans: spans.length
                });
            } else {
                console.log('[跨子块自检] 高亮结果与 exact 一致');
            }
        } catch (e) {
            console.warn('[跨子块自检] 检查失败:', e);
        }
    }
}

// 在子块内部应用"部分"跨子块高亮（使用字符偏移切分）
function applyPartialCrossBlockHighlight(element, annotation, color, note, start, end, position, totalCount, isCrossBlock = true, contentIdentifier = null) {
    const text = element.textContent || '';
    const isInFormula = (n) => {
        let p = n && (n.nodeType === Node.TEXT_NODE ? n.parentElement : n);
        while (p) {
            if (p.classList && (
                p.classList.contains('katex') ||
                p.classList.contains('katex-display') ||
                p.classList.contains('katex-inline') ||
                p.classList.contains('reference-citation')  // 保护引用链接
            )) return true;
            p = p.parentElement;
        }
        return false;
    };
    const lenExcludingFormula = (() => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let len = 0, node; while ((node = walker.nextNode())) { if (!isInFormula(node)) len += (node.nodeValue || '').length; }
        return len;
    })();
    let s = Math.max(0, Math.min(start, lenExcludingFormula));
    let e = Math.max(0, Math.min(end, lenExcludingFormula));
    if (e <= s) return;

    // 轻量边界吸附：去除边界处不可见空白，避免看起来“多出一点”
    const isWs = (ch) => /[\s\u00A0\u200B-\u200D\uFEFF]/.test(ch);
    // 注意：s/e 是“忽略公式”的字符坐标，需要在真实文本节点上映射
    if (e <= s) return;

    // 将“忽略公式”的 s/e 映射到真实文本节点位置（跳过公式）
    const mapOffsetToNode = (root, charOffset) => {
        let remaining = charOffset;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            if (isInFormula(node)) continue;
            const l = node.nodeValue ? node.nodeValue.length : 0;
            if (remaining <= l) return { node, offset: remaining };
            remaining -= l;
        }
        return null;
    };
    const startPos = mapOffsetToNode(element, s);
    const endPos = mapOffsetToNode(element, e);
    if (!startPos || !endPos) return;

    // 文本节点内精确包裹（不穿公式）
    const wrapTextRange = (node, from, to) => {
        if (!node || to <= from) return null;
        const full = node.nodeValue || '';
        const before = full.slice(0, from);
        const mid = full.slice(from, to);
        const after = full.slice(to);
        const parent = node.parentNode;
        if (!parent) return null;
        const textBefore = before ? document.createTextNode(before) : null;
        const textAfter = after ? document.createTextNode(after) : null;
        const span = document.createElement('span');
        if (isCrossBlock) {
            span.className = 'cross-block-highlight annotated-sub-block';
            applyCrossBlockHighlightStyle(span, annotation, color, note, position, totalCount);
        } else {
            span.className = 'partial-subblock-highlight annotated-sub-block';
            span.style.backgroundColor = color;
            span.style.borderRadius = '6px';
            span.style.boxShadow = `0 0 5px ${color}`;
            span.style.padding = '0 3px';
            span.dataset.annotationId = annotation.id;
            if (note) { span.title = note; span.classList.add('has-note'); }
            bindStandardAnnotationEvents(span, annotation, 'subBlock', element.dataset && element.dataset.subBlockId ? element.dataset.subBlockId : undefined);
        }
        span.textContent = mid;
        parent.replaceChild(span, node);
        if (textAfter) parent.insertBefore(textAfter, span.nextSibling);
        if (textBefore) parent.insertBefore(textBefore, span);
        return span;
    };

    // 对起止节点进行包裹
    const createdSpans = [];
    if (startPos.node === endPos.node) {
        const created = wrapTextRange(startPos.node, startPos.offset, endPos.offset);
        if (created) createdSpans.push(created);
    } else {
        // 修复：在任何替换发生之前，先收集“忽略公式”的所有文本节点，
        //       并定位起止节点的索引，避免因替换导致遍历起点丢失。
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let n;
        while ((n = walker.nextNode())) {
            if (isInFormula(n)) continue;
            textNodes.push(n);
        }

        const startIndex = textNodes.indexOf(startPos.node);
        const endIndex = textNodes.indexOf(endPos.node);
        if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
            // 兜底：若无法定位，保持旧逻辑（至少高亮首尾）
            const sNode = startPos.node;
            const sLen = (sNode.nodeValue || '').length;
            const firstSpan = wrapTextRange(sNode, startPos.offset, sLen);
            if (firstSpan) createdSpans.push(firstSpan);
            const lastSpan = wrapTextRange(endPos.node, 0, endPos.offset);
            if (lastSpan) createdSpans.push(lastSpan);
        } else {
            // 起点节点：from startOffset 到节点末尾
            const sNode = textNodes[startIndex];
            const sLen = (sNode.nodeValue || '').length;
            const firstSpan = wrapTextRange(sNode, startPos.offset, sLen);
            if (firstSpan) createdSpans.push(firstSpan);

            // 中间文本节点：整段包裹（startIndex+1 ... endIndex-1）
            for (let i = startIndex + 1; i < endIndex; i++) {
                const midNode = textNodes[i];
                const fullLen = (midNode.nodeValue || '').length;
                const midSpan = wrapTextRange(midNode, 0, fullLen);
                if (midSpan) createdSpans.push(midSpan);
            }

            // 终点节点：从 0 到 endOffset
            const eNode = textNodes[endIndex];
            const lastSpan = wrapTextRange(eNode, 0, endPos.offset);
            if (lastSpan) createdSpans.push(lastSpan);
        }
    }

    // 精确的公式范围检测：只高亮真正在选择范围内的公式
    try {
        // 基于DOM位置精确判断公式是否在选择范围内
        const isElementInRange = (targetElement) => {
            if (!createdSpans.length) return false;
            
            // 获取选择范围的边界
            const firstSpan = createdSpans[0];
            const lastSpan = createdSpans[createdSpans.length - 1];
            
            // 使用 compareDocumentPosition 进行精确的DOM位置比较
            const compareResult1 = targetElement.compareDocumentPosition(firstSpan);
            const compareResult2 = targetElement.compareDocumentPosition(lastSpan);
            
            // 检查元素是否在选择范围内
            // DOCUMENT_POSITION_FOLLOWING (4): firstSpan在targetElement之后
            // DOCUMENT_POSITION_PRECEDING (2): lastSpan在targetElement之前
            const afterStart = (compareResult1 & Node.DOCUMENT_POSITION_FOLLOWING) || targetElement === firstSpan || firstSpan.contains(targetElement);
            const beforeEnd = (compareResult2 & Node.DOCUMENT_POSITION_PRECEDING) || targetElement === lastSpan || lastSpan.contains(targetElement);
            
            return afterStart && beforeEnd;
        };
        
        // 找出真正在范围内的公式
        const formulas = element.querySelectorAll('.katex, .katex-display, .katex-inline');
        formulas.forEach(formula => {
            if (isElementInRange(formula)) {
                console.log('[精确公式高亮] 公式在范围内，应用高亮:', formula);
                const formulaType = formula.classList.contains('katex-display') ? 'block' : 'inline';
                applyFormulaAnnotation(formula, annotation, contentIdentifier, element.dataset?.subBlockId, 'subBlock', { 
                    hasFormula: true, 
                    type: formulaType, 
                    elements: [formula] 
                });
            } else {
                console.log('[精确公式高亮] 公式不在范围内，跳过:', formula);
            }
        });
    } catch (e) {
        console.warn('[公式高亮] 精确公式范围检测失败:', e);
    }

    return createdSpans[0] || null;
}

// ===== 新增：跨子块高亮样式应用 =====
function applyCrossBlockHighlightStyle(element, annotation, color, note, position, totalCount) {
    // 基础高亮样式
    element.style.backgroundColor = color;
    // 跨子块高亮不加水平内边距，避免视觉上“吃到”前后字符
    element.style.padding = '0';
    element.classList.add('cross-block-highlight', 'annotated-sub-block');
    element.dataset.annotationId = annotation.id;
    
    if (note) {
        element.title = note;
        element.classList.add('has-note');
    }
    
    // 根据位置应用不同的边框样式，创造连续效果
    if (totalCount === 1) {
        // 单个子块
        element.style.borderRadius = '6px';
        element.style.boxShadow = `0 0 5px ${color}`;
    } else if (position === 0) {
        // 第一个子块
        element.style.borderRadius = '6px 0 0 6px';
        element.style.boxShadow = `0 0 3px ${color}`;
    } else if (position === totalCount - 1) {
        // 最后一个子块
        element.style.borderRadius = '0 6px 6px 0';
        element.style.boxShadow = `0 0 3px ${color}`;
    } else {
        // 中间的子块
        element.style.borderRadius = '0';
        element.style.boxShadow = `0 0 2px ${color}`;
    }
    
    // 添加跨子块标识
    element.style.position = 'relative';
    if (position === 0) {
        // 只在第一个子块添加标识
        const indicator = document.createElement('span');
        indicator.className = 'cross-block-indicator';
        indicator.style.cssText = `
            position: absolute;
            top: -8px;
            left: -4px;
            background: ${color.replace('0.75)', '1)')};
            color: white;
            font-size: 10px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: bold;
            pointer-events: none;
            z-index: 10;
        `;
        indicator.textContent = `跨${totalCount}`;
        element.appendChild(indicator);
    }
    return element;
}

// ===== 新增：跨子块标注事件绑定 =====
function bindCrossBlockAnnotationEvents(element, annotation, contentIdentifier, affectedSubBlocks) {
    if (!element._crossBlockAnnotationEventBound) {
        element.addEventListener('click', function handleCrossBlockClick(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // 创建跨子块选区
            // 优先使用实际创建的高亮片段作为边界
            const allParts = document.querySelectorAll(`[data-annotation-id="${annotation.id}"]\.cross-block-highlight`);
            const firstPart = allParts && allParts.length ? allParts[0] : null;
            const lastPart = allParts && allParts.length ? allParts[allParts.length - 1] : null;
            const firstSubBlock = document.querySelector(`[data-sub-block-id="${affectedSubBlocks[0]}"]`);
            const lastSubBlock = document.querySelector(`[data-sub-block-id="${affectedSubBlocks[affectedSubBlocks.length - 1]}"]`);

            if ((firstPart && lastPart) || (firstSubBlock && lastSubBlock)) {
                const range = document.createRange();
                if (firstPart && lastPart) {
                    range.setStartBefore(firstPart);
                    range.setEndAfter(lastPart);
                } else {
                    range.setStartBefore(firstSubBlock);
                    range.setEndAfter(lastSubBlock);
                }
                
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                
                window.globalCurrentSelection = {
                    text: selection.toString(),
                    range: range.cloneRange(),
                    annotationId: annotation.id,
                    targetElement: this,
                    isCrossBlock: true,
                    affectedSubBlocks: affectedSubBlocks.map(id => ({ subBlockId: id }))
                };
                
                console.log(`[跨子块高亮] 跨子块标注点击，已设置全局选区`);
                
                // 调用上下文菜单
                if (typeof window.updateCrossBlockContextMenuOptions === 'function' &&
                    typeof window.showContextMenu === 'function') {
                    
                    const isHighlighted = true; // 当前已高亮
                    const hasNote = annotation.body && annotation.body.length > 0 && annotation.body[0].value && annotation.body[0].value.trim() !== '';
                    
                    window.updateCrossBlockContextMenuOptions(isHighlighted, hasNote);
                    window.showContextMenu(e.pageX, e.pageY);
                }
            }
        });
        
        element._crossBlockAnnotationEventBound = true;
    }
}

// ===== 新增：滚动到批注位置 =====
function scrollToAnnotation(annotationId, smooth = true) {
    // 优先锚点元素
    let target = document.getElementById(`ann-${annotationId}`);
    if (!target) {
        // 直接 CSS 选择匹配
        try { target = document.querySelector(`[data-annotation-id="${annotationId}"]`); } catch { target = null; }
    }
    if (!target) {
        // 兜底：遍历匹配，避免 selector 因特殊字符失败
        const all = document.querySelectorAll('[data-annotation-id]');
        for (const el of all) {
            if ((el.dataset && el.dataset.annotationId) === String(annotationId)) { target = el; break; }
        }
    }
    if (!target) return false;

    const emphasisTarget = (function(el){
        try {
            const sub = el.closest && el.closest('.sub-block[data-sub-block-id]');
            if (sub) return sub;
            const blk = el.closest && el.closest('[data-block-index]');
            if (blk) return blk;
        } catch { /* ignore */ }
        return el;
    })(target);

    const opts = { behavior: smooth ? 'smooth' : 'auto', block: 'center' };
    try {
        emphasisTarget.scrollIntoView(opts);
        // 统一的临时强调
        const oldOutline = emphasisTarget.style.outline;
        emphasisTarget.classList && emphasisTarget.classList.add('jump-to-highlight-effect');
        emphasisTarget.style.outline = '2px solid rgba(59,130,246,0.8)';
        setTimeout(() => {
            emphasisTarget.style.outline = oldOutline || '';
            emphasisTarget.classList && emphasisTarget.classList.remove('jump-to-highlight-effect');
        }, 1500);
        return true;
    } catch { return false; }
}

// 异步等待目标高亮/元素出现后再跳转，解决延迟渲染/分批分块导致的找不到问题
async function scrollToAnnotationAsync(annotationId, options = {}) {
    const {
        targetType = null,       // 'ocr' | 'translation'
        subBlockId = null,       // 可选：回退匹配用
        blockIndex = null,       // 可选：回退匹配用
        timeoutMs = 4000,        // 默认最多等待 4s
        pollIntervalMs = 120     // 轮询间隔
    } = options;

    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            // 1) 优先按 annotationId 精准定位
            let target = document.getElementById(`ann-${annotationId}`);
            if (!target) {
                try { target = document.querySelector(`[data-annotation-id="${annotationId}"]`); } catch { target = null; }
            }
            if (!target) {
                // 兜底：遍历匹配
                const allEl = document.querySelectorAll('[data-annotation-id]');
                for (const el of allEl) {
                    if ((el.dataset && el.dataset.annotationId) === String(annotationId)) { target = el; break; }
                }
            }
            if (!target) {
                // 2) 回退：在特定内容容器内按 subBlockId/blockIndex 查找
                let scope = document;
                if (targetType) {
                    const cid = `${targetType}-content-wrapper`;
                    scope = document.getElementById(cid) || document;
                }
                if (subBlockId && !target) {
                    target = scope.querySelector(`.sub-block[data-sub-block-id="${subBlockId}"]`);
                }
                if (!target && blockIndex !== null && blockIndex !== undefined && String(blockIndex) !== '') {
                    target = scope.querySelector(`[data-block-index="${blockIndex}"]`);
                }
            }

            if (target) {
                // 将强调目标提升到包含的子块/块，保证滚动锚点与强调元素一致
                const emphasisTarget = (function(el){
                    try {
                        const sub = el.closest && el.closest('.sub-block[data-sub-block-id]');
                        if (sub) return sub;
                        const blk = el.closest && el.closest('[data-block-index]');
                        if (blk) return blk;
                    } catch { /* ignore */ }
                    return el;
                })(target);

                try {
                    emphasisTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // 闪烁/描边提示
                    const oldOutline = emphasisTarget.style.outline;
                    emphasisTarget.classList && emphasisTarget.classList.add('jump-to-highlight-effect');
                    emphasisTarget.style.outline = '2px solid rgba(59,130,246,0.8)';
                    setTimeout(() => {
                        emphasisTarget.style.outline = oldOutline || '';
                        emphasisTarget.classList && emphasisTarget.classList.remove('jump-to-highlight-effect');
                    }, 1500);
                } catch (_) { /* ignore */ }
                return true;
            }
        } catch (e) {
            lastError = e;
        }
        // 等待下一次轮询
        await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (lastError) console.warn('[scrollToAnnotationAsync] 跳转失败（可能超时或DOM未准备好）:', lastError);
    return false;
}

// 暴露跨子块高亮功能
window.applyCrossBlockAnnotation = applyCrossBlockAnnotation;
window.applyCrossBlockHighlightStyle = applyCrossBlockHighlightStyle;
window.bindCrossBlockAnnotationEvents = bindCrossBlockAnnotationEvents;
window.scrollToAnnotation = scrollToAnnotation;
window.scrollToAnnotationAsync = scrollToAnnotationAsync;

// 暴露公式相关功能
window.detectFormulaType = detectFormulaType;
window.applyFormulaAnnotation = applyFormulaAnnotation;
