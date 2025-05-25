// js/annotation_logic.js

// 假设以下全局变量由 history_detail.html 或 window 提供:
// - window.data (包含批注信息)
// - window.globalCurrentContentIdentifier (字符串, 'ocr' 或 'translation')
// - window.globalCurrentSelection (对象 {text, range, annotationId?, blockIndex?, subBlockId?, targetElement?, contentIdentifierForSelection?})
// - window.globalCurrentTargetElement (DOM 元素) - 将被 globalCurrentSelection.targetElement 取代或辅助
// - window.globalCurrentHighlightStatus (布尔值)
// - getQueryParam (来自 history_detail.html 的函数)
// 以及来自 storage.js 的函数:
// - saveAnnotationToDB, deleteAnnotationFromDB, updateAnnotationInDB, getAnnotationsForDocFromDB

var annotationContextMenuElement; // 右键菜单的HTML元素

// 这些全局变量将在 history_detail.html 的主脚本中初始化和管理。
// 此脚本将使用它们。
// let globalCurrentSelection = null; // 全局当前选区对象
// let globalCurrentTargetElement = null; // 全局当前右键菜单目标元素
// let globalCurrentHighlightStatus = false; // 全局当前高亮状态
// let globalCurrentContentIdentifier = ''; // 全局当前内容标识符 (例如 'ocr', 'translation')，将由 history_detail.html 中的 showTab 函数设置


function _page_generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function escapeRegExp(string) {
  // 更安全地转义所有正则表达式特殊字符
  return string.replace(/[.*+?^${}()|[\\\]\\\\]/g, '\\\\$&');
}

function fuzzyRegFromExact(exact) {
  // 先转义所有正则表达式特殊字符
  let pattern = escapeRegExp(exact);
  // 将所有空白替换为 \\s+，允许跨行、多个空格
  pattern = pattern.replace(/\\\\s+/g, '\\\\s+');
  // 可选：忽略前后空白
  pattern = '\\\\s*' + pattern + '\\\\s*';
  return new RegExp(pattern, 'gi');
}

/**
 * 模糊匹配两个字符串，忽略所有空白和换行
 * @param {string} a 字符串a
 * @param {string} b 字符串b
 * @returns {boolean} 如果匹配则返回true，否则返回false
 */
function fuzzyMatch(a, b) {
    const cleanA = String(a).replace(/\\s+/g, '');
    const cleanB = String(b).replace(/\\s+/g, '');
    return cleanA === cleanB;
}

/**
 * 通用函数：检查指定目标是否已被高亮。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} contentIdentifier - 当前内容的标识符 ('ocr' 或 'translation')。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 * @returns {boolean} 是否已高亮。
 */
function checkIfTargetIsHighlighted(annotationId = null, contentIdentifier, targetIdentifier = null, identifierType) {
    // console.log(`[checkIfTargetIsHighlighted] ID: ${annotationId}, ContentID: ${contentIdentifier}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
    if (!window.data || !window.data.annotations) {
        return false;
    }

    let annotation;
    if (annotationId) {
        // ID 优先匹配
        annotation = window.data.annotations.find(ann =>
            ann.targetType === contentIdentifier && ann.id === annotationId
        );
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找，与removeAnnotationFromTarget保持一致的匹配逻辑
        const targetIdStr = String(targetIdentifier).trim();

        annotation = window.data.annotations.find(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 使用与removeAnnotationFromTarget相同的比较逻辑
            return selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001;
        });
    }

    // console.log('[checkIfTargetIsHighlighted] 找到的批注:', annotation, '结果:', !!annotation);
    return !!annotation;
}

/**
 * 通用函数：检查指定目标是否已有批注内容。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} contentIdentifier - 当前内容的标识符 ('ocr' 或 'translation')。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 * @returns {boolean} 是否已有批注内容。
 */
