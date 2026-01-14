/**
 * WASM Sandbox - 基于 QuickJS 的安全沙箱
 *
 * 提供真正的指令级隔离，用于执行不可信的 Skill 代码。
 *
 * 架构：
 * - QuickJS 编译到 WASM，运行在独立的内存空间
 * - 资源配额：内存上限、执行时间、递归深度
 * - 宿主通信：通过消息传递，无直接引用
 * - 能力注入：按需注入 API（fetch、state、emit 等）
 */

export { WasmSandbox, createSandbox } from './wasm-sandbox.js';
export { SandboxPool } from './pool.js';
export { createSandboxPlugin } from './plugin.js';
export { SkillExecutor, createSkillExecutor, isWasmSupported } from './skill-executor.js';

import { SandboxCapability, SandboxPreset, ResourceLimits } from './constants.js';

export { SandboxCapability, SandboxPreset, ResourceLimits } from './constants.js';

export default { SandboxCapability, SandboxPreset, ResourceLimits };
