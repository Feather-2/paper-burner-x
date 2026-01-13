/**
 * @file js/annotations/context-menu.js
 * @description 批注系统上下文菜单
 */

// 模块内部变量，供外部通过 setAnnotationContextMenuElement 设置
let annotationContextMenuElement = null;

/**
 * 设置上下文菜单 DOM 元素
 * @param {HTMLElement} element - 上下文菜单元素
 */
export function setAnnotationContextMenuElement(element) {
    annotationContextMenuElement = element;
}

/**
 * 获取上下文菜单 DOM 元素
 * @returns {HTMLElement|null}
 */
export function getAnnotationContextMenuElement() {
    return annotationContextMenuElement;
}

/**
 * 根据是否已高亮和是否有批注来更新上下文菜单选项的显示
 * @param {boolean} isHighlighted - 是否已高亮
 * @param {boolean} hasNote - 是否已有批注
 * @param {boolean} isReadOnlyMode - 是否为只读模式
 */
export function updateContextMenuOptions(isHighlighted, hasNote = false, isReadOnlyMode = false) {
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

    // 放宽：只要存在非空选区即可高亮，内部会自动映射到子块/跨子块
    let canHighlight = false;
    try {
        const sel = window.getSelection();
        canHighlight = !!(sel && sel.rangeCount && !sel.getRangeAt(0).collapsed);
    } catch { canHighlight = false; }
    if (highlightOption) {
        highlightOption.style.display = canHighlight ? 'block' : 'none';
        try { highlightOption.textContent = '高亮选中内容'; } catch { /* noop */ }
    }

    if (removeHighlightOption) removeHighlightOption.style.display = isHighlighted ? 'block' : 'none';

    if (copyContentOption) {
        const sel = window.getSelection();
        const hasRange = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;
        copyContentOption.style.display = hasRange ? 'block' : 'none';
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
export function showContextMenu(x, y) {
    if (!annotationContextMenuElement) return;
    annotationContextMenuElement.style.left = x + 'px';
    annotationContextMenuElement.style.top = y + 'px';
    annotationContextMenuElement.classList.remove('context-menu-hidden');
    annotationContextMenuElement.classList.add('context-menu-visible');
}

/**
 * 隐藏上下文菜单并重置相关状态
 */
export function hideContextMenu() {
    if (!annotationContextMenuElement) return;
    annotationContextMenuElement.classList.remove('context-menu-visible');
    annotationContextMenuElement.classList.add('context-menu-hidden');

    // 重置由 history_detail.html 管理的全局变量
    window.globalCurrentSelection = null;
    // window.globalCurrentTargetElement = null; // 作用减弱
    window.globalCurrentHighlightStatus = false;
}

/**
 * 更新跨子块上下文菜单选项
 * @param {boolean} isHighlighted - 是否已高亮
 * @param {boolean} hasNote - 是否有批注
 */
export function updateCrossBlockContextMenuOptions(isHighlighted, hasNote) {
    if (!annotationContextMenuElement) return;

    const highlightOption = annotationContextMenuElement.querySelector('[data-action="highlight-block"]');
    const removeHighlightOption = document.getElementById('remove-highlight-option');
    const addNoteOption = document.getElementById('add-note-option');
    const editNoteOption = document.getElementById('edit-note-option');
    const copyContentOption = document.getElementById('copy-content-option');

    // 显示跨块高亮选项，并添加颜色子选项
    if (highlightOption) {
        highlightOption.textContent = '高亮选中区域';
        highlightOption.style.display = isHighlighted ? 'none' : 'block';

        // 为跨子块高亮选项添加颜色子选项
        if (!isHighlighted) {
            // 清除现有的颜色选项
            const existingColorOptions = highlightOption.querySelectorAll('.color-option');
            existingColorOptions.forEach(option => option.remove());

            // 添加颜色选项
            const colorOptions = [
                { color: 'rgba(255, 255, 0, 0.3)', name: '黄色', value: 'yellow' },
                { color: 'rgba(0, 255, 0, 0.3)', name: '绿色', value: 'green' },
                { color: 'rgba(255, 192, 203, 0.3)', name: '粉色', value: 'pink' },
                { color: 'rgba(135, 206, 235, 0.3)', name: '蓝色', value: 'blue' },
                { color: 'rgba(255, 165, 0, 0.3)', name: '橙色', value: 'orange' }
            ];

            const colorContainer = document.createElement('div');
            colorContainer.className = 'color-submenu';
            colorContainer.style.display = 'flex';
            colorContainer.style.gap = '5px';
            colorContainer.style.marginTop = '5px';
            colorContainer.style.padding = '5px';

            colorOptions.forEach(option => {
                const colorDiv = document.createElement('div');
                colorDiv.className = 'color-option';
                colorDiv.dataset.color = option.value;
                colorDiv.title = option.name;
                colorDiv.style.width = '20px';
                colorDiv.style.height = '20px';
                colorDiv.style.backgroundColor = option.color;
                colorDiv.style.border = '1px solid #ccc';
                colorDiv.style.borderRadius = '3px';
                colorDiv.style.cursor = 'pointer';
                colorDiv.style.display = 'inline-block';

                // 添加悬停效果
                colorDiv.addEventListener('mouseenter', function() {
                    colorDiv.style.transform = 'scale(1.1)';
                    colorDiv.style.borderColor = '#333';
                });
                colorDiv.addEventListener('mouseleave', function() {
                    colorDiv.style.transform = 'scale(1)';
                    colorDiv.style.borderColor = '#ccc';
                });

                colorContainer.appendChild(colorDiv);
            });

            highlightOption.appendChild(colorContainer);
        }
    }

    if (removeHighlightOption) {
        removeHighlightOption.textContent = '移除选中区域高亮';
        removeHighlightOption.style.display = isHighlighted ? 'block' : 'none';
    }

    if (copyContentOption) {
        copyContentOption.style.display = 'block';
    }

    // 批注选项
    if (isHighlighted) {
        if (addNoteOption) {
            addNoteOption.textContent = '为选中区域添加批注';
            addNoteOption.style.display = hasNote ? 'none' : 'block';
        }
        if (editNoteOption) {
            editNoteOption.textContent = '编辑选中区域批注';
            editNoteOption.style.display = hasNote ? 'block' : 'none';
        }
    } else {
        if (addNoteOption) addNoteOption.style.display = 'none';
        if (editNoteOption) editNoteOption.style.display = 'none';
    }
}
