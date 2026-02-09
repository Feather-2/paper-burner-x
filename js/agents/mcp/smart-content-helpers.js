// 主内容选择器（按优先级）
export const MAIN_CONTENT_SELECTORS = [
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
export const NOISE_SELECTORS = [
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
export const SKIP_PATTERNS = [
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
export const BLOCK_TAGS = new Set([
  'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'ARTICLE', 'SECTION', 'ASIDE', 'HEADER', 'FOOTER',
  'NAV', 'MAIN', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'PRE', 'TABLE', 'FORM', 'FIELDSET', 'HR', 'BR',
  'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD',
]);

/**
 * 检查文本是否应该跳过
 */
export function shouldSkipText(text) {
  const trimmed = (text || '').trim();
  if (trimmed.length < 2 || trimmed.length > 10000) return true;
  return SKIP_PATTERNS.some(p => p.test(trimmed));
}

/**
 * HTML 实体解码
 */
export function decodeHtmlEntities(text) {
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
export function cleanText(text) {
  return decodeHtmlEntities(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 移除噪音元素
 */
export function removeNoiseElements(container) {
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
export function isLikelyAdContainer(el) {
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
export function contentQualityScore(el) {
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
export function findMainContent(doc) {
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
export function extractMetadata(doc) {
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
export function extractHeadings(doc) {
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
export function extractLinks(el) {
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
export function extractImages(el) {
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
