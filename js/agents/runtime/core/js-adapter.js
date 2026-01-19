/**
 * JS Runtime Adapter
 *
 * 原有的 JS 执行逻辑封装。
 *
 * 安全策略（按优先级）：
 *   1. Worker 隔离执行（best-effort；不是强安全边界）
 *   2. 主线程 fallback（已禁用，避免主线程动态代码执行）
 *
 */

import { RuntimeAdapter, RuntimeType } from './runtime-adapter.js';
import { createLogger } from "../../shared/index.js";

/**
 * @typedef {import('./runtime-adapter.js').ExecutionContext} ExecutionContext
 * @typedef {import('./runtime-adapter.js').ExecutionResult} ExecutionResult
 *
 * @typedef {object} JSRuntimeAdapterOptions
 * @property {string} [id]
 * @property {boolean} [skipValidation]
 * @property {boolean} [useWorkerSandbox]
 * @property {'allow'|'trustedOnly'|'deny'} [mainThreadFallback] - policy when Worker is unavailable
 * @property {number} [timeout]
 *
 * @typedef {{ valid: boolean, reason?: string }} CodeValidationResult
 */

const logger = createLogger("runtime/core/js-adapter");

// 危险模式检测（基础防护，fallback 时使用）
/** @type {RegExp[]} */
const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /__proto__/,
  /\bconstructor\s*\[/,
  /\bconstructor\s*\.\s*constructor\b/,
];

/**
 * @param {string} code
 * @returns {CodeValidationResult}
 */
function validateCode(code) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }
  return { valid: true };
}

function normalizeMainThreadFallbackPolicy(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const v = raw.toLowerCase();
  if (v === "allow") return "allow";
  if (v === "deny" || v === "off" || v === "none") return "deny";
  if (v === "trustedonly" || v === "trusted_only" || v === "trusted") return "trustedOnly";
  return "trustedOnly";
}

// Minimal safe globals exposed to sandboxed code in main-thread fallback (best-effort).
/** @type {Set<string>} */
const SANDBOX_ALLOWED_GLOBALS = new Set([
  'Array', 'ArrayBuffer', 'Boolean', 'DataView', 'Date', 'Error',
  'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'JSON', 'Map', 'Math', 'Number', 'Object', 'Promise', 'Proxy',
  'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'TypeError',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Uint8ClampedArray',
  'WeakMap', 'WeakSet', 'console', 'isNaN', 'isFinite', 'parseFloat', 'parseInt',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
  'undefined', 'NaN', 'Infinity'
]);

/** @type {Set<string>} */
const SANDBOX_BLOCKED_GLOBALS = new Set([
  // Dynamic code execution
  "eval",
  "Function",
  "AsyncFunction",
  "GeneratorFunction",

  // Module/require
  "require",
  "module",
  "exports",

  // Network / IO
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "importScripts",

  // Escape hatches
  "postMessage",
  "onmessage",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "close",

  // Prototype / constructor escape patterns
  "__proto__",
  "prototype",
  "constructor",
]);

/**
 * @param {Record<string, any>} base
 * @param {{ blockedAccesses?: Set<string> } | null | undefined} audit
 */
