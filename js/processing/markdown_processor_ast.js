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

    // Phase 3.5: 记录已经警告过的图片路径，避免流式更新时重复警告
    const _warnedImages = new Set();

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

        // 白名单：包含明显的 LaTeX 命令，应该被识别为公式
        if (/\\(mathrm|mathbf|mathit|text|frac|sqrt|sum|int|limits|cdot|cdots|ldots|dots|times|div|pm|infty|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|mathbb|psi|rangle|langle|in)\b/.test(text)) {
            return false; // 不是段落，是公式
        }

        // 白名单：包含常见的 LaTeX 空格命令
        if (/\\[,;:!\s]/.test(text)) {
            return false; // 不是段落，是公式
        }

        // 白名单：包含数学符号（下标、上标、括号等），应该被识别为公式
        if (/[_^{}=+\-*/()]/.test(text)) {
            return false; // 包含数学符号，是公式
        }

        // 先移除 LaTeX 转义序列（如 \; \, \! 等），避免误判
        const cleanText = text.replace(/\\[,;:!]/g, '');

        // 包含句子标点
        if (/[。；;]/.test(cleanText)) return true;
        // 包含多个逗号（提高阈值到 10 个，因为数学公式中逗号很常见）
        if ((cleanText.match(/[，,]/g) || []).length > 10) return true;
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

        // 处理行内公式 $...$ 和 $$...$$
        md.inline.ruler.before('escape', 'math_inline', function(state, silent) {
            const start = state.pos;
            const max = state.posMax;

            // 必须以 $ 开头
            if (state.src.charCodeAt(start) !== 0x24 /* $ */) {
                return false;
            }

            // 检测是否是 $$（块级公式在行内）
            const isDouble = (start + 1 < max && state.src.charCodeAt(start + 1) === 0x24);
            const searchStart = isDouble ? start + 2 : start + 1;
            const endMarker = isDouble ? '$$' : '$';

            // 寻找结束标记
            let pos = searchStart;
            let foundEnd = false;
            while (pos < max) {
                const char = state.src.charCodeAt(pos);

                // 遇到换行符，停止搜索（行内公式不应跨行）
                if (char === 0x0A /* \n */) {
                    break;
                }

                // 遇到反斜杠，跳过反斜杠和后面的字符
                if (char === 0x5C /* \ */) {
                    pos += 2;
                    continue;
                }

                // 找到 $
                if (char === 0x24 /* $ */) {
                    if (isDouble) {
                        // 需要确认是 $$
                        if (pos + 1 < max && state.src.charCodeAt(pos + 1) === 0x24) {
                            foundEnd = true;
                            break; // 找到 $$
                        }
                    } else {
                        foundEnd = true;
                        break; // 找到 $
                    }
                }

                pos++;
            }

            if (!foundEnd) {
                return false; // 没有找到闭合标记
            }

            const content = state.src.slice(searchStart, pos);

            // 内容不能为空
            if (!content || !content.trim()) {
                return false;
            }

            // 快速检查：跳过纯中文（但允许单个汉字数学公式）
            if (content.length > 1 && /^[\u4e00-\u9fa5，、。；：！？""''（）【】《》\s]+$/.test(content)) {
                return false;
            }

            // 检查是否像段落（只对单 $ 检查，且长度超过3个字符）
            if (!isDouble && content.length > 3 && looksLikeParagraph(content)) {
                return false;
            }

            if (!silent) {
                // 在段落中的 $$...$$ 也使用 inline mode（不独立成行）
                const token = state.push('math_inline', 'math', 0);
                token.content = content.trim();
                token.markup = endMarker;
                token.block = false; // 行内元素统一使用 inline mode
            }

            state.pos = pos + (isDouble ? 2 : 1);
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

        // 修复压缩的单行表格（所有内容在一行）
        mdText = fixCompressedTables(mdText);

        // 修复表格列数不匹配问题
        mdText = fixTableColumnMismatch(mdText);

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

            // Phase 3.5: 只警告一次，避免流式更新时重复输出
            if (!_warnedImages.has(path)) {
                console.warn('[MarkdownProcessorAST] Image not found:', path);
                _warnedImages.add(path);
            }
            return match;
        });

        return mdText;
    }

    /**
     * 修复压缩的单行表格
     * 将 "| a | b | |---|---| | c | d |" 转换为多行格式
     */
    function fixCompressedTables(text) {
        if (!text || !text.includes('|')) return text;

        // 检测表格分隔符行的模式：|---|---|... 或 |:---|---:| 等
        const separatorPattern = /\|(:?-+:?\|)+/;

        return text.split('\n').map(line => {
            // 只处理包含分隔符的行
            if (!separatorPattern.test(line)) {
                return line;
            }

            // 统计管道符数量，判断是否可能是压缩表格
            const pipeCount = (line.match(/\|/g) || []).length;
            if (pipeCount < 10) return line; // 至少需要多行表格的管道符数量

            // 尝试分割表格
            try {
                const fixed = splitCompressedTable(line);
                if (fixed !== line) {
                    metrics.tableFixCount++;
                    console.log('[MarkdownProcessorAST] 修复压缩表格，管道符:', pipeCount);
                }
                return fixed;
            } catch (err) {
                console.warn('[MarkdownProcessorAST] 表格修复失败:', err.message);
                return line;
            }
        }).join('\n');
    }

    /**
     * 分割压缩表格为多行
     */
    function splitCompressedTable(line) {
        // 找到分隔符行：|---|---|---|...
        const separatorMatch = line.match(/\|(:?-+:?\|)+/);
        if (!separatorMatch) return line;

        const separatorIndex = separatorMatch.index;
        const separator = separatorMatch[0];

        // 计算列数：分隔符中的 | 数量 - 1
        // 例如：|---|---|---| 有 4 个 |，对应 3 列
        const columnCount = (separator.match(/\|/g) || []).length - 1;
        if (columnCount < 2) return line; // 至少2列

        // 每行需要的管道符数量 = 列数 + 1
        const pipesPerRow = columnCount + 1;

        // 提取表头（分隔符之前）
        // 注意：分隔符匹配包含开头的 |，所以需要把它补回表头
        let beforeSeparator = line.substring(0, separatorIndex);
        if (line[separatorIndex] === '|') {
            beforeSeparator += '|'; // 补回被分隔符匹配吃掉的 |
        }
        beforeSeparator = beforeSeparator.trim();

        const headerPipes = (beforeSeparator.match(/\|/g) || []).length;
        console.log('[MarkdownProcessorAST] 表头管道符:', headerPipes, '/', pipesPerRow);

        let headerRow;
        const headerResult = extractRow(beforeSeparator, pipesPerRow);
        if (headerResult) {
            headerRow = headerResult.row;
            console.log('[MarkdownProcessorAST] ✓ 表头提取成功');
        } else if (headerPipes === pipesPerRow - 1) {
            // 如果只差1个管道符，添加结尾的 |
            headerRow = beforeSeparator + ' |';
            console.log('[MarkdownProcessorAST] 修复表头：添加缺失的结尾 |');
        } else {
            console.warn('[MarkdownProcessorAST] 表头提取失败，管道符:', headerPipes, '需要:', pipesPerRow);
            return line;
        }

        // 提取数据行（分隔符之后）
        const afterSeparator = line.substring(separatorIndex + separator.length);
        const dataRows = extractAllRows(afterSeparator, pipesPerRow);

        if (dataRows.length === 0) {
            console.warn('[MarkdownProcessorAST] 未提取到数据行');
            return line;
        }

        // 构建多行表格
        const result = [
            headerRow,
            separator,
            ...dataRows
        ].join('\n');

        console.log('[MarkdownProcessorAST] 压缩表格分割:', {
            原始长度: line.length,
            列数: columnCount,
            表头: headerRow.substring(0, 50) + '...',
            数据行数: dataRows.length
        });

        return result;
    }

    /**
     * 从文本开头提取一行表格（包含指定数量的管道符）
     * @returns {Object} { row: 提取的行（trim后）, endIndex: 原始结束位置 }
     */
    function extractRow(text, pipesNeeded) {
        if (!text || !text.includes('|')) return null;

        // 找到所需数量的管道符
        let pipeCount = 0;
        let endIndex = -1;

        for (let i = 0; i < text.length; i++) {
            if (text[i] === '|') {
                pipeCount++;
                if (pipeCount === pipesNeeded) {
                    endIndex = i + 1;
                    break;
                }
            }
        }

        if (endIndex === -1) return null;

        return {
            row: text.substring(0, endIndex).trim(),
            endIndex: endIndex
        };
    }

    /**
     * 修复表格列数不匹配问题
     * 确保表头、分隔符和数据行的列数一致
     */
    function fixTableColumnMismatch(text) {
        if (!text || !text.includes('|')) return text;

        const lines = text.split('\n');
        const fixedLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.includes('|')) {
                fixedLines.push(lines[i]);
                continue;
            }

            // 检测是否为表格分隔符行
            const isSeparator = /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)+\|?$/.test(line);

            if (isSeparator && i > 0) {
                // 这是分隔符行，检查与上一行（表头）的列数
                const prevLine = fixedLines[fixedLines.length - 1];
                if (prevLine && prevLine.includes('|')) {
                    const prevPipes = (prevLine.match(/\|/g) || []).length;
                    const currPipes = (line.match(/\|/g) || []).length;

                    if (prevPipes !== currPipes) {
                        console.log(`[MarkdownProcessorAST] 检测到列数不匹配：表头 ${prevPipes} 列，分隔符 ${currPipes} 列`);

                        // 修复策略：调整分隔符以匹配表头
                        if (prevPipes < currPipes) {
                            // 表头列数少，分隔符列数多 → 删除分隔符的多余列
                            const sepParts = line.split('|').filter(part => part.trim() !== '' || part === '');
                            while (sepParts.length > prevPipes) {
                                sepParts.pop();
                            }
                            // 确保开头和结尾有 |
                            const fixedSep = '|' + sepParts.slice(1).join('|');
                            console.log(`[MarkdownProcessorAST] 修复分隔符：从 ${currPipes} 列减少到 ${prevPipes} 列`);
                            fixedLines.push(fixedSep);
                            continue;
                        } else {
                            // 表头列数多，分隔符列数少 → 给分隔符添加列
                            let fixedSep = line;
                            let iterationCount = 0;
                            const maxIterations = 100; // 防止死循环
                            while ((fixedSep.match(/\|/g) || []).length < prevPipes && iterationCount < maxIterations) {
                                // 在结尾 | 之前添加 ---
                                if (fixedSep.endsWith('|')) {
                                    fixedSep = fixedSep.slice(0, -1) + '---|';
                                } else {
                                    fixedSep += '---|';
                                }
                                iterationCount++;
                            }
                            if (iterationCount >= maxIterations) {
                                console.warn(`[MarkdownProcessorAST] 修复分隔符时达到最大迭代次数，跳过该行`);
                                fixedLines.push(line); // 使用原始行
                            } else {
                                console.log(`[MarkdownProcessorAST] 修复分隔符：从 ${currPipes} 列增加到 ${prevPipes} 列`);
                                fixedLines.push(fixedSep);
                            }
                            continue;
                        }
                    }
                }
            }

            // 如果是表格数据行，检查与分隔符的列数
            if (i >= 2 && lines[i-1] && /^\|[\s:]*-+/.test(lines[i-1])) {
                const separatorLine = fixedLines[fixedLines.length - 1];
                const sepPipes = (separatorLine.match(/\|/g) || []).length;
                const currPipes = (line.match(/\|/g) || []).length;

                if (currPipes !== sepPipes) {
                    console.log(`[MarkdownProcessorAST] 数据行列数不匹配：${currPipes} vs ${sepPipes}`);

                    // 调整数据行以匹配分隔符
                    if (currPipes < sepPipes) {
                        // 数据行列数少 → 添加空单元格
                        let fixedLine = line;
                        let iterationCount = 0;
                        const maxIterations = 100; // 防止死循环
                        while ((fixedLine.match(/\|/g) || []).length < sepPipes && iterationCount < maxIterations) {
                            // 直接在末尾添加空单元格（无论末尾是否有 |）
                            if (!fixedLine.endsWith('|')) {
                                fixedLine += '|';
                            }
                            fixedLine += ' |';
                            iterationCount++;
                        }
                        if (iterationCount >= maxIterations) {
                            console.warn(`[MarkdownProcessorAST] 修复数据行时达到最大迭代次数，跳过该行`);
                            fixedLines.push(line); // 使用原始行
                        } else {
                            fixedLines.push(fixedLine);
                        }
                        continue;
                    } else if (currPipes > sepPipes) {
                        // 数据行列数多 → 截断多余的列
                        const parts = line.split('|');
                        // 保留前 sepPipes+1 个部分（因为第一个部分通常是空的）
                        const truncatedParts = parts.slice(0, sepPipes + 1);
                        let fixedLine = truncatedParts.join('|');
                        // 确保结尾有 |
                        if (!fixedLine.endsWith('|')) {
                            fixedLine += '|';
                        }
                        console.log(`[MarkdownProcessorAST] 截断数据行：从 ${currPipes} 列减少到 ${sepPipes} 列`);
                        fixedLines.push(fixedLine);
                        continue;
                    }
                }
            }

            fixedLines.push(lines[i]);
        }

        return fixedLines.join('\n');
    }

    /**
     * 从文本中提取所有表格行
     * 按照固定的管道符数量提取每一行
     */
    function extractAllRows(text, pipesPerRow) {
        const rows = [];
        let remaining = text.trim();
        let iterationCount = 0;
        const maxIterations = 10000; // 防止死循环（大文档可能有很多行）

        while (remaining.length > 0 && iterationCount < maxIterations) {
            iterationCount++;
            const previousLength = remaining.length;

            // 跳过开头的空白和单个 |
            remaining = remaining.trimStart();
            if (remaining.startsWith('|')) {
                remaining = remaining.substring(1).trimStart();
            }

            if (remaining.length === 0) break;

            // 提取一行（找到 pipesPerRow 个管道符）
            const result = extractRow(remaining, pipesPerRow);
            if (!result) {
                // 如果提取失败，尝试查找下一个 | | 分隔符
                const nextSep = remaining.indexOf(' | |');
                if (nextSep > 0) {
                    console.warn('[MarkdownProcessorAST] 跳过无效数据:', remaining.substring(0, Math.min(50, nextSep)));
                    remaining = remaining.substring(nextSep + 3);
                    continue;
                }
                break;
            }

            rows.push('|' + result.row);

            // 移动到下一行
            remaining = remaining.substring(result.endIndex).trim();

            // 检测是否有进展（防止死循环）
            if (remaining.length >= previousLength) {
                console.error('[MarkdownProcessorAST] extractAllRows 检测到无进展，退出循环');
                break;
            }

            // 防止无限循环
            if (rows.length > 100) {
                console.warn('[MarkdownProcessorAST] 表格行数超过限制，停止提取');
                break;
            }
        }

        console.log('[MarkdownProcessorAST] 提取到', rows.length, '行数据');
        return rows;
    }

    /**
     * 主渲染函数（带缓存）
     * @param {string} mdText - Markdown 文本
     * @param {Array} images - 图片数组
     * @param {Array} annotations - 注释数组（可选）
     * @param {string} contentIdentifier - 内容标识符（可选）
     */
    function render(mdText, images, annotations, contentIdentifier) {
        metrics.totalRenders++;

        const cacheKey = `${CONFIG.version}:${mdText}:${annotations ? annotations.length : 0}`;

        // 检查缓存
        if (renderCache.has(cacheKey)) {
            metrics.cacheHits++;
            return renderCache.get(cacheKey);
        }

        metrics.cacheMisses++;

        try {
            // 预处理
            const processed = preprocessMarkdown(mdText, images);

            // 如果有注释，动态注册注释插件
            let mdInstance = md;
            if (annotations && annotations.length > 0 && global.createAnnotationPluginAST) {
                // 创建临时的 markdown-it 实例（避免污染全局实例）
                mdInstance = markdownit({
                    html: true,
                    breaks: false,
                    linkify: false,
                    typographer: false
                });

                // 注册所有插件
                mdInstance.use(ocrFixPlugin);
                mdInstance.use(tableFixPlugin);
                mdInstance.use(mathPlugin);

                // 注册注释插件
                const annotationPlugin = global.createAnnotationPluginAST(annotations, {
                    contentIdentifier: contentIdentifier || 'default',
                    debug: CONFIG.debug
                });
                mdInstance.use(annotationPlugin);

                debug('Rendering with', annotations.length, 'annotations');
            }

            // AST 渲染
            const result = mdInstance.render(processed);

            // 缓存结果（注意：带注释的渲染不应缓存太久）
            if (!annotations || annotations.length === 0) {
                if (renderCache.size >= CONFIG.cacheSize) {
                    const firstKey = renderCache.keys().next().value;
                    renderCache.delete(firstKey);
                }
                renderCache.set(cacheKey, result);
            }

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

    /**
     * 新 API: 支持注释的渲染
     * @param {string} md - Markdown 文本
     * @param {Array} images - 图片数组
     * @param {Array} annotations - 注释数组 [{text, id, ...}, ...]
     * @param {string} contentIdentifier - 内容标识符
     */
    function renderWithAnnotations(md, images, annotations, contentIdentifier) {
        return render(md, images, annotations, contentIdentifier);
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

    function setDebug(enabled) {
        CONFIG.debug = !!enabled;
        debug('Debug mode', enabled ? 'enabled' : 'disabled');
    }

    // ========================================
    // 导出 API
    // ========================================

    global.MarkdownProcessorAST = {
        // 核心函数
        render: render,
        safeMarkdown: safeMarkdown,
        renderWithKatexFailback: renderWithKatexFailback,
        renderWithAnnotations: renderWithAnnotations,  // 新增：支持注释

        // 管理函数
        getMetrics: getMetrics,
        clearCache: clearCache,
        setDebug: setDebug,

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
