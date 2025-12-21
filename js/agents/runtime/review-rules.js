const SEVERITY_RANK = Object.freeze({
  info: 0,
  warning: 1,
  error: 2,
});

const RANK_TO_SEVERITY = Object.freeze(["info", "warning", "error"]);

function normalizeSeverity(severity) {
  if (severity === "error" || severity === "warning" || severity === "info") return severity;
  return "warning";
}

function normalizeRuleList(ruleList) {
  if (!Array.isArray(ruleList)) return [];
  return ruleList.map((rule) => (rule && typeof rule === "object" ? { ...rule } : rule));
}

function mergeRules(defaultRules, customRules) {
  const merged = {};

  const safeCustom = customRules && typeof customRules === "object" ? customRules : {};
  const stages = new Set([...Object.keys(defaultRules), ...Object.keys(safeCustom)]);

  for (const stage of stages) {
    if (Object.prototype.hasOwnProperty.call(safeCustom, stage)) {
      merged[stage] = normalizeRuleList(safeCustom[stage]);
      continue;
    }
    merged[stage] = normalizeRuleList(defaultRules[stage]);
  }

  return merged;
}

function normalizeSuggestions(rule, fallbackMessage) {
  if (Array.isArray(rule?.suggestions)) {
    return rule.suggestions
      .filter((s) => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof rule?.suggestion === "string") {
    const s = rule.suggestion.trim();
    return s ? [s] : [];
  }
  return fallbackMessage ? [fallbackMessage] : [];
}

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * 审查规则引擎 - 用于检查 Stage 输出质量
 * @example
 * const rules = new ReviewRules();
 * const result = rules.check('deepsearch.scan', { tocNodes: [] });
 * // { pass: false, severity: 'warning', reason: 'No TOC', suggestions: ['...'] }
 */
export class ReviewRules {
  /**
   * @param {Object} rules - 自定义规则配置，会与 defaultRules 合并
   */
  constructor(rules = {}) {
    this.rules = mergeRules(ReviewRules.defaultRules, rules);
  }

  /**
   * 检查 Stage 输出
   * @param {string} stage - Stage 名称 (如 'deepsearch.scan')
   * @param {Object} result - Stage 输出结果
   * @returns {{ pass: boolean, severity: 'error'|'warning'|'info', reason: string, suggestions: string[] }}
   */
  check(stage, result) {
    const ruleList = typeof stage === "string" ? this.rules?.[stage] : null;
    if (!Array.isArray(ruleList) || ruleList.length === 0) {
      return { pass: true, severity: "info", reason: "", suggestions: [] };
    }

    let failed = false;
    let maxRank = -1;
    let reason = "";
    const suggestions = [];

    for (const rule of ruleList) {
      if (!rule || typeof rule !== "object") continue;
      if (typeof rule.check !== "function") continue;

      let ok = false;
      try {
        ok = Boolean(rule.check(result));
      } catch {
        ok = false;
      }
      if (ok) continue;

      failed = true;

      const severity = normalizeSeverity(rule.severity);
      const rank = SEVERITY_RANK[severity];

      const message = typeof rule.message === "string" ? rule.message : "";
      const ruleSuggestions = normalizeSuggestions(rule, message);
      for (const s of ruleSuggestions) suggestions.push(s);

      if (rank > maxRank) {
        maxRank = rank;
        reason = message;
      } else if (rank === maxRank && !reason && message) {
        reason = message;
      }
    }

    if (!failed) {
      return { pass: true, severity: "info", reason: "", suggestions: [] };
    }

    const severity = RANK_TO_SEVERITY[Math.max(0, maxRank)] || "warning";
    const uniqSuggestions = uniqueStrings(suggestions);
    const finalReason = reason || uniqSuggestions[0] || "Rule check failed";

    return {
      pass: false,
      severity,
      reason: finalReason,
      suggestions: uniqSuggestions,
    };
  }

  /**
   * 内置规则集
   */
  static defaultRules = {
    "deepsearch.scan": [
      { check: (r) => r.tocNodes?.length > 0, severity: "warning", message: "No TOC extracted" },
      { check: (r) => r.documentInfo != null, severity: "error", message: "Missing document info" },
    ],
    "deepsearch.retrieve": [
      { check: (r) => r.retrievedChunks?.length > 0, severity: "error", message: "No chunks retrieved" },
      { check: (r) => r.relevanceScore > 0.3, severity: "warning", message: "Low relevance score" },
    ],
    "deepsearch.understand": [
      { check: (r) => r.concepts?.length > 0, severity: "warning", message: "No concepts extracted" },
    ],
    "design.layout": [
      { check: (r) => r.slides?.length > 0, severity: "error", message: "No slides generated" },
    ],
  };
}

