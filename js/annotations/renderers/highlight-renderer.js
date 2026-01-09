/**
 * @file js/annotations/renderers/highlight-renderer.js
 * @description 高亮渲染器 - 负责将批注渲染到 DOM
 */

import { isInsideFormula, detectFormulaType } from '../core/selection-resolver.js';
import { mapOffsetToNode, getLengthExcludingFormulas, normalizeOffset } from '../core/coordinate-mapper.js';

/**
 * 高亮颜色映射表
 */
const COLOR_MAP = {
  'yellow': 'rgba(255, 255, 0, 0.75)',
  'pink': 'rgba(253, 170, 200, 0.75)',
  'lightblue': 'rgba(95, 211, 250, 0.75)',
  'blue': 'rgba(95, 211, 250, 0.75)',
  'lightgreen': 'rgba(178, 253, 178, 0.75)',
  'green': 'rgba(178, 253, 178, 0.75)',
  'purple': 'rgba(221, 160, 221, 0.75)',
  'orange': 'rgba(255, 165, 0, 0.75)',
  'red': 'rgba(255, 99, 71, 0.75)',
  'cyan': 'rgba(0, 204, 204, 0.75)'
};

/**
 * 获取高亮颜色
 * @param {string} color - 颜色名称或值
 * @returns {string} RGBA 颜色值
 */
