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

// ========== Phase 2.3: 批注系统 DOM 缓存优化 ==========
/**
 * 批注系统 DOM 缓存类
 * 缓存 sub-block 元素，避免右键时全文档 querySelectorAll
 */
const AnnotationDOMCache = {
    // 缓存的 sub-block 元素数组
    subBlocks: null,

    // 缓存的 sub-block 映射 (subBlockId -> element)
    subBlockMap: null,

    // 缓存是否已初始化
    initialized: false,

    /**
     * 初始化缓存
     * 在内容渲染完成后调用
     */
    init: function() {
        console.time('[AnnotationCache] 初始化 sub-block 缓存');

        // 查询所有 sub-block 元素
        this.subBlocks = Array.from(document.querySelectorAll('.sub-block[data-sub-block-id]'));

        // 创建映射表
        this.subBlockMap = new Map();
        this.subBlocks.forEach(subBlock => {
            const subBlockId = subBlock.dataset.subBlockId;
            if (subBlockId) {
                this.subBlockMap.set(subBlockId, subBlock);
            }
        });

        this.initialized = true;
        console.timeEnd('[AnnotationCache] 初始化 sub-block 缓存');
        console.log(`[AnnotationCache] 已缓存 ${this.subBlocks.length} 个 sub-block 元素`);

        return this;
    },

    /**
     * 获取所有 sub-block 元素（从缓存）
     * 如果缓存未初始化，则动态查询
     */
    getAllSubBlocks: function() {
        if (!this.initialized) {
            console.warn('[AnnotationCache] 缓存未初始化，执行动态查询');
            return document.querySelectorAll('.sub-block[data-sub-block-id]');
        }
        return this.subBlocks;
    },

    /**
     * 根据 subBlockId 获取元素
     */
    getSubBlockById: function(subBlockId) {
        if (!this.initialized) {
            console.warn('[AnnotationCache] 缓存未初始化，执行动态查询');
            return document.querySelector(`.sub-block[data-sub-block-id="${subBlockId}"]`);
        }
        return this.subBlockMap.get(subBlockId) || null;
    },

    /**
     * 清空缓存
     * 在标签切换或内容重新渲染时调用
     */
    clear: function() {
        this.subBlocks = null;
        this.subBlockMap = null;
        this.initialized = false;
        console.log('[AnnotationCache] 缓存已清空');
    },

    /**
     * 重新初始化缓存
     * 在内容更新（如自动分块）后调用
     */
    refresh: function() {
        console.log('[AnnotationCache] 刷新缓存...');
        this.clear();
        return this.init();
    }
};

// 挂载到全局，方便外部调用
window.AnnotationDOMCache = AnnotationDOMCache;

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
        // 新增：批注内容变动后立即刷新目标元素的title/class
        let targetElement = null;
        if (identifierType === 'subBlockId') {
            const containerId = contentIdentifier + '-content-wrapper';
            const container = document.getElementById(containerId);
            if (container) {
                targetElement = container.querySelector('.sub-block[data-sub-block-id="' + (existingAnnotation.target.selector[0].subBlockId || targetIdentifier) + '"]');
            }
        } else if (identifierType === 'blockIndex') {
            const containerId = contentIdentifier + '-content-wrapper';
            const container = document.getElementById(containerId);
            if (container) {
                targetElement = container.querySelector('[data-block-index="' + (existingAnnotation.target.selector[0].blockIndex || targetIdentifier) + '"]');
            }
        }
        if (targetElement && window.highlightBlockOrSubBlock) {
            window.highlightBlockOrSubBlock(targetElement, existingAnnotation, contentIdentifier, targetIdentifier, identifierType === 'subBlockId' ? 'subBlock' : 'block');
        }
    } catch (error) {
        console.error(`[批注逻辑] addNoteToAnnotation: 更新批注失败:`, error);
        throw error;
    }
}

