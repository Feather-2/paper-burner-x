// js/history.js

// =====================
// 历史记录面板相关逻辑
// =====================

/**
 * 当 HTML 文档完全加载并解析完成后，执行此函数。
 * 主要负责初始化历史记录面板的用户交互：
 *  - 为"显示历史"按钮绑定点击事件，用于打开历史面板并渲染历史列表。
 *  - 为"关闭历史面板"按钮绑定点击事件。
 *  - 为"清空历史记录"按钮绑定点击事件，并在用户确认后清空所有历史数据并刷新列表。
 */
document.addEventListener('DOMContentLoaded', function() {
    const REQUIRED_CLEAR_PHRASE = '确定删除';

    // --------------------------------------------------
    // 侧边栏快捷历史记录逻辑
    // --------------------------------------------------
    async function renderSidebarQuickAccess() {
        const quickListEl = document.getElementById('sidebarHistoryQuickList');
        if (!quickListEl) return;

        try {
            // 假设 getAllResultsFromDB 是全局可用的 (在 storage.js 中定义)
            const results = await window.getAllResultsFromDB();
            if (!results || !Array.isArray(results) || results.length === 0) {
                quickListEl.innerHTML = '<div class="px-3 py-2 text-xs text-slate-400 text-center">暂无记录</div>';
                return;
            }

            // 按时间倒序取前 5 条
            const recent = results.slice().sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 5);

            quickListEl.innerHTML = recent.map(record => {
                const safeId = escapeAttr(record.id);
                const name = escapeHtml(record.name || '未命名文档');
                // 简短时间格式: MM/DD HH:mm
                const timeObj = new Date(record.time);
                const timeStr = `${timeObj.getMonth() + 1}/${timeObj.getDate()} ${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`;

                return `
                    <div class="group flex items-center gap-2 px-2 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer rounded-md mx-2 mb-0.5" onclick="showHistoryDetail('${safeId}')" title="${name}\n${timeObj.toLocaleString()}">
                        <iconify-icon icon="carbon:document" width="14" class="flex-shrink-0 text-slate-400 group-hover:text-slate-500 transition-colors"></iconify-icon>
                        <span class="truncate flex-1">${name}</span>
                        <span class="text-[10px] text-slate-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">${timeStr}</span>
                    </div>
                `;
            }).join('');

        } catch (e) {
            console.error('Failed to render sidebar history:', e);
            quickListEl.innerHTML = '<div class="px-3 py-2 text-xs text-red-400 text-center">加载失败</div>';
        }
    }

    function initSidebarHistory() {
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

        // 暴露给全局以便其他模块调用刷新
        window.refreshSidebarHistory = renderSidebarQuickAccess;
    }

    // 显示历史面板并渲染历史列表
    async function openHistoryPanel() {
        const panel = document.getElementById('historyPanel');
        if (panel) panel.classList.remove('hidden');
        await renderHistoryList();
    }

    // 初始化侧边栏历史
    initSidebarHistory();

    const sidebarHistoryBtn = document.getElementById('sidebarHistoryBtn');
    if (sidebarHistoryBtn) {
        sidebarHistoryBtn.addEventListener('click', openHistoryPanel);
    }
    const mobileHistoryBtn = document.getElementById('mobileHistoryBtn');
    if (mobileHistoryBtn) {
        mobileHistoryBtn.addEventListener('click', openHistoryPanel);
    }
    // 悬浮历史记录按钮
    const floatingHistoryBtn = document.getElementById('floatingHistoryBtn');
    if (floatingHistoryBtn) {
        floatingHistoryBtn.addEventListener('click', openHistoryPanel);
    }
    // 关闭历史面板
    document.getElementById('closeHistoryPanel').onclick = function() {
        document.getElementById('historyPanel').classList.add('hidden');
    };
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    const historyClearModal = document.getElementById('historyClearConfirmModal');
    const historyClearStep1 = document.getElementById('historyClearStep1');
    const historyClearStep1Message = document.getElementById('historyClearStep1Message');
    const historyClearStep2 = document.getElementById('historyClearStep2');
    const historyClearStep3 = document.getElementById('historyClearStep3');
    const historyClearFinalMessage = document.getElementById('historyClearFinalMessage');
    const historyClearPhraseInput = document.getElementById('historyClearPhraseInput');
    const historyClearCancelBtn = document.getElementById('historyClearCancelBtn');
    const historyClearCloseBtn = document.getElementById('historyClearCloseBtn');
    const historyClearStep1Next = document.getElementById('historyClearStep1Next');
    const historyClearStep2Next = document.getElementById('historyClearStep2Next');
    const historyClearStep2Back = document.getElementById('historyClearStep2Back');
    const historyClearStep3Back = document.getElementById('historyClearStep3Back');
    const historyClearExecute = document.getElementById('historyClearExecute');

    let currentClearStep = 1;
    let historyClearMode = 'all';
    let pendingDeleteRecordId = null;
    let pendingDeleteRecordName = '';

    function updateHistoryClearContent() {
        if (historyClearStep1Message) {
            if (historyClearMode === 'record') {
                const displayName = pendingDeleteRecordName || '选中的记录';
                historyClearStep1Message.textContent = `即将删除历史记录“${displayName}”。请确认是否继续。`;
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

    function setHistoryClearStep(step) {
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

    function resetStep2State() {
        if (historyClearPhraseInput) {
            historyClearPhraseInput.value = '';
        }
        if (historyClearStep2Next) {
            historyClearStep2Next.disabled = true;
            historyClearStep2Next.classList.add('opacity-60', 'cursor-not-allowed');
        }
    }

    function openHistoryClearModal(mode = 'all', { recordId = null, recordName = '' } = {}) {
        historyClearMode = mode === 'record' ? 'record' : 'all';
        pendingDeleteRecordId = historyClearMode === 'record' ? recordId : null;
        pendingDeleteRecordName = historyClearMode === 'record' ? (recordName || '') : '';
        updateHistoryClearContent();
        if (!historyClearModal) {
            const targetLabel = pendingDeleteRecordName || '选中的记录';
            const fallbackConfirm = historyClearMode === 'record'
                ? `确定要删除历史记录“${targetLabel}”吗？此操作无法恢复。`
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

    function closeHistoryClearModal() {
        if (!historyClearModal) return;
        historyClearModal.classList.add('hidden');
        historyClearModal.classList.remove('flex');
        resetStep2State();
        setHistoryClearStep(1);
        historyClearMode = 'all';
        pendingDeleteRecordId = null;
        pendingDeleteRecordName = '';
    }

    async function performClearHistory() {
        if (historyClearMode === 'record') {
            if (pendingDeleteRecordId) {
                removeFolderAssignmentForRecord(pendingDeleteRecordId);
                await deleteResultFromDB(pendingDeleteRecordId);
                await renderHistoryList();
                if (typeof showNotification === 'function') {
                    showNotification('历史记录已删除。', 'success');
                }
            }
        } else {
            await clearAllResultsFromDB();
            clearFolderAssignments();
            historyUIState.activeFolder = 'all';
            historyUIState.searchQuery = '';
            historyUIState.batchSearch = {};
            historyUIState.batchSearchDraft = {};
            await renderHistoryList();
            if (typeof showNotification === 'function') {
                showNotification('历史记录已全部清空。', 'success');
            }
        }
        historyClearMode = 'all';
        pendingDeleteRecordId = null;
        pendingDeleteRecordName = '';
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.onclick = function() {
            openHistoryClearModal('all');
        };
    }

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

    const HISTORY_FOLDER_STORAGE_KEY = 'pbxHistoryFolders';
    const HISTORY_FOLDER_ASSIGNMENT_KEY = 'pbxHistoryFolderAssignments';
    const MAX_HISTORY_FOLDER_NAME = 40;
    const historyUIState = {
        activeFolder: 'all',
        searchQuery: '',
        batchSearch: {},
        batchSearchDraft: {}
    };

    let currentFolderAssignments = {};
    let currentFolderOptions = [];
    let currentUserFolderMap = new Map();

    const historySearchInput = document.getElementById('historySearchInput');
    const historyFolderSelectMobile = document.getElementById('historyFolderSelectMobile');
    if (historySearchInput) {
        historySearchInput.addEventListener('input', function(event) {
            historyUIState.searchQuery = event.target.value || '';
            renderHistoryList();
        });
    }
    if (historyFolderSelectMobile) {
        historyFolderSelectMobile.addEventListener('change', function(event) {
            const nextFolder = (event.target.value || 'all');
            historyUIState.activeFolder = nextFolder;
            renderHistoryList();
        });
    }

    const historyFolderListElement = document.getElementById('historyFolderList');
    if (historyFolderListElement) {
        historyFolderListElement.addEventListener('click', handleHistoryFolderAction);
    }

    const historyAddFolderBtn = document.getElementById('historyAddFolderBtn');
    const historyAddFolderBtnMobile = document.getElementById('historyAddFolderBtnMobile');

    function handleCreateFolder() {
        const name = prompt('请输入新的文件夹名称');
        if (name == null) return;
        const trimmed = name.trim();
        if (!trimmed) {
            showNotification && showNotification('文件夹名称不能为空。', 'warning');
            return;
        }
        if (trimmed.length > MAX_HISTORY_FOLDER_NAME) {
            showNotification && showNotification(`文件夹名称请控制在 ${MAX_HISTORY_FOLDER_NAME} 个字符以内。`, 'warning');
            return;
        }
        const userFolders = loadUserFolders();
        if (userFolders.some(f => (f.name || '').toLowerCase() === trimmed.toLowerCase())) {
            showNotification && showNotification('已存在同名文件夹。', 'warning');
            return;
        }
        const folderId = generateFolderId();
        userFolders.push({ id: folderId, name: trimmed, createdAt: Date.now() });
        saveUserFolders(userFolders);
        historyUIState.activeFolder = folderId;
        renderHistoryList();
        showNotification && showNotification(`已创建文件夹“${trimmed}”`, 'success');
    }

    if (historyAddFolderBtn) {
        historyAddFolderBtn.addEventListener('click', handleCreateFolder);
    }
    if (historyAddFolderBtnMobile) {
        historyAddFolderBtnMobile.addEventListener('click', handleCreateFolder);
    }

    const historyRenameFolderBtnMobile = document.getElementById('historyRenameFolderBtnMobile');
    const historyDeleteFolderBtnMobile = document.getElementById('historyDeleteFolderBtnMobile');
    if (historyRenameFolderBtnMobile) {
        historyRenameFolderBtnMobile.addEventListener('click', function() {
            const select = document.getElementById('historyFolderSelectMobile');
            const current = select ? (select.value || 'all') : historyUIState.activeFolder;
            if (current === 'all' || current === 'uncategorized') {
                showNotification && showNotification('系统文件夹无法执行该操作。', 'info');
                return;
            }
            renameUserFolder(current);
        });
    }
    if (historyDeleteFolderBtnMobile) {
        historyDeleteFolderBtnMobile.addEventListener('click', function() {
            const select = document.getElementById('historyFolderSelectMobile');
            const current = select ? (select.value || 'all') : historyUIState.activeFolder;
            if (current === 'all' || current === 'uncategorized') {
                showNotification && showNotification('系统文件夹无法执行该操作。', 'info');
                return;
            }
            deleteUserFolder(current);
        });
    }

    // ---------------------
    // 历史记录列表渲染
    // ---------------------
    /**
     * 从 IndexedDB 加载所有历史记录，并将其渲染到历史记录面板的列表中。
     *
     * 主要步骤:
     * 1. 获取用于显示历史列表的 DOM 元素 (`#historyList`)。
     * 2. 调用 `getAllResultsFromDB()` 从 IndexedDB 异步获取所有存储的处理结果。
     * 3. 检查结果：如果无历史记录，则在列表区域显示"暂无历史记录"的提示。
     * 4. 排序：将获取到的历史记录按处理时间 (`time` 字段) 降序排列 (最新的在前)。
     * 5. 生成 HTML：遍历排序后的结果数组，为每条记录生成一个 HTML 片段，
     *    包含文件名、删除按钮、时间戳、OCR 和翻译内容的摘要、以及"查看详情"和"下载"按钮。
     *    每个按钮都绑定了相应的 `window` 上的全局函数 (如 `deleteHistoryRecord`, `showHistoryDetail`, `downloadHistoryRecord`)。
     * 6. 更新 DOM：将生成的 HTML 字符串集合设置为 `#historyList` 的 `innerHTML`。
     *
     * @async
     * @private
     * @returns {Promise<void>} 当列表渲染完成时解决。
     */
    async function renderHistoryList() {
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

        if (historySearchInput && historySearchInput.value !== historyUIState.searchQuery) {
            historySearchInput.value = historyUIState.searchQuery;
        }

        const results = await getAllResultsFromDB();
        const assignments = loadFolderAssignments();
        const userFolders = loadUserFolders();

        currentFolderAssignments = assignments;
        currentUserFolderMap = new Map(userFolders.map(folder => [folder.id, folder]));
        currentFolderOptions = buildAssignableFolderOptions(currentUserFolderMap);

        renderHistoryFolders(Array.isArray(results) ? results : [], assignments, userFolders);

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

    function loadUserFolders() {
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

    function saveUserFolders(folders) {
        try {
            const compact = Array.isArray(folders) ? folders.slice() : [];
            localStorage.setItem(HISTORY_FOLDER_STORAGE_KEY, JSON.stringify(compact));
        } catch (error) {
            console.warn('保存历史文件夹失败:', error);
        }
    }

    function loadFolderAssignments() {
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

    function saveFolderAssignments(assignments) {
        try {
            localStorage.setItem(HISTORY_FOLDER_ASSIGNMENT_KEY, JSON.stringify(assignments || {}));
        } catch (error) {
            console.warn('保存历史文件夹分配失败:', error);
        }
    }

    function clearFolderAssignments() {
        try {
            localStorage.removeItem(HISTORY_FOLDER_ASSIGNMENT_KEY);
        } catch (error) {
            console.warn('清除历史文件夹分配失败:', error);
        }
    }

    function generateFolderId() {
        return 'folder-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    function buildAssignableFolderOptions(folderMap) {
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

    function resolveRecordFolder(recordId, assignmentsOverride) {
        if (!recordId) return 'uncategorized';
        const assignments = assignmentsOverride || currentFolderAssignments || {};
        const assigned = assignments[recordId];
        if (!assigned || assigned === 'uncategorized') {
            return 'uncategorized';
        }
        return folderExists(assigned) ? assigned : 'uncategorized';
    }

    function folderExists(folderId) {
        if (!folderId) return false;
        if (folderId === 'all' || folderId === 'uncategorized') return true;
        if (currentUserFolderMap && currentUserFolderMap.has(folderId)) return true;
        const userFolders = loadUserFolders();
        return userFolders.some(folder => folder && folder.id === folderId);
    }

    function recordMatchesQuery(record, queryLower) {
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

    function renderFolderSelect({ scope, ownerId, selectedId, isMixed }) {
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
        const mixedOption = isMixed ? '<option value="" selected>（多个文件夹）</option>' : '';
        return `
            <select class="${selectClasses}" data-history-folder-select="${escapeAttr(normalizedScope)}" data-owner-id="${escapeAttr(normalizedOwner)}" aria-label="${escapeAttr(ariaLabel)}">
                ${mixedOption}
                ${optionHtml}
            </select>
        `;
    }

    function renderHistoryFolders(allRecords, assignments, userFolders) {
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
        fragments.push(renderFolderListItem({ id: 'all', name: '全部记录', count: counts.get('all') || 0, system: true }));
        fragments.push(renderFolderListItem({ id: 'uncategorized', name: '未分组', count: counts.get('uncategorized') || 0, system: true }));

        const sortedUserFolders = (userFolders || []).slice().sort((a, b) => {
            return (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
        });

        sortedUserFolders.forEach(folder => {
            fragments.push(renderFolderListItem({
                id: folder.id,
                name: folder.name,
                count: counts.get(folder.id) || 0,
                system: false
            }));
        });

        if (listEl) {
            listEl.innerHTML = fragments.join('') || '<div class="text-xs text-gray-400 py-4 text-center">暂无文件夹</div>';
        }

        if (mobileSelect) {
            const opts = [];
            // 系统选项
            opts.push({ id: 'all', name: '全部记录', count: counts.get('all') || 0 });
            opts.push({ id: 'uncategorized', name: '未分组', count: counts.get('uncategorized') || 0 });
            // 用户文件夹（按名称排序）
            const sortedUserFolders = (userFolders || []).slice().sort((a, b) => {
                return (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN');
            });
            sortedUserFolders.forEach(folder => {
                opts.push({ id: folder.id, name: folder.name, count: counts.get(folder.id) || 0 });
            });
            mobileSelect.innerHTML = opts.map(opt => {
                const selected = historyUIState.activeFolder === opt.id ? 'selected' : '';
                return `<option value="${escapeAttr(opt.id)}" ${selected}>${escapeHtml(opt.name)} (${opt.count})</option>`;
            }).join('');
        }
    }

    function renderFolderListItem({ id, name, count, system }) {
        const isActive = historyUIState.activeFolder === id;
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
            showNotification && showNotification('系统文件夹无法执行该操作。', 'info');
            return;
        }
        if (action === 'rename') {
            renameUserFolder(folderId);
            return;
        }
        if (action === 'delete') {
            deleteUserFolder(folderId);
            return;
        }
    }

    function renameUserFolder(folderId) {
        if (!folderId || folderId === 'all' || folderId === 'uncategorized') {
            showNotification && showNotification('系统文件夹无法执行该操作。', 'info');
            return;
        }
        const userFolders = loadUserFolders();
        const target = userFolders.find(folder => folder.id === folderId);
        if (!target) {
            showNotification && showNotification('未找到目标文件夹。', 'warning');
            return;
        }
        const newName = prompt('修改文件夹名称', target.name || '');
        if (newName == null) return;
        const trimmed = newName.trim();
        if (!trimmed) {
            showNotification && showNotification('文件夹名称不能为空。', 'warning');
            return;
        }
        if (trimmed.length > MAX_HISTORY_FOLDER_NAME) {
            showNotification && showNotification(`文件夹名称请控制在 ${MAX_HISTORY_FOLDER_NAME} 个字符以内。`, 'warning');
            return;
        }
        const duplicate = userFolders.some(folder => folder.id !== folderId && (folder.name || '').toLowerCase() === trimmed.toLowerCase());
        if (duplicate) {
            showNotification && showNotification('已存在同名文件夹。', 'warning');
            return;
        }
        target.name = trimmed;
        saveUserFolders(userFolders);
        showNotification && showNotification('文件夹名称已更新。', 'success');
        renderHistoryList();
    }

    function deleteUserFolder(folderId) {
        if (!folderId || folderId === 'all' || folderId === 'uncategorized') {
            showNotification && showNotification('系统文件夹无法执行该操作。', 'info');
            return;
        }
        const userFolders = loadUserFolders();
        const target = userFolders.find(folder => folder.id === folderId);
        if (!target) {
            showNotification && showNotification('未找到目标文件夹。', 'warning');
            return;
        }
        if (!confirm(`确定要删除文件夹“${target.name}”吗？文件夹内的记录将回到“未分组”。`)) {
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
        if (historyUIState.activeFolder === folderId) {
            historyUIState.activeFolder = 'all';
        }
        showNotification && showNotification('文件夹已删除。', 'info');
        renderHistoryList();
    }

    function assignRecordToFolder(recordId, folderId) {
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

    function assignBatchToFolder(batchId, folderId) {
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

    function removeFolderAssignmentForRecord(recordId) {
        if (!recordId) return;
        const assignments = loadFolderAssignments();
        if (assignments && assignments[recordId]) {
            delete assignments[recordId];
            saveFolderAssignments(assignments);
        }
    }

    function handleHistoryListInput(event) {
        const target = event.target;
        if (!target) return;
        if (target.hasAttribute('data-history-batch-search-input')) {
            const batchId = target.getAttribute('data-batch-id');
            if (!batchId) return;
            historyUIState.batchSearchDraft[batchId] = target.value || '';
        }
    }

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

    const DEFAULT_EXPORT_TEMPLATE = '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}';
    const DEFAULT_EXPORT_FORMATS = ['original', 'markdown'];
    const SUPPORTED_EXPORT_FORMATS = ['original', 'markdown', 'html', 'docx'];
    const TEXTUAL_ORIGINAL_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex', 'html', 'htm']);
    const PACKAGING_OPTIONS = {
        preserve: 'preserve',
        flat: 'flat'
    };
    const ICON_BUTTON_CLASS = 'inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 bg-white text-gray-500 hover:text-blue-600 hover:border-blue-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1';
    const ICON_BUTTON_DANGER_EXTRA = 'hover:text-red-500 hover:border-red-200 focus:ring-red-300';
    const ICON_BUTTON_SUCCESS_EXTRA = 'hover:text-emerald-500 hover:border-emerald-200 focus:ring-emerald-300';

    const historyListElement = document.getElementById('historyList');
    if (historyListElement) {
        historyListElement.addEventListener('click', handleHistoryListAction);
        historyListElement.addEventListener('change', handleHistoryListChange);
        historyListElement.addEventListener('input', handleHistoryListInput);
        historyListElement.addEventListener('keydown', handleHistoryListKeydown);
    }

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
        const firstFolderId = folderIds.length > 0 ? folderIds[0] : resolveRecordFolder(representative.id, currentFolderAssignments);
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
                    <span class="text-xs text-gray-500">${timeLabel}${targetLang ? ` · 语言：${escapeHtml(targetLang)}` : ''}</span>
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

    function renderHistoryRecordItem(record, options = {}) {
        const safeId = sanitizeId(record.id || 'record');
        const withinBatch = !!options.withinBatch;
        const status = analyzeRecordStatus(record);
        const statusBadge = buildStatusBadge(status);
        const ocrSnippet = buildSnippetText(record.ocr);
        const translationSnippet = buildSnippetText(record.translation);
        const timeLabel = formatDisplayTime(record.time);
        // 新增：模型信息（兼容旧记录无该字段情况）
        const ocrEngine = (record.ocrEngine || '').toLowerCase();
        const ocrLabel = ocrEngine === 'mistral' ? 'Mistral OCR' : ocrEngine === 'mineru' ? 'MinerU OCR' : ocrEngine === 'doc2x' ? 'Doc2X OCR' : '';
        const transName = record.translationModelName || 'none';
        let transLabel = '';
        if (transName === 'none') {
            transLabel = '未翻译';
        } else if (transName === 'custom') {
            // 显示自定义源站配置的“模型ID”（优先），若缺失则退回显示名称/自定义
            transLabel = record.translationModelId
                ? escapeHtml(record.translationModelId)
                : (record.translationModelCustomName ? escapeHtml(record.translationModelCustomName) : '自定义');
        } else {
            // 预设模型
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
        const folderId = resolveRecordFolder(record.id, currentFolderAssignments);
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
            <button type="button" class="${ICON_BUTTON_CLASS} ${ICON_BUTTON_SUCCESS_EXTRA}" onclick="downloadHistoryRecord('${escapedRecordId}')" aria-label="下载记录" title="下载记录">
                <iconify-icon icon="carbon:download" width="18"></iconify-icon>
            </button>`;
        const recordDisplayName = record.name || relativePathLabel || record.id || '历史记录';
        const escapedRecordNameAttr = escapeAttr(recordDisplayName);
        const deleteBtnHtml = withinBatch ? '' : `
            <button type="button" class="${ICON_BUTTON_CLASS} ${ICON_BUTTON_DANGER_EXTRA}" data-history-action="delete-record" data-record-id="${escapedRecordId}" data-record-name="${escapedRecordNameAttr}" aria-label="删除记录" title="删除记录">
                <iconify-icon icon="carbon:trash-can" width="18"></iconify-icon>
            </button>`;
        const startReadingBtnHtml = `
            <button type="button" class="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1" onclick="showHistoryDetail('${escapedRecordId}')">
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
                            ${timeLabel}${targetLang ? ` · 语言：${escapeHtml(targetLang)}` : ''}
                        </div>
                        ${(ocrLabel || (transLabel && transLabel !== '未翻译')) ? `
                        <div class="text-xs text-gray-500">
                            ${ocrLabel ? `OCR：${ocrLabel}` : ''}
                            ${(ocrLabel && (transLabel && transLabel !== '未翻译')) ? ' · ' : ''}
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
                    <button id="retry-failed-btn-${safeId}" onclick="retryTranslateRecord('${record.id}','failed')" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100 ${retryDisabled}">重试失败段</button>
                    <button id="retry-all-btn-${safeId}" onclick="retryTranslateRecord('${record.id}','all')" class="px-2 py-1 border border-gray-200 rounded hover:bg-gray-100">重新翻译全部</button>
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

    function analyzeRecordStatus(record) {
        // 标准分块统计
        const ocrChunks = Array.isArray(record.ocrChunks) ? record.ocrChunks : [];
        const translatedChunks = Array.isArray(record.translatedChunks) ? record.translatedChunks : [];
        if (ocrChunks.length > 0) {
            const total = ocrChunks.length;
            let failed = 0;
            for (let i = 0; i < total; i++) {
                const text = translatedChunks[i] || '';
                if (_isChunkFailed(text)) failed++;
            }
            const success = total - failed;
            return { total, success, failed, isStructured: false };
        }

        // 结构化翻译统计（无常规分块时）
        const meta = record && record.metadata ? record.metadata : {};
        const transList = Array.isArray(meta.translatedContentList) ? meta.translatedContentList : [];
        const supportsStructured = !!meta.supportsStructuredTranslation;
        if (supportsStructured && transList.length > 0) {
            const total = transList.length;
            // 统一的字段标准化函数（处理字符串、数组等）
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
                // 只统计真正失败的项（空译文），忽略"译文与原文相同"的项
                if (it && it.failed === true) {
                    // 如果有 failureReason 字段，只统计 'empty' 类型的失败
                    if (it.failureReason) {
                        if (it.failureReason === 'empty') {
                            failed++;
                        }
                        // failureReason === 'unchanged' 不统计为失败
                    } else {
                        // 旧数据没有 failureReason 字段，需要检查是否真的失败（空译文）
                        // 只有原文不为空且译文为空时才计入失败，译文与原文相同不算失败
                        const orig = Array.isArray(meta.contentListJson) ? meta.contentListJson[i] : null;
                        if (orig) {
                            let shouldCountAsFailed = false;
                            if (orig.type === 'text') {
                                const a = _norm(orig.text);
                                const b = _norm(it.text);
                                shouldCountAsFailed = a && !b;  // 原文不为空且译文为空才算失败
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
                        // 如果没有原文数据，不统计（无法判断）
                    }
                }
            }
            // 若元数据提供了失败项，需要过滤掉"unchanged"类型的
            if (Array.isArray(meta.failedStructuredItems) && meta.failedStructuredItems.length > 0) {
                // 检查 failedStructuredItems 中每个项，过滤掉"译文与原文相同"的项
                let actualFailed = 0;
                for (const failedItem of meta.failedStructuredItems) {
                    const idx = failedItem.index;
                    if (idx >= 0 && idx < transList.length) {
                        const item = transList[idx];
                        // 如果有 failureReason，只统计 'empty' 类型
                        if (item && item.failureReason) {
                            if (item.failureReason === 'empty') {
                                actualFailed++;
                            }
                        } else {
                            // 没有 failureReason，检查是否真的失败（空译文）
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
                            // 如果没有原文或译文数据，不统计（无法判断）
                        }
                    }
                    // 如果索引超出范围，不统计（无法判断）
                }
                failed = actualFailed;
            }
            // 回退：若未统计到失败但可对比原始内容，则尝试检测空译文（仅 text/image/table）
            // 注意：只统计译文为空的情况，译文与原文相同是正常行为
            if (failed === 0 && Array.isArray(meta.contentListJson)) {
                const origList = meta.contentListJson;
                const minLen = Math.min(origList.length, transList.length);
                for (let i = 0; i < minLen; i++) {
                    const o = origList[i] || {};
                    const t = transList[i] || {};
                    if (o.type === 'text') {
                        const a = _norm(o.text);
                        const b = _norm(t.text);
                        if (a && !b) failed++;  // 移除 a === b 判断
                    } else if (o.type === 'image') {
                        const a = _norm(o.image_caption);
                        const b = _norm(t.image_caption);
                        if (a && !b) failed++;  // 移除 a === b 判断
                    } else if (o.type === 'table') {
                        const a = _norm(o.table_caption);
                        const b = _norm(t.table_caption);
                        if (a && !b) failed++;  // 移除 a === b 判断
                    }
                }
            }
            const success = Math.max(0, total - failed);
            return { total, success, failed, isStructured: true };
        }

        return { total: 0, success: 0, failed: 0, isStructured: !!supportsStructured };
    }

    function buildStatusBadge(status) {
        if (!status || status.total === 0) {
            return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-500">未分块</span>';
        }
        // 若没有任何成功块（0/total），改为“预览中，无翻译块”
        if (status.success === 0) {
            // 结构化翻译下，将提示文案替换为“PDF对照”
            if (status.isStructured) {
                return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700">PDF对照</span>';
            }
            return '<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">预览中，无翻译块</span>';
        }
        // 有成功也有失败 → 部分失败
        if (status.failed > 0) {
            return `<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700">部分失败 ${status.success}/${status.total}</span>`;
        }
        // 全部成功
        return `<span class="ml-2 inline-block text-[11px] px-2 py-0.5 rounded bg-green-100 text-green-700">完成 ${status.success}/${status.total}</span>`;
    }

    function buildSnippetText(text) {
        if (!text) return '无';
        const sanitized = text.replace(/\s+/g, ' ').trim();
        return sanitized.length > 80 ? `${escapeHtml(sanitized.slice(0, 80))}…` : escapeHtml(sanitized);
    }

    function formatDisplayTime(timeValue) {
        if (!timeValue) return '未知时间';
        try {
            const date = new Date(timeValue);
            if (Number.isNaN(date.getTime())) return '未知时间';
            return date.toLocaleString();
        } catch (e) {
            return '未知时间';
        }
    }

    function buildRelativePathLabel(record) {
        const rel = record.relativePath || (record.file && record.file.pbxRelativePath) || '';
        if (!rel) return '';
        return rel;
    }

    function sanitizeId(id) {
        return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function escapeHtml(str) {
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

    function escapeAttr(str) {
        return escapeHtml(str).replace(/"/g, '&quot;');
    }

    async function handleHistoryListAction(event) {
        const actionButton = event.target.closest('[data-history-action]');
        if (!actionButton) return;

        const action = actionButton.getAttribute('data-history-action');
        const targetId = actionButton.getAttribute('data-target');

        try {
            switch (action) {
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
                        showNotification && showNotification('请至少选择一种导出格式', 'warning');
                        break;
                    }
                    const recordCache = window.__historyRecordCache || {};
                    const record = recordCache[recordId];
                    if (!record) {
                        showNotification && showNotification('未找到历史记录数据', 'error');
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
                        showNotification && showNotification('请至少选择一种导出格式', 'warning');
                        break;
                    }
                    const batchCache = window.__historyBatchCache || {};
                    const records = batchCache[batchId];
                    if (!records || records.length === 0) {
                        showNotification && showNotification('未找到批量任务记录', 'error');
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
                    showNotification && showNotification('批量任务已删除', 'success');
                    break;
                }
                default:
                    break;
            }
        } catch (error) {
            console.error('历史记录操作失败:', error);
            showNotification && showNotification(`导出失败：${error && error.message ? error.message : error}`, 'error');
        }
    }

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
            if (target.value === PACKAGING_OPTIONS.flat) {
                zipInput.checked = true;
                zipInput.disabled = true;
            } else {
                zipInput.disabled = false;
            }
        }
    }

    function togglePanelVisibility(panel) {
        if (!panel) return;
        if (panel.classList.contains('hidden')) {
            // 隐藏同级已展开的配置面板
            const siblings = panel.parentElement ? panel.parentElement.querySelectorAll('[data-config-scope]') : [];
            siblings.forEach(el => { if (el !== panel) el.classList.add('hidden'); });
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    }

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
            if (typeof showNotification === 'function') {
                showNotification('已自动保留“原格式”导出。', 'info');
            }
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

    async function performHistoryExport(records, config, context = {}) {
        if (!Array.isArray(records) || records.length === 0) return;
        if (!config || config.formats.length === 0) return;

        const exporter = window.PBXHistoryExporter;
        if (!exporter) {
            showNotification && showNotification('导出模块尚未加载完成', 'error');
            return;
        }

        const structure = config.structure || PACKAGING_OPTIONS.preserve;
        const enforceZip = structure === PACKAGING_OPTIONS.flat;
        const shouldZip = enforceZip || config.zip || records.length > 1 || config.formats.length > 1;
        if (shouldZip && typeof JSZip === 'undefined') {
            showNotification && showNotification('JSZip 未加载，无法打包成 ZIP', 'error');
            return;
        }

        const ensureExporter = (format, shouldZip) => {
            if (format === 'pdf' && shouldZip) {
                showNotification && showNotification('PDF 导出目前不支持打包为 ZIP，请单独导出或选择其他格式。', 'warning');
                return null;
            }
            const handler = resolveFormatHandler(format, exporter);
            if (!handler || !handler.exporterFn) {
                showNotification && showNotification(`暂不支持导出 ${format.toUpperCase()} 格式`, 'warning');
                return null;
            }
            return handler;
        };

        const assets = [];
        const generatedPaths = new Set();
        for (const record of records) {
            const variants = [];
            const hasTranslation = record.translation && record.translation.trim();
            if (hasTranslation) {
                variants.push('translation');
            }
            const includeOriginal = !hasTranslation || structure === PACKAGING_OPTIONS.flat || shouldZip;
            if (includeOriginal) {
                variants.push('original');
            }
            if (variants.length === 0) {
                variants.push('original');
            }
            for (const variant of variants) {
                const payload = buildExportPayloadFromRecord(record, variant);
                if (!payload && format !== 'original') continue;
                for (const format of config.formats) {
                    if (!SUPPORTED_EXPORT_FORMATS.includes(format)) continue;

                    if (format === 'original') {
                        if (variant === 'translation' && !TEXTUAL_ORIGINAL_EXTENSIONS.has((record.originalExtension || record.fileType || '').toLowerCase())) {
                            continue;
                        }
                        const originalAsset = buildOriginalAsset(record);
                        if (!originalAsset) {
                            showNotification && showNotification('无法导出原始格式：缺少原始内容。', 'warning');
                            continue;
                        }
                        if (variant === 'original') {
                            const relativeDirOriginal = computeRelativeDirectory(record, 'original', format, structure);
                            const sanitizedDirOriginal = relativeDirOriginal ? sanitizePath(relativeDirOriginal) : '';
                            const originalName = determineOriginalFileName(record, originalAsset.extension);
                            const uniqueOriginalName = ensureUniqueFileName(originalName, sanitizedDirOriginal, generatedPaths, 'original');
                            if (!shouldZip) {
                                saveAs(originalAsset.blob, uniqueOriginalName);
                            } else {
                                assets.push({ blob: originalAsset.blob, fileName: uniqueOriginalName, relativeDir: sanitizedDirOriginal });
                            }
                        } else if (variant === 'translation') {
                            const translatedAsset = buildOriginalTranslationAsset(record, originalAsset.extension);
                            if (!translatedAsset) continue;
                            const contextForTemplate = buildTemplateContext(record, 'original', 'translation');
                            const desiredName = applyNamingTemplate(config.template, contextForTemplate);
                            const fileName = ensureFileName(desiredName, originalAsset.extension || 'txt');
                            const relativeDir = computeRelativeDirectory(record, 'translation', format, structure);
                            const sanitizedDir = relativeDir ? sanitizePath(relativeDir) : '';
                            const uniqueName = ensureUniqueFileName(fileName, sanitizedDir, generatedPaths, 'original-translation');
                            if (!shouldZip) {
                                saveAs(translatedAsset.blob, uniqueName);
                            } else {
                                assets.push({ blob: translatedAsset.blob, fileName: uniqueName, relativeDir: sanitizedDir });
                            }
                        }
                        continue;
                    }

                    const handler = ensureExporter(format, shouldZip);
                    if (!handler) continue;

                    if (format === 'pdf' && shouldZip) {
                        continue; // 已提示
                    }

                    if (!payload) continue;
                    const contextForTemplate = buildTemplateContext(record, format, variant);
                    const desiredName = applyNamingTemplate(config.template, contextForTemplate);
                    const fileName = ensureFileName(desiredName, handler.extension);
                    const options = shouldZip ? { returnBlob: true, fileName } : { returnBlob: true, fileName };

                    try {
                        const result = await handler.exporterFn(payload, options);
                        if (!result) continue;
                        const blob = result.blob || (result.content ? new Blob([result.content], { type: result.mime || 'application/octet-stream' }) : null);
                        if (!blob) continue;

                        const relativeDir = computeRelativeDirectory(record, variant, format, structure);
                        const sanitizedDir = relativeDir ? sanitizePath(relativeDir) : '';
                        const uniqueName = ensureUniqueFileName(fileName, sanitizedDir, generatedPaths, variant);
                        if (!shouldZip) {
                            saveAs(blob, uniqueName);
                            continue;
                        }

                        assets.push({ blob, fileName: uniqueName, relativeDir: sanitizedDir });
                    } catch (error) {
                        console.error('导出失败:', error);
                        showNotification && showNotification(`导出 ${format.toUpperCase()} (${variant === 'original' ? '原文' : '译文'}) 失败：${error.message || error}`, 'error');
                    }
                }
            }
        }

        if (!shouldZip) {
            return;
        }

        const filteredAssets = assets.filter(asset => asset && asset.blob);
        if (!filteredAssets.length) {
            showNotification && showNotification('没有可打包的导出文件', 'warning');
            return;
        }

        const zip = new JSZip();
        filteredAssets.forEach(asset => {
            const dir = asset.relativeDir ? asset.relativeDir : '';
            const path = dir ? `${dir}/${asset.fileName}` : asset.fileName;
            zip.file(path, asset.blob);
        });

        const archiveName = buildArchiveName(records, config, context);
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        saveAs(zipBlob, archiveName);
        showNotification && showNotification(`已生成 ZIP (${filteredAssets.length} 个文件)`, 'success');
    }

    function resolveFormatHandler(format, exporter) {
        switch (format) {
            case 'markdown':
                return { extension: 'md', exporterFn: exporter.exportAsMarkdown };
            case 'html':
                return { extension: 'html', exporterFn: exporter.exportAsHtml };
            case 'docx':
                return { extension: 'docx', exporterFn: exporter.exportAsDocx };
            case 'pdf':
                return { extension: 'pdf', exporterFn: exporter.exportAsPdf };
            default:
                return { extension: format, exporterFn: null };
        }
    }

    function buildExportPayloadFromRecord(record, variant = 'auto') {
        if (!record) return null;
        const data = {
            id: record.id,
            name: record.name,
            time: record.time,
            ocr: record.ocr || '',
            translation: record.translation || '',
            images: Array.isArray(record.images) ? record.images : [],
            ocrChunks: Array.isArray(record.ocrChunks) ? record.ocrChunks : [],
            translatedChunks: Array.isArray(record.translatedChunks) ? record.translatedChunks : []
        };
        let mode = 'ocr';
        if (variant === 'translation') {
            if (!data.translation || !data.translation.trim()) return null;
            mode = 'translation';
        } else if (variant === 'original') {
            if (!data.ocr || !data.ocr.trim()) return null;
            mode = 'ocr';
        } else {
            mode = data.translation ? 'translation' : 'ocr';
            if (mode === 'translation' && (!data.translation || !data.translation.trim())) {
                mode = 'ocr';
            }
        }
        const exporter = window.PBXHistoryExporter;
        if (!exporter || typeof exporter.preparePayload !== 'function') {
            return null;
        }
        const payload = exporter.preparePayload(mode, data);
        if (payload) {
            payload.customFileName = record.name;
        }
        return payload;
    }

    function buildTemplateContext(record, format, variant = 'translation') {
        const relativePath = normalizeRelativePath(record);
        const originalName = relativePath ? relativePath.split('/').pop() : (record.name || 'document');
        let originalType;
        if (format === 'markdown') {
            originalType = 'md';
        } else if (format === 'html') {
            originalType = 'html';
        } else if (format === 'docx') {
            originalType = 'docx';
        } else if (format === 'pdf') {
            originalType = 'pdf';
        } else if (format === 'original') {
            originalType = (record.originalExtension || record.fileType || 'txt').replace(/[^a-zA-Z0-9_-]/g, '') || 'txt';
        } else {
            originalType = format.replace(/[^a-zA-Z0-9_-]/g, '') || 'txt';
        }
        return {
            originalName,
            originalType,
            outputLanguage: record.batchOutputLanguage || record.targetLanguage || '',
            processingTime: record.processedAt || record.time,
            batchId: record.batchId || null,
            variant: variant === 'original' ? 'original' : 'translation'
        };
    }

    function applyNamingTemplate(template, context) {
        const safeTemplate = template || DEFAULT_EXPORT_TEMPLATE;
        return safeTemplate.replace(/\{([^{}]+)\}/g, (match, token) => {
            const [key, modifier] = token.split(':');
            switch (key) {
                case 'original_name':
                    return sanitizeFileName(context.originalName || 'document');
                case 'original_type':
                    return (context.originalType || '').replace(/[^a-zA-Z0-9_-]/g, '');
                case 'output_language':
                    return sanitizeFileName(context.outputLanguage || '');
                case 'processing_time':
                    return formatProcessingTime(context.processingTime, modifier);
                case 'batch_id':
                    return sanitizeFileName(context.batchId || '');
                case 'variant':
                    return sanitizeFileName(context.variant || '');
                default:
                    return '';
            }
        });
    }

    function formatProcessingTime(timeValue, pattern = 'YYYYMMDD-HHmmss') {
        if (!timeValue) return '';
        const date = new Date(timeValue);
        if (Number.isNaN(date.getTime())) return '';
        const pad = num => String(num).padStart(2, '0');
        return pattern
            .replace(/YYYY/g, date.getFullYear())
            .replace(/MM/g, pad(date.getMonth() + 1))
            .replace(/DD/g, pad(date.getDate()))
            .replace(/HH/g, pad(date.getHours()))
            .replace(/mm/g, pad(date.getMinutes()))
            .replace(/ss/g, pad(date.getSeconds()));
    }

    function ensureFileName(baseName, extension) {
        const sanitized = sanitizeFileName(baseName || 'document');
        const ext = (extension || '').replace(/[^a-zA-Z0-9]/g, '');
        if (!ext) return sanitized;
        if (sanitized.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
            return sanitized;
        }
        return `${sanitized}.${ext}`;
    }

    function sanitizeFileName(name) {
        return (name || 'document').replace(/[\\/:*?"<>|]/g, '_');
    }

    function sanitizePath(path) {
        return (path || '').split('/').map(segment => sanitizeFileName(segment)).filter(Boolean).join('/');
    }

    function ensureFileExtension(baseName, extension) {
        const sanitized = sanitizeFileName(baseName || 'document');
        const ext = (extension || '').replace(/[^a-zA-Z0-9]/g, '');
        if (!ext) return sanitized;
        if (sanitized.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
            return sanitized;
        }
        return `${sanitized}.${ext}`;
    }

    function normalizeRelativePath(record) {
        const rel = record.relativePath || '';
        if (!rel) {
            return (record.name || '').replace(/\\/g, '/');
        }
        return rel.replace(/\\/g, '/');
    }

    function normalizeRelativeDir(record) {
        const rel = normalizeRelativePath(record);
        if (!rel) return '';
        const lastSlash = rel.lastIndexOf('/');
        if (lastSlash === -1) return '';
        return sanitizePath(rel.slice(0, lastSlash));
    }

    function computeRelativeDirectory(record, variant, format, structure) {
        if (structure === PACKAGING_OPTIONS.flat) {
            const variantDir = variant === 'original' ? 'original' : 'translation';
            let formatDir;
            if (format === 'original') {
                formatDir = (record.originalExtension || record.fileType || 'raw').toLowerCase();
            } else {
                formatDir = format.toLowerCase();
            }
            return `${variantDir}/${sanitizeFileName(formatDir || 'raw')}`;
        }
        return normalizeRelativeDir(record);
    }

    function ensureUniqueFileName(fileName, dir, set, variant) {
        let uniqueName = fileName;
        let counter = 1;
        let key = `${dir}||${uniqueName}`;
        while (set.has(key)) {
            uniqueName = appendSuffix(fileName, counter++, variant);
            key = `${dir}||${uniqueName}`;
        }
        set.add(key);
        return uniqueName;
    }

    function appendSuffix(fileName, counter, variant) {
        let baseSuffix;
        if (variant === 'original') {
            baseSuffix = '_original';
        } else if (variant === 'original-translation') {
            baseSuffix = '_translated';
        } else {
            baseSuffix = '_translation';
        }
        const suffix = counter === 1 ? baseSuffix : `${baseSuffix}${counter}`;
        const idx = fileName.lastIndexOf('.');
        if (idx === -1) {
            return `${fileName}${suffix}`;
        }
        const name = fileName.slice(0, idx);
        const ext = fileName.slice(idx);
        return `${name}${suffix}${ext}`;
    }

    function buildOriginalAsset(record) {
        if (!record) return null;
        const extension = (record.originalExtension || record.fileType || 'txt').toLowerCase();
        if (record.originalEncoding === 'text' && typeof record.originalContent === 'string') {
            const mime = guessMimeType(extension, true);
            return {
                blob: new Blob([record.originalContent], { type: `${mime};charset=utf-8` }),
                extension
            };
        }
        if (record.originalEncoding && record.originalEncoding !== 'text' && record.originalBinary) {
            const buffer = base64ToArrayBuffer(record.originalBinary);
            if (!buffer) return null;
            const mime = guessMimeType(extension, false);
            return {
                blob: new Blob([buffer], { type: mime }),
                extension
            };
        }
        return null;
    }

    function buildOriginalTranslationAsset(record, extension) {
        if (!record || !record.translation || !record.translation.trim()) {
            return null;
        }
        const lowered = (extension || '').toLowerCase();
        if (!TEXTUAL_ORIGINAL_EXTENSIONS.has(lowered)) {
            // 暂不支持复杂二进制格式的译文导出
            return null;
        }
        const mime = guessMimeType(lowered, true);
        // 直接输出译文内容（目前为 Markdown 或纯文本）
        const content = record.translation;
        return {
            blob: new Blob([content], { type: `${mime};charset=utf-8` })
        };
    }

    function determineOriginalFileName(record, extension) {
        const relativePath = normalizeRelativePath(record);
        if (relativePath) {
            const parts = relativePath.split('/');
            const baseName = parts.pop() || relativePath;
            return ensureFileExtension(baseName, extension || 'txt');
        }
        const base = sanitizeFileName(record.name || 'document');
        return ensureFileExtension(base, extension || 'txt');
    }

    function guessMimeType(ext, isText) {
        const lowercase = (ext || '').toLowerCase();
        if (isText) {
            if (lowercase === 'html' || lowercase === 'htm') return 'text/html';
            if (lowercase === 'md' || lowercase === 'markdown') return 'text/markdown';
            if (lowercase === 'yaml' || lowercase === 'yml') return 'text/yaml';
            if (lowercase === 'json') return 'application/json';
            if (lowercase === 'txt') return 'text/plain';
            return 'text/plain';
        }
        if (lowercase === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (lowercase === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        if (lowercase === 'epub') return 'application/epub+zip';
        if (lowercase === 'pdf') return 'application/pdf';
        return 'application/octet-stream';
    }

    function base64ToArrayBuffer(base64) {
        try {
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes.buffer;
        } catch (error) {
            console.warn('base64ToArrayBuffer failed:', error);
            return null;
        }
    }

    function buildArchiveName(records, config, context) {
        const firstRecord = records[0];
        const ext = 'zip';
        const suffix = config.structure === PACKAGING_OPTIONS.flat ? '_flat' : '';
        if (records.length === 1) {
            const baseName = applyNamingTemplate(config.template, buildTemplateContext(firstRecord, 'zip'));
            return ensureFileName(`${baseName}${suffix}`, ext);
        }
        const base = context.batchId || 'batch';
        const time = formatProcessingTime(firstRecord.processedAt || firstRecord.time, 'YYYYMMDD-HHmmss');
        return ensureFileName(`${base}_${time || Date.now()}${suffix}`, ext);
    }

    async function deleteBatchRecords(batchId) {
        const batchCache = window.__historyBatchCache || {};
        const records = batchCache[batchId];
        if (!records || !records.length) return;
        for (const record of records) {
            await deleteResultFromDB(record.id);
            removeFolderAssignmentForRecord(record.id);
        }
    }

    /**
     * (全局可调用) 删除指定 ID 的单条历史记录。
     * 操作完成后会重新渲染历史记录列表以反映更改。
     *
     * @async
     * @param {string} id - 要删除的历史记录的唯一 ID (通常是 `result.id`)。
     * @returns {Promise<void>} 当删除和列表刷新完成后解决。
     */
    window.deleteHistoryRecord = function(id, name) {
        openHistoryClearModal('record', { recordId: id, recordName: name || '' });
    };

    /**
     * (全局可调用) 在新的浏览器标签页或窗口中显示指定历史记录的详细信息。
     * 它通过构建一个指向 `views/history/history_detail.html` 的 URL (包含记录 ID 作为查询参数) 并使用 `window.open` 实现。
     *
     * @param {string} id - 要查看详情的历史记录的唯一 ID。
     */
    window.showHistoryDetail = function(id) {
        window.open('views/history/history_detail.html?id=' + encodeURIComponent(id), '_blank');
    };

    /**
     * (全局可调用) 将指定 ID 的单条历史记录打包成一个 ZIP 文件并触发浏览器下载。
     * ZIP 包中将包含：
     *  - `document.md`: 包含原始 OCR 文本（如果存在）。
     *  - `translation.md`: 包含翻译后的文本（如果存在）。
     *  - `images/` 文件夹: 包含处理过程中提取的所有图片 (PNG格式，从 Base64 数据转换)。
     *
     * 主要步骤:
     * 1. 从 IndexedDB 获取指定 ID 的历史记录数据。
     * 2. 检查 JSZip库是否已加载，未加载则提示错误。
     * 3. 创建一个新的 JSZip 实例。
     * 4. 根据记录名创建一个顶层文件夹（文件名中的非法字符会被替换）。
     * 5. 将 OCR 文本和翻译文本（如果存在）分别存为 Markdown 文件。
     * 6. 如果存在图片数据 (`r.images`)，则创建一个 `images` 子文件夹，并将每张图片（Base64编码）
     *    解码后以 PNG 格式存入该子文件夹。
     * 7. 使用 JSZip 生成 ZIP 文件的 Blob 数据 (DEFLATE 压缩)。
     * 8. 构建文件名 (包含原始文件名和时间戳) 并使用 `saveAs` (FileSaver.js) 触发下载。
     *
     * @async
     * @param {string} id - 要下载的历史记录的唯一 ID。
     * @returns {Promise<void>} 当 ZIP 文件准备好并开始下载时解决，或在发生错误时提前返回。
     */
    window.downloadHistoryRecord = async function(id) {
        const r = await getResultFromDB(id);
        if (!r) return;
        if (typeof JSZip === 'undefined') {
            alert('JSZip 加载失败，无法打包下载');
            return;
        }
        const zip = new JSZip();
        const normalizedPath = (r.relativePath || r.name || '').replace(/\\/g, '/');
        const dirPath = normalizedPath.includes('/') ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) : '';
        const baseName = normalizedPath.includes('/') ? normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1) : (r.name || 'document');
        const baseWithoutExt = baseName.replace(/\.[^.]+$/, '');
        const sanitizedDir = dirPath ? sanitizePath(dirPath) : '';
        const sanitizedBase = sanitizeFileName(baseWithoutExt).substring(0, 120) || 'document';
        const folderPath = sanitizedDir ? `${sanitizedDir}/${sanitizedBase}` : sanitizedBase;
        const folder = zip.folder(folderPath);
        folder.file('document.md', r.ocr || '');
        if (r.translation) folder.file('translation.md', r.translation);
        if (r.originalEncoding === 'text' && typeof r.originalContent === 'string') {
            const ext = (r.originalExtension || r.fileType || 'txt').toLowerCase();
            const mime = guessMimeType(ext, true);
            folder.file(`original.${ext || 'txt'}`, new Blob([r.originalContent], { type: `${mime};charset=utf-8` }));
        } else if (r.originalEncoding && r.originalEncoding !== 'text' && r.originalBinary) {
            const buffer = base64ToArrayBuffer(r.originalBinary);
            if (buffer) {
                const ext = (r.originalExtension || r.fileType || 'bin').toLowerCase();
                const mime = guessMimeType(ext, false);
                folder.file(`original.${ext || 'bin'}`, new Blob([buffer], { type: mime }));
            }
        }
        if (r.images && r.images.length > 0) {
            const imagesFolder = folder.folder('images');
            for (const img of r.images) {
                // 处理base64图片数据
                const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                if (base64Data) {
                    imagesFolder.file(`${img.id}.png`, base64Data, { base64: true });
                }
            }
        }
        // 生成zip并下载
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveName = ensureFileName(`${sanitizedBase}_${timestamp}`, 'zip');
        saveAs(zipBlob, archiveName);
    };

    // ---------------------
    // 重新翻译（全部/失败段）
    // ---------------------

    function _isChunkFailed(text) {
        if (text == null) return true;
        let t = String(text).trim();
        if (!t) return true;
        // 取首行，规避后续原文内容干扰
        const firstLine = t.split('\n', 1)[0];
        // 去除常见 Markdown 前缀（引用符、粗体符号等）
        let norm = firstLine.replace(/^>+\s*/, '').trim();
        norm = norm.replace(/^\*\*(.*)\*\*$/,'$1').trim();
        // 识别多种失败提示格式
        if (/^\[(?:翻译失败|处理错误|翻译错误|翻译意外失败)/i.test(norm)) return true;
        if (/保留原文\s*Part/i.test(norm)) return true;
        return false;
    }

    function _setBusy(id, busy, msg = '') {
        const failedBtn = document.getElementById(`retry-failed-btn-${id}`);
        const allBtn = document.getElementById(`retry-all-btn-${id}`);
        const statusEl = document.getElementById(`retry-status-${id}`);
        if (failedBtn) failedBtn.disabled = !!busy;
        if (allBtn) allBtn.disabled = !!busy;
        if (statusEl) statusEl.textContent = msg || '';
    }

    function _getEffectiveTargetLanguage(settings) {
        if (!settings) return 'chinese';
        if (settings.targetLanguage === 'custom') {
            const name = (settings.customTargetLanguageName || '').trim();
            return name || 'English';
        }
        return settings.targetLanguage || 'chinese';
    }

    function _getTranslationContext() {
        const settings = typeof loadSettings === 'function' ? loadSettings() : {};
        const modelName = settings.selectedTranslationModel || 'none';
        if (modelName === 'none') {
            showNotification && showNotification('当前未选择翻译模型，无法执行重译。', 'warning');
            return null;
        }

        let providerKey = modelName;
        let modelConfig = null;
        if (modelName === 'custom') {
            const siteId = settings.selectedCustomSourceSiteId;
            if (!siteId) {
                showNotification && showNotification('未选择自定义源站点，请先在主界面选择。', 'error');
                return null;
            }
            const allSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const siteCfg = allSites[siteId];
            if (!siteCfg) {
                showNotification && showNotification('未能加载选定的自定义源站配置。', 'error');
                return null;
            }
            providerKey = `custom_source_${siteId}`;
            modelConfig = siteCfg;
        }

        // KeyProvider 来自 app.js，作为全局可用
        let kp = null;
        try { kp = new KeyProvider(providerKey); } catch(e) { console.error(e); }
        if (!kp || !kp.hasAvailableKeys()) {
            showNotification && showNotification('所选模型没有可用的 API Key，请先配置。', 'error');
            return null;
        }

        const ctx = {
            settings,
            modelName,
            modelConfig,
            keyProvider: kp,
            targetLangName: _getEffectiveTargetLanguage(settings),
            tokenLimit: parseInt(settings.maxTokensPerChunk) || 2000,
            defaultSystemPrompt: settings.defaultSystemPrompt || '',
            defaultUserPromptTemplate: settings.defaultUserPromptTemplate || '',
            useCustomPrompts: !!settings.useCustomPrompts
        };
        return ctx;
    }

    async function _translateOneChunk(chunkText, ctx, logPrefix) {
        // 轮询 Key，失败时标记无效并切换
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const keyObj = ctx.keyProvider.getNextKey();
            if (!keyObj) { lastErr = new Error('无可用Key'); break; }
            const keyVal = keyObj.value;
            try {
                if (ctx.modelName === 'custom') {
                    const res = await translateMarkdown(
                        chunkText,
                        ctx.targetLangName,
                        'custom',
                        keyVal,
                        ctx.modelConfig,
                        logPrefix || '',
                        ctx.defaultSystemPrompt,
                        ctx.defaultUserPromptTemplate,
                        ctx.useCustomPrompts
                    );
                    return res;
                } else {
                    const res = await translateMarkdown(
                        chunkText,
                        ctx.targetLangName,
                        ctx.modelName,
                        keyVal,
                        logPrefix || '',
                        ctx.defaultSystemPrompt,
                        ctx.defaultUserPromptTemplate,
                        ctx.useCustomPrompts
                    );
                    return res;
                }
            } catch (e) {
                const msg = (e && e.message ? e.message : String(e)).toLowerCase();
                lastErr = e;
                // 常见失活/未授权关键词，标记Key失效
                if (msg.includes('unauthorized') || msg.includes('invalid') || msg.includes('forbidden') || msg.includes('401')) {
                    try { await ctx.keyProvider.markKeyAsInvalid(keyObj.id); } catch {}
                    continue;
                } else {
                    // 其他错误不标记失活，但尝试下一个Key
                    continue;
                }
            }
        }
        throw lastErr || new Error('翻译失败');
    }

    async function _retryRecordInternal(id, mode) {
        const ctx = _getTranslationContext();
        if (!ctx) return;
        _setBusy(id, true, '处理中...');
        try {
            const record = await getResultFromDB(id);
            if (!record) {
                showNotification && showNotification('未找到历史记录。', 'error');
                return;
            }
            const logPrefix = `[重译:${record.name}]`;

            if (mode === 'all') {
                // 按需求：不要直接执行重译，将整篇加入“上传文件列表”（虚拟目录），供用户统一点击处理
                const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n`;
                const mdBody = (record.ocr && record.ocr.trim()) ? record.ocr : Array.isArray(record.ocrChunks) ? record.ocrChunks.join('\n\n') : '';
                const mdText = header + mdBody;
                if (!mdText) {
                    showNotification && showNotification('该记录没有可用的 OCR 文本，无法加入待处理列表。', 'warning');
                    return;
                }
                const uniqueSuffix = Math.random().toString(36).slice(2,6);
                const fileName = `${baseName}-retranslate-${uniqueSuffix}.md`;
                try {
                    const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                    try { virtualFile.virtualType = 'retranslate'; } catch(_) {}
                    if (typeof addFilesToList === 'function') {
                        addFilesToList([virtualFile]);
                        showNotification && showNotification(`已将“${fileName}”加入待处理列表，请在主界面点击“开始处理”。`, 'success');
                        // 成功后自动关闭历史面板，避免遮挡主界面交互
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else {
                        // 后备：直接操作全局数组并刷新UI
                        if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                            window.pdfFiles.push(virtualFile);
                            if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                                updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                                updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                            }
                            showNotification && showNotification(`已将“${fileName}”加入待处理列表，请在主界面点击“开始处理”。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                        } else {
                            showNotification && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                        }
                    }
                } catch (e) {
                    console.error('创建虚拟文件失败:', e);
                    showNotification && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                }
            } else {
                // 仅重试失败段
                const total = Array.isArray(record.ocrChunks) ? record.ocrChunks.length : 0;

                // 标准分块路径
                if (total > 0 && Array.isArray(record.translatedChunks)) {
                    const pieces = [];
                    for (let i = 0; i < total; i++) {
                        if (_isChunkFailed(record.translatedChunks[i])) {
                            const ocrText = record.ocrChunks[i] || '';
                            if (ocrText.trim()) {
                                pieces.push(`<!-- PBX-CHUNK-INDEX:${i} -->\n\n${ocrText}`);
                            }
                        }
                    }
                    if (pieces.length === 0) {
                        showNotification && showNotification('没有需要重试的片段。', 'info');
                        return;
                    }
                    const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n<!-- PBX-MODE:retry-failed -->\n`;
                    const mdText = header + pieces.join('\n\n\n');
                    const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                    const uniqueSuffix = Math.random().toString(36).slice(2,6);
                    const fileName = `${baseName}-retry-failed-${uniqueSuffix}.md`;
                    try {
                        const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                        try { virtualFile.virtualType = 'retry-failed'; } catch(_) {}
                        if (typeof addFilesToList === 'function') {
                            addFilesToList([virtualFile]);
                            showNotification && showNotification(`已将“${fileName}”加入待处理列表（失败片段），请点击“开始处理”。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                        } else if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                            window.pdfFiles.push(virtualFile);
                            if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                                updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                                updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                            }
                            showNotification && showNotification(`已将“${fileName}”加入待处理列表（失败片段），请点击“开始处理”。`, 'success');
                            try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                        } else {
                            showNotification && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                        }
                    } catch (e) {
                        console.error('创建虚拟文件失败:', e);
                        showNotification && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                    }
                    return;
                }

                // 结构化路径：创建虚拟文件加入上传列表（与标准分块路径保持一致，有UI进度反馈）
                const meta = record && record.metadata ? record.metadata : {};
                let failedItems = Array.isArray(meta.failedStructuredItems) ? meta.failedStructuredItems.slice() : [];

                // 回退：若缺少 failedStructuredItems，则从 translatedContentList 中推断
                if (failedItems.length === 0 && Array.isArray(meta.translatedContentList)) {
                    const _norm = (v) => {
                        if (v == null) return '';
                        try {
                            if (Array.isArray(v)) return v.join(' ').trim();
                            if (typeof v === 'string') return v.trim();
                            return String(v).trim();
                        } catch(_) { return ''; }
                    };
                    const tlist = meta.translatedContentList;
                    const olist = Array.isArray(meta.contentListJson) ? meta.contentListJson : [];
                    const minLen = Math.min(tlist.length, olist.length);
                    for (let i = 0; i < minLen; i++) {
                        const t = tlist[i] || {};
                        const o = olist[i] || {};
                        let isFailed = false;

                        // 如果有 failureReason 字段，根据它判断
                        if (t.failed && t.failureReason) {
                            isFailed = (t.failureReason === 'empty');
                            // failureReason === 'unchanged' 不重试
                        } else if (t.failed || !t.text) {
                            // 旧数据没有 failureReason，需要重新判定
                            // 只有原文不为空且译文为空时才标记为失败
                            if (o.type === 'text') {
                                const a = _norm(o.text);
                                const b = _norm(t.text);
                                isFailed = a && !b;
                            } else if (o.type === 'image') {
                                const a = _norm(o.image_caption);
                                const b = _norm(t.image_caption);
                                isFailed = a && !b;
                            } else if (o.type === 'table') {
                                const a = _norm(o.table_caption);
                                const b = _norm(t.table_caption);
                                isFailed = a && !b;
                            }
                        }
                        if (isFailed) {
                            const rawText = (o.type === 'text') ? (o.text || '')
                                            : (o.type === 'image') ? (Array.isArray(o.image_caption) ? o.image_caption.join(' ') : o.image_caption)
                                            : (o.type === 'table') ? (o.table_caption || '')
                                            : '';
                            const normText = _norm(rawText);
                            if (normText) {
                                failedItems.push({ index: i, type: o.type, page_idx: o.page_idx || 0, text: normText });
                            }
                        }
                    }
                }

                if (failedItems.length === 0) {
                    showNotification && showNotification('没有需要重试的片段。', 'info');
                    return;
                }

                // 构建失败片段的虚拟文件（加入上传列表，在主界面显示进度）
                // 使用特殊标记告诉 main.js 这是结构化翻译的失败重试
                const header = `<!-- PBX-HISTORY-REF:${record.id} -->\n<!-- PBX-MODE:retry-structured-failed -->\n<!-- PBX-FAILED-COUNT:${failedItems.length} -->\n`;
                const failedIndices = failedItems.map(fi => fi.index).join(',');
                const mdText = header + `<!-- PBX-FAILED-INDICES:${failedIndices} -->\n\n结构化翻译失败片段重试（${failedItems.length} 个）`;
                const baseName = (record.name || 'document').replace(/\.pdf$/i, '');
                const uniqueSuffix = Math.random().toString(36).slice(2,6);
                const fileName = `${baseName}-retry-structured-${uniqueSuffix}.md`;

                try {
                    const virtualFile = new File([mdText], fileName, { type: 'text/markdown' });
                    try { virtualFile.virtualType = 'retry-structured-failed'; } catch(_) {}

                    if (typeof addFilesToList === 'function') {
                        addFilesToList([virtualFile]);
                        showNotification && showNotification(`已将"${fileName}"加入待处理列表（${failedItems.length} 个失败片段），请点击"开始处理"。`, 'success');
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else if (typeof window !== 'undefined' && Array.isArray(window.pdfFiles)) {
                        window.pdfFiles.push(virtualFile);
                        if (typeof updateFileListUI === 'function' && typeof updateProcessButtonState === 'function' && typeof handleRemoveFile === 'function') {
                            updateFileListUI(window.pdfFiles, window.isProcessing || false, handleRemoveFile);
                            updateProcessButtonState(window.pdfFiles, window.isProcessing || false);
                        }
                        showNotification && showNotification(`已将"${fileName}"加入待处理列表（${failedItems.length} 个失败片段），请点击"开始处理"。`, 'success');
                        try { document.getElementById('historyPanel')?.classList.add('hidden'); } catch(_) {}
                    } else {
                        showNotification && showNotification('无法加入待处理列表：缺少文件列表接口。', 'error');
                    }
                } catch (e) {
                    console.error('创建虚拟文件失败:', e);
                    showNotification && showNotification('创建虚拟文件失败，无法加入待处理列表。', 'error');
                }
                return;
            }

            // 刷新列表显示状态
            await renderHistoryList();
        } catch (e) {
            console.error('重译发生错误:', e);
            showNotification && showNotification(`重译失败：${e && e.message ? e.message : String(e)}`, 'error');
        } finally {
            _setBusy(id, false, '');
        }
    }

    /**
     * (全局可调用) 对历史记录执行重新翻译
     * @param {string} id 历史记录ID
     * @param {('all'|'failed')} mode 模式：全部或仅失败
     */
    window.retryTranslateRecord = function(id, mode) {
        _retryRecordInternal(id, mode === 'all' ? 'all' : 'failed');
    };
});
