/**
 * @file js/annotations/core/selection-resolver.js
 * @description 选区解析器 - 纯逻辑模块，从 annotation_highlighter.js 提取
 */

/**
 * 检查节点是否在公式内部
 * @param {Node} node - 要检查的节点
 * @returns {boolean}
 */
export function isInsideFormula(node) {
  let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (current) {
    if (current.classList && (
      current.classList.contains('katex') ||
      current.classList.contains('katex-display') ||
      current.classList.contains('katex-inline')
    )) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * 提取元素的纯文本内容（忽略公式）
 * @param {HTMLElement} element - 目标元素
 * @returns {string} 纯文本内容
 */
export function extractTextIgnoringFormulas(element) {
  let text = '';
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    text += node.textContent;
  }
  return text;
}

/**
 * 收集元素内所有非公式文本节点
 * @param {HTMLElement} element - 目标元素
 * @returns {Array<{node: Text, startOffset: number, endOffset: number}>}
 */
export function collectTextNodes(element) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let fullText = '';
  const textNodes = [];
  let node;

  while (node = walker.nextNode()) {
    textNodes.push({
      node: node,
      startOffset: fullText.length,
      endOffset: fullText.length + node.textContent.length
    });
    fullText += node.textContent;
  }

  return textNodes;
}

/**
 * 将逻辑文本偏移映射到实际 DOM 位置
 * @param {HTMLElement} element - 容器元素
 * @param {number} logicalOffset - 逻辑偏移量
 * @returns {Object|null} { container, offset }
 */
export function mapLogicalToDOM(element, logicalOffset) {
  let currentOffset = 0;
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ALL,
    {
      acceptNode: function(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.classList && (
            node.classList.contains('katex') ||
            node.classList.contains('katex-display') ||
            node.classList.contains('katex-inline')
          )) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeLength = node.textContent.length;

      if (currentOffset + nodeLength >= logicalOffset) {
        return {
          container: node,
          offset: logicalOffset - currentOffset
        };
      }
      currentOffset += nodeLength;
    }
  }

  // 超出范围，返回最后一个文本节点的末尾
  const lastWalker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let lastNode = null;
  while (node = lastWalker.nextNode()) {
    lastNode = node;
  }

  if (lastNode) {
    return {
      container: lastNode,
      offset: lastNode.textContent.length
    };
  }

  return null;
}

/**
 * 在 DOM 中搜索文本并返回 Range
 * @param {HTMLElement} element - 搜索范围
 * @param {string} targetText - 目标文本
 * @returns {Range|null}
 */
export function findTextInDOMRange(element, targetText) {
  const textNodes = collectTextNodes(element);
  let fullText = textNodes.map(n => n.node.textContent).join('');

  const textIndex = fullText.indexOf(targetText);
  if (textIndex === -1) {
    return null;
  }

  const textEndIndex = textIndex + targetText.length;

  let startNode = null, startOffset = 0;
  let endNode = null, endOffset = 0;

  for (const nodeInfo of textNodes) {
    // 找到起始位置
    if (startNode === null && textIndex >= nodeInfo.startOffset && textIndex < nodeInfo.endOffset) {
      startNode = nodeInfo.node;
      startOffset = textIndex - nodeInfo.startOffset;
    }

    // 找到结束位置
    if (textEndIndex > nodeInfo.startOffset && textEndIndex <= nodeInfo.endOffset) {
      endNode = nodeInfo.node;
      endOffset = textEndIndex - nodeInfo.startOffset;
      break;
    }
  }

  if (startNode && endNode) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  return null;
}

/**
 * 解析选区信息
 * @param {Selection} selection - 浏览器选区对象
 * @param {HTMLElement} containerElement - 容器元素
 * @returns {Object|null} 选区信息
 */
