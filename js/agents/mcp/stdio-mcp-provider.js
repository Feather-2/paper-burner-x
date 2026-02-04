/**
 * StdioMcpProvider - Stdio MCP Provider
 *
 * 通过 stdio 连接外部 MCP 服务器的 Provider 实现。
 * 继承 McpProvider 接口，使用 StdioMcpTransport 通信。
 *
 * @module mcp/stdio-mcp-provider
 */

import { McpProvider, McpToolDefinition, McpToolResult } from "./mcp-client.js";
import { StdioMcpTransport } from "./stdio-mcp-transport.js";
import { toNonEmptyString } from "../shared/index.js";

/**
 * @typedef {object} StdioMcpProviderOptions
 * @property {string} [id] - Provider ID
 * @property {string} [name] - Provider 名称
 * @property {string} command - 可执行文件路径
 * @property {string[]} [args] - 命令行参数
 * @property {Record<string, string>} [env] - 环境变量
 * @property {string} [cwd] - 工作目录
 * @property {number} [timeout] - 请求超时 (ms)
 * @property {boolean} [autoConnect] - 自动连接 (default: true)
 * @property {boolean} [lazyConnect] - 延迟连接，首次调用时连接 (default: false)
 * @property {boolean} [allowUnsafeCommand=false] - 显式允许执行未在 allowlist 中的命令
 * @property {boolean} [allowUnsafeCommands] - (deprecated) allowUnsafeCommand 的别名
 * @property {string[]} [allowedCommands] - 允许执行的命令白名单
 */

/**
 * Stdio MCP Provider
 *
 * 使用 stdio 与外部 MCP 服务器通信的 Provider。
 *
 * @example
 * ```javascript
 * import { McpClient } from 'js/agents/mcp';
 * import { StdioMcpProvider } from 'js/agents/mcp/stdio-mcp-provider.js';
 *
 * const provider = new StdioMcpProvider({
 *   id: 'codex',
 *   name: 'Codex MCP',
 *   command: 'codex-shell-tool-mcp',
 * });
 *
 * await provider.connect();
 *
 * const client = new McpClient();
 * client.addProvider(provider);
 *
 * const tools = await client.listAllTools();
 * const result = await client.callTool('bash', { command: 'ls -la' });
 * ```
 *
 * @extends {McpProvider}
 */
export class StdioMcpProvider extends McpProvider {
  /**
   * @param {StdioMcpProviderOptions} options
   */
  constructor(options) {
    const id = toNonEmptyString(options.id) || "stdio-mcp";
    const name = toNonEmptyString(options.name) || id;

    super({ id, name, endpoint: "stdio" });

    const command = toNonEmptyString(options.command);
    if (!command) {
      throw new Error("StdioMcpProvider: command is required");
    }

    const allowUnsafeCommand = options.allowUnsafeCommand === true || options.allowUnsafeCommands === true;
    const allowlist = new Set(
      Array.isArray(options.allowedCommands)
        ? options.allowedCommands.map((item) => toNonEmptyString(item)).filter(Boolean)
        : []
    );
    if (!allowUnsafeCommand) {
      if (allowlist.size === 0) {
        throw new Error("StdioMcpProvider: command not allowed without allowlist or allowUnsafeCommand");
      }
      if (!allowlist.has(command)) {
        throw new Error("StdioMcpProvider: command is not in allowedCommands");
      }
    }

    this.command = command;
    this.args = options.args || [];
    this.env = options.env || {};
    this.cwd = options.cwd;
    this.timeout = options.timeout ?? 30000;
    this.autoConnect = options.autoConnect !== false;
    this.lazyConnect = options.lazyConnect === true;

    /** @type {StdioMcpTransport | null} */
    this._transport = null;

    /** @type {McpToolDefinition[] | null} */
    this._toolsCache = null;

    /** @type {Promise<void> | null} */
    this._connectPromise = null;
  }

  /**
   * 建立连接
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._transport?.isConnected()) return;

    // 防止并发连接
    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = this._doConnect();
    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  /**
   * @private
   */
  async _doConnect() {
    this._transport = new StdioMcpTransport({
      command: this.command,
      args: this.args,
      env: this.env,
      cwd: this.cwd,
      timeout: this.timeout,
      autoInit: true,
    });

    await this._transport.connect();
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._transport) {
      await this._transport.disconnect();
      this._transport = null;
    }
    this._toolsCache = null;
  }

  /**
   * 确保已连接
   * @private
   */
  async _ensureConnected() {
    if (!this._transport?.isConnected()) {
      await this.connect();
    }
  }

  /**
   * 是否已连接
   * @returns {boolean}
   */
  isConnected() {
    return this._transport?.isConnected() === true;
  }

  /**
   * 获取服务器信息
   * @returns {any}
   */
  getServerInfo() {
    return this._transport?.serverInfo || null;
  }

  /**
   * 获取服务器能力
   * @returns {any}
   */
  getCapabilities() {
    return this._transport?.capabilities || null;
  }

  /**
   * 列出可用工具
   * @returns {Promise<McpToolDefinition[]>}
   */
  async listTools() {
    await this._ensureConnected();

    // 使用缓存
    if (this._toolsCache) {
      return this._toolsCache.slice();
    }

    const tools = await this._transport.listTools();

    this._toolsCache = tools.map(
      (t) =>
        new McpToolDefinition({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })
    );

    return this._toolsCache.slice();
  }

  /**
   * 调用工具
   * @param {string} toolName
   * @param {object} [args]
   * @returns {Promise<McpToolResult>}
   */
  async callTool(toolName, args = {}) {
    await this._ensureConnected();

    const name = toNonEmptyString(toolName);
    if (!name) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: "Tool name is required",
        content: [{ type: "text", text: "Error: Tool name is required" }],
      });
    }

    try {
      const result = await this._transport.callTool(name, args);

      // 标准 MCP 响应格式
      if (result?.isError) {
        return new McpToolResult({
          success: false,
          isError: true,
          error: result.content?.[0]?.text || "Tool call failed",
          content: result.content || [],
        });
      }

      return new McpToolResult({
        success: true,
        isError: false,
        content: result?.content || [],
      });
    } catch (err) {
      return new McpToolResult({
        success: false,
        isError: true,
        error: String(err?.message || err),
        content: [{ type: "text", text: `Error: ${err?.message || err}` }],
      });
    }
  }

  /**
   * 健康检查
   * @param {{ timeoutMs?: number, refreshTools?: boolean }} [options]
   * @returns {Promise<any>}
   */
  async healthCheck({ timeoutMs, refreshTools = false } = {}) {
    try {
      await this._ensureConnected();

      if (refreshTools) {
        this._toolsCache = null;
      }

      const tools = await this.listTools();

      return {
        ok: true,
        providerId: this.id,
        ts: new Date().toISOString(),
        toolCount: tools.length,
        serverInfo: this.getServerInfo(),
      };
    } catch (err) {
      return {
        ok: false,
        providerId: this.id,
        error: String(err?.message || err),
        ts: new Date().toISOString(),
      };
    }
  }

  /**
   * 刷新工具缓存
   */
  async refreshTools() {
    this._toolsCache = null;
    return this.listTools();
  }
}

/**
 * 创建 StdioMcpProvider 实例
 * @param {StdioMcpProviderOptions} options
 * @returns {StdioMcpProvider}
 */
export function createStdioMcpProvider(options) {
  return new StdioMcpProvider(options);
}

export default StdioMcpProvider;
