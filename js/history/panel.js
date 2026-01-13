/**
 * @file js/history/panel.js
 * @description 历史记录面板和列表渲染
 */

import {
    escapeHtml,
    escapeAttr,
    sanitizeId,
    sanitizeFileName,
    sanitizePath,
    formatDisplayTime,
    buildSnippetText,
    buildRelativePathLabel,
    recordMatchesQuery,
    isChunkFailed
} from './utils.js';

import {
    loadUserFolders,
    loadFolderAssignments,
    buildAssignableFolderOptions,
    resolveRecordFolder,
    folderExists,
    renderFolderSelect,
    renderHistoryFolders,
    assignRecordToFolder,
    assignBatchToFolder,
    removeFolderAssignmentForRecord,
    setCurrentFolderAssignments,
    setCurrentFolderOptions,
    setCurrentUserFolderMap,
    getCurrentFolderAssignments
} from './folders.js';

import { openHistoryClearModal } from './clear.js';
import { showHistoryDetail, downloadHistoryRecord, retryTranslateRecord } from './actions.js';

/** 默认导出模板 */
export const DEFAULT_EXPORT_TEMPLATE = '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}';

/** 默认导出格式 */
export const DEFAULT_EXPORT_FORMATS = ['original', 'markdown'];

/** 支持的导出格式 */
export const SUPPORTED_EXPORT_FORMATS = ['original', 'markdown', 'html', 'docx'];

/** 文本类原始扩展名 */
export const TEXTUAL_ORIGINAL_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex', 'html', 'htm']);

/** 打包选项 */
export const PACKAGING_OPTIONS = {
    preserve: 'preserve',
    flat: 'flat'
};

/** 图标按钮样式 */
const ICON_BUTTON_CLASS = 'inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 bg-white text-gray-500 hover:text-blue-600 hover:border-blue-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1';
const ICON_BUTTON_DANGER_EXTRA = 'hover:text-red-500 hover:border-red-200 focus:ring-red-300';
const ICON_BUTTON_SUCCESS_EXTRA = 'hover:text-emerald-500 hover:border-emerald-200 focus:ring-emerald-300';

/** UI 状态 */
export const historyUIState = {
    activeFolder: 'all',
    searchQuery: '',
    batchSearch: {},
    batchSearchDraft: {}
};

/**
 * 打开历史面板
 */
export async function openHistoryPanel() {
    const panel = document.getElementById('historyPanel');
    if (panel) panel.classList.remove('hidden');
    await renderHistoryList();
}

/**
 * 渲染历史记录列表
 */
