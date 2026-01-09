/**
 * @file js/annotations/core/coordinate-mapper.js
 * @description 坐标映射器 - 处理逻辑坐标与 DOM 坐标转换
 */

import { isInsideFormula, collectTextNodes } from './selection-resolver.js';

/**
 * 将字符偏移映射到 DOM 节点位置
 * @param {HTMLElement} root - 根元素
 * @param {number} charOffset - 字符偏移量
 * @returns {Object|null} { node, offset }
 */
export function mapOffsetToNode(root, charOffset) {
  let remaining = charOffset;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  let node;

  while ((node = walker.nextNode())) {
    if (isInsideFormula(node)) continue;
    const l = node.nodeValue ? node.nodeValue.length : 0;
    if (remaining <= l) return { node, offset: remaining };
    remaining -= l;
  }

  return null;
}

/**
 * 计算忽略公式后的文本长度
 * @param {HTMLElement} element - 目标元素
 * @returns {number}
 */
export function getLengthExcludingFormulas(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  let len = 0, node;
  while ((node = walker.nextNode())) {
    if (!isInsideFormula(node)) len += (node.nodeValue || '').length;
  }
  return len;
}

/**
 * 规范化偏移量到有效范围
 * @param {number} offset - 原始偏移
 * @param {number} maxLength - 最大长度
 * @returns {number}
 */
export function normalizeOffset(offset, maxLength) {
  return Math.max(0, Math.min(offset, maxLength));
}

/**
 * 计算跨子块的全局偏移
 * @param {Array<string>} subBlockIds - 子块 ID 列表
 * @param {HTMLElement} containerElement - 容器元素
 * @param {string} targetSubBlockId - 目标子块 ID
 * @param {number} localOffset - 本地偏移
 * @returns {number} 全局偏移
 */
export function calculateGlobalOffset(subBlockIds, containerElement, targetSubBlockId, localOffset) {
  let globalOffset = 0;

  for (const id of subBlockIds) {
    const element = containerElement.querySelector(`[data-sub-block-id="${id}"]`);
    if (!element) continue;

    if (id === targetSubBlockId) {
      return globalOffset + localOffset;
    }

    globalOffset += getLengthExcludingFormulas(element);
  }

  return globalOffset;
}

/**
 * 从全局偏移解析到子块和本地偏移
 * @param {Array<string>} subBlockIds - 子块 ID 列表
 * @param {HTMLElement} containerElement - 容器元素
 * @param {number} globalOffset - 全局偏移
 * @returns {Object} { subBlockId, localOffset }
 */
export function resolveGlobalOffset(subBlockIds, containerElement, globalOffset) {
  let accumulated = 0;

  for (const id of subBlockIds) {
    const element = containerElement.querySelector(`[data-sub-block-id="${id}"]`);
    if (!element) continue;

    const length = getLengthExcludingFormulas(element);

    if (accumulated + length >= globalOffset) {
      return {
        subBlockId: id,
        localOffset: globalOffset - accumulated
      };
    }

    accumulated += length;
  }

  // 返回最后一个子块的末尾
  const lastId = subBlockIds[subBlockIds.length - 1];
  const lastElement = containerElement.querySelector(`[data-sub-block-id="${lastId}"]`);
  return {
    subBlockId: lastId,
    localOffset: lastElement ? getLengthExcludingFormulas(lastElement) : 0
  };
}

/**
 * 构建规范化文本和偏移映射
 * @param {string} text - 原始文本
 * @returns {Object} { norm, map }
 */
export function buildNormalizedText(text) {
  const isWs = (ch) => /[\s\u200B-\u200D\uFEFF]/.test(ch);
  const norm = [];
  const map = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!isWs(ch)) {
      norm.push(ch);
      map.push(i);
    }
  }

  return { norm: norm.join(''), map };
}

/**
 * 使用 exact 文本重新校准偏移
 * @param {string} exactText - 精确文本
 * @param {Array<string>} texts - 子块文本数组
 * @param {Array<string>} subBlockIds - 子块 ID 数组
 * @returns {Object|null} { startId, endId, startOffset, endOffset }
 */
export function recalibrateWithExact(exactText, texts, subBlockIds) {
  const combined = texts.join('');

  // 直接匹配
  let pos = combined.indexOf(exactText);

  if (pos === -1) {
    // 忽略空白匹配
    const combNorm = buildNormalizedText(combined);
    const exactNorm = buildNormalizedText(exactText);
    const posNorm = combNorm.norm.indexOf(exactNorm.norm);

    if (posNorm !== -1) {
      const origStart = combNorm.map[posNorm];
      const origEndExclusive = combNorm.map[posNorm + exactNorm.norm.length - 1] + 1;

      return calculateSubBlockBounds(texts, subBlockIds, origStart, origEndExclusive);
    }
    return null;
  }

  return calculateSubBlockBounds(texts, subBlockIds, pos, pos + exactText.length);
}

/**
 * 计算子块边界
 * @private
 */
function calculateSubBlockBounds(texts, subBlockIds, globalStart, globalEnd) {
  let acc = 0;
  let startBlockIdx = 0, localStart = 0;
  let endBlockIdx = texts.length - 1, localEnd = texts[endBlockIdx]?.length || 0;

  // 找起始位置
  for (let i = 0; i < texts.length; i++) {
    const L = texts[i].length;
    if (globalStart < acc + L) {
      startBlockIdx = i;
      localStart = globalStart - acc;
      break;
    }
    acc += L;
  }

  // 找结束位置
  acc = 0;
  for (let i = 0; i < texts.length; i++) {
    const L = texts[i].length;
    if (globalEnd <= acc + L) {
      endBlockIdx = i;
      localEnd = globalEnd - acc;
      break;
    }
    acc += L;
  }

  return {
    startId: subBlockIds[startBlockIdx],
    endId: subBlockIds[endBlockIdx],
    startOffset: localStart,
    endOffset: localEnd
  };
}

/**
 * 检查元素是否在指定范围内
 * @param {HTMLElement} targetElement - 目标元素
 * @param {HTMLElement} firstSpan - 范围起始元素
 * @param {HTMLElement} lastSpan - 范围结束元素
 * @returns {boolean}
 */
export function isElementInRange(targetElement, firstSpan, lastSpan) {
  if (!targetElement || !firstSpan || !lastSpan) return false;
  if (targetElement === firstSpan || targetElement === lastSpan) return true;
  if (firstSpan.contains(targetElement) || lastSpan.contains(targetElement)) return true;

  // firstSpan 在 targetElement 之前：firstSpan.compareDocumentPosition(targetElement) 包含 FOLLOWING
  const startToTarget = firstSpan.compareDocumentPosition(targetElement);
  const afterStart = (startToTarget & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  // targetElement 在 lastSpan 之前：lastSpan.compareDocumentPosition(targetElement) 包含 PRECEDING
  const endToTarget = lastSpan.compareDocumentPosition(targetElement);
  const beforeEnd = (endToTarget & Node.DOCUMENT_POSITION_PRECEDING) !== 0;

  return afterStart && beforeEnd;
}

// 默认导出
export default {
  mapOffsetToNode,
  getLengthExcludingFormulas,
  normalizeOffset,
  calculateGlobalOffset,
  resolveGlobalOffset,
  buildNormalizedText,
  recalibrateWithExact,
  isElementInRange
};
