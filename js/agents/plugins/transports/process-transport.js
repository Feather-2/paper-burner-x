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

// @ts-ignore
import { spawn } from "node:child_process";
// @ts-ignore
import { EventEmitter } from "node:events";
// @ts-ignore
import path from "node:path";
import { protoSafeReviver } from "../../shared/utils/safe-json.js";

/** @type {typeof globalThis.process} */
const process = globalThis.process;

const MAX_MESSAGE_LENGTH = 256 * 1024; // 256KB per JSON line
const MAX_JSON_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 2000;
const MAX_STRING_LENGTH = 10000;
const MAX_METHOD_LENGTH = 200;
const MAX_ID_LENGTH = 200;
const MAX_ARG_LENGTH = 4096;
const MAX_ENV_KEY_LENGTH = 200;
const MAX_ENV_VALUE_LENGTH = 10000;
const SAFE_COMMAND_RE = /^[a-zA-Z0-9._-]+$/;
const SAFE_METHOD_RE = /^[a-zA-Z0-9_.:-]+$/;
const SAFE_ENV_KEY_RE = /^[A-Z0-9_]+$/;
const BLOCKED_ENV_KEYS = new Set(["LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]);
const ALLOWED_JSONRPC_KEYS = new Set(["jsonrpc", "id", "method", "params", "result", "error"]);

/**
 * @typedef {ReturnType<typeof setTimeout>} TimeoutHandle
 */

/**
 * @typedef {object} PendingRequest
 * @property {(value: unknown) => void} resolve - 处理成功响应
 * @property {(reason?: unknown) => void} reject - 处理失败响应
 * @property {TimeoutHandle} timer - 超时计时器
 */

function normalizeAllowlist(values) {
  if (!Array.isArray(values)) return new Set();
  const allowed = new Set();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) allowed.add(trimmed);
  }
  return allowed;
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots)) return [];
  return roots
    .filter((root) => typeof root === "string" && root.trim())
    .map((root) => path.resolve(root.trim()));
}

function isPathWithinRoots(targetPath, roots) {
  if (!roots.length) return true;
  return roots.some((root) => {
    const relative = path.relative(root, targetPath);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  });
}

function hasPathTraversal(value) {
  return value.split(/[\\/]+/).includes("..");
}

function normalizeCwd(cwd, allowedRoots) {
  if (cwd === undefined || cwd === null || cwd === "") {
    return process.cwd();
  }
  if (typeof cwd !== "string") {
    throw new Error("ProcessTransport cwd must be a string");
  }
  const trimmed = cwd.trim();
  if (!trimmed) {
    throw new Error("ProcessTransport cwd is required");
  }
  if (trimmed.includes("\u0000")) {
    throw new Error("ProcessTransport cwd contains invalid characters");
  }
  if (hasPathTraversal(trimmed)) {
    throw new Error("ProcessTransport cwd contains path traversal");
  }
  const resolved = path.resolve(trimmed);
  if (allowedRoots.length && !isPathWithinRoots(resolved, allowedRoots)) {
    throw new Error("ProcessTransport cwd not in allowlist");
  }
  return resolved;
}

function normalizeCommand(command, cwd, allowedCommands, allowedRoots) {
  if (typeof command !== "string") {
    throw new Error("ProcessTransport command must be a string");
  }
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("ProcessTransport command is required");
  }
  if (trimmed.includes("\u0000")) {
    throw new Error("ProcessTransport command contains invalid characters");
  }
  const hasSeparator = trimmed.includes("/") || trimmed.includes(path.sep);
  if (hasSeparator) {
    if (hasPathTraversal(trimmed)) {
      throw new Error("ProcessTransport command contains path traversal");
    }
    const resolved = path.resolve(cwd, trimmed);
    if (allowedRoots.length && !isPathWithinRoots(resolved, allowedRoots)) {
      throw new Error("ProcessTransport command path not in allowlist");
    }
    if (
      allowedCommands.size &&
      !allowedCommands.has(path.basename(resolved)) &&
      !allowedCommands.has(resolved)
    ) {
      throw new Error(`ProcessTransport command not allowlisted: ${path.basename(resolved)}`);
    }
    return resolved;
  }
  if (!SAFE_COMMAND_RE.test(trimmed)) {
    throw new Error("ProcessTransport command contains invalid characters");
  }
  if (allowedCommands.size && !allowedCommands.has(trimmed)) {
    throw new Error(`ProcessTransport command not allowlisted: ${trimmed}`);
  }
  return trimmed;
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error("ProcessTransport args must be strings");
    }
    if (arg.includes("\u0000") || arg.length > MAX_ARG_LENGTH) {
      throw new Error("ProcessTransport arg contains invalid characters");
    }
    return arg;
  });
}

