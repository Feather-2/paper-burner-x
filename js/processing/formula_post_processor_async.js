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
         * 包括：1. 纯文本中的 $...$ 公式  2. 渲染失败的 .katex-fallback 元素
         * @param {HTMLElement} rootElement - 要扫描的根元素
         * @returns {Array} 公式列表
         */
        collectFormulas(rootElement) {
            if (!rootElement) return [];

            const formulas = [];
            let formulaId = 0;

            // 1. 收集渲染失败的公式（.katex-fallback 元素）
            const fallbackElements = rootElement.querySelectorAll('.katex-fallback');
            fallbackElements.forEach(el => {
                const text = el.textContent.trim();
                const isDisplay = el.classList.contains('katex-block');

                // 检测不完整的环境标记（这些需要被删除，不是重新渲染）
                if (/^\\begin\{(aligned|array|matrix|cases|split|gather)\}$/.test(text) ||
                    /^\\end\{(aligned|array|matrix|cases|split|gather)\}$/.test(text)) {
                    // 标记为删除
                    formulas.push({
                        id: formulaId++,
                        formula: null,  // null 表示删除
                        isDisplay: isDisplay,
                        fallbackElement: el,
                        shouldDelete: true
                    });
                    return;
                }

                // 正常的失败公式，尝试重新渲染
                if (text.length > 0) {
                    formulas.push({
                        id: formulaId++,
                        formula: text,
                        isDisplay: isDisplay,
                        fallbackElement: el,
                        shouldDelete: false
                    });
                }
            });

            // 2. 扫描纯文本节点中的公式（不常见，但保留此功能）
            function processNode(node) {
                // 跳过已渲染的 katex 元素
                if (node.classList && (
                    node.classList.contains('katex') ||
                    node.classList.contains('katex-block') ||
                    node.classList.contains('katex-inline') ||
                    node.classList.contains('katex-display') ||
                    node.classList.contains('katex-fallback')  // 跳过 fallback（已在上面处理）
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

            // 统计已渲染的公式（调试信息）
            const renderedFormulas = rootElement.querySelectorAll('.katex, .katex-block, .katex-inline, .katex-display');
            const fallbackFormulas = rootElement.querySelectorAll('.katex-fallback');
            console.log(`[FormulaPostProcessorAsync] 📊 文档公式统计: ${renderedFormulas.length} 个已渲染, ${fallbackFormulas.length} 个失败`);

            // 如果不使用 Worker 或 Worker 不可用，回退到同步版本
            if (!useWorker || !this.workerReady || !this.worker) {
                console.log('[FormulaPostProcessorAsync] Falling back to sync processing');
                if (global.FormulaPostProcessor && global.FormulaPostProcessor.processFormulasInElement) {
                    global.FormulaPostProcessor.processFormulasInElement(rootElement);
                }
                if (onComplete) onComplete();
                return;
            }

            // 1. 收集所有公式（包括失败的公式）
            const formulas = this.collectFormulas(rootElement);

            if (formulas.length === 0) {
                console.log('[FormulaPostProcessorAsync] ✅ 无需后处理（所有公式已在 Markdown 阶段成功渲染）');
                const endTime = performance.now();
                console.log(`[FormulaPostProcessorAsync] 完成，耗时: ${(endTime - startTime).toFixed(2)}ms`);
                if (onComplete) onComplete();
                return;
            }

            console.log(`[FormulaPostProcessorAsync] Found ${formulas.length} formulas, processing...`);

            // 2. 分离删除和渲染任务
            const toDelete = formulas.filter(f => f.shouldDelete);
            const toRender = formulas.filter(f => !f.shouldDelete);

            let processedCount = 0;

            // 3a. 先处理删除任务（不需要 Worker）
            toDelete.forEach(formulaData => {
                this.replaceFormulaInDOM(formulaData, null);
                processedCount++;
                if (onProgress) {
                    onProgress(processedCount, formulas.length);
                }
            });

            console.log(`[FormulaPostProcessorAsync] 删除了 ${toDelete.length} 个不完整的环境标记`);

            // 3b. 如果有需要渲染的公式，发送到 Worker
            if (toRender.length > 0) {
                console.log(`[FormulaPostProcessorAsync] 使用 Worker 渲染 ${toRender.length} 个失败的公式...`);

                const batchSize = 20;  // 每批处理 20 个公式
                const batches = [];

                for (let i = 0; i < toRender.length; i += batchSize) {
                    batches.push(toRender.slice(i, i + batchSize));
                }

                // 逐批渲染
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
            // 场景 1: 处理 .katex-fallback 元素（失败的公式）
            if (formulaData.fallbackElement) {
                const fallbackEl = formulaData.fallbackElement;

                // 检查元素是否仍在 DOM 中
                if (!fallbackEl.parentNode) {
                    console.warn('[FormulaPostProcessorAsync] Fallback element not in DOM');
                    return;
                }

                // 子场景 1a: 需要删除（不完整的环境标记）
                if (formulaData.shouldDelete) {
                    console.log(`[FormulaPostProcessorAsync] 删除不完整的 LaTeX 环境: ${fallbackEl.textContent.substring(0, 30)}...`);
                    fallbackEl.parentNode.removeChild(fallbackEl);
                    return;
                }

                // 子场景 1b: 重新渲染（正常的失败公式）
                if (html) {
                    const temp = document.createElement('span');
                    temp.innerHTML = html;
                    const renderedNode = temp.firstChild;

                    if (renderedNode) {
                        console.log(`[FormulaPostProcessorAsync] 修复失败的公式: ${formulaData.formula.substring(0, 30)}...`);
                        fallbackEl.parentNode.replaceChild(renderedNode, fallbackEl);
                    }
                }
                return;
            }

            // 场景 2: 处理文本节点中的公式（原有逻辑，用于 $...$ 格式）
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
