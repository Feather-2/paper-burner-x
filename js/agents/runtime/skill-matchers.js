/**
 * Skill Matchers
 *
 * Matchers determine when a Skill should be activated based on context.
 * Supports agentsdk-go style matcher definitions.
 */

/**
 * @typedef {Object} ActivationContext
 * @property {string} [prompt] - 用户输入（主要匹配源）
 * @property {string} [query] - 用户查询文本（兼容旧版）
 * @property {string[]} [channels] - 渠道列表
 * @property {Object<string, string>} [tags] - 标签（对象形式）
 * @property {string[]} [traits] - 特征列表
 * @property {string} [currentPhase] - 当前阶段
 * @property {number} [availableBudget] - 可用预算
 * @property {Object} [metadata] - 额外上下文
 */

/**
 * @typedef {Object} KeywordMatcherDef
 * @property {'keyword'} type
 * @property {string[]} [all] - 必须全部包含
 * @property {string[]} [any] - 任一包含即可
 */

/**
 * @typedef {Object} TagMatcherDef
 * @property {'tag'} type
 * @property {Object<string, string>} [require] - 必须匹配的标签
 * @property {Object<string, string>} [exclude] - 必须不匹配的标签
 */

/**
 * @typedef {Object} TraitMatcherDef
 * @property {'trait'} type
 * @property {string[]} traits - 需要匹配的特征
 */

/**
 * @typedef {KeywordMatcherDef | TagMatcherDef | TraitMatcherDef} MatcherDef
 */

/**
 * 标准化文本为小写单词集合
 * @param {string} text
 * @returns {Set<string>}
 */
function toWordSet(text) {
  if (!text || typeof text !== "string") return new Set();
  const words = text.toLowerCase().match(/[\u4e00-\u9fa5]+|[a-z0-9]+/g) || [];
  return new Set(words);
}

/**
 * 关键词匹配器
 * 支持两种格式：
 * 1. 旧版：skill.activation.keywords = ["ppt", "slide"]
 * 2. 新版：matcher = { type: "keyword", all: [...], any: [...] }
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition} skill
 * @param {ActivationContext} context
 * @param {KeywordMatcherDef} [matcherDef] - 新版 matcher 定义
 * @returns {{ matched: boolean, score: number, matchedKeywords: string[], reason: string }}
 */
export function keywordMatcher(skill, context, matcherDef) {
  const text = context.prompt || context.query || "";
  const textLower = text.toLowerCase();
  const textWords = toWordSet(text);

  // 新版 matcher 格式
  if (matcherDef) {
    const allKeywords = matcherDef.all || [];
    const anyKeywords = matcherDef.any || [];

    if (allKeywords.length === 0 && anyKeywords.length === 0) {
      return { matched: false, score: 0, matchedKeywords: [], reason: "" };
    }

    // 检查 all：必须全部包含
    const allMatched = [];
    for (const kw of allKeywords) {
      if (textWords.has(kw.toLowerCase()) || textLower.includes(kw.toLowerCase())) {
        allMatched.push(kw);
      }
    }
    const allPass = allKeywords.length === 0 || allMatched.length === allKeywords.length;

    // 检查 any：任一包含即可
    const anyMatched = [];
    for (const kw of anyKeywords) {
      if (textWords.has(kw.toLowerCase()) || textLower.includes(kw.toLowerCase())) {
        anyMatched.push(kw);
      }
    }
    const anyPass = anyKeywords.length === 0 || anyMatched.length > 0;

    const matched = allPass && anyPass;
    const matchedKeywords = [...allMatched, ...anyMatched];
    const score = matched ? (matchedKeywords.length * 10) : 0;
    const reason = matched ? `keywords|all=${allMatched.length}|any=${anyMatched.length}|hit=${matchedKeywords.join(",")}` : "";

    return { matched, score, matchedKeywords, reason };
  }

  // 旧版 activation.keywords 格式（兼容）
  const keywords = skill.activation?.keywords || [];
  if (keywords.length === 0) {
    return { matched: false, score: 0, matchedKeywords: [], reason: "" };
  }

  const matchedKeywords = [];
  for (const keyword of keywords) {
    const kwLower = keyword.toLowerCase();
    if (textWords.has(kwLower) || textLower.includes(kwLower)) {
      matchedKeywords.push(keyword);
    }
  }

  const matched = matchedKeywords.length > 0;
  const score = matched ? (matchedKeywords.length / keywords.length) * 10 : 0;
  const reason = matched ? `keywords|hit=${matchedKeywords.join(",")}` : "";

  return { matched, score, matchedKeywords, reason };
}

