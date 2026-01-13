/**
 * ProcessTransport - Node.js 进程通信
 *
 * 通过 stdio 与外部二进制通信 (Codex CLI, Playwright, etc.)
 * 支持 JSONL 双向消息流。
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

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
      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.cwd,
          env: this.env,
          stdio: ["pipe", "pipe", "pipe"],
          signal: this.signal,
        });

        this.process.on("error", (err) => {
          this.connected = false;
          this.emit("error", err);
          reject(err);
        });

        this.process.on("exit", (code, signal) => {
          this.connected = false;
          this._rejectAllPending(new Error(`Process exited: code=${code}, signal=${signal}`));
          this.emit("exit", { code, signal });
        });

        this.process.stdout?.on("data", (chunk) => {
          this.buffer += chunk.toString();
          this._processBuffer();
        });

        this.process.stderr?.on("data", (chunk) => {
          this.emit("stderr", chunk.toString());
        });

        // 给进程一点启动时间
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.connected = true;
            this.emit("connected");
            resolve();
          }
        }, 50);
      } catch (err) {
        reject(err);
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
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this._handleMessage(message);
      } catch (err) {
        this.emit("parse_error", { line: trimmed, error: err });
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
    this.emit("message", message);

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
    this.emit("disconnected");
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