// 主初始化函数，由 history_detail.html 调用
function initAnnotationSystem() {
    annotationContextMenuElement = document.getElementById('custom-context-menu');
    if (!annotationContextMenuElement) {
        console.error("未找到批注上下文菜单元素 ('custom-context-menu')！");
        return;
    }

    // ========== 事件委托：只在 .container 上全局绑定一次 contextmenu ==========
    const mainContainer = document.querySelector('.container');
    if (mainContainer) {
        if (mainContainer._annotationContextMenuBound) return;
        mainContainer._annotationContextMenuBound = true;
        mainContainer.addEventListener('contextmenu', function(event) {
            // 防呆：内容未加载完成时禁止右键
            if (!window.contentReady) {
                alert('请等待内容加载完成后再右键区块。');
                return;
            }
            
            // ===== 防重复触发机制 =====
            if (this._contextMenuProcessing) {
                console.log('[跨子块检测] 事件正在处理中，跳过重复触发');
                return;
            }
            this._contextMenuProcessing = true;
            
            // 延迟重置标志，避免快速重复触发
            setTimeout(() => {
                this._contextMenuProcessing = false;
            }, 100);
            
            // ===== 新增：跨子块选择检测 =====
            console.log('[跨子块检测] 开始检测跨子块选择...');

            // 使用缓存获取所有子块（Phase 2.3 优化）
            let allSubBlocks = window.AnnotationDOMCache.getAllSubBlocks();
            console.log('[跨子块检测] 页面上的子块总数:', allSubBlocks.length);

            if (allSubBlocks.length === 0) {
                console.log('[跨子块检测] ⚠️ 页面上没有找到任何子块！内容可能还没有分割。');
                const blocks = document.querySelectorAll('[data-block-index]');
                console.log('[跨子块检测] [data-block-index]元素数量:', blocks.length);
                if (blocks.length > 0 && window.SubBlockSegmenter && typeof window.SubBlockSegmenter.segment === 'function') {
                    console.log('[跨子块检测] 触发自动分块（英文/中文标点）');
                    blocks.forEach(el => {
                        try { window.SubBlockSegmenter.segment(el, el.dataset.blockIndex, true); }
                        catch (e) { console.warn('[跨子块检测] 自动分块失败:', e); }
                    });
                    // 自动分块后刷新缓存
                    allSubBlocks = window.AnnotationDOMCache.refresh().getAllSubBlocks();
                    console.log('[跨子块检测] 自动分块后 .sub-block数量:', allSubBlocks.length);
                }
            } else {
                console.log('[跨子块检测] 前5个子块ID:', Array.from(allSubBlocks).slice(0, 5).map(sb => sb.dataset.subBlockId));
            }
            
            const crossBlockSelection = detectCrossBlockSelection();
            console.log('[跨子块检测] 检测结果:', crossBlockSelection);
            if (crossBlockSelection.isCrossBlock) {
                console.log('[跨子块检测] 检测到跨子块选择，处理跨子块标注');
                event.preventDefault(); // 阻止默认行为
                return handleCrossBlockAnnotation(event, crossBlockSelection);
            } else {
                console.log('[跨子块检测] 未检测到跨子块选择，继续单子块处理');
            }
            
            // 只处理 .sub-block 或 [data-block-index] 的右键 (仅在非跨子块情况下)
            let targetSubBlock = event.target.closest('.sub-block[data-sub-block-id]');
            let targetBlock = event.target.closest('[data-block-index]');

            // 优先：使用当前选区的起点子块作为目标，避免误选到上一段
            try {
                const sel = window.getSelection();
                if (sel && sel.rangeCount) {
                    const r = sel.getRangeAt(0);
                    if (!r.collapsed) {
                        const startEl = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer;
                        const subFromSelection = startEl && startEl.closest ? startEl.closest('.sub-block[data-sub-block-id]') : null;
                        if (subFromSelection) {
                            targetSubBlock = subFromSelection;
                            targetBlock = subFromSelection.closest('[data-block-index]') || targetBlock;
                        } else if (!targetSubBlock) {
                            // 若选区存在但所在段落尚未分段，则对该段落强制分段并定位子块
                            const blockEl = startEl && startEl.closest ? startEl.closest('[data-block-index]') : null;
                            if (blockEl && window.SubBlockSegmenter && typeof window.SubBlockSegmenter.segment === 'function') {
                                try {
                                    // 计算选区在块内的文本偏移
                                    const getTextOffset = (elementNode, parentBlock) => {
                                        let offset = 0;
                                        const walker = document.createTreeWalker(parentBlock, NodeFilter.SHOW_TEXT, null, false);
                                        let n;
                                        while ((n = walker.nextNode())) {
                                            if (n === elementNode || n.parentElement === elementNode) break;
                                            offset += (n.textContent || '').length;
                                        }
                                        return offset;
                                    };
                                    const preOffset = getTextOffset(r.startContainer, blockEl);
                                    window.SubBlockSegmenter.segment(blockEl, blockEl.dataset.blockIndex, true);
                                    // 在新子块中查找对应的位置
                                    const subBlocks = blockEl.querySelectorAll('.sub-block[data-sub-block-id]');
                                    let acc = 0;
                                    subBlocks.forEach(sb => {
                                        const L = (sb.textContent || '').length;
                                        if (targetSubBlock) return;
                                        if (preOffset >= acc && preOffset < acc + L) targetSubBlock = sb;
                                        acc += L;
                                    });
                                    if (!targetSubBlock) {
                                        // 仍未定位到具体子块：使用块元素本身（虚拟子块）并兼容渲染器
                                        if (!blockEl.dataset.subBlockId) {
                                            blockEl._virtualSubBlockId = blockEl.dataset.blockIndex + '.0';
                                            blockEl.dataset.subBlockId = blockEl._virtualSubBlockId;
                                        }
                                        if (!blockEl.classList.contains('sub-block')) {
                                            blockEl.classList.add('sub-block');
                                        }
                                        targetSubBlock = blockEl;
                                    }
                                    if (!targetBlock) targetBlock = blockEl;
                                } catch (e) { /* ignore */ }
                            }
                        }
                    }
                }
            } catch(e){ /* ignore */ }
            if (!targetSubBlock && !targetBlock) {
                console.log('[单子块检测] 右键目标不是子块或块级元素，忽略');
                return;
            }

            // 新增：判断是否为只读视图 (分块对比模式)
            const isReadOnlyView = window.currentVisibleTabId === 'chunk-compare';
            if (isReadOnlyView) {
                event.preventDefault();
                hideContextMenu();
                return;
            }

            let targetElementForAnnotation;
            let identifier, identifierType, blockIndexForContext = null, selectedTextForContext;
            let isOnlySubBlock = false;

            if (targetSubBlock) {
                targetElementForAnnotation = targetSubBlock;
                identifier = targetSubBlock.dataset.subBlockId;
                identifierType = 'subBlockId';
                if (targetSubBlock.dataset.isOnlySubBlock === "true") {
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

            const annotationId = targetElementForAnnotation.dataset.annotationId;
            // 优先采用当前选区文本
            try {
                const sel = window.getSelection();
                if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
                    selectedTextForContext = sel.toString();
                } else {
                    selectedTextForContext = targetElementForAnnotation.textContent;
                }
            } catch { selectedTextForContext = targetElementForAnnotation.textContent; }

            // 选区设置：仅使用用户当前选区（不再强制整块选中）
            let effectiveRange;
            try {
                const sel = window.getSelection();
                if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) {
                    effectiveRange = sel.getRangeAt(0).cloneRange();
                }
            } catch { /* noop */ }
            window.globalCurrentSelection = {
                text: selectedTextForContext,
                range: effectiveRange,
                annotationId: annotationId,
                targetElement: targetElementForAnnotation,
                contentIdentifierForSelection: window.globalCurrentContentIdentifier,
                [identifierType]: identifier,
                blockIndex: blockIndexForContext
            };

            // Store context directly on the menu element
            annotationContextMenuElement.dataset.contextContentIdentifier = window.globalCurrentContentIdentifier;
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
            if (isOnlySubBlock && identifierType === 'subBlockId') {
                annotationContextMenuElement.dataset.contextIsOnlySubBlock = "true";
            } else {
                delete annotationContextMenuElement.dataset.contextIsOnlySubBlock;
            }
            if (blockIndexForContext) {
                annotationContextMenuElement.dataset.contextBlockIndex = blockIndexForContext;
            } else {
                delete annotationContextMenuElement.dataset.contextBlockIndex;
            }

            // 🔧 BUG FIX: 清除跨子块相关属性，避免单子块操作时误用旧的跨子块数据
            delete annotationContextMenuElement.dataset.contextIsCrossBlock;
            delete annotationContextMenuElement.dataset.contextCrossBlockAnnotationId;
            delete annotationContextMenuElement.dataset.contextAffectedSubBlocks;

            console.log(`%c[AnnotationLogic ContxtMenu] Event triggered for container: ${mainContainer.id}, content type: ${window.globalCurrentContentIdentifier}`, 'color: blue; font-weight: bold;');
            console.log(`  Stored on menu - contentId: ${annotationContextMenuElement.dataset.contextContentIdentifier}, targetId: ${annotationContextMenuElement.dataset.contextTargetIdentifier}, type: ${annotationContextMenuElement.dataset.contextIdentifierType}, annId: ${annotationContextMenuElement.dataset.contextAnnotationId}, blockIdx: ${annotationContextMenuElement.dataset.contextBlockIndex}`);
            console.log(`  Selected text stored on menu: ${(annotationContextMenuElement.dataset.contextSelectedText || '').substring(0,50)}...`);

            const isHighlighted = checkIfTargetIsHighlighted(annotationId, window.globalCurrentContentIdentifier, identifier, identifierType);
            const hasNote = checkIfTargetHasNote(annotationId, window.globalCurrentContentIdentifier, identifier, identifierType);

            console.log(`  checkIfTargetIsHighlighted(...) returned: ${isHighlighted}`);
            console.log(`  checkIfTargetHasNote(...) returned: ${hasNote}`);

            window.globalCurrentHighlightStatus = isHighlighted;
            // 仅在可高亮（跨子块或子块内存在非空选区）或点击已有高亮时显示菜单
            let canHighlight = false;
            try {
                const sel = window.getSelection();
                canHighlight = !!(sel && sel.rangeCount && !sel.getRangeAt(0).collapsed && targetSubBlock);
            } catch { canHighlight = false; }
            const clickedHighlighted = !!annotationId;
            if (!canHighlight && !clickedHighlighted) {
                hideContextMenu();
                return; // 允许默认浏览器菜单
            }

            updateContextMenuOptions(isHighlighted, hasNote, false);
            event.preventDefault(); // 仅在显示自定义菜单时阻止默认菜单
            showContextMenu(event.pageX, event.pageY);
        }, false);
    }
    // ...其余初始化逻辑...
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

        // ===== 新增：跨子块操作检测 =====
        const isCrossBlockOperation = annotationContextMenuElement.dataset.contextIsCrossBlock === "true";
        if (isCrossBlockOperation) {
            return handleCrossBlockMenuAction(action, color, event);
        }
        
        const docId = getQueryParam('id');
        if (!docId) {
            alert('错误：无法获取文档ID。');
            hideContextMenu();
            return;
        }

        // Retrieve context from the menu's dataset
        let currentContentIdentifier = annotationContextMenuElement.dataset.contextContentIdentifier
            || (window.globalCurrentSelection && window.globalCurrentSelection.contentIdentifierForSelection)
            || window.globalCurrentContentIdentifier; // 兜底
        let targetIdentifier = annotationContextMenuElement.dataset.contextTargetIdentifier || (window.globalCurrentSelection && (window.globalCurrentSelection.subBlockId || window.globalCurrentSelection.blockIndex));
        let identifierType = annotationContextMenuElement.dataset.contextIdentifierType || (window.globalCurrentSelection && (window.globalCurrentSelection.subBlockId ? 'subBlockId' : 'blockIndex'));
        let targetAnnotationId = annotationContextMenuElement.dataset.contextAnnotationId || (window.globalCurrentSelection && window.globalCurrentSelection.annotationId);
        let originalSelectedText = annotationContextMenuElement.dataset.contextSelectedText || (window.globalCurrentSelection && window.globalCurrentSelection.text);

        if ((!(currentContentIdentifier && identifierType && targetIdentifier)) &&
            (action === 'highlight-block' || action === 'add-note' || action === 'edit-note' || action === 'remove-highlight')) {
            console.log('context debug', {currentContentIdentifier, targetIdentifier, identifierType, targetAnnotationId, windowGlobal: window.globalCurrentSelection, windowGlobalContent: window.globalCurrentContentIdentifier});
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
                // 新增：只移除目标元素的高亮
                let targetElement = null;
                if (identifierType === 'subBlockId') {
                    const containerId = currentContentIdentifier + '-content-wrapper';
                    const container = document.getElementById(containerId);
                    if (container) {
                        targetElement = container.querySelector('.sub-block[data-sub-block-id="' + targetIdentifier + '"]');
                    }
                } else if (identifierType === 'blockIndex') {
                    const containerId = currentContentIdentifier + '-content-wrapper';
                    const container = document.getElementById(containerId);
                    if (container) {
                        targetElement = container.querySelector('[data-block-index="' + targetIdentifier + '"]');
                    }
                }
                if (targetElement && window.removeHighlightFromBlockOrSubBlock) {
                    window.removeHighlightFromBlockOrSubBlock(targetElement);
                }
                // 新增：局部刷新所有高亮，保证同步
                if (typeof window.applyBlockAnnotations === 'function') {
                    const containerId = currentContentIdentifier + '-content-wrapper';
                    const container = document.getElementById(containerId);
                    if (container) {
                        window.applyBlockAnnotations(container, window.data.annotations, currentContentIdentifier);
                    }
                }
                console.log(`${identifierType} 高亮已尝试取消`);
                refreshNeeded = false; // 不再全量刷新
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
                        // 新增：同步 exact 字段
                        let annotationToUpdate = window.data.annotations.find(a =>
                            a.targetType === currentContentIdentifier &&
                            (a.id === targetAnnotationId ||
                             (targetIdentifier && identifierType && a.target && a.target.selector && a.target.selector[0] &&
                              (a.target.selector[0][identifierType] === targetIdentifier || String(a.target.selector[0][identifierType]) === targetIdentifier)
                             ))
                        );
                        if (annotationToUpdate && window.globalCurrentSelection && window.globalCurrentSelection.targetElement) {
                            annotationToUpdate.target.selector[0].exact = window.globalCurrentSelection.targetElement.textContent.trim();
                        }
                        await addNoteToAnnotation(noteText, docId, targetAnnotationId, targetIdentifier, currentContentIdentifier, identifierType);
                        console.log(action === 'edit-note' ? `${identifierType} 批注已更新` : `批注已添加到现有 ${identifierType} 高亮`);
                        refreshNeeded = true;
                    }
                }
            } else if (action === 'highlight-block') {
                // 可选：禁止整块高亮（通过本地开关）
                try {
                    const disableBlock = localStorage.getItem('DISABLE_BLOCK_HIGHLIGHT') === 'true';
                    if (disableBlock && identifierType === 'blockIndex') {
                        alert('已禁用整块高亮，请在子块内选中要高亮的文本。');
                        hideContextMenu();
                        return;
                    }
                } catch { /* noop */ }

                // 优先按当前选区的起点子块来高亮，避免“跳到上面一段”
                try {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount) {
                        const r = sel.getRangeAt(0);
                        if (!r.collapsed) {
                            const startEl = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer;
                            const subFromSelection = startEl && startEl.closest ? startEl.closest('.sub-block[data-sub-block-id]') : null;
                            if (subFromSelection) {
                                identifierType = 'subBlockId';
                                identifier = subFromSelection.dataset.subBlockId;
                                targetIdentifier = identifier;
                                targetElementForAnnotation = subFromSelection;
                            }
                        }
                    }
                } catch { /* ignore */ }
                // 允许未选颜色，默认黄色
                if (!color) { color = 'yellow'; }
                {
                    // 预判是否为子块内片段选择
                    let isSubBlockRange = false;
                    try {
                        isSubBlockRange = (identifierType === 'subBlockId' && window.globalCurrentSelection && window.globalCurrentSelection.range && window.globalCurrentSelection.targetElement);
                    } catch { isSubBlockRange = false; }
                    // ====== 修正：高亮保存前去重，保证唯一性 ======
                    // 先查找所有同 target 的 annotation
                    const duplicateAnnotations = window.data.annotations.filter(ann =>
                        ann.targetType === currentContentIdentifier &&
                        ann.target && ann.target.selector && ann.target.selector[0] &&
                        (ann.target.selector[0][identifierType] === targetIdentifier || String(ann.target.selector[0][identifierType]) === targetIdentifier) &&
                        (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
                    );
                    // 子块内片段：允许同一子块多段并存，不做去重/合并
                    let existingAnnotationForTarget = isSubBlockRange ? null : duplicateAnnotations[0];
                    if (!isSubBlockRange) {
                        // 如果有多个，移除多余的，只保留第一个（仅限非片段场景）
                        if (duplicateAnnotations.length > 1) {
                            for (let i = 1; i < duplicateAnnotations.length; i++) {
                                await removeAnnotationFromTarget(docId, duplicateAnnotations[i].id, targetIdentifier, currentContentIdentifier, identifierType);
                            }
                        }
                    }
                    if (existingAnnotationForTarget) {
                        existingAnnotationForTarget.highlightColor = color;
                        existingAnnotationForTarget.modified = new Date().toISOString();
                        if (existingAnnotationForTarget.motivation !== 'commenting') {
                           existingAnnotationForTarget.motivation = 'highlighting';
                        }
                        // 如果是单子块并且存在选区，则转换/更新为区间选择
                        if (identifierType === 'subBlockId' && window.globalCurrentSelection && window.globalCurrentSelection.range && window.globalCurrentSelection.targetElement) {
                            try {
                                const el = window.globalCurrentSelection.targetElement;
                                const selRange = window.globalCurrentSelection.range;
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
                                const fragTextLenExclFormula = (frag) => {
                                    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT, null, false);
                                    let len = 0, node;
                                    while ((node = walker.nextNode())) { if (!isInFormula(node)) len += (node.nodeValue || '').length; }
                                    return len;
                                };
                                const calcOffset = (endNode, endOffset) => {
                                    const r = document.createRange();
                                    r.selectNodeContents(el);
                                    r.setEnd(endNode, endOffset);
                                    return fragTextLenExclFormula(r.cloneContents());
                                };
                                const sOff = calcOffset(selRange.startContainer, selRange.startOffset);
                                const eOff = calcOffset(selRange.endContainer, selRange.endOffset);
                                const startOffset = Math.max(0, Math.min(sOff, eOff));
                                const endOffset = Math.max(0, Math.max(sOff, eOff));
                                const exactSel = (window.globalCurrentSelection.text || '').trim();
                                if (!existingAnnotationForTarget.target.selector[0] || existingAnnotationForTarget.target.selector[0].type !== 'SubBlockRangeSelector') {
                                    existingAnnotationForTarget.target.selector[0] = { type: 'SubBlockRangeSelector', subBlockId: targetIdentifier };
                                }
                                existingAnnotationForTarget.target.selector[0].startOffset = startOffset;
                                existingAnnotationForTarget.target.selector[0].endOffset = endOffset;
                                if (exactSel) existingAnnotationForTarget.target.selector[0].exact = exactSel;
                            } catch (e) { /* ignore and fallback */ }
                        } else if (window.globalCurrentSelection && window.globalCurrentSelection.targetElement) {
                            // 同步 exact 字段（整块高亮）
                            existingAnnotationForTarget.target.selector[0].exact = window.globalCurrentSelection.targetElement.textContent.trim();
                        }
                        await updateAnnotationInDB(existingAnnotationForTarget);
                        // 新增：只高亮目标元素
                        let targetElement = null;
                        if (identifierType === 'subBlockId') {
                            const containerId = currentContentIdentifier + '-content-wrapper';
                            const container = document.getElementById(containerId);
                            if (container) {
                                targetElement = container.querySelector('.sub-block[data-sub-block-id="' + targetIdentifier + '"]');
                            }
                        } else if (identifierType === 'blockIndex') {
                            const containerId = currentContentIdentifier + '-content-wrapper';
                            const container = document.getElementById(containerId);
                            if (container) {
                                targetElement = container.querySelector('[data-block-index="' + targetIdentifier + '"]');
                            }
                        }
                        if (targetElement && window.highlightBlockOrSubBlock) {
                            window.highlightBlockOrSubBlock(targetElement, existingAnnotationForTarget, currentContentIdentifier, targetIdentifier, identifierType === 'subBlockId' ? 'subBlock' : 'block');
                        }
                        console.log(`${identifierType} 高亮颜色已更新:`, existingAnnotationForTarget);
                        refreshNeeded = true;
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
                        // 单子块 + 存在选区：改为区间选择
                        if (identifierType === 'subBlockId' && window.globalCurrentSelection && window.globalCurrentSelection.range && window.globalCurrentSelection.targetElement) {
                            try {
                                const el = window.globalCurrentSelection.targetElement;
                                const selRange = window.globalCurrentSelection.range;
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
                                const fragTextLenExclFormula = (frag) => {
                                    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT, null, false);
                                    let len = 0, node;
                                    while ((node = walker.nextNode())) { if (!isInFormula(node)) len += (node.nodeValue || '').length; }
                                    return len;
                                };
                                const calcOffset = (endNode, endOffset) => {
                                    const r = document.createRange();
                                    r.selectNodeContents(el);
                                    r.setEnd(endNode, endOffset);
                                    return fragTextLenExclFormula(r.cloneContents());
                                };
                                const sOff = calcOffset(selRange.startContainer, selRange.startOffset);
                                const eOff = calcOffset(selRange.endContainer, selRange.endOffset);
                                const startOffset = Math.max(0, Math.min(sOff, eOff));
                                const endOffset = Math.max(0, Math.max(sOff, eOff));
                                const exactSel = (window.globalCurrentSelection.text || '').trim();
                                newAnnotation.target.selector[0] = {
                                    type: 'SubBlockRangeSelector',
                                    subBlockId: targetIdentifier,
                                    startOffset: startOffset,
                                    endOffset: endOffset,
                                    exact: exactSel
                                };
                            } catch (e) {
                                // 回退整块
                                if (window.globalCurrentSelection && window.globalCurrentSelection.targetElement) {
                                    newAnnotation.target.selector[0].exact = window.globalCurrentSelection.targetElement.textContent.trim();
                                } else if (originalSelectedText) {
                                    newAnnotation.target.selector[0].exact = originalSelectedText;
                                }
                            }
                        } else {
                            // 新建时写入 exact（整块）
                            if (window.globalCurrentSelection && window.globalCurrentSelection.targetElement) {
                                newAnnotation.target.selector[0].exact = window.globalCurrentSelection.targetElement.textContent.trim();
                            } else if (originalSelectedText) {
                                newAnnotation.target.selector[0].exact = originalSelectedText;
                            }
                        }
                        const contextBlockIndex = annotationContextMenuElement.dataset.contextBlockIndex;
                        if (identifierType === 'subBlockId' && contextBlockIndex) {
                            newAnnotation.target.selector[0].blockIndex = contextBlockIndex;
                        }
                        await saveAnnotationToDB(newAnnotation);
                        if (!window.data.annotations) window.data.annotations = [];
                        window.data.annotations.push(newAnnotation);
                        // 新增：只高亮目标元素
                        let targetElement = null;
                        if (identifierType === 'subBlockId') {
                            const containerId = currentContentIdentifier + '-content-wrapper';
                            const container = document.getElementById(containerId);
                            if (container) {
                                targetElement = container.querySelector('.sub-block[data-sub-block-id="' + targetIdentifier + '"]');
                            }
                        } else if (identifierType === 'blockIndex') {
                            const containerId = currentContentIdentifier + '-content-wrapper';
                            const container = document.getElementById(containerId);
                            if (container) {
                                targetElement = container.querySelector('[data-block-index="' + targetIdentifier + '"]');
                            }
                        }
                        if (targetElement && window.highlightBlockOrSubBlock) {
                            window.highlightBlockOrSubBlock(targetElement, newAnnotation, currentContentIdentifier, targetIdentifier, identifierType === 'subBlockId' ? 'subBlock' : 'block');
                        }
                        refreshNeeded = true;
                        console.log(`新 ${identifierType} 高亮已保存:`, newAnnotation);
                    }
                    refreshNeeded = false; // 不再全量刷新
                }
            } else if (action === 'copy-content') {
                let textToCopy = originalSelectedText; // Default to textContent
                const contextBlockIndex = annotationContextMenuElement.dataset.contextBlockIndex;
                // 唯一子块判断逻辑修正
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
                } else if (identifierType === 'subBlockId' && currentContentIdentifier && contextBlockIndex) {
                    // 统计 annotation 里所有属于该父块的唯一子块
                    const parentBlockIndex = parseInt(contextBlockIndex, 10);
                    const allSubBlockIds = window.data.annotations
                        .map(a => a.target && a.target.selector && a.target.selector[0] && a.target.selector[0].subBlockId)
                        .filter(id => id && id.startsWith(`${parentBlockIndex}.`));
                    const uniqueSubBlockIds = Array.from(new Set(allSubBlockIds));
                    if (uniqueSubBlockIds.length === 1 &&
                        window.currentBlockTokensForCopy &&
                        window.currentBlockTokensForCopy[currentContentIdentifier] &&
                        window.currentBlockTokensForCopy[currentContentIdentifier][parentBlockIndex] &&
                        typeof window.currentBlockTokensForCopy[currentContentIdentifier][parentBlockIndex].raw === 'string') {
                        textToCopy = window.currentBlockTokensForCopy[currentContentIdentifier][parentBlockIndex].raw;
                        console.log(`[批注逻辑] 复制唯一的子块: 使用其父块的原始 Markdown (父块索引: ${parentBlockIndex})。`);
                    } else {
                        // 不是唯一子块，或无法获取父块内容，回退到子块的 textContent
                        console.log(`[批注逻辑] 复制子块 (非唯一或无父块信息) 或其他内容: 使用 textContent。`);
                        // textToCopy remains originalSelectedText (sub-block's textContent)
                    }
                } else {
                    // 其它情况
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
                // ========== 优化：只局部刷新高亮和批注事件 ==========
                // 只在 OCR/translation tab 下局部刷新，不再全量 showTab
                const tab = window.currentVisibleTabId;
                let containerId = null;
                let contentIdentifier = null;
                if (tab === 'ocr') {
                    containerId = 'ocr-content-wrapper';
                    contentIdentifier = 'ocr';
                } else if (tab === 'translation') {
                    containerId = 'translation-content-wrapper';
                    contentIdentifier = 'translation';
                }
                if (containerId && typeof window.applyBlockAnnotations === 'function') {
                    const container = document.getElementById(containerId);
                    if (container) {
                        window.applyBlockAnnotations(container, window.data.annotations, contentIdentifier);
                    }
                }
                if (containerId && typeof window.addAnnotationListenersToContainer === 'function') {
                    window.addAnnotationListenersToContainer(containerId, contentIdentifier);
                }
                // Dock/TOC统计也可局部刷新（可选）
                if (window.DockLogic && typeof window.DockLogic.updateStats === 'function') {
                    window.DockLogic.updateStats(window.data, window.currentVisibleTabId);
                }
                if (typeof window.refreshTocList === 'function') {
                    window.refreshTocList();
                }
                if(typeof window.updateReadingProgress === 'function') window.updateReadingProgress();
                // =====================================================
                // 只有在内容结构变化时才需要全量 showTab
                // if (typeof window.showTab === 'function' && window.currentVisibleTabId) {
                //     const currentScroll = document.documentElement.scrollTop || document.body.scrollTop;
                //     await Promise.resolve(window.showTab(window.currentVisibleTabId));
                //     requestAnimationFrame(() => {
                //         document.documentElement.scrollTop = document.body.scrollTop = currentScroll;
                //         if(typeof window.updateReadingProgress === 'function') window.updateReadingProgress();
                //     });
                // } else {
                //     console.warn("[批注系统] window.showTab 或 window.currentVisibleTabId 不可用，无法自动刷新视图。");
                // }
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
    // 额外：滚动/窗口变化/Esc 时隐藏菜单，避免“菜单残留”
    try {
        document.addEventListener('scroll', hideContextMenu, true);
        window.addEventListener('resize', hideContextMenu);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); }, true);
    } catch { /* noop */ }
    // console.log("[批注系统] 事件监听器已添加 (子块/块级模式)。");
}