/**
 * 标签匹配器
 * 支持两种格式：
 * 1. 旧版：skill.activation.tags = ["tag1", "tag2"]，context.tags = ["tag1"]
 * 2. 新版：matcher = { type: "tag", require: {env: "prod"}, exclude: {test: "true"} }
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition} skill
 * @param {ActivationContext} context
 * @param {TagMatcherDef} [matcherDef] - 新版 matcher 定义
 * @returns {{ matched: boolean, score: number, matchedTags: string[], reason: string }}
 */
export function tagMatcher(skill, context, matcherDef) {
  // context.tags 可以是数组或对象
  const contextTags = context.tags || {};
  const isTagsArray = Array.isArray(contextTags);

  // 新版 matcher 格式
  if (matcherDef) {
    const requireTags = matcherDef.require || {};
    const excludeTags = matcherDef.exclude || {};

    if (Object.keys(requireTags).length === 0 && Object.keys(excludeTags).length === 0) {
      return { matched: false, score: 0, matchedTags: [], reason: "" };
    }

    // 将数组形式转为 Set 以便查找
    const tagSet = isTagsArray ? new Set(contextTags.map((t) => t.toLowerCase())) : null;

    // 检查 require：必须全部匹配
    const requiredMatched = [];
    for (const [key, value] of Object.entries(requireTags)) {
      if (isTagsArray) {
        // 数组形式：检查是否包含 key 或 value
        if (tagSet.has(key.toLowerCase()) || tagSet.has(value.toLowerCase())) {
          requiredMatched.push(`${key}=${value}`);
        }
      } else {
        // 对象形式：精确匹配
        if (contextTags[key] === value) {
          requiredMatched.push(`${key}=${value}`);
        }
      }
    }
    const requirePass = Object.keys(requireTags).length === 0 || requiredMatched.length === Object.keys(requireTags).length;

    // 检查 exclude：必须不匹配
    let excludePass = true;
    for (const [key, value] of Object.entries(excludeTags)) {
      if (isTagsArray) {
        if (tagSet.has(key.toLowerCase()) || tagSet.has(value.toLowerCase())) {
          excludePass = false;
          break;
        }
      } else {
        if (contextTags[key] === value) {
          excludePass = false;
          break;
        }
      }
    }

    const matched = requirePass && excludePass;
    const score = matched ? (requiredMatched.length * 15) : 0;
    const reason = matched && requiredMatched.length > 0 ? `tags|require=${requiredMatched.join(",")}` : "";

    return { matched, score, matchedTags: requiredMatched, reason };
  }

  // 旧版 activation.tags 格式（兼容）
  const skillTags = skill.activation?.tags || [];
  if (skillTags.length === 0) {
    return { matched: false, score: 0, matchedTags: [], reason: "" };
  }

  const matchedTags = [];
  if (isTagsArray) {
    const contextTagSet = new Set(contextTags.map((t) => t.toLowerCase()));
    for (const tag of skillTags) {
      if (contextTagSet.has(tag.toLowerCase())) {
        matchedTags.push(tag);
      }
    }
  } else {
    // 对象形式：检查 key 是否存在于 skillTags 中
    for (const tag of skillTags) {
      if (tag in contextTags) {
        matchedTags.push(tag);
      }
    }
  }

  const matched = matchedTags.length > 0;
  const score = matched ? (matchedTags.length / skillTags.length) * 15 : 0;
  const reason = matched ? `tags|hit=${matchedTags.join(",")}` : "";

  return { matched, score, matchedTags, reason };
}

