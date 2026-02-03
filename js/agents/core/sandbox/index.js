/**
 * Sandbox 模块
 *
 * 提供两层沙箱机制：
 *
 * 1. WASM Sandbox (浏览器 / 跨平台)
 *    - 基于 QuickJS WASM
 *    - 指令级隔离，用于执行不可信 Skill 代码
 *    - 资源配额：内存上限、执行时间、递归深度
 *
 * 2. System Sandbox (Node / Bun / Deno)
 *    - Bubblewrap (Linux namespace)
 *    - Seatbelt (macOS sandbox-exec)
 *    - Docker (跨平台容器)
 *    - Permission-only (fallback)
 *
 * 注意：System Sandbox 仅在 Node-like 环境可用。
 * 浏览器环境下调用相关函数会抛出明确错误。
 */

import { isNodeLike } from '../../shared/index.js';

// WASM Sandbox (跨平台可用)
export { WasmSandbox, createSandbox } from './wasm-sandbox.js';
export { SandboxPool } from './pool.js';
export { createSandboxPlugin } from './plugin.js';
export { SkillExecutor, createSkillExecutor, isWasmSupported } from './skill-executor.js';
export { SandboxCapability, SandboxPreset, ResourceLimits } from './constants.js';

// System Sandbox 常量（不依赖 Node API，浏览器安全）
export { SandboxBackend, SandboxPolicy, DefaultSandboxConfig, Platform } from './system/constants.js';

/**
 * @param {string} fnName
 * @returns {never}
 */
function throwNodeOnlyError(fnName) {
  throw new Error(
    `${fnName}() is only available in Node.js/Bun/Deno environments. ` +
    `Use WASM sandbox (createSandbox/SkillExecutor) for browser environments.`
  );
}

// System Sandbox 函数存根（浏览器环境下抛出明确错误）
// 真实实现通过动态 import 或 Node-only 入口获取

/** @type {typeof import('./system/index.js').detectAllBackends} */
export const detectAllBackends = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.detectAllBackends(...args))
  : () => throwNodeOnlyError('detectAllBackends');

/** @type {typeof import('./system/index.js').detectBestBackend} */
export const detectBestBackend = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.detectBestBackend(...args))
  : () => throwNodeOnlyError('detectBestBackend');

/** @type {typeof import('./system/index.js').getPlatform} */
export const getPlatform = isNodeLike()
  ? /** @type {any} */ (() => import('./system/index.js').then(m => m.getPlatform()))
  : () => throwNodeOnlyError('getPlatform');

/** @type {typeof import('./system/index.js').createSystemSandbox} */
export const createSystemSandbox = isNodeLike()
  ? /** @type {any} */ ((...args) => import('./system/index.js').then(m => m.createSystemSandbox(...args)))
  : () => throwNodeOnlyError('createSystemSandbox');

/** @type {typeof import('./system/index.js').execInSandbox} */
export const execInSandbox = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.execInSandbox(...args))
  : () => throwNodeOnlyError('execInSandbox');

/** @type {typeof import('./system/index.js').shellInSandbox} */
export const shellInSandbox = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.shellInSandbox(...args))
  : () => throwNodeOnlyError('shellInSandbox');

/** @type {typeof import('./system/index.js').createBubblewrapExecutor} */
export const createBubblewrapExecutor = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.createBubblewrapExecutor(...args))
  : () => throwNodeOnlyError('createBubblewrapExecutor');

/** @type {typeof import('./system/index.js').createSeatbeltExecutor} */
export const createSeatbeltExecutor = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.createSeatbeltExecutor(...args))
  : () => throwNodeOnlyError('createSeatbeltExecutor');

/** @type {typeof import('./system/index.js').createDockerExecutor} */
export const createDockerExecutor = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.createDockerExecutor(...args))
  : () => throwNodeOnlyError('createDockerExecutor');

/** @type {typeof import('./system/index.js').createPermissionExecutor} */
export const createPermissionExecutor = isNodeLike()
  ? (...args) => import('./system/index.js').then(m => m.createPermissionExecutor(...args))
  : () => throwNodeOnlyError('createPermissionExecutor');

/** @type {typeof import('./system/index.js').createInteractivePermissionHandler} */
export const createInteractivePermissionHandler = isNodeLike()
  ? /** @type {any} */ ((options) => import('./system/index.js').then(m => m.createInteractivePermissionHandler(options)))
  : () => throwNodeOnlyError('createInteractivePermissionHandler');

// SystemSandboxExecutor 类需要特殊处理
export const SystemSandboxExecutor = isNodeLike()
  ? /** @type {typeof import('./system/index.js').SystemSandboxExecutor} */ (
      class SystemSandboxExecutorProxy {
        constructor(...args) {
          throw new Error(
            'SystemSandboxExecutor must be imported dynamically in Node.js environments. ' +
            'Use: const { SystemSandboxExecutor } = await import("./system/index.js")'
          );
        }
      }
    )
  : /** @type {any} */ (
      class SystemSandboxExecutorBrowserStub {
        constructor() {
          throwNodeOnlyError('SystemSandboxExecutor');
        }
      }
    );

import { SandboxCapability, SandboxPreset, ResourceLimits } from './constants.js';
import { SandboxBackend } from './system/constants.js';

export default {
  // WASM 沙箱常量
  SandboxCapability,
  SandboxPreset,
  ResourceLimits,
  // 系统沙箱
  SandboxBackend,
  createSystemSandbox,
};
