/**
 * @file js/annotations/cross-block.js
 * @description 跨块批注功能模块
 */

import { _page_generateUUID } from './utils.js';
import { hideContextMenu, showContextMenu, updateCrossBlockContextMenuOptions } from './context-menu.js';

// 模块内部状态 - 引用外部的 annotationContextMenuElement
let annotationContextMenuElement = null;

/**
 * 设置上下文菜单元素引用
 * @param {HTMLElement} element
 */
export function setContextMenuElement(element) {
    annotationContextMenuElement = element;
}

/**
 * 检测跨子块选择
 * @returns {Object} 检测结果
 */
export function detectCrossBlockSelection() {
    const selection = window.getSelection();

    if (!selection.rangeCount) {
        return { isCrossBlock: false };
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
        return { isCrossBlock: false };
    }

    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // 辅助函数：获取元素在父元素中的文本偏移
    const getTextOffsetInElement = (element, parentElement) => {
        let offset = 0;
        const isFormulaNode = (n) => {
            let p = n && (n.nodeType === Node.TEXT_NODE ? n.parentElement : n);
            while (p) {
                if (p.classList && (p.classList.contains('katex') || p.classList.contains('katex-display') || p.classList.contains('katex-inline'))) return true;
                p = p.parentElement;
            }
            return false;
        };
        const walker = document.createTreeWalker(parentElement, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            if (node === element || node.parentElement === element) break;
            if (!isFormulaNode(node)) offset += (node.textContent || '').length;
        }
        return offset;
    };

    // 辅助函数：根据文本偏移找到对应的子块
    const findSubBlockByTextOffset = (blockElement, textOffset) => {
        const subBlocks = blockElement.querySelectorAll('.sub-block[data-sub-block-id]');
        let currentOffset = 0;

        for (const subBlock of subBlocks) {
            const subBlockTextLength = subBlock.textContent.length;
            if (textOffset >= currentOffset && textOffset < currentOffset + subBlockTextLength) {
                return subBlock;
            }
            currentOffset += subBlockTextLength;
        }
        return null;
    };

    // 查找父子块元素
    const findParentSubBlock = (node, debugPrefix = '') => {
        let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        const formulaContainer = element.closest && element.closest('.katex, .katex-display, .katex-inline');
        if (formulaContainer) {
            element = formulaContainer;
        }

        const blockElement = element.closest('[data-block-index]');
        const subBlock = element.closest('.sub-block[data-sub-block-id]');

        if (subBlock) {
            return subBlock;
        }

        if (blockElement) {
            const childSubBlocks = blockElement.querySelectorAll('.sub-block[data-sub-block-id]');

            if (childSubBlocks.length > 0) {
                const textOffset = getTextOffsetInElement(element, blockElement);
                const targetSubBlock = findSubBlockByTextOffset(blockElement, textOffset);
                return targetSubBlock || childSubBlocks[0];
            } else {
                // 尝试自动分段
                if (window.SubBlockSegmenter && typeof window.SubBlockSegmenter.segment === 'function') {
                    try {
                        const preTextOffset = getTextOffsetInElement(element, blockElement);
                        window.SubBlockSegmenter.segment(blockElement, blockElement.dataset.blockIndex, true);
                        const childAfter = blockElement.querySelectorAll('.sub-block[data-sub-block-id]');
                        if (childAfter.length > 0) {
                            if (blockElement._virtualSubBlockId) delete blockElement._virtualSubBlockId;
                            if (blockElement.dataset && blockElement.dataset.subBlockId) delete blockElement.dataset.subBlockId;
                            const targetSubBlock2 = findSubBlockByTextOffset(blockElement, preTextOffset);
                            return targetSubBlock2 || childAfter[0];
                        }
                    } catch (e) {
                        console.warn('[跨子块检测] 单块自动分段失败:', e);
                    }
                }

                // 创建虚拟子块标识
                const proposedId = blockElement.dataset.blockIndex + '.0';
                if (!blockElement.dataset.subBlockId) {
                    blockElement._virtualSubBlockId = proposedId;
                    blockElement.dataset.subBlockId = proposedId;
                }
                return blockElement;
            }
        }

        return null;
    };

    const startSubBlock = findParentSubBlock(startContainer, '开始容器-');
    const endSubBlock = findParentSubBlock(endContainer, '结束容器-');

    if (!startSubBlock || !endSubBlock) {
        return { isCrossBlock: false };
    }

    const startId = startSubBlock.dataset.subBlockId || startSubBlock._virtualSubBlockId;
    const endId = endSubBlock.dataset.subBlockId || endSubBlock._virtualSubBlockId;

    if (startId !== endId) {
        const affectedSubBlocks = getSubBlocksInRange(range, startSubBlock, endSubBlock);
        return {
            isCrossBlock: true,
            startSubBlock: startSubBlock,
            endSubBlock: endSubBlock,
            affectedSubBlocks: affectedSubBlocks,
            selectedText: selection.toString(),
            range: range
        };
    }

    if (startSubBlock !== endSubBlock) {
        const affectedSubBlocks = getSubBlocksInRange(range, startSubBlock, endSubBlock);
        return {
            isCrossBlock: true,
            startSubBlock: startSubBlock,
            endSubBlock: endSubBlock,
            affectedSubBlocks: affectedSubBlocks,
            selectedText: selection.toString(),
            range: range
        };
    }

    return { isCrossBlock: false };
}

