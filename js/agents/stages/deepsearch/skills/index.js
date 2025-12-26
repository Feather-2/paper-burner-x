/**
 * DeepSearch Skills Index
 *
 * 导出所有可用的 skills，供 agent-loop 使用
 */

import manageTodos from "./manage-todos/handler.js";
import searchDocs from "./search-docs/handler.js";
import writeReport from "./write-report/handler.js";
import watchdog from "./watchdog/handler.js";

export const skills = {
  "manage-todos": manageTodos,
  "search-docs": searchDocs,
  "write-report": writeReport,
  "watchdog": watchdog,
};

/**
 * 获取所有 skill 定义（给模型选择用）
 */
export function getSkillDefinitions() {
  return Object.values(skills).map(s => s.definition);
}

/**
 * 获取 skill catalog prompt
 */
export function getSkillCatalogPrompt() {
  const lines = ["## 可用技能\n"];

  for (const [name, skill] of Object.entries(skills)) {
    lines.push(`### ${name}`);
    lines.push(skill.definition.description);
    if (skill.definition.activation?.keywords?.length) {
      lines.push(`触发词: ${skill.definition.activation.keywords.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 执行 skill
 */
export async function executeSkill(name, args, context) {
  const skill = skills[name];
  if (!skill) {
    return { success: false, error: `Unknown skill: ${name}` };
  }

  try {
    return await skill.handler(args, context);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 匹配 skills（根据关键词）
 */
export function matchSkills(query) {
  const queryLower = query.toLowerCase();
  const matched = [];

  for (const [name, skill] of Object.entries(skills)) {
    const keywords = skill.definition.activation?.keywords || [];
    const isMatch = keywords.some(k => queryLower.includes(k.toLowerCase()));
    if (isMatch) {
      matched.push({ name, definition: skill.definition, score: 1.0 });
    }
  }

  return matched;
}

export default skills;