export async function renderHistoryList() {
    const listDiv = document.getElementById('historyList');
    if (!listDiv) return;

    const previousOpenBatchIds = new Set();
    if (listDiv) {
        listDiv.querySelectorAll('details[data-batch-id]').forEach(detailEl => {
            if (detailEl && detailEl.open) {
                const batchId = detailEl.getAttribute('data-batch-id');
                if (batchId) {
                    previousOpenBatchIds.add(batchId);
                }
            }
        });
    }

    const historySearchInput = document.getElementById('historySearchInput');
    if (historySearchInput && historySearchInput.value !== historyUIState.searchQuery) {
        historySearchInput.value = historyUIState.searchQuery;
    }

    const results = await getAllResultsFromDB();
    const assignments = loadFolderAssignments();
    const userFolders = loadUserFolders();

    setCurrentFolderAssignments(assignments);
    setCurrentUserFolderMap(new Map(userFolders.map(folder => [folder.id, folder])));
    setCurrentFolderOptions(buildAssignableFolderOptions(new Map(userFolders.map(folder => [folder.id, folder]))));

    renderHistoryFolders(Array.isArray(results) ? results : [], assignments, userFolders, historyUIState.activeFolder);

    if (!results || results.length === 0) {
        listDiv.innerHTML = '<div class="text-gray-400 text-center py-8">暂无历史记录</div>';
        window.__historyRecordCache = {};
        window.__historyBatchCache = {};
        historyUIState.batchSearch = {};
        historyUIState.batchSearchDraft = {};
        return;
    }

    results.sort((a, b) => new Date(b.time) - new Date(a.time));

    if (!folderExists(historyUIState.activeFolder)) {
        historyUIState.activeFolder = 'all';
    }

    const searchTerm = (historyUIState.searchQuery || '').trim().toLowerCase();
    const recordCache = {};
    const batchMap = new Map();
    const fullBatchMap = new Map();
    const singleRecords = [];

    results.forEach(record => {
        if (!record || !record.id) return;
        if (record.batchId) {
            if (!fullBatchMap.has(record.batchId)) {
                fullBatchMap.set(record.batchId, []);
            }
            fullBatchMap.get(record.batchId).push(record);
        }

        const folderId = resolveRecordFolder(record.id, assignments);

        if (historyUIState.activeFolder === 'uncategorized' && folderId !== 'uncategorized') return;
        if (historyUIState.activeFolder !== 'all' && historyUIState.activeFolder !== 'uncategorized' && folderId !== historyUIState.activeFolder) return;

        if (searchTerm && !recordMatchesQuery(record, searchTerm)) return;

        let batchQueryLower = '';
        if (record.batchId && historyUIState.batchSearch[record.batchId]) {
            batchQueryLower = historyUIState.batchSearch[record.batchId].trim().toLowerCase();
            if (batchQueryLower && !recordMatchesQuery(record, batchQueryLower)) return;
        }

        recordCache[record.id] = record;

        if (record.batchId) {
            if (!batchMap.has(record.batchId)) {
                batchMap.set(record.batchId, []);
            }
            batchMap.get(record.batchId).push(record);
        } else {
            singleRecords.push(record);
        }
    });

    const fragments = [];
    const visibleBatchIds = new Set();

    batchMap.forEach((group, batchId) => {
        if (!group || group.length === 0) return;
        group.sort((a, b) => {
            const orderA = typeof a.batchOrder === 'number' ? a.batchOrder : (typeof a.batchOriginalIndex === 'number' ? a.batchOriginalIndex + 1 : 0);
            const orderB = typeof b.batchOrder === 'number' ? b.batchOrder : (typeof b.batchOriginalIndex === 'number' ? b.batchOriginalIndex + 1 : 0);
            if (orderA !== orderB) return orderA - orderB;
            return new Date(a.time) - new Date(b.time);
        });
        visibleBatchIds.add(batchId);
        fragments.push(renderBatchGroupItem(batchId, group, {
            searchValue: historyUIState.batchSearch[batchId] || '',
            folderIds: group.map(item => resolveRecordFolder(item.id, assignments)),
            isOpen: previousOpenBatchIds.has(batchId)
        }));
    });

    Object.keys(historyUIState.batchSearch).forEach(batchId => {
        if (!visibleBatchIds.has(batchId)) {
            delete historyUIState.batchSearch[batchId];
        }
    });
    Object.keys(historyUIState.batchSearchDraft).forEach(batchId => {
        if (!visibleBatchIds.has(batchId)) {
            delete historyUIState.batchSearchDraft[batchId];
        }
    });

    singleRecords.forEach(record => {
        fragments.push(renderHistoryRecordItem(record));
    });

    listDiv.innerHTML = fragments.length > 0
        ? fragments.join('')
        : '<div class="text-gray-400 text-center py-8">未匹配到符合条件的历史记录</div>';

    window.__historyRecordCache = recordCache;
    const batchCache = {};
    fullBatchMap.forEach((group, batchId) => {
        if (Array.isArray(group)) {
            group.sort((a, b) => {
                const orderA = typeof a.batchOrder === 'number' ? a.batchOrder : (typeof a.batchOriginalIndex === 'number' ? a.batchOriginalIndex + 1 : 0);
                const orderB = typeof b.batchOrder === 'number' ? b.batchOrder : (typeof b.batchOriginalIndex === 'number' ? b.batchOriginalIndex + 1 : 0);
                if (orderA !== orderB) return orderA - orderB;
                return new Date(a.time) - new Date(b.time);
            });
        }
        batchCache[batchId] = group;
    });
    window.__historyBatchCache = batchCache;

    // 同步刷新侧边栏快捷入口
    if (typeof window.refreshSidebarHistory === 'function') {
        window.refreshSidebarHistory();
    }
}

/**
 * 分析记录状态
 * @param {Object} record - 历史记录
 * @returns {Object} 状态对象
 */
