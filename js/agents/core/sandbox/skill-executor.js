/**
 * Skill Executor - 在沙箱中安全执行 Skills
 *
 * 替代原有的 js-sandbox-worker，提供真正的隔离。
 *
 * 降级策略：
 * - 默认 `fallbackMode: "none"`，WASM 不可用时直接报错。
 * - 可通过 `fallbackMode: "eval"` 启用受限 JS 执行（best-effort；不是强安全边界）。
 *
 * 本文件作为入口，重新导出所有 API 以保持向后兼容。
 * 实际实现已拆分为：
 * - skill-validation.js: 参数验证与安全检查
 * - skill-sandbox.js: 沙箱环境管理
 * - skill-executor-core.js: 核心执行逻辑
 */

export { SkillExecutor, createSkillExecutor } from './skill-executor-core.js';
export { isWasmSupported } from './skill-executor-helpers.js';

// 默认导出
export { SkillExecutor as default } from './skill-executor-core.js';
