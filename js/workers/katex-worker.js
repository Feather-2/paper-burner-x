/**
 * KaTeX Web Worker
 * 在后台线程渲染数学公式，避免阻塞主线程
 *
 * 使用方式：
 * const worker = new Worker('js/workers/katex-worker.js');
 * worker.postMessage({ id: 1, formula: 'E = mc^2', options: { displayMode: true } });
 * worker.onmessage = (e) => { console.log(e.data.html); };
 */

'use strict';

// 导入 KaTeX 库（通过 importScripts）
try {
  // 尝试加载 KaTeX 库
  importScripts(
    'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js'
  );
  console.log('[KaTeX Worker] KaTeX library loaded successfully');
} catch (error) {
  console.error('[KaTeX Worker] Failed to load KaTeX library:', error);
  // 通知主线程加载失败
  self.postMessage({
    type: 'error',
    error: 'Failed to load KaTeX library in Worker'
  });
}

/**
 * 修复公式中的常见 LaTeX 错误（复制自 formula_post_processor.js）
 */
function fixFormulaErrors(formula, isDisplay) {
  let fixed = formula;

  // 修复 1: 移除行内公式中的 \tag{...}
  if (!isDisplay && /\\tag\{[^}]*\}/.test(fixed)) {
    fixed = fixed.replace(/\\tag\{[^}]*\}/g, '');
  }

  // 修复 2: 修复 \;^\circ 语法错误
  if (/\\;\s*\^\\circ/.test(fixed)) {
    fixed = fixed.replace(/\\;\s*\^\\circ/g, '\\,^{\\circ}');
  }

  // 修复 2b: 修复其他 \;^ 的情况
  if (/\\;\s*\^([^{])/.test(fixed)) {
    fixed = fixed.replace(/\\;\s*\^([^{])/g, (match, char) => `\\,^{${char}}`);
  }

  // 修复 3: 修复双花括号 {{...}} → {...}
  if (/\{\{/.test(fixed)) {
    while (/\{\{/.test(fixed)) {
      fixed = fixed.replace(/\{\{([^}]*)\}\}/g, '{$1}');
    }
  }

  // 修复 4: 修复 \mathrm{\;^\circ C} 的情况
  if (/\\mathrm\{[^}]*\\;[^}]*\^\s*\\circ[^}]*\}/.test(fixed)) {
    fixed = fixed.replace(/\\mathrm\{\s*\\;\s*\^\s*\\circ\s+([^}]+)\}/g, '\\,^{\\circ}\\mathrm{$1}');
  }

  // 修复 5: 确保上标总是用花括号包围
  fixed = fixed.replace(/\^([a-zA-Z]{2,})/g, '^{$1}');

  return fixed.trim();
}

/**
 * 渲染单个公式
 */
function renderFormula(id, formula, options) {
  try {
    // 检查 KaTeX 是否可用
    if (typeof katex === 'undefined') {
      throw new Error('KaTeX is not available in Worker');
    }

    // 修复常见错误
    const fixed = fixFormulaErrors(formula, options.displayMode || false);

    // 渲染公式
    const html = katex.renderToString(fixed, {
      displayMode: options.displayMode || false,
      throwOnError: false,  // 不抛出错误，返回原始文本
      strict: 'ignore',
      output: 'html',
      ...options
    });

    return {
      type: 'success',
      id: id,
      html: html,
      originalFormula: formula
    };

  } catch (error) {
    // 渲染失败，返回错误信息
    return {
      type: 'error',
      id: id,
      error: error.message,
      originalFormula: formula,
      // 返回一个错误回退 HTML
      html: `<span class="katex-fallback" title="${error.message}">${formula}</span>`
    };
  }
}

/**
 * 批量渲染公式
 */
function renderBatch(batchId, formulas) {
  const results = [];

  for (const item of formulas) {
    const result = renderFormula(item.id, item.formula, item.options || {});
    results.push(result);
  }

  return {
    type: 'batch_complete',
    batchId: batchId,
    results: results
  };
}

/**
 * 消息处理器
 */
self.onmessage = function(e) {
  const { type, id, formula, options, batchId, formulas } = e.data;

  if (type === 'render') {
    // 渲染单个公式
    const result = renderFormula(id, formula, options || {});
    self.postMessage(result);

  } else if (type === 'batch') {
    // 批量渲染
    const result = renderBatch(batchId, formulas);
    self.postMessage(result);

  } else if (type === 'ping') {
    // 健康检查
    self.postMessage({ type: 'pong' });

  } else {
    self.postMessage({
      type: 'error',
      error: `Unknown message type: ${type}`
    });
  }
};

// Worker 初始化完成
self.postMessage({ type: 'ready' });