/**
 * 获取范围内的所有子块
 * @param {Range} range
 * @param {Element} startSubBlock
 * @param {Element} endSubBlock
 * @returns {Array}
 */
function getSubBlocksInRange(range, startSubBlock, endSubBlock) {
    const subBlocks = [];
    const commonAncestor = range.commonAncestorContainer;
    const container = commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentElement : commonAncestor;

    const startId = startSubBlock.dataset.subBlockId || startSubBlock._virtualSubBlockId;
    const endId = endSubBlock.dataset.subBlockId || endSubBlock._virtualSubBlockId;

    // 添加开始子块
    if (startId) {
        subBlocks.push({
            element: startSubBlock,
            subBlockId: startId,
            text: startSubBlock.textContent || '',
            isFullySelected: false,
            isVirtual: !startSubBlock.classList.contains('sub-block')
        });
    }

    // 添加结束子块
    if (endId && endId !== startId) {
        subBlocks.push({
            element: endSubBlock,
            subBlockId: endId,
            text: endSubBlock.textContent || '',
            isFullySelected: false,
            isVirtual: !endSubBlock.classList.contains('sub-block')
        });
    }

    // 查找中间的子块
    const allSubBlocks = container.querySelectorAll('.sub-block[data-sub-block-id]');

    if (allSubBlocks.length > 0) {
        for (const subBlock of allSubBlocks) {
            const subBlockId = subBlock.dataset.subBlockId;
            if (subBlockId === startId || subBlockId === endId) continue;

            if (range.intersectsNode(subBlock)) {
                subBlocks.push({
                    element: subBlock,
                    subBlockId: subBlockId,
                    text: subBlock.textContent || '',
                    isFullySelected: range.containsNode ? range.containsNode(subBlock) : false
                });
            }
        }
    }

    // 去重并排序
    const uniqueMap = new Map();
    subBlocks.forEach(sb => {
        if (!uniqueMap.has(sb.subBlockId)) uniqueMap.set(sb.subBlockId, sb);
    });
    let uniqueSubBlocks = Array.from(uniqueMap.values());

    uniqueSubBlocks.sort((a, b) => {
        if (a.element === b.element) return 0;
        const pos = a.element.compareDocumentPosition(b.element);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    });

    return uniqueSubBlocks;
}

/**
 * 处理跨子块标注
 * @param {Event} event
 * @param {Object} crossBlockInfo
 */
