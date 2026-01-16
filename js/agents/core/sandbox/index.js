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
 */

// WASM Sandbox
export { WasmSandbox, createSandbox } from './wasm-sandbox.js';
export { SandboxPool } from './pool.js';
export { createSandboxPlugin } from './plugin.js';
export { SkillExecutor, createSkillExecutor, isWasmSupported } from './skill-executor.js';
export { SandboxCapability, SandboxPreset, ResourceLimits } from './constants.js';

// System Sandbox
export {
  // 常量
  SandboxBackend,
  SandboxPolicy,
  DefaultSandboxConfig,
  Platform,
  // 检测
  detectAllBackends,
  detectBestBackend,
  getPlatform,
  // 执行器
  SystemSandboxExecutor,
  createSystemSandbox,
  execInSandbox,
  shellInSandbox,
  // 后端
  createBubblewrapExecutor,
  createSeatbeltExecutor,
  createDockerExecutor,
  createPermissionExecutor,
  createInteractivePermissionHandler,
} from './system/index.js';

import { SandboxCapability, SandboxPreset, ResourceLimits } from './constants.js';
import { SandboxBackend, createSystemSandbox } from './system/index.js';

export default {
  // WASM 沙箱常量
  SandboxCapability,
  SandboxPreset,
  ResourceLimits,
  // 系统沙箱
  SandboxBackend,
  createSystemSandbox,
};
