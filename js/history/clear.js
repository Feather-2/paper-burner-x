/**
 * @file js/history/clear.js
 * @description 历史记录清除功能
 */

import { clearFolderAssignments, removeFolderAssignmentForRecord } from './folders.js';

/** 清除确认短语 */
export const REQUIRED_CLEAR_PHRASE = '确定删除';

/** 清除模式 */
let historyClearMode = 'all';

/** 待删除记录 ID */
let pendingDeleteRecordId = null;

/** 待删除记录名称 */
let pendingDeleteRecordName = '';

/** 当前清除步骤 */
let currentClearStep = 1;

/** DOM 元素引用 */
let domRefs = null;

/** 外部回调 */
let callbacks = {
    onPerformClear: null,
    historyUIState: null
};

/**
 * 初始化清除模块
 * @param {Object} refs - DOM 元素引用
 * @param {Object} cbs - 回调函数
 */
export function initClearModule(refs, cbs) {
    domRefs = refs;
    callbacks = { ...callbacks, ...cbs };
}

/**
 * 获取清除模式
 * @returns {string} 清除模式
 */
export function getHistoryClearMode() {
    return historyClearMode;
}

/**
 * 获取待删除记录 ID
 * @returns {string|null} 记录 ID
 */
export function getPendingDeleteRecordId() {
    return pendingDeleteRecordId;
}

/**
 * 获取待删除记录名称
 * @returns {string} 记录名称
 */
export function getPendingDeleteRecordName() {
    return pendingDeleteRecordName;
}

/**
 * 更新清除内容显示
 */
export function updateHistoryClearContent() {
    if (!domRefs) return;
    const { historyClearStep1Message, historyClearFinalMessage, historyClearExecute } = domRefs;

    if (historyClearStep1Message) {
        if (historyClearMode === 'record') {
            const displayName = pendingDeleteRecordName || '选中的记录';
            historyClearStep1Message.textContent = `即将删除历史记录"${displayName}"。请确认是否继续。`;
        } else {
            historyClearStep1Message.textContent = '即将永久删除所有历史记录（包括所有批次、译文、文件夹分配）。请确认是否继续。';
        }
    }
    if (historyClearFinalMessage) {
        historyClearFinalMessage.textContent = historyClearMode === 'record'
            ? '历史记录删除后将无法恢复。请确保已备份需要的数据。'
            : '历史记录一旦清空，将无法恢复。请确保已备份需要的数据。';
    }
    if (historyClearExecute) {
        historyClearExecute.textContent = historyClearMode === 'record' ? '删除记录' : '永久删除';
    }
}

/**
 * 设置清除步骤
 * @param {number} step - 步骤号 (1, 2, 3)
 */
export function setHistoryClearStep(step) {
    if (!domRefs) return;
    const { historyClearStep1, historyClearStep2, historyClearStep3, historyClearPhraseInput } = domRefs;

    currentClearStep = step;
    const stepMap = { 1: historyClearStep1, 2: historyClearStep2, 3: historyClearStep3 };
    Object.entries(stepMap).forEach(([key, el]) => {
        if (!el) return;
        const isActive = Number(key) === step;
        if (isActive) {
            el.classList.remove('hidden');
            el.removeAttribute('hidden');
        } else {
            el.classList.add('hidden');
            el.setAttribute('hidden', '');
        }
        el.setAttribute('aria-hidden', String(!isActive));
    });

    if (step === 1) {
        resetStep2State();
    }
    if (step === 2 && historyClearPhraseInput) {
        setTimeout(() => historyClearPhraseInput.focus(), 0);
    }
}

/**
 * 重置步骤2状态
 */
export function resetStep2State() {
    if (!domRefs) return;
    const { historyClearPhraseInput, historyClearStep2Next } = domRefs;

    if (historyClearPhraseInput) {
        historyClearPhraseInput.value = '';
    }
    if (historyClearStep2Next) {
        historyClearStep2Next.disabled = true;
        historyClearStep2Next.classList.add('opacity-60', 'cursor-not-allowed');
    }
}

/**
 * 打开清除确认对话框
 * @param {string} mode - 模式 ('all' 或 'record')
 * @param {Object} options - 配置选项
 * @param {string} options.recordId - 记录 ID
 * @param {string} options.recordName - 记录名称
 */
