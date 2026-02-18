/**
 * Platform Tools - 跨平台工具适配器
 *
 * 根据运行环境自动选择正确的工具实现：
 * - Browser: VFS + Pyodide + QuickJS
 * - Node-like: fs + child_process + native
 */

import { Platform, isNodeLike } from '../../../shared/index.js';

/**
 * @typedef {object} VfsAdapter
 * @property {(path: string) => Promise<string | Uint8Array | null>} [read] - Read file contents.
 * @property {(path: string) => Promise<string | null>} [readText] - Read text contents.
 * @property {(path: string, data: Uint8Array) => Promise<void>} [write] - Write binary contents.
 * @property {(path: string, content: string) => Promise<void>} [writeText] - Write text contents.
 * @property {(path: string) => Promise<string[]>} [list] - List directory entries.
 * @property {(pattern: string, options?: { cwd?: string }) => Promise<string[]>} [glob] - Glob files.
 */

/**
 * @typedef {object} Logger
 * @property {(message: string, ...args: unknown[]) => void} [debug] - Debug logger.
 * @property {(message: string, ...args: unknown[]) => void} [warn] - Warning logger.
 */

/**
 * @typedef {(name: string, payload: unknown) => void} EmitFn
 */

/**
 * @typedef {object} PlatformToolsOptions
 * @property {VfsAdapter} [vfs] - VFS adapter (Browser required).
 * @property {string} [basePath] - Base working directory.
 * @property {Logger} [logger] - Optional logger instance.
 * @property {EmitFn} [emit] - Event emitter callback.
 * @property {string[]} [allowedCommands] - Allowed command list for bash (Node only).
 * @property {number} [maxTimeoutMs] - Max timeout for bash in ms (Node only).
 */

/**
 * @typedef {object} PlatformTools
 * @property {(args: { pattern: string, path?: string }) => Promise<{ files: string[], error?: string }>} glob
 * @property {(args: { pattern: string, path?: string, regex?: boolean, caseSensitive?: boolean }) => Promise<{ matches: Array<{ file: string, line: number, content: string }>, error?: string }>} grep - caseSensitive 仅 Node 端支持
 * @property {(args: { path: string, startLine?: number, endLine?: number }) => Promise<{ content: string, error?: string }>} read
 * @property {(args: { path: string, content: string }) => Promise<{ success: boolean, error?: string }>} write
 * @property {(args: { path: string }) => Promise<{ entries: string[], error?: string }>} list
 * @property {(args: { command: string, timeout?: number }) => Promise<{ stdout: string, stderr: string, exitCode: number, error?: string }> | null} bash
 * @property {string} platform - 'browser' | 'node' | 'bun' | 'deno'
 */

/**
 * 创建平台工具集
 *
 * @param {PlatformToolsOptions} [options]
 * @returns {Promise<PlatformTools>}
 */
export async function createPlatformTools(options = {}) {
  if (isNodeLike()) {
    const { createNodeTools } = await import('./node.js');
    return createNodeTools(options);
  }

  const { createBrowserTools } = await import('./browser.js');
  return createBrowserTools(options);
}

/**
 * 获取当前平台类型
 * @returns {'browser' | 'node' | 'bun' | 'deno' | 'unknown'}
 */
export function getPlatformType() {
  return Platform.runtime;
}

/**
 * @returns {{ python?: boolean, js_sandbox?: boolean } | null}
 */
function getCapabilityOverrides() {
  const caps = globalThis.__AGENT_RUNTIME_CAPABILITIES__;
  if (!caps || typeof caps !== "object") return null;
  return caps;
}

function probePythonCapability() {
  const overrides = getCapabilityOverrides();
  if (typeof overrides?.python === "boolean") return overrides.python;

  if (isNodeLike()) {
    const env = globalThis?.process?.env || {};
    if (typeof env.PYTHON === "string" && env.PYTHON.trim()) return true;
    if (typeof env.PYTHON_PATH === "string" && env.PYTHON_PATH.trim()) return true;
    return false;
  }

  return (
    typeof globalThis.loadPyodide === "function" ||
    !!globalThis.pyodide ||
    !!globalThis.Pyodide
  );
}

function probeJsSandboxCapability() {
  const overrides = getCapabilityOverrides();
  if (typeof overrides?.js_sandbox === "boolean") return overrides.js_sandbox;

  return !!globalThis.QuickJS || !!globalThis.quickjs || globalThis.__AGENT_JS_SANDBOX_READY__ === true;
}

/**
 * 检查特定能力是否可用
 *
 * @param {'bash' | 'python' | 'js_sandbox'} capability
 * @returns {boolean}
 */
export function hasCapability(capability) {
  const isNode = isNodeLike();

  switch (capability) {
    case 'bash':
      return isNode; // 只有 Node 端有 bash
    case 'python':
      return probePythonCapability();
    case 'js_sandbox':
      return probeJsSandboxCapability();
    default:
      return false;
  }
}

export { Platform, isNodeLike };
