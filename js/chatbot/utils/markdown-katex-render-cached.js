/**
 * Phase 4.2+: KaTeX 缓存版本的 Markdown 渲染
 *
 * 优化：将所有 katex.renderToString() 替换为 renderKatexCached()
 * 解决：打开充满公式的 chatbot 时 4.6s 主线程阻塞问题
 *
 * 预期收益：
 * - 重复公式渲染时间减少 99%
 * - 打开时间从 4.6s 降至 0.5s 以下
 */

// Phase 3 优化: Marked.js 轻量化配置
if (typeof marked !== 'undefined' && typeof marked.setOptions === 'function') {
  marked.setOptions({
    gfm: true,              // 启用 GitHub Flavored Markdown
    breaks: true,           // 支持换行符
    pedantic: false,
    sanitize: false,
    smartLists: false,      // 禁用智能列表（性能优化）
    smartypants: false,     // 禁用智能标点（性能优化）
    mangle: false,          // 禁用邮箱混淆（性能优化）
    headerIds: false        // 禁用标题ID生成（性能优化）
  });
}

/**
 * 使用缓存渲染 KaTeX 公式
 * 自动降级到 katex.renderToString 如果缓存不可用
 */
function renderKatexWithCache(tex, options) {
  if (typeof window.renderKatexCached === 'function') {
    return window.renderKatexCached(tex, options);
  }
  // 降级到直接渲染
  return katex.renderToString(tex, options);
}

