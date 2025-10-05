// js/ui/immersive_layout_logic.js
(function ImmersiveLayoutLogic(global) {
  let toggleBtn, immersiveContainer;
  let mainPageContainer, tocPopupElement, chatbotModalElement, dockElement;
  let immersiveTocArea, immersiveMainArea, immersiveChatbotArea, immersiveDockPlaceholderElement;
  let tocVsDockResizeHandle;
  let isTocDockResizing = false; // Flag to indicate dragging state
  let initialTocDockMouseY, initialTocHeight, initialDockHeight;

  // Original parent and next sibling of the elements to be moved
  let originalMainContainerParent = null;
  let originalMainContainerNextSibling = null;
  let originalTocPopupParent = null;
  let originalTocPopupNextSibling = null;
  let originalChatbotModalParent = null;
  let originalChatbotModalNextSibling = null;
  let originalDockElementParent = null;
  let originalDockElementNextSibling = null;

  let isImmersiveActive = false;
  const LS_IMMERSIVE_KEY = 'immersiveLayoutActive';
  const LS_PANEL_SIZES_KEY = 'immersivePanelSizes';

  function initializeDomElements() {
    toggleBtn = document.getElementById('toggle-immersive-btn');
    immersiveContainer = document.getElementById('immersive-layout-container');

    mainPageContainer = document.querySelector('.container');
    tocPopupElement = document.getElementById('toc-popup');
    chatbotModalElement = document.getElementById('chatbot-modal');
    dockElement = document.getElementById('bottom-left-dock');

    immersiveTocArea = document.getElementById('immersive-toc-area');
    immersiveMainArea = document.getElementById('immersive-main-content-area');
    immersiveChatbotArea = document.getElementById('immersive-chatbot-area');

    // Create the dock placeholder dynamically
    immersiveDockPlaceholderElement = document.createElement('div');
    immersiveDockPlaceholderElement.id = 'toc-dock-placeholder';
    // Basic styles can be applied here if not fully covered by CSS, or rely on CSS.
    // For now, CSS will handle styling based on the ID.

    return toggleBtn && immersiveContainer && mainPageContainer && tocPopupElement && immersiveTocArea && immersiveMainArea && immersiveChatbotArea && dockElement /* && immersiveDockPlaceholderElement (element itself exists, not a check if found in DOM here) */;
  }

  function reQueryDynamicElements() {
    if (!chatbotModalElement) {
        chatbotModalElement = document.getElementById('chatbot-modal');
    }
    if (!mainPageContainer) mainPageContainer = document.querySelector('.container');
    if (!tocPopupElement) tocPopupElement = document.getElementById('toc-popup');
    if (!dockElement) dockElement = document.getElementById('bottom-left-dock');
  }

  function storeOriginalPositions() {
    if (mainPageContainer) {
      originalMainContainerParent = mainPageContainer.parentNode;
      originalMainContainerNextSibling = mainPageContainer.nextSibling;
    }
    if (tocPopupElement) {
      originalTocPopupParent = tocPopupElement.parentNode;
      originalTocPopupNextSibling = tocPopupElement.nextSibling;
    }
    if (chatbotModalElement) {
      originalChatbotModalParent = chatbotModalElement.parentNode;
      originalChatbotModalNextSibling = chatbotModalElement.nextSibling;
    } else {
      console.warn('storeOriginalPositions: chatbotModalElement not found.');
    }
    if (dockElement) {
      originalDockElementParent = dockElement.parentNode;
      originalDockElementNextSibling = dockElement.nextSibling;
    } else {
      console.warn('storeOriginalPositions: dockElement not found.');
    }
  }

  function savePanelSizes() {
    if (!isImmersiveActive || !immersiveContainer || immersiveContainer.style.display === 'none') return;
    if (!immersiveTocArea || !immersiveMainArea || !immersiveChatbotArea) return;

    const tocWidth = immersiveTocArea.style.width;
    const mainWidth = immersiveMainArea.style.width;
    const chatbotWidth = immersiveChatbotArea.style.width;
    localStorage.setItem(LS_PANEL_SIZES_KEY, JSON.stringify({ toc: tocWidth, main: mainWidth, chatbot: chatbotWidth }));
  }

  function loadPanelSizes() {
    if (!immersiveTocArea || !immersiveMainArea || !immersiveChatbotArea) return;

    const savedSizes = localStorage.getItem(LS_PANEL_SIZES_KEY);
    if (savedSizes) {
      try {
        const sizes = JSON.parse(savedSizes);
        if (sizes.toc) immersiveTocArea.style.width = sizes.toc;
        if (sizes.chatbot) immersiveChatbotArea.style.width = sizes.chatbot;
      } catch (e) {
        console.error('Error loading panel sizes:', e);
        immersiveTocArea.style.width = '20%';
        immersiveMainArea.style.flex = '1';
        immersiveMainArea.style.width = '';
        immersiveChatbotArea.style.width = '25%';
      }
    } else {
      immersiveTocArea.style.width = '20%';
      immersiveMainArea.style.flex = '1';
      immersiveMainArea.style.width = '';
      immersiveChatbotArea.style.width = '25%';
    }
  }

  function initializeTocDockResizer() {
    if (!tocVsDockResizeHandle || !tocPopupElement || !immersiveDockPlaceholderElement || !immersiveTocArea) {
      console.warn("TOC vs Dock resizer: Missing one or more elements.");
      return;
    }

    // Ensure event listeners are not duplicated if called multiple times
    tocVsDockResizeHandle.removeEventListener('mousedown', handleTocDockDragStart);
    tocVsDockResizeHandle.addEventListener('mousedown', handleTocDockDragStart);
  }

  function handleTocDockDragStart(event) {
    event.preventDefault();
    isTocDockResizing = true;

    initialTocDockMouseY = event.clientY;
    initialTocHeight = tocPopupElement.offsetHeight;
    initialDockHeight = immersiveDockPlaceholderElement.offsetHeight;

    // Add class to body for global cursor/selection styles
    document.body.classList.add('toc-dock-resizing');

    // Add temporary flex-grow overrides if needed, or rely on flex-basis
    // tocPopupElement.style.flexGrow = '0';
    // immersiveDockPlaceholderElement.style.flexGrow = '0';


    document.addEventListener('mousemove', handleTocDockDragMove);
    document.addEventListener('mouseup', handleTocDockDragEnd);
  }

  function handleTocDockDragMove(event) {
    if (!isTocDockResizing) return;
    event.preventDefault();

    const deltaY = event.clientY - initialTocDockMouseY;
    let newTocHeight = initialTocHeight + deltaY;
    let newDockHeight = initialDockHeight - deltaY;

    const minPanelHeight = 40; // Minimum height for TOC and Dock panels

    // Constrain TOC height
    if (newTocHeight < minPanelHeight) {
      newTocHeight = minPanelHeight;
      // Recalculate dock height based on constrained TOC
      newDockHeight = initialTocHeight + initialDockHeight - newTocHeight;
    }

    // Constrain Dock height
    if (newDockHeight < minPanelHeight) {
      newDockHeight = minPanelHeight;
      // Recalculate TOC height based on constrained Dock
      newTocHeight = initialTocHeight + initialDockHeight - newDockHeight;
    }

    // Ensure total height of tocArea children doesn't exceed tocArea height if it's fixed
    // For flexbox, adjusting flex-basis is usually better.
    // The sum of newTocHeight and newDockHeight should ideally be initialTocHeight + initialDockHeight.
    // The logic above ensures this if one hits minPanelHeight.

    // Apply new heights using flex-basis for better control in a flex container
    tocPopupElement.style.flexBasis = newTocHeight + 'px';
    immersiveDockPlaceholderElement.style.flexBasis = newDockHeight + 'px';

    // If not using flex-basis, and want to force height and disable grow/shrink during drag:
    // tocPopupElement.style.height = newTocHeight + 'px';
    // immersiveDockPlaceholderElement.style.height = newDockHeight + 'px';
    // tocPopupElement.style.flexGrow = '0';
    // immersiveDockPlaceholderElement.style.flexGrow = '0';

  }

  function handleTocDockDragEnd() {
    if (!isTocDockResizing) return;
    isTocDockResizing = false;

    document.body.classList.remove('toc-dock-resizing');
    document.removeEventListener('mousemove', handleTocDockDragMove);
    document.removeEventListener('mouseup', handleTocDockDragEnd);

    // Restore original flex-grow properties if they were changed during drag
    // tocPopupElement.style.flexGrow = ''; // Or to its original value e.g., '10'
    // immersiveDockPlaceholderElement.style.flexGrow = ''; // Or to its original value e.g., '1'
    // However, since we are using flex-basis, the original flex-grow values from CSS should still apply
    // once flex-basis is set, unless grow/shrink are explicitly set to 0.
    // The CSS has flex-grow: 10 for toc and flex-grow: 1 for dock placeholder.
    // Setting flex-basis should work fine with these grow factors if space allows.

    // Optional: Save the new heights/proportions to localStorage
    // const tocAreaHeight = immersiveTocArea.offsetHeight;
    // if (tocAreaHeight > 0) {
    //   const tocRatio = tocPopupElement.offsetHeight / tocAreaHeight;
    //   localStorage.setItem('immersiveTocDockRatio', tocRatio.toFixed(4));
    // }
  }

  function destroyTocDockResizer() {
    if (tocVsDockResizeHandle) {
      tocVsDockResizeHandle.removeEventListener('mousedown', handleTocDockDragStart);
    }
    // Clean up global listeners if somehow left hanging (should be removed by handleTocDockDragEnd)
    document.removeEventListener('mousemove', handleTocDockDragMove);
    document.removeEventListener('mouseup', handleTocDockDragEnd);
    document.body.classList.remove('toc-dock-resizing');
    isTocDockResizing = false; // Reset flag
  }

  function enterImmersiveMode() {
    // 检查是否为移动端设备
    if (window.innerWidth <= 700) {
      console.warn('拒绝在移动端（≤700px）进入沉浸式布局');
      return;
    }

    reQueryDynamicElements();

    let missingElements = [];
    if (!immersiveContainer) missingElements.push('immersiveContainer');
    if (!mainPageContainer) missingElements.push('mainPageContainer');
    if (!tocPopupElement) missingElements.push('tocPopupElement');
    if (!chatbotModalElement) missingElements.push('chatbotModalElement');
    if (!dockElement) missingElements.push('dockElement');
    if (!immersiveTocArea) missingElements.push('immersiveTocArea');
    if (!immersiveMainArea) missingElements.push('immersiveMainArea');
    if (!immersiveChatbotArea) missingElements.push('immersiveChatbotArea');
    if (!immersiveDockPlaceholderElement) missingElements.push('immersiveDockPlaceholderElement (logic error if this happens)');

    if (missingElements.length > 0) {
      console.warn('Immersive mode elements not found:', missingElements.join(', '));
      return;
    }

    isImmersiveActive = true;
    storeOriginalPositions();

    // 添加进入动画类
    document.body.classList.add('immersive-entering');
    immersiveContainer.style.opacity = '0';
    immersiveContainer.style.transform = 'scale(0.95)';
    immersiveContainer.style.transition = 'opacity 0.4s ease, transform 0.4s ease';

    // Append TOC content first
    if (tocPopupElement && immersiveTocArea) {
        immersiveTocArea.appendChild(tocPopupElement);
    }

    // Create and insert the resize handle between TOC and Dock Placeholder
    if (immersiveTocArea) {
        if (!tocVsDockResizeHandle) { // Create if it doesn't exist
            tocVsDockResizeHandle = document.createElement('div');
            tocVsDockResizeHandle.id = 'toc-vs-dock-resize-handle';
        }
        if (tocPopupElement && tocPopupElement.parentNode === immersiveTocArea) {
            immersiveTocArea.insertBefore(tocVsDockResizeHandle, tocPopupElement.nextSibling);
        } else {
            immersiveTocArea.appendChild(tocVsDockResizeHandle);
        }
    }

    // Then append the dock placeholder to TOC area
    if (immersiveDockPlaceholderElement && immersiveTocArea) {
        if (tocVsDockResizeHandle && tocVsDockResizeHandle.parentNode === immersiveTocArea) {
            immersiveTocArea.insertBefore(immersiveDockPlaceholderElement, tocVsDockResizeHandle.nextSibling);
        } else {
            immersiveTocArea.appendChild(immersiveDockPlaceholderElement);
        }
    }

    // Move other elements
    if (mainPageContainer && immersiveMainArea) {
        immersiveMainArea.appendChild(mainPageContainer);
    }
    if (chatbotModalElement && immersiveChatbotArea) {
        immersiveChatbotArea.appendChild(chatbotModalElement);
    }

    // Move the actual dock into its placeholder
    if (dockElement && immersiveDockPlaceholderElement) {
        immersiveDockPlaceholderElement.appendChild(dockElement);

        // Force Dock to be expanded in immersive mode
        if (dockElement.classList.contains('dock-collapsed')) {
            dockElement.classList.remove('dock-collapsed');
            const dockToggleBtn = document.getElementById('dock-toggle-btn');
            if (dockToggleBtn) {
                dockToggleBtn.innerHTML = '<i class="fa fa-chevron-down"></i>';
                dockToggleBtn.title = '折叠';
            }
            if (typeof window !== 'undefined' && window.docIdForLocalStorage) {
                localStorage.setItem(`dockCollapsed_${window.docIdForLocalStorage}`, 'false');
            }
        }
    }

    document.body.classList.add('immersive-active', 'no-scroll');
    immersiveContainer.style.display = 'flex';
    
    // 简单的强制重新计算，修复初始化时的布局问题
    setTimeout(() => {
      if (immersiveContainer) {
        immersiveContainer.offsetHeight; // 触发重新布局
      }
    }, 0);
    
    // 动画进入效果
    requestAnimationFrame(() => {
      immersiveContainer.style.opacity = '1';
      immersiveContainer.style.transform = 'scale(1)';
      
      setTimeout(() => {
        document.body.classList.remove('immersive-entering');
        immersiveContainer.style.transition = '';
      }, 400);
    });

    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
      toggleBtn.classList.add('immersive-exit-btn-active');
      toggleBtn.title = '退出沉浸模式';
    }

    // 其他初始化逻辑保持不变...
    if (typeof window.refreshTocList === 'function') {
      window.refreshTocList();
    }
    if (window.ChatbotUI && typeof window.ChatbotUI.updateChatbotUI === 'function') {
      window.isChatbotOpen = true;
      window.isChatbotFullscreen = false;
      window.forceChatbotWidthReset = true;
      window.ChatbotUI.updateChatbotUI();
    }
    if (window.DockLogic && typeof window.DockLogic.updateStats === 'function' && window.data && window.currentVisibleTabId) {
        dockElement.style.display = '';
        window.DockLogic.updateStats(window.data, window.currentVisibleTabId);
    }

    setTimeout(() => {
        if (window.DockLogic) {
            if (typeof window.DockLogic.unbindScrollForCurrentScrollable === 'function') {
                console.log("[ImmersiveLayout] 进入沉浸模式前，先解绑旧的滚动事件");
                window.DockLogic.unbindScrollForCurrentScrollable();
            }
            if (typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
                console.log("[ImmersiveLayout] 进入沉浸模式后，延迟调用 forceUpdateReadingProgress");
                window.DockLogic.forceUpdateReadingProgress();
            }
        }
        
        // 强制修复沉浸模式下的布局问题
        if (immersiveMainArea) {
            const container = immersiveMainArea.querySelector('.container');
            if (container) {
                // 强制container为flex布局
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.height = '100%';
                
                const tabContent = container.querySelector('.tab-content');
                if (tabContent) {
                    // 强制tab-content正确填充
                    tabContent.style.display = 'flex';
                    tabContent.style.flexDirection = 'column';
                    tabContent.style.flex = '1';
                    tabContent.style.minHeight = '0';
                    tabContent.style.overflow = 'hidden';
                    
                    // 处理不同类型的内容容器
                    const contentWrapper = tabContent.querySelector('.content-wrapper');
                    const chunkCompareContainer = tabContent.querySelector('.chunk-compare-container');
                    
                    if (contentWrapper) {
                        contentWrapper.style.flex = '1';
                        contentWrapper.style.overflowY = 'auto';
                        contentWrapper.style.minHeight = '0';
                        contentWrapper.style.margin = '0';
                    }
                    
                    if (chunkCompareContainer) {
                        chunkCompareContainer.style.flex = '1';
                        chunkCompareContainer.style.overflowY = 'auto';
                        chunkCompareContainer.style.minHeight = '0';
                    }
                    
                    // 确保h3标题不参与flex计算
                    const h3Title = tabContent.querySelector('h3');
                    if (h3Title) {
                        h3Title.style.flex = 'none';
                        h3Title.style.marginTop = '0';
                        h3Title.style.marginBottom = '16px';
                    }
                }
            }
        }
    }, 300);

    // Force TOC to be expanded in immersive mode
    if (tocPopupElement && !tocPopupElement.classList.contains('toc-expanded')) {
      const tocExpandBtn = document.getElementById('toc-expand-btn');
      if (tocExpandBtn) {
        tocPopupElement.classList.add('toc-expanded');
        const icon = tocExpandBtn.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-angles-right');
          icon.classList.add('fa-angles-left');
        }
        tocExpandBtn.title = '收起目录';
      }
    }

    loadPanelSizes();
    initializeTocDockResizer();
    localStorage.setItem(LS_IMMERSIVE_KEY, 'true');
    document.dispatchEvent(new CustomEvent('immersiveModeEntered'));
  }

  function exitImmersiveMode() {
    reQueryDynamicElements();
    isImmersiveActive = false;

    // 添加退出动画
    document.body.classList.add('immersive-exiting');
    if (immersiveContainer) {
      immersiveContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      immersiveContainer.style.opacity = '0';
      immersiveContainer.style.transform = 'scale(0.98)';
    }

    setTimeout(() => {
      destroyTocDockResizer();

      // Remove the TOC vs Dock resize handle
      if (tocVsDockResizeHandle && tocVsDockResizeHandle.parentNode === immersiveTocArea) {
          immersiveTocArea.removeChild(tocVsDockResizeHandle);
      }

      // 恢复元素位置的逻辑保持不变...
      if (originalTocPopupParent && tocPopupElement && tocPopupElement.parentNode === immersiveTocArea) {
        originalTocPopupParent.insertBefore(tocPopupElement, originalTocPopupNextSibling);
      } else if (tocPopupElement && immersiveTocArea.contains(tocPopupElement)) {
          immersiveTocArea.removeChild(tocPopupElement);
          if (originalTocPopupParent) {
               originalTocPopupParent.insertBefore(tocPopupElement, originalTocPopupNextSibling);
          }
      }

      if (originalMainContainerParent && mainPageContainer && mainPageContainer.parentNode === immersiveMainArea) {
        originalMainContainerParent.insertBefore(mainPageContainer, originalMainContainerNextSibling);
      } else if (mainPageContainer && immersiveMainArea.contains(mainPageContainer)) {
          immersiveMainArea.removeChild(mainPageContainer);
          if (originalMainContainerParent) {
              originalMainContainerParent.insertBefore(mainPageContainer, originalMainContainerNextSibling);
          }
      }

      if (chatbotModalElement && originalChatbotModalParent && chatbotModalElement.parentNode === immersiveChatbotArea) {
        originalChatbotModalParent.insertBefore(chatbotModalElement, originalChatbotModalNextSibling);
      } else if (chatbotModalElement && immersiveChatbotArea.contains(chatbotModalElement)) {
         immersiveChatbotArea.removeChild(chatbotModalElement);
         if (originalChatbotModalParent) {
              originalChatbotModalParent.insertBefore(chatbotModalElement, originalChatbotModalNextSibling);
         }
      } else if (!chatbotModalElement && originalChatbotModalParent) {
        immersiveChatbotArea.innerHTML = '';
      }

      if (dockElement && originalDockElementParent) {
          if (immersiveDockPlaceholderElement && immersiveDockPlaceholderElement.contains(dockElement)) {
              immersiveDockPlaceholderElement.removeChild(dockElement);
          }
          originalDockElementParent.insertBefore(dockElement, originalDockElementNextSibling);
      } else if (dockElement && immersiveDockPlaceholderElement && immersiveDockPlaceholderElement.contains(dockElement)){
          immersiveDockPlaceholderElement.removeChild(dockElement);
      }

      document.body.classList.remove('immersive-active', 'no-scroll', 'immersive-exiting');
      if (immersiveContainer) {
        immersiveContainer.style.display = 'none';
        immersiveContainer.style.transition = '';
        immersiveContainer.style.opacity = '';
        immersiveContainer.style.transform = '';
      }
      
      if (toggleBtn) {
        toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
        toggleBtn.classList.remove('immersive-exit-btn-active');
        toggleBtn.title = '进入沉浸式布局';
      }

      // 其他退出逻辑保持不变...
      if (typeof window.refreshTocList === 'function') {
        window.refreshTocList();
      }

      if (typeof window.docIdForLocalStorage !== 'undefined' && window.docIdForLocalStorage) {
          const savedChatbotOpenState = localStorage.getItem(`chatbotOpenState_${window.docIdForLocalStorage}`);
          if (savedChatbotOpenState === 'true') {
              window.isChatbotOpen = true;
          } else if (savedChatbotOpenState === 'false') {
              window.isChatbotOpen = false;
          }
      }

      if (window.ChatbotUI && typeof window.ChatbotUI.updateChatbotUI === 'function') {
        window.ChatbotUI.updateChatbotUI();
      }

      if (window.DockLogic && typeof window.DockLogic.updateStats === 'function' && window.data && window.currentVisibleTabId) {
          dockElement.style.display = '';
          window.DockLogic.updateStats(window.data, window.currentVisibleTabId);
      }

      setTimeout(() => {
          if (window.DockLogic) {
              if (typeof window.DockLogic.unbindScrollForCurrentScrollable === 'function') {
                  console.log("[ImmersiveLayout] 退出沉浸模式前，先解绑旧的滚动事件");
                  window.DockLogic.unbindScrollForCurrentScrollable();
              }
              if (typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
                  console.log("[ImmersiveLayout] 退出沉浸模式后，延迟调用 forceUpdateReadingProgress");
                  window.DockLogic.forceUpdateReadingProgress();
              }
          }
      }, 300);

      localStorage.setItem(LS_IMMERSIVE_KEY, 'false');
      document.dispatchEvent(new CustomEvent('immersiveModeExited'));
    }, 300);
  }

  function initResizeHandles() {
    const handles = document.querySelectorAll('.immersive-resize-handle');
    let activeHandle = null;
    let startX, startWidthPrev, startWidthNext;

    handles.forEach(handle => {
      handle.addEventListener('mousedown', function(e) {
        activeHandle = this;
        startX = e.clientX;
        const prevPanelId = activeHandle.dataset.targetPrev;
        const nextPanelId = activeHandle.dataset.targetNext;
        const prevPanel = document.getElementById(prevPanelId);
        const nextPanel = document.getElementById(nextPanelId);

        if (!prevPanel || !nextPanel) {
          console.warn(`Resize panels not found: ${prevPanelId} or ${nextPanelId}`);
          activeHandle = null;
          return;
        }

        startWidthPrev = prevPanel.offsetWidth;
        startWidthNext = nextPanel.offsetWidth;

        document.body.classList.add('immersive-dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        e.preventDefault();
      });
    });

    document.addEventListener('mousemove', function(e) {
      if (!activeHandle) return;

      const dx = e.clientX - startX;
      const prevPanel = document.getElementById(activeHandle.dataset.targetPrev);
      const nextPanel = document.getElementById(activeHandle.dataset.targetNext);

      if (!prevPanel || !nextPanel) return;

      const newWidthPrev = startWidthPrev + dx;
      const newWidthNext = startWidthNext - dx;
      const minPanelWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--immersive-panel-min-width')) || 80;

      if (newWidthPrev >= minPanelWidth && newWidthNext >= minPanelWidth) {
        prevPanel.style.width = newWidthPrev + 'px';
        nextPanel.style.width = newWidthNext + 'px';
        
        // 平滑的过渡动画
        prevPanel.style.transition = 'none';
        nextPanel.style.transition = 'none';
      }
    });

    document.addEventListener('mouseup', function() {
      if (activeHandle) {
        savePanelSizes();

        // 恢复样式
        document.body.classList.remove('immersive-dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        // 恢复过渡动画
        const prevPanel = document.getElementById(activeHandle.dataset.targetPrev);
        const nextPanel = document.getElementById(activeHandle.dataset.targetNext);
        if (prevPanel) prevPanel.style.transition = '';
        if (nextPanel) nextPanel.style.transition = '';

        activeHandle = null;
      }
    });
  }

  function mainInit() {
    if (!initializeDomElements()) {
      console.warn('Immersive layout core static elements not found on DOMContentLoaded. Retrying shortly...');
      setTimeout(mainInit, 500);
      return;
    }

    reQueryDynamicElements();

    toggleBtn.addEventListener('click', () => {
      // 检查是否为移动端设备（屏幕宽度小于等于700px）
      if (window.innerWidth <= 700) {
        console.warn('沉浸式布局在移动端（≤700px）不可用');
        // 可选：显示提示消息
        if (window.showToast) {
          window.showToast('沉浸式布局在手机端不可用', 'warning');
        } else {
          alert('沉浸式布局在手机端不可用，请在更大的屏幕上使用');
        }
        return;
      }

      if (isImmersiveActive) {
        exitImmersiveMode();
      } else {
        enterImmersiveMode();
      }
    });

    initResizeHandles();

    // 监听窗口大小变化，如果变成移动端尺寸则自动退出沉浸模式
    function handleWindowResize() {
      if (window.innerWidth <= 700 && isImmersiveActive) {
        console.log('检测到屏幕缩小到移动端尺寸，自动退出沉浸式布局');
        exitImmersiveMode();
      }
    }

    // 添加窗口大小变化监听器
    window.addEventListener('resize', handleWindowResize);

    // Restore immersive state from localStorage
    const savedImmersiveState = localStorage.getItem(LS_IMMERSIVE_KEY);
    if (savedImmersiveState === 'true') {
      // 检查是否为移动端，如果是则不恢复沉浸模式
      if (window.innerWidth <= 700) {
        console.log('检测到移动端设备，不恢复沉浸式布局状态');
        localStorage.setItem(LS_IMMERSIVE_KEY, 'false'); // 清除保存的状态
        return;
      }
      
      // Slight delay to ensure other initializations (like TOC, Chatbot) can occur first
      // especially if they also interact with elements moved by immersive mode.
      setTimeout(() => {
        if (!isImmersiveActive) { // Check again in case of race conditions or manual toggle
            enterImmersiveMode();
        }
      }, 200); // Adjust delay if needed
    }

    console.log('Immersive layout logic initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mainInit);
  } else {
    mainInit();
  }

  global.ImmersiveLayout = {
    isActive: () => isImmersiveActive,
    enter: enterImmersiveMode,
    exit: exitImmersiveMode
  };

})(window);

