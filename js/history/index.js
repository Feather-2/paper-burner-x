/**
 * @file js/history/index.js
 * @description History 模块统一入口
 */

// 从各子模块重新导出
export {
    debounce,
    recordMatchesQuery,
    escapeHtml,
    escapeAttr,
    sanitizeId,
    sanitizeFileName,
    sanitizePath,
    formatDisplayTime,
    buildSnippetText,
    buildRelativePathLabel,
    isChunkFailed
} from './utils.js';

export {
    HISTORY_FOLDER_STORAGE_KEY,
    HISTORY_FOLDER_ASSIGNMENT_KEY,
    MAX_HISTORY_FOLDER_NAME,
    loadUserFolders,
    saveUserFolders,
    loadFolderAssignments,
    saveFolderAssignments,
    clearFolderAssignments,
    generateFolderId,
    buildAssignableFolderOptions,
    resolveRecordFolder,
    folderExists,
    renderFolderSelect,
    renderFolderListItem,
    renderHistoryFolders,
    handleCreateFolder,
    renameUserFolder,
    deleteUserFolder,
    assignRecordToFolder,
    assignBatchToFolder,
    removeFolderAssignmentForRecord
} from './folders.js';

export {
    REQUIRED_CLEAR_PHRASE,
    initClearModule,
    updateHistoryClearContent,
    setHistoryClearStep,
    resetStep2State,
    openHistoryClearModal,
    closeHistoryClearModal,
    performClearHistory,
    bindClearEventListeners
} from './clear.js';

export {
    renderSidebarQuickAccess,
    initSidebarHistory,
    refreshSidebarHistory,
    setRefreshCallback
} from './sidebar.js';

export {
    DEFAULT_EXPORT_TEMPLATE,
    DEFAULT_EXPORT_FORMATS,
    SUPPORTED_EXPORT_FORMATS,
    TEXTUAL_ORIGINAL_EXTENSIONS,
    PACKAGING_OPTIONS,
    historyUIState,
    openHistoryPanel,
    renderHistoryList
} from './panel.js';

export {
    deleteHistoryRecord,
    showHistoryDetail,
    downloadHistoryRecord,
    retryTranslateRecord,
    setDeleteHistoryRecordImpl,
    setDownloadHistoryRecordImpl,
    setRetryTranslateRecordImpl,
    createDownloadHistoryRecordImpl,
    createRetryTranslateRecordImpl
} from './actions.js';

// 从 history_exporter.js 导出
export {
    KATEX_CDN,
    EXPORT_LABELS,
    MODE_LABELS,
    BRAND_LINK,
    PBXHistoryExporter,
    preparePayload,
    exportAsHtml,
    exportAsMarkdown,
    exportAsDocx,
    exportAsPdf,
    resolveFileName,
    ensureFileExtension,
    buildExportStyles,
    buildMainContent,
    formatTimestamp
} from './history_exporter.js';

// 命名空间导出
import * as Utils from './utils.js';
import * as Folders from './folders.js';
import * as Clear from './clear.js';
import * as Sidebar from './sidebar.js';
import * as Panel from './panel.js';
import * as Actions from './actions.js';
import * as HistoryExporter from './history_exporter.js';

export default {
    Utils,
    Folders,
    Clear,
    Sidebar,
    Panel,
    Actions,
    Exporter: HistoryExporter
};