function analyzeRecordStatus(record) {
    const ocrChunks = Array.isArray(record.ocrChunks) ? record.ocrChunks : [];
    const translatedChunks = Array.isArray(record.translatedChunks) ? record.translatedChunks : [];
    if (ocrChunks.length > 0) {
        const total = ocrChunks.length;
        let failed = 0;
        for (let i = 0; i < total; i++) {
            const text = translatedChunks[i] || '';
            if (isChunkFailed(text)) failed++;
        }
        const success = total - failed;
        return { total, success, failed, isStructured: false };
    }

    const meta = record && record.metadata ? record.metadata : {};
    const transList = Array.isArray(meta.translatedContentList) ? meta.translatedContentList : [];
    const supportsStructured = !!meta.supportsStructuredTranslation;
    if (supportsStructured && transList.length > 0) {
        const total = transList.length;
        const _norm = (v) => {
            if (v == null) return '';
            try {
                if (Array.isArray(v)) return v.join(' ').trim();
                if (typeof v === 'string') return v.trim();
                return String(v).trim();
            } catch(_) { return ''; }
        };

        let failed = 0;
        for (let i = 0; i < total; i++) {
            const it = transList[i];
            if (it && it.failed === true) {
                if (it.failureReason) {
                    if (it.failureReason === 'empty') {
                        failed++;
                    }
                } else {
                    const orig = Array.isArray(meta.contentListJson) ? meta.contentListJson[i] : null;
                    if (orig) {
                        let shouldCountAsFailed = false;
                        if (orig.type === 'text') {
                            const a = _norm(orig.text);
                            const b = _norm(it.text);
                            shouldCountAsFailed = a && !b;
                        } else if (orig.type === 'image') {
                            const a = _norm(orig.image_caption);
                            const b = _norm(it.image_caption);
                            shouldCountAsFailed = a && !b;
                        } else if (orig.type === 'table') {
                            const a = _norm(orig.table_caption);
                            const b = _norm(it.table_caption);
                            shouldCountAsFailed = a && !b;
                        }
                        if (shouldCountAsFailed) {
                            failed++;
                        }
                    }
                }
            }
        }
        if (Array.isArray(meta.failedStructuredItems) && meta.failedStructuredItems.length > 0) {
            let actualFailed = 0;
            for (const failedItem of meta.failedStructuredItems) {
                const idx = failedItem.index;
                if (idx >= 0 && idx < transList.length) {
                    const item = transList[idx];
                    if (item && item.failureReason) {
                        if (item.failureReason === 'empty') {
                            actualFailed++;
                        }
                    } else {
                        const orig = Array.isArray(meta.contentListJson) ? meta.contentListJson[idx] : null;
                        if (orig && item) {
                            let shouldCountAsFailed = false;
                            if (orig.type === 'text') {
                                const a = _norm(orig.text);
                                const b = _norm(item.text);
                                shouldCountAsFailed = a && !b;
                            } else if (orig.type === 'image') {
                                const a = _norm(orig.image_caption);
                                const b = _norm(item.image_caption);
                                shouldCountAsFailed = a && !b;
                            } else if (orig.type === 'table') {
                                const a = _norm(orig.table_caption);
                                const b = _norm(item.table_caption);
                                shouldCountAsFailed = a && !b;
                            }
                            if (shouldCountAsFailed) {
                                actualFailed++;
                            }
                        }
                    }
                }
            }
            failed = actualFailed;
        }
        if (failed === 0 && Array.isArray(meta.contentListJson)) {
            const origList = meta.contentListJson;
            const minLen = Math.min(origList.length, transList.length);
            for (let i = 0; i < minLen; i++) {
                const o = origList[i] || {};
                const t = transList[i] || {};
                if (o.type === 'text') {
                    const a = _norm(o.text);
                    const b = _norm(t.text);
                    if (a && !b) failed++;
                } else if (o.type === 'image') {
                    const a = _norm(o.image_caption);
                    const b = _norm(t.image_caption);
                    if (a && !b) failed++;
                } else if (o.type === 'table') {
                    const a = _norm(o.table_caption);
                    const b = _norm(t.table_caption);
                    if (a && !b) failed++;
                }
            }
        }
        const success = Math.max(0, total - failed);
        return { total, success, failed, isStructured: true };
    }

    return { total: 0, success: 0, failed: 0, isStructured: !!supportsStructured };
}

/**
 * 构建状态徽章
 * @param {Object} status - 状态对象
 * @returns {string} HTML 字符串
 */
