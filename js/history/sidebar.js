/**
 * @file js/history/sidebar.js
 * @description 侧边栏历史记录快捷访问
 */

import { showHistoryDetail } from './actions.js';

/** 刷新回调 */
let refreshCallback = null;

/**
 * 设置刷新回调
 * @param {Function} callback - 回调函数
 */
export function setRefreshCallback(callback) {
    refreshCallback = callback;
}

/**
 * 渲染侧边栏快捷访问列表
 */
export async function renderSidebarQuickAccess() {
    const quickListEl = document.getElementById('sidebarHistoryQuickList');
    if (!quickListEl) return;

    const clearQuickList = () => {
        while (quickListEl.firstChild) quickListEl.removeChild(quickListEl.firstChild);
    };

    try {
        const results = await window.getAllResultsFromDB();
        if (!results || !Array.isArray(results) || results.length === 0) {
            clearQuickList();
            const empty = document.createElement('div');
            empty.className = 'px-3 py-2 text-xs text-slate-400 text-center';
            empty.textContent = '暂无记录';
            quickListEl.appendChild(empty);
            return;
        }

        // 按时间倒序取前 5 条
        const recent = results.slice().sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 5);

        clearQuickList();
        recent.forEach((record) => {
            const recordId = record && record.id != null ? String(record.id) : '';
            if (!recordId) return;

            const displayName = record && record.name ? String(record.name) : '未命名文档';
            const timeObj = new Date(record && record.time ? record.time : Date.now());
            const timeOk = !Number.isNaN(timeObj.getTime());
            const timeStr = timeOk
                ? `${timeObj.getMonth() + 1}/${timeObj.getDate()} ${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`
                : '';

            const item = document.createElement('div');
            item.className = 'group flex items-center gap-2 px-2 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer rounded-md mx-2 mb-0.5';
            item.title = timeOk ? `${displayName}\n${timeObj.toLocaleString()}` : displayName;
            item.addEventListener('click', () => showHistoryDetail(recordId));

            const icon = document.createElement('iconify-icon');
            icon.setAttribute('icon', 'carbon:document');
            icon.setAttribute('width', '14');
            icon.className = 'flex-shrink-0 text-slate-400 group-hover:text-slate-500 transition-colors';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'truncate flex-1';
            nameSpan.textContent = displayName;

            const timeSpan = document.createElement('span');
            timeSpan.className = 'text-[10px] text-slate-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity';
            timeSpan.textContent = timeStr;

            item.appendChild(icon);
            item.appendChild(nameSpan);
            item.appendChild(timeSpan);
            quickListEl.appendChild(item);
        });

    } catch (e) {
        console.error('Failed to render sidebar history:', e);
        clearQuickList();
        const fail = document.createElement('div');
        fail.className = 'px-3 py-2 text-xs text-red-400 text-center';
        fail.textContent = '加载失败';
        quickListEl.appendChild(fail);
    }
}

/**
 * 初始化侧边栏历史记录
 * @param {Function} openHistoryPanel - 打开历史面板的函数
 * @returns {Function} 刷新函数
 */
export function initSidebarHistory(openHistoryPanel) {
    const mainBtn = document.getElementById('sidebarHistoryMainBtn');
    const toggleBtn = document.getElementById('sidebarHistoryToggleBtn');
    const quickList = document.getElementById('sidebarHistoryQuickList');
    const chevron = document.getElementById('sidebarHistoryChevron');

    // 左侧主按钮：直接打开完整历史面板
    if (mainBtn) {
        mainBtn.addEventListener('click', openHistoryPanel);
    }

    // 右侧切换按钮：展开/收起快捷列表
    if (toggleBtn && quickList) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // 当前是否隐藏
            const isHidden = quickList.classList.contains('hidden');
            // 切换显示状态
            quickList.classList.toggle('hidden', !isHidden);

            // 更新图标方向：展开时旋转90度向下
            if (chevron) {
                chevron.classList.toggle('rotate-90', isHidden);
            }

            // 保存展开状态到 localStorage
            localStorage.setItem('pbx_history_expanded', isHidden ? 'true' : 'false');

            // 如果是展开操作，刷新数据
            if (isHidden) {
                renderSidebarQuickAccess();
            }
        });
    }

    // 从 localStorage 恢复历史记录展开状态
    const isExpanded = localStorage.getItem('pbx_history_expanded') === 'true';
    if (isExpanded && quickList && chevron) {
        quickList.classList.remove('hidden');
        chevron.classList.add('rotate-90');
        renderSidebarQuickAccess();
    } else {
        // 初始加载数据（保持折叠状态）
        renderSidebarQuickAccess();
    }

    // 返回刷新函数
    return renderSidebarQuickAccess;
}

/**
 * 刷新侧边栏历史记录
 */
export function refreshSidebarHistory() {
    if (typeof refreshCallback === 'function') {
        return refreshCallback();
    }
    return renderSidebarQuickAccess();
}
