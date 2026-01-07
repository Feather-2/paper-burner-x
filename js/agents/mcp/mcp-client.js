/**
 * MCP Client - 标准 MCP 协议客户端
 *
 * 支持两种端点模式：
 * 1. local-mcp: paper-burner 内置的轻量 MCP（默认）
 * 2. mcp-nexus: 本地或线上部署的 MCP-Nexus
 *
 * 业务层仅通过 tool schema + MCP 调用，不感知具体 endpoint。
 */

import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
import { CircuitBreaker } from "../shared/utils/circuit-breaker.js";

/**
 * @typedef {object} McpProviderOptions
 * @property {string=} id
 * @property {string=} name
 * @property {string=} endpoint
 */

/**
 * @typedef {object} McpClientOptions
 * @property {McpProvider[]=} providers
 * @property {(McpProvider|string|null)=} defaultProvider
 * @property {{ now: () => number }=} time
 */

/**
 * @typedef {object} McpHealthCheckOptions
 * @property {string=} providerId
 * @property {number=} timeoutMs
 * @property {boolean=} refreshTools
 */

/**
 * @typedef {{ providerId?: string }} McpCallOptions
 */

/**
 * @typedef {object} McpSearchArgs
 * @property {string=} query
 * @property {string=} domain
 * @property {string=} timeRange
 * @property {number=} limit
 * @property {any=} filters
 */

/**
 * @typedef {{ url?: string }} McpFetchArgs
 */

/**
 * @typedef {Error & { mcpResult?: McpToolResult }} McpToolCallError
 */

function toErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err?.message || err || "");
}

function shouldTripProviderCircuit(err) {
  if (!err) return true;
  if (err?.name === "AbortError") return false;
  const msg = toErrorMessage(err).toLowerCase();
  if (!msg) return true;
  // Don't trip the provider circuit on likely caller/tooling issues.
  if (msg.includes("unknown tool")) return false;
  if (msg.includes("tool not found")) return false;
  if (msg.includes("no such tool")) return false;
  if (msg.includes("invalid arguments")) return false;
  return true;
}

/**
 * MCP 工具定义
 */
export class McpToolDefinition {
  /**
   * @param {{ name?: string, description?: string, inputSchema?: any }} options
   */
  constructor({ name, description, inputSchema }) {
    this.name = toNonEmptyString(name) || "unknown";
    this.description = toNonEmptyString(description) || "";
    this.inputSchema = isPlainObject(inputSchema) ? inputSchema : { type: "object", properties: {} };
  }
}

/**
 * MCP 调用结果
 */
export class McpToolResult {
  /**
   * @param {{ success?: boolean, content?: any[], error?: any, isError?: boolean }} options
   */
  constructor({ success = true, content = [], error = null, isError = false }) {
    this.success = Boolean(success);
    this.content = Array.isArray(content) ? content : [];
    this.error = error;
    this.isError = Boolean(isError);
  }

  /**
   * @returns {string}
   */
  getText() {
    return this.content
      .filter(c => c?.type === "text")
      .map(c => c?.text || "")
      .join("\n");
  }
}

/**
 * MCP Provider 基类
 * 所有 MCP 端点实现都继承此类
 */
export class McpProvider {
  /**
   * @param {McpProviderOptions} [options]
   */
  constructor({ id, name, endpoint } = {}) {
    this.id = toNonEmptyString(id) || "provider_unknown";
    this.name = toNonEmptyString(name) || this.id;
    this.endpoint = toNonEmptyString(endpoint) || "local";
  }

  /**
   * 列出可用工具
   * @returns {Promise<McpToolDefinition[]>}
   */
  async listTools() {
    throw new Error("McpProvider.listTools() not implemented");
  }

  /**
   * 调用工具
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<McpToolResult>}
   */
  async callTool(toolName, args = {}) {
    throw new Error("McpProvider.callTool() not implemented");
  }
}

/**
 * MCP Client - 统一调用接口
 */
