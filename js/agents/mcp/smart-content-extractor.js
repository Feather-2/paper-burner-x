/**
 * 智能网页内容提取器
 *
 * 参考 WEB_TRANSLATION_ANALYSIS.md 思路：
 * 1. 主内容区域识别
 * 2. 结构化提取（转 Markdown）
 * 3. 噪音过滤
 * 4. 文本过滤
 */

// 主内容选择器（按优先级）
const MAIN_CONTENT_SELECTORS = [
  // 语义化标签
  'article',
  'main',
  '[role="main"]',
  // 博客/文章类
  '.post-content',
  '.article-content',
  '.entry-content',
  '.blog-content',
  '.blog-post',
  '.single-post',
  '.post-body',
  '.article-body',
  '.content-area',
  '.page-content',
  '.main-content',
  // 通用类名
  '.content',
  '.post',
  '.article',
  '.entry',
  '#content',
  '#main',
  '#article',
  '#post',
  // 代码/文档类
  '.markdown-body',
  '.prose',
  '.rich-text',
  '.text-content',
  // 其他常见
  '[itemprop="articleBody"]',
  '[itemprop="blogPost"]',
  '.hentry',
];

// 噪音元素选择器
const NOISE_SELECTORS = [
  // 脚本和样式
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
  // 结构性噪音
  'nav', 'header', 'footer', 'aside',
  '.nav', '.navigation', '.menu', '.sidebar', '.widget', '.widgets',
  '#nav', '#navigation', '#menu', '#sidebar', '#footer', '#header',
  // 广告（扩展）
  '.ad', '.ads', '.advertisement', '.sponsor', '.promotion', '.adsbygoogle',
  '.ad-container', '.ad-wrapper', '.ad-slot', '.ad-unit', '.ad-banner',
  '[class*="advert"]', '[class*="sponsor"]', '[id*="advert"]', '[id*="sponsor"]',
  '[data-ad]', '[data-ads]', '[data-advertisement]',
  '.google-ad', '.adsense', '.dfp-ad',
  // 评论
  '.comment', '.comments', '#comments', '.reply', '.respond', '#respond',
  '.comment-form', '.comment-list', '.disqus',
  // 社交
  '.social', '.share', '.sharing', '.social-share', '.social-links',
  '.follow', '.subscribe', '.newsletter',
  // 相关/推荐
  '.related', '.recommended', '.more-posts', '.related-posts', '.also-read',
  '.popular-posts', '.trending', '.suggestions',
  // 导航辅助
  '.breadcrumb', '.breadcrumbs', '.pagination', '.pager',
  '.prev-next', '.post-navigation', '.nav-links',
  // 目录
  '.toc', '.table-of-contents', '#toc',
  // ARIA 角色
  '[role="navigation"]', '[role="banner"]', '[role="complementary"]', '[role="contentinfo"]',
  '[aria-hidden="true"]',
  // 隐藏元素
  '.hidden', '.hide', '.invisible', '.sr-only', '.visually-hidden',
  '[hidden]', '[style*="display:none"]', '[style*="display: none"]',
  // 弹窗/覆盖层
  '.modal', '.popup', '.overlay', '.lightbox', '.dialog',
  // 其他常见噪音
  '.cookie', '.cookies', '.gdpr', '.consent',
  '.promo', '.cta', '.banner', '.alert', '.notice',
  '.author-bio', '.author-box', '.about-author',
  '.tags', '.tag-list', '.categories', '.meta', '.post-meta',
];

const _unsupportedNoiseSelectorWarned = new Set();
function warnUnsupportedNoiseSelectorOnce(selector, err) {
  const key = typeof selector === "string" ? selector : String(selector ?? "");
  if (!key) return;
  if (_unsupportedNoiseSelectorWarned.has(key)) return;
  _unsupportedNoiseSelectorWarned.add(key);

  const message = err instanceof Error ? err.message : String(err);
  // ignore unsupported selector
}

// 跳过的文本模式
const SKIP_PATTERNS = [
  /^https?:\/\/[^\s]+$/i,                          // 纯 URL
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, // 邮箱
  /^\d+(\.\d+)?$/,                                  // 纯数字
  /^v?\d+(\.\d+)+$/,                                // 版本号
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/,      // 日期时间
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^[.#][\w-]+$/,                                   // CSS 选择器
  /^&\w+;$/,                                        // HTML 实体
  /^[\s\d\p{P}]+$/u,                                // 纯标点/数字/空白
];

// 块级元素
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'ARTICLE', 'SECTION', 'ASIDE', 'HEADER', 'FOOTER',
  'NAV', 'MAIN', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'PRE', 'TABLE', 'FORM', 'FIELDSET', 'HR', 'BR',
  'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD',
]);

/**
 * 检查文本是否应该跳过
 */
function shouldSkipText(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length < 2 || trimmed.length > 10000) return true;
  return SKIP_PATTERNS.some(p => p.test(trimmed));
}

/**
 * HTML 实体解码
 */
