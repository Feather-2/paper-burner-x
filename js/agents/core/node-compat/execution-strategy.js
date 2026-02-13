/**
 * @file Execution strategy selector for code evaluation.
 * Provides fallback chain: WASM → iframe → indirect eval
 */

import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('node-compat/execution-strategy');

/**
 * @typedef {'wasm'|'iframe'|'eval'|'none'} ExecutionMode
 */

/**
 * Detect available execution modes in current environment.
 * @returns {Promise<ExecutionMode[]>}
 */
export async function detectAvailableModes() {
  const modes = [];

  // 1. Check WASM support
  if (typeof WebAssembly !== 'undefined') {
    try {
      await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      modes.push('wasm');
    } catch (err) {
      logger.debug('WASM not available', { error: err.message });
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
    logger.debug('eval blocked by CSP', { error: err.message });
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
 * Create execution context based on selected mode.
 * @param {ExecutionMode} mode
 * @param {object} [options]
 * @returns {Promise<{ execute: (code: string) => Promise<any>, dispose: () => void }>}
 */
export async function createExecutionContext(mode, options = {}) {
  switch (mode) {
    case 'wasm': {
      const { createSandbox } = await import('../sandbox/wasm-sandbox.js');
      const sandbox = await createSandbox(options);
      return {
        execute: (code) => sandbox.execute(code),
        dispose: () => sandbox.dispose(),
      };
    }

    case 'iframe': {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.sandbox = 'allow-scripts';
      document.body.appendChild(iframe);

      return {
        execute: (code) => {
          return new Promise((resolve, reject) => {
            const win = iframe.contentWindow;
            try {
              const result = win.eval(code);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          });
        },
        dispose: () => iframe.remove(),
      };
    }

    case 'eval': {
      return {
        execute: (code) => Promise.resolve((0, eval)(code)),
        dispose: () => {},
      };
    }

    default:
      throw new Error(`Unsupported execution mode: ${mode}`);
  }
}
