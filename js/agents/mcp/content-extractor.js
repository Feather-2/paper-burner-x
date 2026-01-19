import { extractSmartContent } from "./smart-content-extractor.js";
import { createSafeRegex } from "../shared/index.js";
import { toNonEmptyString } from "../shared/index.js";
import { sanitizeExtractedText, stripUrls } from "./content-sanitizer.js";

/**
 * @typedef {object} PageContentExtractionResult
 * @property {string} title
 * @property {string} description
 * @property {string} extractedText
 * @property {string} truncatedText
 * @property {string=} markdown
 * @property {any|null} extraction
 */

/**
 * @typedef {object} DuckDuckGoSearchResult
 * @property {string} url
 * @property {string} title
 * @property {string} snippet
 */

/**
 * @typedef {object} DuckDuckGoFormattedSearchResult
 * @property {number} index
 * @property {string} title
 * @property {string} url
 * @property {string} snippet
 */

/**
 * @typedef {object} FetchHtmlResult
 * @property {string} text
 * @property {string=} url
 * @property {string=} proxy
 */

/**
 * @callback FetchHtml
 * @param {string} url
 * @param {{ timeoutMs?: number, tryDirect?: boolean }=} options
 * @returns {Promise<FetchHtmlResult>}
 */

/**
 * 健壮的 HTML 文本提取器
 * 采用轻量级状态机（单次线性扫描）替代多轮 replace，降低大文档的内存/CPU 压力。
 * @param {any} html
 * @returns {string}
 */