export function resolveSelection(selection, containerElement) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();

  if (!text) {
    return null;
  }

  // 查找选区所在的子块
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;

  const startSubBlock = findParentSubBlock(startContainer);
  const endSubBlock = findParentSubBlock(endContainer);

  // 检测是否跨子块
  const isCrossBlock = startSubBlock !== endSubBlock &&
    startSubBlock && endSubBlock;

  // 收集所有受影响的子块
  const affectedSubBlocks = [];
  if (isCrossBlock) {
    const allSubBlocks = containerElement.querySelectorAll('[data-sub-block-id]');
    let inRange = false;

    for (const subBlock of allSubBlocks) {
      if (subBlock === startSubBlock) {
        inRange = true;
      }

      if (inRange) {
        affectedSubBlocks.push(subBlock.dataset.subBlockId);
      }

      if (subBlock === endSubBlock) {
        break;
      }
    }
  } else if (startSubBlock) {
    affectedSubBlocks.push(startSubBlock.dataset.subBlockId);
  }

  // 计算偏移量
  let startOffset = 0;
  let endOffset = 0;

  if (startSubBlock) {
    startOffset = calculateOffsetInSubBlock(startSubBlock, range.startContainer, range.startOffset);
  }

  if (endSubBlock) {
    endOffset = calculateOffsetInSubBlock(endSubBlock, range.endContainer, range.endOffset);
  }

  return {
    text,
    range: range.cloneRange(),
    isCrossBlock,
    affectedSubBlocks,
    startSubBlockId: startSubBlock?.dataset.subBlockId || null,
    endSubBlockId: endSubBlock?.dataset.subBlockId || null,
    startOffset,
    endOffset,
    blockIndex: findParentBlockIndex(startContainer)
  };
}

/**
 * 查找父级子块元素
 * @param {Node} node - 起始节点
 * @returns {HTMLElement|null}
 */
export function findParentSubBlock(node) {
  let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (current) {
    if (current.dataset && current.dataset.subBlockId) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * 查找父级块索引
 * @param {Node} node - 起始节点
 * @returns {string|null}
 */
export function findParentBlockIndex(node) {
  let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (current) {
    if (current.dataset && current.dataset.blockIndex !== undefined) {
      return current.dataset.blockIndex;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * 计算在子块内的字符偏移量
 * @param {HTMLElement} subBlock - 子块元素
 * @param {Node} targetNode - 目标节点
 * @param {number} nodeOffset - 节点内偏移
 * @returns {number}
 */
export function calculateOffsetInSubBlock(subBlock, targetNode, nodeOffset) {
  const walker = document.createTreeWalker(
    subBlock,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        return isInsideFormula(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let offset = 0;
  let node;

  while (node = walker.nextNode()) {
    if (node === targetNode) {
      return offset + nodeOffset;
    }
    offset += node.textContent.length;
  }

  return offset;
}

/**
 * 检测公式类型
 * @param {HTMLElement} element - 目标元素
 * @returns {Object} 公式信息
 */
export function detectFormulaType(element) {
  const info = {
    hasFormula: false,
    type: null, // 'block', 'inline', 'mixed'
    elements: []
  };

  const katexDisplay = element.querySelector('.katex-display');
  const katexInline = element.querySelector('.katex-inline, .katex:not(.katex-display)');
  const hasKatex = element.classList.contains('katex-display') || element.classList.contains('katex');

  if (katexDisplay || hasKatex) {
    info.hasFormula = true;
    info.type = 'block';
    info.elements.push(katexDisplay || element);
  } else if (katexInline) {
    info.hasFormula = true;
    info.type = 'inline';
    info.elements.push(katexInline);
  }

  // 检测混合内容
  if (katexDisplay && katexInline) {
    info.type = 'mixed';
    info.elements = [katexDisplay, katexInline];
  }

  return info;
}

// 默认导出
export default {
  isInsideFormula,
  extractTextIgnoringFormulas,
  collectTextNodes,
  mapLogicalToDOM,
  findTextInDOMRange,
  resolveSelection,
  findParentSubBlock,
  findParentBlockIndex,
  calculateOffsetInSubBlock,
  detectFormulaType
};
