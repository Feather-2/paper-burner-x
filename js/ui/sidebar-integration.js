/**
 * Sidebar Integration - 侧边栏集成模块
 *
 * 职责：
 * 1. 从原有 TOC 数据同步到侧边栏 TOC
 * 2. 从原有 Dock 统计同步到侧边栏统计
 * 3. 处理侧边栏折叠/展开（桌面端）
 * 4. 处理侧边栏显示/隐藏（移动端）
 * 5. 处理可折叠区域的展开/收起
 * 6. 保持状态到 localStorage
 *
 * 注意：仅在非沉浸模式下工作，沉浸模式不受影响
 */

(function() {
  'use strict';

  // ==================== 配置 ====================

  const CONFIG = {
    storageKeys: {
      sidebarCollapsed: 'pbx_sidebar_collapsed',
      tocSectionExpanded: 'pbx_sidebar_toc_expanded'
    },
    selectors: {
      // Sidebar
      appShell: '#app-shell',
      appSidebar: '#appSidebar',
      sidebarOverlay: '#sidebarOverlay',
      sidebarToggleBtn: '#sidebarToggleBtn',
      sidebarToggleIcon: '#sidebarToggleIcon',
      sidebarCloseBtn: '#sidebarCloseBtn',
      mobileMenuBtn: '#mobileMenuBtn',
      sidebarLogo: '#sidebarLogo',
      sidebarSettingsLink: '#sidebarSettingsLink',

      // TOC Section
      sidebarTocSection: '#sidebarTocSection',
      sidebarTocToggle: '#sidebarTocToggle',
      sidebarTocList: '#sidebarTocList',
      originalTocList: '#toc-list',

      // Sidebar Footer Stats (紧凑布局)
      sidebarReadingProgress: '#sidebarReadingProgress',
      sidebarHighlightCount: '#sidebarHighlightCount',
      sidebarAnnotationCount: '#sidebarAnnotationCount',
      sidebarImageCount: '#sidebarImageCount',
      sidebarFormulaCount: '#sidebarFormulaCount',
      sidebarTableCount: '#sidebarTableCount',
      sidebarWordCount: '#sidebarWordCount',
      sidebarReferenceCount: '#sidebarReferenceCount',

      // Original Dock Elements
      originalReadingProgress: '#reading-progress-percentage-verbose',
      originalHighlightCount: '#highlight-count',
      originalAnnotationCount: '#annotation-count',
      originalImageCount: '#image-count',
      originalFormulaCount: '#formula-count',
      originalTableCount: '#table-count',
      originalWordCount: '#total-word-count',
      originalReferenceCount: '#reference-count',

      // Immersive Mode
      immersiveContainer: '#immersive-layout-container',
      immersiveToggleBtn: '#toggle-immersive-btn',

      // Settings Link
      originalSettingsLink: '#settings-link'
    },
    logos: {
      full: '../../public/h_with_name.svg',
      pure: '../../public/pure.svg'
    }
  };

  // ==================== 状态管理 ====================

  let isImmersiveMode = false;
  let isMobile = window.innerWidth < 768;

  // ==================== DOM 元素缓存 ====================

  const elements = {};

  /**
   * 初始化 DOM 元素缓存
   */
  function cacheElements() {
    for (const [key, selector] of Object.entries(CONFIG.selectors)) {
      elements[key] = document.querySelector(selector);
    }
  }

  // ==================== 侧边栏显示/隐藏 ====================

  /**
   * 显示或隐藏 App Shell（根据沉浸模式）
   */
  function updateAppShellVisibility() {
    if (!elements.appShell) return;

    if (isImmersiveMode) {
      elements.appShell.style.display = 'none';
    } else {
      elements.appShell.style.display = 'flex';
    }
  }

  /**
   * 监听沉浸模式切换
   */
  function watchImmersiveMode() {
    if (!elements.immersiveContainer) return;

    // 使用 MutationObserver 监听 display 样式变化
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const display = elements.immersiveContainer.style.display;
          const newImmersiveState = (display !== 'none');

          if (newImmersiveState !== isImmersiveMode) {
            isImmersiveMode = newImmersiveState;
            updateAppShellVisibility();
            console.log('[Sidebar] Immersive mode:', isImmersiveMode ? 'ON' : 'OFF');
          }
        }
      });
    });

    observer.observe(elements.immersiveContainer, {
      attributes: true,
      attributeFilter: ['style']
    });

    // 初始状态
    const initialDisplay = elements.immersiveContainer.style.display;
    isImmersiveMode = (initialDisplay !== 'none');
    updateAppShellVisibility();
  }

  // ==================== 桌面端侧边栏折叠 ====================

  /**
   * 设置侧边栏折叠状态
   * @param {boolean} collapsed - 是否折叠
   */
  function setSidebarCollapsed(collapsed) {
    if (!elements.appSidebar || !elements.sidebarLogo) return;

    if (collapsed) {
      elements.appSidebar.classList.add('collapsed');
      elements.sidebarLogo.src = CONFIG.logos.pure;
      // 切换图标为"打开"图标
      if (elements.sidebarToggleIcon) {
        elements.sidebarToggleIcon.setAttribute('icon', 'carbon:side-panel-open');
      }
    } else {
      elements.appSidebar.classList.remove('collapsed');
      elements.sidebarLogo.src = CONFIG.logos.full;
      // 切换图标为"关闭"图标
      if (elements.sidebarToggleIcon) {
        elements.sidebarToggleIcon.setAttribute('icon', 'carbon:side-panel-close');
      }
    }

    // 保存状态
    localStorage.setItem(CONFIG.storageKeys.sidebarCollapsed, collapsed.toString());
  }

  /**
   * 初始化桌面端折叠状态
   */
  function initDesktopCollapse() {
    if (!elements.sidebarToggleBtn) return;

    // 从 localStorage 读取状态
    const savedState = localStorage.getItem(CONFIG.storageKeys.sidebarCollapsed);
    const isCollapsed = savedState === 'true';
    setSidebarCollapsed(isCollapsed);

    // 绑定切换按钮
    elements.sidebarToggleBtn.addEventListener('click', () => {
      const currentlyCollapsed = elements.appSidebar.classList.contains('collapsed');
      setSidebarCollapsed(!currentlyCollapsed);
    });
  }

  // ==================== 移动端侧边栏显示/隐藏 ====================

  /**
   * 打开移动端侧边栏
   */
  function openMobileSidebar() {
    if (!elements.appSidebar || !elements.sidebarOverlay) return;

    elements.appSidebar.classList.add('mobile-open');
    elements.sidebarOverlay.classList.add('show');
  }

  /**
   * 关闭移动端侧边栏
   */
  function closeMobileSidebar() {
    if (!elements.appSidebar || !elements.sidebarOverlay) return;

    elements.appSidebar.classList.remove('mobile-open');
    elements.sidebarOverlay.classList.remove('show');
  }

  /**
   * 初始化移动端侧边栏
   */
  function initMobileSidebar() {
    // 绑定打开按钮
    if (elements.mobileMenuBtn) {
      elements.mobileMenuBtn.addEventListener('click', openMobileSidebar);
    }

    // 绑定关闭按钮
    if (elements.sidebarCloseBtn) {
      elements.sidebarCloseBtn.addEventListener('click', closeMobileSidebar);
    }

    // 绑定遮罩层点击关闭
    if (elements.sidebarOverlay) {
      elements.sidebarOverlay.addEventListener('click', closeMobileSidebar);
    }
  }

  // ==================== 可折叠区域 ====================

  /**
   * 切换可折叠区域的展开/收起状态
   * @param {HTMLElement} section - 区域元素
   * @param {string} storageKey - localStorage 键名
   */
  function toggleSection(section, storageKey) {
    if (!section) return;

    const isExpanded = section.classList.contains('expanded');
    const newState = !isExpanded;

    if (newState) {
      section.classList.add('expanded');
    } else {
      section.classList.remove('expanded');
    }

    // 保存状态
    if (storageKey) {
      localStorage.setItem(storageKey, newState.toString());
    }
  }

  /**
   * 初始化可折叠区域
   * @param {string} sectionSelector - 区域选择器
   * @param {string} toggleSelector - 切换按钮选择器
   * @param {string} storageKey - localStorage 键名
   */
  function initCollapsibleSection(sectionSelector, toggleSelector, storageKey) {
    const section = document.querySelector(sectionSelector);
    const toggle = document.querySelector(toggleSelector);

    if (!section || !toggle) return;

    // 从 localStorage 读取状态
    const savedState = localStorage.getItem(storageKey);
    const isExpanded = savedState !== 'false'; // 默认展开

    if (isExpanded) {
      section.classList.add('expanded');
    } else {
      section.classList.remove('expanded');
    }

    // 绑定切换按钮
    toggle.addEventListener('click', () => {
      toggleSection(section, storageKey);
    });
  }

  // ==================== TOC 数据同步 ====================

  /**
   * 从原有 TOC 同步数据到侧边栏 TOC
   */
  function syncTocData() {
    if (!elements.originalTocList || !elements.sidebarTocList) return;

    const originalItems = elements.originalTocList.querySelectorAll('li');

    if (originalItems.length === 0) {
      // 显示空状态
      elements.sidebarTocList.innerHTML = `
        <li class="sidebar-empty-state">
          <div class="sidebar-empty-icon">📄</div>
          <div>暂无目录</div>
        </li>
      `;
      return;
    }

    // 清空现有内容
    elements.sidebarTocList.innerHTML = '';

    // 复制 TOC 项目
    originalItems.forEach(item => {
      const originalLink = item.querySelector('a');
      if (!originalLink) return;

      // 获取并清理文本内容
      const text = originalLink.textContent.trim();
      const href = originalLink.href;

      // 跳过占位符和空标题
      // 1. 空标题
      // 2. "未命名章节"占位符
      // 3. placeholder- 开头的ID（占位符标识）
      if (!text ||
          text === '未命名章节' ||
          text === 'undefined' ||
          text === 'null' ||
          href.includes('#placeholder-')) {
        return;
      }

      const li = document.createElement('li');
      li.className = 'sidebar-toc-item';

      // 复制层级类（toc-h2, toc-h3 等）
      for (const className of item.classList) {
        if (className.startsWith('toc-')) {
          li.classList.add(className);
        }
      }

      const link = document.createElement('a');
      link.href = href;
      link.className = 'sidebar-toc-link';
      link.textContent = text; // 使用清理后的文本

      // 复制 active 状态
      if (originalLink.classList.contains('active')) {
        link.classList.add('active');
      }

      // 绑定点击事件（跳转后自动关闭移动端侧边栏）
      link.addEventListener('click', (e) => {
        // 触发原有 TOC 链接的点击事件（保持原有滚动逻辑）
        originalLink.click();
        e.preventDefault();

        // 移动端关闭侧边栏
        if (isMobile) {
          closeMobileSidebar();
        }
      });

      li.appendChild(link);
      elements.sidebarTocList.appendChild(li);
    });
  }

  /**
   * 监听原有 TOC 的变化并同步
   */
  function watchTocChanges() {
    if (!elements.originalTocList) return;

    // 使用 MutationObserver 监听 TOC 列表的变化
    const observer = new MutationObserver(() => {
      syncTocData();
    });

    observer.observe(elements.originalTocList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'] // 监听 active 类变化
    });

    // 初始同步
    syncTocData();
  }

  // ==================== Dock 数据同步 ====================

  /**
   * 同步单个统计数据
   * @param {string} originalSelector - 原始元素选择器
   * @param {string} sidebarSelector - 侧边栏元素选择器
   * @param {string} suffix - 后缀（如 '%'）
   */
  function syncStat(originalSelector, sidebarSelector, suffix = '') {
    const originalEl = document.querySelector(originalSelector);
    const sidebarEl = document.querySelector(sidebarSelector);

    if (!originalEl || !sidebarEl) return;

    let value = originalEl.textContent.trim();

    // 如果需要添加后缀，先检查是否已存在
    if (suffix && !value.endsWith(suffix)) {
      value = value + suffix;
    }

    sidebarEl.textContent = value;
  }

  /**
   * 检查 Dock 数据是否已初始化（不全是 0）
   */
  function isDockDataReady() {
    const wordCountEl = document.querySelector(CONFIG.selectors.originalWordCount);
    const wordCount = wordCountEl?.textContent.trim();

    // 如果总字数不是 0，说明 Dock 数据已计算完成
    // 总字数是最可靠的指标，因为任何文档都应该有字数
    return wordCount && wordCount !== '0';
  }

  /**
   * 同步所有 Dock 统计数据到侧边栏
   */
  function syncDockData() {
    console.log('[Sidebar] Syncing Dock data...');
    syncStat(CONFIG.selectors.originalReadingProgress, CONFIG.selectors.sidebarReadingProgress, '%');
    syncStat(CONFIG.selectors.originalHighlightCount, CONFIG.selectors.sidebarHighlightCount);
    syncStat(CONFIG.selectors.originalAnnotationCount, CONFIG.selectors.sidebarAnnotationCount);
    syncStat(CONFIG.selectors.originalImageCount, CONFIG.selectors.sidebarImageCount);
    syncStat(CONFIG.selectors.originalFormulaCount, CONFIG.selectors.sidebarFormulaCount);
    syncStat(CONFIG.selectors.originalTableCount, CONFIG.selectors.sidebarTableCount);
    syncStat(CONFIG.selectors.originalWordCount, CONFIG.selectors.sidebarWordCount);
    syncStat(CONFIG.selectors.originalReferenceCount, CONFIG.selectors.sidebarReferenceCount);

    // 调试：输出同步后的值
    const progressEl = document.querySelector(CONFIG.selectors.sidebarReadingProgress);
    const highlightEl = document.querySelector(CONFIG.selectors.sidebarHighlightCount);
    const wordCountEl = document.querySelector(CONFIG.selectors.sidebarWordCount);
    console.log('[Sidebar] Synced values - Progress:', progressEl?.textContent, 'Highlights:', highlightEl?.textContent, 'Words:', wordCountEl?.textContent);
  }

  /**
   * 监听原有 Dock 的变化并同步
   */
  function watchDockChanges() {
    // 使用 MutationObserver 监听 Dock 元素的变化
    const observer = new MutationObserver(() => {
      syncDockData();
    });

    // 监听所有原始统计元素
    const selectors = [
      CONFIG.selectors.originalReadingProgress,
      CONFIG.selectors.originalHighlightCount,
      CONFIG.selectors.originalAnnotationCount,
      CONFIG.selectors.originalImageCount,
      CONFIG.selectors.originalFormulaCount,
      CONFIG.selectors.originalTableCount,
      CONFIG.selectors.originalWordCount,
      CONFIG.selectors.originalReferenceCount
    ];

    selectors.forEach(selector => {
      const el = document.querySelector(selector);
      if (el) {
        observer.observe(el, {
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    });

    // 智能初始同步：等待 Dock 数据初始化完成
    let retryCount = 0;
    const maxRetries = 20; // 最多重试 20 次
    const retryDelay = 200; // 每次间隔 200ms

    function attemptInitialSync() {
      if (isDockDataReady()) {
        console.log('[Sidebar] Dock data is ready, syncing now');
        syncDockData();
      } else {
        retryCount++;
        if (retryCount < maxRetries) {
          console.log(`[Sidebar] Dock data not ready yet, retry ${retryCount}/${maxRetries} in ${retryDelay}ms...`);
          setTimeout(attemptInitialSync, retryDelay);
        } else {
          console.warn('[Sidebar] Dock data still not ready after max retries, syncing anyway');
          syncDockData();
        }
      }
    }

    // 开始尝试初始同步
    attemptInitialSync();
  }

  // ==================== 设置链接 ====================

  /**
   * 绑定侧边栏设置链接到原有设置链接
   */
  function bindSettingsLink() {
    if (!elements.sidebarSettingsLink || !elements.originalSettingsLink) return;

    elements.sidebarSettingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      elements.originalSettingsLink.click();

      // 移动端关闭侧边栏
      if (isMobile) {
        closeMobileSidebar();
      }
    });
  }

  // ==================== 可点击统计项 ====================

  /**
   * 绑定可点击统计项（高亮、批注）
   */
  function bindClickableStats() {
    const clickableStats = document.querySelectorAll('.sidebar-quick-stat');

    clickableStats.forEach(stat => {
      stat.addEventListener('click', () => {
        const statType = stat.dataset.statType;
        const originalStat = document.querySelector(`.stat-item-clickable[data-stat-type="${statType}"]`);

        if (originalStat && statType) {
          // 触发原有统计项的点击事件
          originalStat.click();

          // 移动端关闭侧边栏
          if (isMobile) {
            closeMobileSidebar();
          }
        }
      });
    });
  }

  // ==================== 响应式处理 ====================

  /**
   * 处理窗口大小变化
   */
  function handleResize() {
    const newIsMobile = window.innerWidth < 768;

    if (newIsMobile !== isMobile) {
      isMobile = newIsMobile;

      // 切换到桌面端时，关闭移动端侧边栏
      if (!isMobile) {
        closeMobileSidebar();
      }
    }
  }

  // ==================== 初始化 ====================

  /**
   * 初始化侧边栏集成模块
   */
  function init() {
    console.log('[Sidebar] Initializing sidebar integration...');

    // 缓存 DOM 元素
    cacheElements();

    // 监听沉浸模式切换
    watchImmersiveMode();

    // 初始化桌面端折叠功能
    initDesktopCollapse();

    // 初始化移动端侧边栏
    initMobileSidebar();

    // 初始化可折叠区域
    initCollapsibleSection(
      CONFIG.selectors.sidebarTocSection,
      CONFIG.selectors.sidebarTocToggle,
      CONFIG.storageKeys.tocSectionExpanded
    );

    // 监听 TOC 变化并同步
    watchTocChanges();

    // 监听 Dock 变化并同步
    watchDockChanges();

    // 绑定设置链接
    bindSettingsLink();

    // 绑定可点击统计项
    bindClickableStats();

    // 监听窗口大小变化
    window.addEventListener('resize', handleResize);

    console.log('[Sidebar] Sidebar integration initialized successfully');
  }

  // ==================== 导出 ====================

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 导出到全局（供调试使用）
  window.SidebarIntegration = {
    syncTocData,
    syncDockData,
    openMobileSidebar,
    closeMobileSidebar,
    setSidebarCollapsed
  };

})();
