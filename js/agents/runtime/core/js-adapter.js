/**
 * JS Runtime Adapter
 *
 * 原有的 JS 执行逻辑封装。
 *
 * 安全策略（按优先级）：
 *   1. Worker 隔离执行（best-effort；不是强安全边界）
 *   2. 主线程 fallback（仅用于 trusted 执行；默认拒绝不可信代码）
 *
 * TODO(AI4Sci): 添加 quickjs-emscripten WASM 沙箱作为第三层
 */

import { RuntimeAdapter, RuntimeType } from './runtime-adapter.js';
import { createLogger } from "../../shared/utils/logger.js";

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
        const { type, id, success, data, error, metrics, name, payload, level, args } = evt.data;

        if (type === 'emit') {
          // 转发 emit 事件
          logger.debug(`[JSSandbox] emit: ${name}`, payload);
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
    if (this.mainThreadFallback === "deny" || (this.mainThreadFallback !== "allow" && !trusted)) {
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
      context?.emit?.("runtime.fallback_used", {
        runtime: "js",
        mode: "main_thread",
        policy: this.mainThreadFallback,
        trusted,
      });
    } catch {
      // ignore
    }

    // 安全检查
    if (!this.skipValidation) {
      const validation = validateCode(code);
      if (!validation.valid) {
        return {
          success: false,
          error: `Security: ${validation.reason}`,
          metrics: { duration: Date.now() - startTime }
        };
      }
    }

    try {
      const fn = new Function('context', `
        "use strict";
        const { state, vfs, emit } = context || {};
        const globalThis = undefined;
        const window = undefined;
        const document = undefined;
        const self = undefined;
        const fetch = undefined;
        const XMLHttpRequest = undefined;
        const WebSocket = undefined;
        const importScripts = undefined;
        const Function = undefined;
        return (async () => {
          ${code}
        })();
      `);

      let timeoutId = null;
      const execPromise = fn(context);
      const timeoutPromise =
        this.timeout > 0
          ? new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error("Execution timeout")), this.timeout);
            })
          : null;

      let result;
      try {
        result = timeoutPromise ? await Promise.race([execPromise, timeoutPromise]) : await execPromise;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      return {
        success: true,
        data: result,
        metrics: { duration: Date.now() - startTime }
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        metrics: { duration: Date.now() - startTime }
      };
    }
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
