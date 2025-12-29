/**
 * Skill Injection - 构建 Skill 注入
 *
 * 参考 agentsdk-go 的 Matcher 系统设计
 *
 * 触发方式（按优先级）：
 * 1. 显式提及：$SkillName 或 @SkillName
 * 2. 关键词匹配：All（必须全部匹配）+ Any（任一匹配）
 * 3. 标签匹配：Require/Exclude
 * 4. 特征匹配：Traits
 * 5. 语义匹配：description 相似度
 */

import { promises as fs } from "fs";

/**
 * @typedef {Object} MatchResult
 * @property {boolean} matched
 * @property {number} score - 0-1
 * @property {string} reason
 */

/**
 * @typedef {Object} SkillInjection
 * @property {string} name
 * @property {string} path
 * @property {string} contents
 * @property {MatchResult} matchResult
 */

// ============ Helpers ============

/**
 * 转义正则特殊字符
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============ Matchers ============

/**
 * 显式提及匹配器
 */
function matchExplicit(input, skill) {
  const escapedName = escapeRegExp(skill.metadata.name);
  const patterns = [
    new RegExp(`\\$${escapedName}\\b`, "i"),
    new RegExp(`@${escapedName}\\b`, "i"),
  ];

  for (const pattern of patterns) {
    if (pattern.test(input)) {
      return { matched: true, score: 1.0, reason: "explicit" };
    }
  }
  return { matched: false, score: 0, reason: "" };
}

/**
 * 关键词匹配器（All + Any 模式）
 * 参考 agentsdk-go KeywordMatcher
 */
function matchKeywords(input, skill) {
  const inputLower = input.toLowerCase();
  const all = (skill.metadata.keywordsAll || []).map(k => k.toLowerCase());
  const any = (skill.metadata.keywords || []).map(k => k.toLowerCase());

  if (all.length === 0 && any.length === 0) {
    return { matched: false, score: 0, reason: "" };
  }

  // All 模式：必须全部匹配
  for (const keyword of all) {
    if (!inputLower.includes(keyword)) {
      return { matched: false, score: 0, reason: "" };
    }
  }

  // Any 模式：任一匹配
  let anyMatched = any.length === 0;
  let matchedKeyword = "";
  for (const keyword of any) {
    if (inputLower.includes(keyword)) {
      anyMatched = true;
      matchedKeyword = keyword;
      break;
    }
  }

  if (!anyMatched) {
    return { matched: false, score: 0, reason: "" };
  }

  // 计算分数：0.55 + 0.2*(有all) + 0.15*(有any匹配)
  const score = clampScore(
    0.55 +
    0.2 * (all.length > 0 ? 1 : 0) +
    0.15 * (matchedKeyword ? 1 : 0)
  );

  const reasonParts = ["keywords"];
  if (all.length > 0) reasonParts.push(`all=${all.length}`);
  if (matchedKeyword) reasonParts.push(`hit=${matchedKeyword}`);

  return { matched: true, score, reason: reasonParts.join("|") };
}

/**
 * 标签匹配器
 * 参考 agentsdk-go TagMatcher
 */
function matchTags(context, skill) {
  const require = skill.metadata.tags || {};
  const contextTags = context.tags || {};

  if (Object.keys(require).length === 0) {
    return { matched: false, score: 0, reason: "" };
  }

  let matchCount = 0;
  for (const [key, val] of Object.entries(require)) {
    const current = contextTags[key.toLowerCase()];
    if (current === undefined) {
      return { matched: false, score: 0, reason: "" };
    }
    if (val && val !== current) {
      return { matched: false, score: 0, reason: "" };
    }
    matchCount++;
  }

  const score = clampScore(0.55 + 0.35 * (matchCount / Object.keys(require).length));
  return { matched: true, score, reason: `tags:${matchCount}/${Object.keys(require).length}` };
}

/**
 * 特征匹配器
 * 参考 agentsdk-go TraitMatcher
 */
function matchTraits(context, skill) {
  const target = skill.metadata.traits || [];
  const have = new Set((context.traits || []).map(t => t.toLowerCase()));

  if (target.length === 0 || have.size === 0) {
    return { matched: false, score: 0, reason: "" };
  }

  let matches = 0;
  for (const trait of target) {
    if (have.has(trait.toLowerCase())) {
      matches++;
    }
  }

  if (matches === 0) {
    return { matched: false, score: 0, reason: "" };
  }

  const score = clampScore(0.55 + 0.4 * (matches / target.length));
  return { matched: true, score, reason: `traits:${matches}/${target.length}` };
}

/**
 * 语义匹配器（description 相似度）
 */
