/**
 * 创建一个自定义的 marked.js 渲染器，用于在HTML输出中嵌入批注ID。
 * @param {Array<Object>} annotations - 当前文档的批注列表。
 * @param {string} contentIdentifier - 当前内容类型的标识符 ('ocr' 或 'translation')。
 * @param {Function} getKatexProcessedHtml - (此参数目前未被直接使用，但保留以便将来扩展) 一个获取KaTeX处理后HTML的函数。
 * @returns {marked.Renderer} 一个 marked.js 渲染器实例。
 */
function createCustomMarkdownRenderer(annotations, contentIdentifier, getKatexProcessedHtml) {
    const __ANNOTATION_DEBUG__ = (function(){
        try { return !!(window && (window.ENABLE_ANNOTATION_DEBUG || localStorage.getItem('ENABLE_ANNOTATION_DEBUG') === 'true')); } catch { return false; }
    })();
    const renderer = new marked.Renderer();
    const originalTextRenderer = renderer.text;
    const originalParagraphRenderer = renderer.paragraph;
    const originalLinkRenderer = renderer.link;
    const originalImageRenderer = renderer.image;
    const originalHeadingRenderer = renderer.heading;
    const originalTableRenderer = renderer.table;
    const originalBlockquoteRenderer = renderer.blockquote;
    const originalListRenderer = renderer.list;
    const originalListItemRenderer = renderer.listitem;
    const originalCheckboxRenderer = renderer.checkbox;
    const originalCodeRenderer = renderer.code; // For fenced code blocks
    const originalCodespanRenderer = renderer.codespan; // For inline code

    // 辅助函数：转义HTML特殊字符，用于属性或内容
    function escapeHtml(html) {
        return html.replace(/[&<>"']/g, function (match) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[match];
        });
    }

    // Helper function to find relevant annotations for a given text block.
    // This is a simplified version. A more robust solution would handle overlaps
    // and nested annotations more gracefully by segmenting the text.
    function getAnnotationsForText(text, relevantAnnotations) {
        const foundAnnotations = [];
        if (!text || !relevantAnnotations || relevantAnnotations.length === 0) {
            return foundAnnotations;
        }
        relevantAnnotations.forEach(ann => {
            const exact = ann.target.selector[0].exact;
            if (text.includes(exact)) { // Simple check
                foundAnnotations.push(ann);
            }
        });
        return foundAnnotations;
    }

    // 这个新的文本渲染器尝试对文本进行分段并应用span标签。
    // 在marked.js的渲染器字符串拼接模型中，完美地完成这项任务具有挑战性，
    // 特别是处理重叠批注和复杂的Markdown结构时。
    renderer.text = function(token) {
        let textToProcess; // 将用于批注处理的实际文本字符串

        if (typeof token === 'string') {
            textToProcess = token;
        } else if (token && typeof token === 'object' && typeof token.text === 'string') {
            textToProcess = token.text;
            // console.log('[CustomMarkdownRenderer] Token 是对象，使用 token.text:', textToProcess);
        } else if (token && typeof token === 'object' && typeof token.raw === 'string') {
            textToProcess = token.raw; // 后备到 token.raw
            // console.warn('[CustomMarkdownRenderer] Token 是对象，token.text 不是字符串，使用 token.raw:', textToProcess);
        } else {
            if (__ANNOTATION_DEBUG__) console.warn('[CustomMarkdownRenderer] 输入 `token` 不是字符串或无法识别的 token 对象。类型:', typeof token, '值:', token, '. 强制转换为字符串。');
            textToProcess = String(token); // 最后手段
        }

        let processedTextString = textToProcess; // 我们将在此字符串上进行替换

        // const currentContentIdentifierForFilter = window.globalCurrentContentIdentifier; // 移除对全局变量的依赖
        // 使用传递给 createCustomMarkdownRenderer 的 contentIdentifier 参数 (在 renderer.text 的闭包中可用)
        const relevantAnnotations = (window.data && window.data.annotations ? window.data.annotations : []).filter(
            ann => ann.targetType === contentIdentifier && // 直接使用参数 contentIdentifier
                   ann.target && Array.isArray(ann.target.selector) &&
                   ann.target.selector[0] && typeof ann.target.selector[0].exact === 'string' &&
                   ann.target.selector[0].exact.trim() !== ''
        ).sort((a, b) => b.target.selector[0].exact.length - a.target.selector[0].exact.length);

        if (relevantAnnotations.length > 0) {
            relevantAnnotations.forEach(ann => {
                const exact = ann.target.selector[0].exact;
                // 修正正则表达式特殊字符的转义，并使空白匹配更灵活
                // 1. 标准的正则表达式特殊字符转义
                let pattern = exact.replace(/[.*+?^${}()|[\\\]\\]/g, '\\$&');
                // 2. 将原始标注文本中的任何空白字符序列（包括换行符）替换为 \\s+，
                //    使其能匹配文本中的一个或多个任意空白字符。
                pattern = pattern.replace(/\s+/g, '\\\\s+');
                const regex = new RegExp(pattern, 'g');

                if (typeof processedTextString !== 'string') {
                    console.error('[CustomMarkdownRenderer] 严重错误: processedTextString 在循环中变为非字符串。值:', processedTextString);
                    processedTextString = String(processedTextString);
                }

                processedTextString = processedTextString.replace(regex, (match) => {
                    let textToWrapInSpan;
                    // 检查传递给 renderer.text 的原始 `token` 的类型
                    if (typeof token === 'object') {
                        // 如果原始 token 是一个对象，originalTextRenderer 可能期望一个对象。
                        // 由于 'match' 只是该 token 文本的一部分字符串，
                        // 我们应该自己对 'match' 进行转义并包裹它，
                        // 而不是调用 originalTextRenderer(match)，因为这会导致 "Cannot use 'in' operator" 错误。
                        textToWrapInSpan = escapeHtml(match); // 使用已有的 escapeHtml 函数
                    } else {
                        // 如果原始 token 是一个字符串，那么用 'match' (也是字符串) 调用 originalTextRenderer 应该是安全的。
                        let originalRenderedOutput = originalTextRenderer.call(this, match);
                        if (typeof originalRenderedOutput !== 'string') {
                            if (__ANNOTATION_DEBUG__) console.warn(`[CustomMarkdownRenderer] originalTextRenderer 对于匹配 "${match}" (原始token是字符串) 未返回字符串。得到 ${typeof originalRenderedOutput}。强制转换。`);
                            originalRenderedOutput = String(originalRenderedOutput);
                        }
                        textToWrapInSpan = originalRenderedOutput;
                    }
                    return `<span data-annotation-id="${escapeHtml(ann.id)}" class="pre-annotated">${textToWrapInSpan}</span>`;
                });
            });

            if (typeof processedTextString !== 'string') {
                 console.error('[CustomMarkdownRenderer] 严重错误: 注解循环最终的 processedTextString 不是字符串。值:', processedTextString);
                 return String(processedTextString);
            }
            return processedTextString; // 返回带有批注span的HTML字符串
        }

        // 默认路径: 使用原始 token 调用 originalTextRenderer
        let defaultOutput = originalTextRenderer.call(this, token);
        if (typeof defaultOutput !== 'string') {
            if (__ANNOTATION_DEBUG__) console.warn(`[CustomMarkdownRenderer] originalTextRenderer 对于 token "${JSON.stringify(token)}" (默认路径) 未返回字符串。得到 ${typeof defaultOutput}。强制转换。`);
            defaultOutput = String(defaultOutput);
        }
        return defaultOutput;
    };

    // 通常来说，如果一个批注针对整个块（例如段落），更安全的做法是包裹整个块，
    // 或者在完全渲染好的HTML上进行后处理步骤。
    renderer.paragraph = function(text) {
        // 此处的 `text` 参数已经是内部元素（如文本、链接、图片）渲染后的HTML字符串。
        // 如果我们想包裹整个段落，需要识别是否有任何批注在概念上针对此段落。
        // 仅使用 TextQuoteSelector 很难做到这一点。
        // 目前，我们只使用默认的段落渲染器。
        // 如果 `text` 中包含了我们添加的 `data-annotation-id` span，它们将被保留。
        return originalParagraphRenderer.call(this, text);
    };


    // 如果需要，你可以扩展其他渲染器 (例如 image, heading 等)，
    // 比如，如果一个批注专门针对一张图片，可以添加 `data-annotation-target="true"`。
    // renderer.image = function(href, title, text) {
    //     // 检查是否有批注针对此图片 (例如，基于 href 或 alt 文本)
    //     // 如果有，添加一个包装元素或 data 属性。
    //     return originalImageRenderer.call(this, href, title, text);
    // };

    return renderer;
}

// 如果不使用模块系统，则暴露到全局作用域；如果使用模块，则导出。
window.createCustomMarkdownRenderer = createCustomMarkdownRenderer;
