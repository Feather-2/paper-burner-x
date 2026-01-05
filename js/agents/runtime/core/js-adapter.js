/**
 * JS Runtime Adapter
 *
 * 原有的 JS 执行逻辑封装。
 *
 * 安全策略（按优先级）：
 *   1. Worker 沙箱（隔离 + 受限 globals）
 *   2. 主线程 + 危险模式检测（fallback）
 *
 * TODO(AI4Sci): 添加 quickjs-emscripten WASM 沙箱作为第三层
 */

import { RuntimeAdapter, RuntimeType } from './runtime-adapter.js';
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/core/js-adapter");

// 危险模式检测（基础防护，fallback 时使用）
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

function validateCode(code) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return { valid: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }
  return { valid: true };
}

export class JSRuntimeAdapter extends RuntimeAdapter {
  constructor(options = {}) {
    super({ ...options, type: RuntimeType.JS });
    this.skipValidation = options.skipValidation || false;
    this.useWorkerSandbox = options.useWorkerSandbox !== false; // 默认启用
    this.timeout = options.timeout || 30000;
    this._worker = null;
    this._pendingRequests = new Map();
    this._requestId = 0;
  }

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

  async execute(code, context) {
    await this.initialize();

    // 优先使用 Worker 沙箱
    if (this.useWorkerSandbox && this._worker) {
      return this._executeInWorker(code, context);
    }

    // Fallback: 主线程执行（需安全检查）
    return this._executeInMainThread(code, context);
  }

  async _executeInWorker(code, context) {
    const id = ++this._requestId;

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this._pendingRequests.delete(id);
        // If the worker is stuck (e.g. sync infinite loop), terminate it to avoid a wedged sandbox.
        try {
          this._worker?.terminate?.();
        } catch {
          // ignore
        }
        this._worker = null;
        resolve({
          success: false,
          error: 'Worker execution timeout',
          metrics: { duration: this.timeout }
        });
      }, this.timeout + 1000); // 额外 1s 给 Worker 内部超时

      this._pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        }
      });

      this._worker.postMessage({
        type: 'execute',
        id,
        code,
        state: context?.state,
        timeout: this.timeout
      });
    });
  }

  async _executeInMainThread(code, context) {
    const startTime = Date.now();

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
        const { state, vfs, emit } = context;
        return (async () => {
          ${code}
        })();
      `);

      const result = await fn(context);

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

  async terminate() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    this._pendingRequests.clear();
  }
}
