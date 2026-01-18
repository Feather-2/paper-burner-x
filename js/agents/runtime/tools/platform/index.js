/**
 * Platform Tools - 跨平台工具适配器
 *
 * 根据运行环境自动选择正确的工具实现：
 * - Browser: VFS + Pyodide + QuickJS
 * - Node-like: fs + child_process + native
 */

import { Platform, isNodeLike } from '../../../shared/platform.js';

/**
 * @typedef {object} PlatformToolsOptions
 * @property {any} [vfs] - VFS 实例 (Browser 必需)
 * @property {string} [basePath] - 基础路径
 * @property {any} [logger] - 日志器
 * @property {(name: string, payload: any) => void} [emit] - 事件发射
 */

/**
 * @typedef {object} PlatformTools
 * @property {(args: { pattern: string, path?: string }) => Promise<{ files: string[], error?: string }>} glob
 * @property {(args: { pattern: string, path?: string, regex?: boolean, caseSensitive?: boolean }) => Promise<{ matches: any[], error?: string }>} grep - caseSensitive 仅 Node 端支持
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
      return true; // Browser: Pyodide, Node: python3
    case 'js_sandbox':
      return true; // 两端都有 QuickJS
    default:
      return false;
  }
}

export { Platform, isNodeLike };