function buildStatusBadge(status) {
    if (!status || status.total === 0) {
        return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-500">未分块</span>';
    }
    if (status.success === 0) {
        if (status.isStructured) {
            return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">PDF对照</span>';
        }
        return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">预览中，无翻译块</span>';
    }
    if (status.failed > 0) {
        return `<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">部分失败 ${status.success}/${status.total}</span>`;
    }
    return `<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-green-100 text-green-700">完成 ${status.success}/${status.total}</span>`;
}

/**
 * 渲染批量任务组
 * @param {string} batchId - 批量任务 ID
 * @param {Array} records - 记录数组
 * @param {Object} options - 配置选项
 * @returns {string} HTML 字符串
 */
function renderBatchGroupItem(batchId, records, options = {}) {
    const safeBatchId = sanitizeId(batchId || 'batch');
    const representative = records[0] || {};
    const summaryName = representative.name || batchId || '批量任务';
    const timeLabel = formatDisplayTime(representative.time);
    const targetLang = representative.batchOutputLanguage || representative.targetLanguage || '';
    const template = representative.batchTemplate || DEFAULT_EXPORT_TEMPLATE;
    const rawBatchFormats = Array.isArray(representative.batchFormats) && representative.batchFormats.length > 0
        ? Array.from(new Set(['original', ...representative.batchFormats]))
        : DEFAULT_EXPORT_FORMATS;
    let formats = rawBatchFormats.filter(fmt => SUPPORTED_EXPORT_FORMATS.includes(fmt));
    if (formats.length === 0) {
        formats = [...DEFAULT_EXPORT_FORMATS];
    }
    const zipEnabled = typeof representative.batchZip === 'boolean' ? representative.batchZip : false;
    const structure = representative.batchZipStructure || PACKAGING_OPTIONS.preserve;

    const childrenHtml = records.map(record => renderHistoryRecordItem(record, { withinBatch: true, batchId })).join('');
    const configId = `batch-export-config-${safeBatchId}`;
    const activeSearchValue = typeof options.searchValue === 'string' ? options.searchValue : '';
    const hasDraftValue = Object.prototype.hasOwnProperty.call(historyUIState.batchSearchDraft, batchId);
    const draftValueRaw = hasDraftValue ? historyUIState.batchSearchDraft[batchId] : activeSearchValue;
    const draftValue = typeof draftValueRaw === 'string' ? draftValueRaw : '';
    const folderIds = Array.isArray(options.folderIds) ? options.folderIds.filter(Boolean) : [];
    const firstFolderId = folderIds.length > 0 ? folderIds[0] : resolveRecordFolder(representative.id, getCurrentFolderAssignments());
    const isMixedFolder = folderIds.length > 0 ? !folderIds.every(id => id === firstFolderId) : false;
    const folderSelectHtml = renderFolderSelect({
        scope: 'batch',
        ownerId: batchId,
        selectedId: isMixedFolder ? null : firstFolderId,
        isMixed: isMixedFolder
    });
    const isOpen = !!options.isOpen;
    const openAttr = isOpen ? ' open' : '';
    const batchSearchInput = `
        <div class="relative w-full max-w-xs">
            <iconify-icon icon="carbon:search" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="16"></iconify-icon>
            <input type="search" value="${escapeAttr(draftValue)}" placeholder="搜索此批量任务" data-history-batch-search-input data-batch-id="${escapeAttr(batchId)}" class="w-full rounded-md border border-gray-200 bg-white pl-8 pr-3 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300" autocomplete="off">
        </div>`;
    const batchExportBtn = `
        <button type="button" class="${ICON_BUTTON_CLASS}" data-history-action="open-batch-export" data-batch-id="${escapeAttr(batchId)}" data-target="${configId}" aria-label="配置导出" title="配置导出">
            <iconify-icon icon="carbon:share" width="18"></iconify-icon>
        </button>`;
    const batchDeleteBtn = `
        <button type="button" class="${ICON_BUTTON_CLASS} ${ICON_BUTTON_DANGER_EXTRA}" data-history-action="delete-batch" data-batch-id="${escapeAttr(batchId)}" aria-label="删除批量任务" title="删除批量任务">
            <iconify-icon icon="carbon:trash-can" width="18"></iconify-icon>
        </button>`;
    const batchSearchApplyBtn = `
        <button type="button" class="${ICON_BUTTON_CLASS}" data-history-action="apply-batch-search" data-batch-id="${escapeAttr(batchId)}" aria-label="应用搜索" title="应用搜索">
            <iconify-icon icon="carbon:search" width="18"></iconify-icon>
        </button>`;
    const batchSearchControls = `
        <div class="flex items-center gap-2">
            ${batchSearchInput}
            ${batchSearchApplyBtn}
        </div>`;
    const batchHeaderTools = `
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-3">
            <div class="flex items-center gap-2 text-xs text-gray-600">
                <span class="font-medium text-gray-600">文件夹</span>
                ${folderSelectHtml}
            </div>
            ${batchSearchControls}
        </div>`;
    const batchChildrenHtml = childrenHtml || (activeSearchValue.trim()
        ? '<div class="text-xs text-gray-500">未找到符合搜索条件的记录。</div>'
        : '<div class="text-xs text-gray-500">暂无记录</div>');

    return `
    <details class="history-batch-group border border-slate-200 bg-white rounded-xl shadow-sm mb-4 overflow-hidden hover:border-blue-200 hover:shadow-md transition" data-batch-id="${escapeAttr(batchId)}"${openAttr}>
        <summary class="cursor-pointer select-none px-4 py-3 bg-slate-50">
            <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <span class="text-sm font-semibold text-gray-800 flex flex-wrap items-center gap-2">
                    <span>批量任务</span>
                    <span class="text-blue-600">${escapeHtml(summaryName)}</span>
                    <span class="text-[11px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">${records.length} 个文件</span>
                </span>
                <span class="text-xs text-gray-500">${timeLabel}${targetLang ? ` \u00b7 语言：${escapeHtml(targetLang)}` : ''}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-2 text-xs text-gray-600 md:text-sm">
                ${batchExportBtn}
                ${batchDeleteBtn}
            </div>
        </summary>
        <div class="px-4 pb-4 space-y-3 bg-white">
            ${batchHeaderTools}
            ${renderExportConfigPanel({
                id: configId,
                scope: 'batch',
                ownerId: batchId,
                template,
                formats,
                zipEnabled,
                structure,
                withinBatch: true
            })}
            ${batchChildrenHtml}
        </div>
    </details>
    `;
}

