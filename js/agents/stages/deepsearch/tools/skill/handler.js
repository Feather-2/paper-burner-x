/**
 * Skill Tool - 让模型主动调用 Skills
 *
 * 参考 agentsdk-go 的 SkillTool 设计
 */

import { loadSkills, loadSkillFromPath } from "../../../../skills/loader.js";

// 缓存已加载的 Skills
let _skillsCache = null;
let _cacheTime = 0;
const CACHE_TTL = 60000; // 1 分钟

async function getSkillsCache(cwd) {
  const now = Date.now();
  if (_skillsCache && now - _cacheTime < CACHE_TTL) {
    return _skillsCache;
  }

  const outcome = await loadSkills({ cwd });
  _skillsCache = outcome;
  _cacheTime = now;
  return outcome;
}

export const definition = {
  name: "skill",
  description: `执行一个 Skill（策略包）

Skills 是可扩展的策略包，定义在 SKILL.md 文件中。
使用此工具主动调用一个 Skill，获取其详细指令。

参数:
- name: Skill 名称（必需）

返回:
- body: Skill 正文内容
- allowedTools: 允许使用的工具（如有限制）
- metadata: Skill 元数据`,
};

export async function handler(args, context) {
  const { name } = args;
  const { stageApi = {} } = context;
  const cwd =
    stageApi.cwd ||
    (typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".");

  if (!name) {
    return {
      success: false,
      error: "缺少参数: name",
    };
  }

  try {
    // 获取 Skills 列表
    const outcome = await getSkillsCache(cwd);

    // 查找匹配的 Skill
    const skill = outcome.skills.find(
      s => s.metadata.name.toLowerCase() === name.toLowerCase()
    );

    if (!skill) {
      // 列出可用的 Skills
      const available = outcome.skills.map(s => s.metadata.name).join(", ");
      return {
        success: false,
        error: `Skill "${name}" 不存在`,
        available: available || "无可用 Skills",
      };
    }

    let resolved = skill;
    if (!resolved.body && typeof resolved?.metadata?.path === "string" && resolved.metadata.path) {
      try {
        resolved = await loadSkillFromPath(resolved.metadata.path, resolved.metadata.scope);
      } catch {
        // ignore and fall back to cached entry (may be metadata-only)
      }
    }

    const body = typeof resolved?.body === "string" ? resolved.body : "";
    if (!body.trim()) {
      return {
        success: false,
        error: `Skill "${skill.metadata.name}" loaded but body is empty. Ensure SKILL.md is accessible in this environment.`,
      };
    }

    // 返回 Skill 内容
    return {
      success: true,
      skill: skill.metadata.name,
      body,
      allowedTools: skill.metadata.allowedTools || null,
      metadata: {
        description: skill.metadata.description,
        keywords: skill.metadata.keywords,
        path: skill.metadata.path,
        scope: skill.metadata.scope,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `加载 Skill 失败: ${err.message}`,
    };
  }
}

export default { definition, handler };