function sanitizeEnv(overrides, allowedEnvKeys) {
  if (!overrides || typeof overrides !== "object") return { ...process.env };
  const allowlist = normalizeAllowlist(allowedEnvKeys);
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (!SAFE_ENV_KEY_RE.test(key) || key.length > MAX_ENV_KEY_LENGTH) continue;
    if (BLOCKED_ENV_KEYS.has(key) && !allowlist.has(key)) continue;
    if (allowlist.size && !allowlist.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value.length > MAX_ENV_VALUE_LENGTH || value.includes("\u0000")) continue;
    env[key] = value;
  }
  return env;
}

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
  for (const key of keys) {
    if (!ALLOWED_JSONRPC_KEYS.has(key)) {
      return { ok: false, reason: "unknown_field" };
    }
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
    if (!SAFE_METHOD_RE.test(message.method)) {
      return { ok: false, reason: "invalid_method_chars" };
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
 * @property {string[]} [allowedCommands] - 命令白名单 (命令名或绝对路径)
 * @property {string[]} [allowedCwdRoots] - 工作目录允许的根路径
 * @property {string[]} [allowedEnvKeys] - 可覆盖的环境变量键名
 */

/**
 * @typedef {object} ProcessMessage
 * @property {string} [jsonrpc] - JSON-RPC 版本
 * @property {string|number} [id] - 请求 ID
 * @property {string} [method] - 方法名
 * @property {unknown} [params] - 参数
 * @property {unknown} [result] - 结果
 * @property {{ code: number, message: string, data?: unknown }} [error] - 错误
 */

/**
 * @typedef {object} ChildProcessLike
 * @property {{ write: (chunk: string) => unknown, end: () => unknown } | null | undefined} stdin
 * @property {{ on: (event: "data", handler: (chunk: any) => unknown) => unknown } | null | undefined} stdout
 * @property {{ on: (event: "data", handler: (chunk: any) => unknown) => unknown } | null | undefined} stderr
 * @property {(event: string, handler: (...args: any[]) => unknown) => unknown} on
 * @property {(signal?: string) => unknown} kill
 * @property {boolean} killed
 */

export class ProcessTransport extends EventEmitter {
  /** @type {string} */
  cwd;
  /** @type {string} */
  command;
  /** @type {string[]} */
  args;
  /** @type {Record<string, string | undefined>} */
  env;
  /** @type {number} */
  timeout;
  /** @type {AbortSignal | null} */
  signal;
  /** @type {ChildProcessLike | null} */
  process;
  /** @type {string} */
  buffer;
  /** @type {boolean} */
  connected;
  /** @type {number} */
  _maxBufferSize;
  /** @type {number} */
  _maxMessageSize;
  /** @type {number} */
  _requestId;
  /** @type {Map<string | number, PendingRequest>} */
  _pending;

  /**
   * @param {string | symbol} event
   * @param {...any} args
   * @returns {boolean}
   */
  emit(event, ...args) {
    return super.emit(event, ...args);
  }

  /**
   * @param {ProcessTransportOptions} options - 传输配置
   */
  constructor(options) {
    super();
    const allowedCommands = normalizeAllowlist([
      ...(Array.isArray(options.allowedCommands) ? options.allowedCommands : []),
      ...(typeof process.env.PROCESS_TRANSPORT_ALLOWED_COMMANDS === "string"
        ? process.env.PROCESS_TRANSPORT_ALLOWED_COMMANDS.split(",")
        : []),
    ]);
    const allowedRoots = normalizeRoots(options.allowedCwdRoots);

    this.cwd = normalizeCwd(options.cwd, allowedRoots);
    this.command = normalizeCommand(options.command, this.cwd, allowedCommands, allowedRoots);
    this.args = normalizeArgs(options.args);
    this.env = sanitizeEnv(options.env, options.allowedEnvKeys);
    this.timeout = options.timeout || 30000;
    this.connectTimeout = Number.isFinite(Number(options.connectTimeout)) && Number(options.connectTimeout) > 0
      ? Number(options.connectTimeout)
      : Math.max(Number(this.timeout) || 0, 1000);
    this.signal = options.signal || null;

    this.process = null;
    this.buffer = "";
    this.connected = false;

    /** @type {number} 最大缓冲区大小 (防 DoS) */
    this._maxBufferSize = 1024 * 1024; // 1MB
    this._maxMessageSize = MAX_MESSAGE_LENGTH;
    this._requestId = 0;
    /** @type {Map<string|number, PendingRequest>} */
    this._pending = new Map();
    this._protocolIssues = 0;
  }

  /**
   * 启动进程并建立连接
   * @returns {Promise<void>} 连接成功时 resolve
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

      const markConnected = () => {
        if (settled || this.connected) return;
        this.connected = true;
        this.emit("transport:connected");
        settle(true);
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

        this.process.on("spawn", () => {
          markConnected();
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
          // 兼容旧行为: 首次 stdout 数据也可视作就绪
          if (!settled) markConnected();
        });

        this.process.stderr?.on("data", (chunk) => {
          this.emit("transport:stderr", chunk.toString());
        });

        // Some mocked/embedded runtimes may not emit "spawn".
        // If a pid is already available, treat process creation as connected.
        queueMicrotask(() => {
          if (!settled && this.process && typeof this.process.pid === "number") {
            markConnected();
          }
        });

        // 连接超时: 必须出现 spawn/stdout 才会视为连接成功
        connectTimer = setTimeout(() => {
          if (!settled) {
            const err = new Error(
              `ProcessTransport connect timeout after ${this.connectTimeout}ms (command: ${this.command})`
            );
            err.code = "ERR_PROCESS_TRANSPORT_CONNECT_TIMEOUT";
            settle(false, err);
          }
        }, this.connectTimeout);
      } catch (err) {
        settle(false, err);
      }
    });
  }

  /**
   * 发送消息 (fire-and-forget)
   * @param {ProcessMessage} message - JSON-RPC 消息
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
   * @param {string} method - JSON-RPC method
   * @param {unknown} params - JSON-RPC params
   * @returns {Promise<unknown>} 响应 result
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
      try {
        this.send(message);
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * 发送通知 (无响应)
   * @param {string} method - JSON-RPC method
   * @param {unknown} params - JSON-RPC params
   */
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /**
   * 处理接收缓冲区
   * @private
   */
  _processBuffer() {
    // 防止 DoS: 超过阈值时按换行边界恢复，避免半包截断导致持续解析失败
    if (this.buffer.length > this._maxBufferSize) {
      const originalSize = this.buffer.length;
      const tail = this.buffer.slice(-this._maxBufferSize);
      const firstNewline = tail.indexOf("\n");
      const recovered = firstNewline >= 0 ? tail.slice(firstNewline + 1) : "";
      const dropped = originalSize - recovered.length;
      this.buffer = recovered;
      this._protocolIssues += 1;
      this.emit("transport:buffer_overflow", {
        size: originalSize,
        limit: this._maxBufferSize,
        dropped,
        strategy: firstNewline >= 0 ? "trim_to_first_newline" : "drop_all",
      });
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
        const message = JSON.parse(trimmed, protoSafeReviver);
        const validation = validateJsonRpcMessage(message);
        if (!validation.ok) {
          this._protocolIssues += 1;
          this.emit("transport:invalid_message", { reason: validation.reason });
          continue;
        }
        this._handleMessage(validation.message);
      } catch (err) {
        this._protocolIssues += 1;
        this.emit("transport:parse_error", { line: trimmed, error: err });
      }
    }
  }

  /**
   * 处理收到的消息
   * @param {ProcessMessage} message - 已校验的 JSON-RPC 消息
   * @private
   */
  _handleMessage(message) {
    // 响应消息 (有 id)
    if (message.id !== undefined) {
      if (this._pending.has(message.id)) {
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

      if (message.result !== undefined || message.error !== undefined) {
        this.emit("transport:orphan_response", {
          id: message.id,
          pending: this._pending.size,
          message,
        });
      }
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
   * @param {Error} error - 拒绝原因
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
    } catch (err) {
      this.emit("transport:error", err);
    }

    this.process = null;
    this.emit("transport:disconnected");
  }

  /**
   * 是否已连接
   * @returns {boolean} 当前连接状态
   */
  isConnected() {
    return this.connected && this.process !== null && !this.process.killed;
  }
}

/**
 * 创建 ProcessTransport 实例
 * @param {ProcessTransportOptions} options - 传输配置
 * @returns {ProcessTransport} ProcessTransport 实例
 */
export function createProcessTransport(options) {
  return new ProcessTransport(options);
}

export default ProcessTransport;
