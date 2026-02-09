/**
 * 智能网页内容提取器
 *
 * 参考 WEB_TRANSLATION_ANALYSIS.md 思路：
 * 1. 主内容区域识别
 * 2. 结构化提取（转 Markdown）
 * 3. 噪音过滤
 * 4. 文本过滤
 */

import {
  cleanText,
  shouldSkipText,
  removeNoiseElements,
  findMainContent,
  extractMetadata,
  extractHeadings,
  extractLinks,
  extractImages,
} from './smart-content-helpers.js';

/**
 * HTML 纯文本提取（单次线性扫描）
 * - Node 环境无 DOMParser 时可用
 * - 避免多轮大正则 replace 带来的内存/CPU 压力
 */
function extractPlainTextFromHtml(html, { maxLength = 50000 } = {}) {
  if (!html || typeof html !== 'string') return '';

  const ENTITY_MAP = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#x27;': "'",
  };

  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas']);
  const isWs = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f';
  const isNameChar = (c) => {
    const code = c.charCodeAt(0);
    return (
      (code >= 48 && code <= 57) || // 0-9
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      c === '-' ||
      c === '_' ||
      c === ':'
    );
  };

  const findTagEnd = (s, start) => {
    let quote = null;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '>') return i;
    }
    return -1;
  };

  const readTagName = (s, start) => {
    let i = start;
    while (i < s.length && isWs(s[i])) i++;
    const nameStart = i;
    while (i < s.length && isNameChar(s[i])) i++;
    if (i === nameStart) return '';
    return s.slice(nameStart, i).toLowerCase();
  };

  const skipUntilCloseTag = (s, start, tagName) => {
    let i = start;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt === -1) return s.length;
      if (s.startsWith('<!--', lt)) {
        const end = s.indexOf('-->', lt + 4);
        i = end === -1 ? s.length : end + 3;
        continue;
      }
      if (s[lt + 1] !== '/') {
        i = lt + 1;
        continue;
      }
      const closeName = readTagName(s, lt + 2);
      const end = findTagEnd(s, lt + 2);
      if (end === -1) return s.length;
      if (closeName === tagName) return end + 1;
      i = end + 1;
    }
    return s.length;
  };

  const decodeEntityAt = (s, i) => {
    if (s[i] !== '&') return null;
    const maxLen = 16;
    let j = i + 1;
    while (j < s.length && j - i <= maxLen) {
      const ch = s[j];
      if (ch === ';') {
        j++;
        break;
      }
      if (isWs(ch) || ch === '<' || ch === '>' || ch === '&') break;
      j++;
    }
    if (j <= i + 1 || s[j - 1] !== ';') return null;
    const entity = s.slice(i, j);
    const lower = entity.toLowerCase();
    if (ENTITY_MAP[lower]) return { text: ENTITY_MAP[lower], nextIndex: j };

    const dec = lower.match(/^&#(\d+);$/);
    if (dec) return { text: String.fromCharCode(parseInt(dec[1], 10)), nextIndex: j };
    const hex = lower.match(/^&#x([0-9a-f]+);$/);
    if (hex) return { text: String.fromCharCode(parseInt(hex[1], 16)), nextIndex: j };

    return { text: entity, nextIndex: j };
  };

  const out = [];
  let i = 0;
  while (i < html.length) {
    const ch = html[i];

    if (ch === '<') {
      // HTML comment
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        i = end === -1 ? html.length : end + 3;
        out.push(' ');
        continue;
      }

      // doctype / directives
      if (html[i + 1] === '!') {
        const end = html.indexOf('>', i + 2);
        i = end === -1 ? html.length : end + 1;
        out.push(' ');
        continue;
      }

      const isClose = html[i + 1] === '/';
      const nameStart = isClose ? i + 2 : i + 1;
      const tagName = readTagName(html, nameStart);
      const end = findTagEnd(html, nameStart);
      if (end === -1) break;

      if (!isClose && SKIP_TAGS.has(tagName)) {
        i = skipUntilCloseTag(html, end + 1, tagName);
        out.push(' ');
        continue;
      }

      i = end + 1;
      out.push(' ');
      continue;
    }

    if (ch === '&') {
      const decoded = decodeEntityAt(html, i);
      if (decoded) {
        out.push(decoded.text);
        i = decoded.nextIndex;
        continue;
      }
    }

    out.push(isWs(ch) ? ' ' : ch);
    i++;
  }

  const text = out.join('').replace(/\s+/g, ' ').trim();
  return maxLength > 0 && text.length > maxLength ? text.slice(0, maxLength) : text;
}

/**
 * 从 DOM 元素提取结构化 Markdown（迭代版本，避免深度递归）
 * @param {Element} root
 * @param {Object} [options]
 * @param {number} [options.maxDepth=50] - 最大遍历深度
 * @param {number} [options.maxNodes=5000] - 最大节点数
 */