// ===== 新增：跨子块选择检测函数 =====
function detectCrossBlockSelection() {
    const selection = window.getSelection();
    console.log('[跨子块检测] 当前选区:', selection);
    console.log('[跨子块检测] 选区范围数:', selection.rangeCount);
    
    if (!selection.rangeCount) {
        console.log('[跨子块检测] 没有选区范围');
        return { isCrossBlock: false };
    }
    
    const range = selection.getRangeAt(0);
    console.log('[跨子块检测] 选区范围:', range);
    console.log('[跨子块检测] 选区是否折叠:', range.collapsed);
    console.log('[跨子块检测] 选中文本:', selection.toString());
    
    if (range.collapsed) {
        console.log('[跨子块检测] 选区已折叠，不是有效选择');
        return { isCrossBlock: false };
    }
    
    // 检测选择范围是否跨越多个子块
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    console.log('[跨子块检测] 开始容器:', startContainer);
    console.log('[跨子块检测] 结束容器:', endContainer);
    
    // 辅助函数：获取元素在父元素中的文本偏移（忽略公式内部文本）
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
    
    // 改进：更准确地找到包含的子块或块级元素
    const findParentSubBlock = (node, debugPrefix = '') => {
        // 如果是文本节点，从父元素开始查找
        let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        // 若起点在公式内部，先提升到公式容器，以保证后续最近子块判定稳定
        const formulaContainer = element.closest && element.closest('.katex, .katex-display, .katex-inline');
        if (formulaContainer) {
            element = formulaContainer;
        }
        
        // 查找所属的块级元素，用于调试
        const blockElement = element.closest('[data-block-index]');
        console.log(`[跨子块检测] ${debugPrefix}查找子块，起始元素:`, element);
        console.log(`[跨子块检测] ${debugPrefix}元素标签:`, element.tagName);
        console.log(`[跨子块检测] ${debugPrefix}所属段落:`, blockElement?.dataset?.blockIndex || '未找到');

        // 首先查找最近的子块
        const subBlock = element.closest('.sub-block[data-sub-block-id]');
        console.log(`[跨子块检测] ${debugPrefix}找到的子块:`, subBlock?.dataset?.subBlockId || 'null');
        
        if (subBlock) {
            return subBlock;
        }
        
        // 如果没找到子块，查找块级元素
        console.log(`[跨子块检测] ${debugPrefix}找到的块级元素:`, blockElement);
        
        if (blockElement) {
            // 检查这个块是否已经被分段成子块
            const childSubBlocks = blockElement.querySelectorAll('.sub-block[data-sub-block-id]');
            console.log('[跨子块检测] 块级元素的子块数量:', childSubBlocks.length);
            
            if (childSubBlocks.length > 0) {
                // 如果有子块，需要确定具体是哪个子块
                // 根据selection的位置来判断
                const textOffset = getTextOffsetInElement(element, blockElement);
                const targetSubBlock = findSubBlockByTextOffset(blockElement, textOffset);
                console.log('[跨子块检测] 根据文本偏移找到的子块:', targetSubBlock);
                return targetSubBlock || childSubBlocks[0]; // 如果找不到就返回第一个
            } else {
                // 如果没有子块，优先尝试自动分段（支持英文）
                if (window.SubBlockSegmenter && typeof window.SubBlockSegmenter.segment === 'function') {
                    try {
                        console.log('[跨子块检测] 块级元素未分段，触发针对该块的自动分段 (force=true)');
                        // 在分段之前先计算选区在该块内的文本偏移
                        const preTextOffset = getTextOffsetInElement(element, blockElement);
                        window.SubBlockSegmenter.segment(blockElement, blockElement.dataset.blockIndex, true);
                        const childAfter = blockElement.querySelectorAll('.sub-block[data-sub-block-id]');
                        console.log('[跨子块检测] 自动分段后子块数量:', childAfter.length);
                        if (childAfter.length > 0) {
                            // 移除之前可能打在块上的虚拟 subBlockId，避免与真实子块冲突
                            if (blockElement._virtualSubBlockId) delete blockElement._virtualSubBlockId;
                            if (blockElement.dataset && blockElement.dataset.subBlockId) delete blockElement.dataset.subBlockId;
                            // 使用分段前计算的偏移，映射到具体子块
                            const targetSubBlock2 = findSubBlockByTextOffset(blockElement, preTextOffset);
                            console.log('[跨子块检测] 自动分段后根据偏移找到的子块:', targetSubBlock2);
                            return targetSubBlock2 || childAfter[0];
                        }
                    } catch (e) {
                        console.warn('[跨子块检测] 单块自动分段失败:', e);
                    }
                }
                // 仍无子块，创建虚拟子块标识
                console.log(`[跨子块检测] ${debugPrefix}块级元素未分段，创建虚拟子块标识`);
                
                // 改进：确保虚拟子块ID的唯一性
                const proposedId = blockElement.dataset.blockIndex + '.0';
                
                // 检查是否已经被标记过（避免重复标记）
                if (!blockElement.dataset.subBlockId) {
                    blockElement._virtualSubBlockId = proposedId;
                    blockElement.dataset.subBlockId = proposedId;
                    console.log(`[跨子块检测] ${debugPrefix}创建虚拟子块ID: ${proposedId}`);
                } else {
                    console.log(`[跨子块检测] ${debugPrefix}块级元素已有子块ID: ${blockElement.dataset.subBlockId}`);
                }
                return blockElement;
            }
        }
        
        // 调试：查看父元素层次
        let parent = element;
        let level = 0;
        while (parent && level < 5) {
            console.log(`[跨子块检测] 父元素层次${level}:`, parent.tagName, parent.className, parent.dataset);
            parent = parent.parentElement;
            level++;
        }
        
        return null;
    };
    
    const startSubBlock = findParentSubBlock(startContainer, '开始容器-');
    const endSubBlock = findParentSubBlock(endContainer, '结束容器-');
    
    console.log('[跨子块检测] 开始子块:', startSubBlock);
    console.log('[跨子块检测] 结束子块:', endSubBlock);
    console.log('[跨子块检测] 开始子块ID:', startSubBlock?.dataset?.subBlockId);
    console.log('[跨子块检测] 结束子块ID:', endSubBlock?.dataset?.subBlockId);
    
    if (!startSubBlock || !endSubBlock) {
        console.log('[跨子块检测] 找不到开始或结束子块');
        return { isCrossBlock: false };
    }
    
    // 比较子块标识符而不是DOM元素
    const startId = startSubBlock.dataset.subBlockId || startSubBlock._virtualSubBlockId;
    const endId = endSubBlock.dataset.subBlockId || endSubBlock._virtualSubBlockId;
    
    console.log('[跨子块检测] 开始子块ID:', startId);
    console.log('[跨子块检测] 结束子块ID:', endId);
    
    // 改进：更严格的跨子块判断逻辑
    if (startId !== endId) {
        // 跨子块选择
        console.log('[跨子块检测] ✅ 检测到跨子块选择！');
        const affectedSubBlocks = getSubBlocksInRange(range, startSubBlock, endSubBlock);
        console.log('[跨子块检测] 影响的子块:', affectedSubBlocks);
        return {
            isCrossBlock: true,
            startSubBlock: startSubBlock,
            endSubBlock: endSubBlock,
            affectedSubBlocks: affectedSubBlocks,
            selectedText: selection.toString(),
            range: range
        };
    }
    
    // 额外检查：即使子块ID相同，也要检查是否真的是同一个DOM元素
    if (startSubBlock !== endSubBlock) {
        console.log('[跨子块检测] ✅ 检测到跨DOM元素选择（子块ID相同但DOM不同）！');
        console.log('[跨子块检测] 开始DOM:', startSubBlock);
        console.log('[跨子块检测] 结束DOM:', endSubBlock);
        
        // 这种情况说明有问题，但仍然按跨子块处理
        const affectedSubBlocks = getSubBlocksInRange(range, startSubBlock, endSubBlock);
        console.log('[跨子块检测] 影响的子块:', affectedSubBlocks);
        return {
            isCrossBlock: true,
            startSubBlock: startSubBlock,
            endSubBlock: endSubBlock,
            affectedSubBlocks: affectedSubBlocks,
            selectedText: selection.toString(),
            range: range
        };
    }
    
    console.log('[跨子块检测] 选择在同一个子块内');
    return { isCrossBlock: false };
}

