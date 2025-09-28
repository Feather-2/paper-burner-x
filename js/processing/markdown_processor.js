// js/processing/markdown_processor.js
(function MarkdownProcessor(global) {
    // Shared cache for legacy fallbacks
    const renderCache = new Map();

    const LEGACY_FORMULA_BLOCK_HINTS = [
      /\r|\n/,
      /\\\\/,
      /\\tag\b/,
      /\\label\b/,
      /\\eqref\b/,
      /\\display(?:style|limits)\b/,
      /\\begin\{(?:align\*?|aligned|flalign\*?|gather\*?|multline\*?|split|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/,
      /\\end\{(?:align\*?|aligned|flalign\*?|gather\*?|multline\*?|split|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/
    ];

    /**
     * 将 Markdown 中的代码区段（包括 ``code``、```code``` 等）提取为占位符，避免后续公式解析破坏代码内容。
     * @param {string} md - Markdown 文本
     * @returns {{ text: string, placeholders: Array<{ placeholder: string, segment: string }> }}
     */
    function protectMarkdownCodeSegments(md) {
      if (!md || typeof md !== 'string') {
        return { text: md, placeholders: [] };
      }

      const placeholders = [];
      const basePlaceholder = 'PBTOKEN' + Date.now().toString(36) + Math.random().toString(36).slice(2) + 'Z';
      const suffix = 'X';
      let result = '';
      let i = 0;
      const len = md.length;

      while (i < len) {
        const char = md[i];
        if (char === '`' && (i === 0 || md[i - 1] !== '\\')) {
          const start = i;
          let j = i;
          while (j < len && md[j] === '`') {
            j++;
          }
          const fenceLen = j - start;
          const fence = '`'.repeat(fenceLen);
          let searchIndex = j;
          let closingIndex = -1;

          while (searchIndex < len) {
            const idx = md.indexOf(fence, searchIndex);
            if (idx === -1) {
              break;
            }
            const prevChar = idx > 0 ? md[idx - 1] : '';
            const nextChar = md[idx + fenceLen];
            if (prevChar === '\\') {
              searchIndex = idx + fenceLen;
              continue;
            }
            if (nextChar === '`') {
              searchIndex = idx + 1;
              continue;
            }
            closingIndex = idx;
            break;
          }

          if (closingIndex !== -1) {
            const end = closingIndex + fenceLen;
            const segment = md.slice(start, end);
            const placeholder = basePlaceholder + placeholders.length + suffix;
            placeholders.push({ placeholder: placeholder, segment: segment });
            result += placeholder;
            i = end;
            continue;
          }
        }

        result += char;
        i++;
      }

      return { text: result, placeholders: placeholders };
    }

    /**
     * 将之前提取的 Markdown 代码区段占位符恢复为原始内容。
     * @param {string} md - 包含占位符的 Markdown 文本
     * @param {Array<{ placeholder: string, segment: string }>} placeholders - 原始代码区段列表
     * @returns {string} 恢复后的 Markdown 文本
     */
    function restoreMarkdownCodeSegments(md, placeholders) {
      if (!placeholders || placeholders.length === 0 || typeof md !== 'string') {
        return md;
      }
      let restored = md;
      placeholders.forEach(function(item) {
        restored = restored.replace(item.placeholder, function() {
          return item.segment;
        });
      });
      return restored;
    }

    /**
     * Escape HTML entities for safe fallback rendering.
     * @param {string} text
     * @returns {string}
     */
    function escapeHtml(text) {
      if (typeof text !== 'string') {
        return '';
      }

      const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };

      return text.replace(/[&<>"']/g, function(match) {
        return htmlEscapes[match];
      });
    }

    function analyzeFormulaLayoutLegacy(content, displayHint) {
      const normalized = typeof content === 'string' ? content.trim() : '';
      if (!normalized) {
        return {
          text: '',
          displayMode: !!displayHint
        };
      }

      let displayMode = !!displayHint;
      if (!displayMode) {
        displayMode = LEGACY_FORMULA_BLOCK_HINTS.some(function(pattern) {
          return pattern.test(normalized);
        });
      }

      return {
        text: normalized,
        displayMode: displayMode
      };
    }

    function buildKatexFallbackMarkup(content, displayMode, error) {
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

    function renderFormulaLegacy(content, displayHint) {
      function sanitizeTeX(src) {
        let s = typeof src === 'string' ? src : '';
        if (!s) return '';
        s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
        s = s.replace(/^[\u0300-\u036F]+|[\u0300-\u036F]+$/g, '');
        s = s.replace(/^[\s\u3000。，、；：：“”\(（\)）\[\]【】《》‘’'"–—-]+/, '');
        s = s.replace(/[\s\u3000。，、；：：“”\(（\)）\[\]【】《》‘’'"–—-]+$/, '');
        s = s.replace(/\s{2,}/g, ' ');
        // 如果末尾出现裸的 \\right ，补齐与最近的 \\left 匹配的右定界符
        if (/\\right\s*$/.test(s)) {
          let close = ')';
          try {
            const re = /\\left\s*([\(\[\{])/g;
            let m;
            while ((m = re.exec(s)) !== null) {
              const ch = m[1];
              close = ch === '(' ? ')' : ch === '[' ? ']' : '}';
            }
          } catch(_) { /* ignore */ }
          s = s.replace(/\\right\s*$/, `\\right${close}`);
        }
        // Normalize degree unit: \mathrm{ ^\circ C } → ^{\circ}\mathrm{C}
        s = s.replace(/\\mathrm\{\s*(?:\\;|\s)*\^\s*\{?\s*\\?circ\s*\}?\s*([A-Za-z])\s*\}/g, '^{\\circ}\\mathrm{$1}');
        // Replace Unicode triangles
        s = s.replace(/▲/g, '\\blacktriangle').replace(/△/g, '\\triangle');
        return s.trim();
      }

      const cleaned = sanitizeTeX(content);
      const analysis = analyzeFormulaLayoutLegacy(cleaned, displayHint);

      if (!analysis.text) {
        return analysis.displayMode ? '<div class="katex-block"></div>' : '<span class="katex-inline"></span>';
      }

      try {
        const rendered = katex.renderToString(analysis.text, {
          displayMode: analysis.displayMode,
          throwOnError: true,
          strict: 'ignore',
          output: 'html'
        });

        const original = escapeHtml(analysis.text);
        if (analysis.displayMode) {
          return `
<div class="katex-block" data-formula-display="block" data-original-text="${original}">${rendered}</div>
`;
        }

        return `<span class="katex-inline" data-formula-display="inline" data-original-text="${original}">${rendered}</span>`;

      } catch (error) {
        console.warn('[MarkdownProcessor] KaTeX rendering failed (legacy):', error);
        return buildKatexFallbackMarkup(analysis.text, analysis.displayMode, error);
      }
    }

    /**
     * Legacy safeMarkdown 实现，在未加载增强版处理器时使用。
     * @param {string} md
     * @param {Array<Object>} images
     * @returns {string}
     */
    function legacySafeMarkdown(md, images) {
      performance.mark('safeMarkdown-start');
      if (!md) {
        performance.mark('safeMarkdown-end');
        performance.measure('safeMarkdown', 'safeMarkdown-start', 'safeMarkdown-end');
        return '';
      }
      // 构建图片名与base64的映射表，支持多种key（兼容 OCR 使用的 images/<id>.png 与旧格式 img-#.jpeg.png）
      let imgMap = {};
      if (Array.isArray(images)) {
        images.forEach((img, idx) => {
          let keys = [];
          if (img.name) keys.push(img.name);
          if (img.id) keys.push(img.id);
          // 旧的顺序文件名
          keys.push(`img-${idx}.jpeg.png`);
          keys.push(`img-${idx+1}.jpeg.png`);

          // 为每个 key 添加常见扩展与前缀组合
          const expanded = new Set();
          keys.forEach(k => {
            expanded.add(k);
            expanded.add(k + '.png');
            expanded.add('images/' + k);
            expanded.add('images/' + k + '.png');
          });

          let src = img.data.startsWith('data:') ? img.data : 'data:image/png;base64,' + img.data;
          expanded.forEach(k => imgMap[k] = src);
        });
      }
      // 替换Markdown中的本地图片引用为base64（泛化匹配）
      md = md.replace(/!\[[^\]]*\]\(([^)]+)\)/g, function(match, path) {
        // 仅处理相对路径（避免 http/https/data 等外链）
        const p = String(path).trim();
        if (/^(https?:|data:|\/\/)/i.test(p)) return match;

        // 去除查询与锚点
        const clean = p.split('?')[0].split('#')[0];
        // 尝试直接映射
        if (imgMap[clean]) return `![](${imgMap[clean]})`;

        // 再尝试去掉前导 './'
        const noDot = clean.replace(/^\.\//, '');
        if (imgMap[noDot]) return `![](${imgMap[noDot]})`;

        // 保留原样（可能是外部相对路径，或稍后由打包器处理）
        return match;
      });
      // 处理上标、下标等自定义语法
      md = md.replace(/\$\{\s*([^}]*)\s*\}\^\{([^}]*)\}\$/g, function(_, base, sup) {
        base = base.trim();
        sup = sup.trim();
        if (base) {
          return `<span>${base}<sup>${sup}</sup></span>`;
        } else {
          return `<sup>${sup}</sup>`;
        }
      });
      md = md.replace(/\$\{\s*([^}]*)\s*\}_\{([^}]*)\}\$/g, function(_, base, sub) {
        base = base.trim();
        sub = sub.trim();
        if (base) {
          return `<span>${base}<sub>${sub}</sub></span>`;
        } else {
          return `<sub>${sub}</sub>`;
        }
      });
      md = md.replace(/\$\{\s*\}\^\{([^}]*)\}\$/g, function(_, sup) {
        return `<sup>${sup.trim()}</sup>`;
      });
      md = md.replace(/\$\{\s*\}_\{([^}]*)\}\$/g, function(_, sub) {
        return `<sub>${sub.trim()}</sub>`;
      });
      md = md.replace(/\$\{\s*([^}]*)\s*\}\$/g, function(_, sup) {
        return `<sup>${sup.trim()}</sup>`;
      });
      const __safeMdResult = md;
      performance.mark('safeMarkdown-end');
      performance.measure('safeMarkdown', 'safeMarkdown-start', 'safeMarkdown-end');
      return __safeMdResult;
    }

    /**
     * Legacy KaTeX 渲染函数，在未加载增强版处理器时使用。
     * @param {string} md
     * @param {Function} customRenderer
     * @returns {string}
     */
    function legacyRenderWithKatexFailback(md, customRenderer) {
      performance.mark('renderKatex-start');
      const rawMd = md;
      if (renderCache.has(rawMd)) {
        performance.mark('renderKatex-end');
        performance.measure('renderWithKatex (cache)', 'renderKatex-start', 'renderKatex-end');
        return renderCache.get(rawMd);
      }

      const protectedSegments = protectMarkdownCodeSegments(md);
      md = protectedSegments.text;

      md = md.replace(/\$\$([\s\S]*?)\$\$/g, function(_, content) {
        return renderFormulaLegacy(content, true);
      });

      md = md.replace(/\\\[([\s\S]*?)\\\]/g, function(_, content) {
        return renderFormulaLegacy(content, true);
      });

      md = md.replace(/\$([^$\n]+?)\$/g, function(_, content) {
        return renderFormulaLegacy(content, false);
      });

      md = md.replace(/\\\(([^)]*?)\\\)/g, function(_, content) {
        return renderFormulaLegacy(content, false);
      });

      md = restoreMarkdownCodeSegments(md, protectedSegments.placeholders);
      const markedOptions = customRenderer ? { renderer: customRenderer } : {};
      const __rpResult = marked.parse(md, markedOptions);
      renderCache.set(rawMd, __rpResult);
      performance.mark('renderKatex-end');
      performance.measure('renderWithKatex', 'renderKatex-start', 'renderKatex-end');
      return __rpResult;
    }

    const legacyImpl = {
      safeMarkdown: legacySafeMarkdown,
      renderWithKatexFailback: legacyRenderWithKatexFailback
    };

    function getActiveProcessor() {
      const enhanced = global.MarkdownProcessorEnhanced;
      if (enhanced && typeof enhanced.safeMarkdown === 'function' && typeof enhanced.renderWithKatexFailback === 'function') {
        return enhanced;
      }
      return legacyImpl;
    }

    function safeMarkdown(md, images) {
      const impl = getActiveProcessor();
      if (impl === legacyImpl) {
        return legacySafeMarkdown(md, images);
      }
      return impl.safeMarkdown(md, images);
    }

    function renderWithKatexFailback(md, customRenderer) {
      const impl = getActiveProcessor();
      if (impl === legacyImpl) {
        return legacyRenderWithKatexFailback(md, customRenderer);
      }
      return impl.renderWithKatexFailback(md, customRenderer);
    }

    global.MarkdownProcessor = {
        safeMarkdown: safeMarkdown,
        renderWithKatexFailback: renderWithKatexFailback,
        legacy: {
          safeMarkdown: legacySafeMarkdown,
          renderWithKatexFailback: legacyRenderWithKatexFailback,
          protectMarkdownCodeSegments: protectMarkdownCodeSegments,
          restoreMarkdownCodeSegments: restoreMarkdownCodeSegments,
          renderCache: renderCache
        }
    };

})(window);