function decodeHtmlEntities(text) {
  return (text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/gi, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * 清理文本（合并空白，去除首尾空白）
 */
function cleanText(text) {
  return decodeHtmlEntities(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
          children.unshift({ node: child, depth: depth + 1, visited: false });
        } else if (child.nodeType === 3) { // Text
          const text = cleanText(child.textContent);
          if (text && !shouldSkipText(text)) {
            children.unshift({ node: child, depth: depth + 1, visited: true, textContent: text });
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
 * 移除噪音元素
 */
function removeNoiseElements(container) {
  if (!container) return 0;
  let removed = 0;

  // 分批处理选择器，避免太长的选择器字符串
  const batchSize = 20;
  for (let i = 0; i < NOISE_SELECTORS.length; i += batchSize) {
    const batch = NOISE_SELECTORS.slice(i, i + batchSize);
    const selector = batch.join(', ');
    try {
      const noiseElements = container.querySelectorAll(selector);
      for (const el of noiseElements) {
        el.remove();
        removed++;
      }
    } catch (e) {
      // 某些选择器可能不支持，逐个尝试
      for (const sel of batch) {
        try {
          const els = container.querySelectorAll(sel);
          for (const el of els) {
            el.remove();
            removed++;
          }
        } catch (err) {
          warnUnsupportedNoiseSelectorOnce(sel, err);
        }
      }
    }
  }

  return removed;
}

/**
 * 检查元素是否可能是广告容器
 */
function isLikelyAdContainer(el) {
  if (!el) return false;
  const className = (el.className || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const text = el.textContent || '';

  // 检查类名/ID 是否包含广告相关词汇
  const adKeywords = ['ad', 'ads', 'advert', 'sponsor', 'promo', 'banner', 'widget', 'sidebar'];
  for (const kw of adKeywords) {
    if (className.includes(kw) || id.includes(kw)) return true;
  }

  // 文本内容太短但包含很多链接，可能是广告
  const links = el.querySelectorAll('a');
  if (text.length < 500 && links.length > 10) return true;

  // 检查是否主要是图片/iframe
  const images = el.querySelectorAll('img, iframe');
  if (images.length > 3 && text.trim().length < 200) return true;

  return false;
}

/**
 * 计算内容质量分数
 */
function contentQualityScore(el) {
  if (!el) return 0;
  const text = el.textContent || '';
  const textLen = text.trim().length;

  // 基础分数
  let score = textLen;

  // 有段落加分
  const paragraphs = el.querySelectorAll('p');
  score += paragraphs.length * 50;

  // 有标题加分
  const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
  score += headings.length * 100;

  // 广告容器扣分
  if (isLikelyAdContainer(el)) score *= 0.1;

  // 链接密度太高扣分（可能是导航或广告）
  const links = el.querySelectorAll('a');
  const linkTextLen = Array.from(links).reduce((sum, a) => sum + (a.textContent?.length || 0), 0);
  const linkDensity = textLen > 0 ? linkTextLen / textLen : 0;
  if (linkDensity > 0.5) score *= 0.3;

  return score;
}

/**
 * 查找主内容区域
 */
function findMainContent(doc) {
  // 优先使用语义化选择器
  for (const selector of MAIN_CONTENT_SELECTORS) {
    try {
      const elements = doc.querySelectorAll(selector);
      // 如果有多个匹配，选择质量最高的
      let best = null;
      let bestScore = 0;
      for (const el of elements) {
        if (isLikelyAdContainer(el)) continue;
        const score = contentQualityScore(el);
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (best && bestScore > 500) {
        return { element: best, selector };
      }
    } catch (e) {
      // 忽略选择器错误
    }
  }

  // Fallback: 找质量最高的 div/section
  const containers = doc.querySelectorAll('div, section');
  let best = null;
  let bestScore = 0;

  for (const el of containers) {
    if (isLikelyAdContainer(el)) continue;
    const score = contentQualityScore(el);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best && bestScore > 500) {
    return { element: best, selector: 'div/section (heuristic)' };
  }

  // 最终 fallback: body
  return { element: doc.body, selector: 'body (fallback)' };
}

/**
 * 提取元数据
 */
function extractMetadata(doc) {
  const meta = {
    title: '',
    description: '',
    author: '',
    publishDate: '',
  };

  // Title
  meta.title = doc.querySelector('title')?.textContent?.trim() ||
               doc.querySelector('h1')?.textContent?.trim() ||
               doc.querySelector('[property="og:title"]')?.getAttribute('content') ||
               '';

  // Description
  meta.description = doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
                     doc.querySelector('[property="og:description"]')?.getAttribute('content') ||
                     '';

  // Author
  meta.author = doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
                doc.querySelector('[rel="author"]')?.textContent?.trim() ||
                doc.querySelector('.author')?.textContent?.trim() ||
                '';

  // Publish date
  meta.publishDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
                     doc.querySelector('time')?.getAttribute('datetime') ||
                     doc.querySelector('.date, .published, .post-date')?.textContent?.trim() ||
                     '';

  return meta;
}

/**
 * 提取标题结构
 */
function extractHeadings(doc) {
  const headings = [];
  const hElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');

  for (const h of hElements) {
    const text = cleanText(h.textContent);
    if (text && !shouldSkipText(text)) {
      headings.push({
        level: parseInt(h.tagName[1], 10),
        text,
      });
    }
  }

  return headings;
}

/**
 * 提取重要链接
 */
function extractLinks(el) {
  const links = [];
  const seen = new Set();
  const anchors = el.querySelectorAll('a[href]');

  for (const a of anchors) {
    const href = a.getAttribute('href');
    const text = cleanText(a.textContent);

    if (href && text && !seen.has(href) &&
        href.startsWith('http') &&
        text.length > 3 &&
        !shouldSkipText(text)) {
      seen.add(href);
      links.push({ text, url: href });
    }
  }

  return links.slice(0, 50); // 限制数量
}

/**
 * 提取图片
 */
function extractImages(el) {
  const images = [];
  const seen = new Set();
  const imgs = el.querySelectorAll('img[src]');

  for (const img of imgs) {
    const src = img.getAttribute('src');
    const alt = img.getAttribute('alt') || '';

    if (src && !seen.has(src)) {
      seen.add(src);
      images.push({ alt: cleanText(alt), src });
    }
  }

  return images.slice(0, 20); // 限制数量
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