function checkIfTargetHasNote(annotationId = null, contentIdentifier, targetIdentifier = null, identifierType) {
    // console.log(`[checkIfTargetHasNote] ID: ${annotationId}, ContentID: ${contentIdentifier}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
    if (!window.data || !window.data.annotations) return false;

    let annotation;
    if (annotationId) {
        // ID 优先匹配
        annotation = window.data.annotations.find(ann =>
            ann.targetType === contentIdentifier &&
            ann.id === annotationId &&
            ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== ''
        );
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找，与其他函数保持一致的匹配逻辑
        const targetIdStr = String(targetIdentifier).trim();

        annotation = window.data.annotations.find(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 使用与其他函数相同的比较逻辑
            const idMatch = selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001;

            // 还需要检查是否有批注内容
            return idMatch && ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== '';
        });
    }

    // console.log('[checkIfTargetHasNote] 找到的批注:', annotation, '结果:', !!annotation);
    return !!annotation;
}

/**
 * 根据是否已高亮和是否有批注来更新上下文菜单选项的显示
 * @param {boolean} isHighlighted - 是否已高亮
 * @param {boolean} hasNote - 是否已有批注
 */
function updateContextMenuOptions(isHighlighted, hasNote = false, isReadOnlyMode = false) {
    if (!annotationContextMenuElement) return;

    const highlightOption = annotationContextMenuElement.querySelector('[data-action="highlight-block"]') ||
                            annotationContextMenuElement.querySelector('[data-action="highlight-paragraph"]');
    const removeHighlightOption = document.getElementById('remove-highlight-option');
    const addNoteOption = document.getElementById('add-note-option');
    const editNoteOption = document.getElementById('edit-note-option');
    const copyContentOption = document.getElementById('copy-content-option');
    const highlightActionsDivider = document.getElementById('highlight-actions-divider');
    const noteActionsDivider = document.getElementById('note-actions-divider');

    if (isReadOnlyMode) {
        if (highlightOption) highlightOption.style.display = 'none';
        if (removeHighlightOption) removeHighlightOption.style.display = 'none';
        if (addNoteOption) addNoteOption.style.display = 'none';
        if (editNoteOption) editNoteOption.style.display = 'none';
        if (copyContentOption) copyContentOption.style.display = 'none';
        if (highlightActionsDivider) highlightActionsDivider.style.display = 'none';
        if (noteActionsDivider) noteActionsDivider.style.display = 'none';
        return;
    }

    if (highlightOption) {
        highlightOption.style.display = isHighlighted ? 'none' : 'block';
    }

    if (removeHighlightOption) removeHighlightOption.style.display = isHighlighted ? 'block' : 'none';

    if (copyContentOption) {
        copyContentOption.style.display = window.globalCurrentSelection && (window.globalCurrentSelection.subBlockId || window.globalCurrentSelection.blockIndex) ? 'block' : 'none';
    }

    if (isHighlighted) {
        if (addNoteOption) addNoteOption.style.display = hasNote ? 'none' : 'block';
        if (editNoteOption) editNoteOption.style.display = hasNote ? 'block' : 'none';
    } else {
        if (addNoteOption) addNoteOption.style.display = 'none';
        if (editNoteOption) editNoteOption.style.display = 'none';
    }

    if (highlightActionsDivider) {
        highlightActionsDivider.style.display = isHighlighted ? 'block' : 'none';
    }
    if (noteActionsDivider) {
        const noteOptionsVisible = (addNoteOption && addNoteOption.style.display === 'block') || (editNoteOption && editNoteOption.style.display === 'block');
        noteActionsDivider.style.display = isHighlighted && noteOptionsVisible ? 'block' : 'none';
    }
}

/**
 * 显示上下文菜单
 * @param {number} x - x坐标
 * @param {number} y - y坐标
 */
function showContextMenu(x, y) {
    if (!annotationContextMenuElement) return;
    annotationContextMenuElement.style.left = x + 'px';
    annotationContextMenuElement.style.top = y + 'px';
    annotationContextMenuElement.classList.remove('context-menu-hidden');
    annotationContextMenuElement.classList.add('context-menu-visible');
}

/**
 * 隐藏上下文菜单并重置相关状态
 */
function hideContextMenu() {
    if (!annotationContextMenuElement) return;
    annotationContextMenuElement.classList.remove('context-menu-visible');
    annotationContextMenuElement.classList.add('context-menu-hidden');

    // 重置由 history_detail.html 管理的全局变量
    window.globalCurrentSelection = null;
    // window.globalCurrentTargetElement = null; // 作用减弱
    window.globalCurrentHighlightStatus = false;
}

