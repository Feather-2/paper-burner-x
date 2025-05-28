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
    let isContentLoadingForStats = false; // NEW: Flag to indicate if stats are pending full content
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
        // If content is still loading (indicated by flag and element having no direct children yet), show placeholder.
        if (isContentLoadingForStats && contentElement.children.length === 0) {
            tableCountElement.textContent = '...';
        } else {
            const tables = contentElement.getElementsByTagName('table');
            tableCountElement.textContent = tables.length;
        }
      } else if (tableCountElement) {
        tableCountElement.textContent = '0'; // Default if no contentElement
      }
    }

    function _updateFormulaCount(contentElement) {
      if (formulaCountElement && contentElement) {
        if (isContentLoadingForStats && contentElement.children.length === 0) {
            formulaCountElement.textContent = '...';
        } else {
            const katexElements = contentElement.querySelectorAll('.katex, .katex-display');
            const mermaidElements = contentElement.querySelectorAll('.mermaid > svg'); // Mermaid renders an SVG
            formulaCountElement.textContent = katexElements.length + mermaidElements.length;
        }
      } else if (formulaCountElement) {
        formulaCountElement.textContent = '0';
      }
    }

    function _updateWordCount(contentElement) {
      if (totalWordCountElement && contentElement) {
        // Using a heuristic: if content is flagged as loading and text is very short or non-existent
        if (isContentLoadingForStats && (!contentElement.textContent || contentElement.textContent.trim().length < 10)) {
            totalWordCountElement.textContent = '...';
        } else {
            const text = contentElement.textContent || contentElement.innerText || "";
            const charCount = text.replace(/\\s/g, '').length; // Count non-whitespace characters
            totalWordCountElement.textContent = charCount > 0 ? charCount : '0';
        }
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
      currentVisibleTabIdForDock = currentVisibleTabId;

      if (!docData) {
        // console.warn("Doc data not available for updating dock stats.");
        if(highlightCountElement) highlightCountElement.textContent = '0';
        if(annotationCountElement) annotationCountElement.textContent = '0';
        if(imageCountElement) imageCountElement.textContent = '0';
        if(tableCountElement) tableCountElement.textContent = '0';
        if(formulaCountElement) formulaCountElement.textContent = '0';
        if(totalWordCountElement) totalWordCountElement.textContent = '0';
        isContentLoadingForStats = false; // No data, so not "loading stats"
        _applyDisplayConfigToElements();
        return;
      }

      let activeContentElement = null;
      if (currentVisibleTabIdForDock === 'ocr' && document.getElementById('ocr-content-wrapper')) {
        activeContentElement = document.getElementById('ocr-content-wrapper');
      } else if (currentVisibleTabIdForDock === 'translation' && document.getElementById('translation-content-wrapper')) {
        activeContentElement = document.getElementById('translation-content-wrapper');
      }

      // Set loading flag if activeContentElement exists but seems empty (initial batch render ongoing)
      if (activeContentElement && activeContentElement.children.length === 0) {
          isContentLoadingForStats = true;
          // console.log("DockLogic: Content is loading, placeholder '...' may be shown for some stats.");
      } else {
          isContentLoadingForStats = false; // Content is present or not an OCR/Translation tab needing batch render
          // console.log("DockLogic: Content present or not OCR/Trans, proceeding with normal stat calculation.");
      }

      // Handle highlights and annotations based on tab (these don't typically show '...')
      if (currentVisibleTabIdForDock === 'chunk-compare') {
        if (highlightCountElement) highlightCountElement.textContent = '0';
        if (annotationCountElement) annotationCountElement.textContent = '0';
        // These will be hidden by _applyDisplayConfigToElements's override for chunk-compare
      } else {
        // OCR or Translation tabs: update based on config and data
        if (dockDisplayConfig.highlights) _updateHighlightSummary(docData);
        if (dockDisplayConfig.annotations) _updateAnnotationSummary(docData);
      }

      // Handle images (always based on docData, visibility by config + override)
      if (dockDisplayConfig.images) {
        _updateImageCount(docData);
      }

      // Stats dependent on activeContentElement (tables, formulas, words)
      if (activeContentElement) { // OCR or Translation content is active
        if (dockDisplayConfig.tables) _updateTableCount(activeContentElement);
        if (dockDisplayConfig.formulas) _updateFormulaCount(activeContentElement);
        if (dockDisplayConfig.words) _updateWordCount(activeContentElement);
      } else { // No active OCR/Translation content (e.g., chunk-compare or error state)
        if (tableCountElement) tableCountElement.textContent = '0';
        if (formulaCountElement) formulaCountElement.textContent = '0';
        if (totalWordCountElement) totalWordCountElement.textContent = '0';

        // If it's not chunk-compare and no active element, but we previously thought content was loading for stats
        // ensure placeholders are shown if this update call happens too early.
        if (currentVisibleTabIdForDock !== 'chunk-compare' && isContentLoadingForStats) {
            if (tableCountElement && dockDisplayConfig.tables) tableCountElement.textContent = '...';
            if (formulaCountElement && dockDisplayConfig.formulas) formulaCountElement.textContent = '...';
            if (totalWordCountElement && dockDisplayConfig.words) totalWordCountElement.textContent = '...';
        }
      }

      _applyDisplayConfigToElements();

      // Fallback: If stats were showing '...' and are still '...' after a delay, revert to '0'.
      // This handles cases where the final, definitive update from history_detail might be missed or severely delayed for large docs.
      if (isContentLoadingForStats) { // Only set this timeout if we actually entered a "loading stats" state
          setTimeout(() => {
              // Check if we are still in a loading state for these stats
              // This inner check of isContentLoadingForStats is important because a proper update
              // might have occurred in the meantime, clearing the flag.
              if (isContentLoadingForStats) {
                  // console.log("DockLogic: Fallback timeout executed. Converting '...' to '0' if still present.");
                  if (tableCountElement && tableCountElement.textContent === '...' && dockDisplayConfig.tables) tableCountElement.textContent = '0';
                  if (formulaCountElement && formulaCountElement.textContent === '...' && dockDisplayConfig.formulas) formulaCountElement.textContent = '0';
                  if (totalWordCountElement && totalWordCountElement.textContent === '...' && dockDisplayConfig.words) totalWordCountElement.textContent = '0';
                  // It's probably safe to assume loading is "done" from the fallback's perspective,
                  // but a subsequent call to _updateAllDockStats with full content will properly clear it.
              }
          }, 3000); // Adjust delay as needed, e.g., 3 seconds.
      }
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
            let effectiveShouldShow = originalShouldShow;

            if (currentVisibleTabIdForDock === 'chunk-compare') {
                if (key === 'readingProgress') {
                    effectiveShouldShow = dockDisplayConfig.readingProgress;
                } else {
                    effectiveShouldShow = false;
                }
            }

            const shouldShow = effectiveShouldShow;
            const wrapperSelector = wrapperSelectors[key];
            // const statElements = elementsMap[key]; // Not directly used if relying on wrapperSelector

            if (wrapperSelector) {
                let wrapperEl = null;
                if (key === 'readingProgress') {
                    const verboseWrapper = progressPercentageVerboseSpan ? progressPercentageVerboseSpan.closest(wrapperSelector) : null;
                    const collapsedDisplay = document.getElementById('dock-collapsed-progress-display');
                    if (verboseWrapper) verboseWrapper.style.display = shouldShow ? '' : 'none';
                    if (collapsedDisplay) collapsedDisplay.style.display = shouldShow ? '' : 'none';
                } else if (elementsMap[key] && elementsMap[key][0]) { // Use the first element in the map to find its wrapper
                     wrapperEl = elementsMap[key][0].closest(wrapperSelector);
                     if (wrapperEl) {
                        wrapperEl.style.display = shouldShow ? '' : 'none';
                     }
                }
            } else if (elementsMap[key]) {
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
        currentVisibleTabIdForDock = null;

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
            return;
        }

        if (global.DockLogic && global.DockLogic.loadDisplayConfig) {
            global.DockLogic.loadDisplayConfig();
        }

        _updateReadingProgress();
        _applyDisplayConfigToElements();

        const dockCollapsedKey = `dockCollapsed_${currentDocId}`;
        const isCollapsed = localStorage.getItem(dockCollapsedKey) === 'true';
        if (isCollapsed) {
            dockElement.classList.add('dock-collapsed');
            dockToggleBtn.innerHTML = '<i class="fa fa-chevron-up"></i>';
            dockToggleBtn.title = '展开';
        } else {
            dockElement.classList.remove('dock-collapsed');
            dockToggleBtn.innerHTML = '<i class="fa fa-chevron-down"></i>';
            dockToggleBtn.title = '折叠';
        }

        dockToggleBtn.onclick = function(event) {
            event.preventDefault();
            const currentlyCollapsed = dockElement.classList.toggle('dock-collapsed');
            if (currentlyCollapsed) {
                this.innerHTML = '<i class="fa fa-chevron-up"></i>';
                this.title = '展开';
                localStorage.setItem(dockCollapsedKey, 'true');
            } else {
                this.innerHTML = '<i class="fa fa-chevron-down"></i>';
                this.title = '折叠';
                localStorage.setItem(dockCollapsedKey, 'false');
            }
        };

        global.removeEventListener('scroll', debouncedUpdateReadingProgress);
        global.addEventListener('scroll', debouncedUpdateReadingProgress);

        const highlightStatClickable = dockElement.querySelector('.dock-stat-item-wrapper-highlight .stat-item-clickable[data-stat-type="highlight"]');
        const annotationStatClickable = dockElement.querySelector('.dock-stat-item-wrapper-annotation .stat-item-clickable[data-stat-type="annotation"]');

        if (highlightStatClickable) {
            highlightStatClickable.addEventListener('click', function() {
                if (typeof global.openAnnotationsSummaryModal === 'function') {
                    global.openAnnotationsSummaryModal('all', 'all');
                } else {
                    console.warn('openAnnotationsSummaryModal function not found on window.');
                }
            });
        }

        if (annotationStatClickable) {
            annotationStatClickable.addEventListener('click', function() {
                if (typeof global.openAnnotationsSummaryModal === 'function') {
                    global.openAnnotationsSummaryModal('all', 'all');
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
        forceUpdateReadingProgress: _updateReadingProgress,
        updateDisplayConfig: function(newConfig) {
            if (typeof newConfig === 'object' && newConfig !== null) {
                for (const key in dockDisplayConfig) {
                    if (newConfig.hasOwnProperty(key) && typeof newConfig[key] === 'boolean') {
                        dockDisplayConfig[key] = newConfig[key];
                    }
                }
                _applyDisplayConfigToElements();
                if (currentDocId) {
                     localStorage.setItem(`dockDisplayConfig_${currentDocId}`, JSON.stringify(dockDisplayConfig));
                } else {
                     localStorage.setItem('dockDisplayConfig_global', JSON.stringify(dockDisplayConfig));
                }
            }
        },
        loadDisplayConfig: function() {
            let savedConfig = null;
            if (currentDocId) {
                savedConfig = localStorage.getItem(`dockDisplayConfig_${currentDocId}`);
            }
            if (!savedConfig) {
                savedConfig = localStorage.getItem('dockDisplayConfig_global');
            }

            if (savedConfig) {
                try {
                    const parsedConfig = JSON.parse(savedConfig);
                    dockDisplayConfig = { ...dockDisplayConfig, ...parsedConfig };
                } catch (e) {
                    console.error("Error parsing saved dock display config:", e);
                }
            }
            // _applyDisplayConfigToElements(); // This might be called too early if DOM elements for stats are not ready
                                          // It's better called within init after elements are cached,
                                          // and also after any _updateAllDockStats call.
        },
        getCurrentDisplayConfig: function() {
            return { ...dockDisplayConfig };
        }
    };

})(window);