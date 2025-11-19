// js/processing/formula_post_processor_async.js
// 异步公式后处理器 - 使用 Web Worker 渲染公式，避免阻塞主线程
// 注意：导出功能仍使用同步版本（formula_post_processor.js）

(function(global) {
    'use strict';

    /**
     * 异步公式后处理器
     * 使用 Web Worker 在后台渲染 KaTeX 公式
     */
    class FormulaPostProcessorAsync {
        constructor() {
            this.worker = null;
            this.workerReady = false;
            this.pendingCallbacks = new Map();
            this.requestId = 0;
            this.initWorker();
        }

        /**
         * 初始化 Web Worker（使用 Blob URL 支持 file:// 协议）
         */
        initWorker() {
            try {
                // 创建内联 Worker 代码（Blob URL 方案，支持 file:// 协议）
                const workerCode = this.getWorkerCode();
                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);

                this.worker = new Worker(workerUrl);

                // 清理 Blob URL（Worker 已创建，不再需要）
                URL.revokeObjectURL(workerUrl);

                this.worker.onmessage = (e) => {
                    const { type } = e.data;

                    if (type === 'ready') {
                        this.workerReady = true;
                        console.log('[FormulaPostProcessorAsync] Worker ready (Blob URL)');
                        return;
                    }

                    if (type === 'batch_complete') {
                        const { batchId, results } = e.data;
                        const callback = this.pendingCallbacks.get(batchId);
                        if (callback) {
                            callback(results);
                            this.pendingCallbacks.delete(batchId);
                        }
                        return;
                    }

                    if (type === 'error') {
                        console.error('[FormulaPostProcessorAsync] Worker error:', e.data.error);
                        return;
                    }
                };

                this.worker.onerror = (error) => {
                    console.error('[FormulaPostProcessorAsync] Worker error:', error);
                    this.workerReady = false;
                };

            } catch (error) {
                console.warn('[FormulaPostProcessorAsync] Failed to create Worker, falling back to sync:', error);
                this.workerReady = false;
            }
        }

        /**
         * 获取 Worker 代码（内联版本，避免 file:// 协议限制）
         */
        getWorkerCode() {
            return `
'use strict';

// 导入 KaTeX 库
try {
    importScripts('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js');
} catch (error) {
    self.postMessage({ type: 'error', error: 'Failed to load KaTeX library' });
}

// 修复公式错误
function fixFormulaErrors(formula, isDisplay) {
    let fixed = formula;
    if (!isDisplay && /\\\\tag\\{[^}]*\\}/.test(fixed)) {
        fixed = fixed.replace(/\\\\tag\\{[^}]*\\}/g, '');
    }
    if (/\\\\;\\s*\\^\\\\circ/.test(fixed)) {
        fixed = fixed.replace(/\\\\;\\s*\\^\\\\circ/g, '\\\\,^{\\\\circ}');
    }
    if (/\\\\;\\s*\\^([^{])/.test(fixed)) {
        fixed = fixed.replace(/\\\\;\\s*\\^([^{])/g, (match, char) => \`\\\\,^{\${char}}\`);
    }
    if (/\\{\\{/.test(fixed)) {
        while (/\\{\\{/.test(fixed)) {
            fixed = fixed.replace(/\\{\\{([^}]*)\\}\\}/g, '{$1}');
        }
    }
    if (/\\\\mathrm\\{[^}]*\\\\;[^}]*\\^\\s*\\\\circ[^}]*\\}/.test(fixed)) {
        fixed = fixed.replace(/\\\\mathrm\\{\\s*\\\\;\\s*\\^\\s*\\\\circ\\s+([^}]+)\\}/g, '\\\\,^{\\\\circ}\\\\mathrm{$1}');
    }
    fixed = fixed.replace(/\\^([a-zA-Z]{2,})/g, '^{$1}');
    return fixed.trim();
}

// 渲染单个公式
function renderFormula(id, formula, options) {
    try {
        if (typeof katex === 'undefined') {
            throw new Error('KaTeX is not available');
        }
        const fixed = fixFormulaErrors(formula, options.displayMode || false);
        const html = katex.renderToString(fixed, {
            displayMode: options.displayMode || false,
            throwOnError: false,
            strict: 'ignore',
            output: 'html',
            ...options
        });
        return { type: 'success', id, html, originalFormula: formula };
    } catch (error) {
        return {
            type: 'error',
            id,
            error: error.message,
            originalFormula: formula,
            html: \`<span class="katex-fallback" title="\${error.message}">\${formula}</span>\`
        };
    }
}

// 批量渲染
function renderBatch(batchId, formulas) {
    const results = formulas.map(item => renderFormula(item.id, item.formula, item.options || {}));
    return { type: 'batch_complete', batchId, results };
}

// 消息处理
self.onmessage = function(e) {
    const { type, id, formula, options, batchId, formulas } = e.data;
    if (type === 'render') {
        self.postMessage(renderFormula(id, formula, options || {}));
    } else if (type === 'batch') {
        self.postMessage(renderBatch(batchId, formulas));
    } else if (type === 'ping') {
        self.postMessage({ type: 'pong' });
    } else {
        self.postMessage({ type: 'error', error: \`Unknown message type: \${type}\` });
    }
};

self.postMessage({ type: 'ready' });
            `.trim();
        }

        /**
         * 扫描元素中的所有公式（不渲染，只收集）
         * @param {HTMLElement} rootElement - 要扫描的根元素
         * @returns {Array} 公式列表
         */
        collectFormulas(rootElement) {
            if (!rootElement) return [];

            const formulas = [];
            let formulaId = 0;

            /**
             * 递归扫描节点
             */
            function processNode(node) {
                // 跳过已渲染的 katex 元素
                if (node.classList && (
                    node.classList.contains('katex') ||
                    node.classList.contains('katex-block') ||
                    node.classList.contains('katex-inline') ||
                    node.classList.contains('katex-display')
                )) {
                    return;
                }

                // 处理文本节点
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    const formulaRegex = /\$\$([^\$]+?)\$\$|\$([^\$\n]+?)\$/g;

                    let match;
                    while ((match = formulaRegex.exec(text)) !== null) {
                        const formula = match[1] || match[2];
                        const isDisplay = !!match[1];

                        formulas.push({
                            id: formulaId++,
                            formula: formula,
                            isDisplay: isDisplay,
                            textNode: node,
                            matchIndex: match.index,
                            matchLength: match[0].length
                        });
                    }
                }
                // 递归处理子节点
                else if (node.childNodes) {
                    Array.from(node.childNodes).forEach(processNode);
                }
            }

            processNode(rootElement);
            return formulas;
        }

        /**
         * 异步渲染元素中的所有公式
         * @param {HTMLElement} rootElement - 要处理的根元素
         * @param {Object} options - 选项
         * @param {Function} onProgress - 进度回调 (processed, total)
         * @param {Function} onComplete - 完成回调
         * @returns {Promise} 完成时 resolve
         */
        async processFormulasInElement(rootElement, options = {}) {
            if (!rootElement) {
                console.warn('[FormulaPostProcessorAsync] rootElement is null');
                return;
            }

            const startTime = performance.now();
            const {
                onProgress = null,
                onComplete = null,
                useWorker = true  // 是否使用 Worker（导出时设为 false）
            } = options;

            // 如果不使用 Worker 或 Worker 不可用，回退到同步版本
            if (!useWorker || !this.workerReady || !this.worker) {
                console.log('[FormulaPostProcessorAsync] Falling back to sync processing');
                if (global.FormulaPostProcessor && global.FormulaPostProcessor.processFormulasInElement) {
                    global.FormulaPostProcessor.processFormulasInElement(rootElement);
                }
                if (onComplete) onComplete();
                return;
            }

            // 1. 收集所有公式
            const formulas = this.collectFormulas(rootElement);

            if (formulas.length === 0) {
                console.log('[FormulaPostProcessorAsync] No formulas found');
                const endTime = performance.now();
                console.log(`[FormulaPostProcessorAsync] 完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);
                if (onComplete) onComplete();
                return;
            }

            console.log(`[FormulaPostProcessorAsync] Found ${formulas.length} formulas, rendering with Worker...`);

            // 2. 批量发送到 Worker 渲染
            const batchSize = 20;  // 每批处理 20 个公式
            const batches = [];

            for (let i = 0; i < formulas.length; i += batchSize) {
                batches.push(formulas.slice(i, i + batchSize));
            }

            let processedCount = 0;

            // 3. 逐批处理
            for (const batch of batches) {
                await this.renderBatch(batch, (results) => {
                    // 替换 DOM
                    results.forEach(result => {
                        const formulaData = batch.find(f => f.id === result.id);
                        if (!formulaData) return;

                        this.replaceFormulaInDOM(formulaData, result.html);
                        processedCount++;

                        if (onProgress) {
                            onProgress(processedCount, formulas.length);
                        }
                    });
                });

                // 每批之间让出主线程，允许用户交互
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const endTime = performance.now();
            console.log(`[FormulaPostProcessorAsync] 完成渲染 ${formulas.length} 个公式，耗时: ${(endTime - startTime).toFixed(2)}ms`);

            if (onComplete) {
                onComplete();
            }
        }

        /**
         * 渲染一批公式
         * @param {Array} formulas - 公式数组
         * @param {Function} callback - 完成回调
         * @returns {Promise}
         */
        renderBatch(formulas, callback) {
            return new Promise((resolve) => {
                const batchId = this.requestId++;

                this.pendingCallbacks.set(batchId, (results) => {
                    callback(results);
                    resolve();
                });

                // 发送到 Worker
                this.worker.postMessage({
                    type: 'batch',
                    batchId: batchId,
                    formulas: formulas.map(f => ({
                        id: f.id,
                        formula: f.formula,
                        options: {
                            displayMode: f.isDisplay,
                            throwOnError: false,
                            strict: 'ignore'
                        }
                    }))
                });
            });
        }

        /**
         * 在 DOM 中替换公式文本为渲染后的 HTML
         * @param {Object} formulaData - 公式数据
         * @param {string} html - 渲染后的 HTML
         */
        replaceFormulaInDOM(formulaData, html) {
            const { textNode, matchIndex, matchLength } = formulaData;

            if (!textNode || !textNode.parentNode) {
                console.warn('[FormulaPostProcessorAsync] Text node not in DOM');
                return;
            }

            const text = textNode.textContent;
            const before = text.substring(0, matchIndex);
            const after = text.substring(matchIndex + matchLength);

            // 创建一个临时容器
            const temp = document.createElement('span');
            temp.innerHTML = html;
            const renderedNode = temp.firstChild;

            // 创建新的文本节点
            const beforeNode = before ? document.createTextNode(before) : null;
            const afterNode = after ? document.createTextNode(after) : null;

            const parent = textNode.parentNode;

            // 替换节点
            if (beforeNode) {
                parent.insertBefore(beforeNode, textNode);
            }
            parent.insertBefore(renderedNode, textNode);
            if (afterNode) {
                parent.insertBefore(afterNode, textNode);
            }
            parent.removeChild(textNode);
        }

        /**
         * 清理 Worker
         */
        destroy() {
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
                this.workerReady = false;
                console.log('[FormulaPostProcessorAsync] Worker terminated');
            }
        }
    }

    // 创建全局单例
    global.FormulaPostProcessorAsync = new FormulaPostProcessorAsync();

    // 页面卸载时清理
    window.addEventListener('beforeunload', () => {
        if (global.FormulaPostProcessorAsync) {
            global.FormulaPostProcessorAsync.destroy();
        }
    });

    console.log('[FormulaPostProcessorAsync] 模块已加载');

})(window);