// ===== 新增：获取范围内的所有子块 =====
function getSubBlocksInRange(range, startSubBlock, endSubBlock) {
    const subBlocks = [];
    const commonAncestor = range.commonAncestorContainer;
    const container = commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentElement : commonAncestor;
    
    console.log('[获取范围内子块] 公共祖先容器:', container);
    console.log('[获取范围内子块] 开始子块:', startSubBlock);
    console.log('[获取范围内子块] 结束子块:', endSubBlock);
    
    // 获取开始和结束子块的ID
    const startId = startSubBlock.dataset.subBlockId || startSubBlock._virtualSubBlockId;
    const endId = endSubBlock.dataset.subBlockId || endSubBlock._virtualSubBlockId;
    
    console.log('[获取范围内子块] 开始子块ID:', startId);
    console.log('[获取范围内子块] 结束子块ID:', endId);
    
    // 首先确保包含开始和结束子块
    if (startId) {
        subBlocks.push({
            element: startSubBlock,
            subBlockId: startId,
            text: startSubBlock.textContent || '',
            isFullySelected: false,
            isVirtual: !startSubBlock.classList.contains('sub-block')
        });
        console.log('[获取范围内子块] 添加开始子块:', startId);
    }
    
    if (endId && endId !== startId) {
        subBlocks.push({
            element: endSubBlock,
            subBlockId: endId,
            text: endSubBlock.textContent || '',
            isFullySelected: false,
            isVirtual: !endSubBlock.classList.contains('sub-block')
        });
        console.log('[获取范围内子块] 添加结束子块:', endId);
    }
    
    // 查找中间的子块（优先真实子块，否则按块级虚拟子块）
    const allSubBlocks = container.querySelectorAll('.sub-block[data-sub-block-id]');
    console.log('[获取范围内子块] 找到的真实子块数量:', allSubBlocks.length);

    if (allSubBlocks.length > 0) {
        // 使用更准确的范围检测：先添加所有真实子块
        for (const subBlock of allSubBlocks) {
            const subBlockId = subBlock.dataset.subBlockId;

            // 跳过已经添加的开始和结束子块
            if (subBlockId === startId || subBlockId === endId) {
                continue;
            }

            // 检查子块是否在选择范围内
            if (range.intersectsNode(subBlock)) {
                subBlocks.push({
                    element: subBlock,
                    subBlockId: subBlockId,
                    text: subBlock.textContent || '',
                    isFullySelected: range.containsNode ? range.containsNode(subBlock) : false
                });
                console.log('[获取范围内子块] 添加中间子块(真实):', subBlockId);
            }
        }

        // 同时补充：对范围内“没有真实子块”的段落，创建虚拟子块，避免中间段落遗漏
        const top = container.closest && (container.closest('#ocr-content-wrapper, #translation-content-wrapper') || container.closest('[data-block-index]')?.parentElement) || document;
        const allBlocksInside = top.querySelectorAll('[data-block-index]');
        const startBlockEl = startSubBlock.closest('[data-block-index]') || startSubBlock;
        const endBlockEl = endSubBlock.closest('[data-block-index]') || endSubBlock;
        const startIdxNum = parseInt(startBlockEl.dataset.blockIndex, 10);
        const endIdxNum = parseInt(endBlockEl.dataset.blockIndex, 10);
        const lowIdx = Math.min(startIdxNum, endIdxNum);
        const highIdx = Math.max(startIdxNum, endIdxNum);

        allBlocksInside.forEach(blockEl => {
            const bi = parseInt(blockEl.dataset.blockIndex, 10);
            if (isNaN(bi) || bi < lowIdx || bi > highIdx) return;
            if (!range.intersectsNode(blockEl)) return;

            const childSbs = blockEl.querySelectorAll('.sub-block[data-sub-block-id]');
            const hasRealSubBlocks = childSbs.length > 0;
            const hasAnyAdded = subBlocks.some(sb => sb.subBlockId && String(sb.subBlockId).startsWith(String(bi) + '.'));
            const isStartOrEnd = (String(bi) + '.0' === startId) || (String(bi) + '.0' === endId);

            if (!hasRealSubBlocks && !hasAnyAdded) {
                // 为没有真实子块的段落创建虚拟子块
                const virtualId = String(bi) + '.0';
                if (!isStartOrEnd) {
                    blockEl._virtualSubBlockId = virtualId;
                    blockEl.dataset.subBlockId = virtualId;
                }
                subBlocks.push({
                    element: blockEl,
                    subBlockId: virtualId,
                    text: blockEl.textContent || '',
                    isFullySelected: range.containsNode ? range.containsNode(blockEl) : false,
                    isVirtual: true
                });
                console.log('[获取范围内子块] 添加中间子块(虚拟，无真实子块的段落):', virtualId);
            }
        });
    } else {
        // 没有真实子块：按块级元素范围生成虚拟子块，确保中间块不会漏掉
        console.log('[获取范围内子块] 无真实子块，采用块级虚拟子块遍历');
        // 尝试找到更高的容器（如 ocr/translation 包裹）
        let topContainer = container.closest && (container.closest('#ocr-content-wrapper, #translation-content-wrapper') || container.closest('[data-block-index]')?.parentElement) || document;
        const allBlocks = topContainer.querySelectorAll('[data-block-index]');
        console.log('[获取范围内子块] 块级元素数量:', allBlocks.length);

        // 获取起止 blockIndex
        const startBlockEl = startSubBlock.closest('[data-block-index]') || startSubBlock;
        const endBlockEl = endSubBlock.closest('[data-block-index]') || endSubBlock;
        const startIdx = parseInt(startBlockEl.dataset.blockIndex, 10);
        const endIdx = parseInt(endBlockEl.dataset.blockIndex, 10);
        const low = Math.min(startIdx, endIdx);
        const high = Math.max(startIdx, endIdx);

        allBlocks.forEach(blockEl => {
            const bi = parseInt(blockEl.dataset.blockIndex, 10);
            if (isNaN(bi) || bi < low || bi > high) return;
            if (!range.intersectsNode(blockEl)) return;

            // 如果已有真实子块（某些页面后续会动态分割），优先真实子块
            const subBlocksOfBlock = blockEl.querySelectorAll('.sub-block[data-sub-block-id]');
            if (subBlocksOfBlock.length > 0) {
                subBlocksOfBlock.forEach(sb => {
                    const id = sb.dataset.subBlockId;
                    if (id === startId || id === endId) return;
                    subBlocks.push({
                        element: sb,
                        subBlockId: id,
                        text: sb.textContent || '',
                        isFullySelected: range.containsNode ? range.containsNode(sb) : false
                    });
                    console.log('[获取范围内子块] 添加中间子块(真实):', id);
                });
            } else {
                // 创建虚拟子块ID：blockIndex.0
                const virtualId = blockEl.dataset.blockIndex + '.0';
                if (virtualId === startId || virtualId === endId) return;
                blockEl._virtualSubBlockId = virtualId;
                blockEl.dataset.subBlockId = virtualId;
                subBlocks.push({
                    element: blockEl,
                    subBlockId: virtualId,
                    text: blockEl.textContent || '',
                    isFullySelected: range.containsNode ? range.containsNode(blockEl) : false,
                    isVirtual: true
                });
                console.log('[获取范围内子块] 添加中间子块(虚拟):', virtualId);
            }
        });
    }
    
    // 去重
    const uniqueMap = new Map();
    subBlocks.forEach(sb => {
        if (!uniqueMap.has(sb.subBlockId)) uniqueMap.set(sb.subBlockId, sb);
    });
    let uniqueSubBlocks = Array.from(uniqueMap.values());

    // 按文档顺序排序，确保从起点到终点连续
    uniqueSubBlocks.sort((a, b) => {
        if (a.element === b.element) return 0;
        const pos = a.element.compareDocumentPosition(b.element);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    });

    console.log('[获取范围内子块] 最终结果(文档顺序):', uniqueSubBlocks);
    return uniqueSubBlocks;
}

