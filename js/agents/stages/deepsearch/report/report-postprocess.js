import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { createSafeRegex } from "../../../shared/index.js";

/**
 * @typedef {"quick"|"wider"|"deeper"} ReportMode
 *
 * @typedef {object} ReportRequirements
 * @property {number} minWords
 * @property {number} minReferences
 * @property {string[]} requiredSections
 * @property {string[]} recommendedSections
 * @property {Record<string, number>} sectionWordLimits
 *
 * @typedef {object} ReportReviewIssue
 * @property {string} type
 * @property {any=} items
 * @property {number=} count
 *
 * @typedef {object} ReportReviewResult
 * @property {string} markdown
 * @property {ReportReviewIssue[]} issues
 * @property {boolean} fixed
 * @property {number} originalLength
 * @property {number} fixedLength
 *
 * @typedef {object} ReportValidationResult
 * @property {boolean} valid
 * @property {string[]} issues
 * @property {string[]} warnings
 * @property {number} wordCount
 * @property {number} referenceCount
 * @property {string} mode
 * @property {ReportRequirements} requirements
 *
 * @typedef {object} ReportProgress
 * @property {number} wordCount
 * @property {number} wordTarget
 * @property {string} wordProgress
 * @property {number} referenceCount
 * @property {number} referenceTarget
 * @property {string} refProgress
 * @property {string[]} missingSections
 * @property {string} sectionProgress
 * @property {string} overallProgress
 * @property {boolean} isReady
 * @property {string} hint
 *
 * @typedef {object} PreparedReportSubmit
 * @property {string} markdown
 * @property {ReportReviewResult} review
 * @property {ReportValidationResult} validation
 */

const DEFAULT_REPORT_REQUIREMENTS = Object.freeze({
  quick: { minWords: 4000, minReferences: 1, requiredSections: ["摘要", "发现"], recommendedSections: ["信息缺口", "结论"] },
  wider: {
    minWords: 6000,
    minReferences: 3,
    requiredSections: ["摘要", "核心发现", "共识与分歧", "信息缺口"],
    recommendedSections: ["方法说明", "结论", "下一步建议"],
  },
  deeper: {
    minWords: 10000,
    minReferences: 5,
    requiredSections: ["摘要", "核心发现", "共识与分歧", "信息缺口", "方法论评价", "局限性"],
    recommendedSections: ["详细分析", "证据链", "结论", "下一步建议"],
  },
});

const REFERENCE_PATTERN = /\[([^\]]+)[:：]([^\]]+)\]/g;
const REFERENCE_TEST_PATTERN = /\[([^\]]+)[:：]([^\]]+)\]/;

/**
 * Resolve report requirements by mode (defaults merged with global/state config).
 * @param {any} state
 * @param {ReportMode|string} mode
 * @returns {ReportRequirements}
 */
export function getReportConfig(state, mode) {
  const m = toNonEmptyString(mode) || "wider";
  const globalConfig = state?.globalConfig?.report?.[m];
  const stateConfig = state?.reportConfig?.[m];

  const base = DEFAULT_REPORT_REQUIREMENTS[m] || DEFAULT_REPORT_REQUIREMENTS.wider;
  const merged = { ...base, ...(isPlainObject(globalConfig) ? globalConfig : {}), ...(isPlainObject(stateConfig) ? stateConfig : {}) };

  return {
    minWords: merged.minWords ?? base.minWords,
    minReferences: merged.minReferences ?? base.minReferences,
    requiredSections: merged.requiredSections ?? base.requiredSections,
    recommendedSections: merged.recommendedSections ?? base.recommendedSections,
    sectionWordLimits: merged.sectionWordLimits || {},
  };
}

/**
 * Count non-whitespace characters (best-effort word-count proxy for mixed CJK/Latin text).
 * @param {string} text
 * @returns {number}
 */
export function countNonWhitespaceChars(text) {
  const src = typeof text === "string" ? text : "";
  return src.replace(/\s+/g, "").length;
}

/**
 * Count reference markers in markdown (e.g. `[来源:页码]`).
 * @param {string} markdown
 * @returns {number}
 */
export function countReferences(markdown) {
  const src = typeof markdown === "string" ? markdown : "";
  return (src.match(REFERENCE_PATTERN) || []).length;
}

/**
 * 重排序报告章节：将参考文献/附录移到最后，并合并重复章节
 * @param {string} markdown
 * @returns {string}
 */