function elementToMarkdown(root, options = {}) {
  if (!root) return '';

  const maxDepth = options.maxDepth ?? 50;
  const maxNodes = options.maxNodes ?? 5000;
  const output = [];
  let nodeCount = 0;

  // 使用栈进行深度优先遍历
  // { node, depth, visited: boolean, tag, children: array }
  /**
   * @typedef {object} MarkdownTraverseFrame
   * @property {Element} node
   * @property {number} depth
   * @property {boolean} visited
   * @property {MarkdownTraverseFrame[]=} children
   * @property {string=} textContent
   */

  /** @type {MarkdownTraverseFrame[]} */
  const stack = [{ node: root, depth: 0, visited: false }];

  while (stack.length > 0 && nodeCount < maxNodes) {
    const frame = stack[stack.length - 1];
    const { node, depth, visited } = frame;

    if (depth > maxDepth) {
      stack.pop();
      continue;
    }

    const tag = node.tagName?.toUpperCase();

    // 首次访问：处理开始标签
    if (!visited) {
      frame.visited = true;
      nodeCount++;

      // 终端节点：直接处理并弹出
      const terminalResult = processTerminalTag(node, tag);
      if (terminalResult !== null) {
        output.push(terminalResult);
        stack.pop();
        continue;
      }

      // 非终端节点：将子节点入栈（倒序入栈保证正序处理）
      const children = [];
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const child = node.childNodes[i];
        if (child.nodeType === 1) { // Element
          children.unshift({ node: /** @type {Element} */ (child), depth: depth + 1, visited: false });
        } else if (child.nodeType === 3) { // Text
          const text = cleanText(child.textContent);
          if (text && !shouldSkipText(text)) {
            children.unshift({ node: /** @type {Element} */ (child), depth: depth + 1, visited: true, textContent: text });
          }
        }
      }
      frame.children = children;

      // 开始标签处理
      if (tag === 'P') output.push('\n');
      else if (tag === 'BLOCKQUOTE') output.push('\n> ');
      else if (tag === 'UL' || tag === 'OL') output.push('\n');

      // 将子节点入栈
      for (const child of children) {
        stack.push(child);
      }
      continue;
    }

    // 已访问过：处理结束标签和子节点已处理完毕的情况
    stack.pop();

    // 文本节点
    if (frame.textContent !== undefined) {
      output.push(frame.textContent);
      continue;
    }

    // 结束标签处理
    if (tag === 'P' || tag === 'BLOCKQUOTE') output.push('\n');
    else if (tag === 'UL' || tag === 'OL') output.push('\n');
  }

  return output.join('');
}

/**
 * 处理终端标签（不需要递归子节点）
 */
function processTerminalTag(el, tag) {
  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = parseInt(tag[1], 10);
      const text = cleanText(el.textContent);
      if (text && !shouldSkipText(text)) {
        return '\n' + '#'.repeat(level) + ' ' + text + '\n';
      }
      return '';
    }

    case 'PRE': {
      const code = el.querySelector('code');
      const text = (code || el).textContent || '';
      if (text.trim()) {
        const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
        return '\n```' + lang + '\n' + text.trim() + '\n```\n';
      }
      return '';
    }

    case 'CODE': {
      if (el.parentElement?.tagName !== 'PRE') {
        const text = el.textContent?.trim();
        if (text) return '`' + text + '`';
      }
      return '';
    }

    case 'TABLE': {
      const rows = el.querySelectorAll('tr');
      const tableRows = [];
      for (const row of rows) {
        const cells = row.querySelectorAll('th, td');
        const rowText = Array.from(cells)
          .map(c => cleanText(c.textContent))
          .join(' | ');
        if (rowText.trim()) {
          tableRows.push('| ' + rowText + ' |');
        }
      }
      if (tableRows.length) {
        if (tableRows.length > 1) {
          const headerCols = tableRows[0].split('|').length - 2;
          const separator = '|' + ' --- |'.repeat(headerCols);
          tableRows.splice(1, 0, separator);
        }
        return '\n' + tableRows.join('\n') + '\n';
      }
      return '';
    }

    case 'IMG': {
      const alt = el.getAttribute('alt') || '';
      const src = el.getAttribute('src') || '';
      if (src) return `![${cleanText(alt)}](${src})`;
      return '';
    }

    case 'HR':
      return '\n---\n';

    case 'BR':
      return '\n';

    case 'LI': {
      const text = inlineToMarkdown(el);
      if (text && !shouldSkipText(text)) {
        const parent = el.parentElement;
        const isOrdered = parent?.tagName === 'OL';
        if (isOrdered) {
          const idx = Array.from(parent.children).indexOf(el) + 1;
          return `${idx}. ${text}\n`;
        }
        return `- ${text}\n`;
      }
      return '';
    }

    default:
      return null; // 非终端节点
  }
}

/**
 * 处理内联元素（保留格式）
 */