export class McpClient {
  /**
   * @param {McpClientOptions} [options]
   */
  constructor({ providers = [], defaultProvider = null, time = null } = {}) {
    this._providers = new Map();
    this._defaultProviderId = null;
    this._providerCircuitBreakers = new Map(); // providerId -> CircuitBreaker
    this._time = time && typeof time.now === "function" ? time : null;

    for (const p of Array.isArray(providers) ? providers : []) {
      if (p instanceof McpProvider) {
        this._providers.set(p.id, p);
        if (!this._defaultProviderId) this._defaultProviderId = p.id;
      }
    }

    if (defaultProvider instanceof McpProvider) {
      this._providers.set(defaultProvider.id, defaultProvider);
      this._defaultProviderId = defaultProvider.id;
    } else if (toNonEmptyString(defaultProvider)) {
      this._defaultProviderId = String(defaultProvider);
    }
  }

  _getProviderCircuitBreaker(providerId) {
    const id = toNonEmptyString(providerId);
    if (!id) return null;
    const existing = this._providerCircuitBreakers.get(id);
    if (existing) return existing;

    const breaker = new CircuitBreaker({
      name: `mcp:${id}`,
      failureThreshold: 3,
      successThreshold: 1,
      openDurationMs: 10_000,
      halfOpenMaxCalls: 1,
      isFailure: shouldTripProviderCircuit,
      ...(this._time ? { time: this._time } : {}),
    });

    this._providerCircuitBreakers.set(id, breaker);
    return breaker;
  }

  addProvider(provider) {
    if (!(provider instanceof McpProvider)) {
      throw new TypeError("McpClient.addProvider(provider): provider must be McpProvider instance");
    }
    this._providers.set(provider.id, provider);
    if (!this._defaultProviderId) this._defaultProviderId = provider.id;
    return this;
  }

  setDefaultProvider(providerId) {
    const id = toNonEmptyString(providerId);
    if (!id) throw new TypeError("McpClient.setDefaultProvider(providerId): providerId must be a non-empty string");
    if (!this._providers.has(id)) throw new Error(`McpClient.setDefaultProvider(providerId): provider not found: ${id}`);
    this._defaultProviderId = id;
    return this;
  }

  listProviders() {
    return Array.from(this._providers.keys());
  }

  getProvider(providerId) {
    const id = toNonEmptyString(providerId) || this._defaultProviderId;
    return id ? this._providers.get(id) || null : null;
  }

  /**
   * @param {McpHealthCheckOptions} [options]
   * @returns {Promise<any>}
   */
  async healthCheck({ providerId, timeoutMs, refreshTools = true } = {}) {
    const id = toNonEmptyString(providerId) || this._defaultProviderId;
    const provider = id ? this._providers.get(id) : null;
    if (!provider) {
      return {
        ok: false,
        providerId: id || null,
        error: `No provider found: ${id}`,
        ts: new Date().toISOString(),
      };
    }

    if (typeof provider.healthCheck === "function") {
      try {
        return await provider.healthCheck({ timeoutMs, refreshTools });
      } catch (err) {
        return {
          ok: false,
          providerId: provider.id,
          error: String(err?.message || err),
          ts: new Date().toISOString(),
        };
      }
    }

    // Fallback: best-effort listTools as "ping".
    try {
      const tools = await provider.listTools();
      return {
        ok: true,
        providerId: provider.id,
        ts: new Date().toISOString(),
        toolCount: Array.isArray(tools) ? tools.length : 0,
      };
    } catch (err) {
      return {
        ok: false,
        providerId: provider.id,
        error: String(err?.message || err),
        ts: new Date().toISOString(),
      };
    }
  }

