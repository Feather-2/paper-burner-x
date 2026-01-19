/**
 * ProcessTransport - Node.js 进程通信
 *
 * 通过 stdio 与外部二进制通信 (Codex CLI, Playwright, etc.)
 * 支持 JSONL 双向消息流。
 *
 * @module
 * @platform node - This module requires Node.js; do not import in browser bundles.
 * Use conditional imports or package.json exports to prevent browser inclusion.
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

const MAX_MESSAGE_LENGTH = 256 * 1024; // 256KB per JSON line
const MAX_JSON_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 2000;
const MAX_STRING_LENGTH = 10000;
const MAX_METHOD_LENGTH = 200;
const MAX_ID_LENGTH = 200;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidJsonValue(value, depth = 0) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length <= MAX_STRING_LENGTH;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (depth >= MAX_JSON_DEPTH) return false;
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ENTRIES) return false;
    for (const entry of value) {
      if (!isValidJsonValue(entry, depth + 1)) return false;
    }
    return true;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_COLLECTION_ENTRIES) return false;
    for (const [key, entry] of entries) {
      if (typeof key !== "string" || key.length > MAX_STRING_LENGTH) return false;
      if (!isValidJsonValue(entry, depth + 1)) return false;
    }
    return true;
  }
  return false;
}

function sanitizeJsonRpcMessage(message) {
  const sanitized = {};
  if (message.jsonrpc !== undefined) sanitized.jsonrpc = message.jsonrpc;
  if (message.id !== undefined) sanitized.id = message.id;
  if (message.method !== undefined) sanitized.method = message.method;
  if (message.params !== undefined) sanitized.params = message.params;
  if (message.result !== undefined) sanitized.result = message.result;
  if (message.error !== undefined) {
    const error = {};
    if (message.error.code !== undefined) error.code = message.error.code;
    if (message.error.message !== undefined) error.message = message.error.message;
    if (message.error.data !== undefined) error.data = message.error.data;
    sanitized.error = error;
  }
  return sanitized;
}

function validateJsonRpcMessage(message) {
  if (!isPlainObject(message)) return { ok: false, reason: "not_object" };
  const keys = Object.keys(message);
  if (keys.length === 0 || keys.length > MAX_COLLECTION_ENTRIES) {
    return { ok: false, reason: "invalid_keys" };
  }
  if (message.jsonrpc !== undefined && message.jsonrpc !== "2.0") {
    return { ok: false, reason: "invalid_jsonrpc" };
  }
  if (message.id !== undefined) {
    if (typeof message.id !== "string" && typeof message.id !== "number") {
      return { ok: false, reason: "invalid_id" };
    }
    if (typeof message.id === "string" && message.id.length > MAX_ID_LENGTH) {
      return { ok: false, reason: "id_too_long" };
    }
  }
  if (message.method !== undefined) {
    if (typeof message.method !== "string" || !message.method.trim()) {
      return { ok: false, reason: "invalid_method" };
    }
    if (message.method.length > MAX_METHOD_LENGTH) {
      return { ok: false, reason: "method_too_long" };
    }
  }
  if (message.error !== undefined) {
    if (!isPlainObject(message.error)) {
      return { ok: false, reason: "invalid_error" };
    }
    if (!Number.isFinite(message.error.code)) {
      return { ok: false, reason: "invalid_error_code" };
    }
    if (typeof message.error.message !== "string" || !message.error.message.trim()) {
      return { ok: false, reason: "invalid_error_message" };
    }
    if (message.error.message.length > MAX_STRING_LENGTH) {
      return { ok: false, reason: "error_message_too_long" };
    }
    if (message.error.data !== undefined && !isValidJsonValue(message.error.data, 0)) {
      return { ok: false, reason: "invalid_error_data" };
    }
  }
  if (message.params !== undefined && !isValidJsonValue(message.params, 0)) {
    return { ok: false, reason: "invalid_params" };
  }
  if (message.result !== undefined && !isValidJsonValue(message.result, 0)) {
    return { ok: false, reason: "invalid_result" };
  }
  if (
    message.method === undefined &&
    message.id === undefined &&
    message.result === undefined &&
    message.error === undefined
  ) {
    return { ok: false, reason: "missing_fields" };
  }
  return { ok: true, message: sanitizeJsonRpcMessage(message) };
}

/**
 * @typedef {object} ProcessTransportOptions
 * @property {string} command - 可执行文件路径
 * @property {string[]} [args] - 命令行参数
 * @property {Record<string, string>} [env] - 环境变量
 * @property {string} [cwd] - 工作目录
 * @property {number} [timeout] - 超时 (ms)
 * @property {AbortSignal} [signal] - 取消信号
 */

/**
 * @typedef {object} ProcessMessage
 * @property {string} [jsonrpc] - JSON-RPC 版本
 * @property {string|number} [id] - 请求 ID
 * @property {string} [method] - 方法名
 * @property {any} [params] - 参数
 * @property {any} [result] - 结果
 * @property {{ code: number, message: string }} [error] - 错误
 */