export async function handleCrossBlockAnnotation(event, crossBlockInfo) {
    event.preventDefault();

    // 判断是否为只读视图
    const isReadOnlyView = window.currentVisibleTabId === 'chunk-compare';
    if (isReadOnlyView) {
        hideContextMenu();
        return;
    }

    const crossBlockAnnotationId = 'cross-' + _page_generateUUID();

    window.globalCurrentSelection = {
        text: crossBlockInfo.selectedText,
        range: crossBlockInfo.range.cloneRange(),
        isCrossBlock: true,
        crossBlockAnnotationId: crossBlockAnnotationId,
        affectedSubBlocks: crossBlockInfo.affectedSubBlocks,
        startSubBlock: crossBlockInfo.startSubBlock,
        endSubBlock: crossBlockInfo.endSubBlock,
        contentIdentifierForSelection: window.globalCurrentContentIdentifier,
        targetElement: crossBlockInfo.startSubBlock
    };

    if (annotationContextMenuElement) {
        annotationContextMenuElement.dataset.contextContentIdentifier = window.globalCurrentContentIdentifier;
        annotationContextMenuElement.dataset.contextIsCrossBlock = "true";
        annotationContextMenuElement.dataset.contextCrossBlockAnnotationId = crossBlockAnnotationId;
        annotationContextMenuElement.dataset.contextSelectedText = crossBlockInfo.selectedText;
        annotationContextMenuElement.dataset.contextAffectedSubBlocks = JSON.stringify(
            crossBlockInfo.affectedSubBlocks.map(sb => sb.subBlockId)
        );
    }

    const isHighlighted = checkCrossBlockHighlight(crossBlockInfo.affectedSubBlocks);
    const hasNote = checkCrossBlockNote(crossBlockInfo.affectedSubBlocks);

    window.globalCurrentHighlightStatus = isHighlighted;
    updateCrossBlockContextMenuOptions(isHighlighted, hasNote);
    showContextMenu(event.clientX, event.clientY);
}

/**
 * 检查跨子块高亮状态
 */
function checkCrossBlockHighlight(affectedSubBlocks) {
    if (!window.data || !window.data.annotations) return false;

    const affectedSubBlockIds = affectedSubBlocks.map(sb => sb.subBlockId);
    const crossBlockAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, window.globalCurrentContentIdentifier);

    if (crossBlockAnnotation) return true;

    for (const subBlock of affectedSubBlocks) {
        const hasHighlight = window.data.annotations.some(ann =>
            ann.targetType === window.globalCurrentContentIdentifier &&
            ann.target && ann.target.selector && ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlock.subBlockId &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );
        if (!hasHighlight) return false;
    }
    return true;
}

/**
 * 检查跨子块批注状态
 */
function checkCrossBlockNote(affectedSubBlocks) {
    if (!window.data || !window.data.annotations) return false;

    const affectedSubBlockIds = affectedSubBlocks.map(sb => sb.subBlockId);
    const crossBlockAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, window.globalCurrentContentIdentifier);

    if (crossBlockAnnotation && crossBlockAnnotation.body && crossBlockAnnotation.body.length > 0 &&
        crossBlockAnnotation.body[0].value && crossBlockAnnotation.body[0].value.trim() !== '') {
        return true;
    }

    for (const subBlock of affectedSubBlocks) {
        const hasNote = window.data.annotations.some(ann =>
            ann.targetType === window.globalCurrentContentIdentifier &&
            ann.target && ann.target.selector && ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlock.subBlockId &&
            ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== ''
        );
        if (hasNote) return true;
    }
    return false;
}

/**
 * 查找跨子块标注
 */
export function findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier) {
    if (!window.data || !window.data.annotations) return null;

    return window.data.annotations.find(ann => {
        if (ann.targetType !== contentIdentifier || !ann.isCrossBlock) return false;
        if (!ann.target || !ann.target.selector || !ann.target.selector[0]) return false;

        const selector = ann.target.selector[0];
        if (!selector.affectedSubBlocks) return false;

        const annotationSubBlocks = selector.affectedSubBlocks.sort();
        const targetSubBlocks = affectedSubBlockIds.sort();

        return JSON.stringify(annotationSubBlocks) === JSON.stringify(targetSubBlocks);
    });
}

/**
 * 创建跨子块标注
 */
