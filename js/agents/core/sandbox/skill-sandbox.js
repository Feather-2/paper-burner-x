/**
 * Skill Sandbox - 沙箱环境管理
 */

import { SandboxPool } from './pool.js';
import { SandboxPreset, ResourceLimits } from './constants.js';
import { isNodeLike } from '../../shared/index.js';
import {
  createFallbackGlobals,
  createFallbackProxyGlobals,
  isWasmSupported,
  validateFallbackCode,
} from './skill-executor-helpers.js';
import { wrapNodeWorker } from '../webruntime/worker-comlink-node.js';

/**
 * 确保 WASM 沙箱池已初始化（若当前环境不支持 WASM，则返回 null）。
 *
 * 降级行为：
 * - `fallbackMode = "eval"`：使用受限的 JS 执行（best-effort；不是强安全边界）
 * - `fallbackMode = "none"`：直接报错，不执行 Skill
 *
 * @param {Object} state
 * @param {SandboxPool} state.pool
 * @param {boolean} state.wasmSupported
 * @param {string} state.fallbackMode
 * @param {boolean} state._ownPool
 * @param {Promise<SandboxPool>} state._poolInitPromise
 * @param {boolean} state._fallbackWarned
 * @param {Object} logger
 * @returns {Promise<SandboxPool | null>}
 */
export async function ensurePool(state, logger) {
  if (state.pool) return state.pool;
  if (state._poolInitPromise) return state._poolInitPromise;

  state._poolInitPromise = (async () => {
    if (state.wasmSupported === null) {
      state.wasmSupported = await isWasmSupported();
    }

    if (!state.wasmSupported) {
      if (!state._fallbackWarned) {
        state._fallbackWarned = true;
        logger.warn('WASM not supported, falling back to', { mode: state.fallbackMode });
      }
      return null;
    }

    state.pool = new SandboxPool({
      maxSize: 4,
      defaultCapabilities: SandboxPreset.SKILL,
    });
    state._ownPool = true;
    return state.pool;
  })();

  try {
    return await state._poolInitPromise;
  } finally {
    state._poolInitPromise = null;
  }
}

/**
 * 使用受限 JS 执行作为降级方案（best-effort）。
 *
 * 优先使用 Worker（js-sandbox-worker 协议），否则回退到主线程 eval。
 *
 * @param {Object} skill
 * @param {Object} context
 * @param {Object} exec
 * @param {Object} exec.state
 * @param {Object} exec.limits
 * @param {(level: string, args: any[]) => void} exec.onLog
 * @param {(name: string, payload: any) => void} exec.onEmit
 * @param {Function} isFallbackAllowed
 * @param {Object} logger
 * @returns {Promise<{ ok: boolean, value: any, error?: string, durationMs: number }>}
 */
export async function executeFallback(skill, context, exec, isFallbackAllowed, logger) {
  const skillId = skill?.id || skill?.metadata?.name;
  logger.debug('Executing skill in fallback mode', { skillId });

  if (!isFallbackAllowed(skill, context)) {
    try {
      logger.warn('Fallback eval blocked for untrusted skill', {
        skillId,
        scope: skill?.metadata?.scope,
      });
    } catch {
      // ignore
    }
    return {
      ok: false,
      value: null,
      error: 'Security: fallback eval blocked for untrusted skill',
      durationMs: 0,
      blocked: true,
      mode: 'eval',
    };
  }

  const code = String(skill?.body || '');
  const timeoutMs = exec?.limits?.timeoutMs ?? ResourceLimits.STANDARD.timeoutMs;

  const validation = validateFallbackCode(code);
  if (!validation.valid) {
    try {
      logger.warn('Sandbox blocked code (fallback)', { skillId, reason: validation.reason });
    } catch {
      // ignore
    }
    return {
      ok: false,
      value: null,
      error: `Security: ${validation.reason}`,
      durationMs: 0,
      blocked: true,
      mode: 'eval',
    };
  }

  // Try Worker-based restricted execution first.
  // Node.js: use worker_threads with dedicated worker file
  // Browser: use Web Worker
  if (isNodeLike()) {
    try {
      return await executeFallbackInNodeWorker({
        code,
        state: exec?.state,
        globals: context?.args,
        timeoutMs,
        onLog: exec?.onLog,
        onEmit: exec?.onEmit,
      }, logger);
    } catch (err) {
      logger.warn('Node worker unavailable, using main-thread eval', { error: err?.message });
    }
  } else if (typeof Worker !== 'undefined') {
    try {
      const workerUrl = new URL('../../runtime/core/js-sandbox-worker.js', import.meta.url);
      return await executeFallbackInWorker(workerUrl, {
        code,
        state: exec?.state,
        globals: context?.args,
        timeoutMs,
        onLog: exec?.onLog,
        onEmit: exec?.onEmit,
      }, logger);
    } catch (err) {
      logger.warn('Fallback worker unavailable, using main-thread eval', { error: err?.message });
    }
  }

  // Main-thread fallback (no isolation; best-effort).
  return await executeFallbackInMainThread({
    code,
    state: exec?.state,
    globals: context?.args,
    timeoutMs,
    onLog: exec?.onLog,
    onEmit: exec?.onEmit,
  }, logger);
}