/**
 * 通用函数：从数据库中移除指定目标的批注。
 * @param {string} docId - 文档ID。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {string} contentIdentifier - 内容标识符。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 */
async function removeAnnotationFromTarget(docId, annotationId = null, targetIdentifier = null, contentIdentifier, identifierType) {
    if (!window.data.annotations) {
        console.warn(`[批注逻辑] removeAnnotationFromTarget: window.data.annotations 未定义。`);
        return;
    }
    if (!annotationId && targetIdentifier === null) {
        console.error(`[批注逻辑] removeAnnotationFromTarget: 需要 annotationId 或 targetIdentifier。`);
        throw new Error('未指定要删除的批注 (无ID或目标标识符)。');
    }

    // 增强日志：记录所有相关参数
    console.log(`[批注逻辑] removeAnnotationFromTarget 参数: docId=${docId}, annotationId=${annotationId}, targetIdentifier=${targetIdentifier}, contentIdentifier=${contentIdentifier}, identifierType=${identifierType}`);

    // 记录当前所有批注的数量和类型
    if (window.data.annotations) {
        console.log(`[批注逻辑] 当前批注总数: ${window.data.annotations.length}`);
        const typeCounts = {};
        window.data.annotations.forEach(ann => {
            const type = ann.targetType || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        });
        console.log(`[批注逻辑] 批注类型统计:`, typeCounts);
    }

    let annotationsToRemove = [];
    if (annotationId) {
        // 通过ID查找批注
        annotationsToRemove = window.data.annotations.filter(ann => ann.id === annotationId && ann.targetType === contentIdentifier);
        console.log(`[批注逻辑] 通过ID查找批注: ${annotationsToRemove.length}个匹配`);
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找批注，增强类型比较
        const targetIdStr = String(targetIdentifier).trim();

        annotationsToRemove = window.data.annotations.filter(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 记录详细的比较信息以便调试
            const isMatch = selectorIdStr === targetIdStr;
            if (selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001) {
                console.log(`[批注逻辑] 找到匹配: ${selectorIdStr} == ${targetIdStr} (${identifierType})`);
                return true;
            }
            return false;
        });

        console.log(`[批注逻辑] 通过${identifierType}查找批注: ${annotationsToRemove.length}个匹配 (目标值: ${targetIdStr})`);

        // 如果没有找到匹配，记录所有可能的值以便调试
        if (annotationsToRemove.length === 0) {
            const allValues = window.data.annotations
                .filter(ann => ann.targetType === contentIdentifier && ann.target && ann.target.selector && ann.target.selector[0])
                .map(ann => {
                    const val = ann.target.selector[0][identifierType];
                    return val !== undefined ? String(val) : 'undefined';
                });
            console.log(`[批注逻辑] 当前所有${identifierType}值:`, allValues);
        }
    }

    if (annotationsToRemove.length === 0) {
        console.warn(`[批注逻辑] removeAnnotationFromTarget: 未找到要删除的批注。 ID: ${annotationId}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
        return;
    }

    console.log(`[批注逻辑] 将删除${annotationsToRemove.length}个批注:`, annotationsToRemove);

    for (const annotation of annotationsToRemove) {
        try {
            await deleteAnnotationFromDB(annotation.id);
            const index = window.data.annotations.findIndex(ann => ann.id === annotation.id);
            if (index > -1) {
                window.data.annotations.splice(index, 1);
                console.log(`[批注逻辑] 成功从内存中删除批注 ID: ${annotation.id}`);
            } else {
                console.warn(`[批注逻辑] 无法从内存中删除批注 ID: ${annotation.id} (未找到索引)`);
            }
        } catch (error) {
            console.error(`[批注逻辑] removeAnnotationFromTarget: 删除批注失败:`, error);
            throw error;
        }
    }
}

/**
 * 通用函数：为现有的已高亮目标添加或更新批注内容。
 * @param {string} noteText - 批注内容。
 * @param {string} docId - 文档ID。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {string} contentIdentifier - 内容标识符。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 */
async function addNoteToAnnotation(noteText, docId, annotationId = null, targetIdentifier = null, contentIdentifier, identifierType) {
    if (!window.data.annotations) {
        throw new Error('没有找到批注数据');
    }
    if (!annotationId && targetIdentifier === null) {
        console.error(`[批注逻辑] addNoteToAnnotation: 需要 annotationId 或 targetIdentifier。`);
        throw new Error('未指定要添加批注的目标 (无ID或目标标识符)。');
    }

    // 增强日志：记录所有相关参数
    console.log(`[批注逻辑] addNoteToAnnotation 参数: docId=${docId}, annotationId=${annotationId}, targetIdentifier=${targetIdentifier}, contentIdentifier=${contentIdentifier}, identifierType=${identifierType}`);

    let existingAnnotation;
    if (annotationId) {
        // 通过ID查找批注
        existingAnnotation = window.data.annotations.find(ann =>
            ann.id === annotationId &&
            ann.targetType === contentIdentifier &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );
        console.log(`[批注逻辑] 通过ID查找批注进行添加/更新批注: ${existingAnnotation ? '找到' : '未找到'}`);
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找批注，使用与其他函数一致的匹配逻辑
        const targetIdStr = String(targetIdentifier).trim();

        existingAnnotation = window.data.annotations.find(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;
            if (!(ann.motivation === 'highlighting' || ann.motivation === 'commenting')) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 使用与其他函数相同的比较逻辑
            return selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001;
        });

        console.log(`[批注逻辑] 通过${identifierType}查找批注进行添加/更新批注: ${existingAnnotation ? '找到' : '未找到'} (目标值: ${targetIdStr})`);
    }

    if (!existingAnnotation) {
        console.warn(`[批注逻辑] addNoteToAnnotation: 未找到对应的高亮批注。 ID: ${annotationId}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
        throw new Error('未找到对应的高亮批注进行批注操作');
    }

    existingAnnotation.body = [{
        type: 'TextualBody',
        value: noteText,
        format: 'text/plain',
        purpose: 'commenting'
    }];
    existingAnnotation.modified = new Date().toISOString();
    existingAnnotation.motivation = 'commenting';

    try {
        await updateAnnotationInDB(existingAnnotation);
        console.log(`[批注逻辑] 成功更新批注 ID: ${existingAnnotation.id}`);
    } catch (error) {
        console.error(`[批注逻辑] addNoteToAnnotation: 更新批注失败:`, error);
        throw error;
    }
}

