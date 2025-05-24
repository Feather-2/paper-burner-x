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
    // 新增：如果在分块对比模式下，则不应用任何高亮或注释
    if (window.currentVisibleTabId === 'chunk-compare') {
        // console.log("[BlockHighlighter] 当前为分块对比模式，跳过应用块级/子块级批注。");
        // 清理可能由 custom_markdown_renderer 预添加的 pre-annotated 类或样式（如果需要更彻底的清理）
        // 但主要目的是不应用视觉高亮，所以直接返回即可。
        // 如果 custom_markdown_renderer 已经添加了带有 data-annotation-id 的 span，它们会保留，但不会被赋予高亮样式。
        // 如果需要移除这些 span 或其特定类，可以在这里添加逻辑，但可能不是必需的。
        return;
    }

    if (!containerElement || !allAnnotations) {
        console.log("[BlockHighlighter] 未提供容器元素或批注数据。");
        return;
    }
    // console.log(`[BlockHighlighter] 正在为 ${contentIdentifier} 的容器应用块级/子块级批注:`, containerElement);

    const existingHighlights = containerElement.querySelectorAll('.annotated-block, .annotated-sub-block');
    existingHighlights.forEach(el => {
        // 1. Reset el itself (the annotation target)
        el.style.backgroundColor = '';
        el.style.border = '';
        el.style.padding = '';
        el.style.borderRadius = '';
        el.style.boxShadow = '';
        if (el.classList.contains('katex-display') || el.tagName === 'IMG' || el.tagName === 'TABLE') {
            el.style.display = ''; // Reset display
            el.style.width = '';   // Reset width
            el.style.marginLeft = ''; // Reset margin
            el.style.marginRight = '';// Reset margin
        }

        // 2. Reset known children that might have been styled
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
        const tableChild = el.querySelector('table'); // Table *inside* el
        if (tableChild) {
            tableChild.style.border = ''; tableChild.style.padding = '';
            tableChild.style.display = ''; tableChild.style.width = '';
            tableChild.style.marginLeft = ''; tableChild.style.marginRight = '';
            tableChild.style.borderRadius = ''; tableChild.style.boxShadow = '';
        }

        // 3. Reset parent if 'el' is a span.sub-block inside a table that was styled
        if (el.tagName === 'SPAN' && el.classList.contains('sub-block') &&
            el.parentElement && el.parentElement.tagName === 'TABLE') {
            const subBlockId = el.dataset.subBlockId;
            if (subBlockId) {
                const subBlockIdPrefix = subBlockId.split('.')[0];
                if (el.parentElement.dataset.blockIndex === subBlockIdPrefix) {
                    el.parentElement.style.border = '';
                    el.parentElement.style.padding = '';
                    el.parentElement.style.display = ''; // Reset display for parent table
                    el.parentElement.style.width = '';   // Reset width for parent table
                    el.parentElement.style.marginLeft = ''; // Reset margin for parent table
                    el.parentElement.style.marginRight = '';// Reset margin for parent table
                    el.parentElement.style.borderRadius = '';
                    el.parentElement.style.boxShadow = '';
                }
            }
        }

        el.classList.remove('annotated-block', 'annotated-sub-block', 'has-note');
        el.removeAttribute('title');
        el.removeAttribute('data-annotation-id');
    });

    // 优先处理子块批注
    const subBlockElements = containerElement.querySelectorAll('span.sub-block[data-sub-block-id]');
    // console.log(`[BlockHighlighter] 找到 ${subBlockElements.length} 个子块元素`);

    subBlockElements.forEach((subBlockElement) => {
        const subBlockId = subBlockElement.dataset.subBlockId;
        if (typeof subBlockId === 'undefined') {
            // console.warn(`[BlockHighlighter] 子块元素缺少 'data-sub-block-id' 属性。`, subBlockElement);
            return;
        }

        const annotation = allAnnotations.find(ann =>
            ann.targetType === contentIdentifier &&
            ann.target &&
            Array.isArray(ann.target.selector) &&
            ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlockId && // **优先匹配 subBlockId**
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );

        if (annotation) {
            // console.log(`[BlockHighlighter] 为子块 ${subBlockId} 找到批注:`, annotation);
            applyAnnotationToElement(subBlockElement, annotation, contentIdentifier, subBlockId, 'subBlock');
        }
    });

    // 然后处理块级批注 (如果子块没有覆盖的话)
    // 注意：如果一个块的多个子块被分别批注，那么对整个块的批注可能会显得多余或冲突。
    // 当前逻辑是，如果子块有批注，优先显示子块批注。
    // 也可以考虑，如果一个块的 *所有* 子块都被同一种方式批注，则合并为对整个块的批注视觉效果。这会更复杂。
    const blockElements = containerElement.querySelectorAll('[data-block-index]');
    blockElements.forEach((blockElement) => {
        // 如果这个块的任何子块已经被标注了，就跳过对这个父块的标注，避免样式冲突
        if (blockElement.querySelector('.annotated-sub-block')) {
            // console.log(`[BlockHighlighter] 块 ${blockElement.dataset.blockIndex} 包含已标注的子块，跳过父块标注。`);
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
            !ann.target.selector[0].subBlockId && // **确保不是子块批注**
            (ann.target.selector[0].blockIndex === blockIdentifier || String(ann.target.selector[0].blockIndex) === blockIdentifier) &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );

        if (annotation) {
            // console.log(`[BlockHighlighter] 为块 ${blockIdentifier} 找到批注:`, annotation);
            applyAnnotationToElement(blockElement, annotation, contentIdentifier, blockIdentifier, 'block');
        }
    });

    // console.log("[BlockHighlighter] 块级/子块级批注处理完毕。");
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
        imgElement.style.border = `2px dashed ${color}`;
        imgElement.style.padding = '4px';
        imgElement.style.display = 'block';
        imgElement.style.width = 'fit-content';
        imgElement.style.marginLeft = 'auto';
        imgElement.style.marginRight = 'auto';
        imgElement.style.borderRadius = '12px';
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

    // 通过克隆节点移除所有旧的事件监听器并添加新的
    const newElement = element.cloneNode(true); // true for deep clone
    element.parentNode.replaceChild(newElement, element);

    newElement.addEventListener('click', function handleClick(e) {
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

// 暴露新函数
window.applyBlockAnnotations = applyBlockAnnotations;

// 暂时保留旧的函数别名以便兼容 (尽管其内部逻辑已更新)
window.applyParagraphAnnotations = applyBlockAnnotations;

// 移除原始的applyPreprocessedAnnotations (如果存在)
if (window.applyPreprocessedAnnotations) {
    delete window.applyPreprocessedAnnotations;
}