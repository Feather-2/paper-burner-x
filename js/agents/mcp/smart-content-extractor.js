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
 * 从 DOM 元素提取结构化 Markdown
 */
function elementToMarkdown(el, depth = 0) {
  if (!el) return '';

  const tag = el.tagName?.toUpperCase();
  const parts = [];

  // 处理不同标签类型
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
        parts.push('\n' + '#'.repeat(level) + ' ' + text + '\n');
      }
      break;
    }

    case 'P': {
      const text = inlineToMarkdown(el);
      if (text && !shouldSkipText(text)) {
        parts.push('\n' + text + '\n');
      }
      break;
    }

    case 'UL':
    case 'OL': {
      const items = el.querySelectorAll(':scope > li');
      const isOrdered = tag === 'OL';
      let idx = 1;
      for (const li of items) {
        const text = inlineToMarkdown(li);
        if (text && !shouldSkipText(text)) {
          const prefix = isOrdered ? `${idx++}. ` : '- ';
          parts.push(prefix + text);
        }
      }
      if (parts.length) {
        return '\n' + parts.join('\n') + '\n';
      }
      break;
    }

    case 'BLOCKQUOTE': {
      const text = inlineToMarkdown(el);
      if (text && !shouldSkipText(text)) {
        const lines = text.split('\n').map(l => '> ' + l.trim()).join('\n');
        parts.push('\n' + lines + '\n');
      }
      break;
    }

    case 'PRE': {
      const code = el.querySelector('code');
      const text = (code || el).textContent || '';
      if (text.trim()) {
        // 尝试获取语言
        const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
        parts.push('\n```' + lang + '\n' + text.trim() + '\n```\n');
      }
      break;
    }

    case 'CODE': {
      // 独立的 code 标签（非 pre 内）
      if (el.parentElement?.tagName !== 'PRE') {
        const text = el.textContent?.trim();
        if (text) {
          return '`' + text + '`';
        }
      }
      break;
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
        // 添加表头分隔符
        if (tableRows.length > 1) {
          const headerCols = tableRows[0].split('|').length - 2;
          const separator = '|' + ' --- |'.repeat(headerCols);
          tableRows.splice(1, 0, separator);
        }
        parts.push('\n' + tableRows.join('\n') + '\n');
      }
      break;
    }

    case 'IMG': {
      const alt = el.getAttribute('alt') || '';
      const src = el.getAttribute('src') || '';
      if (src) {
        parts.push(`![${cleanText(alt)}](${src})`);
      }
      break;
    }

    case 'HR': {
      parts.push('\n---\n');
      break;
    }

    case 'BR': {
      parts.push('\n');
      break;
    }

    default: {
      // 递归处理子节点
      for (const child of el.childNodes) {
        if (child.nodeType === 1) { // Element
          parts.push(elementToMarkdown(child, depth + 1));
        } else if (child.nodeType === 3) { // Text
          const text = cleanText(child.textContent);
          if (text && !shouldSkipText(text)) {
            parts.push(text);
          }
        }
      }
    }
  }

  return parts.join('');
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
        } catch (_) {}
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
    console.warn('[SmartContentExtractor] Error:', err?.message);

    if (fallbackOnError) {
      // Fallback: 简单文本提取
      const plainText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);

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
 */
export function htmlToMarkdown(html, options = {}) {
  const { markdown } = extractSmartContent(html, options);
  return markdown;
}

/**
 * 简单包装：只返回纯文本
 */
export function htmlToPlainText(html, options = {}) {
  const { plainText } = extractSmartContent(html, options);
  return plainText;
}

export default extractSmartContent;
