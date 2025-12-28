/**
 * Skills Module - 统一导出
 *
 * 新的 Skills 系统：
 * - Skills 是 Markdown 定义的指令包（SKILL.md）
 * - 支持多路径加载（repo > user > system）
 * - 支持三种触发方式：显式提及、语义匹配、关键词匹配
 * - 注入到对话上下文，引导模型行为
 *
 * 与 Tools 的区别：
 * - Tools 是原子化的执行单元，由模型直接调用
 * - Skills 是策略/知识包，注入后引导模型如何使用 Tools
 */

export { SkillScope } from "./model.js";
export { loadSkills, loadSkillFromPath, loadSkillsFromNexus, loadAllSkills } from "./loader.js";
export {
  collectSkillsToInject,
  buildSkillInjections,
  formatSkillInjections,
} from "./injection.js";
export { SkillsManager, getGlobalSkillsManager } from "./manager.js";
export { renderSkillsSection, renderSkillsList } from "./render.js";

// 默认导出 SkillsManager
export { SkillsManager as default } from "./manager.js";
