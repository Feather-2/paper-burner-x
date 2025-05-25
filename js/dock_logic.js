// js/dock_logic.js
(function DockLogic(global) { // 传入 window
    // --- DOM Elements ---
    let dockElement = null;
    let progressPercentageSpan = null; // For collapsed display
    let progressPercentageVerboseSpan = null; // For expanded display
    let highlightCountElement = null;
    let annotationCountElement = null;
    let imageCountElement = null;
    let tableCountElement = null;
    let formulaCountElement = null;
    let totalWordCountElement = null;
    let dockToggleBtn = null;
    let settingsLink = null;

    // --- State ---
    let currentDocId = null;
    let currentVisibleTabIdForDock = null; // ADDED: To store current tab for dock logic
    let dockDisplayConfig = {
        readingProgress: true,
        highlights: true,
        annotations: true,
        images: true,
        tables: true,
        formulas: true,
        words: true
    };

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }

    function _updateReadingProgress() {
        if (!progressPercentageSpan || !progressPercentageVerboseSpan || !dockElement) {
            // console.warn("Dock progress elements not ready for updateReadingProgress");
            return;
        }

        const scrollTop = document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;

        if (scrollHeight <= clientHeight) { // Content fits viewport, no scrollbar
            progressPercentageSpan.textContent = '100';
            progressPercentageVerboseSpan.textContent = '100';
            dockElement.classList.add('visible');
            return;
        }

        const maxScrollTop = scrollHeight - clientHeight;
        const scrollFraction = maxScrollTop > 0 ? (scrollTop / maxScrollTop) : 0;
        const percentage = Math.min(100, Math.max(0, Math.round(scrollFraction * 100)));

        progressPercentageSpan.textContent = percentage;
        progressPercentageVerboseSpan.textContent = percentage;
        dockElement.classList.add('visible');
    }
    // Expose debounced version for scroll event
    const debouncedUpdateReadingProgress = debounce(_updateReadingProgress, 100);


    function _updateHighlightSummary(docData) {
      if (highlightCountElement && docData && Array.isArray(docData.annotations)) {
        const count = docData.annotations.filter(ann => ann.highlightColor).length;
        highlightCountElement.textContent = count;
      } else if (highlightCountElement) {
        highlightCountElement.textContent = '0';
      }
    }

    function _updateAnnotationSummary(docData) {
      if (annotationCountElement && docData && Array.isArray(docData.annotations)) {
        const count = docData.annotations.filter(ann =>
          ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== '' && ann.motivation === 'commenting'
        ).length;
        annotationCountElement.textContent = count;
      } else if (annotationCountElement) {
        annotationCountElement.textContent = '0';
      }
    }

    function _updateImageCount(docData) {
      if (imageCountElement && docData && docData.images) {
        imageCountElement.textContent = docData.images.length;
      } else if (imageCountElement) {
        imageCountElement.textContent = '0';
      }
    }

    function _updateTableCount(contentElement) {
      if (tableCountElement && contentElement) {
        const tables = contentElement.getElementsByTagName('table');
        tableCountElement.textContent = tables.length;
      } else if (tableCountElement) {
        tableCountElement.textContent = '0';
      }
    }

    function _updateFormulaCount(contentElement) {
      if (formulaCountElement && contentElement) {
        const katexElements = contentElement.querySelectorAll('.katex, .katex-display');
        const mermaidElements = contentElement.querySelectorAll('.mermaid > svg'); // Mermaid renders an SVG
        formulaCountElement.textContent = katexElements.length + mermaidElements.length;
      } else if (formulaCountElement) {
        formulaCountElement.textContent = '0';
      }
    }

    function _updateWordCount(contentElement) {
      if (totalWordCountElement && contentElement) {
        const text = contentElement.textContent || contentElement.innerText || "";
        const charCount = text.replace(/\s/g, '').length; // Count non-whitespace characters
        totalWordCountElement.textContent = charCount > 0 ? charCount : '0';
      } else if (totalWordCountElement) {
        totalWordCountElement.textContent = '0';
      }
    }

    /**
     * Updates all statistics displayed in the dock.
     * @param {Object} docData - The main data object for the current document.
     * @param {string} currentVisibleTabId - The ID of the currently visible tab (e.g., 'ocr', 'translation').
     */
    function _updateAllDockStats(docData, currentVisibleTabId) {
      currentVisibleTabIdForDock = currentVisibleTabId; // UPDATE internal state

      if (!docData) {
        // console.warn("Doc data not available for updating dock stats.");
        // Optionally clear all stats
        if(highlightCountElement) highlightCountElement.textContent = '0';
        if(annotationCountElement) annotationCountElement.textContent = '0';
        if(imageCountElement) imageCountElement.textContent = '0';
        if(tableCountElement) tableCountElement.textContent = '0';
        if(formulaCountElement) formulaCountElement.textContent = '0';
        if(totalWordCountElement) totalWordCountElement.textContent = '0';

        _applyDisplayConfigToElements(); // Apply config even with no data
        return;
      }

      // Handle highlights and annotations based on tab
      if (currentVisibleTabIdForDock === 'chunk-compare') {
        if (highlightCountElement) highlightCountElement.textContent = '0';
        if (annotationCountElement) annotationCountElement.textContent = '0';
        // These will be hidden by _applyDisplayConfigToElements's override
      } else {
        // OCR or Translation tabs: update based on config and data
        if (dockDisplayConfig.highlights) _updateHighlightSummary(docData);
        if (dockDisplayConfig.annotations) _updateAnnotationSummary(docData);
      }

      // Handle images (always based on docData, visibility by config + override)
      if (dockDisplayConfig.images) {
        _updateImageCount(docData);
      }
      // Other stats like tables, formulas, words depend on activeContentElement

      let activeContentElement = null;
      if (currentVisibleTabIdForDock === 'ocr' && document.getElementById('ocr-content-wrapper')) {
        activeContentElement = document.getElementById('ocr-content-wrapper');
      } else if (currentVisibleTabIdForDock === 'translation' && document.getElementById('translation-content-wrapper')) {
        activeContentElement = document.getElementById('translation-content-wrapper');
      }

      if (activeContentElement) { // OCR or Translation content is active
        if (dockDisplayConfig.tables) _updateTableCount(activeContentElement);
        if (dockDisplayConfig.formulas) _updateFormulaCount(activeContentElement);
        if (dockDisplayConfig.words) _updateWordCount(activeContentElement);
      } else { // No active OCR/Translation content (e.g., chunk-compare or error)
        if (tableCountElement) tableCountElement.textContent = '0';
        if (formulaCountElement) formulaCountElement.textContent = '0';
        if (totalWordCountElement) totalWordCountElement.textContent = '0';
      }

      // Finally, apply display styles based on the config for all elements,
      // respecting the chunk-compare override for highlights/annotations.
      _applyDisplayConfigToElements();
    }

    /**
     * Applies the current display configuration to the DOM elements.
     * Overrides highlights and annotations to be hidden if in 'chunk-compare' mode.
     */
    function _applyDisplayConfigToElements() {
        const elementsMap = {
            readingProgress: [progressPercentageVerboseSpan, progressPercentageSpan],
            highlights: [highlightCountElement],
            annotations: [annotationCountElement],
            images: [imageCountElement],
            tables: [tableCountElement],
            formulas: [formulaCountElement],
            words: [totalWordCountElement]
        };

        const wrapperSelectors = {
            readingProgress: '.dock-stat-item-wrapper-progress',
            highlights: '.dock-stat-item-wrapper-highlight',
            annotations: '.dock-stat-item-wrapper-annotation',
            images: '.dock-stat-item-wrapper-img',
            tables: '.dock-stat-item-wrapper-tbl',
            formulas: '.dock-stat-item-wrapper-formula',
            words: '.dock-stat-item-wrapper-words'
        };

        for (const key in dockDisplayConfig) {
            let originalShouldShow = dockDisplayConfig[key];
            let effectiveShouldShow = originalShouldShow; // By default, respect the config

            // MODIFIED OVERRIDE for 'chunk-compare' mode
            if (currentVisibleTabIdForDock === 'chunk-compare') {
                if (key === 'readingProgress') {
                    // For readingProgress in chunk-compare, respect its specific config value.
                    // If user explicitly turned off readingProgress via config, it stays off.
                    effectiveShouldShow = dockDisplayConfig.readingProgress;
                } else {
                    // For all other stats in chunk-compare mode (highlights, annotations, images, etc.), force hide.
                    effectiveShouldShow = false;
                }
            }
            // If not in chunk-compare mode, effectiveShouldShow remains as originalShouldShow from the user's config.

            const shouldShow = effectiveShouldShow;
            const wrapperSelector = wrapperSelectors[key];
            const statElements = elementsMap[key];

            if (wrapperSelector) {
                // Attempt to find the wrapper. Note: verbose progress is in one column, simple in another element.
                let wrapperEl = null;
                if (key === 'readingProgress') { // Special handling for progress as it has two displays
                    const verboseWrapper = progressPercentageVerboseSpan ? progressPercentageVerboseSpan.closest(wrapperSelector) : null;
                    const collapsedDisplay = document.getElementById('dock-collapsed-progress-display');
                    if (verboseWrapper) verboseWrapper.style.display = shouldShow ? '' : 'none';
                    if (collapsedDisplay) collapsedDisplay.style.display = shouldShow ? '' : 'none';
                } else if (statElements && statElements[0]) {
                     wrapperEl = statElements[0].closest(wrapperSelector);
                     if (wrapperEl) {
                        wrapperEl.style.display = shouldShow ? '' : 'none';
                     }
                }
            } else if (elementsMap[key]) { // Fallback for elements without specific wrappers (should not happen with new HTML)
                elementsMap[key].forEach(el => {
                    if(el) el.style.display = shouldShow ? '' : 'none';
                });
            }
        }
    }

    /**
     * Initializes the Dock component.
     * Caches DOM elements, restores toggle state, and attaches event listeners.
     * @param {string} docId - The ID of the current document.
     */
    function initialize(docId) {
        currentDocId = docId;
        currentVisibleTabIdForDock = null; // Initialize as null or a default non-chunk-compare tab

        dockElement = document.getElementById('bottom-left-dock');
        progressPercentageSpan = document.getElementById('reading-progress-percentage');
        progressPercentageVerboseSpan = document.getElementById('reading-progress-percentage-verbose');
        highlightCountElement = document.getElementById('highlight-count');
        annotationCountElement = document.getElementById('annotation-count');
        imageCountElement = document.getElementById('image-count');
        tableCountElement = document.getElementById('table-count');
        formulaCountElement = document.getElementById('formula-count');
        totalWordCountElement = document.getElementById('total-word-count');
        dockToggleBtn = document.getElementById('dock-toggle-btn');
        settingsLink = document.getElementById('settings-link');

        if (!dockElement || !progressPercentageSpan || !progressPercentageVerboseSpan ||
            !highlightCountElement || !annotationCountElement || !imageCountElement ||
            !tableCountElement || !formulaCountElement || !totalWordCountElement ||
            !dockToggleBtn || !settingsLink) {
            console.error("DockLogic: One or more Dock UI elements not found during initialization.");
            return; // Exit if essential elements are missing
        }

        // Load display configuration first
        if (global.DockLogic && global.DockLogic.loadDisplayConfig) {
            global.DockLogic.loadDisplayConfig(); // Call it here where currentDocId is set
        }

        // Initial call to set progress and make dock visible
        _updateReadingProgress();
        _applyDisplayConfigToElements(); // Apply initial display config, potentially after loading

        // Restore collapsed state & attach toggle handler
        const dockCollapsedKey = `dockCollapsed_${currentDocId}`;
        const isCollapsed = localStorage.getItem(dockCollapsedKey) === 'true';
        if (isCollapsed) {
            dockElement.classList.add('dock-collapsed');
            dockToggleBtn.innerHTML = '<i class="fa fa-chevron-up"></i>';
            dockToggleBtn.title = '展开';
        } else {
            dockElement.classList.remove('dock-collapsed'); // Ensure it's not collapsed by default
            dockToggleBtn.innerHTML = '<i class="fa fa-chevron-down"></i>';
            dockToggleBtn.title = '折叠';
        }

        dockToggleBtn.onclick = function(event) {
            event.preventDefault();
            const currentlyCollapsed = dockElement.classList.toggle('dock-collapsed');
            if (currentlyCollapsed) {
                this.innerHTML = '<i class="fa fa-chevron-up"></i>'; // Icon for "Expand"
                this.title = '展开';
                localStorage.setItem(dockCollapsedKey, 'true');
            } else {
                this.innerHTML = '<i class="fa fa-chevron-down"></i>'; // Icon for "Collapse"
                this.title = '折叠';
                localStorage.setItem(dockCollapsedKey, 'false');
            }
        };

        // Attach scroll listener for reading progress
        global.removeEventListener('scroll', debouncedUpdateReadingProgress); // Remove first to avoid duplicates if init is called multiple times
        global.addEventListener('scroll', debouncedUpdateReadingProgress);

        // Add click listeners for highlight and annotation stats
        const highlightStatClickable = dockElement.querySelector('.dock-stat-item-wrapper-highlight .stat-item-clickable[data-stat-type="highlight"]');
        const annotationStatClickable = dockElement.querySelector('.dock-stat-item-wrapper-annotation .stat-item-clickable[data-stat-type="annotation"]');

        if (highlightStatClickable) {
            highlightStatClickable.addEventListener('click', function() {
                if (typeof global.openAnnotationsSummaryModal === 'function') {
                    // Open with filter for 'highlighting', and 'all' content types initially
                    global.openAnnotationsSummaryModal('highlighting', 'all');
                } else {
                    console.warn('openAnnotationsSummaryModal function not found on window.');
                }
            });
        }

        if (annotationStatClickable) {
            annotationStatClickable.addEventListener('click', function() {
                if (typeof global.openAnnotationsSummaryModal === 'function') {
                    // Open with filter for 'commenting', and 'all' content types initially
                    global.openAnnotationsSummaryModal('commenting', 'all');
                } else {
                    console.warn('openAnnotationsSummaryModal function not found on window.');
                }
            });
        }
    }

    // Expose public interface
    global.DockLogic = {
        init: initialize,
        updateStats: _updateAllDockStats,
        forceUpdateReadingProgress: _updateReadingProgress, // For direct calls if needed after content change
        updateDisplayConfig: function(newConfig) {
            if (typeof newConfig === 'object' && newConfig !== null) {
                for (const key in dockDisplayConfig) {
                    if (newConfig.hasOwnProperty(key) && typeof newConfig[key] === 'boolean') {
                        dockDisplayConfig[key] = newConfig[key];
                    }
                }
                // currentVisibleTabIdForDock is already set if updateStats was called.
                // If called standalone, it uses the last known tab state.
                _applyDisplayConfigToElements(); // Re-apply to show/hide elements
                // Optionally, save this newConfig to localStorage for persistence
                if (currentDocId) { // Persist per document or globally
                     localStorage.setItem(`dockDisplayConfig_${currentDocId}`, JSON.stringify(dockDisplayConfig));
                } else {
                     localStorage.setItem('dockDisplayConfig_global', JSON.stringify(dockDisplayConfig));
                }
            }
        },
        loadDisplayConfig: function() { // Function to load config, e.g., on init
            let savedConfig = null;
            if (currentDocId) {
                savedConfig = localStorage.getItem(`dockDisplayConfig_${currentDocId}`);
            }
            if (!savedConfig) { // Fallback to global if per-doc not found
                savedConfig = localStorage.getItem('dockDisplayConfig_global');
            }

            if (savedConfig) {
                try {
                    const parsedConfig = JSON.parse(savedConfig);
                    // Merge with default to ensure all keys are present
                    dockDisplayConfig = { ...dockDisplayConfig, ...parsedConfig };
                } catch (e) {
                    console.error("Error parsing saved dock display config:", e);
                }
            }
            _applyDisplayConfigToElements();
        },
        getCurrentDisplayConfig: function() { // ADDED: Getter for current display config
            return { ...dockDisplayConfig }; // Return a copy
        }
    };

    // Load config when DockLogic is defined (e.g. at the end of the IIFE or called by init)
    // However, currentDocId might not be set yet. So, it's better to call loadDisplayConfig within init.

})(window);