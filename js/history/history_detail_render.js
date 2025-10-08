/**
 * 异步渲染历史详情页面的主函数。
 * - 从 URL 查询参数中获取记录 ID。
 * - 使用 `getResultFromDB` (来自 storage.js) 从 IndexedDB 加载对应的历史数据。
 * - 如果数据成功加载：
 *   - 更新页面标题 (`#fileName`) 和元数据 (`#fileMeta`)。
 *   - 根据数据中是否存在有效的分块信息 (`ocrChunks`, `translatedChunks`)，
 *     决定默认显示的标签页（优先显示分块对比，否则显示 OCR 内容）。
 * - 如果未找到数据，则显示提示信息。
 * @async
 */
async function renderDetail() {
  const id = getQueryParam('id');
  if (!id) return;
  docIdForLocalStorage = id; // Store doc ID for localStorage operations
  window.docIdForLocalStorage = id; // 同时更新挂载到 window 对象上的变量

  // Restore chatbot open state
  const savedChatbotOpenState = localStorage.getItem(`chatbotOpenState_${docIdForLocalStorage}`);
  if (savedChatbotOpenState === 'true') {
    window.isChatbotOpen = true;
  } else if (savedChatbotOpenState === 'false') {
    window.isChatbotOpen = false;
  }

  // 从localStorage恢复保存的比例设置
  const savedChunkCompareRatio = localStorage.getItem(`chunkCompareRatio_${docIdForLocalStorage}`);
  if (savedChunkCompareRatio !== null && !isNaN(parseFloat(savedChunkCompareRatio))) {
    window.chunkCompareRatio = parseFloat(savedChunkCompareRatio);
  }

  // console.log(`Chatbot state after attempting restore from localStorage for ${docIdForLocalStorage}: ${window.isChatbotOpen}`);

  // Initialize Dock Logic once docIdForLocalStorage is available
  if (typeof window.DockLogic !== 'undefined' && typeof window.DockLogic.init === 'function') {
    window.DockLogic.init(docIdForLocalStorage);
  } else {
    console.error("DockLogic not available or init function missing.");
  }

  data = await getResultFromDB(id);
  window.data = data; // for debugging
  const fileMetaTimeEl = document.getElementById('fileMetaTime');
  const fileMetaImagesEl = document.getElementById('fileMetaImages');

  if (!data) {
    document.getElementById('fileName').textContent = '未找到数据';
    if (fileMetaTimeEl) fileMetaTimeEl.textContent = '时间: --';
    if (fileMetaImagesEl) fileMetaImagesEl.textContent = '图片数: --';
    document.getElementById('tabContent').innerHTML = '';
    return;
  }

  // === 新增：如果没有翻译内容，隐藏"仅翻译"和"分块对比"按钮 ===
  if (!data.translation || data.translation.trim() === "") {
    document.getElementById('tab-translation').style.display = 'none';
    document.getElementById('tab-chunk-compare').style.display = 'none';
  }

  // === 新增：检测 MinerU 结构化翻译数据，显示 PDF 对照按钮 ===
  const hasMinerUStructuredData =
    data.metadata &&
    data.metadata.originalPdfBase64 &&
    data.metadata.contentListJson &&
    data.metadata.translatedContentList &&
    data.metadata.supportsStructuredTranslation === true;

  const pdfCompareTab = document.getElementById('tab-pdf-compare');
  if (hasMinerUStructuredData && pdfCompareTab) {
    pdfCompareTab.style.display = 'inline-block';
    console.log('[renderDetail] MinerU 结构化翻译数据检测成功，显示 PDF 对照按钮');
  } else if (pdfCompareTab) {
    pdfCompareTab.style.display = 'none';
  }
  // ========================================================

  document.getElementById('fileName').textContent = data.name;
  if (fileMetaTimeEl) {
    fileMetaTimeEl.textContent = `时间: ${new Date(data.time).toLocaleString()}`;
  }
  if (fileMetaImagesEl) {
    const imageCount = Array.isArray(data.images) ? data.images.length : 0;
    fileMetaImagesEl.textContent = `图片数: ${imageCount}`;
  }

  // ========== 确保批注数据在渲染前加载 ==========
  if (id) { // 确保我们有文档 ID
    try {
      const annotations = await getAnnotationsForDocFromDB(id);
      console.log(`Annotations for docId '${id}' (loaded in renderDetail):`, annotations);
      data.annotations = annotations || []; // 存储到 data 对象，确保是数组
      // updateAnnotationSummary(); // Handled by updateAllDockStats via showTab
      // updateHighlightSummary(); // Handled by updateAllDockStats via showTab
    } catch (error) {
      console.error(`Error loading annotations for docId '${id}' in renderDetail:`, error);
      data.annotations = []; // 出错时也确保是个空数组
      // updateAnnotationSummary(); // Handled by updateAllDockStats via showTab
      // updateHighlightSummary(); // Handled by updateAllDockStats via showTab
    }
  } else {
    // updateAnnotationSummary(); // Handled by updateAllDockStats via showTab
    // updateHighlightSummary(); // Handled by updateAllDockStats via showTab
  }
  // =============================================

  // ========== 在 window.data 设置并填充批注后，显式加载聊天记录 ==========
  if (window.data) {
    if (window.ChatbotCore && typeof window.ChatbotCore.reloadChatHistoryAndUpdateUI === 'function' &&
        window.ChatbotUI && typeof window.ChatbotUI.updateChatbotUI === 'function') {
      console.log('renderDetail: Calling reloadChatHistoryAndUpdateUI after window.data and annotations are set. Current docId:', window.ChatbotCore.getCurrentDocId ? window.ChatbotCore.getCurrentDocId() : 'unknown');
      window.ChatbotCore.reloadChatHistoryAndUpdateUI(window.ChatbotUI.updateChatbotUI);
    } else {
      console.error('renderDetail: ChatbotCore or ChatbotUI not fully available for history reload.');
    }
  }
  // =================================================================

  // Initialize annotation system after data is loaded and DOM is likely ready
  if (typeof window.initializeGlobalAnnotationVariables === 'function') {
    window.initializeGlobalAnnotationVariables();
  }
  if (typeof window.initAnnotationSystem === 'function') {
    window.initAnnotationSystem();
  } else {
    console.error("initAnnotationSystem is not defined. Check js/annotation_logic.js");
  }

  // Determine initial tab, AFTER annotations are loaded
  let initialTab = 'ocr'; // Default tab
  if (docIdForLocalStorage) {
    const savedTabKey = `activeTab_${docIdForLocalStorage}`;
    const savedTab = localStorage.getItem(savedTabKey);
    if (
      savedTab &&
      ['ocr', 'translation', 'chunk-compare', 'pdf-compare'].includes(savedTab) &&
      !(savedTab !== 'ocr' && (!data.translation || data.translation.trim() === ""))
    ) {
      initialTab = savedTab;
    } else if (
      data.ocrChunks && data.ocrChunks.length > 0 &&
      data.translatedChunks && data.translatedChunks.length > 0 &&
      data.ocrChunks.length === data.translatedChunks.length &&
      data.translation && data.translation.trim() !== ""
    ) {
      initialTab = 'chunk-compare';
    }
  } else if (
    data.ocrChunks && data.ocrChunks.length > 0 &&
    data.translatedChunks && data.translatedChunks.length > 0 &&
    data.ocrChunks.length === data.translatedChunks.length &&
    data.translation && data.translation.trim() !== ""
  ) {
    initialTab = 'chunk-compare';
  }

  // 现在，在批注肯定加载完毕后，才调用 showTab
  showTab(initialTab);

  // The block for loading annotations (previously around line 415) has been moved up.

  // Add scroll listener for saving scroll position
  window.removeEventListener('scroll', debouncedSaveScrollPosition);
  window.addEventListener('scroll', debouncedSaveScrollPosition);
  // Add scroll listener for updating reading progress - MOVED TO DOCK_LOGIC.JS
  // window.removeEventListener('scroll', debouncedUpdateReadingProgress);
  // window.addEventListener('scroll', debouncedUpdateReadingProgress);

  // Add listener to save chatbot state on page unload
  window.removeEventListener('beforeunload', saveChatbotStateOnUnload);
  window.addEventListener('beforeunload', saveChatbotStateOnUnload);

  // Manage Annotations Link Click - Changed to Settings Link - MOVED TO DOCK_LOGIC.JS
  // const settingsLink = document.getElementById('settings-link');
  // if (settingsLink) {
  //   settingsLink.onclick = function(event) {
  //     event.preventDefault();
  //     alert('管理页面即将推出！'); // Updated alert message
  //   };
  // }

  // Dock Toggle Button Click - MOVED TO DOCK_LOGIC.JS
  // const dockToggleBtn = document.getElementById('dock-toggle-btn');
  // const dock = document.getElementById('bottom-left-dock');
  // if (dockToggleBtn && dock) {
  //   // Restore collapsed state
  //   const dockCollapsedKey = `dockCollapsed_${docIdForLocalStorage}`;
  //   const isCollapsed = localStorage.getItem(dockCollapsedKey) === 'true';
  //   if (isCollapsed) {
  //     dock.classList.add('dock-collapsed');
  //     dockToggleBtn.innerHTML = '<i class="fa fa-chevron-up"></i>';
  //     dockToggleBtn.title = '展开';
  //   }

  //   dockToggleBtn.onclick = function(event) {
  //     event.preventDefault();
  //     const currentlyCollapsed = dock.classList.toggle('dock-collapsed');
  //     if (currentlyCollapsed) {
  //       this.innerHTML = '<i class="fa fa-chevron-up"></i>';
  //       this.title = '展开';
  //       localStorage.setItem(dockCollapsedKey, 'true');
  //     } else {
  //       this.innerHTML = '<i class="fa fa-chevron-down"></i>';
  //       this.title = '折叠';
  //       localStorage.setItem(dockCollapsedKey, 'false');
  //     }
  //   };
  // }
}

/**
 * 切换并显示指定的标签页内容。
 * - 更新标签按钮的激活状态 (`active` class)。
 * - 根据传入的 `tab` 参数 ( 'ocr', 'translation', 'chunk-compare' )，生成对应的 HTML 内容。
 * - OCR 和翻译标签页：直接渲染 `data.ocr` 或 `data.translation` 字段。
 * - 分块对比标签页 (`chunk-compare`)：
 *   - 检查 `data.ocrChunks` 和 `data.translatedChunks` 是否有效且数量匹配。
 *   - 如果有效，则为每一对原文/译文块生成对比视图。使用 `renderLevelAlignedFlex` 进行布局。
 *   - 提供一个按钮 (`#swap-chunks-btn`) 用于切换原文和译文在对比视图中的左右位置。
 *   - 如果分块数据无效，则显示提示信息。
 * - 将生成的 HTML 设置到 `#tabContent` 区域。
 * - 调用 `window.refreshTocList()` 更新目录（TOC）。
 *
 * @param {string} tab - 要显示的标签页标识符 ('ocr', 'translation', or 'chunk-compare')。
 */

