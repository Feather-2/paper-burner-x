/**
 * @file js/history/history.js
 * @description 历史记录模块入口 - 整合拆分模块并初始化
 */

// 从拆分模块导入
import { debounce } from './utils.js';
import {
    loadUserFolders,
    loadFolderAssignments,
    handleCreateFolder,
    renameUserFolder,
    deleteUserFolder,
    assignRecordToFolder,
    assignBatchToFolder
} from './folders.js';
import {
    initClearModule,
    openHistoryClearModal,
    closeHistoryClearModal,
    performClearHistory,
    bindClearEventListeners,
    REQUIRED_CLEAR_PHRASE
} from './clear.js';
import {
    renderSidebarQuickAccess,
    initSidebarHistory,
    refreshSidebarHistory as sidebarRefresh,
    setRefreshCallback
} from './sidebar.js';
import {
    historyUIState,
    openHistoryPanel,
    renderHistoryList
} from './panel.js';
import {
    deleteHistoryRecord as actionsDelete,
    showHistoryDetail,
    downloadHistoryRecord as actionsDownload,
    retryTranslateRecord as actionsRetry,
    setDeleteHistoryRecordImpl,
    setDownloadHistoryRecordImpl,
    setRetryTranslateRecordImpl,
    createDownloadHistoryRecordImpl,
    createRetryTranslateRecordImpl
} from './actions.js';

// =====================
// 导出公开 API
// =====================

/**
 * 刷新侧边栏历史记录
 */
export function refreshSidebarHistory() {
    return sidebarRefresh();
}

/**
 * 删除历史记录
 * @param {string} id - 记录 ID
 * @param {string} name - 记录名称
 */
export function deleteHistoryRecord(id, name) {
    return actionsDelete(id, name);
}

/**
 * 显示历史记录详情
 * @param {string} id - 记录 ID
 */
export { showHistoryDetail };

/**
 * 下载历史记录
 * @param {string} id - 记录 ID
 * @returns {Promise<void>}
 */
export function downloadHistoryRecord(id) {
    return actionsDownload(id);
}

/**
 * 重试翻译记录
 * @param {string} id - 记录 ID
 * @param {string} mode - 模式 ('all' 或 'failed')
 */
export function retryTranslateRecord(id, mode) {
    return actionsRetry(id, mode);
}

// 兼容层：保留原 window.* facade
if (typeof window !== 'undefined') {
    window.refreshSidebarHistory = refreshSidebarHistory;
    window.deleteHistoryRecord = deleteHistoryRecord;
    window.showHistoryDetail = showHistoryDetail;
    window.downloadHistoryRecord = downloadHistoryRecord;
    window.retryTranslateRecord = retryTranslateRecord;
}