// ===== 新增：处理跨子块标注 =====
function handleCrossBlockAnnotation(event, crossBlockInfo) {
    event.preventDefault();
    
    console.log(`[跨子块标注] 检测到跨子块选择，涉及 ${crossBlockInfo.affectedSubBlocks.length} 个子块`);
    
    // 新增：判断是否为只读视图 (分块对比模式)
    const isReadOnlyView = window.currentVisibleTabId === 'chunk-compare';
    if (isReadOnlyView) {
        hideContextMenu();
        return;
    }
    
    // 生成跨子块标注ID
    const crossBlockAnnotationId = 'cross-' + _page_generateUUID();
    
    // 设置全局选择信息
    window.globalCurrentSelection = {
        text: crossBlockInfo.selectedText,
        range: crossBlockInfo.range.cloneRange(),
        isCrossBlock: true,
        crossBlockAnnotationId: crossBlockAnnotationId,
        affectedSubBlocks: crossBlockInfo.affectedSubBlocks,
        startSubBlock: crossBlockInfo.startSubBlock,
        endSubBlock: crossBlockInfo.endSubBlock,
        contentIdentifierForSelection: window.globalCurrentContentIdentifier,
        targetElement: crossBlockInfo.startSubBlock // 使用起始子块作为代表
    };
    
    // 在上下文菜单上存储信息
    annotationContextMenuElement.dataset.contextContentIdentifier = window.globalCurrentContentIdentifier;
    annotationContextMenuElement.dataset.contextIsCrossBlock = "true";
    annotationContextMenuElement.dataset.contextCrossBlockAnnotationId = crossBlockAnnotationId;
    annotationContextMenuElement.dataset.contextSelectedText = crossBlockInfo.selectedText;
    annotationContextMenuElement.dataset.contextAffectedSubBlocks = JSON.stringify(
        crossBlockInfo.affectedSubBlocks.map(sb => sb.subBlockId)
    );
    
    // 检查是否已经有跨子块标注
    const isHighlighted = checkCrossBlockHighlight(crossBlockInfo.affectedSubBlocks);
    const hasNote = checkCrossBlockNote(crossBlockInfo.affectedSubBlocks);
    
    console.log(`[跨子块标注] 高亮状态: ${isHighlighted}, 有批注: ${hasNote}`);
    
    window.globalCurrentHighlightStatus = isHighlighted;
    updateCrossBlockContextMenuOptions(isHighlighted, hasNote);
    showContextMenu(event.pageX, event.pageY);
}