export async function createCrossBlockAnnotation(docId, affectedSubBlockIds, contentIdentifier, color, note = '', selectedText = '') {
    const existingAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);

    if (existingAnnotation) {
        existingAnnotation.highlightColor = color;
        existingAnnotation.modified = new Date().toISOString();
        if (note) {
            existingAnnotation.body = [{
                type: 'TextualBody',
                value: note,
                format: 'text/plain',
                purpose: 'commenting'
            }];
            existingAnnotation.motivation = 'commenting';
        }
        await window.updateAnnotationInDB(existingAnnotation);
    } else {
        const rangeInfo = calculateCrossBlockRange(affectedSubBlockIds);

        const newAnnotation = {
            '@context': 'http://www.w3.org/ns/anno.jsonld',
            id: 'urn:uuid:' + _page_generateUUID(),
            type: 'Annotation',
            motivation: note ? 'commenting' : 'highlighting',
            created: new Date().toISOString(),
            docId: docId,
            targetType: contentIdentifier,
            highlightColor: color,
            isCrossBlock: true,
            target: {
                source: docId,
                selector: [{
                    type: 'CrossBlockRangeSelector',
                    startSubBlockId: rangeInfo.startSubBlockId,
                    endSubBlockId: rangeInfo.endSubBlockId,
                    startOffset: rangeInfo.startOffset,
                    endOffset: rangeInfo.endOffset,
                    affectedSubBlocks: affectedSubBlockIds,
                    exact: selectedText || ''
                }]
            },
            body: note ? [{
                type: 'TextualBody',
                value: note,
                format: 'text/plain',
                purpose: 'commenting'
            }] : []
        };

        await window.saveAnnotationToDB(newAnnotation);
        if (!window.data.annotations) window.data.annotations = [];
        window.data.annotations.push(newAnnotation);
    }
}

/**
 * 计算跨子块范围信息
 */
function calculateCrossBlockRange(affectedSubBlockIds) {
    if (!affectedSubBlockIds.length) return null;

    let range = (window.globalCurrentSelection && window.globalCurrentSelection.isCrossBlock && window.globalCurrentSelection.range)
        ? window.globalCurrentSelection.range.cloneRange()
        : null;
    if (!range) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        range = selection.getRangeAt(0);
    }

    let startSubBlock = (window.globalCurrentSelection && window.globalCurrentSelection.startSubBlock) || null;
    let endSubBlock = (window.globalCurrentSelection && window.globalCurrentSelection.endSubBlock) || null;

    const startSubBlockId = startSubBlock ? startSubBlock.dataset.subBlockId : affectedSubBlockIds[0];
    const endSubBlockId = endSubBlock ? endSubBlock.dataset.subBlockId : affectedSubBlockIds[affectedSubBlockIds.length - 1];

    return {
        startSubBlockId: startSubBlockId,
        endSubBlockId: endSubBlockId,
        startOffset: 0,
        endOffset: 0,
        selectedText: (window.globalCurrentSelection && window.globalCurrentSelection.text) || ''
    };
}

/**
 * 移除跨子块标注
 */
export async function removeCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier) {
    const annotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);
    if (annotation) {
        await window.deleteAnnotationFromDB(annotation.id);
        const index = window.data.annotations.findIndex(ann => ann.id === annotation.id);
        if (index > -1) {
            window.data.annotations.splice(index, 1);
        }
    }
}

/**
 * 为跨子块标注添加批注
 */
export async function addNoteToCrossBlockAnnotation(noteText, affectedSubBlockIds, contentIdentifier) {
    const annotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);
    if (annotation) {
        annotation.body = [{
            type: 'TextualBody',
            value: noteText,
            format: 'text/plain',
            purpose: 'commenting'
        }];
        annotation.modified = new Date().toISOString();
        annotation.motivation = 'commenting';

        await window.updateAnnotationInDB(annotation);
    }
}

/**
 * 查找跨子块批注内容
 */
export function findExistingCrossBlockNote(affectedSubBlockIds, contentIdentifier) {
    if (!window.data || !window.data.annotations) return '';

    const crossBlockAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);
    if (crossBlockAnnotation && crossBlockAnnotation.body && crossBlockAnnotation.body.length > 0 &&
        crossBlockAnnotation.body[0].value) {
        return crossBlockAnnotation.body[0].value;
    }

    for (const subBlockId of affectedSubBlockIds) {
        const annotation = window.data.annotations.find(ann =>
            ann.targetType === contentIdentifier &&
            ann.target && ann.target.selector && ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlockId &&
            ann.body && ann.body.length > 0 && ann.body[0].value
        );

        if (annotation) {
            return annotation.body[0].value;
        }
    }

    return '';
}

// 兼容层
if (typeof window !== 'undefined') {
    window.detectCrossBlockSelection = detectCrossBlockSelection;
    window.handleCrossBlockAnnotation = handleCrossBlockAnnotation;
    window.findCrossBlockAnnotation = findCrossBlockAnnotation;
    window.createCrossBlockAnnotation = createCrossBlockAnnotation;
    window.removeCrossBlockAnnotation = removeCrossBlockAnnotation;
    window.addNoteToCrossBlockAnnotation = addNoteToCrossBlockAnnotation;
}
