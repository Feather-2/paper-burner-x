import { toNonEmptyString } from "../shared/index.js";

/**
 * Skill Render - 渲染 Skills 列表给模型
 *
 * 三层优先级机制:
 * - critical: 核心技能，始终在最前面
 * - important: 重要技能，紧随其后 (默认)
 * - optional: 可选技能，放在最后
 */

/**
 * 获取 Skill 的优先级
 */
function getSkillPriority(skill) {
  const meta = skill.metadata || skill;
  const priority = meta.priority || meta.activation?.priority;

  if (priority === "critical" || priority === 0 || priority <= 50) {
    return "critical";
  }
  if (priority === "optional" || priority === 2 || priority >= 150) {
    return "optional";
  }
  return "important";
}

/**
 * 按优先级分组 Skills
 */
function groupSkillsByPriority(skills) {
  const critical = [];
  const important = [];
  const optional = [];

  for (const skill of skills) {
    const priority = getSkillPriority(skill);
    if (priority === "critical") {
      critical.push(skill);
    } else if (priority === "optional") {
      optional.push(skill);
    } else {
      important.push(skill);
    }
  }

  return { critical, important, optional };
}

function normalizeSkillPathForPrompt(path) {
  const raw = toNonEmptyString(path);
  if (!raw) return "";

  if (raw.startsWith("user:") || raw.startsWith("nexus://") || raw.startsWith("remote:")) return raw;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return `${u.pathname || "/"}${u.search || ""}`;
    } catch {
      return raw;
    }
  }

  const looksAbsolutePosix = raw.startsWith("/");
  const looksAbsoluteWin = /^[a-zA-Z]:[\\/]/.test(raw);
  if (looksAbsolutePosix || looksAbsoluteWin) {
    const parts = raw.replaceAll("\\", "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || raw;
  }

  return raw.replaceAll("\\", "/");
}

/**
 * 渲染 Skills 列表为 prompt 片段 (按优先级排序)
 *
 * @param {Object[]} skills - Skills 列表
 * @param {Object} [options] - 渲染选项
 * @param {boolean} [options.showPriority] - 是否显示优先级分组标题
 * @returns {string|null}
 */
export function renderSkillsSection(skills, options = {}) {
  if (!skills?.length) return null;
  const { showPriority = true } = options;

  const { critical, important, optional } = groupSkillsByPriority(skills);
  const lines = [
    "## Skills",
    "",
    "These skills are discovered at startup from multiple local sources. Each entry includes a name, description, and file path so you can open the source for full instructions.",
    "",
  ];

  const renderGroup = (group, title) => {
    if (group.length === 0) return;
    if (showPriority && title) {
      lines.push(title);
    }
    for (const skill of group) {
      const meta = skill.metadata || skill;
      const pathStr = normalizeSkillPathForPrompt(meta.path);
      lines.push(`- ${meta.name}: ${meta.description}${pathStr ? ` (file: ${pathStr})` : ""}`);
    }
    lines.push("");
  };

  // 按优先级顺序渲染
  renderGroup(critical, "### 🔴 Core Skills");
  renderGroup(important, "### 🟡 Standard Skills");
  renderGroup(optional, "### ⚪ Optional Skills");

  lines.push(`
- Discovery: Available skills are listed in project docs and may also appear in a runtime "## Skills" section (name + description + file path). These are the sources of truth; skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with \`$SkillName\` or plain text) OR the task clearly matches a skill's description, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1) After deciding to use a skill, open its \`SKILL.md\`. Read only enough to follow the workflow.
  2) If \`SKILL.md\` points to extra folders such as \`references/\`, load only the specific files needed for the request; don't bulk-load everything.
  3) If \`scripts/\` exist, prefer running or patching them instead of retyping large code blocks.
  4) If \`assets/\` or templates exist, reuse them instead of recreating from scratch.
- Description as trigger: The YAML \`description\` in \`SKILL.md\` is the primary trigger signal; rely on it to decide applicability. If unsure, ask a brief clarification before proceeding.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deeply nested references; prefer one-hop files explicitly linked from \`SKILL.md\`.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.
`.trim());

  return lines.join("\\n");
}

/**
 * 渲染简短的 Skills 列表（用于 system prompt，按优先级排序）
 *
 * @param {Array<{ metadata?: { name: string, description: string, shortDescription?: string | null, priority?: number }, name?: string, description?: string, shortDescription?: string | null, priority?: number }>} skills - Skills list
 * @returns {string} Formatted skills list for system prompt
 */
export function renderSkillsList(skills) {
  if (!skills?.length) return "";

  const { critical, important, optional } = groupSkillsByPriority(skills);
  const lines = ["Available skills:"];

  // 按优先级顺序，core 放最前
  const ordered = [...critical, ...important, ...optional];

  for (const skill of ordered) {
    const meta = skill.metadata || skill;
    const priorityTag = getSkillPriority(skill) === "critical" ? "🔴 " :
      getSkillPriority(skill) === "optional" ? "⚪ " : "";
    lines.push(`- ${priorityTag}$${meta.name}: ${meta.shortDescription || meta.description}`);
  }

  return lines.join("\\n");
}

/**
 * 渲染统一的 Capabilities + Skills 目录
 * 
 * @param {Object} [options]
 * @param {Array} [options.capabilities] - SDK Capabilities
 * @param {Array} [options.skills] - Prompt Skills
 * @returns {string}
 */
export function renderUnifiedCatalog({ capabilities = [], skills = [] } = {}) {
  const lines = ["## 可用能力和技能\\n"];

  // Capabilities (硬技能 - 可执行)
  if (capabilities.length > 0) {
    lines.push("### 🛠️ 可执行能力 (Capabilities)\\n");

    const capGroups = { critical: [], important: [], optional: [] };
    for (const cap of capabilities) {
      const def = cap.definition || cap;
      const priority = def.priority || def.activation?.priority || "important";
      const group = priority === "critical" || priority === 0 ? "critical" :
        priority === "optional" || priority === 2 ? "optional" : "important";
      capGroups[group].push({ name: def.name, description: def.description, priority: group });
    }

    for (const cap of [...capGroups.critical, ...capGroups.important, ...capGroups.optional]) {
      const icon = cap.priority === "critical" ? "🔴" : cap.priority === "optional" ? "⚪" : "🟡";
      lines.push(`- ${icon} **${cap.name}**: ${cap.description}`);
    }
    lines.push("");
  }

  // Skills (软技能 - Prompt 注入)
  if (skills.length > 0) {
    lines.push("### 📚 知识技能 (Skills)\\n");

    const { critical, important, optional } = groupSkillsByPriority(skills);
    const ordered = [...critical, ...important, ...optional];

    for (const skill of ordered) {
      const meta = skill.metadata || skill;
      const icon = getSkillPriority(skill) === "critical" ? "🔴" :
        getSkillPriority(skill) === "optional" ? "⚪" : "🟡";
      lines.push(`- ${icon} **$${meta.name}**: ${meta.shortDescription || meta.description}`);
    }
    lines.push("");
  }

  return lines.join("\\n");
}

export default {
  renderSkillsSection,
  renderSkillsList,
  renderUnifiedCatalog,
  groupSkillsByPriority,
  getSkillPriority,
};