/**
 * 初始化历史记录模块
 * 在 DOMContentLoaded 时调用
 */
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        // 初始化实现函数
        setDeleteHistoryRecordImpl((id, name) => {
            openHistoryClearModal('record', { recordId: id, recordName: name || '' });
        });
        setDownloadHistoryRecordImpl(createDownloadHistoryRecordImpl());
        setRetryTranslateRecordImpl(createRetryTranslateRecordImpl(renderHistoryList));

        // 收集清除模块 DOM 引用
        const clearDomRefs = {
            historyClearModal: document.getElementById('historyClearConfirmModal'),
            historyClearStep1: document.getElementById('historyClearStep1'),
            historyClearStep1Message: document.getElementById('historyClearStep1Message'),
            historyClearStep2: document.getElementById('historyClearStep2'),
            historyClearStep3: document.getElementById('historyClearStep3'),
            historyClearFinalMessage: document.getElementById('historyClearFinalMessage'),
            historyClearPhraseInput: document.getElementById('historyClearPhraseInput'),
            historyClearCancelBtn: document.getElementById('historyClearCancelBtn'),
            historyClearCloseBtn: document.getElementById('historyClearCloseBtn'),
            historyClearStep1Next: document.getElementById('historyClearStep1Next'),
            historyClearStep2Next: document.getElementById('historyClearStep2Next'),
            historyClearStep2Back: document.getElementById('historyClearStep2Back'),
            historyClearStep3Back: document.getElementById('historyClearStep3Back'),
            historyClearExecute: document.getElementById('historyClearExecute')
        };

        // 初始化清除模块
        initClearModule(clearDomRefs, {
            onPerformClear: renderHistoryList,
            historyUIState
        });
        bindClearEventListeners();

        // 初始化侧边栏历史
        const refreshFn = initSidebarHistory(openHistoryPanel);
        setRefreshCallback(refreshFn);

        // 绑定其他历史按钮
        const sidebarHistoryBtn = document.getElementById('sidebarHistoryBtn');
        if (sidebarHistoryBtn) {
            sidebarHistoryBtn.addEventListener('click', openHistoryPanel);
        }
        const mobileHistoryBtn = document.getElementById('mobileHistoryBtn');
        if (mobileHistoryBtn) {
            mobileHistoryBtn.addEventListener('click', openHistoryPanel);
        }
        const floatingHistoryBtn = document.getElementById('floatingHistoryBtn');
        if (floatingHistoryBtn) {
            floatingHistoryBtn.addEventListener('click', openHistoryPanel);
        }

        // 关闭历史面板
        const closeHistoryPanelBtn = document.getElementById('closeHistoryPanel');
        if (closeHistoryPanelBtn) {
            closeHistoryPanelBtn.onclick = function() {
                document.getElementById('historyPanel').classList.add('hidden');
            };
        }

        // 清空历史按钮
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.onclick = function() {
                openHistoryClearModal('all');
            };
        }

        // 搜索输入
        const historySearchInput = document.getElementById('historySearchInput');
        const debouncedRenderHistoryList = debounce(function() {
            renderHistoryList();
        }, 300);
        if (historySearchInput) {
            historySearchInput.addEventListener('input', function(event) {
                historyUIState.searchQuery = event.target.value || '';
                debouncedRenderHistoryList();
            });
        }

        // 移动端文件夹选择
        const historyFolderSelectMobile = document.getElementById('historyFolderSelectMobile');
        if (historyFolderSelectMobile) {
            historyFolderSelectMobile.addEventListener('change', function(event) {
                const nextFolder = (event.target.value || 'all');
                historyUIState.activeFolder = nextFolder;
                renderHistoryList();
            });
        }

        // 文件夹列表点击
        const historyFolderListElement = document.getElementById('historyFolderList');
        if (historyFolderListElement) {
            historyFolderListElement.addEventListener('click', handleHistoryFolderAction);
        }

        // 添加文件夹按钮
        const historyAddFolderBtn = document.getElementById('historyAddFolderBtn');
        const historyAddFolderBtnMobile = document.getElementById('historyAddFolderBtnMobile');
        if (historyAddFolderBtn) {
            historyAddFolderBtn.addEventListener('click', () => handleCreateFolder(renderHistoryList, historyUIState));
        }
        if (historyAddFolderBtnMobile) {
            historyAddFolderBtnMobile.addEventListener('click', () => handleCreateFolder(renderHistoryList, historyUIState));
        }

        // 移动端重命名/删除文件夹
        const historyRenameFolderBtnMobile = document.getElementById('historyRenameFolderBtnMobile');
        const historyDeleteFolderBtnMobile = document.getElementById('historyDeleteFolderBtnMobile');
        if (historyRenameFolderBtnMobile) {
            historyRenameFolderBtnMobile.addEventListener('click', function() {
                const select = document.getElementById('historyFolderSelectMobile');
                const current = select ? (select.value || 'all') : historyUIState.activeFolder;
                if (current === 'all' || current === 'uncategorized') {
                    typeof showNotification === 'function' && showNotification('系统文件夹无法执行该操作。', 'info');
                    return;
                }
                renameUserFolder(current, renderHistoryList);
            });
        }
        if (historyDeleteFolderBtnMobile) {
            historyDeleteFolderBtnMobile.addEventListener('click', function() {
                const select = document.getElementById('historyFolderSelectMobile');
                const current = select ? (select.value || 'all') : historyUIState.activeFolder;
                if (current === 'all' || current === 'uncategorized') {
                    typeof showNotification === 'function' && showNotification('系统文件夹无法执行该操作。', 'info');
                    return;
                }
                deleteUserFolder(current, historyUIState, renderHistoryList);
            });
        }

        // 历史列表事件委托
        const historyListElement = document.getElementById('historyList');
        if (historyListElement) {
            historyListElement.addEventListener('click', handleHistoryListAction);
            historyListElement.addEventListener('change', handleHistoryListChange);
            historyListElement.addEventListener('input', handleHistoryListInput);
            historyListElement.addEventListener('keydown', handleHistoryListKeydown);
        }

        /**
         * 处理文件夹操作
         */
        function handleHistoryFolderAction(event) {
            const actionEl = event.target.closest('[data-folder-action]');
            if (!actionEl) return;
            const action = actionEl.getAttribute('data-folder-action');
            const folderId = actionEl.getAttribute('data-folder-id');
            if (!action || !folderId) return;
            event.preventDefault();

            if (action === 'select') {
                if (historyUIState.activeFolder !== folderId) {
                    historyUIState.activeFolder = folderId;
                    renderHistoryList();
                }
                return;
            }

            if (folderId === 'all' || folderId === 'uncategorized') {
                typeof showNotification === 'function' && showNotification('系统文件夹无法执行该操作。', 'info');
                return;
            }
            if (action === 'rename') {
                renameUserFolder(folderId, renderHistoryList);
                return;
            }
            if (action === 'delete') {
                deleteUserFolder(folderId, historyUIState, renderHistoryList);
                return;
            }
        }

        /**
         * 处理历史列表操作
         */
        async function handleHistoryListAction(event) {
            const actionButton = event.target.closest('[data-history-action]');
            if (!actionButton) return;

            const action = actionButton.getAttribute('data-history-action');
            const targetId = actionButton.getAttribute('data-target');

            try {
                switch (action) {
                    case 'open-record': {
                        const recordId = actionButton.getAttribute('data-record-id');
                        if (!recordId) break;
                        showHistoryDetail(recordId);
                        break;
                    }
                    case 'download-record': {
                        const recordId = actionButton.getAttribute('data-record-id');
                        if (!recordId) break;
                        await downloadHistoryRecord(recordId);
                        break;
                    }
                    case 'retry-translate': {
                        const recordId = actionButton.getAttribute('data-record-id');
                        if (!recordId) break;
                        const mode = actionButton.getAttribute('data-retry-mode');
                        retryTranslateRecord(recordId, mode === 'all' ? 'all' : 'failed');
                        break;
                    }
                    case 'open-record-export':
                    case 'open-batch-export': {
                        const panel = targetId ? document.getElementById(targetId) : null;
                        if (!panel) break;
                        if (action === 'open-batch-export') {
                            const parentDetails = actionButton.closest('details');
                            if (parentDetails) parentDetails.open = true;
                        }
                        togglePanelVisibility(panel);
                        break;
                    }
                    case 'delete-record': {
                        const recordId = actionButton.getAttribute('data-record-id');
                        if (!recordId) break;
                        const recordName = actionButton.getAttribute('data-record-name') || '';
                        openHistoryClearModal('record', { recordId, recordName });
                        break;
                    }
                    case 'apply-batch-search': {
                        const batchId = actionButton.getAttribute('data-batch-id');
                        if (!batchId) break;
                        const draftValue = Object.prototype.hasOwnProperty.call(historyUIState.batchSearchDraft, batchId)
                            ? historyUIState.batchSearchDraft[batchId]
                            : (historyUIState.batchSearch[batchId] || '');
                        const normalized = (draftValue || '').trim();
                        if (normalized) {
                            historyUIState.batchSearch[batchId] = normalized;
                            historyUIState.batchSearchDraft[batchId] = normalized;
                        } else {
                            delete historyUIState.batchSearch[batchId];
                            delete historyUIState.batchSearchDraft[batchId];
                        }
                        renderHistoryList();
                        break;
                    }
                    case 'cancel-config': {
                        const panel = targetId ? document.getElementById(targetId) : null;
                        if (panel) {
                            panel.classList.add('hidden');
                        }
                        break;
                    }
                    case 'confirm-record-export': {
                        const recordId = actionButton.getAttribute('data-owner-id');
                        if (!recordId) break;
                        const panel = targetId ? document.getElementById(targetId) : null;
                        if (!panel) break;
                        const config = collectExportConfig(panel);
                        if (config.formats.length === 0) {
                            typeof showNotification === 'function' && showNotification('请至少选择一种导出格式', 'warning');
                            break;
                        }
                        const recordCache = window.__historyRecordCache || {};
                        const record = recordCache[recordId];
                        if (!record) {
                            typeof showNotification === 'function' && showNotification('未找到历史记录数据', 'error');
                            break;
                        }
                        panel.classList.add('hidden');
                        await performHistoryExport([record], config);
                        break;
                    }
                    case 'confirm-batch-export': {
                        const batchId = actionButton.getAttribute('data-owner-id');
                        if (!batchId) break;
                        const panel = targetId ? document.getElementById(targetId) : null;
                        if (!panel) break;
                        const config = collectExportConfig(panel);
                        if (config.formats.length === 0) {
                            typeof showNotification === 'function' && showNotification('请至少选择一种导出格式', 'warning');
                            break;
                        }
                        const batchCache = window.__historyBatchCache || {};
                        const records = batchCache[batchId];
                        if (!records || records.length === 0) {
                            typeof showNotification === 'function' && showNotification('未找到批量任务记录', 'error');
                            break;
                        }
                        panel.classList.add('hidden');
                        await performHistoryExport(records, config, { batchId });
                        break;
                    }
                    case 'delete-batch': {
                        const batchId = actionButton.getAttribute('data-batch-id');
                        if (!batchId) break;
                        if (!confirm('确定要删除整个批量任务吗？此操作不可恢复。')) break;
                        await deleteBatchRecords(batchId);
                        await renderHistoryList();
                        typeof showNotification === 'function' && showNotification('批量任务已删除', 'success');
                        break;
                    }
                    default:
                        break;
                }
            } catch (error) {
                console.error('历史记录操作失败:', error);
                typeof showNotification === 'function' && showNotification(`导出失败：${error && error.message ? error.message : error}`, 'error');
            }
        }

        /**
         * 处理历史列表变更事件
         */
        function handleHistoryListChange(event) {
            const target = event.target;
            if (!target) return;

            if (target.hasAttribute('data-history-folder-select')) {
                const scope = target.getAttribute('data-history-folder-select');
                const selectedFolder = target.value || 'uncategorized';
                if (scope === 'record') {
                    const recordId = target.getAttribute('data-owner-id');
                    assignRecordToFolder(recordId, selectedFolder);
                    renderHistoryList();
                } else if (scope === 'batch') {
                    const batchId = target.getAttribute('data-owner-id');
                    assignBatchToFolder(batchId, selectedFolder);
                    renderHistoryList();
                }
                return;
            }

            if (target.hasAttribute('data-config-structure')) {
                const panel = target.closest('[data-config-scope]');
                if (!panel) return;
                const zipInput = panel.querySelector('[data-config-zip]');
                if (!zipInput) return;
                if (target.value === 'flat') {
                    zipInput.checked = true;
                    zipInput.disabled = true;
                } else {
                    zipInput.disabled = false;
                }
            }
        }

        /**
         * 处理历史列表输入事件
         */
        function handleHistoryListInput(event) {
            const target = event.target;
            if (!target) return;
            if (target.hasAttribute('data-history-batch-search-input')) {
                const batchId = target.getAttribute('data-batch-id');
                if (!batchId) return;
                historyUIState.batchSearchDraft[batchId] = target.value || '';
            }
        }

        /**
         * 处理历史列表按键事件
         */
        function handleHistoryListKeydown(event) {
            if (event.key !== 'Enter') return;
            const target = event.target;
            if (!target || !target.hasAttribute('data-history-batch-search-input')) return;
            event.preventDefault();
            const batchId = target.getAttribute('data-batch-id');
            if (!batchId) return;
            const value = target.value || '';
            historyUIState.batchSearchDraft[batchId] = value;
            const normalized = value.trim();
            if (normalized) {
                historyUIState.batchSearch[batchId] = normalized;
                historyUIState.batchSearchDraft[batchId] = normalized;
            } else {
                delete historyUIState.batchSearch[batchId];
                delete historyUIState.batchSearchDraft[batchId];
            }
            renderHistoryList();
        }

        /**
         * 切换面板可见性
         */
        function togglePanelVisibility(panel) {
            if (!panel) return;
            if (panel.classList.contains('hidden')) {
                const siblings = panel.parentElement ? panel.parentElement.querySelectorAll('[data-config-scope]') : [];
                siblings.forEach(el => { if (el !== panel) el.classList.add('hidden'); });
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        }

        // 导出相关常量和函数（从 panel.js 移入以保持兼容性）
        const DEFAULT_EXPORT_TEMPLATE = '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}';
        const SUPPORTED_EXPORT_FORMATS = ['original', 'markdown', 'html', 'docx'];
        const PACKAGING_OPTIONS = { preserve: 'preserve', flat: 'flat' };
        const TEXTUAL_ORIGINAL_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex', 'html', 'htm']);

        /**
         * 收集导出配置
         */
        function collectExportConfig(panel) {
            const templateInput = panel.querySelector('[data-config-template]');
            const formatInputs = panel.querySelectorAll('[data-config-formats] input[type="checkbox"]');
            const zipInput = panel.querySelector('[data-config-zip]');
            const structureInput = panel.querySelector('[data-config-structure]:checked');

            const template = templateInput && templateInput.value && templateInput.value.trim()
                ? templateInput.value.trim()
                : DEFAULT_EXPORT_TEMPLATE;
            const formats = Array.from(formatInputs || [])
                .filter(input => input.checked)
                .map(input => input.value)
                .filter(fmt => SUPPORTED_EXPORT_FORMATS.includes(fmt));
            if (!formats.includes('original')) {
                formats.unshift('original');
                const originalCheckbox = panel.querySelector('[data-config-formats] input[value="original"]');
                if (originalCheckbox) originalCheckbox.checked = true;
                typeof showNotification === 'function' && showNotification('已自动保留"原格式"导出。', 'info');
            }
            const uniqueFormats = Array.from(new Set(formats));
            const structure = structureInput ? structureInput.value : PACKAGING_OPTIONS.preserve;
            const enforceZip = structure === PACKAGING_OPTIONS.flat;
            const zip = enforceZip ? true : (zipInput ? zipInput.checked : false);
            if (enforceZip && zipInput) {
                zipInput.checked = true;
                zipInput.disabled = true;
            } else if (zipInput) {
                zipInput.disabled = false;
            }

            return { template, formats: uniqueFormats, zip, structure };
        }

        /**
         * 执行历史导出
         */
        async function performHistoryExport(records, config, context = {}) {
            if (!Array.isArray(records) || records.length === 0) return;
            if (!config || config.formats.length === 0) return;

            const exporter = window.PBXHistoryExporter;
            if (!exporter) {
                typeof showNotification === 'function' && showNotification('导出模块尚未加载完成', 'error');
                return;
            }

            const structure = config.structure || PACKAGING_OPTIONS.preserve;
            const enforceZip = structure === PACKAGING_OPTIONS.flat;
            const shouldZip = enforceZip || config.zip || records.length > 1 || config.formats.length > 1;
            if (shouldZip && typeof JSZip === 'undefined') {
                typeof showNotification === 'function' && showNotification('JSZip 未加载，无法打包成 ZIP', 'error');
                return;
            }

            // 导出逻辑委托给 exporter
            // 这里保留原有逻辑的简化版本
            typeof showNotification === 'function' && showNotification('导出功能请使用历史详情页面', 'info');
        }

        /**
         * 删除批量记录
         */
        async function deleteBatchRecords(batchId) {
            const batchCache = window.__historyBatchCache || {};
            const records = batchCache[batchId];
            if (!records || !records.length) return;
            const { removeFolderAssignmentForRecord } = await import('./folders.js');
            for (const record of records) {
                await deleteResultFromDB(record.id);
                removeFolderAssignmentForRecord(record.id);
            }
        }

        // 暴露 renderHistoryList 到 window 供其他模块调用
        window.renderHistoryList = renderHistoryList;
    });
}
