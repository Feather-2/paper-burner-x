// js/processing/markdown_processor_ast.js
// AST-based Markdown processor using markdown-it
// 全新架构：基于抽象语法树的 Markdown 处理器
(function MarkdownProcessorAST(global) {
    'use strict';

    // ========================================
    // 核心配置
    // ========================================
    const CONFIG = {
        version: '3.0.0-ast',
        cacheSize: 1000,
        debug: false
    };

    // 缓存系统
    const renderCache = new Map();

    // 性能指标
    const metrics = {
        cacheHits: 0,
        cacheMisses: 0,
        totalRenders: 0,
        formulaErrors: 0,
        formulaSuccesses: 0,
        tableFixCount: 0
    };

    // ========================================
    // Markdown-it 初始化
    // ========================================
    if (typeof markdownit === 'undefined') {
        console.error('[MarkdownProcessorAST] markdown-it not loaded!');
        return;
    }

    const md = markdownit({
        html: true,           // 允许 HTML 标签
        breaks: false,        // 不自动转换换行（避免破坏表格）
        linkify: false,       // 不自动转换链接
        typographer: false    // 不进行印刷优化（避免干扰公式）
    });

    // ========================================
    // 工具函数
    // ========================================

    /**
     * HTML 转义
     */
    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const htmlEscapes = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return text.replace(/[&<>"']/g, (match) => htmlEscapes[match]);
    }

    /**
     * 检测内容是否像段落（而非单个公式）
     */
    function looksLikeParagraph(text) {
        if (!text || typeof text !== 'string') return false;
        // 包含句子标点
        if (/[。；;]/.test(text)) return true;
        // 包含多个逗号
        if ((text.match(/[，,]/g) || []).length > 2) return true;
        // 包含英文解释性词汇
        if (/\b(represents?|where|is|are|and|the|of)\b/i.test(text)) return true;
        return false;
    }

    /**
     * 记录调试信息
     */
    function debug(...args) {
        if (CONFIG.debug) {
            console.log('[MarkdownProcessorAST]', ...args);
        }
    }

    // ========================================
    // 插件 1: OCR 错误修复（Token 级别）
    // ========================================
    function ocrFixPlugin(md) {
        debug('Loading OCR fix plugin');

        // 在 inline 解析之前修复文本
        md.core.ruler.before('inline', 'ocr_fix', function(state) {
            const tokens = state.tokens;

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];

                // 只处理段落、表格单元格等文本容器
                if (token.type === 'inline' && token.content) {
                    token.content = normalizeMathDelimiters(token.content);
                }
            }
        });

        /**
         * 修复 OCR 错误的数学分隔符
         */
        function normalizeMathDelimiters(text) {
            if (typeof text !== 'string' || !text) return text;
            let s = text;

            // 基础清理
            s = s.replace(/&(?:#0*36|dollar);/gi, '$');
            s = s.replace(/\uFF04/g, '$');
            s = s.replace(/\$[\u200B-\u200D\uFEFF\u0300-\u036F]+/g, '$');
            s = s.replace(/[\u200B-\u200D\uFEFF\u0300-\u036F]+\$/g, '$');

            // OCR 错误修复（带防护）
            // 1. $\$ ... \$ ，$ → $$ ... $$ ，
            s = s.replace(/\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$\s*，\s*\$/g, (match, content) => {
                if (looksLikeParagraph(content)) return match;
                return `$$${content}$$ ，`;
            });

            // 2. $\$ ... \$$ → $$ ... $$
            s = s.replace(/\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$\$/g, (match, content) => {
                if (looksLikeParagraph(content)) return match;
                return `$$${content}$$`;
            });

            // 3. $\$ ... \$ → $$ ... $$
            s = s.replace(/\$\\\$\s*([^\$\n]{1,200}?)\s*\\\$/g, (match, content) => {
                if (looksLikeParagraph(content)) return match;
                return `$$${content}$$`;
            });

            // 4. \$...\$ → $$...$$
            s = s.replace(/\\\$([^\$\n]+?)\\\$/g, '$$$$1$$');

            return s;
        }
    }

    // ========================================
    // 插件 2: 表格修复（AST 级别）
    // ========================================
    function tableFixPlugin(md) {
        debug('Loading table fix plugin');

        md.core.ruler.after('inline', 'table_fix', function(state) {
            const tokens = state.tokens;
            let i = 0;

            while (i < tokens.length) {
                const token = tokens[i];

                // 找到表格开始
                if (token.type === 'table_open') {
                    const tableTokens = [];
                    let j = i;

                    // 收集整个表格的 tokens
                    while (j < tokens.length && tokens[j].type !== 'table_close') {
                        tableTokens.push(tokens[j]);
                        j++;
                    }
                    if (j < tokens.length) {
                        tableTokens.push(tokens[j]); // table_close
                    }

                    // 尝试修复表格
                    const fixed = fixTableStructure(tableTokens);
                    if (fixed) {
                        // 替换原始 tokens
                        tokens.splice(i, j - i + 1, ...fixed);
                        metrics.tableFixCount++;
                        debug('Fixed table at token', i);
                    }

                    i = j + 1;
                } else {
                    i++;
                }
            }
        });

        /**
         * 修复表格结构
         * 主要处理：列数不一致、空单元格开头的行（可能需要合并到上一行）
         */
        function fixTableStructure(tokens) {
            // 分析表格结构
            const rows = [];
            let currentRow = null;
            let columnCount = 0;

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];

                if (token.type === 'tr_open') {
                    currentRow = { tokens: [token], cells: [] };
                } else if (token.type === 'tr_close') {
                    if (currentRow) {
                        currentRow.tokens.push(token);
                        rows.push(currentRow);

                        // 记录最大列数（从头部行）
                        if (rows.length === 1) {
                            columnCount = currentRow.cells.length;
                        }

                        currentRow = null;
                    }
                } else if (token.type === 'th_open' || token.type === 'td_open') {
                    const cell = { open: token, content: null, close: null };
                    if (currentRow) {
                        currentRow.cells.push(cell);
                        currentRow.tokens.push(token);
                    }
                } else if (token.type === 'inline') {
                    if (currentRow && currentRow.cells.length > 0) {
                        const lastCell = currentRow.cells[currentRow.cells.length - 1];
                        lastCell.content = token;
                        currentRow.tokens.push(token);
                    }
                } else if (token.type === 'th_close' || token.type === 'td_close') {
                    if (currentRow && currentRow.cells.length > 0) {
                        const lastCell = currentRow.cells[currentRow.cells.length - 1];
                        lastCell.close = token;
                        currentRow.tokens.push(token);
                    }
                } else {
                    if (currentRow) {
                        currentRow.tokens.push(token);
                    }
                }
            }

            // 检测并修复问题行
            let needsFix = false;
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const prevRow = rows[i - 1];

                // 情况1：当前行列数不足，且第一个单元格为空
                if (row.cells.length < columnCount &&
                    row.cells[0].content &&
                    !row.cells[0].content.content.trim()) {

                    needsFix = true;
                    debug('Table row', i, 'needs merge (empty first cell)');
                }

                // 情况2：当前行以括号开头（可能是统计量）
                if (row.cells.length > 0 &&
                    row.cells[0].content &&
                    /^\s*\(/.test(row.cells[0].content.content)) {

                    needsFix = true;
                    debug('Table row', i, 'needs merge (starts with parenthesis)');
                }
            }

            // 如果不需要修复，返回 null
            if (!needsFix) {
                return null;
            }

            // TODO: 实际合并逻辑（复杂，暂时返回原始 tokens）
            // 这里可以进一步实现行合并、单元格填充等
            debug('Table fix logic not yet implemented, returning original');
            return null;
        }
    }

    // ========================================
    // 插件 3: 公式处理（替换为 KaTeX 渲染）
    // ========================================
    function mathPlugin(md) {
        debug('Loading math plugin');

        // 处理行内公式 $...$
        md.inline.ruler.before('escape', 'math_inline', function(state, silent) {
            const start = state.pos;
            const max = state.posMax;

            // 必须以 $ 开头
            if (state.src.charCodeAt(start) !== 0x24 /* $ */) {
                return false;
            }

            // 寻找结束的 $
            let pos = start + 1;
            while (pos < max && state.src.charCodeAt(pos) !== 0x24) {
                if (state.src.charCodeAt(pos) === 0x5C /* \ */) {
                    pos++; // 跳过转义字符
                }
                pos++;
            }

            if (pos >= max) {
                return false; // 没有找到闭合的 $
            }

            const content = state.src.slice(start + 1, pos);

            // 快速检查：跳过纯中文
            if (/^[\u4e00-\u9fa5，、。；：！？""''（）【】《》\s]+$/.test(content)) {
                return false;
            }

            // 检查是否像段落
            if (looksLikeParagraph(content)) {
                return false;
            }

            if (!silent) {
                const token = state.push('math_inline', 'math', 0);
                token.content = content.trim();
                token.markup = '$';
            }

            state.pos = pos + 1;
            return true;
        });

        // 处理块级公式 $$...$$
        md.block.ruler.before('fence', 'math_block', function(state, startLine, endLine, silent) {
            let pos = state.bMarks[startLine] + state.tShift[startLine];
            let max = state.eMarks[startLine];

            // 检查是否以 $$ 开头
            if (pos + 2 > max) return false;
            if (state.src.charCodeAt(pos) !== 0x24 || state.src.charCodeAt(pos + 1) !== 0x24) {
                return false;
            }

            pos += 2;
            let firstLine = state.src.slice(pos, max);

            // 单行块公式: $$...$$ 在同一行
            if (firstLine.trim().slice(-2) === '$$') {
                firstLine = firstLine.trim().slice(0, -2);
                if (!silent) {
                    const token = state.push('math_block', 'math', 0);
                    token.content = firstLine;
                    token.markup = '$$';
                    token.block = true;
                    token.map = [startLine, startLine + 1];
                }
                state.line = startLine + 1;
                return true;
            }

            // 多行块公式
            let nextLine = startLine;
            let lastLine;
            let lastPos;

            while (nextLine < endLine) {
                nextLine++;
                if (nextLine >= endLine) break;

                pos = state.bMarks[nextLine] + state.tShift[nextLine];
                max = state.eMarks[nextLine];

                if (pos < max && state.sCount[nextLine] < state.blkIndent) {
                    break;
                }

                // 检查是否以 $$ 结尾
                if (state.src.slice(pos, max).trim().slice(-2) === '$$') {
                    lastPos = state.src.slice(0, max).lastIndexOf('$$');
                    lastLine = state.src.slice(pos, lastPos);
                    break;
                }
            }

            if (!lastPos && lastPos !== 0) {
                return false;
            }

            if (!silent) {
                const oldParent = state.parentType;
                const oldLineMax = state.lineMax;
                state.parentType = 'math';

                const content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], true);
                const token = state.push('math_block', 'math', 0);
                token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '') + content;
                token.markup = '$$';
                token.block = true;
                token.map = [startLine, nextLine + 1];

                state.parentType = oldParent;
                state.lineMax = oldLineMax;
            }

            state.line = nextLine + 1;
            return true;
        });

        // 渲染规则
        md.renderer.rules.math_inline = function(tokens, idx) {
            const content = tokens[idx].content;
            try {
                const rendered = katex.renderToString(content, {
                    displayMode: false,
                    throwOnError: true,
                    strict: 'ignore'
                });
                metrics.formulaSuccesses++;
                return `<span class="katex-inline">${rendered}</span>`;
            } catch (error) {
                metrics.formulaErrors++;
                console.warn('[MarkdownProcessorAST] KaTeX inline error:', error.message);
                return `<span class="katex-fallback katex-inline" title="${escapeHtml(error.message)}"><code>${escapeHtml(content)}</code></span>`;
            }
        };

        md.renderer.rules.math_block = function(tokens, idx) {
            const content = tokens[idx].content;
            try {
                const rendered = katex.renderToString(content, {
                    displayMode: true,
                    throwOnError: true,
                    strict: 'ignore'
                });
                metrics.formulaSuccesses++;
                return `<div class="katex-block">${rendered}</div>\n`;
            } catch (error) {
                metrics.formulaErrors++;
                console.warn('[MarkdownProcessorAST] KaTeX block error:', error.message);
                return `<div class="katex-fallback katex-block" title="${escapeHtml(error.message)}"><pre>${escapeHtml(content)}</pre></div>\n`;
            }
        };
    }

    // ========================================
    // 注册插件
    // ========================================
    md.use(ocrFixPlugin);
    md.use(tableFixPlugin);
    md.use(mathPlugin);

    // ========================================
    // 主渲染函数
    // ========================================

    /**
     * 预处理 Markdown（图片替换等）
     */
    function preprocessMarkdown(mdText, images) {
        if (!mdText || typeof mdText !== 'string') {
            return '';
        }

        // 构建图片映射
        const imgMap = new Map();
        if (Array.isArray(images)) {
            images.forEach((img, idx) => {
                if (!img || !img.data) return;

                const keys = new Set();
                if (img.name) keys.add(img.name);
                if (img.id) keys.add(img.id);
                keys.add(`img-${idx}.jpeg.png`);
                keys.add(`img-${idx + 1}.jpeg.png`);

                [...keys].forEach(k => keys.add('images/' + k));

                const src = img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`;
                keys.forEach(k => imgMap.set(k, src));
            });
        }

        // 替换图片路径
        mdText = mdText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, path) => {
            const p = String(path).trim();
            if (/^(https?:|data:|\/\/)/i.test(p)) {
                return match;
            }

            const clean = p.split('?')[0].split('#')[0];
            const candidates = [
                clean,
                clean.replace(/^images\//, ''),
                clean.replace(/\.png$/i, ''),
                clean.replace(/^images\//, '').replace(/\.png$/i, ''),
                'images/' + clean,
                clean.split('/').pop(),
                'images/' + clean.split('/').pop()
            ];

            for (const key of candidates) {
                if (imgMap.has(key)) {
                    return `![${alt || ''}](${imgMap.get(key)})`;
                }
            }

            console.warn('[MarkdownProcessorAST] Image not found:', path);
            return match;
        });

        return mdText;
    }

    /**
     * 主渲染函数（带缓存）
     */
    function render(mdText, images) {
        metrics.totalRenders++;

        const cacheKey = `${CONFIG.version}:${mdText}`;

        // 检查缓存
        if (renderCache.has(cacheKey)) {
            metrics.cacheHits++;
            return renderCache.get(cacheKey);
        }

        metrics.cacheMisses++;

        try {
            // 预处理
            const processed = preprocessMarkdown(mdText, images);

            // AST 渲染
            const result = md.render(processed);

            // 缓存结果
            if (renderCache.size >= CONFIG.cacheSize) {
                const firstKey = renderCache.keys().next().value;
                renderCache.delete(firstKey);
            }
            renderCache.set(cacheKey, result);

            return result;
        } catch (error) {
            console.error('[MarkdownProcessorAST] Render error:', error);
            return `<div class="markdown-error">渲染失败: ${escapeHtml(error.message)}</div>`;
        }
    }

    // ========================================
    // 向后兼容层
    // ========================================

    /**
     * 兼容旧版 API: safeMarkdown
     */
    function safeMarkdown(md, images) {
        return preprocessMarkdown(md, images);
    }

    /**
     * 兼容旧版 API: renderWithKatexFailback
     */
    function renderWithKatexFailback(md, customRenderer) {
        // customRenderer 在新架构中暂不支持
        // 只在 debug 模式下显示警告
        if (customRenderer && CONFIG.debug) {
            console.warn('[MarkdownProcessorAST] Custom renderer not supported in AST mode');
        }
        return render(md, null);
    }

    // ========================================
    // 管理函数
    // ========================================

    function getMetrics() {
        return {
            ...metrics,
            cacheSize: renderCache.size,
            cacheHitRate: metrics.totalRenders > 0 ?
                (metrics.cacheHits / metrics.totalRenders * 100).toFixed(2) + '%' : '0%',
            formulaErrorRate: (metrics.formulaErrors + metrics.formulaSuccesses) > 0 ?
                (metrics.formulaErrors / (metrics.formulaErrors + metrics.formulaSuccesses) * 100).toFixed(2) + '%' : '0%'
        };
    }

    function clearCache() {
        renderCache.clear();
        Object.keys(metrics).forEach(key => {
            if (typeof metrics[key] === 'number') {
                metrics[key] = 0;
            }
        });
        debug('Cache cleared');
    }

    // ========================================
    // 导出 API
    // ========================================

    global.MarkdownProcessorAST = {
        // 核心函数
        render: render,
        safeMarkdown: safeMarkdown,
        renderWithKatexFailback: renderWithKatexFailback,

        // 管理函数
        getMetrics: getMetrics,
        clearCache: clearCache,

        // 配置
        config: CONFIG,

        // 版本信息
        version: CONFIG.version,
        compatibility: 'Backward compatible with MarkdownProcessor & MarkdownProcessorEnhanced'
    };

    // 向后兼容：全局启用新架构
    global.MarkdownProcessor = global.MarkdownProcessorAST;
    global.MarkdownProcessorEnhanced = global.MarkdownProcessorAST;

    console.log('%c[MarkdownProcessorAST] ✅ AST 架构已启用', 'color: #10b981; font-weight: bold', CONFIG.version);
    debug('MarkdownProcessorAST initialized', CONFIG.version);

})(window);
