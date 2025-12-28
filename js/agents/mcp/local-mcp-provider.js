/**
 * Local MCP Provider - paper-burner 内置搜索工具
 *
 * 实现标准 MCP 工具：
 * - search: 搜索查询 (本地实现使用 DuckDuckGo HTML 解析)
 * - fetch_content: 获取网页内容
 *
 * 支持两种模式：
 * 1. workerEndpoint 模式（推荐）：使用 CF Worker 作为后端代理
 * 2. CORS 代理模式（备用）：在浏览器端使用公共 CORS 代理
 */

import { McpProvider, McpToolDefinition, McpToolResult } from "./mcp-client.js";
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

/**
 * 健壮的 HTML 文本提取器
 * 采用简单的状态机思路替代纯正则，防止 ReDoS 并更有效地清理标签
 */
function extractTextFromHtml(html) {
  if (!html || typeof html !== "string") return "";

  let text = html;

  // 1. 预处理：移除不含文本内容的标签及其内部
  const tagsToRemove = ["script", "style", "noscript", "svg", "iframe", "video", "canvas", "link", "meta"];
  for (const tag of tagsToRemove) {
    const re = createSafeRegex(`<${tag}\\b[^<]*(?:(?!<\\/${tag}>)<[^<]*)*<\\/${tag}>`, "gi");
    text = text.replace(re, " ");
  }

  // 2. 移除注释
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // 3. 移除剩余的所有 HTML 标签
  text = text.replace(/<[^>]+>/g, " ");

  // 4. 清理内联 CSS 和 URL 模式
  text = text.replace(/[a-zA-Z0-9_.#\- \[]+\{[^}]*\}/g, " "); // 简化的 CSS 块匹配
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, " ");

  // 5. 解码 HTML 实体
  const entityMap = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&#x27;": "'",
  };
  text = text.replace(/&[a-z0-9#]+;/gi, (entity) => {
    if (entityMap[entity]) return entityMap[entity];
    const match = entity.match(/&#(\d+);/i) || entity.match(/&#x([0-9a-f]+);/i);
    if (match) {
      const code = match[2] ? parseInt(match[2], 16) : parseInt(match[1], 10);
      return String.fromCharCode(code);
    }
    return entity;
  });

  // 6. 清理多余空白
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
function parseDuckDuckGoResults(html) {
  const results = [];

  // DuckDuckGo 结果在 class="result" 的 div 中
  // 由于我们在浏览器环境，可以用 DOMParser
  if (typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // 尝试多种选择器
      const resultElements = doc.querySelectorAll(".result, .results_links, [data-testid='result']");

      for (const el of resultElements) {
        const linkEl = el.querySelector("a.result__a, a.result__url, a[href^='http']");
        const titleEl = el.querySelector(".result__title, h2, .result__a");
        const snippetEl = el.querySelector(".result__snippet, .result__body, .snippet");

        if (linkEl) {
          const url = linkEl.href || linkEl.getAttribute("href") || "";
          const title = titleEl ? titleEl.textContent?.trim() : "";
          const snippet = snippetEl ? snippetEl.textContent?.trim() : "";

          if (url && url.startsWith("http") && !url.includes("duckduckgo.com")) {
            results.push({ url, title, snippet });
          }
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

    this.proxyCooldownMs = Math.max(0, safeInt(requireFiniteNumber(proxyCooldownMs, "proxyCooldownMs"), 60_000));
    this._corsProxyUnhealthyUntilMs = new Map(); // proxy -> ts (ms)
    this._lastGoodProxy = undefined; // proxy string, may be ""

    // 工具定义
    this._tools = [
      new McpToolDefinition({
        name: "search",
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
        name: "fetch_content",
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

  /**
   * 调用工具
   */
  async callTool(toolName, args = {}) {
    const name = toNonEmptyString(toolName);

    if (name === "search" || name === "search.query") {
      return this._search(args);
    }

    if (name === "fetch_content" || name === "search.fetch" || name === "fetch") {
      return this._fetchContent(args);
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
          if (text && text.length > 100) {
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

    throw new AggregateError(errors, `All CORS proxy attempts failed for ${url}`);
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

      const results = parseDuckDuckGoResults(html).slice(0, maxResults);

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
    const targetUrl = toNonEmptyString(url);
    if (!targetUrl) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: "url is required",
        content: [{ type: "text", text: "Error: url parameter is required" }],
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

      const title = extractTitle(html);
      const description = extractMetaDescription(html);
      const extractedText = extractTextFromHtml(html);

      // 限制文本长度
      const maxLength = 50000;
      const truncatedText = extractedText.length > maxLength
        ? extractedText.slice(0, maxLength) + "...(truncated)"
        : extractedText;

      const metadata = {
        url: targetUrl,
        title,
        description,
        fetchedAt: new Date().toISOString(),
        contentLength: html.length,
        extractedLength: extractedText.length,
        proxy,
      };

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: truncatedText },
          { type: "json", data: { metadata, title, url: targetUrl } },
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
}

/**
 * 创建默认的 Local MCP Provider 实例
 */
export function createLocalMcpProvider(options = {}) {
  return new LocalMcpProvider(options);
}

export default LocalMcpProvider;
