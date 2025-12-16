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

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n, fallback = 0) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
}

/**
 * 简单的 HTML 解析器 - 提取文本内容
 */
function extractTextFromHtml(html) {
  // 移除 script 和 style 标签
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");

  // 移除所有 HTML 标签
  text = text.replace(/<[^>]+>/g, " ");

  // 解码 HTML 实体
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/gi, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // 清理多余空白
  text = text.replace(/\s+/g, " ").trim();

  return text;
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
    const linkPattern = /<a[^>]+href=["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>([^<]*)<\/a>/gi;
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
 * CORS 代理列表（按优先级排序）
 */
const CORS_PROXIES = [
  // 无代理直接请求（某些情况下可行）
  "",
  // 常用公共代理
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?",
  "https://api.codetabs.com/v1/proxy?quest=",
];

/**
 * 带 CORS 代理的 fetch
 */
async function fetchWithCorsProxy(url, { timeoutMs = 10000, tryDirect = true } = {}) {
  const proxies = tryDirect ? CORS_PROXIES : CORS_PROXIES.slice(1);
  let lastError = null;

  for (const proxy of proxies) {
    const targetUrl = proxy ? `${proxy}${encodeURIComponent(url)}` : url;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
        mode: proxy ? "cors" : "no-cors",
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status === 0) {
        const text = await response.text();
        if (text && text.length > 100) {
          return { text, url: targetUrl, proxy: proxy || "direct" };
        }
      }
    } catch (e) {
      lastError = e;
      // 继续尝试下一个代理
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message || "All proxies failed"}`);
}

/**
 * Local MCP Provider 实现
 */
export class LocalMcpProvider extends McpProvider {
  constructor({
    id = "local-mcp",
    name = "Local MCP",
    workerEndpoint = null, // CF Worker 端点 URL（推荐）
    corsProxies = CORS_PROXIES,
    defaultTimeoutMs = 15000,
    searchTimeoutMs = 60000, // 搜索需要尝试多个实例，给更长时间
    maxResults = 10,
  } = {}) {
    super({ id, name, endpoint: "local" });

    // 优先使用 Worker 端点
    this.workerEndpoint = toNonEmptyString(workerEndpoint);
    this.corsProxies = Array.isArray(corsProxies) ? corsProxies : CORS_PROXIES;
    this.defaultTimeoutMs = safeInt(defaultTimeoutMs, 10000);
    this.searchTimeoutMs = safeInt(searchTimeoutMs, 15000);
    this.maxResults = safeInt(maxResults, 10);

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
      return this._searchViaWorker({ query: q, domain, time_range, limit: maxResults });
    }

    // 备用：CORS 代理模式
    try {
      const searchUrl = buildDuckDuckGoUrl(q, { domain, timeRange: time_range });
      const { text: html } = await fetchWithCorsProxy(searchUrl, {
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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.searchTimeoutMs);

      const response = await fetch(`${this.workerEndpoint}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, domain, time_range, limit }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!data.success) {
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
      return this._fetchContentViaWorker({ url: targetUrl });
    }

    // 备用：CORS 代理模式
    try {
      const { text: html, proxy } = await fetchWithCorsProxy(targetUrl, {
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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

      const response = await fetch(`${this.workerEndpoint}/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!data.success) {
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
