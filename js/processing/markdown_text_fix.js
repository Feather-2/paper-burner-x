// js/processing/markdown_text_fix.js
// 专门修复数学文本显示问题的补丁
(function MarkdownTextFix(global) {

    /**
     * 修复长段落中的数学公式显示问题
     * @param {string} markdown - 原始 markdown 文本
     * @returns {string} 修复后的 markdown
     */
    function fixMathTextDisplay(markdown) {
        if (!markdown || typeof markdown !== 'string') {
            return markdown;
        }

        // 1. 保护已有的数学公式，避免被段落分割
        let processed = markdown;
        
        // 2. 修复段落内的公式换行问题
        // 将段落内不必要的换行转换为空格，但保持公式完整
        processed = processed.replace(/([^.\n])\n(?![#\-*+\d\s])/g, '$1 ');
        
        // 3. 确保数学公式前后有适当的空格
        processed = processed.replace(/([^\s])\$\$/g, '$1 $$');
        processed = processed.replace(/\$\$([^\s])/g, '$$ $1');
        processed = processed.replace(/([^\s])\$([^$])/g, '$1 $$$2');
        processed = processed.replace(/([^$])\$([^\s])/g, '$1$ $2');
        
        // 4. 修复中文和公式之间的空格问题
        processed = processed.replace(/([\u4e00-\u9fff])\$\$/g, '$1 $$');
        processed = processed.replace(/\$\$([\u4e00-\u9fff])/g, '$$ $1');
        processed = processed.replace(/([\u4e00-\u9fff])\$([^$])/g, '$1 $$$2');
        processed = processed.replace(/([^$])\$([\u4e00-\u9fff])/g, '$1$ $2');

        return processed;
    }

    /**
     * 增强的 KaTeX 渲染选项
     */
    const enhancedKatexOptions = {
        displayMode: false,
        throwOnError: false,
        errorColor: '#cc0000',
        strict: 'ignore',
        output: 'html',
        trust: false,
        fleqn: false,
        leqno: false,
        minRuleThickness: 0.04,
        colorIsTextColor: false,
        maxSize: Infinity,
        maxExpand: 1000,
        globalGroup: false,
        macros: {
            "\\RR": "\\mathbb{R}",
            "\\NN": "\\mathbb{N}",
            "\\ZZ": "\\mathbb{Z}",
            "\\QQ": "\\mathbb{Q}",
            "\\CC": "\\mathbb{C}",
            "\\sum": "\\sum",
            "\\times": "\\times",
            "\\frac": "\\frac",
            "\\div": "\\div"
        }
    };

    /**
     * 改进的数学公式渲染函数
     * @param {string} content - 公式内容
     * @param {boolean} displayMode - 是否为显示模式
     * @returns {string} 渲染后的 HTML
     */
    function renderMathImproved(content, displayMode = false) {
        if (!content || typeof content !== 'string') {
            return '';
        }

        const options = {
            ...enhancedKatexOptions,
            displayMode: displayMode
        };

        try {
            // 预处理公式内容
            let processedContent = content.trim();
            // 清理零宽字符/组合下划线/误入的中文标点等边缘字符
            processedContent = processedContent
              .replace(/[\u200B-\u200D\uFEFF]/g, '')
              .replace(/^[\u0300-\u036F]+|[\u0300-\u036F]+$/g, '')
              .replace(/^[\s\u3000。，、；：：“”\(（\)）\[\]【】《》‘’'"–—-]+/, '')
              .replace(/[\s\u3000。，、；：：“”\(（\)）\[\]【】《》‘’'"–—-]+$/, '')
              .replace(/\s{2,}/g, ' ');
            
            // 修复常见的公式问题
            if (/\\right\s*$/.test(processedContent)) {
                let close = ')';
                try {
                    const re = /\\left\s*([\(\[\{])/g;
                    let m;
                    while ((m = re.exec(processedContent)) !== null) {
                        const ch = m[1];
                        close = ch === '(' ? ')' : ch === '[' ? ']' : '}';
                    }
                } catch(_) { /* ignore */ }
                processedContent = processedContent.replace(/\\right\s*$/, `\\right${close}`);
            }
            // Degree unit normalization: \mathrm{ ^\circ C } or \mathrm{ \;^\circ C }
            processedContent = processedContent.replace(/\\mathrm\{\s*(?:\\;|\s)*\^\s*\{?\s*\\?circ\s*\}?\s*([A-Za-z])\s*\}/g, '^{\\circ}\\mathrm{$1}');
            // Unicode triangles
            processedContent = processedContent.replace(/▲/g, '\\blacktriangle').replace(/△/g, '\\triangle');
            processedContent = processedContent.replace(/\\times/g, ' \\times ');
            processedContent = processedContent.replace(/([a-zA-Z])([0-9])/g, '$1_{$2}');
            
            const rendered = katex.renderToString(processedContent, options);
            const containerClass = displayMode ? 'katex-display-fixed' : 'katex-inline-fixed';
            const originalAttr = ` data-original-text="${escapeHtml(processedContent)}"`;
            
            return displayMode 
                ? `<div class="${containerClass}"${originalAttr}>${rendered}</div>`
                : `<span class="${containerClass}"${originalAttr}>${rendered}</span>`;
                
        } catch (error) {
            console.warn('[MathFix] KaTeX rendering failed:', error.message);
            
            const escapedContent = escapeHtml(content);
            const errorTitle = `数学公式渲染失败: ${error.message}`;
            const ariaLabel = escapeHtml(errorTitle);
            const containerTag = displayMode ? 'div' : 'span';
            const innerTag = displayMode ? 'pre' : 'span';
            const containerClass = displayMode ? 'katex-fallback katex-block math-error-block' : 'katex-fallback katex-inline math-error-inline';
            const dataAttr = ` data-katex-error="${escapeHtml(error.message)}" title="${ariaLabel}"`;

            return displayMode
                ? `
<${containerTag} class="${containerClass}"${dataAttr}><${innerTag} class="katex-fallback-source">${escapedContent}</${innerTag}></${containerTag}>
`
                : `<${containerTag} class="${containerClass}"${dataAttr}><${innerTag} class="katex-fallback-source">${escapedContent}</${innerTag}></${containerTag}>`;
        }
    }

    /**
     * 改进的 markdown 渲染，专门处理数学文本
     * @param {string} markdown - 输入的 markdown
     * @param {Array} images - 图片数组
     * @returns {string} 渲染后的 HTML
     */
    function renderMathMarkdown(markdown, images = []) {
        if (!markdown) return '';

        // 1. 预处理文本
        let processed = fixMathTextDisplay(markdown);
        
        // 2. 处理图片
        if (Array.isArray(images) && images.length > 0) {
            const imgMap = new Map();
            images.forEach((img, idx) => {
                if (img && img.data) {
                    const keys = [
                        img.name, img.id,
                        `img-${idx}.jpeg.png`,
                        `img-${idx + 1}.jpeg.png`
                    ].filter(Boolean);
                    
                    keys.forEach(k => {
                        imgMap.set(k, img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`);
                        imgMap.set(`images/${k}`, imgMap.get(k));
                    });
                }
            });

            processed = processed.replace(/!\[([^\]]*)\]\((?:images\/)?(img-\d+\.jpeg\.png)\)/gi, (match, alt, fname) => {
                return imgMap.has(fname) 
                    ? `![${alt || ''}](${imgMap.get(fname)})`
                    : `<span class="missing-image">[图片: ${alt || fname}]</span>`;
            });
        }

        // 3. 处理数学公式
        // 先处理块级公式
        processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
            return renderMathImproved(content, true);
        });

        // 再处理行内公式
        processed = processed.replace(/\$([^$\n]+?)\$/g, (match, content) => {
            return renderMathImproved(content, false);
        });

        // 4. 使用 marked 处理其余 markdown
        try {
            return marked.parse(processed, {
                breaks: false, // 重要：不要将换行转换为 <br>
                gfm: true,
                sanitize: false
            });
        } catch (error) {
            console.error('[MathFix] Marked parsing failed:', error);
            return `<div class="markdown-error">Markdown 解析失败: ${escapeHtml(error.message)}</div>`;
        }
    }

    /**
     * HTML 转义函数
     */
    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * 修复已渲染的 DOM 中的数学显示问题
     * @param {Element} container - 容器元素
     */
    function fixRenderedMath(container) {
        if (!container) return;

        // 查找所有可能的数学公式元素
        const mathElements = container.querySelectorAll('.katex, .katex-display, .katex-inline, [class*="katex"]');
        
        mathElements.forEach(el => {
            // 确保数学公式有适当的间距
            if (el.classList.contains('katex-display') || el.classList.contains('katex-display-fixed')) {
                el.style.margin = '16px 0';
                el.style.textAlign = 'center';
                el.style.display = 'block';
            } else if (el.classList.contains('katex-inline') || el.classList.contains('katex-inline-fixed')) {
                el.style.margin = '0 2px';
                el.style.display = 'inline';
            }
        });

        // 修复段落中的数学公式换行问题
        const paragraphs = container.querySelectorAll('p');
        paragraphs.forEach(p => {
            // 移除数学公式前后不必要的换行
            const html = p.innerHTML;
            const fixed = html
                .replace(/\s*(<(?:span|div)[^>]*katex[^>]*>.*?<\/(?:span|div)>)\s*/g, ' $1 ')
                .replace(/\s{2,}/g, ' ')
                .trim();
            
            if (fixed !== html) {
                p.innerHTML = fixed;
            }
        });
    }

    // 暴露公共接口
    global.MarkdownTextFix = {
        fixMathTextDisplay: fixMathTextDisplay,
        renderMathImproved: renderMathImproved,
        renderMathMarkdown: renderMathMarkdown,
        fixRenderedMath: fixRenderedMath,
        enhancedKatexOptions: enhancedKatexOptions
    };

    // 如果 MarkdownProcessor 存在，则扩展它
    if (global.MarkdownProcessor) {
        global.MarkdownProcessor.fixMathTextDisplay = fixMathTextDisplay;
        global.MarkdownProcessor.renderMathMarkdown = renderMathMarkdown;
        global.MarkdownProcessor.fixRenderedMath = fixRenderedMath;
    }

    // 如果 MarkdownProcessorEnhanced 存在，则扩展它
    if (global.MarkdownProcessorEnhanced) {
        global.MarkdownProcessorEnhanced.fixMathTextDisplay = fixMathTextDisplay;
        global.MarkdownProcessorEnhanced.renderMathMarkdown = renderMathMarkdown;
        global.MarkdownProcessorEnhanced.fixRenderedMath = fixRenderedMath;
    }

})(window);