  /**
   * @param {{ timeoutMs?: number, refreshTools?: boolean }} [options]
   * @returns {Promise<any[]>}
   */
  async healthCheckAll({ timeoutMs, refreshTools = true } = {}) {
    const ids = this.listProviders();
    const results = await Promise.allSettled(
      ids.map(async (providerId) => this.healthCheck({ providerId, timeoutMs, refreshTools }))
    );

    const out = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") out.push(r.value);
      else out.push({ ok: false, providerId: ids[i], error: String(r.reason?.message || r.reason), ts: new Date().toISOString() });
    }
    return out;
  }

  /**
   * 列出所有可用工具（合并所有 provider）
   */
  async listAllTools() {
    const entries = Array.from(this._providers.entries());

    // 并行调用所有 provider
    const results = await Promise.allSettled(
      entries.map(async ([providerId, provider]) => {
        const tools = await provider.listTools();
        return tools.map(tool => ({
          ...tool,
          providerId,
          providerName: provider.name,
        }));
      })
    );

    /** @type {any[]} */
    const allTools = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        allTools.push(...result.value);
      } else {
        const providerId = entries[i][0];
        const msg = String(result.reason?.message || result.reason || "Unknown error");
        errors.push({ providerId, error: msg, ts: new Date().toISOString() });
      }
    }
    if (errors.length > 0) {
      try {
        Object.defineProperty(allTools, "errors", { value: errors, enumerable: false });
      } catch {
        /** @type {any} */ (allTools).errors = errors;
      }
    }
    return allTools;
  }

  /**
   * 调用工具（自动路由到正确的 provider）
   */
  async callTool(toolName, args = {}, { providerId } = /** @type {McpCallOptions} */ ({})) {
    const id = toNonEmptyString(providerId) || this._defaultProviderId;
    const provider = id ? this._providers.get(id) : null;

    if (!provider) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: `No provider found: ${id}`,
        content: [{ type: "text", text: `Error: No provider found for ${id}` }],
      });
    }

    try {
      const breaker = this._getProviderCircuitBreaker(id);
      const execute = async () => {
        const r = await provider.callTool(toolName, args);
        if (r && typeof r === "object" && r.success === false) {
          const err = /** @type {McpToolCallError} */ (new Error(toErrorMessage(r.error || "MCP tool call failed")));
          err.name = "McpToolCallError";
          err.mcpResult = r;
          throw err;
        }
        return r;
      };

      if (!breaker) return await execute();
      return await breaker.execute(execute);
    } catch (err) {
      const maybe = /** @type {any} */ (err);
      if (maybe?.name === "McpToolCallError" && maybe.mcpResult) {
        return maybe.mcpResult;
      }
      if (err?.name === "CircuitBreakerOpenError") {
        return new McpToolResult({
          success: false,
          isError: true,
          error: `Provider circuit open: ${id}`,
          content: [{ type: "text", text: `Error: Provider circuit open (${id})` }],
        });
      }
      return new McpToolResult({
        success: false,
        isError: true,
        error: toErrorMessage(err),
        content: [{ type: "text", text: `Error calling ${toolName}: ${toErrorMessage(err)}` }],
      });
    }
  }

  /**
   * 便捷方法：搜索
   * 遵循标准 schema: search.query({query, domain?, time_range?, limit?, filters?}) -> results[]
   */
  async search(
    /** @type {McpSearchArgs} */ { query, domain, timeRange, limit = 10, filters } = {},
    { providerId } = /** @type {McpCallOptions} */ ({})
  ) {
    const args = { query, domain, time_range: timeRange, limit, filters };

    // Prefer standard tool names; fall back to legacy aliases for local-mcp.
    const preferred = ["search.query", "search"];
    let last = null;
    for (const name of preferred) {
      const r = await this.callTool(name, args, { providerId });
      last = r;
      if (r && r.success) return r;
    }
    return last;
  }

  /**
   * 便捷方法：获取网页内容
   * 遵循标准 schema: search.fetch({url}) -> {content, extracted_text, metadata, attachments}
   */
  async fetch(/** @type {McpFetchArgs} */ { url } = {}, { providerId } = /** @type {McpCallOptions} */ ({})) {
    const args = { url };
    const preferred = ["search.fetch", "fetch_content", "fetch"];
    let last = null;
    for (const name of preferred) {
      const r = await this.callTool(name, args, { providerId });
      last = r;
      if (r && r.success) return r;
    }
    return last;
  }
}

export default McpClient;