/**
 * 在 Web Worker 中执行 fallback
 * @param {URL} workerUrl
 * @param {Object} options
 * @param {Object} logger
 * @returns {Promise<{ ok: boolean, value: any, error?: string, durationMs: number }>}
 */
export async function executeFallbackInWorker(workerUrl, options, logger) {
  const startTime = Date.now();
  const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 30000));

  /** @type {Worker | null} */
  let worker = null;
  try {
    worker = new Worker(workerUrl, { type: 'module' });
  } catch {
    // Older browsers may not support module workers.
    worker = new Worker(workerUrl);
  }

  const id = 1;

  return await new Promise((resolve) => {
    let done = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;

    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      try {
        worker?.terminate?.();
      } catch {
        // ignore
      }
      worker = null;
    };

    // Host-side timeout: handles sync infinite loops (worker event loop blocked).
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup();
        finish({
          ok: false,
          value: null,
          error: 'Worker execution timeout',
          durationMs: Date.now() - startTime,
          timedOut: true,
          mode: 'worker',
        });
      }, timeoutMs + 1000);
    }

    worker.onmessage = (evt) => {
      const { type, success, data, error, metrics, name, payload, level, args, event } = evt.data || {};

      if (type === 'emit') {
        options?.onEmit?.(name, payload);
        return;
      }

      if (type === 'audit') {
        try {
          logger.debug('Sandbox audit', { mode: 'worker', event, payload });
        } catch {
          // ignore
        }
        return;
      }

      if (type === 'log') {
        options?.onLog?.(level, args);
        return;
      }

      if (type === 'result') {
        cleanup();
        const elapsed = (metrics && typeof metrics === "object" && typeof metrics.duration === 'number') ? metrics.duration : Date.now() - startTime;
        finish({
          ok: Boolean(success),
          value: success ? data : null,
          error: success ? undefined : String(error || 'Unknown error'),
          durationMs: elapsed,
          mode: 'worker',
        });
      }
    };

    worker.onerror = (err) => {
      cleanup();
      finish({
        ok: false,
        value: null,
        error: err?.message || String(err),
        durationMs: Date.now() - startTime,
        mode: 'worker',
      });
    };

    try {
      worker.postMessage({
        type: 'execute',
        id,
        code: options.code,
        state: options.state,
        globals: options.globals,
        timeout: timeoutMs,
      });
    } catch (err) {
      cleanup();
      finish({
        ok: false,
        value: null,
        error: err?.message || String(err),
        durationMs: Date.now() - startTime,
        mode: 'worker',
      });
    }
  });
}

/**
 * Node.js worker_threads 执行
 * @param {Object} options
 * @param {Object} logger
 * @returns {Promise<{ ok: boolean, value: any, error?: string, durationMs: number }>}
 */
