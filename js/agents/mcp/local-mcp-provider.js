/**
 * Local MCP Provider - paper-burner 内置搜索工具
 *
 * 实现标准 MCP 工具：
 * - search.query: 搜索查询 (本地实现使用 DuckDuckGo HTML 解析)
 * - search.fetch: 获取网页内容
 *
 * 支持两种模式：
 * 1. workerEndpoint 模式（推荐）：使用 CF Worker 作为后端代理
 * 2. CORS 代理模式（备用）：在浏览器端使用公共 CORS 代理
 */

import { McpProvider, McpToolDefinition, McpToolResult } from "./mcp-client.js";
import { extractSmartContent } from "./smart-content-extractor.js";
import { createSafeRegex } from "../shared/utils/safe-regex.js";
import { isPlainObject, toNonEmptyString, safeInt as _safeInt } from "../shared/utils/value-utils.js";

// Wrapper to provide default fallback value (value-utils safeInt returns null for invalid)
function safeInt(n, fallback = 0) {
  const v = _safeInt(n);
  return v !== null ? v : fallback;
}

function normalizeCorsProxies(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of v) {
    if (raw === "") {
      if (seen.has("")) continue;
      seen.add("");
      out.push("");
      continue;
    }
    const s = toNonEmptyString(raw);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function requireFiniteNumber(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
}

function isSensitiveQueryParamKey(key) {
  const k = String(key || "").toLowerCase().trim();
  if (!k) return false;

  if (k === "token" || k === "access_token" || k === "refresh_token" || k === "id_token") return true;
  if (k === "api_key" || k === "apikey" || k === "key") return true;
  if (k === "secret" || k === "client_secret" || k === "private_key") return true;
  if (k === "signature" || k === "sig" || k.endsWith("signature") || k.endsWith("sig")) return true;
  if (k === "password" || k === "passwd" || k === "pwd") return true;
  if (k === "authorization" || k === "auth" || k.startsWith("auth_") || k.includes("auth")) return true;
  if (k.startsWith("x-amz-") && (k.includes("credential") || k.includes("signature") || k.includes("security-token"))) return true;

  return false;
}

function redactUrlForLog(rawUrl) {
  const url = toNonEmptyString(rawUrl);
  if (!url) return "";

  try {
    const u = new URL(url);

    if (u.username) u.username = "REDACTED";
    if (u.password) u.password = "REDACTED";

    const keys = [...u.searchParams.keys()];
    for (const key of keys) {
      if (isSensitiveQueryParamKey(key)) u.searchParams.set(key, "REDACTED");
    }

    return u.toString();
  } catch {
    return url.replace(
      /([?&](?:token|access_token|refresh_token|id_token|api_key|apikey|key|secret|client_secret|signature|sig|password|passwd|pwd)=)[^&]*/gi,
      "$1REDACTED"
    );
  }
}

function isIpv4Host(hostname) {
  const h = String(hostname || "").trim();
  const parts = h.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isPrivateIpv4(hostname) {
  if (!isIpv4Host(hostname)) return false;
  const [a, b] = hostname.split(".").map((x) => Number(x));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h || !h.includes(":")) return false;
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  return false;
}

function isPrivateHostname(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(h)) return true;
  return false;
}

