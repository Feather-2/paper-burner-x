/**
 * @file js/history/folders.js
 * @description 历史记录文件夹管理
 */

import { escapeHtml, escapeAttr } from './utils.js';

/** 文件夹存储键 */
export const HISTORY_FOLDER_STORAGE_KEY = 'pbxHistoryFolders';

/** 文件夹分配存储键 */
export const HISTORY_FOLDER_ASSIGNMENT_KEY = 'pbxHistoryFolderAssignments';

/** 文件夹名称最大长度 */
export const MAX_HISTORY_FOLDER_NAME = 40;

/** 当前文件夹分配缓存 */
let currentFolderAssignments = {};

/** 当前文件夹选项缓存 */
let currentFolderOptions = [];

/** 当前用户文件夹映射缓存 */
let currentUserFolderMap = new Map();

/**
 * 获取当前文件夹分配
 * @returns {Object} 文件夹分配对象
 */
export function getCurrentFolderAssignments() {
    return currentFolderAssignments;
}

/**
 * 设置当前文件夹分配
 * @param {Object} assignments - 文件夹分配对象
 */
export function setCurrentFolderAssignments(assignments) {
    currentFolderAssignments = assignments;
}

/**
 * 获取当前文件夹选项
 * @returns {Array} 文件夹选项数组
 */
export function getCurrentFolderOptions() {
    return currentFolderOptions;
}

/**
 * 设置当前文件夹选项
 * @param {Array} options - 文件夹选项数组
 */
export function setCurrentFolderOptions(options) {
    currentFolderOptions = options;
}

/**
 * 获取当前用户文件夹映射
 * @returns {Map} 用户文件夹映射
 */
export function getCurrentUserFolderMap() {
    return currentUserFolderMap;
}

/**
 * 设置当前用户文件夹映射
 * @param {Map} map - 用户文件夹映射
 */
export function setCurrentUserFolderMap(map) {
    currentUserFolderMap = map;
}

/**
 * 加载用户文件夹
 * @returns {Array} 用户文件夹数组
 */
