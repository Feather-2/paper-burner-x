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
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, { displayMode: true, output: 'html' })}</div>
`;
    } catch (e) {
      return buildFallback(analysis.text, true, e);
    }
  });
  md = md.replace(/\\\[([\s\S]+?)\\\]/g, function(_, tex) {
    const analysis = analyzeFormula(tex, true);
    try {
      return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, { displayMode: true, output: 'html' })}</div>
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
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, { displayMode: true, output: 'html' })}</div>
`;
      }
      return `<span class="katex-inline" data-formula-display="inline" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, { displayMode: false, output: 'html' })}</span>`;
    } catch (e) {
      return buildFallback(analysis.text, analysis.displayMode, e);
    }
  });
  md = md.replace(/\\\(([^)]+?)\\\)/g, function(_, tex) {
    const analysis = analyzeFormula(tex, false);
    try {
      if (analysis.displayMode) {
        return `
<div class="katex-block" data-formula-display="block" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, { displayMode: true, output: 'html' })}</div>
`;
      }
      return `<span class="katex-inline" data-formula-display="inline" data-original-text="${escapeHtml(analysis.text)}">${katex.renderToString(analysis.text, { displayMode: false, output: 'html' })}</span>`;
    } catch (e) {
      return buildFallback(analysis.text, analysis.displayMode, e);
    }
  });
  for (let i = 0; i < codeBlockCounter; i++) {
    md = md.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }
  return marked.parse(md);
};