// ===== 修改：检查跨子块高亮状态 =====
function checkCrossBlockHighlight(affectedSubBlocks) {
    if (!window.data || !window.data.annotations) return false;
    
    const affectedSubBlockIds = affectedSubBlocks.map(sb => sb.subBlockId);
    
    // 查找跨子块标注
    const crossBlockAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, window.globalCurrentContentIdentifier);
    if (crossBlockAnnotation) {
        return true;
    }
    
    // 备用检查：是否所有子块都被独立高亮（兼容旧数据）
    for (const subBlock of affectedSubBlocks) {
        const hasHighlight = window.data.annotations.some(ann => 
            ann.targetType === window.globalCurrentContentIdentifier &&
            ann.target && ann.target.selector && ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlock.subBlockId &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );
        if (!hasHighlight) {
            return false;
        }
    }
    return true;
}

// ===== 修改：检查跨子块批注状态 =====
function checkCrossBlockNote(affectedSubBlocks) {
    if (!window.data || !window.data.annotations) return false;
    
    const affectedSubBlockIds = affectedSubBlocks.map(sb => sb.subBlockId);
    
    // 查找跨子块标注的批注
    const crossBlockAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, window.globalCurrentContentIdentifier);
    if (crossBlockAnnotation && crossBlockAnnotation.body && crossBlockAnnotation.body.length > 0 && 
        crossBlockAnnotation.body[0].value && crossBlockAnnotation.body[0].value.trim() !== '') {
        return true;
    }
    
    // 备用检查：是否有任意子块有批注
    for (const subBlock of affectedSubBlocks) {
        const hasNote = window.data.annotations.some(ann => 
            ann.targetType === window.globalCurrentContentIdentifier &&
            ann.target && ann.target.selector && ann.target.selector[0] &&
            ann.target.selector[0].subBlockId === subBlock.subBlockId &&
            ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== ''
        );
        if (hasNote) {
            return true;
        }
    }
    return false;
}

