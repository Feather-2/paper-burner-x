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
import { toNonEmptyString, safeInt as _safeInt } from "../shared/utils/value-utils.js";
import { checkCancelled } from "../shared/utils/cancellation.js";
import { makeSecureTimestampedId } from "../shared/utils/secure-id.js";
import { CorsProxyHttpClient, DEFAULT_CORS_PROXIES, normalizeCorsProxies, validateFetchUrl } from "./http-proxy.js";
import { extractPageContentFromHtml, searchDuckDuckGoHtml } from "./content-extractor.js";

/**
 * @typedef {object} LocalMcpProviderOptions
 * @property {string=} id
 * @property {string=} name
 * @property {(string|null)=} workerEndpoint
 * @property {(string|null)=} proxyEndpoint
 * @property {string[]=} corsProxies
 * @property {number=} proxyCooldownMs
 * @property {number=} proxyMaxCooldownMs
 * @property {boolean=} allowPrivateNetwork
 * @property {boolean=} allowSensitiveUrlProxying
 * @property {boolean=} useUrlWhitelist
 * @property {number=} defaultTimeoutMs
 * @property {number=} searchTimeoutMs
 * @property {number=} maxResults
 * @property {number=} maxSearchPages
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl
 * @property {any=} memoryStore
 */

// Wrapper to provide default fallback value (value-utils safeInt returns null for invalid)
function safeInt(n, fallback = 0) {
  const v = _safeInt(n);
  return v !== null ? v : fallback;
}

function attachAbortSignal(parentSignal, controller) {
  if (!parentSignal || typeof parentSignal !== "object" || typeof parentSignal.aborted !== "boolean") return () => {};
  if (!controller || typeof controller.abort !== "function") return () => {};

  const abortWithReason = () => {
    try {
      controller.abort(parentSignal.reason);
    } catch {
      controller.abort();
    }
  };

  if (parentSignal.aborted) {
    abortWithReason();
    return () => {};
  }

  if (typeof parentSignal.addEventListener !== "function") return () => {};
  parentSignal.addEventListener("abort", abortWithReason, { once: true });
  if (typeof parentSignal.removeEventListener !== "function") return () => {};
  return () => parentSignal.removeEventListener("abort", abortWithReason);
}

/**
 * Local MCP Provider 实现
 * @extends {McpProvider}
 * @param {LocalMcpProviderOptions} [options]
 * @returns {LocalMcpProvider}
 */
