/**
 * Unified facade for creating a complete Node.js-compatible environment.
 *
 * @module create-node-env
 */

import { MemoryVfs } from '../../vfs/vfs.memory.js';
import { withVfsEvents } from '../webruntime/vfs-events.js';
import { createSandbox } from '../sandbox/wasm-sandbox.js';
import { createSandboxFactory } from '../sandbox/create-sandbox.js';
import { QuotaEnforcer } from './quota.js';
import { ObservabilityStream, withObservability } from './observability.js';
import { createLogger } from '../../shared/utils/logger.js';
import { setupErrorStackTracePolyfill } from './polyfills/stack-trace.js';

const logger = createLogger('node-compat/create-node-env');

/**
 * @param {unknown} value
 * @returns {value is import('../sandbox/wasm-sandbox.js').WasmSandbox}
 */
function isWasmSandbox(value) {
  const candidate = /** @type {{ dispose?: unknown } | null} */ (value && typeof value === 'object' ? value : null);
  return typeof candidate?.dispose === 'function';
}

/**
 * @param {unknown} value
 * @returns {value is import('../sandbox/sandbox-interface.js').Sandbox}
 */
function isUnifiedSandbox(value) {
  const candidate = /** @type {{ terminate?: unknown } | null} */ (value && typeof value === 'object' ? value : null);
  return typeof candidate?.terminate === 'function';
}

/**
 * @typedef {object} NodeEnvConfig
 * @property {string} [cwd='/'] - Working directory
 * @property {Record<string, string>} [env] - Environment variables
 * @property {(method: string, args: unknown[]) => void} [onConsole] - console callback
 * @property {'wasm'|'worker'|'iframe'|'main'|'auto'|'eval'} [sandboxLevel='wasm']
 * @property {string[]} [capabilities]
 * @property {number} [timeout=30000]
 * @property {object} [vfs] - External VFS instance; creates MemoryVfs if omitted
 * @property {import('./quota.js').QuotaConfig} [quota] - Resource quota limits
 * @property {import('./observability.js').ObservabilityStream} [observability] - Observability stream
 */

/**
 * @typedef {object} NodeEnv
 * @property {object} vfs - VFS instance (with events)
 * @property {import('../sandbox/sandbox-interface.js').Sandbox | import('../sandbox/wasm-sandbox.js').WasmSandbox} sandbox - Sandbox instance
 * @property {(code: string, filename?: string) => Promise<import('../sandbox/wasm-sandbox.js').SandboxResult>} execute
 * @property {(path: string) => Promise<import('../sandbox/wasm-sandbox.js').SandboxResult>} runFile
 * @property {() => Promise<void>} dispose - Clean up all resources
 * @property {boolean} terminated - Whether dispose() has been called
 */

/**
 * Create a complete Node.js-compatible environment.
 * @param {NodeEnvConfig} [config]
 * @returns {Promise<NodeEnv>}
 */
export async function createNodeEnv(config = {}) {
  const {
    cwd = '/',
    env = {},
    onConsole,
    sandboxLevel = 'wasm',
    capabilities = ['console'],
    timeout = 30000,
    vfs: externalVfs,
    quota,
    observability,
  } = config;

  // 0. Setup polyfills
  setupErrorStackTracePolyfill();

  // 1. Resource enforcement
  const quotaEnforcer = quota ? new QuotaEnforcer(quota) : null;
  const obsStream = observability || new ObservabilityStream();

  // 2. VFS with events + observability + quota
  let rawVfs = externalVfs || new MemoryVfs();
  rawVfs = withVfsEvents(rawVfs);
  const vfs = withObservability(rawVfs, obsStream, quotaEnforcer);

  // 2. Ensure cwd exists
  const cwdNorm = cwd.replace(/^\/+/, '') || '';
  if (cwdNorm) {
    try {
      await vfs.mkdir(cwdNorm, { recursive: true });
    } catch (err) {
      logger.debug('Failed to create cwd, may already exist', { cwd: cwdNorm, error: err.message });
    }
  }

  // 3. Sandbox — bridge to WasmSandbox via createSandbox
  const onLog = onConsole
    ? (level, args) => onConsole(level, args)
    : undefined;

  /** @type {'wasm'|'worker'|'iframe'|'main'|'auto'} */
  const normalizedSandboxLevel = (() => {
    const value = typeof sandboxLevel === 'string' ? sandboxLevel.trim().toLowerCase() : '';
    if (value === 'eval') return 'main';
    if (value === 'wasm' || value === 'worker' || value === 'iframe' || value === 'main' || value === 'auto') {
      return value;
    }
    return 'wasm';
  })();

  const sandbox = normalizedSandboxLevel === 'wasm'
    ? await createSandbox({
      capabilities,
      limits: { timeoutMs: timeout },
      onLog,
      state: { cwd, env },
    })
    : await createSandboxFactory({
      level: normalizedSandboxLevel,
      vfs,
      capabilities,
      timeout,
      cwd,
      env,
      onConsole,
      mainThreadFallback: normalizedSandboxLevel === 'main',
    });

  // Mark terminated state for dispose tracking
  let terminated = false;

  // 4. Convenience methods
  const execute = async (code, filename) => {
    if (isUnifiedSandbox(sandbox)) {
      return sandbox.execute(code, filename);
    }
    return sandbox.execute(code, filename ? { __filename: filename } : {});
  };

  const runFile = async (path) => {
    const content = await vfs.readText(path);
    if (isUnifiedSandbox(sandbox)) {
      return sandbox.execute(content, path);
    }
    return sandbox.execute(content, { __filename: path });
  };

  // 5. Dispose
  const dispose = async () => {
    if (terminated) return;
    terminated = true;
    if (isUnifiedSandbox(sandbox)) {
      await sandbox.terminate();
    } else if (isWasmSandbox(sandbox)) {
      sandbox.dispose();
    }
    if (typeof vfs?.removeAllListeners === 'function') {
      vfs.removeAllListeners();
    }
  };

  return {
    vfs,
    sandbox,
    execute,
    runFile,
    dispose,
    get terminated() { return terminated; },
  };
}
