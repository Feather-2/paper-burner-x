/**
 * @file js/history/utils.js
 * @description 历史记录模块工具函数
 */

/**
 * 防抖函数
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟毫秒数
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, delay) {
    let timer = null;
    return function debounced(...args) {
        const context = this;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(context, args);
        }, delay);
    };
}

/**
 * 检查记录是否匹配搜索查询
 * @param {Object} record - 历史记录对象
 * @param {string} queryLower - 小写搜索词
 * @returns {boolean} 是否匹配
 */
export function recordMatchesQuery(record, queryLower) {
    if (!queryLower) return true;
    const safeQuery = String(queryLower).toLowerCase();
    if (!safeQuery) return true;
    const pool = [];
    if (record.name) pool.push(record.name);
    if (record.relativePath) pool.push(record.relativePath);
    if (record.batchId) pool.push(record.batchId);
    if (record.batchTemplate) pool.push(record.batchTemplate);
    if (record.batchOutputLanguage || record.targetLanguage) pool.push(record.batchOutputLanguage || record.targetLanguage);
    if (record.ocr) pool.push(record.ocr);
    if (record.translation) pool.push(record.translation);
    if (record.file && record.file.pbxRelativePath) pool.push(record.file.pbxRelativePath);
    for (let i = 0; i < pool.length; i++) {
        const value = pool[i];
        if (typeof value === 'string' && value.toLowerCase().includes(safeQuery)) {
            return true;
        }
    }
    return false;
}

/**
 * HTML 转义
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function(ch) {
        switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return ch;
        }
    });
}

/**
 * HTML 属性转义
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
}

/**
 * 清理 ID 字符串，仅保留安全字符
 * @param {string} id - 原始 ID
 * @returns {string} 清理后的 ID
 */
export function sanitizeId(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * 清理文件名
 * @param {string} name - 原始文件名
 * @returns {string} 清理后的文件名
 */
export function sanitizeFileName(name) {
    return (name || 'document').replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 清理路径
 * @param {string} path - 原始路径
 * @returns {string} 清理后的路径
 */
export function sanitizePath(path) {
    return (path || '').split('/').map(segment => sanitizeFileName(segment)).filter(Boolean).join('/');
}

/**
 * 格式化显示时间
 * @param {string|number|Date} timeValue - 时间值
 * @returns {string} 格式化后的时间字符串
 */
export function formatDisplayTime(timeValue) {
    if (!timeValue) return '未知时间';
    try {
        const date = new Date(timeValue);
        if (Number.isNaN(date.getTime())) return '未知时间';
        return date.toLocaleString();
    } catch (e) {
        return '未知时间';
    }
}

/**
 * 构建摘要文本
 * @param {string} text - 原始文本
 * @returns {string} 摘要文本
 */
export function buildSnippetText(text) {
    if (!text) return '无';
    const sanitized = text.replace(/\s+/g, ' ').trim();
    return sanitized.length > 80 ? `${escapeHtml(sanitized.slice(0, 80))}...` : escapeHtml(sanitized);
}

/**
 * 构建相对路径标签
 * @param {Object} record - 历史记录对象
 * @returns {string} 相对路径
 */
export function buildRelativePathLabel(record) {
    const rel = record.relativePath || (record.file && record.file.pbxRelativePath) || '';
    if (!rel) return '';
    return rel;
}

/**
 * 检查翻译块是否失败
 * @param {string} text - 翻译文本
 * @returns {boolean} 是否失败
 */
export function isChunkFailed(text) {
    if (text == null) return true;
    let t = String(text).trim();
    if (!t) return true;
    const firstLine = t.split('\n', 1)[0];
    let norm = firstLine.replace(/^>+\s*/, '').trim();
    norm = norm.replace(/^\*\*(.*)\*\*$/,'$1').trim();
    if (/^\[(?:翻译失败|处理错误|翻译错误|翻译意外失败)/i.test(norm)) return true;
    if (/保留原文\s*Part/i.test(norm)) return true;
    return false;
}
