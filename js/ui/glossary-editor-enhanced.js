/**
 * @file js/ui/glossary-editor-enhanced.js
 * @description 增强版术语库编辑器 - 支持大数据量、搜索、分页、批量操作
 */

(function() {
  const ITEMS_PER_PAGE = 20; // 每页显示条数

  // 编辑器状态
  const editorState = {
    currentSetId: null,
    allEntries: [],
    filteredEntries: [],
    currentPage: 1,
    totalPages: 0,
    searchQuery: '',
    selectedIds: new Set(),
    selectAll: false
  };

  /**
   * 打开增强版编辑器
   * @param {string} setId - 术语库 ID
   */
  async function openEnhancedEditor(setId) {
    if (!setId) return;

    editorState.currentSetId = setId;
    editorState.currentPage = 1;
    editorState.searchQuery = '';
    editorState.selectedIds.clear();
    editorState.selectAll = false;

    // 显示加载提示
    showEditorLoading();

    try {
      // 从缓存加载数据
      const sets = window._glossarySetsCache || {};
      const set = sets[setId];

      if (!set) {
        throw new Error('术语库不存在');
      }

      editorState.allEntries = Array.isArray(set.entries) ? set.entries : [];
      editorState.filteredEntries = [...editorState.allEntries];
      editorState.totalPages = Math.ceil(editorState.filteredEntries.length / ITEMS_PER_PAGE);

      // 渲染编辑器
      renderEnhancedEditor(set);
    } catch (err) {
      console.error('Failed to open enhanced editor:', err);
      alert('打开术语库失败: ' + err.message);
    }
  }

  /**
   * 显示加载提示
   */
  function showEditorLoading() {
    const container = document.getElementById('glossaryEntriesTable');
    if (!container) return;

    container.innerHTML = `
      <div class="text-center py-12">
        <iconify-icon icon="carbon:hourglass" width="32" class="text-gray-400 animate-pulse mb-2"></iconify-icon>
        <p class="text-gray-500">正在加载术语库数据...</p>
      </div>
    `;
  }

  /**
   * 渲染增强版编辑器
   * @param {Object} set - 术语库对象
   */
  function renderEnhancedEditor(set) {
    const panel = document.getElementById('glossaryEditorPanel');
    if (!panel) return;

    panel.dataset.editingId = set.id;
    panel.classList.remove('hidden');

    // 渲染顶部工具栏
    renderToolbar(set);

    // 渲染条目列表
    renderEntriesList();

    // 渲染分页控件
    renderPagination();
  }

  /**
   * 渲染工具栏
   * @param {Object} set - 术语库对象
   */
  function renderToolbar(set) {
    const toolbarContainer = document.getElementById('glossaryEditorToolbar');
    if (!toolbarContainer) return;

    const totalEntries = editorState.allEntries.length;
    const filteredCount = editorState.filteredEntries.length;
    const selectedCount = editorState.selectedIds.size;

    toolbarContainer.innerHTML = `
      <div class="flex flex-col gap-4 mb-4">
        <!-- 标题和统计 -->
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold text-gray-800">${escapeHtml(set.name)}</h3>
            <p class="text-sm text-gray-500">
              共 ${totalEntries.toLocaleString()} 条
              ${filteredCount !== totalEntries ? `，筛选后 ${filteredCount.toLocaleString()} 条` : ''}
              ${selectedCount > 0 ? `，已选择 ${selectedCount} 条` : ''}
            </p>
          </div>
          <button onclick="window.glossaryEditorEnhanced.close()"
                  class="text-gray-400 hover:text-gray-600">
            <iconify-icon icon="carbon:close" width="24"></iconify-icon>
          </button>
        </div>

        <!-- 操作按钮栏 -->
        <div class="flex flex-wrap items-center gap-2 justify-between">
          <div class="flex flex-wrap items-center gap-2">
            <button onclick="window.glossaryEditorEnhanced.addNewEntry()"
                    class="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm">
              <iconify-icon icon="carbon:add-alt" width="16"></iconify-icon>
              新增条目
            </button>
            <button onclick="window.glossaryEditorEnhanced.openImport()"
                    class="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-400 hover:text-blue-600 transition text-sm">
              <iconify-icon icon="carbon:import" width="16"></iconify-icon>
              导入
            </button>
            <button onclick="window.glossaryEditorEnhanced.openExport()"
                    class="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-400 hover:text-blue-600 transition text-sm">
              <iconify-icon icon="carbon:export" width="16"></iconify-icon>
              导出
            </button>
          </div>

          <!-- 智能过滤配置 -->
          <div class="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg hover:border-blue-400 transition text-sm ${set.enableSmartFilter ? 'bg-blue-50 border-blue-400' : ''}">
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox"
                     ${set.enableSmartFilter ? 'checked' : ''}
                     onchange="window.glossaryEditorEnhanced.toggleSmartFilter(this.checked)"
                     class="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
              <iconify-icon icon="carbon:filter" width="16" class="${set.enableSmartFilter ? 'text-blue-600' : 'text-gray-600'}"></iconify-icon>
              <span class="${set.enableSmartFilter ? 'text-blue-700 font-medium' : 'text-gray-700'}">智能过滤</span>
            </label>
            <span class="text-gray-300">|</span>
            <label class="inline-flex items-center gap-1">
              <span class="text-xs text-gray-600">限制</span>
              <input type="number"
                     value="${set.maxTermsInPrompt || 50}"
                     min="1"
                     max="500"
                     onchange="window.glossaryEditorEnhanced.updateMaxTerms(parseInt(this.value))"
                     class="w-14 px-2 py-0.5 text-center border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent text-sm">
              <span class="text-xs text-gray-600">条</span>
            </label>
          </div>
        </div>

        <!-- 搜索栏 -->
        <div class="flex gap-2">
          <div class="flex-1 relative">
            <iconify-icon icon="carbon:search" width="20"
                          class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></iconify-icon>
            <input type="text"
                   id="glossarySearchInput"
                   placeholder="搜索术语或译文..."
                   value="${escapeHtml(editorState.searchQuery)}"
                   class="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                   oninput="window.glossaryEditorEnhanced.handleSearch(this.value)">
            ${editorState.searchQuery ? `
              <button onclick="window.glossaryEditorEnhanced.clearSearch()"
                      class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <iconify-icon icon="carbon:close-filled" width="20"></iconify-icon>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- 批量操作栏 -->
        ${selectedCount > 0 ? `
          <div class="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            <span class="text-sm text-blue-700 font-medium">已选择 ${selectedCount} 条</span>
            <div class="flex-1"></div>
            <button onclick="window.glossaryEditorEnhanced.bulkEnable(true)"
                    class="text-sm text-blue-600 hover:text-blue-700 px-3 py-1 rounded hover:bg-blue-100">
              <iconify-icon icon="carbon:checkmark" width="16" class="inline-block"></iconify-icon>
              批量启用
            </button>
            <button onclick="window.glossaryEditorEnhanced.bulkEnable(false)"
                    class="text-sm text-gray-600 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100">
              <iconify-icon icon="carbon:close" width="16" class="inline-block"></iconify-icon>
              批量禁用
            </button>
            <button onclick="window.glossaryEditorEnhanced.bulkDelete()"
                    class="text-sm text-red-600 hover:text-red-700 px-3 py-1 rounded hover:bg-red-100">
              <iconify-icon icon="carbon:trash-can" width="16" class="inline-block"></iconify-icon>
              批量删除
            </button>
            <button onclick="window.glossaryEditorEnhanced.clearSelection()"
                    class="text-sm text-gray-600 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100">
              取消选择
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * 渲染条目列表（分页）
   */
  function renderEntriesList() {
    const container = document.getElementById('glossaryEntriesTable');
    if (!container) return;

    const start = (editorState.currentPage - 1) * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, editorState.filteredEntries.length);
    const pageEntries = editorState.filteredEntries.slice(start, end);

    if (pageEntries.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12">
          <iconify-icon icon="carbon:search" width="32" class="text-gray-300 mb-2"></iconify-icon>
          <p class="text-gray-500">${editorState.searchQuery ? '未找到匹配的术语' : '暂无术语条目'}</p>
        </div>
      `;
      return;
    }

    const rows = pageEntries.map((entry, index) => {
      const globalIndex = start + index;
      const isSelected = editorState.selectedIds.has(entry.id);

      return `
        <tr class="border-b border-gray-100 hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}">
          <td class="px-3 py-2 text-center">
            <input type="checkbox"
                   ${isSelected ? 'checked' : ''}
                   onchange="window.glossaryEditorEnhanced.toggleSelection('${entry.id}')"
                   class="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
          </td>
          <td class="px-3 py-2 text-gray-600 text-sm">${globalIndex + 1}</td>
          <td class="px-3 py-2">
            <input type="text"
                   value="${escapeHtml(entry.term)}"
                   onchange="window.glossaryEditorEnhanced.updateEntry('${entry.id}', 'term', this.value)"
                   class="w-full px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent">
          </td>
          <td class="px-3 py-2">
            <input type="text"
                   value="${escapeHtml(entry.translation)}"
                   onchange="window.glossaryEditorEnhanced.updateEntry('${entry.id}', 'translation', this.value)"
                   class="w-full px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent">
          </td>
          <td class="px-3 py-2 text-center">
            <input type="checkbox"
                   ${entry.caseSensitive ? 'checked' : ''}
                   onchange="window.glossaryEditorEnhanced.updateEntry('${entry.id}', 'caseSensitive', this.checked)"
                   class="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
          </td>
          <td class="px-3 py-2 text-center">
            <input type="checkbox"
                   ${entry.wholeWord ? 'checked' : ''}
                   onchange="window.glossaryEditorEnhanced.updateEntry('${entry.id}', 'wholeWord', this.checked)"
                   class="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
          </td>
          <td class="px-3 py-2 text-center">
            <input type="checkbox"
                   ${entry.enabled !== false ? 'checked' : ''}
                   onchange="window.glossaryEditorEnhanced.updateEntry('${entry.id}', 'enabled', this.checked)"
                   class="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
          </td>
          <td class="px-3 py-2 text-center">
            <button onclick="window.glossaryEditorEnhanced.deleteEntry('${entry.id}')"
                    class="text-red-500 hover:text-red-700">
              <iconify-icon icon="carbon:trash-can" width="18"></iconify-icon>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="px-3 py-2 text-center w-12">
                <input type="checkbox"
                       ${editorState.selectAll ? 'checked' : ''}
                       onchange="window.glossaryEditorEnhanced.toggleSelectAll(this.checked)"
                       class="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500">
              </th>
              <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase w-16">#</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">术语</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">译文</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-gray-600 uppercase w-24">区分大小写</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-gray-600 uppercase w-24">全词匹配</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-gray-600 uppercase w-20">启用</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-gray-600 uppercase w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>

      <div class="mt-4 text-sm text-gray-500 text-center">
        显示 ${start + 1} - ${end} 条，共 ${editorState.filteredEntries.length.toLocaleString()} 条
      </div>
    `;
  }

  /**
   * 渲染分页控件
   */
  function renderPagination() {
    const container = document.getElementById('glossaryEditorPagination');
    if (!container) return;

    if (editorState.totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    const currentPage = editorState.currentPage;
    const totalPages = editorState.totalPages;

    // 生成页码按钮
    const pageButtons = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      // 显示所有页码
      for (let i = 1; i <= totalPages; i++) {
        pageButtons.push(i);
      }
    } else {
      // 智能显示页码
      if (currentPage <= 4) {
        pageButtons.push(1, 2, 3, 4, 5, '...', totalPages);
      } else if (currentPage >= totalPages - 3) {
        pageButtons.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pageButtons.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }

    const buttonsHTML = pageButtons.map(page => {
      if (page === '...') {
        return '<span class="px-3 py-1 text-gray-400">...</span>';
      }

      const isActive = page === currentPage;
      return `
        <button onclick="window.glossaryEditorEnhanced.goToPage(${page})"
                class="px-3 py-1 rounded ${isActive
                  ? 'bg-blue-500 text-white font-medium'
                  : 'text-gray-600 hover:bg-gray-100'}">
          ${page}
        </button>
      `;
    }).join('');

    container.innerHTML = `
      <div class="flex items-center justify-center gap-2 py-4">
        <button onclick="window.glossaryEditorEnhanced.goToPage(${currentPage - 1})"
                ${currentPage === 1 ? 'disabled' : ''}
                class="px-3 py-1 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
          <iconify-icon icon="carbon:chevron-left" width="20"></iconify-icon>
        </button>

        ${buttonsHTML}

        <button onclick="window.glossaryEditorEnhanced.goToPage(${currentPage + 1})"
                ${currentPage === totalPages ? 'disabled' : ''}
                class="px-3 py-1 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
          <iconify-icon icon="carbon:chevron-right" width="20"></iconify-icon>
        </button>
      </div>
    `;
  }

  /**
   * 处理搜索
   * @param {string} query - 搜索关键词
   */
  function handleSearch(query) {
    editorState.searchQuery = query.trim();
    editorState.currentPage = 1;

    if (!editorState.searchQuery) {
      editorState.filteredEntries = [...editorState.allEntries];
    } else {
      const lowerQuery = editorState.searchQuery.toLowerCase();
      editorState.filteredEntries = editorState.allEntries.filter(entry => {
        return entry.term.toLowerCase().includes(lowerQuery) ||
               entry.translation.toLowerCase().includes(lowerQuery);
      });
    }

    editorState.totalPages = Math.ceil(editorState.filteredEntries.length / ITEMS_PER_PAGE);

    // 重新渲染
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
      renderPagination();
    }
  }

  /**
   * 清除搜索
   */
  function clearSearch() {
    document.getElementById('glossarySearchInput').value = '';
    handleSearch('');
  }

  /**
   * 跳转到指定页
   * @param {number} page - 页码
   */
  function goToPage(page) {
    if (page < 1 || page > editorState.totalPages) return;
    editorState.currentPage = page;
    renderEntriesList();
    renderPagination();

    // 滚动到顶部
    const container = document.getElementById('glossaryEntriesTable');
    if (container) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * 切换选择
   * @param {string} entryId - 条目 ID
   */
  function toggleSelection(entryId) {
    if (editorState.selectedIds.has(entryId)) {
      editorState.selectedIds.delete(entryId);
    } else {
      editorState.selectedIds.add(entryId);
    }

    // 更新全选状态
    editorState.selectAll = editorState.selectedIds.size === editorState.filteredEntries.length;

    // 重新渲染
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
    }
  }

  /**
   * 全选/取消全选
   * @param {boolean} checked - 是否选中
   */
  function toggleSelectAll(checked) {
    editorState.selectAll = checked;

    if (checked) {
      editorState.filteredEntries.forEach(entry => {
        editorState.selectedIds.add(entry.id);
      });
    } else {
      editorState.selectedIds.clear();
    }

    // 重新渲染
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
    }
  }

  /**
   * 清除选择
   */
  function clearSelection() {
    editorState.selectedIds.clear();
    editorState.selectAll = false;

    // 重新渲染
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
    }
  }

  /**
   * 更新条目
   * @param {string} entryId - 条目 ID
   * @param {string} field - 字段名
   * @param {any} value - 新值
   */
  function updateEntry(entryId, field, value) {
    const entry = editorState.allEntries.find(e => e.id === entryId);
    if (!entry) return;

    entry[field] = value;

    // 保存到缓存和 IndexedDB
    saveCurrentSet();
  }

  /**
   * 删除条目
   * @param {string} entryId - 条目 ID
   */
  function deleteEntry(entryId) {
    if (!confirm('确认删除该条目？')) return;

    editorState.allEntries = editorState.allEntries.filter(e => e.id !== entryId);
    editorState.filteredEntries = editorState.filteredEntries.filter(e => e.id !== entryId);
    editorState.selectedIds.delete(entryId);
    editorState.totalPages = Math.ceil(editorState.filteredEntries.length / ITEMS_PER_PAGE);

    // 调整当前页
    if (editorState.currentPage > editorState.totalPages && editorState.totalPages > 0) {
      editorState.currentPage = editorState.totalPages;
    }

    // 保存并重新渲染
    saveCurrentSet();
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
      renderPagination();
    }
  }

  /**
   * 批量启用/禁用
   * @param {boolean} enabled - 是否启用
   */
  function bulkEnable(enabled) {
    let count = 0;
    editorState.selectedIds.forEach(entryId => {
      const entry = editorState.allEntries.find(e => e.id === entryId);
      if (entry) {
        entry.enabled = enabled;
        count++;
      }
    });

    if (count > 0) {
      saveCurrentSet();
      renderEntriesList();
      alert(`已${enabled ? '启用' : '禁用'} ${count} 条术语`);
    }
  }

  /**
   * 批量删除
   */
  function bulkDelete() {
    const count = editorState.selectedIds.size;
    if (count === 0) return;

    if (!confirm(`确认删除选中的 ${count} 条术语？此操作不可撤销。`)) return;

    editorState.allEntries = editorState.allEntries.filter(e => !editorState.selectedIds.has(e.id));
    editorState.filteredEntries = editorState.filteredEntries.filter(e => !editorState.selectedIds.has(e.id));
    editorState.selectedIds.clear();
    editorState.selectAll = false;
    editorState.totalPages = Math.ceil(editorState.filteredEntries.length / ITEMS_PER_PAGE);

    // 调整当前页
    if (editorState.currentPage > editorState.totalPages && editorState.totalPages > 0) {
      editorState.currentPage = editorState.totalPages;
    }

    // 保存并重新渲染
    saveCurrentSet();
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
      renderPagination();
    }

    alert(`已删除 ${count} 条术语`);
  }

  /**
   * 新增条目
   */
  function addNewEntry() {
    const newEntry = {
      id: generateUUID(),
      term: '',
      translation: '',
      caseSensitive: false,
      wholeWord: false,
      enabled: true
    };

    editorState.allEntries.unshift(newEntry); // 添加到开头
    editorState.filteredEntries.unshift(newEntry);
    editorState.totalPages = Math.ceil(editorState.filteredEntries.length / ITEMS_PER_PAGE);
    editorState.currentPage = 1; // 跳转到第一页

    // 保存并重新渲染
    saveCurrentSet();
    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (set) {
      renderToolbar(set);
      renderEntriesList();
      renderPagination();
    }
  }

  /**
   * 打开导入功能（复用旧版的导入模态框）
   */
  function openImport() {
    if (typeof openGlossaryImportModal === 'function') {
      openGlossaryImportModal(editorState.currentSetId);
    } else {
      alert('导入功能暂不可用');
    }
  }

  /**
   * 打开导出功能（复用旧版的导出模态框）
   */
  function openExport() {
    if (typeof openGlossaryExportModal === 'function') {
      openGlossaryExportModal(editorState.currentSetId);
    } else {
      alert('导出功能暂不可用');
    }
  }

  /**
   * 切换智能过滤开关
   * @param {boolean} enabled - 是否启用智能过滤
   */
  function toggleSmartFilter(enabled) {
    if (!editorState.currentSetId) return;

    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (!set) return;

    // 更新配置
    set.enableSmartFilter = enabled;

    // 保存到存储（使用同步函数，会自动触发异步保存）
    if (typeof renameGlossarySet === 'function') {
      // 触发保存（名称不变，只更新元数据）
      renameGlossarySet(editorState.currentSetId, set.name);
    }

    // 重新渲染工具栏以显示新状态
    renderToolbar(set);

    // 提示用户
    const message = enabled
      ? '已启用智能过滤：翻译时自动过滤通用词汇，只保留专业术语'
      : '已禁用智能过滤：翻译时使用所有匹配的术语';

    if (typeof showNotification === 'function') {
      showNotification(message, 'success');
    } else {
      console.log(message);
    }
  }

  /**
   * 更新术语数量限制
   * @param {number} maxTerms - 最大术语数量
   */
  function updateMaxTerms(maxTerms) {
    if (!editorState.currentSetId) return;

    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (!set) return;

    // 验证数值范围
    if (isNaN(maxTerms) || maxTerms < 1) {
      maxTerms = 1;
    } else if (maxTerms > 500) {
      maxTerms = 500;
    }

    // 更新配置
    set.maxTermsInPrompt = maxTerms;

    // 保存到存储
    if (typeof renameGlossarySet === 'function') {
      renameGlossarySet(editorState.currentSetId, set.name);
    }

    // 重新渲染工具栏
    renderToolbar(set);

    // 提示用户
    const message = `已设置术语数量限制为 ${maxTerms} 条`;
    if (typeof showNotification === 'function') {
      showNotification(message, 'success');
    } else {
      console.log(message);
    }
  }

  /**
   * 保存当前术语库
   */
  function saveCurrentSet() {
    if (!editorState.currentSetId) return;

    const sets = window._glossarySetsCache || {};
    const set = sets[editorState.currentSetId];
    if (!set) return;

    // 更新条目
    set.entries = editorState.allEntries;

    // 保存（使用 storage.js 的函数）
    if (typeof updateGlossarySetEntries === 'function') {
      updateGlossarySetEntries(editorState.currentSetId, editorState.allEntries);
    }
  }

  /**
   * 关闭编辑器
   */
  function closeEditor() {
    const panel = document.getElementById('glossaryEditorPanel');
    if (panel) {
      panel.classList.add('hidden');
      panel.dataset.editingId = '';
    }

    // 清空状态
    editorState.currentSetId = null;
    editorState.allEntries = [];
    editorState.filteredEntries = [];
    editorState.selectedIds.clear();
    editorState.selectAll = false;
  }

  /**
   * HTML 转义
   */
  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 暴露到全局
  window.glossaryEditorEnhanced = {
    open: openEnhancedEditor,
    close: closeEditor,
    handleSearch,
    clearSearch,
    goToPage,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    updateEntry,
    deleteEntry,
    bulkEnable,
    bulkDelete,
    addNewEntry,
    openImport,
    openExport,
    toggleSmartFilter,
    updateMaxTerms
  };

  console.log('[GlossaryEditorEnhanced] Enhanced editor loaded');
})();
