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
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, function(_, tex) {
    const analysis = analyzeFormula(tex, true);
    try {
      return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, {
  displayMode: true,
  output: 'html',
  strict: 'ignore',
  throwOnError: false,
  trust: false,          // Phase 3: 禁用不安全命令
  macros: {},            // Phase 3: 使用空对象避免默认宏初始化
  maxSize: 50,           // Phase 3: 限制公式大小
  maxExpand: 100         // Phase 3: 限制宏展开
})}</div>
`;
    } catch (e) {
      return buildFallback(analysis.text, true, e);
    }
  });
  md = md.replace(/\\\[([\s\S]+?)\\\]/g, function(_, tex) {
    const analysis = analyzeFormula(tex, true);
    try {
      return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, {
  displayMode: true,
  output: 'html',
  strict: 'ignore',
  throwOnError: false,
  trust: false,          // Phase 3: 禁用不安全命令
  macros: {},            // Phase 3: 使用空对象避免默认宏初始化
  maxSize: 50,           // Phase 3: 限制公式大小
  maxExpand: 100         // Phase 3: 限制宏展开
})}</div>
`;
    } catch (e) {
      return buildFallback(analysis.text, true, e);
    }
  });
  md = md.replace(/\$([^\$]+?)\$/g, function(_, tex) {
    const analysis = analyzeFormula(tex, false);
    try {
      if (analysis.displayMode) {
        return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, {
  displayMode: true,
  output: 'html',
  strict: 'ignore',
  throwOnError: false,
  trust: false,          // Phase 3: 禁用不安全命令
  macros: {},            // Phase 3: 使用空对象避免默认宏初始化
  maxSize: 50,           // Phase 3: 限制公式大小
  maxExpand: 100         // Phase 3: 限制宏展开
})}</div>
`;
      }
      return `<span class="katex-inline" data-formula-display="inline" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, {
  displayMode: false,
  output: 'html',
  strict: 'ignore',
  throwOnError: false,
  trust: false,          // Phase 3: 禁用不安全命令
  macros: {},            // Phase 3: 使用空对象避免默认宏初始化
  maxSize: 50,           // Phase 3: 限制公式大小
  maxExpand: 100         // Phase 3: 限制宏展开
})}</span>`;
    } catch (e) {
      return buildFallback(analysis.text, analysis.displayMode, e);
    }
  });
  md = md.replace(/\\\(([^)]+?)\\\)/g, function(_, tex) {
    const analysis = analyzeFormula(tex, false);
    try {
      if (analysis.displayMode) {
        return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, {
  displayMode: true,
  output: 'html',
  strict: 'ignore',
  throwOnError: false,
  trust: false,          // Phase 3: 禁用不安全命令
  macros: {},            // Phase 3: 使用空对象避免默认宏初始化
  maxSize: 50,           // Phase 3: 限制公式大小
  maxExpand: 100         // Phase 3: 限制宏展开
})}</div>
`;
      }
      return `<span class="katex-inline" data-formula-display="inline" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, {
  displayMode: false,
  output: 'html',
  strict: 'ignore',
  throwOnError: false,
  trust: false,          // Phase 3: 禁用不安全命令
  macros: {},            // Phase 3: 使用空对象避免默认宏初始化
  maxSize: 50,           // Phase 3: 限制公式大小
  maxExpand: 100         // Phase 3: 限制宏展开
})}</span>`;
    } catch (e) {
      return buildFallback(analysis.text, analysis.displayMode, e);
    }
  });
  for (let i = 0; i < codeBlockCounter; i++) {
    md = md.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  // XSS 防护：使用 safeRenderMarkdown 替代直接 marked.parse()
  if (typeof window.safeRenderMarkdown === 'function') {
    return window.safeRenderMarkdown(md);
  }

  // 降级方案：如果 safeRenderMarkdown 不可用，仍使用 marked.parse
  // 但会在控制台警告
  console.warn('[Security] safeRenderMarkdown not available, using unsafe marked.parse()');
  return marked.parse(md);
};

/**
 * Phase 4.2 - 长公式增量渲染原型（ChatbotMathStreaming）
 * 目标：在流式生成长公式（特别是 $$...$$ / \[...\] 块级公式）时，避免反复对整条消息做 KaTeX 渲染。
 *
 * 设计要点：
 * - 仅处理块级公式标记：'$$ ... $$' 与 '\[ ... \]'；
 * - 利用 state 在多次调用之间记录「是否在公式内部」以及已累积的公式文本；
 * - 每次只对“新补全的一整块公式”调用 katex.renderToString，一块公式只渲染一次；
 * - 普通文本片段使用 safeRenderMarkdown（若存在）单独转为 HTML；
 * - 如果出现异常或环境不满足（如 window.katex 不存在），调用方应回退到完整重渲染。
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
      // 环境不足，交给上层回退处理
      return escapeHtml(normalized);
    }

    try {
      const html = katex.renderToString(normalized, {
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

  /**
   * 增量渲染入口
   * @param {object|null} prevState  上一次调用时的状态（可为 null）
   * @param {string} appendedText    本次新增的原始 Markdown 文本
   * @returns {{ html: string, state: object }} 渲染出的追加 HTML 片段与新的状态
   */
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
      // 不在公式内部：识别公式起始标记
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

      // 在公式内部：识别结束标记
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

      // 继续累积公式内容
      state.pendingFormula.text += text[i];
      i += 1;
    }

    // 本轮结束时，仍可安全输出的普通文本
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
