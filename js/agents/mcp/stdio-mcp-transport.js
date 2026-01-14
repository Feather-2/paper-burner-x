/**
 * StdioMcpTransport - Stdio 传输层实现
 *
 * 通过 stdio 与外部 MCP 服务器通信。
 * 包装 ProcessTransport，添加 MCP 协议层支持。
 *
 * @module mcp/stdio-mcp-transport
 */

import { McpTransport, MCP_PROTOCOL_VERSION, McpMethods } from "./mcp-transport.js";

/**
 * @typedef {object} StdioMcpTransportOptions
 * @property {string} command - 可执行文件路径
 * @property {string[]} [args] - 命令行参数
 * @property {Record<string, string>} [env] - 环境变量
 * @property {string} [cwd] - 工作目录
 * @property {number} [timeout] - 请求超时 (ms)
 * @property {AbortSignal} [signal] - 取消信号
 * @property {boolean} [autoInit] - 自动初始化 MCP 协议 (default: true)
 * @property {string} [clientName] - 客户端名称
 * @property {string} [clientVersion] - 客户端版本
 */

/**
 * Stdio MCP Transport
 *
 * 使用 Node.js child_process 与外部 MCP 服务器通信。
 *
 * @example
 * ```javascript
 * const transport = new StdioMcpTransport({
 *   command: 'npx',
 *   args: ['-y', '@anthropic-ai/claude-code-mcp'],
 * });
 *
 * await transport.connect();
 *
 * const tools = await transport.request('tools/list', {});
 * console.log('Available tools:', tools);
 *
 * const result = await transport.request('tools/call', {
 *   name: 'read_file',
 *   arguments: { path: '/path/to/file.txt' },
 * });
 *
 * await transport.disconnect();
 * ```
 *
 * @extends {McpTransport}
 */
export class StdioMcpTransport extends McpTransport {
  /**
   * @param {StdioMcpTransportOptions} options
   */
  constructor(options) {
    super({
      timeout: options.timeout ?? 30000,
    });

    this.command = options.command;
    this.args = options.args || [];
    this.env = options.env || {};
    const defaultCwd =
      typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
    this.cwd = options.cwd || defaultCwd;
    this.signal = options.signal || null;
    this.autoInit = options.autoInit !== false;
    this.clientName = options.clientName || "js-agents";
    this.clientVersion = options.clientVersion || "1.0.0";

    /** @type {import("../runtime/transports/process-transport.js").ProcessTransport | null} */
    this._process = null;

    /** @type {null | typeof import("../runtime/transports/process-transport.js")} */
    this._processTransportModule = null;

    /** @type {any} */
    this.serverInfo = null;

    /** @type {any} */
    this.capabilities = null;
  }

  /**
   * 建立连接并初始化 MCP 协议
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) return;

    const ProcessTransport = await this._getProcessTransport();

    // 创建 ProcessTransport
    this._process = new ProcessTransport({
      command: this.command,
      args: this.args,
      env: this.env,
      cwd: this.cwd,
      timeout: this.timeout,
      signal: this.signal,
    });

    // 监听消息
    this._process.on("message", (msg) => this._handleMessage(msg));
    this._process.on("error", (err) => this.emit("error", err));
    this._process.on("exit", ({ code, signal }) => {
      this._connected = false;
      this._rejectAllPending(new Error(`Process exited: code=${code}, signal=${signal}`));
      this.emit("disconnect", { code, signal });
    });
    this._process.on("stderr", (text) => this.emit("stderr", text));

    // 启动进程
    await this._process.connect();
    this._connected = true;

    // 自动初始化 MCP 协议
    if (this.autoInit) {
      await this._initialize();
    }

    this.emit("connect");
  }

  async _getProcessTransport() {
    if (!this._processTransportModule) {
      this._processTransportModule = await import("../runtime/transports/process-transport.js");
    }
    return this._processTransportModule.ProcessTransport;
  }

  /**
   * MCP 协议初始化握手
   * @private
   */
  async _initialize() {
    const result = await this.request(McpMethods.INITIALIZE, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: this.clientName,
        version: this.clientVersion,
      },
    });

    this.serverInfo = result?.serverInfo || null;
    this.capabilities = result?.capabilities || {};

    // 发送 initialized 通知
    await this.notify(McpMethods.INITIALIZED, {});
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._process) return;

    this._rejectAllPending(new Error("Transport disconnected"));
    this._connected = false;

    this._process.disconnect();
    this._process = null;

    this.emit("disconnect");
  }

  /**
   * 发送消息
   * @param {import('./mcp-transport.js').McpMessage} message
   * @returns {Promise<void>}
   */
  async send(message) {
    if (!this._process || !this._connected) {
      throw new Error("Transport not connected");
    }
    this._process.send(message);
  }

  /**
   * 是否已连接
   * @returns {boolean}
   */
  isConnected() {
    return this._connected && this._process?.isConnected() === true;
  }

  /**
   * 列出可用工具
   * @returns {Promise<any[]>}
   */
  async listTools() {
    const result = await this.request(McpMethods.TOOLS_LIST, {});
    return result?.tools || [];
  }

  /**
   * 调用工具
   * @param {string} name - 工具名
   * @param {any} [args] - 工具参数
   * @returns {Promise<any>}
   */
  async callTool(name, args = {}) {
    return this.request(McpMethods.TOOLS_CALL, {
      name,
      arguments: args,
    });
  }

  /**
   * 列出资源
   * @returns {Promise<any[]>}
   */
  async listResources() {
    const result = await this.request(McpMethods.RESOURCES_LIST, {});
    return result?.resources || [];
  }

  /**
   * 读取资源
   * @param {string} uri - 资源 URI
   * @returns {Promise<any>}
   */
  async readResource(uri) {
    return this.request(McpMethods.RESOURCES_READ, { uri });
  }

  /**
   * 列出提示词
   * @returns {Promise<any[]>}
   */
  async listPrompts() {
    const result = await this.request(McpMethods.PROMPTS_LIST, {});
    return result?.prompts || [];
  }

  /**
   * 获取提示词
   * @param {string} name - 提示词名
   * @param {any} [args] - 参数
   * @returns {Promise<any>}
   */
  async getPrompt(name, args = {}) {
    return this.request(McpMethods.PROMPTS_GET, { name, arguments: args });
  }
}

/**
 * 创建 StdioMcpTransport 实例
 * @param {StdioMcpTransportOptions} options
 * @returns {StdioMcpTransport}
 */
export function createStdioMcpTransport(options) {
  return new StdioMcpTransport(options);
}

export default StdioMcpTransport;