export class ProcessTransport extends EventEmitter {
  /**
   * @param {ProcessTransportOptions} options
   */
  constructor(options) {
    super();
    this.command = options.command;
    this.args = options.args || [];
    this.env = { ...process.env, ...options.env };
    this.cwd = options.cwd || process.cwd();
    this.timeout = options.timeout || 30000;
    this.signal = options.signal || null;

    /** @type {import("node:child_process").ChildProcess | null} */
    this.process = null;
    this.buffer = "";
    this.connected = false;

    /** @type {number} 最大缓冲区大小 (防 DoS) */
    this._maxBufferSize = 1024 * 1024; // 1MB
    this._maxMessageSize = MAX_MESSAGE_LENGTH;
    this._requestId = 0;
    /** @type {Map<string|number, { resolve: Function, reject: Function, timer: any }>} */
    this._pending = new Map();
  }

  /**
   * 启动进程并建立连接
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      let settled = false;
      let connectTimer = null;

      const cleanup = () => {
        if (connectTimer) clearTimeout(connectTimer);
      };

      const settle = (success, error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (success) resolve();
        else reject(error);
      };

      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.cwd,
          env: this.env,
          stdio: ["pipe", "pipe", "pipe"],
          signal: this.signal,
        });

        this.process.on("error", (err) => {
          this.connected = false;
          this.emit("transport:error", err);
          settle(false, err);
        });

        this.process.on("exit", (code, signal) => {
          this.connected = false;
          this._rejectAllPending(new Error(`Process exited: code=${code}, signal=${signal}`));
          this.emit("transport:exit", { code, signal });
          // 如果进程在 connect 期间退出，拒绝 Promise
          settle(false, new Error(`Process exited during connect: code=${code}, signal=${signal}`));
        });

        this.process.stdout?.on("data", (chunk) => {
          this.buffer += chunk.toString();
          this._processBuffer();
          // 首次收到有效数据即视为就绪
          if (!settled && !this.connected) {
            this.connected = true;
            this.emit("transport:connected");
            settle(true);
          }
        });

        this.process.stderr?.on("data", (chunk) => {
          this.emit("transport:stderr", chunk.toString());
        });

        // 超时保底: 若 spawn 成功且未退出，也视为连接就绪
        connectTimer = setTimeout(() => {
          if (!settled && this.process && !this.process.killed) {
            this.connected = true;
            this.emit("transport:connected");
            settle(true);
          }
        }, 100);
      } catch (err) {
        settle(false, err);
      }
    });
  }

  /**
   * 发送消息 (fire-and-forget)
   * @param {ProcessMessage} message
   */
  send(message) {
    if (!this.connected || !this.process?.stdin) {
      throw new Error("ProcessTransport not connected");
    }
    const line = JSON.stringify(message) + "\n";
    this.process.stdin.write(line);
  }

  /**
   * 发送请求并等待响应
   * @param {string} method
   * @param {any} params
   * @returns {Promise<any>}
   */
  async request(method, params) {
    const id = ++this._requestId;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this._pending.set(id, { resolve, reject, timer });
      this.send(message);
    });
  }

  /**
   * 发送通知 (无响应)
   * @param {string} method
   * @param {any} params
   */
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /**
   * 处理接收缓冲区
   * @private
   */
  _processBuffer() {
    // 防止 DoS: 超过阈值时截断并告警
    if (this.buffer.length > this._maxBufferSize) {
      this.emit("transport:buffer_overflow", {
        size: this.buffer.length,
        limit: this._maxBufferSize,
      });
      this.buffer = this.buffer.slice(-this._maxBufferSize / 2);
    }

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.length > this._maxMessageSize) {
        this.emit("transport:message_too_large", {
          size: trimmed.length,
          limit: this._maxMessageSize,
        });
        continue;
      }

      try {
        const message = JSON.parse(trimmed);
        const validation = validateJsonRpcMessage(message);
        if (!validation.ok) {
          this.emit("transport:invalid_message", { reason: validation.reason });
          continue;
        }
        this._handleMessage(validation.message);
      } catch (err) {
        this.emit("transport:parse_error", { line: trimmed, error: err });
      }
    }
  }

  /**
   * 处理收到的消息
   * @param {ProcessMessage} message
   * @private
   */
  _handleMessage(message) {
    // 响应消息 (有 id)
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

    // 通知/事件消息
    this.emit("transport:message", message);

    // 按 method 分发事件
    if (message.method) {
      this.emit(`method:${message.method}`, message.params);
    }
  }

  /**
   * 拒绝所有挂起的请求
   * @param {Error} error
   * @private
   */
  _rejectAllPending(error) {
    for (const [id, { reject, timer }] of this._pending) {
      clearTimeout(timer);
      reject(error);
    }
    this._pending.clear();
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (!this.process) return;

    this._rejectAllPending(new Error("Transport disconnected"));
    this.connected = false;

    try {
      this.process.stdin?.end();
      this.process.kill("SIGTERM");
    } catch {
      // ignore
    }

    this.process = null;
    this.emit("transport:disconnected");
  }

  /**
   * 是否已连接
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && this.process !== null && !this.process.killed;
  }
}

/**
 * 创建 ProcessTransport 实例
 * @param {ProcessTransportOptions} options
 * @returns {ProcessTransport}
 */
export function createProcessTransport(options) {
  return new ProcessTransport(options);
}

export default ProcessTransport;
