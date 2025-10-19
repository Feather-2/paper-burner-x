/**
 * 分块对比优化器集成脚本
 * 负责将优化器与现有的历史详情页面集成
 */

(function() {
    'use strict';

    // 等待页面和优化器加载完成
    function initializeChunkCompareOptimization() {
        // 避免重复初始化（多次 setTimeout 或脚本重复触发）
        if (window.__chunkCompareIntegrationInitialized) {
            return;
        }
        if (!window.ChunkCompareOptimizer || !window.ChunkCompareOptimizer.instance) {
            console.warn('[ChunkIntegration] 优化器未加载，延迟初始化');
            setTimeout(initializeChunkCompareOptimization, 100);
            return;
        }

        console.log('[ChunkIntegration] 开始集成分块对比优化器');

        // 标记已初始化，防止重复绑定事件
        window.__chunkCompareIntegrationInitialized = true;

        // 保存原有的渲染函数引用（如需使用，可在后续扩展）
        const originalShowTab = window.showTab;

        // 增强切换按钮功能
        enhanceSwapChunksButton();

        // 增强性能监控
        enhancePerformanceMonitoring();

        // 绑定优化器控制事件
        bindOptimizerControls();

        console.log('[ChunkIntegration] 分块对比优化器集成完成');
    }

    /**
     * 增强切换按钮功能
     */
    function enhanceSwapChunksButton() {
        // 使用事件委托处理切换按钮
        document.addEventListener('click', function(e) {
            if (e.target.id === 'swap-chunks-btn') {
                e.preventDefault();
                handleChunkSwap();
            }

            // 处理性能模式切换
            if (e.target.id === 'performance-toggle-btn' || e.target.closest('#performance-toggle-btn')) {
                e.preventDefault();
                togglePerformanceMode();
            }
        });
    }

    /**
     * 处理分块位置切换
     */
    function handleChunkSwap() {
        const startTime = performance.now();
        console.log('[ChunkIntegration] 开始切换分块位置');

        // 切换全局标志
        window.isOriginalFirstInChunkCompare = !window.isOriginalFirstInChunkCompare;
        
        // 保存用户偏好
        if (window.docIdForLocalStorage) {
            localStorage.setItem(
                `isOriginalFirst_${window.docIdForLocalStorage}`, 
                window.isOriginalFirstInChunkCompare
            );
        }

        // 更新按钮状态
        const swapBtn = document.getElementById('swap-chunks-btn');
        if (swapBtn) {
            swapBtn.style.transform = window.isOriginalFirstInChunkCompare ? 'rotate(0deg)' : 'rotate(180deg)';
            swapBtn.title = window.isOriginalFirstInChunkCompare ? '切换原文/译文位置' : '切换译文/原文位置';
        }

        // 如果使用优化器，需要重新渲染
        if (window.ChunkCompareOptimizer && window.ChunkCompareOptimizer.instance) {
            // 清除缓存以重新渲染
            window.ChunkCompareOptimizer.instance.renderCache.clear();
            
            // 重新显示当前标签
            if (typeof window.showTab === 'function') {
                window.showTab('chunk-compare');
            }
        }

        const endTime = performance.now();
        console.log(`[ChunkIntegration] 分块位置切换完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);
    }

    /**
     * 切换性能模式
     */
    function togglePerformanceMode() {
        const container = document.querySelector('.chunk-compare-container');
        const toggleBtn = document.getElementById('performance-toggle-btn');
        
        if (!container || !toggleBtn) return;

        const isPerformanceMode = container.classList.contains('performance-mode');
        
        if (isPerformanceMode) {
            // 关闭性能模式
            container.classList.remove('performance-mode');
            toggleBtn.classList.remove('active');
            toggleBtn.title = '启用性能模式';
            console.log('[ChunkIntegration] 性能模式已关闭');
        } else {
            // 启用性能模式
            container.classList.add('performance-mode');
            toggleBtn.classList.add('active');
            toggleBtn.title = '关闭性能模式';
            console.log('[ChunkIntegration] 性能模式已启用');
        }

        // 保存用户偏好
        localStorage.setItem('chunkComparePerformanceMode', !isPerformanceMode);
    }

    /**
     * 增强性能监控
     */
    function enhancePerformanceMonitoring() {
        // 监控分块对比的渲染性能
        const originalConsoleTime = console.time;
        const originalConsoleTimeEnd = console.timeEnd;

        console.time = function(label) {
            if (label.includes('分块对比') || label.includes('chunk')) {
                performance.mark(`${label}-start`);
            }
            return originalConsoleTime.apply(this, arguments);
        };

        console.timeEnd = function(label) {
            if (label.includes('分块对比') || label.includes('chunk')) {
                performance.mark(`${label}-end`);
                try {
                    performance.measure(label, `${label}-start`, `${label}-end`);
                    const measure = performance.getEntriesByName(label, 'measure')[0];
                    if (measure) {
                        console.log(`[性能监控] ${label}: ${measure.duration.toFixed(2)}ms`);
                        
                        // 如果渲染时间过长，提示用户
                        if (measure.duration > 2000) { // 超过2秒
                            showPerformanceWarning(label, measure.duration);
                        }
                    }
                } catch (error) {
                    console.warn('性能测量失败:', error);
                }
            }
            return originalConsoleTimeEnd.apply(this, arguments);
        };
    }

    /**
     * 显示性能警告
     */
    function showPerformanceWarning(operation, duration) {
        const warningEl = document.createElement('div');
        warningEl.className = 'performance-warning';
        warningEl.innerHTML = `
            <div class="warning-content">
                <i class="fas fa-exclamation-triangle"></i>
                <span>渲染耗时较长 (${(duration / 1000).toFixed(1)}秒)</span>
                <button onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        warningEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fef3cd;
            border: 1px solid #fecba1;
            border-radius: 6px;
            padding: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            z-index: 10000;
            max-width: 300px;
        `;

        document.body.appendChild(warningEl);

        // 5秒后自动移除
        setTimeout(() => {
            if (warningEl.parentElement) {
                warningEl.remove();
            }
        }, 5000);
    }

    /**
     * 绑定优化器控制事件
     */
    function bindOptimizerControls() {
        // 恢复用户偏好设置
        const savedPerformanceMode = localStorage.getItem('chunkComparePerformanceMode');
        if (savedPerformanceMode === 'true') {
            setTimeout(() => {
                const container = document.querySelector('.chunk-compare-container');
                const toggleBtn = document.getElementById('performance-toggle-btn');
                if (container && toggleBtn) {
                    container.classList.add('performance-mode');
                    toggleBtn.classList.add('active');
                }
            }, 100);
        }

        // 绑定键盘快捷键（仅绑定一次）
        if (!window.__chunkCompareKeydownBound) {
            window.__chunkCompareKeydownBound = true;
            document.addEventListener('keydown', function(e) {
                // Ctrl/Cmd + Shift + P: 切换性能模式
                if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
                    e.preventDefault();
                    togglePerformanceMode();
                }

                // Ctrl/Cmd + Shift + S: 切换原文/译文位置
                if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
                    e.preventDefault();
                    const swapBtn = document.getElementById('swap-chunks-btn');
                    if (swapBtn && window.currentVisibleTabId === 'chunk-compare') {
                        handleChunkSwap();
                    }
                }
            });
        }

        // 添加快捷键提示
        addKeyboardShortcutHints();
    }

    /**
     * 添加键盘快捷键提示
     */
    function addKeyboardShortcutHints() {
        // 防止重复绑定观察者
        if (window.__chunkCompareHintsObserverBound) return;
        window.__chunkCompareHintsObserverBound = true;

        // 监听分块对比标签的激活
        const observer = new MutationObserver(function(mutations) {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.id === 'tab-chunk-compare' && target.classList.contains('active')) {
                        showKeyboardHints(observer);
                    }
                }
            }
        });

        const chunkTab = document.getElementById('tab-chunk-compare');
        if (chunkTab) {
            observer.observe(chunkTab, { attributes: true });
        }
    }

    /**
     * 显示键盘快捷键提示
     */
    function showKeyboardHints(observerInstance) {
        // 本地与内存双重防抖：防止多次渲染
        if (window.__chunkCompareHintsShown || localStorage.getItem('chunkCompareHintsShown') === 'true') {
            return;
        }
        // 如果DOM中已存在同名元素，也不再渲染
        if (document.querySelector('.keyboard-hints')) return;

        // 先设置标记，避免短时间内重复触发造成多次追加
        window.__chunkCompareHintsShown = true;
        localStorage.setItem('chunkCompareHintsShown', 'true');

        setTimeout(() => {
            // 若已存在，不重复创建
            if (document.querySelector('.keyboard-hints')) return;
            const hintsEl = document.createElement('div');
            hintsEl.className = 'keyboard-hints';
            hintsEl.innerHTML = `
                <div class="hints-content">
                    <h4>键盘快捷键</h4>
                    <div class="hint-item">
                        <kbd>Ctrl/Cmd + Shift + P</kbd>
                        <span>切换性能模式</span>
                    </div>
                    <div class="hint-item">
                        <kbd>Ctrl/Cmd + Shift + S</kbd>
                        <span>切换原文/译文位置</span>
                    </div>
                    <button class="close-hints" onclick="this.parentElement.parentElement.remove()">知道了</button>
                </div>
            `;
            hintsEl.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 20px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10001;
                max-width: 300px;
            `;

            document.body.appendChild(hintsEl);

            // 10秒后自动移除
            setTimeout(() => {
                if (hintsEl.parentElement) {
                    hintsEl.remove();
                }
            }, 10000);
            // 观察者可在首次显示后断开，避免无意义监听
            if (observerInstance && typeof observerInstance.disconnect === 'function') {
                observerInstance.disconnect();
            }
        }, 500);
    }

    /**
     * 优化分块导航
     */
    function enhanceChunkNavigation() {
        // 添加快速导航功能
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('block-nav-btn')) {
                e.preventDefault();
                const direction = e.target.dataset.dir;
                const currentBlock = parseInt(e.target.dataset.block);
                
                if (direction === 'prev' && currentBlock > 0) {
                    scrollToChunk(currentBlock - 1);
                } else if (direction === 'next') {
                    scrollToChunk(currentBlock + 1);
                }
            }
        });
    }

    /**
     * 滚动到指定分块
     */
    function scrollToChunk(index) {
        const chunk = document.getElementById(`chunk-${index}`) || document.getElementById(`block-${index}`);
        if (chunk) {
            chunk.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
            
            // 高亮显示目标分块
            chunk.classList.add('chunk-highlight');
            setTimeout(() => {
                chunk.classList.remove('chunk-highlight');
            }, 1500);
        }
    }

    /**
     * 添加分块高亮样式
     */
    function addChunkHighlightStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .chunk-highlight {
                box-shadow: 0 0 0 3px #3b82f6 !important;
                transition: box-shadow 0.3s ease !important;
            }
            
            .performance-warning .warning-content {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9em;
                color: #92400e;
            }
            
            .keyboard-hints .hints-content h4 {
                margin: 0 0 12px 0;
                color: #1e293b;
                font-size: 1.1em;
            }
            
            .keyboard-hints .hint-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                font-size: 0.9em;
            }
            
            .keyboard-hints kbd {
                background: #f1f5f9;
                border: 1px solid #cbd5e1;
                border-radius: 3px;
                padding: 2px 6px;
                font-size: 0.8em;
                font-family: monospace;
            }
            
            .keyboard-hints .close-hints {
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 6px 12px;
                cursor: pointer;
                font-size: 0.9em;
                margin-top: 12px;
                width: 100%;
            }
        `;
        document.head.appendChild(style);
    }

    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            addChunkHighlightStyles();
            enhanceChunkNavigation();
            initializeChunkCompareOptimization();
        });
    } else {
        addChunkHighlightStyles();
        enhanceChunkNavigation();
        initializeChunkCompareOptimization();
    }

})();
