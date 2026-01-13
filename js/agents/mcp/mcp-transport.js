/**
 * MCP Transport - 传输层抽象接口
 *
 * 定义统一的传输层接口，支持多种通信方式：
 * - stdio: 子进程 stdin/stdout (StdioMcpTransport)
 * - http: HTTP REST API
 * - sse: Server-Sent Events
 * - websocket: WebSocket 双向通信
 *
 * @module mcp/mcp-transport
 */

import { EventEmitter } from "../shared/utils/event-emitter.js";

/**
 * @typedef {object} McpMessage
 * @property {'2.0'} jsonrpc - JSON-RPC 版本
 * @property {string|number} [id] - 请求 ID (响应必须有)
 * @property {string} [method] - 方法名
 * @property {any} [params] - 参数
 * @property {any} [result] - 结果
 * @property {{ code: number, message: string, data?: any }} [error] - 错误
 */

/**
 * @typedef {object} McpTransportOptions
 * @property {number} [timeout] - 请求超时 (ms)
 * @property {number} [heartbeatInterval] - 心跳间隔 (ms)
 * @property {number} [maxRetries] - 最大重试次数
 * @property {number} [reconnectDelayBase] - 重连延迟基数 (ms)
 */

/**
 * MCP Transport 接口
 *
 * 所有传输实现都必须继承此类并实现抽象方法。
 *
 * Events:
 * - 'connect': 连接建立
 * - 'disconnect': 连接断开
 * - 'message': 收到消息
 * - 'error': 发生错误
 * - 'notification:{method}': 收到特定通知
 *
 * @extends {EventEmitter}
 */
export class McpTransport extends EventEmitter {
  /**
   * @param {McpTransportOptions} [options]
   */
  constructor(options = {}) {
    super();
    this.timeout = options.timeout ?? 30000;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.maxRetries = options.maxRetries ?? 3;
    this.reconnectDelayBase = options.reconnectDelayBase ?? 1000;
    this._messageId = 0;
    this._pending = new Map();
    this._connected = false;
  }

  /**
   * 建立连接
   * @returns {Promise<void>}
   * @abstract
   */
  async connect() {
    throw new Error("McpTransport.connect() not implemented");
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   * @abstract
   */
  async disconnect() {
    throw new Error("McpTransport.disconnect() not implemented");
  }

  /**
   * 发送消息 (fire-and-forget)
   * @param {McpMessage} message
   * @returns {Promise<void>}
   * @abstract
   */
  async send(message) {
    throw new Error("McpTransport.send() not implemented");
  }

  /**
   * 是否已连接
   * @returns {boolean}
   */
  isConnected() {
    return this._connected;
  }

  /**
   * 发送请求并等待响应
   * @param {string} method
   * @param {any} [params]
   * @returns {Promise<any>}
   */
  async request(method, params) {
    if (!this.isConnected()) {
      throw new Error("Transport not connected");
    }

    const id = ++this._messageId;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this._pending.set(id, { resolve, reject, timer });

      this.send(message).catch((err) => {
        this._pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * 发送通知 (无响应)
   * @param {string} method
   * @param {any} [params]
   * @returns {Promise<void>}
   */
  async notify(method, params) {
    return this.send({ jsonrpc: "2.0", method, params });
  }

  /**
   * 处理收到的消息
   * @param {McpMessage} message
   * @protected
   */
  _handleMessage(message) {
    // 响应消息 (有 id 且在 pending 中)
    if (message.id !== undefined && this._pending.has(message.id)) {
      const { resolve, reject, timer } = this._pending.get(message.id);
      this._pending.delete(message.id);
      clearTimeout(timer);

      if (message.error) {
        reject(new Error(message.error.message || "Unknown error"));
      } else {
        resolve(message.result);
      }
      return;
    }

    // 通用消息事件
    this.emit("message", message);

    // 按 method 分发通知事件
    if (message.method) {
      this.emit(`notification:${message.method}`, message.params);
    }
  }

  /**
   * 拒绝所有挂起的请求
   * @param {Error} error
   * @protected
   */
  _rejectAllPending(error) {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(error);
    }
    this._pending.clear();
  }
}

/**
 * MCP 协议常量
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SUPPORTED_VERSIONS = ["2024-11-05", "2024-10-07"];

/**
 * MCP 标准方法名
 */
export const McpMethods = {
  // 生命周期
  INITIALIZE: "initialize",
  INITIALIZED: "notifications/initialized",
  SHUTDOWN: "shutdown",

  // 工具
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",

  // 资源
  RESOURCES_LIST: "resources/list",
  RESOURCES_READ: "resources/read",

  // 提示词
  PROMPTS_LIST: "prompts/list",
  PROMPTS_GET: "prompts/get",

  // 采样
  SAMPLING_CREATE_MESSAGE: "sampling/createMessage",

  // 心跳
  PING: "ping",
};

export default McpTransport;
