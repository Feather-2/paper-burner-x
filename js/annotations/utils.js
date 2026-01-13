/**
 * @file js/annotations/utils.js
 * @description 批注系统工具函数
 */

/**
 * 生成 UUID
 * @returns {string} UUID 字符串
 */
export function _page_generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 转义正则表达式特殊字符
 * @param {string} string - 原字符串
 * @returns {string} 转义后的字符串
 */
export function escapeRegExp(string) {
  // 更安全地转义所有正则表达式特殊字符
  return string.replace(/[.*+?^${}()|[\\\]\\\\]/g, '\\\\$&');
}

/**
 * 从精确匹配生成模糊正则
 * @param {string} exact - 精确匹配字符串
 * @returns {RegExp} 模糊匹配正则
 */
export function fuzzyRegFromExact(exact) {
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
export function fuzzyMatch(a, b) {
    const cleanA = String(a).replace(/\\s+/g, '');
    const cleanB = String(b).replace(/\\s+/g, '');
    return cleanA === cleanB;
}

// ========== Phase 2.3: 批注系统 DOM 缓存优化 ==========
/**
 * 批注系统 DOM 缓存类
 * 缓存 sub-block 元素，避免右键时全文档 querySelectorAll
 */
export const AnnotationDOMCache = {
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

// 挂载到全局，方便外部调用（兼容层）
if (typeof window !== 'undefined') {
    window.AnnotationDOMCache = AnnotationDOMCache;
    // 旧页面中仍有直接调用 _page_generateUUID 的情况
    window._page_generateUUID = _page_generateUUID;
}