/**
 * 渲染历史记录项
 * @param {Object} record - 历史记录
 * @param {Object} options - 配置选项
 * @returns {string} HTML 字符串
 */
function renderHistoryRecordItem(record, options = {}) {
    const safeId = sanitizeId(record.id || 'record');
    const withinBatch = !!options.withinBatch;
    const status = analyzeRecordStatus(record);
    const statusBadge = buildStatusBadge(status);
    const ocrSnippet = buildSnippetText(record.ocr);
    const translationSnippet = buildSnippetText(record.translation);
    const timeLabel = formatDisplayTime(record.time);
    const ocrEngine = (record.ocrEngine || '').toLowerCase();
    const ocrLabel = ocrEngine === 'mistral' ? 'Mistral OCR' : ocrEngine === 'mineru' ? 'MinerU OCR' : ocrEngine === 'doc2x' ? 'Doc2X OCR' : '';
    const transName = record.translationModelName || 'none';
    let transLabel = '';
    if (transName === 'none') {
        transLabel = '未翻译';
    } else if (transName === 'custom') {
        transLabel = record.translationModelId
            ? escapeHtml(record.translationModelId)
            : (record.translationModelCustomName ? escapeHtml(record.translationModelCustomName) : '自定义');
    } else {
        const mapping = { deepseek: 'DeepSeek', gemini: 'Gemini', tongyi: '通义百炼', volcano: '火山引擎', deeplx: 'DeepLX' };
        transLabel = mapping[transName] || transName;
    }
    const targetLang = record.batchOutputLanguage || record.targetLanguage || '';
    const relativePathLabel = buildRelativePathLabel(record);
    const template = record.batchTemplate || DEFAULT_EXPORT_TEMPLATE;
    const rawFormats = Array.isArray(record.batchFormats) && record.batchFormats.length > 0
        ? Array.from(new Set(['original', ...record.batchFormats]))
        : DEFAULT_EXPORT_FORMATS;
    let formats = rawFormats.filter(fmt => SUPPORTED_EXPORT_FORMATS.includes(fmt));
    if (formats.length === 0) {
        formats = [...DEFAULT_EXPORT_FORMATS];
    }
    const zipEnabled = typeof record.batchZip === 'boolean' ? record.batchZip : false;
    const structure = record.batchZipStructure || PACKAGING_OPTIONS.preserve;
    const configId = `record-export-config-${safeId}${options.batchId ? `-${sanitizeId(options.batchId)}` : ''}`;
    const retryDisabled = status.failed === 0 ? 'disabled opacity-50 cursor-not-allowed' : '';
    const folderId = resolveRecordFolder(record.id, getCurrentFolderAssignments());
    const folderSelectHtml = renderFolderSelect({
        scope: 'record',
        ownerId: record.id,
        selectedId: folderId,
        isMixed: false
    });
    const escapedRecordId = escapeAttr(record.id || '');
    const exportBtnHtml = `
        <button type="button" class="${ICON_BUTTON_CLASS}" data-history-action="open-record-export" data-record-id="${escapeAttr(record.id)}" data-target="${configId}" aria-label="配置导出" title="配置导出">
            <iconify-icon icon="carbon:share" width="18"></iconify-icon>
        </button>`;
    const downloadBtnHtml = `
        <button type="button" class="${ICON_BUTTON_CLASS} ${ICON_BUTTON_SUCCESS_EXTRA}" data-history-action="download-record" data-record-id="${escapedRecordId}" aria-label="下载记录" title="下载记录">
            <iconify-icon icon="carbon:download" width="18"></iconify-icon>
        </button>`;
    const recordDisplayName = record.name || relativePathLabel || record.id || '历史记录';
    const escapedRecordNameAttr = escapeAttr(recordDisplayName);
    const deleteBtnHtml = withinBatch ? '' : `
        <button type="button" class="${ICON_BUTTON_CLASS} ${ICON_BUTTON_DANGER_EXTRA}" data-history-action="delete-record" data-record-id="${escapedRecordId}" data-record-name="${escapedRecordNameAttr}" aria-label="删除记录" title="删除记录">
            <iconify-icon icon="carbon:trash-can" width="18"></iconify-icon>
        </button>`;
    const startReadingBtnHtml = `
        <button type="button" class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1" data-history-action="open-record" data-record-id="${escapedRecordId}">
            <iconify-icon icon="carbon:document-view" width="18"></iconify-icon>
            <span>开始阅读</span>
        </button>`;

    const containerClasses = withinBatch
        ? 'border border-slate-200 rounded-xl p-3 bg-white shadow-sm hover:border-blue-200 transition'
        : 'border border-slate-200 rounded-xl p-4 bg-white shadow-sm hover:border-blue-200 hover:shadow-md transition';

    return `
    <div class="${containerClasses}" id="history-item-${safeId}" data-record-id="${escapeAttr(record.id)}">
        <div class="flex flex-col gap-1">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
                <div class="min-w-0">
                    <div class="text-sm font-semibold text-gray-800 flex flex-wrap items-center gap-2 break-all">
                        <span>${escapeHtml(record.name || '未命名')}</span> ${statusBadge}
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        ${timeLabel}${targetLang ? ` \u00b7 语言：${escapeHtml(targetLang)}` : ''}
                    </div>
                    ${(ocrLabel || (transLabel && transLabel !== '未翻译')) ? `
                    <div class="text-xs text-gray-500">
                        ${ocrLabel ? `OCR：${ocrLabel}` : ''}
                        ${(ocrLabel && (transLabel && transLabel !== '未翻译')) ? ' \u00b7 ' : ''}
                        ${(transLabel && transLabel !== '未翻译') ? `翻译：${escapeHtml(transLabel)}` : ''}
                    </div>
                    ` : ''}
                    <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span class="font-medium text-gray-600">文件夹</span>
                        ${folderSelectHtml}
                    </div>
                </div>
                <div class="hidden md:flex flex-wrap gap-2 text-xs text-gray-600 justify-end md:text-sm items-center">
                    ${exportBtnHtml}
                    ${startReadingBtnHtml}
                    ${downloadBtnHtml}
                    ${deleteBtnHtml}
                </div>
            </div>
            <div class="mt-2 md:hidden">
                <details class="group">
                    <summary class="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-md bg-white text-gray-700 cursor-pointer select-none">
                        <iconify-icon icon="carbon:overflow-menu-horizontal" width="18"></iconify-icon>
                        <span class="text-sm">操作</span>
                    </summary>
                    <div class="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                        ${exportBtnHtml}
                        ${startReadingBtnHtml}
                        ${downloadBtnHtml}
                        ${deleteBtnHtml}
                    </div>
                </details>
            </div>
            <div class="text-xs text-gray-600 break-words">OCR：${ocrSnippet}</div>
            <div class="text-xs text-gray-600 break-words">翻译：${translationSnippet}</div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-gray-600 mt-2">
                <button id="retry-failed-btn-${safeId}" data-history-action="retry-translate" data-record-id="${escapedRecordId}" data-retry-mode="failed" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 ${retryDisabled}">重试失败段</button>
                <button id="retry-all-btn-${safeId}" data-history-action="retry-translate" data-record-id="${escapedRecordId}" data-retry-mode="all" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100">重新翻译全部</button>
                <span id="retry-status-${safeId}" class="text-xs text-gray-500"></span>
            </div>
            ${renderExportConfigPanel({
                id: configId,
                scope: 'record',
                ownerId: record.id,
                template,
                formats,
                zipEnabled,
                structure,
                withinBatch
            })}
        </div>
    </div>
    `;
}