export function openHistoryClearModal(mode = 'all', { recordId = null, recordName = '' } = {}) {
    historyClearMode = mode === 'record' ? 'record' : 'all';
    pendingDeleteRecordId = historyClearMode === 'record' ? recordId : null;
    pendingDeleteRecordName = historyClearMode === 'record' ? (recordName || '') : '';
    updateHistoryClearContent();

    const historyClearModal = domRefs?.historyClearModal;
    if (!historyClearModal) {
        const targetLabel = pendingDeleteRecordName || '选中的记录';
        const fallbackConfirm = historyClearMode === 'record'
            ? `确定要删除历史记录"${targetLabel}"吗？此操作无法恢复。`
            : '确定要清空所有历史记录吗？此操作无法恢复。';
        const confirmed = confirm(fallbackConfirm);
        if (!confirmed) return;
        performClearHistory();
        return;
    }
    resetStep2State();
    setHistoryClearStep(1);
    historyClearModal.classList.remove('hidden');
    historyClearModal.classList.add('flex');
}

/**
 * 关闭清除确认对话框
 */
export function closeHistoryClearModal() {
    const historyClearModal = domRefs?.historyClearModal;
    if (!historyClearModal) return;
    historyClearModal.classList.add('hidden');
    historyClearModal.classList.remove('flex');
    resetStep2State();
    setHistoryClearStep(1);
    historyClearMode = 'all';
    pendingDeleteRecordId = null;
    pendingDeleteRecordName = '';
}

/**
 * 执行清除历史记录
 */
export async function performClearHistory() {
    const { onPerformClear, historyUIState } = callbacks;

    if (historyClearMode === 'record') {
        if (pendingDeleteRecordId) {
            removeFolderAssignmentForRecord(pendingDeleteRecordId);
            await deleteResultFromDB(pendingDeleteRecordId);
            if (typeof onPerformClear === 'function') {
                await onPerformClear();
            }
            if (typeof showNotification === 'function') {
                showNotification('历史记录已删除。', 'success');
            }
        }
    } else {
        await clearAllResultsFromDB();
        clearFolderAssignments();
        if (historyUIState) {
            historyUIState.activeFolder = 'all';
            historyUIState.searchQuery = '';
            historyUIState.batchSearch = {};
            historyUIState.batchSearchDraft = {};
        }
        if (typeof onPerformClear === 'function') {
            await onPerformClear();
        }
        if (typeof showNotification === 'function') {
            showNotification('历史记录已全部清空。', 'success');
        }
    }
    historyClearMode = 'all';
    pendingDeleteRecordId = null;
    pendingDeleteRecordName = '';
}

/**
 * 绑定清除模块事件监听器
 */
export function bindClearEventListeners() {
    if (!domRefs) return;

    const {
        historyClearModal,
        historyClearCancelBtn,
        historyClearCloseBtn,
        historyClearStep1Next,
        historyClearStep2Next,
        historyClearStep2Back,
        historyClearStep3Back,
        historyClearPhraseInput,
        historyClearExecute
    } = domRefs;

    if (historyClearModal) {
        historyClearModal.addEventListener('click', function(event) {
            if (event.target === historyClearModal) {
                closeHistoryClearModal();
            }
        });
    }

    if (historyClearCancelBtn) {
        historyClearCancelBtn.addEventListener('click', function() {
            closeHistoryClearModal();
        });
    }
    if (historyClearCloseBtn) {
        historyClearCloseBtn.addEventListener('click', function() {
            closeHistoryClearModal();
        });
    }
    if (historyClearStep1Next) {
        historyClearStep1Next.addEventListener('click', function() {
            setHistoryClearStep(2);
        });
    }
    if (historyClearStep2Back) {
        historyClearStep2Back.addEventListener('click', function() {
            setHistoryClearStep(1);
        });
    }
    if (historyClearStep3Back) {
        historyClearStep3Back.addEventListener('click', function() {
            setHistoryClearStep(2);
        });
    }
    if (historyClearStep2Next) {
        historyClearStep2Next.addEventListener('click', function() {
            if (historyClearStep2Next.disabled) return;
            setHistoryClearStep(3);
        });
    }
    if (historyClearPhraseInput) {
        historyClearPhraseInput.addEventListener('input', function(event) {
            if (!historyClearStep2Next) return;
            const matches = (event.target.value || '').trim() === REQUIRED_CLEAR_PHRASE;
            historyClearStep2Next.disabled = !matches;
            historyClearStep2Next.classList.toggle('opacity-60', !matches);
            historyClearStep2Next.classList.toggle('cursor-not-allowed', !matches);
        });
    }
    if (historyClearExecute) {
        historyClearExecute.addEventListener('click', async function() {
            historyClearExecute.disabled = true;
            historyClearExecute.classList.add('opacity-70');
            try {
                await performClearHistory();
                closeHistoryClearModal();
            } finally {
                historyClearExecute.disabled = false;
                historyClearExecute.classList.remove('opacity-70');
            }
        });
    }
}