window.renderWithKatexStreaming = function(md) {
  const codeBlocks = [];
  let codeBlockCounter = 0;

  const FORMULA_BLOCK_HINTS = [
    /\r|\n/,
    /\\\\/,
    /\\tag\b/,
    /\\label\b/,
    /\\eqref\b/,
    /\\display(?:style|limits)\b/,
    /\\begin\{(?:align\*?|aligned|flalign\*?|gather\*?|multline\*?|split|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/,
    /\\end\{(?:align\*?|aligned|flalign\*?|gather\*?|multline\*?|split|cases|array|pmatrix|bmatrix|vmatrix|Vmatrix|matrix|smallmatrix)\}/
  ];

  function escapeHtml(text) {
    if (typeof text !== 'string') {
      return '';
    }
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, ch => map[ch]);
  }

  function analyzeFormula(tex, displayHint) {
    const normalized = typeof tex === 'string' ? tex.trim() : '';
    if (!normalized) {
      return { text: '', displayMode: !!displayHint };
    }

    let displayMode = !!displayHint;
    if (!displayMode) {
      displayMode = FORMULA_BLOCK_HINTS.some(pattern => pattern.test(normalized));
    }

    return { text: normalized, displayMode };
  }

  function buildFallback(tex, displayMode, error) {
    const sanitized = escapeHtml(tex || '');
    const message = error && error.message ? error.message : (typeof error === 'string' ? error : '');
    const dataAttr = message ? ` data-katex-error="${escapeHtml(message)}" title="Formula rendering failed: ${escapeHtml(message)}"` : '';

    if (displayMode) {
      return `
<div class="katex-fallback katex-block"${dataAttr}><pre class="katex-fallback-source">${sanitized}</pre></div>
`;
    }

    return `<span class="katex-fallback katex-inline"${dataAttr}><span class="katex-fallback-source">${sanitized}</span></span>`;
  }

  // 保护代码块
  md = md.replace(/```([\s\S]+?)```/g, function(match) {
    const placeholder = `__CODE_BLOCK_${codeBlockCounter}__`;
    codeBlocks[codeBlockCounter] = match;
    codeBlockCounter++;
    return placeholder;
  });
  md = md.replace(/`([^`]+?)`/g, function(match) {
    const placeholder = `__CODE_BLOCK_${codeBlockCounter}__`;
    codeBlocks[codeBlockCounter] = match;
    codeBlockCounter++;
    return placeholder;
  });

  // $$ ... $$ 块级公式（带缓存）
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, function(_, tex) {
    const analysis = analyzeFormula(tex, true);
    try {
      const html = renderKatexWithCache(analysis.text, {
        displayMode: true,
        output: 'html',
        strict: 'ignore',
        throwOnError: false,
        trust: false,
        macros: {},
        maxSize: 50,
        maxExpand: 100
      });
      return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${html}</div>
`;
    } catch (e) {
      return buildFallback(analysis.text, true, e);
    }
  });

  // \[ ... \] 块级公式（带缓存）
  md = md.replace(/\\\[([\s\S]+?)\\\]/g, function(_, tex) {
    const analysis = analyzeFormula(tex, true);
    try {
      const html = renderKatexWithCache(analysis.text, {
        displayMode: true,
        output: 'html',
        strict: 'ignore',
        throwOnError: false,
        trust: false,
        macros: {},
        maxSize: 50,
        maxExpand: 100
      });
      return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${html}</div>
`;
    } catch (e) {
      return buildFallback(analysis.text, true, e);
    }
  });

  // $ ... $ 行内或块级公式（带缓存）
  md = md.replace(/\$([^\$]+?)\$/g, function(_, tex) {
    const analysis = analyzeFormula(tex, false);
    try {
      if (analysis.displayMode) {
        const html = renderKatexWithCache(analysis.text, {
          displayMode: true,
          output: 'html',
          strict: 'ignore',
          throwOnError: false,
          trust: false,
          macros: {},
          maxSize: 50,
          maxExpand: 100
        });
        return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${html}</div>
`;
      }
      const html = renderKatexWithCache(analysis.text, {
        displayMode: false,
        output: 'html',
        strict: 'ignore',
        throwOnError: false,
        trust: false,
        macros: {},
        maxSize: 50,
        maxExpand: 100
      });
      return `<span class="katex-inline" data-formula-display="inline" data-original-text="${escapeHtml(analysis.text)}">${html}</span>`;
    } catch (e) {
      return buildFallback(analysis.text, analysis.displayMode, e);
    }
  });

  // \( ... \) 行内或块级公式（带缓存）
  md = md.replace(/\\\(([^)]+?)\\\)/g, function(_, tex) {
    const analysis = analyzeFormula(tex, false);
    try {
      if (analysis.displayMode) {
        const html = renderKatexWithCache(analysis.text, {
          displayMode: true,
          output: 'html',
          strict: 'ignore',
          throwOnError: false,
          trust: false,
          macros: {},
          maxSize: 50,
          maxExpand: 100
        });
        return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${html}</div>
`;
      }
      const html = renderKatexWithCache(analysis.text, {
        displayMode: false,
        output: 'html',
        strict: 'ignore',
        throwOnError: false,
        trust: false,
        macros: {},
        maxSize: 50,
        maxExpand: 100
      });
      return `<span class="katex-inline" data-formula-display="inline" data-original-text="${escapeHtml(analysis.text)}">${html}</span>`;
    } catch (e) {
      return buildFallback(analysis.text, analysis.displayMode, e);
    }
  });

  // 还原代码块
  for (let i = 0; i < codeBlockCounter; i++) {
    md = md.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  // XSS 防���：使用 safeRenderMarkdown 替代直接 marked.parse()
  if (typeof window.safeRenderMarkdown === 'function') {
    return window.safeRenderMarkdown(md);
  }

  // 降级方案：如果 safeRenderMarkdown 不可用，仍使用 marked.parse
  console.warn('[Security] safeRenderMarkdown not available, using unsafe marked.parse()');
  return marked.parse(md);
};

/**
 * Phase 4.2 - 长公式增量渲染原型（带缓存支持）
 */
window.ChatbotMathStreaming = (function() {
  function escapeHtml(text) {
    if (typeof text !== 'string') {
      return '';
    }
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, function(ch) {
      return map[ch];
    });
  }

  function renderPlainMarkdown(text) {
    if (!text) return '';
    if (typeof window.safeRenderMarkdown === 'function') {
      return window.safeRenderMarkdown(text);
    }
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      return marked.parse(text);
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderBlockFormula(tex) {
    const normalized = typeof tex === 'string' ? tex.trim() : '';
    if (!normalized) return '';

    if (typeof katex === 'undefined' || typeof katex.renderToString !== 'function') {
      return escapeHtml(normalized);
    }

    try {
      // 使用缓存渲染
      const html = renderKatexWithCache(normalized, {
        displayMode: true,
        output: 'html',
        strict: 'ignore',
        throwOnError: false,
        trust: false,
        macros: {},
        maxSize: 50,
        maxExpand: 100
      });
      return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(normalized)}">${html}</div>
`;
    } catch (e) {
      const message = e && e.message ? e.message : '';
      const dataAttr = message
        ? ` data-katex-error="${escapeHtml(message)}" title="Formula rendering failed: ${escapeHtml(message)}"`
        : '';
      return `
<div class="katex-fallback katex-block"${dataAttr}><pre class="katex-fallback-source">${escapeHtml(normalized)}</pre></div>
`;
    }
  }

  function renderIncremental(prevState, appendedText) {
    if (!appendedText) {
      return { html: '', state: prevState || null };
    }

    const state = prevState && typeof prevState === 'object'
      ? {
          pendingFormula: prevState.pendingFormula || null
        }
      : {
          pendingFormula: null
        };

    const text = String(appendedText);
    const len = text.length;
    let i = 0;
    let htmlParts = [];
    let plainBuffer = '';

    function flushPlain() {
      if (!plainBuffer) return;
      htmlParts.push(renderPlainMarkdown(plainBuffer));
      plainBuffer = '';
    }

    while (i < len) {
      if (!state.pendingFormula) {
        if (text.startsWith('$$', i)) {
          flushPlain();
          state.pendingFormula = {
            delimiter: '$$',
            text: ''
          };
          i += 2;
          continue;
        }
        if (text.startsWith('\\[', i)) {
          flushPlain();
          state.pendingFormula = {
            delimiter: '\\[',
            text: ''
          };
          i += 2;
          continue;
        }

        plainBuffer += text[i];
        i += 1;
        continue;
      }

      const delimiter = state.pendingFormula.delimiter;
      if (delimiter === '$$' && text.startsWith('$$', i)) {
        const formulaText = state.pendingFormula.text;
        htmlParts.push(renderBlockFormula(formulaText));
        state.pendingFormula = null;
        i += 2;
        continue;
      }
      if (delimiter === '\\[' && text.startsWith('\\]', i)) {
        const formulaText = state.pendingFormula.text;
        htmlParts.push(renderBlockFormula(formulaText));
        state.pendingFormula = null;
        i += 2;
        continue;
      }

      state.pendingFormula.text += text[i];
      i += 1;
    }

    flushPlain();

    return {
      html: htmlParts.join(''),
      state: state
    };
  }

  return {
    renderIncremental: renderIncremental
  };
})();

console.log('[Phase 4.2+] KaTeX cached rendering enabled');