function validateFetchUrl(rawUrl, { allowPrivateNetwork = false } = {}) {
  const url = toNonEmptyString(rawUrl);
  if (!url) throw new Error("url is required");

  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${u.protocol || "(empty)"}`);
  }

  const hostname = toNonEmptyString(u.hostname);
  if (!hostname) throw new Error("Invalid URL hostname");
  if (!allowPrivateNetwork && isPrivateHostname(hostname)) {
    throw new Error("Blocked URL hostname (private network)");
  }

  return u.toString();
}

function looksLikeProxyErrorPage(html) {
  const s = typeof html === "string" ? html : String(html ?? "");
  if (!s) return false;
  const lower = s.toLowerCase();
  const len = s.length;

  // Only apply heuristics to relatively small responses to avoid false positives.
  if (len > 8000) return false;

  // Common CORS proxy / browser error signatures.
  if (lower.includes("access to fetch") && lower.includes("blocked")) return true;
  if (lower.includes("access to xmlhttprequest") && lower.includes("blocked")) return true;
  if (lower.includes("not allowed by access-control-allow-origin")) return true;
  if (lower.includes("cors-anywhere")) return true;
  if (lower.includes("allorigins") && lower.includes("error")) return true;
  if (lower.includes("cross origin") && lower.includes("denied")) return true;

  // Generic short error pages.
  if (len < 2500) {
    if (lower.includes("access denied")) return true;
    if (lower.includes("forbidden")) return true;
    if (lower.includes("request blocked")) return true;
    if (lower.includes("too many requests")) return true;
    if (lower.includes("rate limit")) return true;
    if (lower.includes("service unavailable")) return true;
    if (lower.includes("attention required") && lower.includes("cloudflare")) return true;
    if (lower.includes("checking your browser")) return true;
  }

  return false;
}

function sanitizeExtractedText(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (!s) return "";
  return s.replace(/https?:\/\/[^\s<>"']+/gi, " ").replace(/\s+/g, " ").trim();
}

function stripUrls(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (!s) return "";
  return s.replace(/https?:\/\/[^\s<>"']+/gi, "");
}

/**
 * 健壮的 HTML 文本提取器
 * 采用轻量级状态机（单次线性扫描）替代多轮 replace，降低大文档的内存/CPU 压力。
 */
function extractTextFromHtml(html) {
  if (!html || typeof html !== "string") return "";

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
  let i = 0;
  while (i < html.length) {
    const ch = html[i];

    if (ch === "<") {
      // HTML comment
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? html.length : end + 3;
        out.push(" ");
        continue;
      }

      // doctype / directives
      if (html[i + 1] === "!") {
        const end = html.indexOf(">", i + 2);
        i = end === -1 ? html.length : end + 1;
        out.push(" ");
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
        out.push(" ");
        continue;
      }

      i = end + 1;
      out.push(" ");
      continue;
    }

    if (ch === "&") {
      const decoded = decodeEntityAt(html, i);
      if (decoded) {
        out.push(decoded.text);
        i = decoded.nextIndex;
        continue;
      }
    }

    out.push(isWs(ch) ? " " : ch);
    i++;
  }

  // 清理 URL 与多余空白（仅 2 次线性 pass）
  const text = out.join("").replace(/https?:\/\/[^\s<>"']+/gi, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 提取页面标题
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? extractTextFromHtml(match[1]).trim() : "";
}

/**
 * 提取 meta description
 */
function extractMetaDescription(html) {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
    html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  return match ? match[1].trim() : "";
}

/**
 * 解析 DuckDuckGo HTML 搜索结果
 */
async function parseDuckDuckGoResults(html) {
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
    } catch { }

    return href;
  };

  // DuckDuckGo 结果在 class="result" 的 div 中
  // Browser: use DOMParser; Node: fallback to linkedom DOMParser when available.
  let DOMParserImpl = typeof globalThis.DOMParser !== "undefined" ? globalThis.DOMParser : null;
  if (!DOMParserImpl) {
    try {
      const mod = await import("linkedom");
      DOMParserImpl = mod?.DOMParser || null;
    } catch { }
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
    } catch (e) {
      console.warn("[LocalMcpProvider] DOMParser failed:", e?.message);
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

/**
 * 构建 DuckDuckGo 搜索 URL
 */
function buildDuckDuckGoUrl(query, { domain, timeRange } = {}) {
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

  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

/**
 * CORS 代理列表
 * 注意：公共 CORS 代理已移除（存在数据泄露风险）
 * 请使用 workerEndpoint 或 proxyEndpoint 配置私有代理
 */
const CORS_PROXIES = [
  // 仅保留直接请求选项
  "",
];

/**
 * Local MCP Provider 实现
 */
export class LocalMcpProvider extends McpProvider {
  constructor({
    id = "local-mcp",
    name = "Local MCP",
    workerEndpoint = null, // CF Worker 端点 URL（推荐）
    proxyEndpoint = null,  // 自定义私有持久化代理端点
    corsProxies = CORS_PROXIES,
    proxyCooldownMs = 60_000,
    allowPrivateNetwork = false,
    defaultTimeoutMs = 15000,
    searchTimeoutMs = 60000, // 搜索需要尝试多个实例，给更长时间
    maxResults = 10,
    fetchImpl,
    memoryStore = null,  // Memory 2.0: 可选的 MemoryStore 引用
  } = {}) {
    super({ id, name, endpoint: "local" });

    // 优先使用 Worker 端点或私有代理
    this.workerEndpoint = toNonEmptyString(workerEndpoint);
    this.proxyEndpoint = toNonEmptyString(proxyEndpoint);
    const normalizedCorsProxies = normalizeCorsProxies(corsProxies);
    this.corsProxies = normalizedCorsProxies && normalizedCorsProxies.length ? normalizedCorsProxies : CORS_PROXIES.slice();
    this.defaultTimeoutMs = safeInt(defaultTimeoutMs, 10000);
    this.searchTimeoutMs = safeInt(searchTimeoutMs, 15000);
    this.maxResults = safeInt(maxResults, 10);
    this._memoryStore = memoryStore;  // Memory 2.0

    if (fetchImpl !== undefined && typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
    this._fetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    if (typeof this._fetch !== "function") throw new Error("LocalMcpProvider requires global fetch or fetchImpl");

    this.allowPrivateNetwork = allowPrivateNetwork === true;

    this.proxyCooldownMs = Math.max(0, safeInt(requireFiniteNumber(proxyCooldownMs, "proxyCooldownMs"), 60_000));
    this._corsProxyUnhealthyUntilMs = new Map(); // proxy -> ts (ms)
    this._lastGoodProxy = undefined; // proxy string, may be ""
    this._deprecatedToolNameWarned = new Set();

    // 工具定义
    this._tools = [
      new McpToolDefinition({
        name: "search.query",
        description: "Search the web using DuckDuckGo. Returns a list of search results with title, URL, and snippet.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string",
            },
            domain: {
              type: "string",
              description: "Optional domain to restrict search (e.g., 'wikipedia.org')",
            },
            time_range: {
              type: "string",
              enum: ["day", "week", "month", "year"],
              description: "Optional time range filter",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 10)",
            },
          },
          required: ["query"],
        },
      }),
      new McpToolDefinition({
        name: "search.fetch",
        description: "Fetch and extract content from a URL. Returns the page title, extracted text, and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to fetch",
            },
          },
          required: ["url"],
        },
      }),
    ];
  }

  /**
   * 列出可用工具
   */
  async listTools() {
    return this._tools.slice();
  }

  _canonicalizeToolName(toolName) {
    const name = toNonEmptyString(toolName);
    if (!name) return null;

    // Canonical tool names
    if (name === "search.query") return "search.query";
    if (name === "search.fetch") return "search.fetch";

    // Backward-compatible aliases (deprecated)
    if (name === "search") return "search.query";
    if (name === "fetch_content") return "search.fetch";
    if (name === "fetch") return "search.fetch";

    return null;
  }

  _withDeprecatedToolName(result, { usedName, canonicalName } = {}) {
    const used = toNonEmptyString(usedName);
    const canonical = toNonEmptyString(canonicalName);
    if (!used || !canonical || used === canonical) return result;

    if (this._deprecatedToolNameWarned.has(used)) return result;
    this._deprecatedToolNameWarned.add(used);

    const content = Array.isArray(result?.content) ? result.content.slice() : [];
    content.push({
      type: "text",
      text: `(deprecated) Tool name "${used}" is deprecated; use "${canonical}"`,
    });

    // Keep the primary output first; append the warning.
    return new McpToolResult({
      success: Boolean(result?.success),
      isError: Boolean(result?.isError),
      error: result?.error ?? null,
      content,
    });
  }

  /**
   * 调用工具
   */
  async callTool(toolName, args = {}) {
    const usedName = toNonEmptyString(toolName);
    const canonical = this._canonicalizeToolName(usedName);

    if (canonical === "search.query") {
      const out = await this._search(args);
      return this._withDeprecatedToolName(out, { usedName, canonicalName: canonical });
    }

    if (canonical === "search.fetch") {
      const out = await this._fetchContent(args);
      return this._withDeprecatedToolName(out, { usedName, canonicalName: canonical });
    }

    return new McpToolResult({
      success: false,
      isError: true,
      error: `Unknown tool: ${toolName}`,
      content: [{ type: "text", text: `Error: Unknown tool '${toolName}'` }],
    });
  }

  _nowMs() {
    return Date.now();
  }

  _markCorsProxyFailure(proxy) {
    const until = this._nowMs() + this.proxyCooldownMs;
    this._corsProxyUnhealthyUntilMs.set(proxy, until);
  }

  _markCorsProxySuccess(proxy) {
    this._lastGoodProxy = proxy;
    this._corsProxyUnhealthyUntilMs.delete(proxy);
  }

  _buildCorsProxyCandidates({ tryDirect }) {
    const base = (Array.isArray(this.corsProxies) ? this.corsProxies : CORS_PROXIES).slice();

    // 如果有私有代理端点，将其放在最前面
    if (this.proxyEndpoint) {
      if (!base.includes(this.proxyEndpoint)) base.unshift(this.proxyEndpoint);
    }

    const candidates = tryDirect ? base : base.filter((p) => p);

    if (candidates.length === 0) return [];

    // last-good proxy priority (only if still in candidate set)
    if (this._lastGoodProxy !== undefined && candidates.includes(this._lastGoodProxy)) {
      const reordered = [this._lastGoodProxy, ...candidates.filter((p) => p !== this._lastGoodProxy)];
      return reordered;
    }

    return candidates;
  }

  _filterCorsProxyCooldown(candidates) {
    const now = this._nowMs();
    const available = candidates.filter((p) => {
      const until = this._corsProxyUnhealthyUntilMs.get(p);
      return until === undefined || until <= now;
    });
    // 如果全部都在冷却期，为避免完全不可用，则忽略冷却策略尝试所有候选
    return available.length ? available : candidates;
  }

  /**
   * 通过 CORS 代理链抓取 HTML（会抛出 AggregateError）
   */
  async _fetchWithCorsFallback(url, { timeoutMs = 10000, tryDirect = true } = {}) {
    const candidates = this._filterCorsProxyCooldown(this._buildCorsProxyCandidates({ tryDirect }));
    const errors = [];
    const redactedUrl = redactUrlForLog(url);

    for (const proxy of candidates) {
      const targetUrl = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this._fetch(targetUrl, {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
          mode: "cors",
        });

        if (response.ok || response.status === 0) {
          const text = await response.text();
          if (text && text.length > 100 && !looksLikeProxyErrorPage(text)) {
            this._markCorsProxySuccess(proxy);
            return { text, url: targetUrl, proxy: proxy || "direct" };
          }
        }

        const err = new Error(`CORS proxy failed: ${proxy || "direct"} (HTTP ${response.status})`);
        errors.push(err);
        this._markCorsProxyFailure(proxy);
      } catch (e) {
        const err = new Error(`CORS proxy failed: ${proxy || "direct"} (${e?.message || String(e)})`);
        errors.push(err);
        this._markCorsProxyFailure(proxy);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new AggregateError(errors, `All CORS proxy attempts failed for ${redactedUrl || url}`);
  }

  /**
   * 搜索实现
   */
  async _search({ query, domain, time_range, limit } = {}) {
    const q = toNonEmptyString(query);
    if (!q) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: "query is required",
        content: [{ type: "text", text: "Error: query parameter is required" }],
      });
    }

    const maxResults = safeInt(limit, this.maxResults);

    // 优先使用 Worker 端点
    if (this.workerEndpoint) {
      const workerResult = await this._searchViaWorker({ query: q, domain, time_range, limit: maxResults });
      if (workerResult?.success) return workerResult;
    }

    // 备用：CORS 代理模式
    try {
      const searchUrl = buildDuckDuckGoUrl(q, { domain, timeRange: time_range });
      const { text: html } = await this._fetchWithCorsFallback(searchUrl, {
        timeoutMs: this.searchTimeoutMs,
        tryDirect: false, // DuckDuckGo 需要代理
      });

      const results = (await parseDuckDuckGoResults(html)).slice(0, maxResults);

      // 格式化为 MCP 标准输出
      const formatted = results.map((r, i) => ({
        index: i + 1,
        title: r.title || "(No title)",
        url: r.url,
        snippet: r.snippet || "",
      }));

      const textOutput = formatted
        .map((r) => `[${r.index}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
        .join("\n\n");

      // Memory 2.0: 记录搜索结果到 MemoryStore
      this._recordSearchDiscoveries(q, formatted);

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: textOutput || "No results found." },
          { type: "json", data: { query: q, results: formatted, count: formatted.length } },
        ],
      });
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Search failed: ${err?.message || err}` }],
      });
    }
  }

  /**
   * 通过 Worker 端点搜索
   */
  async _searchViaWorker({ query, domain, time_range, limit }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.searchTimeoutMs);

    try {
      const response = await this._fetch(`${this.workerEndpoint}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, domain, time_range, limit }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        return new McpToolResult({
          success: false,
          isError: true,
          error: `Worker search failed: HTTP ${response.status}`,
          content: [{ type: "text", text: `Worker search failed: HTTP ${response.status}` }],
        });
      }

      if (!data?.success) {
        return new McpToolResult({
          success: false,
          isError: true,
          error: data.error || "Worker search failed",
          content: [{ type: "text", text: `Search failed: ${data.error || "Unknown error"}` }],
        });
      }

      const results = Array.isArray(data.results) ? data.results : [];
      const formatted = results.map((r, i) => ({
        index: i + 1,
        title: r.title || "(No title)",
        url: r.url,
        snippet: r.snippet || "",
      }));

      const textOutput = formatted
        .map((r) => `[${r.index}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
        .join("\n\n");

      // Memory 2.0: 记录搜索结果到 MemoryStore
      this._recordSearchDiscoveries(query, formatted);

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: textOutput || "No results found." },
          { type: "json", data: { query, results: formatted, count: formatted.length, via: "worker" } },
        ],
      });
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Worker search failed: ${err?.message || err}` }],
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 获取网页内容实现
   */
  async _fetchContent({ url } = {}) {
    let targetUrl = toNonEmptyString(url);
    if (!targetUrl) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: "url is required",
        content: [{ type: "text", text: "Error: url parameter is required" }],
      });
    }

    try {
      targetUrl = validateFetchUrl(targetUrl, { allowPrivateNetwork: this.allowPrivateNetwork });
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Fetch failed: ${err?.message || err}` }],
      });
    }

    // 优先使用 Worker 端点
    if (this.workerEndpoint) {
      const workerResult = await this._fetchContentViaWorker({ url: targetUrl });
      if (workerResult?.success) return workerResult;
    }

    // 备用：CORS 代理模式
    try {
      const { text: html, proxy } = await this._fetchWithCorsFallback(targetUrl, {
        timeoutMs: this.defaultTimeoutMs,
        tryDirect: true,
      });

      const maxLength = 50000;

      let extracted = null;
      try {
        extracted = extractSmartContent(html, { maxLength, preserveLinks: false, fallbackOnError: true });
      } catch {
        extracted = null;
      }

      const title = toNonEmptyString(extracted?.metadata?.title) || extractTitle(html);
      const description = toNonEmptyString(extracted?.metadata?.description) || extractMetaDescription(html);
      const extractedText = sanitizeExtractedText(extracted?.plainText || extracted?.markdown || extractTextFromHtml(html));

      const truncatedText = extractedText.length > maxLength ? extractedText.slice(0, maxLength) + "...(truncated)" : extractedText;

      const metadata = {
        url: targetUrl,
        title,
        description,
        fetchedAt: new Date().toISOString(),
        contentLength: html.length,
        extractedLength: extractedText.length,
        proxy,
        ...(extracted?.structure ? { extraction: extracted.structure } : {}),
      };

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: truncatedText },
          {
            type: "json",
            data: {
              metadata,
              title,
              url: targetUrl,
              ...(toNonEmptyString(extracted?.markdown) ? { markdown: stripUrls(extracted.markdown) } : {}),
            },
          },
        ],
      });
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Fetch failed: ${err?.message || err}` }],
      });
    }
  }

  /**
   * 通过 Worker 端点获取内容
   */
  async _fetchContentViaWorker({ url }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    try {
      const response = await this._fetch(`${this.workerEndpoint}/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        return new McpToolResult({
          success: false,
          isError: true,
          error: `Worker fetch failed: HTTP ${response.status}`,
          content: [{ type: "text", text: `Worker fetch failed: HTTP ${response.status}` }],
        });
      }

      if (!data?.success) {
        return new McpToolResult({
          success: false,
          isError: true,
          error: data.error || "Worker fetch failed",
          content: [{ type: "text", text: `Fetch failed: ${data.error || "Unknown error"}` }],
        });
      }

      const extractedText = data.extractedText || "";
      const maxLength = 50000;
      const truncatedText = extractedText.length > maxLength
        ? extractedText.slice(0, maxLength) + "...(truncated)"
        : extractedText;

      const metadata = {
        ...data.metadata,
        via: "worker",
      };

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: truncatedText },
          { type: "json", data: { metadata, title: data.title, url } },
        ],
      });
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Worker fetch failed: ${err?.message || err}` }],
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory 2.0: MemoryStore 集成
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 绑定 MemoryStore（延迟绑定）
   */
  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore;
  }

  /**
   * 记录搜索结果到 MemoryStore.syncTable.discoveries
   */
  _recordSearchDiscoveries(query, results) {
    if (!this._memoryStore?.syncDiscovery) return;
    const keywords = query.split(/\s+/).filter(k => k.length >= 2);
    const now = Date.now();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      // 使用 timestamp + index + 随机数避免冲突
      const rand = Math.random().toString(36).slice(2, 8);
      const id = `search_${now}_${i}_${rand}`;
      this._memoryStore.syncDiscovery(id, {
        type: "search_result",
        status: "open",
        keywords,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        by: "mcp",
      });
    }
  }
}

/**
 * 创建默认的 Local MCP Provider 实例
 */
export function createLocalMcpProvider(options = {}) {
  return new LocalMcpProvider(options);
}

export default LocalMcpProvider;
