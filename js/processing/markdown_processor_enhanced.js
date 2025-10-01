// js/processing/markdown_processor_enhanced.js
// Enhanced markdown processor with improved robustness for formulas and complex content
(function MarkdownProcessorEnhanced(global) {
    // Enhanced cache with versioning and size limits
    const renderCache = new Map();
    const MAX_CACHE_SIZE = 1000;
    const CACHE_VERSION = '2.0';
    
    // Performance metrics tracking
    const metrics = {
        cacheHits: 0,
        cacheMisses: 0,
        totalRenders: 0,
        avgRenderTime: 0,
        formulaErrors: 0,
        formulaSuccesses: 0
    };

    const FORMULA_BLOCK_HINTS = [
        /\r|\n/, // explicit line breaks
        /\\\\/, // LaTeX newline command
        /\\tag\b/, // equation tags
        /\\label\b/,
        /\\eqref\b/,
        /\\display(?:style|limits)\b/,
        /\\begin\{(?:align\*?|aligned|flalign\*?|gather\*?|multline\*?|split|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/,
        /\\end\{(?:align\*?|aligned|flalign\*?|gather\*?|multline\*?|split|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/
    ];

    /**
     * Enhanced markdown preprocessing with robust formula and image handling
     * @param {string} md - Input markdown text
     * @param {Array<Object>} images - Image objects with name/id and data
     * @returns {string} Processed markdown text
     */
    function safeMarkdownEnhanced(md, images) {
        performance.mark('safeMarkdown-enhanced-start');
        
        if (!md || typeof md !== 'string') {
            performance.mark('safeMarkdown-enhanced-end');
            performance.measure('safeMarkdown-enhanced', 'safeMarkdown-enhanced-start', 'safeMarkdown-enhanced-end');
            return '';
        }

        // Build robust image mapping with multiple fallback keys
        const imgMap = new Map();
        if (Array.isArray(images)) {
            images.forEach((img, idx) => {
                if (!img || !img.data) return;
                
                const keys = new Set();
                
                // Add various possible keys
                if (img.name) keys.add(img.name);
                if (img.id) keys.add(img.id);
                keys.add(`img-${idx}.jpeg.png`);
                keys.add(`img-${idx + 1}.jpeg.png`);
                
                // Add with 'images/' prefix
                [...keys].forEach(k => keys.add('images/' + k));
                
                const src = img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`;
                keys.forEach(k => imgMap.set(k, src));
            });
        }

        // Enhanced image replacement with better error handling
        md = md.replace(/!\[([^\]]*)\]\((?:images\/)?(img-\d+\.jpeg\.png)\)/gi, (match, alt, fname) => {
            if (imgMap.has(fname)) {
                return `![${alt || ''}](${imgMap.get(fname)})`;
            } else {
                console.warn(`[MarkdownProcessorEnhanced] Image not found: ${fname}`);
                return `<span class="missing-image" title="Missing: ${fname}">[图片: ${alt || fname}]</span>`;
            }
        });

        // Enhanced custom syntax processing with better error handling
        md = processCustomSyntax(md);

        performance.mark('safeMarkdown-enhanced-end');
        performance.measure('safeMarkdown-enhanced', 'safeMarkdown-enhanced-start', 'safeMarkdown-enhanced-end');
        return md;
    }

    /**
     * Process custom syntax (subscripts, superscripts) with enhanced robustness
     * @param {string} md - Markdown text
     * @returns {string} Processed markdown
     */
    function processCustomSyntax(md) {
        // Enhanced regex patterns with better boundary detection
        const patterns = [
            // Base with superscript: ${base}^{sup}$
            {
                regex: /\$\{\s*([^}]*?)\s*\}\^\{([^}]*?)\}\$/g,
                replacement: (_, base, sup) => {
                    const cleanBase = (base || '').trim();
                    const cleanSup = (sup || '').trim();
                    return cleanBase ? 
                        `<span>${escapeHtml(cleanBase)}<sup>${escapeHtml(cleanSup)}</sup></span>` : 
                        `<sup>${escapeHtml(cleanSup)}</sup>`;
                }
            },
            // Base with subscript: ${base}_{sub}$
            {
                regex: /\$\{\s*([^}]*?)\s*\}_\{([^}]*?)\}\$/g,
                replacement: (_, base, sub) => {
                    const cleanBase = (base || '').trim();
                    const cleanSub = (sub || '').trim();
                    return cleanBase ? 
                        `<span>${escapeHtml(cleanBase)}<sub>${escapeHtml(cleanSub)}</sub></span>` : 
                        `<sub>${escapeHtml(cleanSub)}</sub>`;
                }
            },
            // Empty base superscript: ${}^{sup}$
            {
                regex: /\$\{\s*\}\^\{([^}]*?)\}\$/g,
                replacement: (_, sup) => `<sup>${escapeHtml((sup || '').trim())}</sup>`
            },
            // Empty base subscript: ${}_{sub}$
            {
                regex: /\$\{\s*\}_\{([^}]*?)\}\$/g,
                replacement: (_, sub) => `<sub>${escapeHtml((sub || '').trim())}</sub>`
            },
            // Simple superscript: ${content}$
            {
                regex: /\$\{\s*([^}]*?)\s*\}\$/g,
                replacement: (_, content) => `<sup>${escapeHtml((content || '').trim())}</sup>`
            }
        ];

        patterns.forEach(({ regex, replacement }) => {
            try {
                md = md.replace(regex, replacement);
            } catch (error) {
                console.warn(`[MarkdownProcessorEnhanced] Custom syntax processing error:`, error);
            }
        });

        return md;
    }

    /**
     * Enhanced KaTeX rendering with improved error handling and formula analysis
     * @param {string} md - Preprocessed markdown text
     * @param {Function} customRenderer - Custom marked renderer
     * @returns {string} Rendered HTML
     */
    function renderWithKatexEnhanced(md, customRenderer) {
        performance.mark('renderKatex-enhanced-start');
        metrics.totalRenders++;
        
        const cacheKey = `${CACHE_VERSION}:${md}`;
        
        // Enhanced cache check
        if (renderCache.has(cacheKey)) {
            metrics.cacheHits++;
            performance.mark('renderKatex-enhanced-end');
            performance.measure('renderWithKatex-enhanced (cache)', 'renderKatex-enhanced-start', 'renderKatex-enhanced-end');
            return renderCache.get(cacheKey);
        }
        
        metrics.cacheMisses++;

        // Protected content extraction (code blocks, existing HTML)
        const protectedContent = new Map();
        let protectedCounter = 0;
        
        // Protect existing HTML and code blocks
        md = protectContent(md, protectedContent, protectedCounter);

        // Enhanced formula processing with better analysis
        md = processFormulasEnhanced(md);

        // Render remaining markdown
        let result;
        try {
            const markedOptions = customRenderer ? { renderer: customRenderer } : {};
            result = marked.parse(md, markedOptions);
        } catch (error) {
            console.error(`[MarkdownProcessorEnhanced] Marked parsing error:`, error);
            result = `<div class="markdown-error">Markdown parsing failed: ${escapeHtml(error.message)}</div>`;
        }

        // Restore protected content
        result = restoreContent(result, protectedContent);

        // Cache management with size limit
        if (renderCache.size >= MAX_CACHE_SIZE) {
            const firstKey = renderCache.keys().next().value;
            renderCache.delete(firstKey);
        }
        renderCache.set(cacheKey, result);

        // Update performance metrics
        const renderTime = performance.now();
        metrics.avgRenderTime = (metrics.avgRenderTime * (metrics.totalRenders - 1) + renderTime) / metrics.totalRenders;

        performance.mark('renderKatex-enhanced-end');
        performance.measure('renderWithKatex-enhanced', 'renderKatex-enhanced-start', 'renderKatex-enhanced-end');
        return result;
    }

    /**
     * Protect content that should not be processed (code blocks, HTML)
     * @param {string} md - Markdown text
     * @param {Map} protectedContent - Map to store protected content
     * @param {number} counter - Starting counter value
     * @returns {string} Markdown with protected content replaced by placeholders
     */
    function protectContent(md, protectedContent, counter) {
        // Protect fenced code blocks (``` ... ```)
        md = md.replace(/```[\s\S]*?```/g, (match) => {
            const placeholder = `PBTOKEN${counter++}Z`;
            protectedContent.set(placeholder, match);
            return placeholder;
        });

        // Protect inline code (`...`)
        md = md.replace(/`[^`\n]+?`/g, (match) => {
            const placeholder = `PBTOKEN${counter++}Z`;
            protectedContent.set(placeholder, match);
            return placeholder;
        });

        // Protect only real HTML constructs to avoid eating math comparators like "<="
        const htmlPatterns = [
            /<!--[\s\S]*?-->/g,                                     // HTML comments
            /<!DOCTYPE[^>]*?>/gi,                                     // DOCTYPE
            /<\/?[A-Za-z][A-Za-z0-9-]*(\s+[^<>]*?)?>/g              // opening/closing/self-closing tags
        ];
        htmlPatterns.forEach((re) => {
            md = md.replace(re, (match) => {
                const placeholder = `PBTOKEN${counter++}Z`;
                protectedContent.set(placeholder, match);
                return placeholder;
            });
        });

        return md;
    }

    /**
     * Enhanced formula processing with better error handling and context analysis
     * @param {string} md - Markdown text
     * @returns {string} Processed markdown with formulas rendered
     */
    function processFormulasEnhanced(md) {
        // Normalize math delimiters to avoid regex mismatches and nested '$' leakage
        function normalizeMathDelimiters(text) {
            if (typeof text !== 'string' || !text) return text;
            let s = text;
            // Convert encoded dollars to literal '$'
            s = s.replace(/&(?:#0*36|dollar);/gi, '$');
            // Normalize fullwidth dollar to ASCII
            s = s.replace(/\uFF04/g, '$');
            // Remove zero-width and combining marks immediately around '$' so `$̲` → `$`
            s = s.replace(/\$[\u200B-\u200D\uFEFF\u0300-\u036F]+/g, '$');
            s = s.replace(/[\u200B-\u200D\uFEFF\u0300-\u036F]+\$/g, '$');
            return s;
        }

        md = normalizeMathDelimiters(md);
        // Process block formulas first ($$...$$)
        md = md.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
            return renderFormula(content.trim(), true, match);
        });

        // Process LaTeX-style block formulas (\[...\])
        md = md.replace(/\\\[([\s\S]*?)\\\]/g, (match, content) => {
            return renderFormula(content.trim(), true, match);
        });

        // Process inline formulas ($...$)
        md = md.replace(/\$([^$\n]+?)\$/g, (match, content) => {
            return renderFormula(content.trim(), false, match);
        });

        // Process LaTeX-style inline formulas (\(...\))
        md = md.replace(/\\\(([^)]*?)\\\)/g, (match, content) => {
            return renderFormula(content.trim(), false, match);
        });

        return md;
    }

    /**
     * Analyze formula structure to determine appropriate display mode.
     * @param {string} content - Raw formula content.
     * @param {boolean} displayHint - Preferred display mode from the matcher.
     * @returns {{ text: string, displayMode: boolean, forcedByHint: boolean, forcedByStructure: boolean }}
     */
    function analyzeFormulaLayout(content, displayHint) {
        const normalized = typeof content === 'string' ? content.trim() : '';
        if (!normalized) {
            return {
                text: '',
                displayMode: !!displayHint,
                forcedByHint: !!displayHint,
                forcedByStructure: false
            };
        }

        let displayMode = !!displayHint;
        let forcedByStructure = false;

        if (!displayMode) {
            forcedByStructure = FORMULA_BLOCK_HINTS.some(pattern => pattern.test(normalized));
            if (forcedByStructure) {
                displayMode = true;
            }
        }

        return {
            text: normalized,
            displayMode,
            forcedByHint: !!displayHint,
            forcedByStructure
        };
    }

    /**
     * Build an accessible fallback block when KaTeX rendering fails.
     * @param {string} content - Formula content.
     * @param {boolean} displayMode - Final display mode.
     * @param {Error|string} error - Rendering error.
     * @returns {string} HTML fallback snippet.
     */
    function buildKatexFallback(content, displayMode, error) {
        const sanitized = escapeHtml(content || '');
        const message = error && error.message ? error.message : (typeof error === 'string' ? error : '');
        const errorInfo = message 
            ? ` data-katex-error="${escapeHtml(message)}" title="Formula rendering failed: ${escapeHtml(message)}"`
            : '';

        if (displayMode) {
            return `
<div class="katex-fallback katex-block"${errorInfo}><pre class="katex-fallback-source">${sanitized}</pre></div>
`;
        }

        return `<span class="katex-fallback katex-inline"${errorInfo}><span class="katex-fallback-source">${sanitized}</span></span>`;
    }

    /**
     * Render individual formula with enhanced error handling
     * @param {string} content - Formula content
     * @param {boolean} displayModeHint - Whether to use display mode
     * @param {string} originalMatch - Original matched text for fallback
     * @returns {string} Rendered formula or fallback
     */
    function renderFormula(content, displayModeHint, originalMatch) {
        // Decode a limited set of HTML entities that may leak into TeX inputs
        function htmlUnescape(text) {
            if (typeof text !== 'string' || text.length === 0) return '';
            let s = text;
            // Fix corrupted entities like "&̲#39;" (ampersand followed by combining marks)
            s = s.replace(/&[\u0300-\u036F]+#/g, '&#');
            // Named entities
            s = s.replace(/&amp;/g, '&')
                 .replace(/&lt;/g, '<')
                 .replace(/&gt;/g, '>')
                 .replace(/&quot;/g, '"')
                 .replace(/&apos;/g, "'")
                 .replace(/&#39;/g, "'")
                 .replace(/&nbsp;/g, ' ');
            // Numeric entities (decimal and hex)
            s = s.replace(/&#(\d+);/g, (_, dec) => {
                const code = parseInt(dec, 10);
                return Number.isFinite(code) ? String.fromCharCode(code) : _;
            });
            s = s.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => {
                const code = parseInt(hex, 16);
                return Number.isFinite(code) ? String.fromCharCode(code) : _;
            });
            return s;
        }

        // Sanitize TeX: remove stray punctuation at edges, zero-width/combining chars, normalize common unicode symbols
        function sanitizeTeX(src) {
            let s = typeof src === 'string' ? src : '';
            if (!s) return '';
            // Decode HTML entities first, e.g. &#39; → ', &amp; → &
            s = htmlUnescape(s);
            // remove zero-width, BOM and combining marks anywhere
            s = s.replace(/[\u200B-\u200D\uFEFF\u0300-\u036F]/g, '');
            // strip private-use glyphs sometimes appearing as unknown symbols (e.g. '')
            s = s.replace(/[\uE000-\uF8FF]/g, '');
            // also normalize stray combining marks immediately after '&' that break entities
            s = s.replace(/&[\u0300-\u036F]+/g, '&');
            // trim leading/trailing CJK punctuation and quotes that accidentally wrapped TeX
            s = s.replace(/^[\s\u3000。，、；：：“”\(（\)）\[\]【】《》‘’'"–—-]+/, '');
            s = s.replace(/[\s\u3000。，、；：：“”\(（\)）\[\]【】《》‘’'"–—-]+$/, '');
            // collapse excessive inner spaces
            s = s.replace(/\s{2,}/g, ' ');
            // If trailing delimiter for \right was stripped by cleanup, add default ')'
            if (/\\right\s*$/.test(s)) {
                let close = ')';
                try {
                    const re = /\\left\s*([\(\[\{])/g;
                    let m;
                    while ((m = re.exec(s)) !== null) {
                        const ch = m[1];
                        close = ch === '(' ? ')' : ch === '[' ? ']' : '}';
                    }
                } catch (_) { /* ignore */ }
                s = s.replace(/\\right\s*$/, `\\right${close}`);
            }
            // Normalize degree with unit inside \mathrm{...}: \mathrm{ ^\circ C } → ^{\circ}\mathrm{C}
            s = s.replace(/\\mathrm\{\s*(?:\\;|\s)*\^\s*\{?\s*\\?circ\s*\}?\s*([A-Za-z])\s*\}/g, '^{\\circ}\\mathrm{$1}');
            // Replace unsupported Unicode triangles with math macros
            s = s.replace(/▲/g, '\\blacktriangle').replace(/△/g, '\\triangle');
            // Normalize some common unicode math symbols to TeX
            s = s.replace(/≠/g, '\\ne');
            s = s.replace(/±/g, '\\pm');
            s = s.replace(/∞/g, '\\infty');
            return s.trim();
        }

        const cleaned = sanitizeTeX(content);
        const analysis = analyzeFormulaLayout(cleaned, displayModeHint);
        let tex = analysis.text;

        if (!tex) {
            return analysis.displayMode ? '<div class="katex-block"></div>' : '<span class="katex-inline"></span>';
        }

        // Guard against obviously incomplete or non-TeX inputs
        try {
            // Incomplete \begin{...} without matching \end{...}
            const beginMatch = tex.match(/\\begin\{([a-zA-Z*]+)\}/);
            if (beginMatch) {
                const env = beginMatch[1];
                const endRe = new RegExp('\\\\end\\{' + env.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\}');
                if (!endRe.test(tex)) {
                    // Do not attempt to render; return accessible fallback
                    return buildKatexFallback(tex, true, 'Incomplete environment: \\begin{' + env + '} ...');
                }
            }
            // Lone \end{...} without a preceding \begin{...}
            if (/^\s*\\end\{[a-zA-Z*]+\}\s*$/.test(tex)) {
                return buildKatexFallback(tex, analysis.displayMode, 'Orphaned \\end{...}');
            }
            // Strings that look like prior KaTeX error messages or HTML entities only
            if (/^&#?\w/.test(tex) && / in math mode /.test(tex)) {
                return buildKatexFallback(tex, analysis.displayMode, 'Skipped non-TeX error text');
            }
            // If the supposed TeX contains HTML tags, skip rendering (likely mis-detected)
            if (/[<>]\s*\w|<\/|class=|style=/.test(tex)) {
                return buildKatexFallback(tex, analysis.displayMode, 'HTML detected in TeX input');
            }
        } catch (_) { /* ignore guard errors */ }

        try {
            const options = {
                displayMode: analysis.displayMode,
                throwOnError: true,
                strict: 'ignore', // Allow some non-standard LaTeX
                output: 'html', // Avoid duplicate MathML branch
                macros: {
                    // Common macros for robustness
                    "\\RR": "\\mathbb{R}",
                    "\\NN": "\\mathbb{N}",
                    "\\ZZ": "\\mathbb{Z}",
                    "\\QQ": "\\mathbb{Q}",
                    "\\CC": "\\mathbb{C}"
                }
            };

            const rendered = katex.renderToString(tex, options);
            metrics.formulaSuccesses++;

            const className = analysis.displayMode ? 'katex-block' : 'katex-inline';
            const original = escapeHtml(tex);
            const wrapper = analysis.displayMode
                ? `
<div class="${className}" data-formula-display="block" data-original-text="${original}">${rendered}</div>
`
                : `<span class="${className}" data-formula-display="inline" data-original-text="${original}">${rendered}</span>`;

            return wrapper;

        } catch (error) {
            metrics.formulaErrors++;
            console.warn(`[MarkdownProcessorEnhanced] KaTeX rendering failed for: "${tex}"`, error);
            return buildKatexFallback(tex, analysis.displayMode, error);
        }
    }

    /**
     * Restore protected content
     * @param {string} html - HTML with placeholders
     * @param {Map} protectedContent - Map of protected content
     * @returns {string} HTML with content restored
     */
    function restoreContent(html, protectedContent) {
        protectedContent.forEach((content, placeholder) => {
            html = html.replace(placeholder, content);
        });
        return html;
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
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
     * Get performance metrics
     * @returns {Object} Performance and error metrics
     */
    function getMetrics() {
        return {
            ...metrics,
            cacheSize: renderCache.size,
            cacheHitRate: metrics.totalRenders > 0 ? (metrics.cacheHits / metrics.totalRenders * 100).toFixed(2) + '%' : '0%',
            formulaErrorRate: (metrics.formulaErrors + metrics.formulaSuccesses) > 0 ? 
                (metrics.formulaErrors / (metrics.formulaErrors + metrics.formulaSuccesses) * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Clear cache and reset metrics
     */
    function clearCache() {
        renderCache.clear();
        Object.keys(metrics).forEach(key => {
            if (typeof metrics[key] === 'number') {
                metrics[key] = 0;
            }
        });
    }

    /**
     * Test formula rendering capability
     * @param {string} formula - Formula to test
     * @param {boolean} displayMode - Display mode
     * @returns {Object} Test result
     */
    function testFormula(formula, displayMode = false) {
        const startTime = performance.now();
        try {
            const result = katex.renderToString(formula, { 
                displayMode: displayMode, 
                throwOnError: true 
            });
            return {
                success: true,
                result: result,
                renderTime: performance.now() - startTime,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                result: null,
                renderTime: performance.now() - startTime,
                error: error.message
            };
        }
    }

    // Enhanced public interface
    global.MarkdownProcessorEnhanced = {
        // Core functions
        safeMarkdown: safeMarkdownEnhanced,
        renderWithKatexFailback: renderWithKatexEnhanced,
        
        // Utility functions
        processCustomSyntax: processCustomSyntax,
        renderFormula: renderFormula,
        escapeHtml: escapeHtml,
        
        // Management functions
        getMetrics: getMetrics,
        clearCache: clearCache,
        testFormula: testFormula,
        
        // Version info
        version: '2.0.0',
        compatibility: 'Backward compatible with MarkdownProcessor'
    };

    // Backward compatibility
    if (!global.MarkdownProcessor) {
        global.MarkdownProcessor = {
            safeMarkdown: safeMarkdownEnhanced,
            renderWithKatexFailback: renderWithKatexEnhanced
        };
    }

})(window);