export function reorderReportSections(markdown) {
  const src = typeof markdown === "string" ? markdown : "";
  if (!src) return src;

  const lines = src.split("\n");
  const sections = [];
  let current = { lines: [], isTrailing: false, title: "" };

  const trailingPatterns = [/^##?\s*参考文献/i, /^##?\s*references/i, /^##?\s*附录/i, /^##?\s*appendix/i];
  const dedupePatterns = [/^##?\s*参考文献/i, /^##?\s*references/i, /^##?\s*结论/i, /^##?\s*conclusion/i];

  for (const line of lines) {
    if (/^##?\s+/.test(line)) {
      if (current.lines.length > 0) sections.push(current);
      const isTrailing = trailingPatterns.some((p) => p.test(line));
      current = { lines: [line], isTrailing, title: line.replace(/^#+\s*/, "").trim().toLowerCase() };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) sections.push(current);

  const seen = new Map();
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i];
    const shouldDedupe = dedupePatterns.some((p) => p.test(s.lines[0] || ""));
    if (!shouldDedupe) continue;

    const key = s.title.replace(/[^a-z\u4e00-\u9fa5]/g, "");
    if (seen.has(key)) {
      const existing = seen.get(key);
      existing.lines.push(...s.lines.slice(1));
      sections.splice(i, 1);
    } else {
      seen.set(key, s);
    }
  }

  const normal = sections.filter((s) => !s.isTrailing);
  const trailing = sections.filter((s) => s.isTrailing);

  return [...normal, ...trailing].map((s) => s.lines.join("\n")).join("\n");
}

/**
 * 审查报告并执行去重/修复：重复标题、重复段落、断裂格式
 * @param {string} markdown
 * @returns {ReportReviewResult}
 */
export function reviewReportMarkdown(markdown) {
  const src = typeof markdown === "string" ? markdown : "";
  if (!src) {
    return { markdown: src, issues: [], fixed: false, originalLength: 0, fixedLength: 0 };
  }

  const issues = [];
  let fixed = src;

  const headingPattern = /^(#{1,6}\s+\d*\.?\s*.+)$/gm;
  const headings = [...src.matchAll(headingPattern)].map((m) => m[1].trim());
  const headingCounts = {};
  for (const h of headings) headingCounts[h] = (headingCounts[h] || 0) + 1;
  const duplicateHeadings = Object.entries(headingCounts).filter(([, c]) => c > 1);

  if (duplicateHeadings.length > 0) {
    issues.push({ type: "duplicate_heading", items: duplicateHeadings.map(([h, c]) => `${h} (${c}次)`) });

    for (const [heading] of duplicateHeadings) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const level = (heading.match(/^#+/) || [""])[0].length;
      const firstIdx = fixed.indexOf(heading);
      if (firstIdx < 0) continue;

      let match;
      const regex = createSafeRegex(`^${escaped}`, "gm");
      regex.lastIndex = firstIdx + heading.length;
      while ((match = regex.exec(fixed)) !== null) {
        const afterDup = fixed.slice(match.index + heading.length);
        const nextHeadingMatch = afterDup.match(createSafeRegex(`^#{1,${level}}\\s`, "m"));
        const endIdx = nextHeadingMatch ? match.index + heading.length + nextHeadingMatch.index : match.index + heading.length;
        fixed = fixed.slice(0, match.index) + fixed.slice(endIdx);
        regex.lastIndex = match.index;
      }
    }
  }

  const paragraphs = fixed.split(/\n\n+/);
  const seenParagraphs = new Set();
  const dedupedParagraphs = [];
  let duplicateParagraphCount = 0;
  for (const p of paragraphs) {
    const normalized = p.trim();
    if (!normalized) continue;
    if (normalized.length > 50 && seenParagraphs.has(normalized)) {
      duplicateParagraphCount++;
      continue;
    }
    seenParagraphs.add(normalized);
    dedupedParagraphs.push(p);
  }
  if (duplicateParagraphCount > 0) {
    issues.push({ type: "duplicate_paragraph", count: duplicateParagraphCount });
    fixed = dedupedParagraphs.join("\n\n");
  }

  const brokenBold = fixed.match(/\*\*\s*\n+\s*\*\*/g);
  if (brokenBold) {
    issues.push({ type: "broken_formatting", count: brokenBold.length });
    fixed = fixed.replace(/\*\*\s*\n+\s*\*\*/g, "**");
  }

  return {
    markdown: fixed,
    issues,
    fixed: fixed !== src,
    originalLength: src.length,
    fixedLength: fixed.length,
  };
}

/**
 * Validate a report against per-mode requirements (length, sections, citations).
 * @param {string} markdown
 * @param {ReportMode|string} [mode]
 * @param {any} [state]
 * @returns {ReportValidationResult}
 */
export function validateReport(markdown, mode = "wider", state = null) {
  const requirements = getReportConfig(state, mode);
  const issues = [];
  const warnings = [];

  const wordCount = countNonWhitespaceChars(markdown);
  if (wordCount < requirements.minWords) {
    issues.push(`字数不足：当前 ${wordCount} 字，${mode} 模式要求至少 ${requirements.minWords} 字`);
  }

  for (const section of requirements.requiredSections) {
    if (!markdown.includes(section)) issues.push(`缺少必需章节：${section}`);
  }

  for (const section of requirements.recommendedSections) {
    if (!markdown.includes(section)) warnings.push(`建议添加章节：${section}`);
  }

  const references = markdown.match(REFERENCE_PATTERN) || [];
  const minReferences = requirements.minReferences || { quick: 1, wider: 3, deeper: 5 }[mode] || 3;
  if (references.length < minReferences) {
    issues.push(`引用不足：当前 ${references.length} 处引用，${mode} 模式要求至少 ${minReferences} 处 [来源:页码] 格式引用`);
  }

  const highConfidencePattern = /🟢[^🟢🟡🔴\n]{0,200}/g;
  const highConfidenceMatches = markdown.match(highConfidencePattern) || [];
  for (const match of highConfidenceMatches) {
    if (!REFERENCE_TEST_PATTERN.test(match)) {
      issues.push("空洞断言：标注了 🟢高置信度 但没有引用支撑");
      break;
    }
  }

  const hasGapSection =
    markdown.includes("缺口") || markdown.includes("gap") || markdown.includes("未覆盖") || markdown.includes("不足") || markdown.includes("❓");
  if (!hasGapSection) {
    if (mode === "quick") warnings.push("建议明确标注信息缺口");
    else issues.push(`缺少信息缺口：${mode} 模式必须包含信息缺口章节`);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    wordCount,
    referenceCount: references.length,
    mode,
    requirements,
  };
}

/**
 * Compute progress metrics for a partially written report.
 * @param {{markdown?: string}|null|undefined} report
 * @param {ReportMode|string} mode
 * @param {any} state
 * @returns {ReportProgress}
 */
export function getReportProgress(report, mode, state) {
  const markdown = typeof report?.markdown === "string" ? report.markdown : "";
  const requirements = getReportConfig(state, mode);

  const wordCount = countNonWhitespaceChars(markdown);
  const referenceCount = countReferences(markdown);
  const missingSections = requirements.requiredSections.filter((s) => !markdown.includes(s));

  const wordProgress = Math.min(100, Math.round((wordCount / requirements.minWords) * 100));
  const refProgress = Math.min(100, Math.round((referenceCount / (requirements.minReferences || 3)) * 100));
  const sectionProgress = Math.round(((requirements.requiredSections.length - missingSections.length) / requirements.requiredSections.length) * 100);
  const overallProgress = Math.round((wordProgress + refProgress + sectionProgress) / 3);

  return {
    wordCount,
    wordTarget: requirements.minWords,
    wordProgress: `${wordProgress}%`,
    referenceCount,
    referenceTarget: requirements.minReferences || 3,
    refProgress: `${refProgress}%`,
    missingSections,
    sectionProgress: `${sectionProgress}%`,
    overallProgress: `${overallProgress}%`,
    isReady: wordProgress >= 100 && refProgress >= 100 && missingSections.length === 0,
    hint:
      wordProgress < 100
        ? `还需 ${requirements.minWords - wordCount} 字`
        : missingSections.length > 0
          ? `缺少章节: ${missingSections.join(", ")}`
          : referenceCount < (requirements.minReferences || 3)
            ? `还需 ${(requirements.minReferences || 3) - referenceCount} 处引用`
            : "✅ 可以提交",
  };
}

/**
 * Prepare report markdown for submit: reorder sections then validate.
 * @param {string} markdown
 * @param {ReportMode|string} mode
 * @param {any} state
 * @returns {PreparedReportSubmit}
 */
export function prepareReportForSubmit(markdown, mode, state) {
  const src = typeof markdown === "string" ? markdown : "";
  // NOTE: submit 默认只做结构重排 + 严格校验；review 属于显式动作（避免自动删除重复标题导致丢内容）。
  const reviewed = {
    markdown: src,
    issues: [],
    fixed: false,
    originalLength: src.length,
    fixedLength: src.length,
  };
  const reordered = reorderReportSections(src);
  const validation = validateReport(reordered, mode, state);
  return {
    markdown: reordered,
    review: reviewed,
    validation,
  };
}

export default {
  getReportConfig,
  reorderReportSections,
  reviewReportMarkdown,
  validateReport,
  getReportProgress,
  prepareReportForSubmit,
  countNonWhitespaceChars,
  countReferences,
};