// ===== 新增：更新跨子块上下文菜单 =====
function updateCrossBlockContextMenuOptions(isHighlighted, hasNote) {
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

// ===== 重新设计：跨子块标注数据结构 =====
async function handleCrossBlockMenuAction(action, color, event) {
    const docId = getQueryParam('id');
    if (!docId) {
        alert('错误：无法获取文档ID。');
        hideContextMenu();
        return;
    }
    
    const crossBlockAnnotationId = annotationContextMenuElement.dataset.contextCrossBlockAnnotationId;
    const affectedSubBlockIds = JSON.parse(annotationContextMenuElement.dataset.contextAffectedSubBlocks || '[]');
    const selectedText = annotationContextMenuElement.dataset.contextSelectedText;
    const currentContentIdentifier = annotationContextMenuElement.dataset.contextContentIdentifier;
    
    console.log(`[跨子块操作] 执行操作: ${action}, 涉及 ${affectedSubBlockIds.length} 个子块`);
    
    try {
        if (action === 'highlight-block') {
            // 如果没有选择颜色，使用默认颜色
            if (!color) {
                color = 'yellow'; // 默认黄色
                console.log("跨子块高亮操作未选择颜色，使用默认颜色: " + color);
            }
            
            // 创建单一的跨子块标注对象
            await createCrossBlockAnnotation(docId, affectedSubBlockIds, currentContentIdentifier, color, '', selectedText);
            console.log(`[跨子块高亮] 已创建跨子块标注，涉及 ${affectedSubBlockIds.length} 个子块`);
            
        } else if (action === 'remove-highlight') {
            // 移除跨子块标注
            await removeCrossBlockAnnotation(affectedSubBlockIds, currentContentIdentifier);
            console.log(`[跨子块去高亮] 已移除跨子块标注`);
            
        } else if (action === 'add-note' || action === 'edit-note') {
            // 为跨子块标注添加/编辑批注
            let noteText;
            if (action === 'edit-note') {
                const existingNote = findExistingCrossBlockNote(affectedSubBlockIds, currentContentIdentifier);
                noteText = prompt("编辑跨子块批注内容：", existingNote || '');
            } else {
                noteText = prompt("为选中区域输入批注内容：", "");
            }
            
            if (noteText === null) {
                // 用户取消
            } else if (noteText.trim() === '') {
                alert('批注内容不能为空。');
            } else {
                await addNoteToCrossBlockAnnotation(noteText, affectedSubBlockIds, currentContentIdentifier);
                console.log(`[跨子块批注] 已为选中区域添加批注`);
            }
            
        } else if (action === 'copy-content') {
            // 复制选中的跨子块内容
            if (selectedText && selectedText.trim()) {
                navigator.clipboard.writeText(selectedText)
                    .then(() => {
                        console.log(`[跨子块复制] 已复制跨子块内容: ${selectedText.substring(0,50)}...`);
                    })
                    .catch(err => {
                        console.error('复制失败:', err);
                        alert('复制内容失败。');
                    });
            } else {
                alert('没有可复制的内容。');
            }
        }
        
        // 刷新高亮显示
        if (action !== 'copy-content') {
            const containerId = currentContentIdentifier + '-content-wrapper';
            const container = document.getElementById(containerId);
            if (container && typeof window.applyBlockAnnotations === 'function') {
                window.applyBlockAnnotations(container, window.data.annotations, currentContentIdentifier);
            }
        }
        
    } catch (error) {
        console.error(`[跨子块操作] 操作 '${action}' 失败:`, error);
        alert(`跨子块操作失败: ${error.message}`);
    } finally {
        hideContextMenu();
    }
}

// ===== 新增：创建跨子块标注 =====
async function createCrossBlockAnnotation(docId, affectedSubBlockIds, contentIdentifier, color, note = '', selectedText = '') {
    // 检查是否已存在跨子块标注
    const existingAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);
    
    if (existingAnnotation) {
        // 更新现有标注
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
        await updateAnnotationInDB(existingAnnotation);
    } else {
        // 创建新的跨子块标注
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
            isCrossBlock: true, // 标识这是跨子块标注
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
        
        await saveAnnotationToDB(newAnnotation);
        if (!window.data.annotations) window.data.annotations = [];
        window.data.annotations.push(newAnnotation);
    }
}

