/**
 * MCP Client - 标准 MCP 协议客户端
 *
 * 支持两种端点模式：
 * 1. local-mcp: paper-burner 内置的轻量 MCP（默认）
 * 2. mcp-nexus: 本地或线上部署的 MCP-Nexus
 *
 * 业务层仅通过 tool schema + MCP 调用，不感知具体 endpoint。
 */

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * MCP 工具定义
 */
export class McpToolDefinition {
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
  constructor({ success = true, content = [], error = null, isError = false }) {
    this.success = Boolean(success);
    this.content = Array.isArray(content) ? content : [];
    this.error = error;
    this.isError = Boolean(isError);
  }

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
  constructor({ providers = [], defaultProvider = null } = {}) {
    this._providers = new Map();
    this._defaultProviderId = null;

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

  addProvider(provider) {
    if (!(provider instanceof McpProvider)) {
      throw new TypeError("McpClient.addProvider(provider): provider must be McpProvider instance");
    }
    this._providers.set(provider.id, provider);
    if (!this._defaultProviderId) this._defaultProviderId = provider.id;
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
   * 列出所有可用工具（合并所有 provider）
   */
  async listAllTools() {
    const allTools = [];
    for (const [providerId, provider] of this._providers) {
      try {
        const tools = await provider.listTools();
        for (const tool of tools) {
          allTools.push({
            ...tool,
            providerId,
            providerName: provider.name,
          });
        }
      } catch (err) {
        console.warn(`[McpClient] Failed to list tools from ${providerId}:`, err?.message);
      }
    }
    return allTools;
  }

  /**
   * 调用工具（自动路由到正确的 provider）
   */
  async callTool(toolName, args = {}, { providerId } = {}) {
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
      return await provider.callTool(toolName, args);
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Error calling ${toolName}: ${err?.message || err}` }],
      });
    }
  }

  /**
   * 便捷方法：搜索
   * 遵循标准 schema: search.query({query, domain?, time_range?, limit?, filters?}) -> results[]
   */
  async search({ query, domain, timeRange, limit = 10, filters } = {}, { providerId } = {}) {
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
  async fetch({ url } = {}, { providerId } = {}) {
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