export function loadUserFolders() {
    try {
        const raw = localStorage.getItem(HISTORY_FOLDER_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(folder => folder && typeof folder.id === 'string' && typeof folder.name === 'string');
    } catch (error) {
        console.warn('加载历史文件夹失败:', error);
        return [];
    }
}

/**
 * 保存用户文件夹
 * @param {Array} folders - 用户文件夹数组
 */
export function saveUserFolders(folders) {
    try {
        const compact = Array.isArray(folders) ? folders.slice() : [];
        localStorage.setItem(HISTORY_FOLDER_STORAGE_KEY, JSON.stringify(compact));
    } catch (error) {
        console.warn('保存历史文件夹失败:', error);
    }
}

/**
 * 加载文件夹分配
 * @returns {Object} 文件夹分配对象
 */
export function loadFolderAssignments() {
    try {
        const raw = localStorage.getItem(HISTORY_FOLDER_ASSIGNMENT_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        console.warn('加载历史文件夹分配失败:', error);
    }
    return {};
}

/**
 * 保存文件夹分配
 * @param {Object} assignments - 文件夹分配对象
 */
export function saveFolderAssignments(assignments) {
    try {
        localStorage.setItem(HISTORY_FOLDER_ASSIGNMENT_KEY, JSON.stringify(assignments || {}));
    } catch (error) {
        console.warn('保存历史文件夹分配失败:', error);
    }
}

/**
 * 清除文件夹分配
 */
export function clearFolderAssignments() {
    try {
        localStorage.removeItem(HISTORY_FOLDER_ASSIGNMENT_KEY);
    } catch (error) {
        console.warn('清除历史文件夹分配失败:', error);
    }
}

/**
 * 生成文件夹 ID
 * @returns {string} 文件夹 ID
 */
export function generateFolderId() {
    return 'folder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * 构建可分配的文件夹选项
 * @param {Map} folderMap - 文件夹映射
 * @returns {Array} 文件夹选项数组
 */
export function buildAssignableFolderOptions(folderMap) {
    const options = [{ id: 'uncategorized', name: '未分组' }];
    if (folderMap && typeof folderMap.forEach === 'function') {
        folderMap.forEach(folder => {
            if (folder && typeof folder.id === 'string' && typeof folder.name === 'string') {
                options.push({ id: folder.id, name: folder.name });
            }
        });
    }
    return options;
}

/**
 * 解析记录所属文件夹
 * @param {string} recordId - 记录 ID
 * @param {Object} assignmentsOverride - 覆盖的分配对象
 * @returns {string} 文件夹 ID
 */
export function resolveRecordFolder(recordId, assignmentsOverride) {
    if (!recordId) return 'uncategorized';
    const assignments = assignmentsOverride || currentFolderAssignments || {};
    const assigned = assignments[recordId];
    if (!assigned || assigned === 'uncategorized') {
        return 'uncategorized';
    }
    return folderExists(assigned) ? assigned : 'uncategorized';
}

/**
 * 检查文件夹是否存在
 * @param {string} folderId - 文件夹 ID
 * @returns {boolean} 是否存在
 */
export function folderExists(folderId) {
    if (!folderId) return false;
    if (folderId === 'all' || folderId === 'uncategorized') return true;
    if (currentUserFolderMap && currentUserFolderMap.has(folderId)) return true;
    const userFolders = loadUserFolders();
    return userFolders.some(folder => folder && folder.id === folderId);
}

/**
 * 渲染文件夹选择器
 * @param {Object} options - 配置选项
 * @param {string} options.scope - 作用域 ('batch' 或 'record')
 * @param {string} options.ownerId - 所属 ID
 * @param {string} options.selectedId - 选中的文件夹 ID
 * @param {boolean} options.isMixed - 是否混合选择
 * @returns {string} HTML 字符串
 */
export function renderFolderSelect({ scope, ownerId, selectedId, isMixed }) {
    const options = currentFolderOptions || [];
    const normalizedScope = scope === 'batch' ? 'batch' : 'record';
    const normalizedOwner = ownerId || '';
    const ariaLabel = normalizedScope === 'batch' ? '选择批量任务文件夹' : '选择历史记录文件夹';
    const effectiveSelected = selectedId && folderExists(selectedId) ? selectedId : 'uncategorized';
    const selectClasses = 'min-w-[120px] rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300';
    const optionHtml = options.map(folder => {
        const value = escapeAttr(folder.id);
        const isSelected = !isMixed && effectiveSelected === folder.id;
        return `<option value="${value}" ${isSelected ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`;
    }).join('');
    const mixedOption = isMixed ? '<option value="" selected>(多个文件夹)</option>' : '';
    return `
        <select class="${selectClasses}" data-history-folder-select="${escapeAttr(normalizedScope)}" data-owner-id="${escapeAttr(normalizedOwner)}" aria-label="${escapeAttr(ariaLabel)}">
            ${mixedOption}
            ${optionHtml}
        </select>
    `;
}

/**
 * 渲染文件夹列表项
 * @param {Object} options - 配置选项
 * @param {string} options.id - 文件夹 ID
 * @param {string} options.name - 文件夹名称
 * @param {number} options.count - 记录数量
 * @param {boolean} options.system - 是否系统文件夹
 * @param {string} activeFolder - 当前激活的文件夹
 * @returns {string} HTML 字符串
 */
export function renderFolderListItem({ id, name, count, system }, activeFolder) {
    const isActive = activeFolder === id;
    const baseClasses = 'group flex items-center justify-between px-2 py-1.5 rounded-lg border transition-colors';
    const activeClasses = isActive ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-transparent hover:bg-gray-100 text-gray-700';
    const title = escapeAttr(name || '未命名');
    const countBadge = `<span class="ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">${typeof count === 'number' ? count : 0}</span>`;
    const selectButton = `
        <button type="button" class="flex-1 text-left text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1" data-folder-action="select" data-folder-id="${escapeAttr(id)}" title="查看${title}">
            <span>${escapeHtml(name || '未命名')}</span>
            ${countBadge}
        </button>`;
    const actionButtons = system ? '' : `
        <div class="ml-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button type="button" class="rounded p-1 text-gray-400 hover:text-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" data-folder-action="rename" data-folder-id="${escapeAttr(id)}" title="重命名">
                <iconify-icon icon="carbon:edit" width="14"></iconify-icon>
            </button>
            <button type="button" class="rounded p-1 text-gray-400 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300" data-folder-action="delete" data-folder-id="${escapeAttr(id)}" title="删除">
                <iconify-icon icon="carbon:trash-can" width="14"></iconify-icon>
            </button>
        </div>`;
    return `<div class="${baseClasses} ${activeClasses}">${selectButton}${actionButtons}</div>`;
}

/**
 * 渲染历史文件夹列表
 * @param {Array} allRecords - 所有记录
 * @param {Object} assignments - 文件夹分配
 * @param {Array} userFolders - 用户文件夹
 * @param {string} activeFolder - 当前激活的文件夹
 */
export function renderHistoryFolders(allRecords, assignments, userFolders, activeFolder) {
    const listEl = document.getElementById('historyFolderList');
    const mobileSelect = document.getElementById('historyFolderSelectMobile');
    if (!listEl && !mobileSelect) return;
    const records = Array.isArray(allRecords) ? allRecords : [];
    const counts = new Map();
    counts.set('all', records.length);

    const validFolderIds = new Set((userFolders || []).map(folder => folder.id));
    let uncategorizedCount = 0;

    records.forEach(record => {
        if (!record || !record.id) return;
        const folderId = resolveRecordFolder(record.id, assignments);
        if (!folderId || folderId === 'uncategorized' || !validFolderIds.has(folderId)) {
            uncategorizedCount++;
            return;
        }
        counts.set(folderId, (counts.get(folderId) || 0) + 1);
    });

    counts.set('uncategorized', uncategorizedCount);

    const fragments = [];
    fragments.push(renderFolderListItem({ id: 'all', name: '全部记录', count: counts.get('all') || 0, system: true }, activeFolder));
    fragments.push(renderFolderListItem({ id: 'uncategorized', name: '未分组', count: counts.get('uncategorized') || 0, system: true }, activeFolder));

    const sortedUserFolders = (userFolders || []).slice().sort((a, b) => {
        return (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
    });

    sortedUserFolders.forEach(folder => {
        fragments.push(renderFolderListItem({
            id: folder.id,
            name: folder.name,
            count: counts.get(folder.id) || 0,
            system: false
        }, activeFolder));
    });

    if (listEl) {
        listEl.innerHTML = fragments.join('') || '<div class="text-xs text-gray-400 py-4 text-center">暂无文件夹</div>';
    }

    if (mobileSelect) {
        const opts = [];
        opts.push({ id: 'all', name: '全部记录', count: counts.get('all') || 0 });
        opts.push({ id: 'uncategorized', name: '未分组', count: counts.get('uncategorized') || 0 });
        const sortedMobileFolders = (userFolders || []).slice().sort((a, b) => {
            return (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
        });
        sortedMobileFolders.forEach(folder => {
            opts.push({ id: folder.id, name: folder.name, count: counts.get(folder.id) || 0 });
        });
        mobileSelect.innerHTML = opts.map(opt => {
            const selected = activeFolder === opt.id ? 'selected' : '';
            return `<option value="${escapeAttr(opt.id)}" ${selected}>${escapeHtml(opt.name)} (${opt.count})</option>`;
        }).join('');
    }
}

/**
 * 处理创建文件夹
 * @param {Function} onCreated - 创建成功后的回调
 * @param {Object} historyUIState - UI 状态对象
 */
export function handleCreateFolder(onCreated, historyUIState) {
    const name = prompt('请输入新的文件夹名称');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) {
        typeof showNotification === 'function' && showNotification('文件夹名称不能为空。', 'warning');
        return;
    }
    if (trimmed.length > MAX_HISTORY_FOLDER_NAME) {
        typeof showNotification === 'function' && showNotification(`文件夹名称请控制在 ${MAX_HISTORY_FOLDER_NAME} 个字符以内。`, 'warning');
        return;
    }
    const userFolders = loadUserFolders();
    if (userFolders.some(f => (f.name || '').toLowerCase() === trimmed.toLowerCase())) {
        typeof showNotification === 'function' && showNotification('已存在同名文件夹。', 'warning');
        return;
    }
    const folderId = generateFolderId();
    userFolders.push({ id: folderId, name: trimmed, createdAt: Date.now() });
    saveUserFolders(userFolders);
    if (historyUIState) {
        historyUIState.activeFolder = folderId;
    }
    typeof showNotification === 'function' && showNotification(`已创建文件夹"${trimmed}"`, 'success');
    if (typeof onCreated === 'function') {
        onCreated();
    }
}

/**
 * 重命名用户文件夹
 * @param {string} folderId - 文件夹 ID
 * @param {Function} onRenamed - 重命名成功后的回调
 */
export function renameUserFolder(folderId, onRenamed) {
    if (!folderId || folderId === 'all' || folderId === 'uncategorized') {
        typeof showNotification === 'function' && showNotification('系统文件夹无法执行该操作。', 'info');
        return;
    }
    const userFolders = loadUserFolders();
    const target = userFolders.find(folder => folder.id === folderId);
    if (!target) {
        typeof showNotification === 'function' && showNotification('未找到目标文件夹。', 'warning');
        return;
    }
    const newName = prompt('修改文件夹名称', target.name || '');
    if (newName == null) return;
    const trimmed = newName.trim();
    if (!trimmed) {
        typeof showNotification === 'function' && showNotification('文件夹名称不能为空。', 'warning');
        return;
    }
    if (trimmed.length > MAX_HISTORY_FOLDER_NAME) {
        typeof showNotification === 'function' && showNotification(`文件夹名称请控制在 ${MAX_HISTORY_FOLDER_NAME} 个字符以内。`, 'warning');
        return;
    }
    const duplicate = userFolders.some(folder => folder.id !== folderId && (folder.name || '').toLowerCase() === trimmed.toLowerCase());
    if (duplicate) {
        typeof showNotification === 'function' && showNotification('已存在同名文件夹。', 'warning');
        return;
    }
    target.name = trimmed;
    saveUserFolders(userFolders);
    typeof showNotification === 'function' && showNotification('文件夹名称已更新。', 'success');
    if (typeof onRenamed === 'function') {
        onRenamed();
    }
}

/**
 * 删除用户文件夹
 * @param {string} folderId - 文件夹 ID
 * @param {Object} historyUIState - UI 状态对象
 * @param {Function} onDeleted - 删除成功后的回调
 */
export function deleteUserFolder(folderId, historyUIState, onDeleted) {
    if (!folderId || folderId === 'all' || folderId === 'uncategorized') {
        typeof showNotification === 'function' && showNotification('系统文件夹无法执行该操作。', 'info');
        return;
    }
    const userFolders = loadUserFolders();
    const target = userFolders.find(folder => folder.id === folderId);
    if (!target) {
        typeof showNotification === 'function' && showNotification('未找到目标文件夹。', 'warning');
        return;
    }
    if (!confirm(`确定要删除文件夹"${target.name}"吗？文件夹内的记录将回到"未分组"。`)) {
        return;
    }
    const updatedFolders = userFolders.filter(folder => folder.id !== folderId);
    saveUserFolders(updatedFolders);
    const assignments = loadFolderAssignments();
    let modified = false;
    Object.keys(assignments).forEach(recordId => {
        if (assignments[recordId] === folderId) {
            delete assignments[recordId];
            modified = true;
        }
    });
    if (modified) {
        saveFolderAssignments(assignments);
    }
    if (historyUIState && historyUIState.activeFolder === folderId) {
        historyUIState.activeFolder = 'all';
    }
    typeof showNotification === 'function' && showNotification('文件夹已删除。', 'info');
    if (typeof onDeleted === 'function') {
        onDeleted();
    }
}

/**
 * 分配记录到文件夹
 * @param {string} recordId - 记录 ID
 * @param {string} folderId - 文件夹 ID
 */
export function assignRecordToFolder(recordId, folderId) {
    if (!recordId) return;
    const assignments = loadFolderAssignments();
    const normalized = folderExists(folderId) && folderId !== 'all' ? folderId : 'uncategorized';
    if (normalized === 'uncategorized') {
        if (assignments[recordId]) {
            delete assignments[recordId];
            saveFolderAssignments(assignments);
        }
    } else {
        assignments[recordId] = normalized;
        saveFolderAssignments(assignments);
    }
}

/**
 * 分配批量任务到文件夹
 * @param {string} batchId - 批量任务 ID
 * @param {string} folderId - 文件夹 ID
 */
export function assignBatchToFolder(batchId, folderId) {
    if (!batchId) return;
    const cache = window.__historyBatchCache || {};
    const records = cache[batchId] || [];
    if (!records.length) return;
    const assignments = loadFolderAssignments();
    const normalized = folderExists(folderId) && folderId !== 'all' ? folderId : 'uncategorized';
    let modified = false;
    records.forEach(record => {
        if (!record || !record.id) return;
        if (normalized === 'uncategorized') {
            if (assignments[record.id]) {
                delete assignments[record.id];
                modified = true;
            }
        } else if (assignments[record.id] !== normalized) {
            assignments[record.id] = normalized;
            modified = true;
        }
    });
    if (modified) {
        saveFolderAssignments(assignments);
    }
}

/**
 * 移除记录的文件夹分配
 * @param {string} recordId - 记录 ID
 */
export function removeFolderAssignmentForRecord(recordId) {
    if (!recordId) return;
    const assignments = loadFolderAssignments();
    if (assignments && assignments[recordId]) {
        delete assignments[recordId];
        saveFolderAssignments(assignments);
    }
}