// ===== 新增：计算跨子块范围信息 =====
function calculateCrossBlockRange(affectedSubBlockIds) {
    if (!affectedSubBlockIds.length) return null;

    // 优先使用跨子块检测时保存的原始 Range，避免上下文菜单点击导致选区变化
    let range = (window.globalCurrentSelection && window.globalCurrentSelection.isCrossBlock && window.globalCurrentSelection.range)
        ? window.globalCurrentSelection.range.cloneRange()
        : null;
    if (!range) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        range = selection.getRangeAt(0);
    }

    // 找到起止子块元素（优先使用 crossBlockInfo 存下来的 DOM）
    let startSubBlock = (window.globalCurrentSelection && window.globalCurrentSelection.startSubBlock) || null;
    let endSubBlock = (window.globalCurrentSelection && window.globalCurrentSelection.endSubBlock) || null;
    if (!startSubBlock) {
        startSubBlock = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement.closest('.sub-block')
            : (range.startContainer.closest ? range.startContainer.closest('.sub-block') : null);
    }
    if (!endSubBlock) {
        endSubBlock = range.endContainer.nodeType === Node.TEXT_NODE
            ? range.endContainer.parentElement.closest('.sub-block')
            : (range.endContainer.closest ? range.endContainer.closest('.sub-block') : null);
    }

    const startSubBlockId = startSubBlock ? startSubBlock.dataset.subBlockId : affectedSubBlockIds[0];
    const endSubBlockId = endSubBlock ? endSubBlock.dataset.subBlockId : affectedSubBlockIds[affectedSubBlockIds.length - 1];

    // 计算相对各自子块文本的字符偏移
    let startOffsetInSubBlock = 0;
    let endOffsetInSubBlock = 0;
    const fragmentTextLength = (frag) => {
        const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT, null);
        let len = 0;
        let n;
        const isInIndicator = (textNode) => {
            let p = textNode.parentNode;
            while (p) {
                if (p.nodeType === 1 && p.classList && p.classList.contains('cross-block-indicator')) return true;
                p = p.parentNode;
            }
            return false;
        };
        while ((n = walker.nextNode())) {
            if (!isInIndicator(n)) len += (n.nodeValue ? n.nodeValue.length : 0);
        }
        return len;
    };

    try {
        if (startSubBlock && startSubBlock.contains(range.startContainer)) {
            const r = document.createRange();
            r.selectNodeContents(startSubBlock);
            r.setEnd(range.startContainer, range.startOffset);
            startOffsetInSubBlock = fragmentTextLength(r.cloneContents());
        } else if (startSubBlock) {
            // 兜底：若浏览器把选区起点放到子块外，则认为偏移为0
            startOffsetInSubBlock = 0;
        }
        if (endSubBlock && endSubBlock.contains(range.endContainer)) {
            const r2 = document.createRange();
            r2.selectNodeContents(endSubBlock);
            r2.setEnd(range.endContainer, range.endOffset);
            endOffsetInSubBlock = fragmentTextLength(r2.cloneContents());
        } else if (endSubBlock) {
            // 兜底：若浏览器把选区终点放到子块外，则认为到达末尾
            const rr = document.createRange();
            rr.selectNodeContents(endSubBlock);
            endOffsetInSubBlock = fragmentTextLength(rr.cloneContents());
        }
    } catch (e) {
        console.warn('[跨子块] 计算偏移失败，使用回退 offset', e);
        startOffsetInSubBlock = range.startOffset || 0;
        endOffsetInSubBlock = range.endOffset || 0;
    }

    return {
        startSubBlockId: startSubBlockId,
        endSubBlockId: endSubBlockId,
        startOffset: startOffsetInSubBlock,
        endOffset: endOffsetInSubBlock,
        selectedText: (window.globalCurrentSelection && window.globalCurrentSelection.isCrossBlock && window.globalCurrentSelection.text)
            ? window.globalCurrentSelection.text
            : (window.getSelection ? window.getSelection().toString() : '')
    };
}

// ===== 新增：查找跨子块标注 =====
function findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier) {
    if (!window.data || !window.data.annotations) return null;
    
    return window.data.annotations.find(ann => {
        if (ann.targetType !== contentIdentifier || !ann.isCrossBlock) return false;
        if (!ann.target || !ann.target.selector || !ann.target.selector[0]) return false;
        
        const selector = ann.target.selector[0];
        if (!selector.affectedSubBlocks) return false;
        
        // 检查是否包含相同的子块ID集合
        const annotationSubBlocks = selector.affectedSubBlocks.sort();
        const targetSubBlocks = affectedSubBlockIds.sort();
        
        return JSON.stringify(annotationSubBlocks) === JSON.stringify(targetSubBlocks);
    });
}

// ===== 新增：移除跨子块标注 =====
async function removeCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier) {
    const annotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);
    if (annotation) {
        await deleteAnnotationFromDB(annotation.id);
        const index = window.data.annotations.findIndex(ann => ann.id === annotation.id);
        if (index > -1) {
            window.data.annotations.splice(index, 1);
        }
    }
}

// ===== 新增：为跨子块标注添加批注 =====
async function addNoteToCrossBlockAnnotation(noteText, affectedSubBlockIds, contentIdentifier) {
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
        
        await updateAnnotationInDB(annotation);
    }
}

// ===== 新增：创建或更新子块标注 =====
async function createOrUpdateSubBlockAnnotation(docId, subBlockId, contentIdentifier, color, note = '', groupId = null) {
    // 查找现有标注
    const existingAnnotation = window.data.annotations.find(ann => 
        ann.targetType === contentIdentifier &&
        ann.target && ann.target.selector && ann.target.selector[0] &&
        ann.target.selector[0].subBlockId === subBlockId
    );
    
    if (existingAnnotation) {
        // 更新现有标注
        existingAnnotation.highlightColor = color;
        existingAnnotation.modified = new Date().toISOString();
        if (groupId) existingAnnotation.groupId = groupId;
        if (note) {
            existingAnnotation.body = [{
                type: 'TextualBody',
                value: note,
                format: 'text/plain',
                purpose: 'commenting'
            }];
            existingAnnotation.motivation = 'commenting';
        } else if (!existingAnnotation.body || existingAnnotation.body.length === 0) {
            existingAnnotation.motivation = 'highlighting';
        }
        
        await updateAnnotationInDB(existingAnnotation);
    } else {
        // 创建新标注
        const newAnnotation = {
            '@context': 'http://www.w3.org/ns/anno.jsonld',
            id: 'urn:uuid:' + _page_generateUUID(),
            type: 'Annotation',
            motivation: note ? 'commenting' : 'highlighting',
            created: new Date().toISOString(),
            docId: docId,
            targetType: contentIdentifier,
            highlightColor: color,
            target: {
                source: docId,
                selector: [{
                    type: 'SubBlockSelector',
                    subBlockId: subBlockId
                }]
            },
            body: note ? [{
                type: 'TextualBody',
                value: note,
                format: 'text/plain',
                purpose: 'commenting'
            }] : []
        };
        
        if (groupId) newAnnotation.groupId = groupId;
        
        // 设置 exact 字段
        const subBlockElement = document.querySelector(`[data-sub-block-id="${subBlockId}"]`);
        if (subBlockElement) {
            newAnnotation.target.selector[0].exact = subBlockElement.textContent.trim();
        }
        
        await saveAnnotationToDB(newAnnotation);
        if (!window.data.annotations) window.data.annotations = [];
        window.data.annotations.push(newAnnotation);
    }
}

// ===== 修改：查找跨子块批注 =====
function findExistingCrossBlockNote(affectedSubBlockIds, contentIdentifier) {
    if (!window.data || !window.data.annotations) return '';
    
    // 首先查找跨子块标注
    const crossBlockAnnotation = findCrossBlockAnnotation(affectedSubBlockIds, contentIdentifier);
    if (crossBlockAnnotation && crossBlockAnnotation.body && crossBlockAnnotation.body.length > 0 && 
        crossBlockAnnotation.body[0].value) {
        return crossBlockAnnotation.body[0].value;
    }
    
    // 备用：查找第一个子块的批注
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

// 暴露新功能
window.detectCrossBlockSelection = detectCrossBlockSelection;
window.handleCrossBlockAnnotation = handleCrossBlockAnnotation;

// 保留旧函数以保持向后兼容性
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
