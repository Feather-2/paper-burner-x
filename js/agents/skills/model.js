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
 * Skill 运行时类型
 */
export const SkillRuntime = Object.freeze({
  JS: "js",           // JavaScript (默认)
  PYTHON: "python",   // Python via Pyodide
});

/**
 * @typedef {Object} WheelSpec
 * @property {string} url - Wheel 下载地址
 * @property {string} [sha256] - SHA256 校验值
 */

/**
 * @typedef {Object} SkillDependencies
 * @property {string[]} [builtin] - Pyodide 内置包 (numpy, pandas, scipy...)
 * @property {string[]} [micropip] - PyPI 纯 Python 包 (pyyaml>=6.0, tabulate...)
 * @property {WheelSpec[]} [wheels] - 自定义 wheel 文件
 */

/**
 * @typedef {Object} SkillMetadata
 * @property {string} name - 技能名称
 * @property {string} description - 技能描述（用于语义匹配）
 * @property {string} [shortDescription] - 简短描述
 * @property {string} path - 技能文件路径
 * @property {string} scope - 作用域
 * @property {string} [runtime] - 运行时类型 ('js' | 'python')，默认 'js'
 * @property {SkillDependencies} [dependencies] - Python 依赖声明
 * @property {string} [entrypoint] - 入口文件，默认 'main.py' (Python) 或 'index.js' (JS)
 * @property {Object} [inputSchema] - 输入参数 JSON Schema
 * @property {Object} [outputSchema] - 输出结果 JSON Schema
 * @property {string[]} [keywords] - 触发关键词（Any 模式）
 * @property {string[]} [keywordsAll] - 必须全部匹配的关键词（All 模式）
 * @property {string} [allowedTools] - 允许使用的工具（逗号分隔）
 * @property {Object<string,string>} [tags] - 标签匹配条件
 * @property {string[]} [traits] - 用户特征匹配
 * @property {number} [priority] - 优先级（数字越小优先级越高）
 * @property {number} [timeout] - 执行超时（毫秒），默认 30000
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
  SkillRuntime,
};
