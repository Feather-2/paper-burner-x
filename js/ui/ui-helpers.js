// js/ui/ui-helpers.js
// 基础工具函数集合，提供字符串处理、UUID 生成以及文件信息格式化等能力。
(function(global) {
    'use strict';

    /**
     * 生成一个简单的客户端 UUID (Universally Unique Identifier) v4 版本。
     * 此函数主要用于在 UI 层面为动态生成的元素或组件提供一个唯一的标识符，
     * 它**不具备加密安全性**，不应用于任何安全相关的场景。
     *
     * @returns {string} 返回一个符合 UUID v4 格式的字符串。
     */
    function _generateUUID_ui() {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function escapeHtml(text) {
        if (text == null) return '';
        return String(text).replace(/[&<>\"]+/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        })[ch]);
    }

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlightKeyword(text, keyword) {
        if (!text) return '';
        if (!keyword) return escapeHtml(text);
        const tokens = keyword.trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 0) return escapeHtml(text);
        const pattern = new RegExp(tokens.map(escapeRegExp).join('|'), 'gi');
        let result = '';
        let lastIndex = 0;
        const source = String(text);
        source.replace(pattern, (match, offset) => {
            result += escapeHtml(source.slice(lastIndex, offset));
            result += `<mark>${escapeHtml(match)}</mark>`;
            lastIndex = offset + match.length;
            return match;
        });
        if (lastIndex === 0) {
            return escapeHtml(source);
        }
        result += escapeHtml(source.slice(lastIndex));
        return result;
    }

    function buildSearchItemsFromSelect(selectEl) {
        if (!selectEl) return [];
        const seen = new Set();
        return Array.from(selectEl.options || [])
            .map(opt => (opt.value || '').trim())
            .filter(val => val && !seen.has(val) && seen.add(val))
            .map(val => ({ value: val, label: val }));
    }

    /**
     * 将文件大小（以字节为单位）转换为更易读的格式 (例如 B, KB, MB, GB, TB)。
     *
     * @param {number} bytes - 要格式化的文件大小，单位为字节。
     * @returns {string} 格式化后的文件大小字符串 (例如 "1.23 MB")。如果输入为 0，则返回 "0 B"。
     */
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function getFileDisplayPath(file) {
        if (!file) return '';
        return file.pbxRelativePath || file.webkitRelativePath || file.relativePath || file.fullPath || file.name || '';
    }

    // 挂载到全局作用域，保持与旧版 ui.js 的兼容性
    global._generateUUID_ui = _generateUUID_ui;
    global.escapeHtml = escapeHtml;
    global.escapeRegExp = escapeRegExp;
    global.highlightKeyword = highlightKeyword;
    global.buildSearchItemsFromSelect = buildSearchItemsFromSelect;
    global.formatFileSize = formatFileSize;
    global.getFileDisplayPath = getFileDisplayPath;
})(window);
