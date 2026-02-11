/**
 * Unified facade for creating a complete Node.js-compatible environment.
 *
 * @module create-node-env
 */

import { MemoryVfs } from '../../vfs/vfs.memory.js';
import { withVfsEvents } from './vfs-events.js';
import { createSandbox } from './wasm-sandbox.js';

/**
 * @typedef {object} NodeEnvConfig
 * @property {string} [cwd='/'] - Working directory
 * @property {Record<string, string>} [env] - Environment variables
 * @property {(method: string, args: unknown[]) => void} [onConsole] - console callback
 * @property {'wasm'|'worker'|'iframe'|'main'|'auto'} [sandboxLevel='auto']
 * @property {string[]} [capabilities]
 * @property {number} [timeout=30000]
 * @property {object} [vfs] - External VFS instance; creates MemoryVfs if omitted
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
  } = config;

  // 1. VFS with events
  const rawVfs = externalVfs || new MemoryVfs();
  const vfs = withVfsEvents(rawVfs);

  // 2. Ensure cwd exists
  const cwdNorm = cwd.replace(/^\/+/, '') || '';
  if (cwdNorm) {
    try { await vfs.mkdir(cwdNorm, { recursive: true }); } catch (_) { /* already exists */ }
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
