/**
 * Skill Model - 数据结构定义
 *
 * Skills 架构
 */

/**
 * Skill 作用域
 */
export const SkillScope = Object.freeze({
  SYSTEM: "system",   // 系统内置
  USER: "user",       // 用户全局 (~/.paper-burner/skills)
  REPO: "repo",       // 仓库级别 (.paper-burner/skills)
  REMOTE: "remote",   // 远程加载 (MCP-Nexus)
});

/**
 * @typedef {Object} SkillMetadata
 * @property {string} name - 技能名称
 * @property {string} description - 技能描述（用于语义匹配）
 * @property {string} [shortDescription] - 简短描述
 * @property {string} path - 技能文件路径
 * @property {string} scope - 作用域
 * @property {string[]} [keywords] - 触发关键词（Any 模式）
 * @property {string[]} [keywordsAll] - 必须全部匹配的关键词（All 模式）
 * @property {string} [allowedTools] - 允许使用的工具（逗号分隔）
 * @property {Object<string,string>} [tags] - 标签匹配条件
 * @property {string[]} [traits] - 用户特征匹配
 * @property {number} [priority] - 优先级（数字越小优先级越高）
 */

/**
 * @typedef {Object} MatchResult
 * @property {boolean} matched - 是否匹配
 * @property {number} score - 匹配分数 (0-1)
 * @property {string} reason - 匹配原因
 */

/**
 * @typedef {Object} SkillContent
 * @property {SkillMetadata} metadata
 * @property {string} body - SKILL.md 正文内容
 * @property {Object<string, string>} [supportFiles] - 辅助文件
 */

/**
 * @typedef {Object} SkillLoadOutcome
 * @property {SkillMetadata[]} skills - 成功加载的技能
 * @property {SkillError[]} errors - 加载错误
 */

/**
 * @typedef {Object} SkillError
 * @property {string} path - 文件路径
 * @property {string} message - 错误信息
 */

/**
 * @typedef {Object} SkillInjection
 * @property {string} name - 技能名称
 * @property {string} path - 文件路径
 * @property {string} contents - 注入内容
 */

export default {
  SkillScope,
};