export class LocalMcpProvider extends McpProvider {
  /**
   * @param {LocalMcpProviderOptions} [options]
   */
  constructor({
    id = "local-mcp",
    name = "Local MCP",
    workerEndpoint = null, // CF Worker 端点 URL（推荐）
    proxyEndpoint = null, // 自定义私有持久化代理端点
    corsProxies = DEFAULT_CORS_PROXIES,
    proxyCooldownMs = 60_000,
    proxyMaxCooldownMs = 15 * 60_000,
    allowPrivateNetwork = false,
    allowSensitiveUrlProxying = false,
    useUrlWhitelist = true, // P3.2: 默认启用白名单模式
    defaultTimeoutMs = 15000,
    searchTimeoutMs = 20_000, // 搜索可能分页/多次请求，但避免长时间阻塞
    maxResults = 10,
    maxSearchPages = 3,
    fetchImpl,
    memoryStore = null, // Memory 2.0: 可选的 MemoryStore 引用
  } = {}) {
    super({ id, name, endpoint: "local" });

    this.workerEndpoint = toNonEmptyString(workerEndpoint);
    this.proxyEndpoint = toNonEmptyString(proxyEndpoint);

    const normalizedCorsProxies = normalizeCorsProxies(corsProxies);
    this.corsProxies = normalizedCorsProxies && normalizedCorsProxies.length ? normalizedCorsProxies : DEFAULT_CORS_PROXIES.slice();

    this.defaultTimeoutMs = safeInt(defaultTimeoutMs, 10000);
    this.searchTimeoutMs = safeInt(searchTimeoutMs, 15000);
    this.maxResults = safeInt(maxResults, 10);
    this.maxSearchPages = Math.max(1, Math.min(5, safeInt(maxSearchPages, 3)));
    this.allowPrivateNetwork = allowPrivateNetwork === true;
    this.allowSensitiveUrlProxying = allowSensitiveUrlProxying === true;
    this.useUrlWhitelist = useUrlWhitelist === true; // P3.2
    this._memoryStore = memoryStore; // Memory 2.0

    if (fetchImpl !== undefined && typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");
    this._fetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    if (typeof this._fetch !== "function") throw new Error("LocalMcpProvider requires global fetch or fetchImpl");

    this._http = new CorsProxyHttpClient({
      fetchImpl: this._fetch,
      proxyEndpoint: this.proxyEndpoint,
      corsProxies: this.corsProxies,
      proxyCooldownMs,
      proxyMaxCooldownMs,
      allowSensitiveUrlProxying: this.allowSensitiveUrlProxying,
      useUrlWhitelist: this.useUrlWhitelist,
    });

    this._deprecatedToolNameWarned = new Set();
    this._tools = [
      new McpToolDefinition({
        name: "search.query",
        description: "Search the web using DuckDuckGo. Returns a list of search results with title, URL, and snippet.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query string" },
            domain: { type: "string", description: "Optional domain to restrict search (e.g., 'wikipedia.org')" },
            time_range: {
              type: "string",
              enum: ["day", "week", "month", "year"],
              description: "Optional time range filter",
            },
            limit: { type: "number", description: "Maximum number of results (default: 10)" },
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
            url: { type: "string", description: "URL to fetch" },
          },
          required: ["url"],
        },
      }),
    ];
  }

  /**
   * @returns {Promise<McpToolDefinition[]>}
   */
  async listTools() {
    return this._tools.slice();
  }

  _canonicalizeToolName(toolName) {
    const name = toNonEmptyString(toolName);
    if (!name) return null;

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
    content.push({ type: "text", text: `(deprecated) Tool name "${used}" is deprecated; use "${canonical}"` });

    return new McpToolResult({
      success: Boolean(result?.success),
      isError: Boolean(result?.isError),
      error: result?.error ?? null,
      content,
    });
  }

  /**
   * @param {string} toolName
   * @param {object} [args]
   * @param {{ signal?: AbortSignal }=} options
   * @returns {Promise<McpToolResult>}
   */
  async callTool(toolName, args = {}, options = {}) {
    const signal = options?.signal || args?.signal;
    checkCancelled(signal);

    const usedName = toNonEmptyString(toolName);
    const canonical = this._canonicalizeToolName(usedName);

    if (canonical === "search.query") {
      const out = await this._search(args, { signal });
      return this._withDeprecatedToolName(out, { usedName, canonicalName: canonical });
    }

    if (canonical === "search.fetch") {
      const out = await this._fetchContent(args, { signal });
      return this._withDeprecatedToolName(out, { usedName, canonicalName: canonical });
    }

    return new McpToolResult({
      success: false,
      isError: true,
      error: `Unknown tool: ${toolName}`,
      content: [{ type: "text", text: `Error: Unknown tool '${toolName}'` }],
    });
  }

  // Tests rely on this method existing; logic delegated to http-proxy.
  async _fetchWithCorsFallback(url, { timeoutMs = 10000, tryDirect = true, signal, maxBodyBytes } = {}) {
    return this._http.fetchWithCorsFallback(url, { timeoutMs, tryDirect, signal, maxBodyBytes });
  }

  async _search({ query, domain, time_range, limit } = {}, { signal } = {}) {
    checkCancelled(signal);
    const q = toNonEmptyString(query);
    if (!q) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: "query is required",
        content: [{ type: "text", text: "Error: query parameter is required" }],
      });
    }

    const maxResults = Math.max(1, Math.min(safeInt(limit, this.maxResults), this.maxResults));

    if (this.workerEndpoint) {
      const workerResult = await this._searchViaWorker({ query: q, domain, time_range, limit: maxResults }, { signal });
      if (workerResult?.success) return workerResult;
    }

    try {
      const fetchHtml = (url, fetchOptions) => this._fetchWithCorsFallback(url, { ...(fetchOptions || {}), signal });
      const { results: formatted, pages } = await searchDuckDuckGoHtml(fetchHtml, {
        query: q,
        domain,
        timeRange: time_range,
        limit: maxResults,
        maxPages: this.maxSearchPages,
        timeoutMs: this.searchTimeoutMs,
      });

      const textOutput = formatted.map((r) => `[${r.index}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`).join("\n\n");
      this._recordSearchDiscoveries(q, formatted);

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: textOutput || "No results found." },
          { type: "json", data: { query: q, results: formatted, count: formatted.length, pages } },
        ],
      });
    } catch (err) {
      if (signal?.aborted) checkCancelled(signal);
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Search failed: ${err?.message || err}` }],
      });
    }
  }

  async _searchViaWorker({ query, domain, time_range, limit }, { signal } = {}) {
    const controller = new AbortController();
    const detachAbort = attachAbortSignal(signal, controller);
    const timeoutId = setTimeout(() => {
      try {
        controller.abort("Timeout");
      } catch {
        controller.abort();
      }
    }, this.searchTimeoutMs);

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

      const textOutput = formatted.map((r) => `[${r.index}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`).join("\n\n");
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
      if (signal?.aborted) checkCancelled(signal);
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Worker search failed: ${err?.message || err}` }],
      });
    } finally {
      clearTimeout(timeoutId);
      detachAbort();
    }
  }

  async _fetchContent({ url } = {}, { signal } = {}) {
    checkCancelled(signal);
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

    if (this.workerEndpoint) {
      const workerResult = await this._fetchContentViaWorker({ url: targetUrl }, { signal });
      if (workerResult?.success) return workerResult;
    }

    try {
      const { text: html, proxy } = await this._fetchWithCorsFallback(targetUrl, {
        timeoutMs: this.defaultTimeoutMs,
        tryDirect: true,
        signal,
      });

      const maxLength = 50000;
      const extracted = extractPageContentFromHtml(html, { maxLength });

      const metadata = {
        url: targetUrl,
        title: extracted.title,
        description: extracted.description,
        fetchedAt: new Date().toISOString(),
        contentLength: html.length,
        extractedLength: extracted.extractedText.length,
        proxy,
        ...(extracted.extraction ? { extraction: extracted.extraction } : {}),
      };

      return new McpToolResult({
        success: true,
        isError: false,
        content: [
          { type: "text", text: extracted.truncatedText },
          {
            type: "json",
            data: {
              metadata,
              title: extracted.title,
              url: targetUrl,
              ...(extracted.markdown !== undefined ? { markdown: extracted.markdown } : {}),
            },
          },
        ],
      });
    } catch (err) {
      if (signal?.aborted) checkCancelled(signal);
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Fetch failed: ${err?.message || err}` }],
      });
    }
  }

  async _fetchContentViaWorker({ url }, { signal } = {}) {
    const controller = new AbortController();
    const detachAbort = attachAbortSignal(signal, controller);
    const timeoutId = setTimeout(() => {
      try {
        controller.abort("Timeout");
      } catch {
        controller.abort();
      }
    }, this.defaultTimeoutMs);

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
      const truncatedText = extractedText.length > maxLength ? extractedText.slice(0, maxLength) + "...(truncated)" : extractedText;

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
      detachAbort();
    }
  }

  bindMemoryStore(memoryStore) {
    this._memoryStore = memoryStore;
  }

  _recordSearchDiscoveries(query, results) {
    if (!this._memoryStore?.syncDiscovery) return;
    const keywords = query.split(/\s+/).filter((k) => k.length >= 2);
    const now = Date.now();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const id = `${makeSecureTimestampedId("search")}_${now}_${i}`;
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
 * @param {LocalMcpProviderOptions} [options]
 * @returns {LocalMcpProvider}
 */
export function createLocalMcpProvider(options = {}) {
  return new LocalMcpProvider(options);
}

export default LocalMcpProvider;