// 主初始化函数，由 history_detail.html 调用
function initAnnotationSystem() {
    // console.log("[批注系统] 初始化中 (子块/块级模式)...");
    annotationContextMenuElement = document.getElementById('custom-context-menu');
    if (!annotationContextMenuElement) {
        console.error("未找到批注上下文菜单元素 ('custom-context-menu')！");
        return;
    }

    annotationContextMenuElement.addEventListener('click', async (event) => {
        let target = event.target;
        let action, color;

        // Prevent menu from closing itself if a menu item is clicked
        event.stopPropagation();

        if (target.classList.contains('color-option')) {
            const parentLi = target.closest('li[data-action]');
            if (parentLi) {
                 action = parentLi.dataset.action;
                 color = target.dataset.color;
            }
        } else {
            const li = target.closest('li[data-action]');
            if (li) {
                action = li.dataset.action;
            }
        }

        if (!action) {
            hideContextMenu(); // If clicked on non-action area within menu, hide it.
            return;
        }

        // 更新：在分块对比模式下阻止所有指定操作
        if (window.currentVisibleTabId === 'chunk-compare' &&
            action && //确保 action 已定义
            (action === 'highlight-block' || action === 'remove-highlight' || action === 'add-note' || action === 'edit-note' || action === 'copy-content')) { // 添加 copy-content
            console.warn(`[批注逻辑] 在分块对比模式下尝试执行操作 '${action}'。此操作应已被UI阻止。`);
            hideContextMenu();
            return; // 阻止操作
        }

        const docId = getQueryParam('id');
        if (!docId) {
            alert('错误：无法获取文档ID。');
            hideContextMenu();
            return;
        }

        // Retrieve context from the menu's dataset
        const currentContentIdentifier = annotationContextMenuElement.dataset.contextContentIdentifier;
        const targetIdentifier = annotationContextMenuElement.dataset.contextTargetIdentifier;
        const identifierType = annotationContextMenuElement.dataset.contextIdentifierType;
        const targetAnnotationId = annotationContextMenuElement.dataset.contextAnnotationId; // Might be undefined
        const originalSelectedText = annotationContextMenuElement.dataset.contextSelectedText; // For copy

        if (!currentContentIdentifier && (action === 'highlight-block' || action === 'add-note' || action === 'edit-note' || action === 'remove-highlight')) {
            alert('请重新右键点击目标区块后再操作。');
            hideContextMenu();
            return;
        }

        const hasValidContext = targetIdentifier && identifierType;

        if (!hasValidContext && (action === 'highlight-block' || action === 'add-note' || action === 'edit-note' || action === 'remove-highlight' || action === 'copy-content')) {
            alert('操作目标无效。请重新右键点击目标区块。');
            console.error('[批注逻辑] Context menu action failed: targetIdentifier or identifierType from menu dataset is missing.');
            hideContextMenu();
            return;
        }

        let refreshNeeded = false;

        try {
            if (action === 'remove-highlight') {
                // identifierType is already from dataset
                await removeAnnotationFromTarget(docId, targetAnnotationId, targetIdentifier, currentContentIdentifier, identifierType);
                console.log(`${identifierType} 高亮已尝试取消`);
                refreshNeeded = true;
            } else if (action === 'add-note' || action === 'edit-note') {
                // identifierType is from dataset
                const isCurrentlyHighlighted = checkIfTargetIsHighlighted(targetAnnotationId, currentContentIdentifier, targetIdentifier, identifierType);
                if (!isCurrentlyHighlighted) {
                    alert('只能对已高亮的区块/子区块操作批注。请先高亮。');
                } else {
                    let noteText;
                    let currentNoteContent = '';
                    if (action === 'edit-note') {
                        const existingAnnotation = window.data.annotations.find(a =>
                            a.targetType === currentContentIdentifier &&
                            (a.id === targetAnnotationId ||
                             (targetIdentifier && identifierType && a.target && a.target.selector && a.target.selector[0] &&
                              (a.target.selector[0][identifierType] === targetIdentifier || String(a.target.selector[0][identifierType]) === targetIdentifier)
                             )) &&
                             a.body && a.body.length > 0
                        );
                        currentNoteContent = existingAnnotation && existingAnnotation.body[0] ? existingAnnotation.body[0].value : '';
                        noteText = prompt("编辑批注内容：", currentNoteContent);
                    } else { // add-note
                        noteText = prompt("请输入批注内容：", "");
                    }

                    if (noteText === null) { /* User cancelled */ }
                    else if (noteText.trim() === '') {
                        alert('批注内容不能为空。');
                    } else {
                        await addNoteToAnnotation(noteText, docId, targetAnnotationId, targetIdentifier, currentContentIdentifier, identifierType);
                        console.log(action === 'edit-note' ? `${identifierType} 批注已更新` : `批注已添加到现有 ${identifierType} 高亮`);
                        refreshNeeded = true;
                    }
                }
            } else if (action === 'highlight-block') {
                if (!color) {
                    console.warn("高亮操作未选择颜色");
                } else {
                    const existingAnnotationForTarget = window.data.annotations.find(ann =>
                        ann.targetType === currentContentIdentifier &&
                        ann.target && ann.target.selector && ann.target.selector[0] &&
                        (ann.target.selector[0][identifierType] === targetIdentifier || String(ann.target.selector[0][identifierType]) === targetIdentifier) &&
                        (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
                    );

                    if (existingAnnotationForTarget) {
                        existingAnnotationForTarget.highlightColor = color;
                        existingAnnotationForTarget.modified = new Date().toISOString();
                        if (existingAnnotationForTarget.motivation !== 'commenting') {
                           existingAnnotationForTarget.motivation = 'highlighting';
                        }
                        await updateAnnotationInDB(existingAnnotationForTarget);
                        console.log(`${identifierType} 高亮颜色已更新:`, existingAnnotationForTarget);
                    } else {
                        const newAnnotation = {
                            '@context': 'http://www.w3.org/ns/anno.jsonld',
                            id: 'urn:uuid:' + _page_generateUUID(),
                            type: 'Annotation',
                            motivation: 'highlighting',
                            created: new Date().toISOString(),
                            docId: docId,
                            targetType: currentContentIdentifier,
                            highlightColor: color,
                            target: {
                                source: docId,
                                selector: [{
                                    type: identifierType === 'subBlockId' ? 'SubBlockSelector' : 'BlockSelector',
                                }]
                            },
                            body: []
                        };
                        newAnnotation.target.selector[0][identifierType] = targetIdentifier;
                        if (originalSelectedText) { // Use text from dataset if available
                           newAnnotation.target.selector[0].exact = originalSelectedText;
                        }
                        // For blockIndex on subBlock annotations, this info might need to be passed via dataset too if crucial
                        // Or, assume it's less critical if globalCurrentSelection is lost.
                        // For now, we rely on targetIdentifier and identifierType for targeting.
                        // If blockIndex is needed for new sub-block annotations, it must be added to dataset.
                        const contextBlockIndex = annotationContextMenuElement.dataset.contextBlockIndex;
                        if (identifierType === 'subBlockId' && contextBlockIndex) {
                            newAnnotation.target.selector[0].blockIndex = contextBlockIndex;
                        }

                        await saveAnnotationToDB(newAnnotation);
                        if (!window.data.annotations) window.data.annotations = [];
                        window.data.annotations.push(newAnnotation);
                        console.log(`新 ${identifierType} 高亮已保存:`, newAnnotation);
                    }
                    refreshNeeded = true;
                }
            } else if (action === 'copy-content') {
                let textToCopy = originalSelectedText; // Default to textContent
                const contextBlockIndex = annotationContextMenuElement.dataset.contextBlockIndex;
                const isOnlySubBlock = annotationContextMenuElement.dataset.contextIsOnlySubBlock === "true";

                if (identifierType === 'blockIndex' && currentContentIdentifier && targetIdentifier) {
                    const blockIndex = parseInt(targetIdentifier, 10);
                    if (!isNaN(blockIndex) &&
                        window.currentBlockTokensForCopy &&
                        window.currentBlockTokensForCopy[currentContentIdentifier] &&
                        window.currentBlockTokensForCopy[currentContentIdentifier][blockIndex] &&
                        typeof window.currentBlockTokensForCopy[currentContentIdentifier][blockIndex].raw === 'string') {

                        textToCopy = window.currentBlockTokensForCopy[currentContentIdentifier][blockIndex].raw;
                        console.log(`[批注逻辑] 复制块级内容: 使用来自 currentBlockTokensForCopy 的原始 Markdown (块索引: ${blockIndex})。`);
                    } else {
                        console.warn(`[批注逻辑] 复制块级内容: 无法从 currentBlockTokensForCopy 获取原始 Markdown (块索引: ${blockIndex})，回退到 textContent。`);
                    }
                } else if (identifierType === 'subBlockId' && isOnlySubBlock && currentContentIdentifier && contextBlockIndex) {
                    // It's a sub-block, it IS the only sub-block of its parent, and we have the parent's blockIndex
                    const parentBlockIndex = parseInt(contextBlockIndex, 10);
                    if (!isNaN(parentBlockIndex) &&
                        window.currentBlockTokensForCopy &&
                        window.currentBlockTokensForCopy[currentContentIdentifier] &&
                        window.currentBlockTokensForCopy[currentContentIdentifier][parentBlockIndex] &&
                        typeof window.currentBlockTokensForCopy[currentContentIdentifier][parentBlockIndex].raw === 'string') {

                        textToCopy = window.currentBlockTokensForCopy[currentContentIdentifier][parentBlockIndex].raw;
                        console.log(`[批注逻辑] 复制唯一的子块: 使用其父块的原始 Markdown (父块索引: ${parentBlockIndex})。`);
                    } else {
                        console.warn(`[批注逻辑] 复制唯一的子块: 无法从 currentBlockTokensForCopy 获取父块的原始 Markdown (父块索引: ${parentBlockIndex})，回退到子块的 textContent。`);
                        // textToCopy remains originalSelectedText (sub-block's textContent)
                    }
                } else {
                     // This covers:
                     // 1. Sub-blocks that are NOT the only one in their parent.
                     // 2. Any other case not specifically handled above.
                     console.log(`[批注逻辑] 复制子块 (非唯一或无父块信息) 或其他内容: 使用 textContent。`);
                     // textToCopy remains originalSelectedText (textContent)
                }

                if (!textToCopy) { // originalSelectedText could be empty if target has no text
                    alert('没有可选择的内容进行复制。');
                } else {
                    navigator.clipboard.writeText(textToCopy)
                        .then(() => {
                            console.log(`文本已复制 (来源: ${identifierType === 'blockIndex' ? '原始Markdown或textContent' : 'textContent'}): ${String(textToCopy).substring(0,50)}...`);
                            // alert('内容已复制!'); // Optional
                        })
                        .catch(err => {
                            console.error(`复制失败:`, err);
                            alert('复制内容失败。');
                        });
                }
            }
        } catch (error) {
            console.error(`[批注系统] 操作 '${action}' 失败:`, error);
            alert(`操作失败: ${error.message}`);
        } finally {
            hideContextMenu(); // Always hide menu after action or error
            if (refreshNeeded) {
                if (typeof window.showTab === 'function' && window.currentVisibleTabId) {
                    const currentScroll = document.documentElement.scrollTop || document.body.scrollTop;
                    await Promise.resolve(window.showTab(window.currentVisibleTabId));
                    requestAnimationFrame(() => {
                        document.documentElement.scrollTop = document.body.scrollTop = currentScroll;
                        if(typeof window.updateReadingProgress === 'function') window.updateReadingProgress();
                    });
                } else {
                    console.warn("[批注系统] window.showTab 或 window.currentVisibleTabId 不可用，无法自动刷新视图。");
                }
            }
        }
    });

    document.addEventListener('click', (event) => {
        if (annotationContextMenuElement && annotationContextMenuElement.classList.contains('context-menu-visible') &&
            !annotationContextMenuElement.contains(event.target)) {
            if (event.target.classList.contains('color-option')) return;
            hideContextMenu();
        }
    });
    // console.log("[批注系统] 事件监听器已添加 (子块/块级模式)。");
}

// 更新右键菜单处理函数
function addAnnotationListenersToContainer(containerId, specificContentIdentifier) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`[添加批注监听器] 未找到容器 ${containerId}。`);
        return;
    }
    if (!specificContentIdentifier) {
        console.error(`[添加批注监听器] 未为容器 ${containerId} 提供 specificContentIdentifier。`);
        return;
    }

    container.addEventListener('contextmenu', (event) => {
        // 新增：判断是否为只读视图 (分块对比模式)
        const isReadOnlyView = window.currentVisibleTabId === 'chunk-compare';

        if (isReadOnlyView) {
            event.preventDefault(); // 阻止默认的浏览器右键菜单
            hideContextMenu();    // 确保我们的自定义菜单也隐藏
            return;               // 不执行任何菜单显示逻辑
        }

        const targetSubBlock = event.target.closest('.sub-block[data-sub-block-id]');
        const targetBlock = event.target.closest('[data-block-index]');

        let targetElementForAnnotation;
        let identifier, identifierType, blockIndexForContext = null, selectedTextForContext;
        let isOnlySubBlock = false; // New variable

        if (targetSubBlock) {
            targetElementForAnnotation = targetSubBlock;
            identifier = targetSubBlock.dataset.subBlockId;
            identifierType = 'subBlockId';
            if (targetSubBlock.dataset.isOnlySubBlock === "true") { // Check for the new attribute
                isOnlySubBlock = true;
            }
            const parentBlockElement = targetSubBlock.closest('[data-block-index]');
            if (parentBlockElement) {
                blockIndexForContext = parentBlockElement.dataset.blockIndex;
            }
        } else if (targetBlock) {
            targetElementForAnnotation = targetBlock;
            identifier = targetBlock.dataset.blockIndex;
            identifierType = 'blockIndex';
            blockIndexForContext = identifier;
        } else {
            hideContextMenu();
            return;
        }

        event.preventDefault();

        const annotationId = targetElementForAnnotation.dataset.annotationId;
        selectedTextForContext = targetElementForAnnotation.textContent;

        // Still set globalCurrentSelection for immediate use if needed by other minor logic,
        // but primary context for menu actions will come from menu dataset.
        const range = document.createRange();
        range.selectNodeContents(targetElementForAnnotation);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        window.globalCurrentSelection = {
            text: selectedTextForContext,
            range: range.cloneRange(),
            annotationId: annotationId,
            targetElement: targetElementForAnnotation,
            contentIdentifierForSelection: specificContentIdentifier,
            [identifierType]: identifier,
            blockIndex: blockIndexForContext
        };

        // Store context directly on the menu element
        annotationContextMenuElement.dataset.contextContentIdentifier = specificContentIdentifier;
        annotationContextMenuElement.dataset.contextTargetIdentifier = identifier;
        annotationContextMenuElement.dataset.contextIdentifierType = identifierType;
        if (annotationId) {
            annotationContextMenuElement.dataset.contextAnnotationId = annotationId;
        } else {
            delete annotationContextMenuElement.dataset.contextAnnotationId;
        }
        if (selectedTextForContext) {
            annotationContextMenuElement.dataset.contextSelectedText = selectedTextForContext;
        } else {
            delete annotationContextMenuElement.dataset.contextSelectedText;
        }
        if (isOnlySubBlock && identifierType === 'subBlockId') { // Store the flag if it's a sub-block and it's the only one
            annotationContextMenuElement.dataset.contextIsOnlySubBlock = "true";
        } else {
            delete annotationContextMenuElement.dataset.contextIsOnlySubBlock;
        }
        if (blockIndexForContext) { // Store blockIndex for sub-block creation context
            annotationContextMenuElement.dataset.contextBlockIndex = blockIndexForContext;
        }
         else {
            delete annotationContextMenuElement.dataset.contextBlockIndex;
        }

        console.log(`%c[AnnotationLogic ContxtMenu] Event triggered for container: ${container.id}, content type: ${specificContentIdentifier}`, 'color: blue; font-weight: bold;');
        console.log(`  Stored on menu - contentId: ${annotationContextMenuElement.dataset.contextContentIdentifier}, targetId: ${annotationContextMenuElement.dataset.contextTargetIdentifier}, type: ${annotationContextMenuElement.dataset.contextIdentifierType}, annId: ${annotationContextMenuElement.dataset.contextAnnotationId}, blockIdx: ${annotationContextMenuElement.dataset.contextBlockIndex}`);
        console.log(`  Selected text stored on menu: ${(annotationContextMenuElement.dataset.contextSelectedText || '').substring(0,50)}...`);

        const isHighlighted = checkIfTargetIsHighlighted(annotationId, specificContentIdentifier, identifier, identifierType);
        const hasNote = checkIfTargetHasNote(annotationId, specificContentIdentifier, identifier, identifierType);

        console.log(`  checkIfTargetIsHighlighted(...) returned: ${isHighlighted}`);
        console.log(`  checkIfTargetHasNote(...) returned: ${hasNote}`);

        window.globalCurrentHighlightStatus = isHighlighted;
        // 在非只读模式下，isReadOnlyView 应该是 false
        updateContextMenuOptions(isHighlighted, hasNote, false);
        showContextMenu(event.pageX, event.pageY);
    });
}

// 将需要从 history_detail.html 直接调用的函数暴露到全局作用域
window.initAnnotationSystem = initAnnotationSystem;
window.addAnnotationListenersToContainer = addAnnotationListenersToContainer;

// 暴露新的通用函数
window.checkIfTargetIsHighlighted = checkIfTargetIsHighlighted;
window.checkIfTargetHasNote = checkIfTargetHasNote;

// 保留旧函数以保持向后兼容性
window.updateContextMenuOptions = updateContextMenuOptions;
window.showContextMenu = showContextMenu;

window.initializeGlobalAnnotationVariables = function() {
    window.globalCurrentSelection = null;
    // window.globalCurrentTargetElement = null; // 重要性降低
    window.globalCurrentHighlightStatus = false;
    window.globalCurrentContentIdentifier = ''; // 仍然初始化，但应减少直接依赖
};