function inlineToMarkdown(el) {
  if (!el) return '';

  const parts = [];

  for (const child of el.childNodes) {
    if (child.nodeType === 3) { // Text node
      parts.push(cleanText(child.textContent));
    } else if (child.nodeType === 1) { // Element node
      const tag = child.tagName?.toUpperCase();
      const text = inlineToMarkdown(child);

      switch (tag) {
        case 'STRONG':
        case 'B':
          if (text) parts.push('**' + text + '**');
          break;
        case 'EM':
        case 'I':
          if (text) parts.push('*' + text + '*');
          break;
        case 'CODE':
          if (text) parts.push('`' + text + '`');
          break;
        case 'A': {
          const href = child.getAttribute('href');
          if (text && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            parts.push('[' + text + '](' + href + ')');
          } else if (text) {
            parts.push(text);
          }
          break;
        }
        case 'BR':
          parts.push('\n');
          break;
        case 'IMG': {
          const alt = child.getAttribute('alt') || '';
          const src = child.getAttribute('src') || '';
          if (src) parts.push(`![${cleanText(alt)}](${src})`);
          break;
        }
        default:
          if (text) parts.push(text);
      }
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 主函数：智能提取网页内容
 *
 * @param {string} html - 原始 HTML
 * @param {Object} options - 选项
 * @returns {{ markdown: string, plainText: string, metadata: Object, structure: Object }}
 */
export function extractSmartContent(html, options = {}) {
  const {
    preserveLinks = true,
    maxLength = 50000,
    fallbackOnError = true,
  } = options;

  // 边界检查
  if (!html || typeof html !== 'string') {
    return {
      markdown: '',
      plainText: '',
      metadata: { title: '', description: '', author: '', publishDate: '', wordCount: 0, headings: [], links: [], images: [] },
      structure: { mainContentSelector: null, removedElements: 0, extractedSections: 0 },
    };
  }

  const canUseDomParser = typeof DOMParser !== 'undefined' && typeof DOMParser === 'function';
  if (!canUseDomParser) {
    const plainText = extractPlainTextFromHtml(html, { maxLength });
    return {
      markdown: plainText,
      plainText,
      metadata: { title: '', description: '', author: '', publishDate: '', wordCount: plainText.length, headings: [], links: [], images: [] },
      structure: { mainContentSelector: 'fallback(no-dom)', removedElements: 0, extractedSections: 0 },
    };
  }

  try {
    // 解析 HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 提取元数据（在移除噪音前）
    const metadata = extractMetadata(doc);

    // 第一遍：全局移除噪音
    let removedElements = removeNoiseElements(doc);

    // 查找主内容
    const { element: mainContent, selector: mainContentSelector } = findMainContent(doc);

    // 第二遍：主内容内部再次清理（克隆以避免影响原 DOM）
    const contentClone = mainContent.cloneNode(true);
    removedElements += removeNoiseElements(contentClone);

    // 提取结构化信息
    metadata.headings = extractHeadings(contentClone);
    metadata.links = preserveLinks ? extractLinks(contentClone) : [];
    metadata.images = extractImages(contentClone);

    // 转换为 Markdown
    let markdown = elementToMarkdown(contentClone);

    // 清理 Markdown
    markdown = markdown
      .replace(/\n{3,}/g, '\n\n')  // 合并多余空行
      .replace(/^\s+|\s+$/g, '');   // 去除首尾空白

    // 限制长度
    if (markdown.length > maxLength) {
      markdown = markdown.slice(0, maxLength) + '\n\n...(内容已截断)';
    }

    // 生成纯文本版本
    const plainText = markdown
      .replace(/```[\s\S]*?```/g, '')  // 移除代码块
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 移除链接格式
      .replace(/[*_`#>|-]/g, '')  // 移除 Markdown 符号
      .replace(/\s+/g, ' ')
      .trim();

    metadata.wordCount = plainText.length;

    // 统计提取的章节数
    const extractedSections = (markdown.match(/^#+\s/gm) || []).length;

    return {
      markdown,
      plainText,
      metadata,
      structure: {
        mainContentSelector,
        removedElements,
        extractedSections,
      },
    };

  } catch (err) {
    // ignore

    if (fallbackOnError) {
      // Fallback: 简单文本提取
      const plainText = extractPlainTextFromHtml(html, { maxLength });

      return {
        markdown: plainText,
        plainText,
        metadata: { title: '', description: '', author: '', publishDate: '', wordCount: plainText.length, headings: [], links: [], images: [] },
        structure: { mainContentSelector: 'fallback', removedElements: 0, extractedSections: 0 },
      };
    }

    throw err;
  }
}

/**
 * 简单包装：只返回 Markdown
 * @param {string} html - 输入的 HTML 字符串
 * @param {object} [options={}] - 提取选项，同 extractSmartContent
 * @returns {string} 提取的 Markdown 文本
 */
export function htmlToMarkdown(html, options = {}) {
  const { markdown } = extractSmartContent(html, options);
  return markdown;
}

/**
 * 简单包装：只返回纯文本
 * @param {string} html - 输入的 HTML 字符串
 * @param {object} [options={}] - 提取选项，同 extractSmartContent
 * @returns {string} 提取的纯文本
 */
export function htmlToPlainText(html, options = {}) {
  const { plainText } = extractSmartContent(html, options);
  return plainText;
}

export default extractSmartContent;