export function extractTextFromHtml(html) {
  if (!html || typeof html !== "string") return "";

  // Safety bounds: avoid OOM when fed huge HTML blobs.
  // Note: we still receive the full string from upstream; these limits cap scan cost and output growth.
  const MAX_INPUT_CHARS = 2_000_000;
  const MAX_OUTPUT_CHARS = 200_000;
  if (html.length > MAX_INPUT_CHARS) html = html.slice(0, MAX_INPUT_CHARS);

  const ENTITY_MAP = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&#x27;": "'",
    "&ndash;": "–",
    "&mdash;": "—",
    "&lsquo;": "'",
    "&rsquo;": "'",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&bull;": "•",
    "&hellip;": "…",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
    "&euro;": "€",
    "&pound;": "£",
    "&yen;": "¥",
    "&cent;": "¢",
  };

  const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "video", "canvas"]);

  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
  const isNameChar = (c) => {
    const code = c.charCodeAt(0);
    return (
      (code >= 48 && code <= 57) || // 0-9
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      c === "-" ||
      c === "_" ||
      c === ":"
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
      if (ch === ">") return i;
    }
    return -1;
  };

  const readTagName = (s, start) => {
    let i = start;
    while (i < s.length && isWs(s[i])) i++;
    const nameStart = i;
    while (i < s.length && isNameChar(s[i])) i++;
    if (i === nameStart) return "";
    return s.slice(nameStart, i).toLowerCase();
  };

  const skipUntilCloseTag = (s, start, tagName) => {
    let i = start;
    while (i < s.length) {
      const lt = s.indexOf("<", i);
      if (lt === -1) return s.length;
      if (s.startsWith("<!--", lt)) {
        const end = s.indexOf("-->", lt + 4);
        i = end === -1 ? s.length : end + 3;
        continue;
      }
      if (s[lt + 1] !== "/") {
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
    // Fast path: must start with '&'
    if (s[i] !== "&") return null;
    const maxLen = 16;
    let j = i + 1;
    while (j < s.length && j - i <= maxLen) {
      const ch = s[j];
      if (ch === ";") {
        j++;
        break;
      }
      if (isWs(ch) || ch === "<" || ch === ">" || ch === "&") break;
      j++;
    }
    if (j <= i + 1 || s[j - 1] !== ";") return null;
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
  let outLen = 0;
  const pushOut = (text) => {
    if (!text) return;
    if (outLen >= MAX_OUTPUT_CHARS) return;
    const s = String(text);
    if (!s) return;
    const remaining = MAX_OUTPUT_CHARS - outLen;
    if (remaining <= 0) return;
    if (s.length > remaining) {
      out.push(s.slice(0, remaining));
      outLen = MAX_OUTPUT_CHARS;
      return;
    }
    out.push(s);
    outLen += s.length;
  };
  let i = 0;
  while (i < html.length && outLen < MAX_OUTPUT_CHARS) {
    const ch = html[i];

    if (ch === "<") {
      // HTML comment
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? html.length : end + 3;
        pushOut(" ");
        continue;
      }

      // doctype / directives
      if (html[i + 1] === "!") {
        const end = html.indexOf(">", i + 2);
        i = end === -1 ? html.length : end + 1;
        pushOut(" ");
        continue;
      }

      const isClose = html[i + 1] === "/";
      const nameStart = isClose ? i + 2 : i + 1;
      const tagName = readTagName(html, nameStart);
      const end = findTagEnd(html, nameStart);
      if (end === -1) break;

      // Skip full blocks for non-text tags.
      if (!isClose && SKIP_TAGS.has(tagName)) {
        i = skipUntilCloseTag(html, end + 1, tagName);
        pushOut(" ");
        continue;
      }

      i = end + 1;
      pushOut(" ");
      continue;
    }

    if (ch === "&") {
      const decoded = decodeEntityAt(html, i);
      if (decoded) {
        pushOut(decoded.text);
        i = decoded.nextIndex;
        continue;
      }
    }

    pushOut(isWs(ch) ? " " : ch);
    i++;
  }

  // 清理 URL 与多余空白（仅 2 次线性 pass）
  const text = out.join("").replace(/https?:\/\/[^\s<>"']+/gi, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 提取页面标题
 * @param {string} html
 * @returns {string}
 */
export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? extractTextFromHtml(match[1]).trim() : "";
}

/**
 * 提取 meta description
 * @param {string} html
 * @returns {string}
 */
export function extractMetaDescription(html) {
  const match =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
    html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  return match ? match[1].trim() : "";
}

/**
 * @param {string} html
 * @param {{ maxLength?: number }=} options
 * @returns {PageContentExtractionResult}
 */
export function extractPageContentFromHtml(html, { maxLength = 50000 } = {}) {
  const maxLen = typeof maxLength === "number" && Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : 50000;

  let extracted = null;
  try {
    extracted = extractSmartContent(html, { maxLength: maxLen, preserveLinks: false, fallbackOnError: true });
  } catch {
    extracted = null;
  }

  const title = toNonEmptyString(extracted?.metadata?.title) || extractTitle(html);
  const description = toNonEmptyString(extracted?.metadata?.description) || extractMetaDescription(html);
  const extractedText = sanitizeExtractedText(extracted?.plainText || extracted?.markdown || extractTextFromHtml(html));

  const truncatedText = extractedText.length > maxLen ? extractedText.slice(0, maxLen) + "...(truncated)" : extractedText;

  const rawMarkdown = toNonEmptyString(extracted?.markdown);
  const markdown = rawMarkdown ? stripUrls(extracted.markdown) : undefined;

  return { title, description, extractedText, truncatedText, markdown, extraction: extracted?.structure || null };
}

/**
 * 解析 DuckDuckGo HTML 搜索结果
 * @param {string} html
 * @returns {Promise<DuckDuckGoSearchResult[]>}
 */
export async function parseDuckDuckGoResults(html) {
  const results = [];

  const normalizeDuckDuckGoUrl = (raw) => {
    const href = String(raw || "").trim();
    if (!href) return "";

    try {
      if (href.startsWith("/l/?")) {
        const u = new URL(`https://duckduckgo.com${href}`);
        return u.searchParams.get("uddg") || href;
      }
      if (href.includes("duckduckgo.com/l/?")) {
        const u = new URL(href);
        return u.searchParams.get("uddg") || href;
      }
    } catch { /* intentional: malformed URL, return original href */ }

    return href;
  };

  // DuckDuckGo 结果在 class="result" 的 div 中
  // Browser: use DOMParser; Node: fallback to linkedom DOMParser when available.
  let DOMParserImpl = typeof globalThis.DOMParser !== "undefined" ? globalThis.DOMParser : null;
  if (!DOMParserImpl) {
    try {
      const mod = await import("linkedom");
      DOMParserImpl = mod?.DOMParser || null;
    } catch { /* intentional: linkedom is optional */ }
  }

  if (DOMParserImpl) {
    try {
      const parser = new DOMParserImpl();
      const doc = parser.parseFromString(html, "text/html");
      const seen = new Set();
      const pushResult = (url, title, snippet) => {
        const u = toNonEmptyString(url);
        if (!u || seen.has(u) || u.includes("duckduckgo.com")) return;
        seen.add(u);
        results.push({ url: u, title: title || "", snippet: snippet || "" });
      };

      // 尝试多种选择器
      const resultElements = doc.querySelectorAll(".result, .results_links, [data-testid='result']");

      for (const el of resultElements) {
        const linkEl = el.querySelector("a.result__a, a.result__url, a[href^='http']");
        const titleEl = el.querySelector(".result__title, h2, .result__a");
        const snippetEl = el.querySelector(".result__snippet, .result__body, .snippet");

        if (linkEl) {
          const url = normalizeDuckDuckGoUrl(linkEl.href || linkEl.getAttribute("href") || "");
          const title = titleEl ? titleEl.textContent?.trim() : "";
          const snippet = snippetEl ? snippetEl.textContent?.trim() : "";

          if (url && url.startsWith("http")) pushResult(url, title, snippet);
        }
      }

      // Fallback: DOM-based extraction without relying on brittle DuckDuckGo CSS classes.
      if (results.length === 0) {
        const anchors = doc.querySelectorAll("a[href]");
        for (const a of anchors) {
          const url = normalizeDuckDuckGoUrl(a.href || a.getAttribute("href") || "");
          if (!url || !url.startsWith("http") || url.includes("duckduckgo.com")) continue;

          const title = (a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").trim();
          if (!title || title.length < 3) continue;

          let snippet = "";
          const container = typeof a.closest === "function" ? a.closest("article, section, div, li") : a.parentElement;
          if (container) {
            snippet = String(container.textContent || "").replace(/\s+/g, " ").trim();
            if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
            if (snippet.length > 280) snippet = snippet.slice(0, 280) + "...";
          }

          pushResult(url, title, snippet);
          if (results.length >= 20) break;
        }
      }
    } catch {
      // ignore
    }
  }

  // 备用：正则解析
  if (results.length === 0) {
    // 尝试匹配常见的搜索结果模式
    const linkPattern = createSafeRegex(`<a[^>]+href=["']?(https?://[^"'\s>]+)["']?[^>]*>([^<]*)</a>`, "gi");
    let match;
    const seen = new Set();

    while ((match = linkPattern.exec(html)) !== null) {
      const [, url, title] = match;
      if (url && !seen.has(url) && !url.includes("duckduckgo.com")) {
        seen.add(url);
        results.push({ url, title: extractTextFromHtml(title), snippet: "" });
        if (results.length >= 20) break;
      }
    }
  }

  return results;
}

function decodeHtmlAttr(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Try to locate the DuckDuckGo "next page" URL from an HTML page.
 * @param {any} html
 * @param {string=} baseUrl
 * @returns {Promise<string|null>}
 */
export async function extractDuckDuckGoNextUrl(html, baseUrl) {
  const s = typeof html === "string" ? html : String(html ?? "");
  if (!s) return null;

  const resolve = (href) => {
    const h = decodeHtmlAttr(href).trim();
    if (!h) return null;
    try {
      if (baseUrl) return new URL(h, baseUrl).toString();
    } catch {
      // fall back below
    }
    try {
      return new URL(h, "https://html.duckduckgo.com/").toString();
    } catch {
      return null;
    }
  };

  // Browser: use DOMParser; Node: fallback to linkedom DOMParser when available.
  let DOMParserImpl = typeof globalThis.DOMParser !== "undefined" ? globalThis.DOMParser : null;
  if (!DOMParserImpl) {
    try {
      const mod = await import("linkedom");
      DOMParserImpl = mod?.DOMParser || null;
    } catch { /* intentional: linkedom is optional */ }
  }

  if (DOMParserImpl) {
    try {
      const parser = new DOMParserImpl();
      const doc = parser.parseFromString(s, "text/html");
      const a =
        doc.querySelector("a.result--more__btn, a.result--more__a, a.result__pagination--next, a[rel='next']") ||
        doc.querySelector("a[href*='&s='], a[href*='?s=']");
      const href = a?.getAttribute?.("href") || a?.href || "";
      const next = resolve(href);
      if (next) return next;
    } catch {
      // DOMParser failed, return null (no regex fallback needed in modern environments)
    }
  }

  return null;
}

/**
 * 构建 DuckDuckGo 搜索 URL
 * @param {string} query
 * @param {{ domain?: string, timeRange?: string, offset?: number }=} options
 * @returns {string}
 */
export function buildDuckDuckGoUrl(query, { domain, timeRange, offset } = {}) {
  const params = new URLSearchParams();
  let q = String(query || "");

  // 添加域名限制
  if (domain) {
    q = `site:${domain} ${q}`;
  }

  params.set("q", q);
  params.set("kl", "cn-zh"); // 中文结果
  params.set("kp", "-2"); // 安全搜索关闭

  // 时间范围
  if (timeRange) {
    const timeMap = {
      day: "d",
      week: "w",
      month: "m",
      year: "y",
    };
    const df = timeMap[timeRange] || timeRange;
    params.set("df", df);
  }

  const off = typeof offset === "number" && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : null;
  if (off) params.set("s", String(off));

  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

/**
 * Search DuckDuckGo via its HTML endpoint (browser-friendly).
 * @param {FetchHtml} fetchHtml
 * @param {{ query?: string, domain?: string, timeRange?: string, limit?: number, maxPages?: number, timeoutMs?: number }=} options
 * @returns {Promise<{ results: DuckDuckGoFormattedSearchResult[], pages: number }>}
 */
export async function searchDuckDuckGoHtml(
  fetchHtml,
  { query, domain, timeRange, limit, maxPages = 3, timeoutMs = 20_000 } = {}
) {
  const maxResults = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 10;
  const pagesLimit = Math.max(1, Math.min(5, Math.floor(maxPages || 3)));

  const results = [];
  const seen = new Set();
  const visited = new Set();

  let page = 0;
  let nextUrl = buildDuckDuckGoUrl(query, { domain, timeRange });
  let offset = 0;

  while (nextUrl && results.length < maxResults && page < pagesLimit) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);

    const { text: html } = await fetchHtml(nextUrl, { timeoutMs, tryDirect: false });

    const pageResults = await parseDuckDuckGoResults(html);
    for (const r of pageResults) {
      const url = toNonEmptyString(r?.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      results.push(r);
      if (results.length >= maxResults) break;
    }

    page += 1;

    let candidateNext = await extractDuckDuckGoNextUrl(html, nextUrl);
    if (candidateNext && visited.has(candidateNext)) candidateNext = null;

    // If we still need results but failed to detect the "More Results" link, try offset-based pagination.
    if (!candidateNext && results.length < maxResults && page < pagesLimit) {
      offset += 30;
      candidateNext = buildDuckDuckGoUrl(query, { domain, timeRange, offset });
      if (visited.has(candidateNext)) candidateNext = null;
    }

    nextUrl = candidateNext;
  }

  const sliced = results.slice(0, maxResults);
  const formatted = sliced.map((r, i) => ({
    index: i + 1,
    title: r.title || "(No title)",
    url: r.url,
    snippet: r.snippet || "",
  }));

  return { results: formatted, pages: page };
}