/**
 * 渲染导出配置面板
 * @param {Object} options - 配置选项
 * @returns {string} HTML 字符串
 */
function renderExportConfigPanel({ id, scope, ownerId, template, formats, zipEnabled, structure, withinBatch }) {
    const formatOptions = SUPPORTED_EXPORT_FORMATS.map(fmt => {
        const checked = formats.includes(fmt) ? 'checked' : '';
        const label = fmt === 'original' ? '原格式' : fmt.toUpperCase();
        return `<label class="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-full bg-white shadow-sm"><input type="checkbox" value="${fmt}" ${checked} data-config-format="${fmt}" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"><span>${label}</span></label>`;
    }).join('');

    const sectionClasses = withinBatch ? 'mt-2 hidden border border-dashed border-blue-200 bg-white rounded-lg p-3' : 'mt-3 hidden border border-dashed border-gray-200 bg-gray-50 rounded-lg p-3';
    const structureValue = structure && PACKAGING_OPTIONS[structure] ? structure : PACKAGING_OPTIONS.preserve;
    const preserveChecked = structureValue === PACKAGING_OPTIONS.preserve ? 'checked' : '';
    const flatChecked = structureValue === PACKAGING_OPTIONS.flat ? 'checked' : '';

    const zipCheckedAttr = (zipEnabled || structureValue === PACKAGING_OPTIONS.flat) ? 'checked' : '';
    const zipDisabledAttr = structureValue === PACKAGING_OPTIONS.flat ? 'disabled' : '';

    return `
    <div id="${id}" class="${sectionClasses}" data-config-scope="${scope}" data-owner-id="${escapeAttr(ownerId)}">
        <label class="block text-xs text-gray-600 mb-2">
            命名模板
            <input type="text" class="mt-1 w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-400 focus:border-blue-400" value="${escapeAttr(template || DEFAULT_EXPORT_TEMPLATE)}" data-config-template>
        </label>
        <div class="flex flex-wrap items-center gap-3 text-xs text-gray-700" data-config-formats>
            ${formatOptions}
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600" data-config-structure-group>
            <span class="font-medium text-gray-600">ZIP 结构</span>
            <label class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white">
                <input type="radio" name="pack-structure-${id}" value="preserve" ${preserveChecked} data-config-structure>
                <span>保留原始目录结构</span>
            </label>
            <label class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white">
                <input type="radio" name="pack-structure-${id}" value="flat" ${flatChecked} data-config-structure>
                <span>原文/译文分组，不保留目录</span>
            </label>
            <span class="hidden h-4 w-px bg-gray-200 sm:block"></span>
            <label class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-200 bg-white ${zipDisabledAttr ? 'opacity-60 cursor-not-allowed' : ''}">
                <input type="checkbox" ${zipCheckedAttr} ${zipDisabledAttr} data-config-zip class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <span>导出为 ZIP（某些结构将自动启用）</span>
            </label>
        </div>
        <div class="mt-3 flex items-center gap-2">
            <button type="button" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700" data-history-action="confirm-${scope}-export" data-owner-id="${escapeAttr(ownerId)}" data-target="${id}">确认导出</button>
            <button type="button" class="px-3 py-1 border border-gray-200 rounded text-gray-600 hover:bg-gray-100" data-history-action="cancel-config" data-target="${id}">取消</button>
        </div>
    </div>
    `;
}

// 导出工具函数供 actions.js 使用
export { analyzeRecordStatus, isChunkFailed };