/**
 * 特征匹配器
 * 支持两种格式：
 * 1. 旧版：skill.activation.traits = ["needs_ppt"]
 * 2. 新版：matcher = { type: "trait", traits: ["needs_ppt"] }
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition} skill
 * @param {ActivationContext} context
 * @param {TraitMatcherDef} [matcherDef] - 新版 matcher 定义
 * @returns {{ matched: boolean, score: number, matchedTraits: string[], reason: string }}
 */
export function traitMatcher(skill, context, matcherDef) {
  const contextTraits = context.traits || [];
  if (contextTraits.length === 0) {
    return { matched: false, score: 0, matchedTraits: [], reason: "" };
  }

  const contextTraitSet = new Set(contextTraits.map((t) => t.toLowerCase()));

  // 新版或旧版都取 traits 列表
  const skillTraits = matcherDef?.traits || skill.activation?.traits || [];
  if (skillTraits.length === 0) {
    return { matched: false, score: 0, matchedTraits: [], reason: "" };
  }

  const matchedTraits = [];
  for (const trait of skillTraits) {
    if (contextTraitSet.has(trait.toLowerCase())) {
      matchedTraits.push(trait);
    }
  }

  const matched = matchedTraits.length > 0;
  const score = matched ? (matchedTraits.length / skillTraits.length) * 20 : 0;
  const reason = matched ? `traits|hit=${matchedTraits.join(",")}` : "";

  return { matched, score, matchedTraits, reason };
}

/**
 * 阶段匹配器
 * 检查当前阶段是否在 Skill 的激活阶段列表中
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition} skill
 * @param {ActivationContext} context
 * @returns {{ matched: boolean, score: number, reason: string }}
 */
export function phaseMatcher(skill, context) {
  const phases = skill.activation?.phases || [];
  const currentPhase = context.currentPhase;

  if (phases.length === 0 || !currentPhase) {
    return { matched: false, score: 0, reason: "" };
  }

  const matched = phases.some((p) => p.toLowerCase() === currentPhase.toLowerCase());
  const reason = matched ? `phase|hit=${currentPhase}` : "";

  return { matched, score: matched ? 25 : 0, reason };
}

/**
 * 预算匹配器
 * 检查可用预算是否满足 Skill 的最小预算要求
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition} skill
 * @param {ActivationContext} context
 * @returns {{ matched: boolean, score: number, affordable: boolean, reason: string }}
 */
export function budgetMatcher(skill, context) {
  const minBudget = skill.requires?.minBudget || 0;
  const availableBudget = context.availableBudget;

  // 如果没有预算信息，默认可用
  if (availableBudget === undefined || availableBudget === null) {
    return { matched: true, score: 0, affordable: true, reason: "" };
  }

  const affordable = availableBudget >= minBudget;
  const reason = affordable ? "" : `budget|required=${minBudget}|available=${availableBudget}`;

  return {
    matched: affordable,
    score: affordable ? 5 : -100,
    affordable,
    reason,
  };
}

/**
 * 组合匹配器
 * 运行所有匹配器并汇总分数
 * 支持两种模式：
 * 1. 旧版 skill.activation 结构
 * 2. 新版 skill.matchers[] 数组
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition} skill
 * @param {ActivationContext} context
 * @param {Object} [options]
 * @param {boolean} [options.requireAnyMatch=false] - 是否要求至少一个匹配器命中
 * @returns {{ matched: boolean, score: number, details: Object }}
 */