function matchSemantic(input, skill, threshold = 0.3) {
  const inputWords = new Set(
    input.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  );
  const descWords = skill.metadata.description
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (descWords.length === 0 || inputWords.size === 0) {
    return { matched: false, score: 0, reason: "" };
  }

  const matchCount = descWords.filter(w => inputWords.has(w)).length;
  const ratio = matchCount / descWords.length;

  if (ratio < threshold) {
    return { matched: false, score: 0, reason: "" };
  }

  // 语义匹配分数较低，最高 0.7
  const score = clampScore(0.4 + 0.3 * ratio);
  return { matched: true, score, reason: `semantic:${matchCount}/${descWords.length}` };
}

// ============ Helpers ============

function clampScore(score) {
  if (score < 0) return 0;
  if (score > 0.99) return 0.99;
  return score;
}

/**
 * 综合匹配：返回最佳匹配结果
 */
function matchSkill(input, skill, context = {}) {
  const results = [
    matchExplicit(input, skill),
    matchKeywords(input, skill),
    matchTags(context, skill),
    matchTraits(context, skill),
    matchSemantic(input, skill),
  ];

  // 返回分数最高的匹配结果
  let best = { matched: false, score: 0, reason: "" };
  for (const result of results) {
    if (result.matched && result.score > best.score) {
      best = result;
    }
  }
  return best;
}

/**
 * Skill 协调：检测冲突和冗余
 */
function coordinateSkills(matches) {
  if (matches.length <= 1) return matches;

  const coordinated = [];
  const seenNames = new Set();

  for (const match of matches) {
    const name = match.skill.metadata.name.toLowerCase();

    // 去重：同名 Skill 只保留分数最高的
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    // 冲突检测：检查 allowed-tools 是否互斥
    // 如果新 Skill 的 allowed-tools 与已有 Skill 完全不相交，可能冲突
    // 暂时只做警告，不阻止注入
    coordinated.push(match);
  }

  return coordinated;
}

// ============ Public API ============

/**
 * 收集需要注入的 Skills
 *
 * @param {string} input - 用户输入
 * @param {Object[]} skills - 可用的 Skills 列表
 * @param {Object} options
 * @param {Object} [options.context] - 激活上下文 { tags, traits }
 * @param {number} [options.maxInjections=3] - 最大注入数量
 * @param {number} [options.minScore=0.4] - 最低匹配分数
 * @returns {Array<{skill: Object, matchResult: MatchResult}>}
 */
export function collectSkillsToInject(input, skills, options = {}) {
  const {
    context = {},
    maxInjections = 3,
    minScore = 0.4,
  } = options;

  if (!input || !skills?.length) return [];

  const matches = [];

  for (const skill of skills) {
    const result = matchSkill(input, skill, context);
    if (result.matched && result.score >= minScore) {
      matches.push({ skill, matchResult: result });
    }
  }

  // 按分数排序，取前 N 个
  matches.sort((a, b) => b.matchResult.score - a.matchResult.score);

  // 协调：去重和冲突检测
  const coordinated = coordinateSkills(matches);

  return coordinated.slice(0, maxInjections);
}

/**
 * 构建 Skill 注入
 */
export async function buildSkillInjections(input, skillsOutcome, options = {}) {
  const result = {
    items: [],
    warnings: [],
  };

  if (!input || !skillsOutcome?.skills?.length) {
    return result;
  }

  const matches = collectSkillsToInject(input, skillsOutcome.skills, options);

  for (const { skill, matchResult } of matches) {
    try {
      let contents;
      if (skill.body) {
        contents = `# Skill: ${skill.metadata.name}\n\n${skill.body}`;
      } else {
        contents = await fs.readFile(skill.metadata.path, "utf-8");
      }

      result.items.push({
        name: skill.metadata.name,
        path: skill.metadata.path,
        contents,
        matchResult,
        allowedTools: skill.metadata.allowedTools,
      });
    } catch (err) {
      result.warnings.push(
        `Failed to load skill ${skill.metadata.name}: ${err.message}`
      );
    }
  }

  return result;
}

/**
 * 格式化 Skill 注入为 prompt 片段
 */
export function formatSkillInjections(injections) {
  if (!injections?.items?.length) return "";

  const lines = [
    "## Skill Instructions",
    "",
    "The following skills have been activated for this task:",
    "",
  ];

  for (const item of injections.items) {
    lines.push(`### ${item.name}`);
    lines.push(`Source: ${item.path}`);
    lines.push(`Match: ${item.matchResult.reason} (score: ${item.matchResult.score.toFixed(2)})`);
    if (item.allowedTools) {
      lines.push(`Allowed tools: ${item.allowedTools}`);
    }
    lines.push("");
    lines.push(item.contents);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export default {
  collectSkillsToInject,
  buildSkillInjections,
  formatSkillInjections,
  coordinateSkills,
  // 导出 matchers 供测试
  matchExplicit,
  matchKeywords,
  matchTags,
  matchTraits,
  matchSemantic,
};