function createSandboxProxy(base, audit) {
  const target = Object.create(null);

  /** @type {any} */
  const proxy = new Proxy(target, {
    has() {
      return true;
    },
    get(t, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (typeof prop !== "string") return undefined;

      // Provide a sandboxed "global" reference (does not expose the host globalThis).
      if (prop === "globalThis" || prop === "self") return proxy;

      if (SANDBOX_BLOCKED_GLOBALS.has(prop)) {
        if (audit?.blockedAccesses && audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return undefined;
      }

      if (Object.prototype.hasOwnProperty.call(t, prop)) return t[prop];
      if (Object.prototype.hasOwnProperty.call(base, prop)) return base[prop];
      return undefined;
    },
    set(t, prop, value) {
      if (typeof prop !== "string") return false;
      if (SANDBOX_BLOCKED_GLOBALS.has(prop)) {
        if (audit?.blockedAccesses && audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return true;
      }
      t[prop] = value;
      return true;
    },
    defineProperty(t, prop, descriptor) {
      if (typeof prop !== "string") return false;
      if (SANDBOX_BLOCKED_GLOBALS.has(prop)) {
        if (audit?.blockedAccesses && audit.blockedAccesses.size < 32) audit.blockedAccesses.add(prop);
        return false;
      }
      return Reflect.defineProperty(t, prop, descriptor);
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });

  return proxy;
}

export class JSRuntimeAdapter extends RuntimeAdapter {
  /**
   * @param {JSRuntimeAdapterOptions} [options]
   */
  constructor(options = {}) {
    super({ ...options, type: RuntimeType.JS });
    this.skipValidation = options.skipValidation || false;
    this.useWorkerSandbox = options.useWorkerSandbox !== false; // 默认启用
    this.mainThreadFallback = normalizeMainThreadFallbackPolicy(options.mainThreadFallback);
    this.timeout = options.timeout || 30000;
    /** @type {Worker | null} */
    this._worker = null;
    /** @type {Map<number, { resolve: (result: ExecutionResult) => void }>} */
    this._pendingRequests = new Map();
    this._requestId = 0;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (!this.useWorkerSandbox) return true;
    if (this._worker) return true;

    try {
      const workerUrl = new URL('./js-sandbox-worker.js', import.meta.url);
      this._worker = new Worker(workerUrl, { type: 'module' });

      this._worker.onmessage = (evt) => {
        const { type, id, success, data, error, metrics, name, payload, level, args, event } = evt.data;

        if (type === 'emit') {
          // 转发 emit 事件
          logger.debug(`[JSSandbox] emit: ${name}`, payload);
          return;
        }

        if (type === 'audit') {
          logger.debug(`[JSSandbox] audit: ${event}`, payload);
          return;
        }

        if (type === 'log') {
          logger[level]?.(`[JSSandbox]`, ...args);
          return;
        }

        if (type === 'result') {
          const request = this._pendingRequests.get(id);
          if (request) {
            this._pendingRequests.delete(id);
            request.resolve({ success, data, error, metrics });
          }
        }
      };

      this._worker.onerror = (err) => {
        logger.error("[JSSandbox] Worker error:", { error: err?.message || String(err) });
      };

      return true;
    } catch (err) {
      logger.warn("[JSRuntimeAdapter] Worker sandbox unavailable, using fallback:", { error: err?.message });
      this.useWorkerSandbox = false;
      return true;
    }
  }

  /**
   * @param {string} code
   * @param {ExecutionContext | null | undefined} context
   * @returns {Promise<ExecutionResult>}
   */
  async execute(code, context) {
    await this.initialize();

    // 优先使用 Worker 沙箱
    if (this.useWorkerSandbox && this._worker) {
      return this._executeInWorker(code, context);
    }

    // Fallback: 主线程执行（需安全检查）
    return this._executeInMainThread(code, context);
  }

  /**
   * @param {string} code
   * @param {ExecutionContext | null | undefined} context
   * @returns {Promise<ExecutionResult>}
   */
  async _executeInWorker(code, context) {
    const signal = context?.signal;
    if (signal?.aborted) {
      return { success: false, error: "Aborted", metrics: { duration: 0, aborted: true } };
    }

    const id = ++this._requestId;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result);
      };

      const cleanup = () => {
        this._pendingRequests.delete(id);
        signal?.removeEventListener?.("abort", onAbort);
      };

      const onAbort = () => {
        cleanup();
        // Best-effort: stop execution by terminating the worker (cannot cancel sync JS otherwise).
        try {
          this._worker?.terminate?.();
        } catch {
          // ignore
        }
        this._worker = null;
        try {
          context?.emit?.("runtime.worker_aborted", { runtime: "js" });
        } catch {
          // ignore
        }
        finish({ success: false, error: "Aborted", metrics: { duration: Date.now() - startTime, aborted: true } });
      };

      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeoutId = setTimeout(() => {
        cleanup();
        // If the worker is stuck (e.g. sync infinite loop), terminate it to avoid a wedged sandbox.
        try {
          this._worker?.terminate?.();
        } catch {
          // ignore
        }
        this._worker = null;
        try {
          context?.emit?.("runtime.worker_timeout", { runtime: "js", timeoutMs: this.timeout });
        } catch {
          // ignore
        }
        finish({
          success: false,
          error: 'Worker execution timeout',
          metrics: { duration: this.timeout, timedOut: true }
        });
      }, this.timeout + 1000); // 额外 1s 给 Worker 内部超时

      this._pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          cleanup();
          finish(result);
        }
      });

      try {
        this._worker.postMessage({
          type: 'execute',
          id,
          code,
          state: context?.state,
          timeout: this.timeout
        });
      } catch (err) {
        clearTimeout(timeoutId);
        cleanup();
        finish({ success: false, error: err?.message || String(err), metrics: { duration: Date.now() - startTime } });
      }
    });
  }

  /**
   * @param {string} code
   * @param {ExecutionContext | null | undefined} context
   * @returns {Promise<ExecutionResult>}
   */
  async _executeInMainThread(code, context) {
    const startTime = Date.now();
    const signal = context?.signal;

    if (signal?.aborted) {
      return { success: false, error: "Aborted", metrics: { duration: 0, aborted: true } };
    }

    const trusted = context?.trusted === true;
    if (!trusted || this.mainThreadFallback === "deny") {
      try {
        context?.emit?.("runtime.fallback_blocked", {
          runtime: "js",
          mode: "main_thread",
          policy: this.mainThreadFallback,
        });
      } catch {
        // ignore
      }
      return {
        success: false,
        error: `Main-thread fallback blocked (policy=${this.mainThreadFallback}; trusted=${String(trusted)})`,
        metrics: { duration: Date.now() - startTime, blocked: true },
      };
    }

    try {
      context?.emit?.("runtime.fallback_blocked", {
        runtime: "js",
        mode: "main_thread",
        policy: this.mainThreadFallback,
        trusted,
        reason: "disabled",
      });
    } catch {
      // ignore
    }

    return {
      success: false,
      error: "Main-thread fallback disabled; worker sandbox required",
      metrics: { duration: Date.now() - startTime, blocked: true },
    };
  }

  /**
   * @returns {Promise<void>}
   */
  async terminate() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    this._pendingRequests.clear();
  }
}