export async function executeFallbackInNodeWorker(options, logger) {
  const startTime = Date.now();
  const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 30000));
  const standardMemoryMb = Math.max(1, Math.ceil(ResourceLimits.STANDARD.memoryLimit / (1024 * 1024)));
  const workerResourceLimits = {
    // Node worker_threads uses MB units for resource limits.
    maxOldGenerationSizeMb: standardMemoryMb * 8,
    maxYoungGenerationSizeMb: standardMemoryMb,
    codeRangeSizeMb: standardMemoryMb,
  };

  // Dynamic import for Node.js worker_threads
  // @ts-ignore - Node-only module; this package is type-checked without Node types.
  const { Worker } = await import(/* @vite-ignore */ 'node:worker_threads');
  const workerPath = new URL('../../runtime/core/js-sandbox-worker.node.js', import.meta.url);

  // @ts-ignore - Node-only type; this package is type-checked without Node types.
  /** @type {import('node:worker_threads').Worker | null} */
  let nodeWorker = null;
  try {
    nodeWorker = new Worker(workerPath, {
      resourceLimits: workerResourceLimits,
    });
  } catch (err) {
    throw new Error(`Failed to create Node worker: ${err?.message}`);
  }

  const removeListener = typeof nodeWorker.off === 'function'
    ? (event, handler) => nodeWorker.off(event, handler)
    : typeof nodeWorker.removeListener === 'function'
      ? (event, handler) => nodeWorker.removeListener(event, handler)
      : () => {};

  /** @type {(err: any) => void} */
  let onError;
  /** @type {(code: number) => void} */
  let onExit;

  const detachLifecycleListeners = () => {
    if (onError) removeListener('error', onError);
    if (onExit) removeListener('exit', onExit);
  };

  // Match existing host timeout behavior: worker timeout + 1s grace period.
  const rpcTimeout = timeoutMs > 0 ? timeoutMs + 1000 : 2_147_483_647;

  const worker = wrapNodeWorker(nodeWorker, {
    timeout: rpcTimeout,
    methodTimeouts: { execute: rpcTimeout },
    onConsole(method, args) {
      if (method === 'emit') {
        const [name, payload] = Array.isArray(args) ? args : [];
        options?.onEmit?.(name, payload);
        return;
      }

      if (method === 'audit') {
        const [event, payload] = Array.isArray(args) ? args : [];
        try {
          logger.debug('Sandbox audit', { mode: 'node-worker', event, payload });
        } catch {
          // ignore
        }
        return;
      }

      if (method === 'log') {
        const [level, logArgs] = Array.isArray(args) ? args : [];
        options?.onLog?.(level, Array.isArray(logArgs) ? logArgs : []);
      }
    },
  });

  const lifecycleFailure = new Promise((_, reject) => {
    onError = (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    onExit = (code) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    };
    nodeWorker.on('error', onError);
    nodeWorker.on('exit', onExit);
  });

  try {
    const value = await Promise.race([
      worker.execute({
        code: options?.code,
        filename: options?.filename,
        state: options?.state,
        globals: options?.globals,
        timeout: timeoutMs,
      }),
      lifecycleFailure,
    ]);

    return {
      ok: true,
      value,
      durationMs: Date.now() - startTime,
      mode: 'node-worker',
    };
  } catch (err) {
    const errorMessage = err?.message || String(err);
    const timedOut = /worker call timeout|execution timeout|timed?\s*out/i.test(errorMessage);

    return {
      ok: false,
      value: null,
      error: timedOut ? 'Worker execution timeout' : errorMessage,
      durationMs: Date.now() - startTime,
      ...(timedOut ? { timedOut: true } : {}),
      mode: 'node-worker',
    };
  } finally {
    detachLifecycleListeners();
    try {
      worker.terminate();
    } catch {
      // ignore
    }
    nodeWorker = null;
  }
}

/**
 * 主线程 fallback 执行
 * @param {Object} options
 * @param {Object} logger
 * @returns {Promise<{ ok: boolean, value: any, error?: string, durationMs: number }>}
 */
export async function executeFallbackInMainThread(options, logger) {
  const startTime = Date.now();
  const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 30000));

  const baseGlobals = createFallbackGlobals({
    state: options.state,
    args: options.globals,
    onLog: options.onLog || (() => {}),
    onEmit: options.onEmit || (() => {}),
  });
  const audit = { blockedAccesses: new Set() };
  const sandbox = createFallbackProxyGlobals(baseGlobals, audit);

  try {
    logger.debug('Sandbox audit', {
      mode: 'eval',
      event: 'start',
      timeoutMs,
      codeLength: typeof options?.code === 'string' ? options.code.length : 0,
    });

    // 构建受限执行函数（best-effort；不是强安全边界）
    // SECURITY: Fallback sandbox via new Function/with - TRUSTED-ONLY.
    // This path is only reached when WASM sandbox is unavailable.
    // Do not route untrusted input here; prefer WASM/Worker sandbox.
    const userCode = typeof options?.code === 'string' ? options.code : '';
    const nonStrictUserCode = userCode.replace(
      /^\s*(?:["']use strict["'];?\s*)+/,
      ''
    );

    // WARNING: `with` provides scope shadowing but NOT security isolation.
    // It can be bypassed via Function.constructor, __proto__, etc.
    // Use only for trusted code; untrusted code must use WASM/Worker sandbox.
    const wrappedCode = `
      with (sandbox) {
        return (async function () {
          ${nonStrictUserCode}
        }).call(this);
      }
    `;

    // eslint-disable-next-line no-new-func -- trusted-only fallback
    const fn = new Function('sandbox', wrappedCode);

    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutId = null;
    const execPromise = fn.call(sandbox, sandbox);
    const timeoutPromise =
      timeoutMs > 0
        ? new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('Execution timeout')), timeoutMs);
          })
        : null;

    let result;
    try {
      result = timeoutPromise ? await Promise.race([execPromise, timeoutPromise]) : await execPromise;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    return {
      ok: true,
      value: result,
      durationMs: Date.now() - startTime,
      mode: 'eval',
      blockedGlobals: Array.from(audit.blockedAccesses),
    };
  } catch (err) {
    return {
      ok: false,
      value: null,
      error: err?.message || String(err),
      durationMs: Date.now() - startTime,
      mode: 'eval',
      blockedGlobals: Array.from(audit.blockedAccesses),
    };
  } finally {
    try {
      logger.debug('Sandbox audit', {
        mode: 'eval',
        event: 'end',
        duration: Date.now() - startTime,
        blockedGlobals: Array.from(audit.blockedAccesses),
      });
    } catch {
      // ignore
    }
  }
}
