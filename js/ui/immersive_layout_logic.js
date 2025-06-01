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

    // Append TOC content first
    if (tocPopupElement && immersiveTocArea) {
        immersiveTocArea.appendChild(tocPopupElement);
    }

    // Create and insert the resize handle between TOC and Dock Placeholder
    if (immersiveTocArea) {
        if (!tocVsDockResizeHandle) { // Create if it doesn't exist
            tocVsDockResizeHandle = document.createElement('div');
            tocVsDockResizeHandle.id = 'toc-vs-dock-resize-handle';
            // Class name for styling (can also use ID)
            // tocVsDockResizeHandle.className = 'immersive-resize-handle-horizontal';
        }
        // Insert after tocPopupElement, if tocPopupElement is present and in immersiveTocArea
        if (tocPopupElement && tocPopupElement.parentNode === immersiveTocArea) {
            immersiveTocArea.insertBefore(tocVsDockResizeHandle, tocPopupElement.nextSibling);
        } else { // Fallback: append to immersiveTocArea if tocPopupElement isn't there or not yet moved
            immersiveTocArea.appendChild(tocVsDockResizeHandle);
        }
    }

    // Then append the dock placeholder to TOC area, it will be after the handle
    if (immersiveDockPlaceholderElement && immersiveTocArea) {
        // If tocVsDockResizeHandle is present and in immersiveTocArea, insert placeholder after it
        if (tocVsDockResizeHandle && tocVsDockResizeHandle.parentNode === immersiveTocArea) {
            immersiveTocArea.insertBefore(immersiveDockPlaceholderElement, tocVsDockResizeHandle.nextSibling);
        } else { // Fallback: append to immersiveTocArea if handle isn't there
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

    // Move the actual dock into its placeholder (which is now at the bottom of TOC area)
    if (dockElement && immersiveDockPlaceholderElement) {
        immersiveDockPlaceholderElement.appendChild(dockElement);

        // --- BEGIN: Force Dock to be expanded in immersive mode ---
        if (dockElement.classList.contains('dock-collapsed')) {
            dockElement.classList.remove('dock-collapsed');
            const dockToggleBtn = document.getElementById('dock-toggle-btn');
            if (dockToggleBtn) {
                dockToggleBtn.innerHTML = '<i class="fa fa-chevron-down"></i>'; // Icon for "expanded" state
                dockToggleBtn.title = '折叠';
            }
            // Update localStorage if DockLogic uses it for collapsed state
            if (typeof window !== 'undefined' && window.docIdForLocalStorage) {
                localStorage.setItem(`dockCollapsed_${window.docIdForLocalStorage}`, 'false');
            }
        }
        // --- END: Force Dock to be expanded ---
    }

    document.body.classList.add('immersive-active', 'no-scroll');
    immersiveContainer.style.display = 'flex';
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
      toggleBtn.classList.add('immersive-exit-btn-active');
      toggleBtn.title = '退出沉浸模式';
    }

    if (typeof window.refreshTocList === 'function') {
      window.refreshTocList();
    }
    // 沉浸式下AI助手始终为开，不写localStorage，不影响普通模式
    if (window.ChatbotUI && typeof window.ChatbotUI.updateChatbotUI === 'function') {
      window.isChatbotOpen = true; // 只在沉浸式下强制为开
      window.isChatbotFullscreen = false;
      window.forceChatbotWidthReset = true;
      window.ChatbotUI.updateChatbotUI();
    }
    if (window.DockLogic && typeof window.DockLogic.updateStats === 'function' && window.data && window.currentVisibleTabId) {
        dockElement.style.display = '';
        window.DockLogic.updateStats(window.data, window.currentVisibleTabId);
    }
    if (window.DockLogic && typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
        window.DockLogic.forceUpdateReadingProgress();
    }

    // --- BEGIN: Force TOC to be expanded in immersive mode ---
    if (tocPopupElement && !tocPopupElement.classList.contains('toc-expanded')) {
      const tocExpandBtn = document.getElementById('toc-expand-btn'); // As per toc_logic.js
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
    // --- END: Force TOC to be expanded ---

    loadPanelSizes();
    initializeTocDockResizer(); // Initialize resizer for TOC vs Dock
    localStorage.setItem(LS_IMMERSIVE_KEY, 'true');
    document.dispatchEvent(new CustomEvent('immersiveModeEntered'));
  }

  function exitImmersiveMode() {
    reQueryDynamicElements();
    isImmersiveActive = false;

    destroyTocDockResizer(); // Destroy resizer for TOC vs Dock

    // Remove the TOC vs Dock resize handle if it exists
    if (tocVsDockResizeHandle && tocVsDockResizeHandle.parentNode === immersiveTocArea) {
        immersiveTocArea.removeChild(tocVsDockResizeHandle);
        // tocVsDockResizeHandle = null; // Optional: allow it to be recreated or keep reference
    }

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

    document.body.classList.remove('immersive-active', 'no-scroll');
    if (immersiveContainer) immersiveContainer.style.display = 'none';
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
      toggleBtn.classList.remove('immersive-exit-btn-active');
      toggleBtn.title = '进入沉浸式布局';
    }

    if (typeof window.refreshTocList === 'function') {
      window.refreshTocList();
    }

    // Restore chatbot state for normal mode from localStorage BEFORE updating UI
    if (typeof window.docIdForLocalStorage !== 'undefined' && window.docIdForLocalStorage) {
        const savedChatbotOpenState = localStorage.getItem(`chatbotOpenState_${window.docIdForLocalStorage}`);
        if (savedChatbotOpenState === 'true') {
            window.isChatbotOpen = true;
        } else if (savedChatbotOpenState === 'false') {
            window.isChatbotOpen = false;
        } else {
            // Optional: Default to false if no state is saved for normal mode
            // window.isChatbotOpen = false;
        }
    }

    // Update Chatbot UI based on the now restored (or default) window.isChatbotOpen state
    if (window.ChatbotUI && typeof window.ChatbotUI.updateChatbotUI === 'function') {
      window.ChatbotUI.updateChatbotUI();
    }

    if (window.DockLogic && typeof window.DockLogic.updateStats === 'function' && window.data && window.currentVisibleTabId) {
        dockElement.style.display = '';
        window.DockLogic.updateStats(window.data, window.currentVisibleTabId);
    }
    if (window.DockLogic && typeof window.DockLogic.forceUpdateReadingProgress === 'function') {
        window.DockLogic.forceUpdateReadingProgress();
    }

    localStorage.setItem(LS_IMMERSIVE_KEY, 'false');
    document.dispatchEvent(new CustomEvent('immersiveModeExited'));
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
      const minPanelWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--immersive-panel-min-width')) || 50;

      if (newWidthPrev >= minPanelWidth && newWidthNext >= minPanelWidth) {
        prevPanel.style.width = newWidthPrev + 'px';
        nextPanel.style.width = newWidthNext + 'px';
      }
    });

    document.addEventListener('mouseup', function() {
      if (activeHandle) {
        savePanelSizes();
        activeHandle = null;
        document.body.classList.remove('immersive-dragging');
        document.body.style.userSelect = '';
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
      if (isImmersiveActive) {
        exitImmersiveMode();
      } else {
        enterImmersiveMode();
      }
    });

    initResizeHandles();

    // Restore immersive state from localStorage
    const savedImmersiveState = localStorage.getItem(LS_IMMERSIVE_KEY);
    if (savedImmersiveState === 'true') {
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

