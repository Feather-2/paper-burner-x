/**
 * @file Execution strategy selector for code evaluation.
 * Provides fallback chain: WASM → iframe → indirect eval
 */

import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('node-compat/execution-strategy');

/**
 * @typedef {'wasm'|'iframe'|'eval'|'none'} ExecutionMode
 * @typedef {Error & { code?: string }} ExecError
 */

/**
 * Detect available execution modes in current environment.
 * @returns {Promise<ExecutionMode[]>}
 */
export async function detectAvailableModes() {
  /** @type {ExecutionMode[]} */
  const modes = [];

  // 1. Check WASM support
  if (typeof WebAssembly !== 'undefined') {
    try {
      await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      modes.push('wasm');
    } catch (err) {
      logger.debug('WASM not available', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 2. Check iframe support (browser only)
  if (typeof document !== 'undefined' && typeof HTMLIFrameElement !== 'undefined') {
    modes.push('iframe');
  }

  // 3. Check eval (always try, but may fail under strict CSP)
  try {
    (0, eval)('1+1');
    modes.push('eval');
  } catch (err) {
    logger.debug('eval blocked by CSP', { error: err instanceof Error ? err.message : String(err) });
  }

  return modes;
}

/**
 * Select best execution mode based on config and environment.
 * @param {object} config
 * @param {ExecutionMode} [config.preferred] - Preferred mode
 * @param {boolean} [config.strictCSP] - Force WASM-only for strict CSP
 * @returns {Promise<ExecutionMode>}
 */
export async function selectExecutionMode(config = {}) {
  const { preferred, strictCSP } = config;
  const available = await detectAvailableModes();

  // Strict CSP: only WASM allowed
  if (strictCSP) {
    if (!available.includes('wasm')) {
      throw new Error('Strict CSP mode requires WASM support, but WASM is not available');
    }
    return 'wasm';
  }

  // Preferred mode if available
  if (preferred && available.includes(preferred)) {
    return preferred;
  }

  // Fallback chain: wasm → iframe → eval → none
  if (available.includes('wasm')) return 'wasm';
  if (available.includes('iframe')) return 'iframe';
  if (available.includes('eval')) return 'eval';

  return 'none';
}

/**
 * @param {string} message
 * @returns {ExecError}
 */
function createAbortError(message = 'Execution aborted') {
  const error = /** @type {ExecError} */ (new Error(message));
  error.name = 'AbortError';
  error.code = 'ERR_EXEC_ABORTED';
  return error;
}

/**
 * @param {number} timeoutMs
 * @returns {ExecError}
 */
function createTimeoutError(timeoutMs) {
  const error = /** @type {ExecError} */ (new Error(`Execution timed out after ${timeoutMs}ms`));
  error.code = 'ERR_EXEC_TIMEOUT';
  return error;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeTimeoutMs(value) {
  if (!Number.isFinite(value)) return 0;
  const timeout = Math.floor(Number(value));
  return timeout > 0 ? timeout : 0;
}

/**
 * @param {number} timeoutMs
 * @returns {Promise<HTMLElement>}
 */
async function waitForDocumentBody(timeoutMs) {
  if (typeof document === 'undefined') {
    throw new Error('iframe execution mode requires document');
  }
  if (document.body) return document.body;

  return new Promise((resolve, reject) => {
    let timer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
    const cleanup = () => {
      document.removeEventListener('DOMContentLoaded', onReady);
      if (timer) clearTimeout(timer);
    };
    const onReady = () => {
      if (!document.body) return;
      cleanup();
      resolve(document.body);
    };

    document.addEventListener('DOMContentLoaded', onReady, { once: false });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`document.body is not ready within ${timeoutMs}ms`));
      }, timeoutMs);
    }

    onReady();
  });
}

/**
 * @param {() => Promise<any>} runner
 * @param {{ timeoutMs?: number, signal?: AbortSignal, onAbort?: () => void }} [options]
 * @returns {Promise<any>}
 */
function executeWithControls(runner, options = {}) {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const signal = options.signal;
  const onAbort = options.onAbort;

  if (signal?.aborted) return Promise.reject(createAbortError());

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
    let abortHandler = /** @type {(() => void)|null} */ (null);

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };

    if (signal) {
      abortHandler = () => {
        try { onAbort?.(); } catch {}
        finish(reject, createAbortError());
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { onAbort?.(); } catch {}
        finish(reject, createTimeoutError(timeoutMs));
      }, timeoutMs);
    }

    Promise.resolve()
      .then(() => runner())
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
  });
}

/**
 * Create execution context based on selected mode.
 * @param {ExecutionMode} mode
 * @param {{ timeoutMs?: number, signal?: AbortSignal, domReadyTimeoutMs?: number }} [options]
 * @returns {Promise<{ execute: (code: string, options?: { timeoutMs?: number, signal?: AbortSignal }) => Promise<any>, dispose: () => void }>}
 */
export async function createExecutionContext(mode, options = {}) {
  const defaultTimeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const defaultSignal = options.signal;

  switch (mode) {
    case 'wasm': {
      const { createSandbox } = await import('../sandbox/wasm-sandbox.js');
      const sandbox = await createSandbox({
        limits: defaultTimeoutMs > 0 ? { timeoutMs: defaultTimeoutMs } : undefined,
      });
      return {
        execute: (code, runOptions = {}) => executeWithControls(
          () => Promise.resolve(sandbox.execute(code)),
          {
            timeoutMs: runOptions.timeoutMs ?? defaultTimeoutMs,
            signal: runOptions.signal || defaultSignal,
          },
        ),
        dispose: () => sandbox.dispose(),
      };
    }

    case 'iframe': {
      if (typeof document === 'undefined') {
        throw new Error('iframe execution mode requires document');
      }
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.sandbox = 'allow-scripts';
      const domReadyTimeoutMs = normalizeTimeoutMs(options.domReadyTimeoutMs ?? 5000);
      const body = await waitForDocumentBody(domReadyTimeoutMs);
      body.appendChild(iframe);

      return {
        execute: (code, runOptions = {}) => executeWithControls(
          () => {
            const win = /** @type {(Window & { eval?: typeof globalThis.eval, stop?: () => void }) | null} */ (iframe.contentWindow);
            if (!win || typeof win.eval !== 'function') {
              throw new Error('iframe contentWindow is unavailable');
            }
            return Promise.resolve(win.eval(code));
          },
          {
            timeoutMs: runOptions.timeoutMs ?? defaultTimeoutMs,
            signal: runOptions.signal || defaultSignal,
            onAbort: () => {
              try { iframe.contentWindow?.stop?.(); } catch {}
            },
          },
        ),
        dispose: () => iframe.remove(),
      };
    }

    case 'eval': {
      return {
        execute: (code, runOptions = {}) => executeWithControls(
          () => Promise.resolve((0, eval)(code)),
          {
            timeoutMs: runOptions.timeoutMs ?? defaultTimeoutMs,
            signal: runOptions.signal || defaultSignal,
          },
        ),
        dispose: () => {},
      };
    }

    default:
      throw new Error(`Unsupported execution mode: ${mode}`);
  }
}