export function getHighlightColor(color) {
  if (COLOR_MAP[color?.toLowerCase()]) {
    return COLOR_MAP[color.toLowerCase()];
  }

  // 十六进制颜色
  if (color?.startsWith('#')) {
    let r = 0, g = 0, b = 0;
    if (color.length === 4) {
      r = parseInt(color[1] + color[1], 16);
      g = parseInt(color[2] + color[2], 16);
      b = parseInt(color[3] + color[3], 16);
    } else if (color.length === 7) {
      r = parseInt(color.substring(1, 3), 16);
      g = parseInt(color.substring(3, 5), 16);
      b = parseInt(color.substring(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, 0.75)`;
  }

  // RGB/RGBA 格式
  if (color?.startsWith('rgb')) {
    if (color.startsWith('rgba')) {
      const match = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
      if (match) {
        const [, r, g, b, a] = match;
        const newAlpha = Math.max(parseFloat(a), 0.75);
        return `rgba(${r}, ${g}, ${b}, ${newAlpha})`;
      }
    } else {
      const match = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (match) {
        const [, r, g, b] = match;
        return `rgba(${r}, ${g}, ${b}, 0.75)`;
      }
    }
  }

  return 'rgba(255, 255, 0, 0.75)';
}

/**
 * 创建高亮元素
 * @param {Object} options - 配置选项
 * @returns {HTMLSpanElement}
 */
export function createHighlightElement(options = {}) {
  const {
    annotationId,
    color = 'yellow',
    note = '',
    className = 'annotated-sub-block',
    isCrossBlock = false,
    position = 0,
    totalCount = 1
  } = options;

  const span = document.createElement('span');
  span.className = className;
  span.dataset.annotationId = annotationId;

  const highlightColor = getHighlightColor(color);
  span.style.backgroundColor = highlightColor;

  if (isCrossBlock) {
    applyCrossBlockStyle(span, highlightColor, position, totalCount);
  } else {
    span.style.borderRadius = '6px';
    span.style.boxShadow = `0 0 5px ${highlightColor}`;
    span.style.padding = '0 3px';
  }

  if (note) {
    span.title = note;
    span.classList.add('has-note');
  }

  return span;
}

/**
 * 应用跨子块高亮样式
 * @param {HTMLElement} element - 目标元素
 * @param {string} color - 颜色值
 * @param {number} position - 位置索引
 * @param {number} totalCount - 总数
 */
function applyCrossBlockStyle(element, color, position, totalCount) {
  element.classList.add('cross-block-highlight');
  element.style.padding = '0';

  if (totalCount === 1) {
    element.style.borderRadius = '6px';
    element.style.boxShadow = `0 0 5px ${color}`;
  } else if (position === 0) {
    element.style.borderRadius = '6px 0 0 6px';
    element.style.boxShadow = `0 0 3px ${color}`;
  } else if (position === totalCount - 1) {
    element.style.borderRadius = '0 6px 6px 0';
    element.style.boxShadow = `0 0 3px ${color}`;
  } else {
    element.style.borderRadius = '0';
    element.style.boxShadow = `0 0 2px ${color}`;
  }

  // 第一个子块添加跨块标识
  if (position === 0 && totalCount > 1) {
    element.style.position = 'relative';
    const indicator = document.createElement('span');
    indicator.className = 'cross-block-indicator';
    indicator.style.cssText = `
      position: absolute;
      top: -8px;
      left: -4px;
      background: ${color.replace('0.75)', '1)')};
      color: white;
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: bold;
      pointer-events: none;
      z-index: 10;
    `;
    indicator.textContent = `跨${totalCount}`;
    element.appendChild(indicator);
  }
}

/**
 * 应用标准高亮到元素
 * @param {HTMLElement} element - 目标元素
 * @param {Object} annotation - 批注对象
 */
export function applyStandardHighlight(element, annotation) {
  const color = getHighlightColor(annotation.highlightColor || annotation.color || 'yellow');
  const note = annotation.body?.[0]?.value || annotation.note || '';

  // 清除已有样式
  clearHighlightStyles(element);

  // 检测特殊元素
  const katexDisplay = element.classList.contains('katex-display')
    ? element
    : element.querySelector('.katex-display');
  const imgElement = element.querySelector('img');
  const tableElement = element.tagName === 'TABLE'
    ? element
    : element.querySelector('table');

  if (katexDisplay && !tableElement) {
    applyFormulaHighlight(katexDisplay, color, 'block');
  } else if (imgElement && !tableElement) {
    applyImageHighlight(element, color);
  } else if (tableElement) {
    applyTableHighlight(tableElement, color);
  } else {
    element.style.backgroundColor = color;
    element.style.borderRadius = '6px';
    element.style.boxShadow = `0 0 5px ${color}`;
    element.style.padding = '0 3px';
  }

  element.classList.add('annotated-sub-block');
  element.dataset.annotationId = annotation.id;

  if (note) {
    element.title = note;
    element.classList.add('has-note');
  }
}

/**
 * 应用公式高亮
 * @param {HTMLElement} element - 公式元素
 * @param {string} color - 颜色值
 * @param {string} type - 'block' | 'inline'
 */
export function applyFormulaHighlight(element, color, type = 'block') {
  if (type === 'block') {
    element.style.border = `3px solid ${color.replace('0.75)', '1)')}`;
    element.style.borderRadius = '12px';
    element.style.padding = '12px';
    element.style.margin = '8px 0';
    element.style.boxShadow = `0 0 12px ${color.replace('0.75)', '0.4)')}, inset 0 0 0 1px ${color.replace('0.75)', '0.2)')}`;
    element.style.backgroundColor = color.replace('0.75)', '0.05)');
    element.style.display = 'block';
    element.style.width = 'fit-content';
    element.style.marginLeft = 'auto';
    element.style.marginRight = 'auto';
  } else {
    element.style.border = `2px solid ${color.replace('0.75)', '0.8)')}`;
    element.style.borderRadius = '6px';
    element.style.padding = '2px 6px';
    element.style.margin = '0 2px';
    element.style.backgroundColor = color.replace('0.75)', '0.1)');
    element.style.boxShadow = `0 0 4px ${color.replace('0.75)', '0.3)')}`;
  }

  element.style.transition = 'all 0.2s ease';
}

/**
 * 应用图片高亮
 * @param {HTMLElement} element - 图片容器元素
 * @param {string} color - 颜色值
 */
function applyImageHighlight(element, color) {
  element.style.border = `3px solid ${color.replace('0.75)', '1)')}`;
  element.style.borderRadius = '12px';
  element.style.padding = '8px';
  element.style.backgroundColor = color.replace('0.75)', '0.1)');
  element.style.display = 'inline-block';
  element.style.boxShadow = `0 0 10px ${color}`;
}

/**
 * 应用表格高亮
 * @param {HTMLElement} tableElement - 表格元素
 * @param {string} color - 颜色值
 */
function applyTableHighlight(tableElement, color) {
  tableElement.style.border = `2px solid ${color.replace('0.75)', '1)')}`;
  tableElement.style.borderRadius = '12px';
  tableElement.style.padding = '8px';
  tableElement.style.backgroundColor = color.replace('0.75)', '0.1)');
  tableElement.style.display = 'block';
  tableElement.style.width = 'fit-content';
  tableElement.style.marginLeft = 'auto';
  tableElement.style.marginRight = 'auto';
}

/**
 * 清除元素的高亮样式
 * @param {HTMLElement} element - 目标元素
 */
export function clearHighlightStyles(element) {
  element.style.backgroundColor = '';
  element.style.border = '';
  element.style.padding = '';
  element.style.borderRadius = '';
  element.style.boxShadow = '';
  element.style.display = '';
  element.style.width = '';
  element.style.marginLeft = '';
  element.style.marginRight = '';
}

/**
 * 移除元素的高亮
 * @param {HTMLElement} element - 目标元素
 */
export function removeHighlight(element) {
  if (!element) return;

  clearHighlightStyles(element);
  element.classList.remove('annotated-block', 'annotated-sub-block', 'has-note', 'has-highlight', 'cross-block-highlight');
  element.removeAttribute('title');
  element.removeAttribute('data-annotation-id');
  element.removeAttribute('data-highlight-color');

  // 移除跨块指示器
  const indicator = element.querySelector('.cross-block-indicator');
  if (indicator) indicator.remove();

  // 清理特殊子元素
  const specialElements = [
    element.querySelector('.katex-display'),
    element.querySelector('img'),
    element.querySelector('table')
  ];

  specialElements.forEach(el => {
    if (el) clearHighlightStyles(el);
  });
}

/**
 * 包裹文本范围为高亮
 * @param {Text} textNode - 文本节点
 * @param {number} from - 起始偏移
 * @param {number} to - 结束偏移
 * @param {Object} options - 高亮选项
 * @returns {HTMLSpanElement|null}
 */
export function wrapTextRange(textNode, from, to, options = {}) {
  if (!textNode || to <= from) return null;

  const full = textNode.nodeValue || '';
  const before = full.slice(0, from);
  const mid = full.slice(from, to);
  const after = full.slice(to);
  const parent = textNode.parentNode;

  if (!parent) return null;

  const textBefore = before ? document.createTextNode(before) : null;
  const textAfter = after ? document.createTextNode(after) : null;

  const span = createHighlightElement(options);
  span.textContent = mid;

  parent.replaceChild(span, textNode);
  if (textAfter) parent.insertBefore(textAfter, span.nextSibling);
  if (textBefore) parent.insertBefore(textBefore, span);

  return span;
}

/**
 * 应用部分高亮（子块内区间）
 * @param {HTMLElement} element - 子块元素
 * @param {Object} annotation - 批注对象
 * @param {number} start - 起始偏移
 * @param {number} end - 结束偏移
 * @param {Object} options - 额外选项
 * @returns {HTMLSpanElement|null}
 */
export function applyPartialHighlight(element, annotation, start, end, options = {}) {
  const lenExcludingFormula = getLengthExcludingFormulas(element);
  const s = normalizeOffset(start, lenExcludingFormula);
  const e = normalizeOffset(end, lenExcludingFormula);

  if (e <= s) return null;

  const startPos = mapOffsetToNode(element, s);
  const endPos = mapOffsetToNode(element, e);

  if (!startPos || !endPos) return null;

  const highlightOptions = {
    annotationId: annotation.id,
    color: annotation.highlightColor || annotation.color || 'yellow',
    note: annotation.body?.[0]?.value || annotation.note || '',
    ...options
  };

  const createdSpans = [];

  if (startPos.node === endPos.node) {
    const created = wrapTextRange(startPos.node, startPos.offset, endPos.offset, highlightOptions);
    if (created) createdSpans.push(created);
  } else {
    // 收集所有需要处理的文本节点
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (isInsideFormula(n)) continue;
      textNodes.push(n);
    }

    const startIndex = textNodes.indexOf(startPos.node);
    const endIndex = textNodes.indexOf(endPos.node);

    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      // 兜底
      const sLen = (startPos.node.nodeValue || '').length;
      const firstSpan = wrapTextRange(startPos.node, startPos.offset, sLen, highlightOptions);
      if (firstSpan) createdSpans.push(firstSpan);
      const lastSpan = wrapTextRange(endPos.node, 0, endPos.offset, highlightOptions);
      if (lastSpan) createdSpans.push(lastSpan);
    } else {
      // 起点节点
      const sNode = textNodes[startIndex];
      const sLen = (sNode.nodeValue || '').length;
      const firstSpan = wrapTextRange(sNode, startPos.offset, sLen, highlightOptions);
      if (firstSpan) createdSpans.push(firstSpan);

      // 中间节点
      for (let i = startIndex + 1; i < endIndex; i++) {
        const midNode = textNodes[i];
        const fullLen = (midNode.nodeValue || '').length;
        const midSpan = wrapTextRange(midNode, 0, fullLen, highlightOptions);
        if (midSpan) createdSpans.push(midSpan);
      }

      // 终点节点
      const eNode = textNodes[endIndex];
      const lastSpan = wrapTextRange(eNode, 0, endPos.offset, highlightOptions);
      if (lastSpan) createdSpans.push(lastSpan);
    }
  }

  return createdSpans[0] || null;
}

/**
 * 滚动到批注位置
 * @param {string} annotationId - 批注 ID
 * @param {boolean} smooth - 是否平滑滚动
 * @returns {boolean}
 */
export function scrollToAnnotation(annotationId, smooth = true) {
  let target = document.getElementById(`ann-${annotationId}`);

  if (!target) {
    try {
      target = document.querySelector(`[data-annotation-id="${annotationId}"]`);
    } catch {
      target = null;
    }
  }

  if (!target) {
    const all = document.querySelectorAll('[data-annotation-id]');
    for (const el of all) {
      if (el.dataset?.annotationId === String(annotationId)) {
        target = el;
        break;
      }
    }
  }

  if (!target) return false;

  // 提升到父级子块或块
  const emphasisTarget = target.closest?.('.sub-block[data-sub-block-id]') ||
    target.closest?.('[data-block-index]') ||
    target;

  try {
    emphasisTarget.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'center'
    });

    // 临时强调
    const oldOutline = emphasisTarget.style.outline;
    emphasisTarget.classList?.add('jump-to-highlight-effect');
    emphasisTarget.style.outline = '2px solid rgba(59,130,246,0.8)';

    setTimeout(() => {
      emphasisTarget.style.outline = oldOutline || '';
      emphasisTarget.classList?.remove('jump-to-highlight-effect');
    }, 1500);

    return true;
  } catch {
    return false;
  }
}

/**
 * 异步滚动到批注位置（带轮询）
 * @param {string} annotationId - 批注 ID
 * @param {Object} options - 配置选项
 * @returns {Promise<boolean>}
 */
export async function scrollToAnnotationAsync(annotationId, options = {}) {
  const {
    targetType = null,
    subBlockId = null,
    blockIndex = null,
    timeoutMs = 4000,
    pollIntervalMs = 120
  } = options;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      let target = document.getElementById(`ann-${annotationId}`);

      if (!target) {
        try {
          target = document.querySelector(`[data-annotation-id="${annotationId}"]`);
        } catch {
          target = null;
        }
      }

      if (!target) {
        const allEl = document.querySelectorAll('[data-annotation-id]');
        for (const el of allEl) {
          if (el.dataset?.annotationId === String(annotationId)) {
            target = el;
            break;
          }
        }
      }

      if (!target) {
        let scope = document;
        if (targetType) {
          const cid = `${targetType}-content-wrapper`;
          scope = document.getElementById(cid) || document;
        }
        if (subBlockId && !target) {
          target = scope.querySelector(`.sub-block[data-sub-block-id="${subBlockId}"]`);
        }
        if (!target && blockIndex !== null && blockIndex !== undefined) {
          target = scope.querySelector(`[data-block-index="${blockIndex}"]`);
        }
      }

      if (target) {
        const emphasisTarget = target.closest?.('.sub-block[data-sub-block-id]') ||
          target.closest?.('[data-block-index]') ||
          target;

        emphasisTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const oldOutline = emphasisTarget.style.outline;
        emphasisTarget.classList?.add('jump-to-highlight-effect');
        emphasisTarget.style.outline = '2px solid rgba(59,130,246,0.8)';

        setTimeout(() => {
          emphasisTarget.style.outline = oldOutline || '';
          emphasisTarget.classList?.remove('jump-to-highlight-effect');
        }, 1500);

        return true;
      }
    } catch {
      // 继续轮询
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  return false;
}

// 默认导出
export default {
  getHighlightColor,
  createHighlightElement,
  applyStandardHighlight,
  applyFormulaHighlight,
  clearHighlightStyles,
  removeHighlight,
  wrapTextRange,
  applyPartialHighlight,
  scrollToAnnotation,
  scrollToAnnotationAsync
};
