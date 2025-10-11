// js/processing/reference-detector.js
// 参考文献识别器 - 自动识别文档中的参考文献部分

(function(global) {
    'use strict';

    /**
     * 参考文献部分的常见标题（多语言支持）
     */
    const REFERENCE_SECTION_PATTERNS = [
        // 英文
        /^#{1,3}\s*References?\s*$/im,
        /^#{1,3}\s*Bibliography\s*$/im,
        /^#{1,3}\s*Works?\s+Cited\s*$/im,
        /^#{1,3}\s*Literature\s+Cited\s*$/im,
        /^#{1,3}\s*Citations?\s*$/im,
        // 中文
        /^#{1,3}\s*参考文献\s*$/im,
        /^#{1,3}\s*引用文献\s*$/im,
        /^#{1,3}\s*文献引用\s*$/im,
        /^#{1,3}\s*参考资料\s*$/im,
        // 其他语言
        /^#{1,3}\s*Références?\s*$/im,  // 法语
        /^#{1,3}\s*Referenzen\s*$/im,   // 德语
        /^#{1,3}\s*Referencias\s*$/im,  // 西班牙语
        /^#{1,3}\s*参考文献\s*$/im,     // 日语
        // 纯文本格式（无Markdown标记）
        /^References?\s*$/im,
        /^Bibliography\s*$/im,
        /^参考文献\s*$/im
    ];

    /**
     * 检测文本是否为参考文献部分的标题
     */
    function isReferenceSectionTitle(line) {
        return REFERENCE_SECTION_PATTERNS.some(pattern => pattern.test(line.trim()));
    }

    /**
     * 检测一行文本是否可能是参考文献条目
     * 常见格式：
     * - [1] Author. Title. Journal, Year.
     * - 1. Author. Title. Journal, Year.
     * - Author. (Year). Title. Journal.
     */
    function isLikelyReferenceEntry(line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length < 20) return false;

        // 检测编号格式
        const numberPatterns = [
            /^\[\d+\]/,           // [1]
            /^\d+\./,             // 1.
            /^\(\d+\)/,           // (1)
            /^\d+\)\s/,           // 1)
            /^\[\d+\]/            // [1]
        ];

        const hasNumbering = numberPatterns.some(p => p.test(trimmed));

        // 检测年份（常见的年份格式）
        const hasYear = /\b(19|20)\d{2}\b/.test(trimmed);

        // 检测DOI
        const hasDOI = /\b(doi:|DOI:)\s*10\.\d+/.test(trimmed);

        // 检测常见的期刊标识符
        const hasJournalMarkers = /\b(Vol\.|vol\.|Volume|Issue|pp\.|pages?)\b/i.test(trimmed);

        // 检测作者名格式（姓, 名. 或 姓 名首字母.）
        const hasAuthorFormat = /[A-Z][a-z]+,\s*[A-Z]\./.test(trimmed) ||
                               /[A-Z][a-z]+\s+[A-Z]\./.test(trimmed);

        // 综合判断
        const score =
            (hasNumbering ? 2 : 0) +
            (hasYear ? 1 : 0) +
            (hasDOI ? 2 : 0) +
            (hasJournalMarkers ? 1 : 0) +
            (hasAuthorFormat ? 1 : 0);

        return score >= 2;
    }

    /**
     * 在文档中查找参考文献部分
     * @param {string} markdown - Markdown文本
     * @returns {Object|null} { startLine, endLine, title, content, entries }
     */
    function detectReferenceSection(markdown) {
        if (!markdown || typeof markdown !== 'string') {
            return null;
        }

        const lines = markdown.split('\n');
        let referenceSectionStart = -1;
        let referenceSectionTitle = '';

        // 1. 查找参考文献标题
        for (let i = 0; i < lines.length; i++) {
            if (isReferenceSectionTitle(lines[i])) {
                referenceSectionStart = i;
                referenceSectionTitle = lines[i].trim();
                break;
            }
        }

        // 如果没找到明确的标题，尝试通过连续的文献条目判断
        if (referenceSectionStart === -1) {
            let consecutiveReferences = 0;
            for (let i = lines.length - 1; i >= 0; i--) {
                if (isLikelyReferenceEntry(lines[i])) {
                    consecutiveReferences++;
                    if (consecutiveReferences >= 5) { // 至少5个连续的条目
                        referenceSectionStart = i;
                        referenceSectionTitle = 'References (auto-detected)';
                    }
                } else if (lines[i].trim() === '') {
                    continue; // 允许空行
                } else {
                    consecutiveReferences = 0;
                }
            }
        }

        if (referenceSectionStart === -1) {
            return null;
        }

        // 2. 确定参考文献部分的结束位置
        let referenceSectionEnd = lines.length - 1;

        // 查找下一个同级或更高级的标题
        const titleLevel = (referenceSectionTitle.match(/^#+/) || ['#'])[0].length;
        for (let i = referenceSectionStart + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^(#+)\s/);
            if (match && match[1].length <= titleLevel && !isReferenceSectionTitle(line)) {
                referenceSectionEnd = i - 1;
                break;
            }
        }

        // 3. 提取参考文献内容
        const content = lines.slice(referenceSectionStart + 1, referenceSectionEnd + 1).join('\n');

        // 4. 解析各个文献条目
        const entries = parseReferenceEntries(content);

        return {
            startLine: referenceSectionStart,
            endLine: referenceSectionEnd,
            title: referenceSectionTitle,
            content: content.trim(),
            entries: entries,
            totalCount: entries.length
        };
    }

    /**
     * 解析参考文献条目
     * @param {string} content - 参考文献部分的内容
     * @returns {Array} 文献条目数组
     */
    function parseReferenceEntries(content) {
        if (!content || typeof content !== 'string') {
            return [];
        }

        const entries = [];
        const lines = content.split('\n');
        let currentLines = [];
        let lineStartIndex = 0;

        // 检测是否是新条目的开始（必须有明确的编号）
        const isNewEntryStart = (line) => {
            const trimmed = line.trim();
            if (!trimmed) return false;

            // 必须以编号开头，且紧跟着是空格或内容
            const numberPatterns = [
                /^\[\d+\]\s+/,           // [1]
                /^\d+\.\s+/,             // 1.
                /^\(\d+\)\s+/,           // (1)
                /^\d+\)\s+/              // 1)
            ];

            return numberPatterns.some(p => p.test(trimmed));
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 空行：只在已有内容且下一行不是继续时才结束当前条目
            if (line === '') {
                // 检查下一个非空行是否是新条目
                let nextNonEmptyLine = null;
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].trim()) {
                        nextNonEmptyLine = lines[j];
                        break;
                    }
                }

                // 如果下一个非空行是新条目，则保存当前条目
                if (currentLines.length > 0 && nextNonEmptyLine && isNewEntryStart(nextNonEmptyLine)) {
                    const entryText = currentLines.join(' ');
                    if (entryText.trim()) {
                        entries.push({
                            index: entries.length,
                            rawText: entryText.trim(),
                            lineStart: lineStartIndex,
                            lineEnd: i - 1
                        });
                    }
                    currentLines = [];
                }
                continue;
            }

            // 检测新条目的开始（必须有明确的编号）
            if (isNewEntryStart(line)) {
                // 保存之前的条目
                if (currentLines.length > 0) {
                    const entryText = currentLines.join(' ');
                    if (entryText.trim()) {
                        entries.push({
                            index: entries.length,
                            rawText: entryText.trim(),
                            lineStart: lineStartIndex,
                            lineEnd: i - 1
                        });
                    }
                }
                // 开始新条目
                currentLines = [line];
                lineStartIndex = i;
            } else {
                // 继续当前条目（换行内容）
                if (currentLines.length === 0) {
                    // 如果还没有开始条目，尝试作为新条目开始
                    if (isLikelyReferenceEntry(line)) {
                        currentLines = [line];
                        lineStartIndex = i;
                    }
                } else {
                    // 添加到当前条目
                    currentLines.push(line);
                }
            }
        }

        // 处理最后一个条目
        if (currentLines.length > 0) {
            const entryText = currentLines.join(' ');
            if (entryText.trim()) {
                entries.push({
                    index: entries.length,
                    rawText: entryText.trim(),
                    lineStart: lineStartIndex,
                    lineEnd: lines.length - 1
                });
            }
        }

        return entries;
    }

    /**
     * 统计文献格式分布
     */
    function analyzeReferenceFormats(entries) {
        const formats = {
            numbered: 0,        // [1] 或 1.
            apa: 0,            // Author. (Year).
            mla: 0,            // Author. "Title."
            chicago: 0,        // Author. Title.
            ieee: 0,           // [1] Author, "Title,"
            unknown: 0
        };

        entries.forEach(entry => {
            const text = entry.rawText;

            if (/^\[\d+\]/.test(text) || /^\d+\./.test(text)) {
                formats.numbered++;
                if (/^\[\d+\]\s+[A-Z]/.test(text)) {
                    formats.ieee++;
                }
            } else if (/^[A-Z][a-z]+.*\(\d{4}\)/.test(text)) {
                formats.apa++;
            } else if (/^[A-Z][a-z]+.*".*"/.test(text)) {
                formats.mla++;
            } else if (/^[A-Z][a-z]+.*\..*\d{4}/.test(text)) {
                formats.chicago++;
            } else {
                formats.unknown++;
            }
        });

        return formats;
    }

    /**
     * 获取推荐的引用格式
     */
    function getRecommendedFormat(entries) {
        const formats = analyzeReferenceFormats(entries);
        const sorted = Object.entries(formats)
            .filter(([key]) => key !== 'unknown')
            .sort((a, b) => b[1] - a[1]);

        return sorted.length > 0 ? sorted[0][0] : 'unknown';
    }

    // 导出API
    global.ReferenceDetector = {
        detectReferenceSection,
        parseReferenceEntries,
        isReferenceSectionTitle,
        isLikelyReferenceEntry,
        analyzeReferenceFormats,
        getRecommendedFormat,
        version: '1.0.0'
    };

    console.log('[ReferenceDetector] Reference detector loaded.');

})(window);



