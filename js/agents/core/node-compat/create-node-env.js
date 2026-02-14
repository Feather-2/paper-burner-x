/**
 * Unified facade for creating a complete Node.js-compatible environment.
 *
 * @module create-node-env
 */

import { MemoryVfs } from '../../vfs/vfs.memory.js';
import { withVfsEvents } from '../webruntime/vfs-events.js';
import { createSandbox } from '../sandbox/wasm-sandbox.js';
import { QuotaEnforcer } from './quota.js';
import { ObservabilityStream, withObservability } from './observability.js';
import { createLogger } from '../../shared/utils/logger.js';
import { setupErrorStackTracePolyfill } from './polyfills/error-stack-trace.js';

const logger = createLogger('node-compat/create-node-env');

/**
 * @typedef {object} NodeEnvConfig
 * @property {string} [cwd='/'] - Working directory
 * @property {Record<string, string>} [env] - Environment variables
 * @property {(method: string, args: unknown[]) => void} [onConsole] - console callback
 * @property {'wasm'|'worker'|'iframe'|'main'|'auto'} [sandboxLevel='auto']
 * @property {string[]} [capabilities]
 * @property {number} [timeout=30000]
 * @property {object} [vfs] - External VFS instance; creates MemoryVfs if omitted
 * @property {import('./quota.js').QuotaConfig} [quota] - Resource quota limits
 * @property {import('./observability.js').ObservabilityStream} [observability] - Observability stream
 */

/**
 * @typedef {object} NodeEnv
 * @property {object} vfs - VFS instance (with events)
 * @property {object} sandbox - Sandbox instance
 * @property {(code: string, filename?: string) => Promise<import('./wasm-sandbox.js').SandboxResult>} execute
 * @property {(path: string) => Promise<import('./wasm-sandbox.js').SandboxResult>} runFile
 * @property {() => Promise<void>} dispose - Clean up all resources
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

  const sandbox = await createSandbox({
    capabilities,
    limits: { timeoutMs: timeout },
    onLog,
    state: { cwd, env },
  });

  // Mark terminated state for dispose tracking
  let terminated = false;

  // 4. Convenience methods
  const execute = (code, filename) =>
    sandbox.execute(code, filename ? { __filename: filename } : {});

  const runFile = async (path) => {
    const content = await vfs.readText(path);
    return sandbox.execute(content, { __filename: path });
  };

  // 5. Dispose
  const dispose = async () => {
    if (terminated) return;
    terminated = true;
    sandbox.dispose();
    vfs.removeAllListeners();
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
