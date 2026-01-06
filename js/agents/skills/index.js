/**
 * Skills Module - 统一导出
 *
 * 新的 Skills 系统：
 * - Skills 是 Markdown 定义的指令包（SKILL.md）
 * - 支持多路径加载（repo > user > system）
 * - 提供 Skills Catalog（元数据）供上层显式选择/展示
 * - 不做隐式注入/自动匹配（避免内核层“猜测性”行为）
 *
 * 与 Tools 的区别：
 * - Tools 是原子化的执行单元，由模型直接调用
 * - Skills 是策略/知识包：由上层在需要时显式加载/展示
 */

export { SkillScope } from "./model.js";
export { loadSkills, loadSkillFromPath, loadSkillsFromNexus, loadAllSkills } from "./loader.js";
export { SkillsManager } from "./manager.js";
export { renderSkillsSection, renderSkillsList } from "./render.js";

// 沙箱执行
export {
  enhanceWithSandbox,
  createSandboxedSkillsManager,
  analyzeSkillRisk,
} from "./sandbox-adapter.js";

// 默认导出 SkillsManager
export { SkillsManager as default } from "./manager.js";