export function combinedMatcher(skill, context, { requireAnyMatch = false } = {}) {
  const reasons = [];

  // 优先处理新版 matchers 数组
  const matchers = skill.matchers || [];
  if (matchers.length > 0) {
    let totalScore = 0;
    let anyMatched = false;
    const details = { matchers: [] };

    for (const matcher of matchers) {
      let result;
      switch (matcher.type) {
        case "keyword":
          result = keywordMatcher(skill, context, matcher);
          break;
        case "tag":
          result = tagMatcher(skill, context, matcher);
          break;
        case "trait":
          result = traitMatcher(skill, context, matcher);
          break;
        default:
          continue;
      }

      details.matchers.push({ type: matcher.type, ...result });
      totalScore += result.score;
      if (result.matched) {
        anyMatched = true;
        if (result.reason) reasons.push(result.reason);
      }
    }

    // 仍然检查 budget
    const budgetResult = budgetMatcher(skill, context);
    details.budget = budgetResult;
    totalScore += budgetResult.score;

    if (!budgetResult.affordable) {
      if (budgetResult.reason) reasons.push(budgetResult.reason);
      return {
        matched: false,
        score: -1,
        details: { ...details, reason: reasons.join(";") || "budget_insufficient" },
      };
    }

    const matched = requireAnyMatch ? anyMatched : true;
    return {
      matched,
      score: totalScore,
      details: { ...details, reason: reasons.join(";") },
    };
  }

  // 旧版 activation 结构
  const keywordResult = keywordMatcher(skill, context);
  const tagResult = tagMatcher(skill, context);
  const traitResult = traitMatcher(skill, context);
  const phaseResult = phaseMatcher(skill, context);
  const budgetResult = budgetMatcher(skill, context);

  const totalScore =
    keywordResult.score +
    tagResult.score +
    traitResult.score +
    phaseResult.score +
    budgetResult.score;

  // 收集 reasons
  if (keywordResult.reason) reasons.push(keywordResult.reason);
  if (tagResult.reason) reasons.push(tagResult.reason);
  if (traitResult.reason) reasons.push(traitResult.reason);
  if (phaseResult.reason) reasons.push(phaseResult.reason);

  // 如果预算不足，直接不匹配
  if (!budgetResult.affordable) {
    if (budgetResult.reason) reasons.push(budgetResult.reason);
    return {
      matched: false,
      score: -1,
      details: {
        keyword: keywordResult,
        tag: tagResult,
        trait: traitResult,
        phase: phaseResult,
        budget: budgetResult,
        reason: reasons.join(";") || "budget_insufficient",
      },
    };
  }

  const anyMatched =
    keywordResult.matched ||
    tagResult.matched ||
    traitResult.matched ||
    phaseResult.matched;

  const matched = requireAnyMatch ? anyMatched : true;

  return {
    matched,
    score: totalScore,
    details: {
      keyword: keywordResult,
      tag: tagResult,
      trait: traitResult,
      phase: phaseResult,
      budget: budgetResult,
      reason: reasons.join(";"),
    },
  };
}

/**
 * 匹配多个 Skills 并排序
 *
 * @param {import('../shared/skill-definition.js').SkillDefinition[]} skills
 * @param {ActivationContext} context
 * @param {Object} [options]
 * @param {boolean} [options.requireAnyMatch=true]
 * @param {number} [options.minScore=0]
 * @returns {{ skill: import('../shared/skill-definition.js').SkillDefinition, score: number, details: Object }[]}
 */
export function matchSkills(skills, context, { requireAnyMatch = true, minScore = 0 } = {}) {
  const results = [];

  for (const skill of skills) {
    const result = combinedMatcher(skill, context, { requireAnyMatch });
    if (result.matched && result.score >= minScore) {
      results.push({
        skill,
        score: result.score,
        details: result.details,
      });
    }
  }

  // 按分数降序排列
  results.sort((a, b) => b.score - a.score);

  return results;
}

export default {
  keywordMatcher,
  tagMatcher,
  traitMatcher,
  phaseMatcher,
  budgetMatcher,
  combinedMatcher,
  matchSkills,
};
