/**
 * record-finding skill handler
 *
 * 让 Agent 主动记录研究发现（claims, gaps, conflicts）
 * 自动同步到 SharedContext 供子代理/主代理共享
 */

import { makeSecureTimestampedId } from "../../../../shared/index.js";
import { toNonNegativeInt } from "../../../../shared/index.js";

/**
 * @typedef {'claim' | 'gap' | 'conflict'} FindingType
 */

/**
 * @typedef {'high' | 'medium' | 'low'} FindingPriority
 */

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {FindingType} type
 * @property {string} content
 * @property {string|null} source
 * @property {number|null} lineStart
 * @property {number|null} lineEnd
 * @property {string|null} ref
 * @property {string[]} sources
 * @property {number|null} confidence
 * @property {FindingPriority|null} priority
 * @property {string[]} tags
 * @property {number} createdAt
 */

/**
 * @typedef {object} FindingItem
 * @property {FindingType} type
 * @property {string} content
 * @property {string} [source]
 * @property {number} [lineStart]
 * @property {number} [lineEnd]
 * @property {string[]} [sources]
 * @property {number} [confidence]
 * @property {FindingPriority} [priority]
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} SharedContext
 * @property {(content: string) => boolean} [hasSeen]
 * @property {(content: string) => void} [markSeen]
 * @property {(type: string, data: object) => void} [commit]
 * @property {(query: string) => Array<object>} [search]
 */

/**
 * @typedef {object} RecordFindingContext
 * @property {object} state
 * @property {(event: string, data?: object) => void} [emit]
 * @property {SharedContext} [sharedContext]
 */

/**
 * @typedef {object} FindingRecordResult
 * @property {boolean} success
 * @property {Finding} [finding]
 * @property {string} [error]
 * @property {string} [reason]
 * @property {string} [content]
 * @property {number} [index]
 */

export const definition = {
  name: "record-finding",
  description: `记录研究发现（支持批量）。用于记录 claims（论点）、gaps（信息缺口）、conflicts（矛盾点）。

**单条记录**:
- record-finding { type: "claim", content: "...", source: "文档ID", lineStart: 18, lineEnd: 26, confidence: 0.8 }

**批量记录（推荐）**:
- record-finding { findings: [{ type: "claim", content: "...", source: "文档ID", lineStart: 18, lineEnd: 26 }, { type: "gap", content: "..." }] }

**引用格式**: 记录时请提供 source（文档ID）和 lineStart/lineEnd（行号范围），用于生成可跳转引用 [source:L{start}-L{end}]`,
  layer: 0,
  activation: {
    keywords: ["记录", "发现", "claim", "gap", "conflict", "矛盾", "缺口"],
    phases: ["researching", "analyzing"],
  },
  parameters: {
    findings: "批量发现数组（推荐），每项包含 type/content/source/lineStart/lineEnd 等字段",
    type: "发现类型：claim | gap | conflict（单条时必需）",
    content: "发现内容（单条时必需）",
    source: "来源文档ID（与 read-doc 返回的 sourceId 一致）",
    lineStart: "起始行号（1-based，来自 read-doc 返回）",
    lineEnd: "结束行号（1-based，来自 read-doc 返回）",
    sources: "多来源引用（用于 conflict）",
    confidence: "置信度 0-1（用于 claim）",
    priority: "优先级：high | medium | low（用于 gap）",
    tags: "标签数组，用于分类和检索",
  },
};

/**
 * 提取关键词（用于索引）
 */
function extractKeywords(text, maxCount = 5) {
  const matches = String(text || "").match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}/g) || [];
  return [...new Set(matches)].slice(0, maxCount);
}

function resolveGapFindingBudget(state) {
  const cfg = state?.userConfig?.gaps && typeof state.userConfig.gaps === "object" ? state.userConfig.gaps : {};
  const maxTotal = toNonNegativeInt(cfg.maxFindingGaps ?? cfg.maxGapFindings ?? cfg.maxGaps, 50);
  const maxPerCall = toNonNegativeInt(cfg.maxNewGapFindingsPerCall ?? cfg.maxGapGrowthPerIteration ?? cfg.maxNewGapsPerCall, 10);
  return {
    maxTotal,      // 0 disables cap
    maxPerCall,    // 0 disables cap
  };
}

/**
 * 处理单条发现
 * @param {FindingItem} item
 * @param {RecordFindingContext} context
 * @returns {FindingRecordResult}
 */
function processSingleFinding(item, context) {
  const { state, emit, sharedContext } = context;
  const { type, content, source, sources, confidence, priority, tags, lineStart, lineEnd } = item;

  if (!type || !["claim", "gap", "conflict"].includes(type)) {
    return { success: false, error: "type must be one of: claim, gap, conflict" };
  }
  if (!content || typeof content !== "string" || !content.trim()) {
    return { success: false, error: "content is required" };
  }

  const trimmedContent = content.trim();

  if (sharedContext?.hasSeen?.(trimmedContent)) {
    return { success: false, error: "duplicate", content: trimmedContent.slice(0, 50) };
  }

  // 输入校验：行号必须为正整数且 lineStart <= lineEnd
  const validLineStart = Number.isFinite(lineStart) && Number.isInteger(lineStart) && lineStart > 0 ? lineStart : null;
  const validLineEnd = Number.isFinite(lineEnd) && Number.isInteger(lineEnd) && lineEnd > 0 ? lineEnd : null;
  // 确保 lineStart <= lineEnd
  const normalizedLineStart = (validLineStart && validLineEnd && validLineStart > validLineEnd) ? validLineEnd : validLineStart;
  const normalizedLineEnd = (validLineStart && validLineEnd && validLineStart > validLineEnd) ? validLineStart : validLineEnd;

  // 输入校验：priority 白名单
  const VALID_PRIORITIES = ["high", "medium", "low"];
  const validPriority = typeof priority === "string" && VALID_PRIORITIES.includes(priority) ? priority : "medium";

  // 输入校验：tags 必须为字符串数组
  const validTags = Array.isArray(tags) ? tags.filter(t => typeof t === "string") : [];

  // 输入校验：sources 必须为字符串数组
  const validSource = typeof source === "string" && source.trim() ? source.trim() : null;
  const validSources = Array.isArray(sources)
    ? sources.filter(s => typeof s === "string" && s.trim())
    : (validSource ? [validSource] : []);

  // 构建标准引用格式
  let ref = null;
  if (validSource) {
    if (normalizedLineStart && normalizedLineEnd && normalizedLineStart !== normalizedLineEnd) {
      ref = `[${validSource}:L${normalizedLineStart}-L${normalizedLineEnd}]`;
    } else if (normalizedLineStart) {
      ref = `[${validSource}:L${normalizedLineStart}]`;
    } else {
      ref = `[${validSource}]`;
    }
  }

  const finding = {
    id: makeSecureTimestampedId(type),
    type,
    content: trimmedContent,
    source: validSource,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
    ref, // 标准引用格式
    sources: validSources,
    confidence: type === "claim" ? (Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7) : null,
    priority: type === "gap" ? validPriority : null,
    tags: validTags,
    createdAt: Date.now(),
  };

  const keywords = [
    type, `finding_${type}`,
    ...(finding.tags || []),
    ...extractKeywords(trimmedContent),
    ...(finding.source ? [finding.source] : []),
  ];

  if (sharedContext) {
    sharedContext.markSeen(trimmedContent);
    sharedContext.commit(`finding_${type}`, {
      full: finding,
      summary: `[${type}${finding.confidence ? `:${(finding.confidence * 100).toFixed(0)}%` : ""}] ${trimmedContent.slice(0, 60)}`,
      keywords,
    });
  }

  if (!state.L1) state.L1 = {};
  if (!state.L1.findingIds) state.L1.findingIds = { claim: [], gap: [], conflict: [] };
  state.L1.findingIds[type]?.push(finding.id);

  emit?.(`deepsearch.finding.${type}`, { id: finding.id, content: trimmedContent.slice(0, 100) });

  return { success: true, finding };
}

/**
 * @typedef {object} GapBudget
 * @property {number} maxTotal
 * @property {number} maxPerCall
 */

/**
 * @typedef {object} GapBudgetCheck
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [reason]
 */

/**
 * 创建 gap 预算检查器
 * @param {GapBudget} gapBudget
 * @param {number} existingGapCount
 * @returns {{ canAddGap: () => GapBudgetCheck, incrementGap: () => void }}
 */
function createGapBudgetChecker(gapBudget, existingGapCount) {
  let gapAddedThisCall = 0;
  return {
    canAddGap: () => {
      if (gapBudget.maxTotal > 0 && existingGapCount + gapAddedThisCall >= gapBudget.maxTotal) {
        return { ok: false, error: "gap_budget_exceeded", reason: "max_total" };
      }
      if (gapBudget.maxPerCall > 0 && gapAddedThisCall >= gapBudget.maxPerCall) {
        return { ok: false, error: "gap_budget_exceeded", reason: "max_per_call" };
      }
      return { ok: true };
    },
    incrementGap: () => { gapAddedThisCall += 1; },
  };
}

/**
 * 构建统计信息
 * @param {SharedContext} [sharedContext]
 * @returns {{ claims: number, gaps: number, conflicts: number }}
 */
function buildStats(sharedContext) {
  if (!sharedContext?.search) return { claims: 0, gaps: 0, conflicts: 0 };
  return {
    claims: sharedContext.search("finding_claim").length,
    gaps: sharedContext.search("finding_gap").length,
    conflicts: sharedContext.search("finding_conflict").length,
  };
}

/**
 * 处理批量发现
 * @param {FindingItem[]} items
 * @param {RecordFindingContext} context
 * @param {{ canAddGap: () => GapBudgetCheck, incrementGap: () => void }} budgetChecker
 * @returns {object}
 */
function processBatchFindings(items, context, budgetChecker) {
  if (items.length === 0) {
    return { success: true, recorded: 0, skipped: 0, findings: [], errors: [], stats: buildStats(context.sharedContext) };
  }

  /** @type {FindingRecordResult[]} */
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item?.type === "gap") {
      const budget = budgetChecker.canAddGap();
      if (!budget.ok) {
        results.push({
          success: false,
          error: budget.error,
          reason: budget.reason,
          index: i,
          content: item?.content?.slice?.(0, 50) || `[item ${i}]`,
        });
        continue;
      }
    }

    const r = /** @type {FindingRecordResult} */ (processSingleFinding(item, context));
    if (!r.success) r.index = i;
    if (!r.success && !r.content) r.content = item?.content?.slice?.(0, 50) || `[item ${i}]`;
    if (r.success && item?.type === "gap") budgetChecker.incrementGap();
    results.push(r);
  }

  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  return {
    success: succeeded.length > 0,
    recorded: succeeded.length,
    skipped: failed.length,
    findings: succeeded.map(r => r.finding),
    errors: failed.map(r => ({ error: r.error, content: r.content, index: r.index })),
    stats: buildStats(context.sharedContext),
  };
}

/**
 * @typedef {object} RecordFindingArgs
 * @property {FindingItem[]} [findings]
 * @property {FindingType} [type]
 * @property {string} [content]
 * @property {string} [source]
 * @property {number} [lineStart]
 * @property {number} [lineEnd]
 * @property {string[]} [sources]
 * @property {number} [confidence]
 * @property {FindingPriority} [priority]
 * @property {string[]} [tags]
 */

/**
 * record-finding handler 入口
 * @param {RecordFindingArgs} args
 * @param {RecordFindingContext} context
 */
export async function handler(args, context) {
  const { sharedContext, state } = context;
  const gapBudget = resolveGapFindingBudget(state);
  const existingGapCount = sharedContext?.search ? sharedContext.search("finding_gap").length : 0;
  const budgetChecker = createGapBudgetChecker(gapBudget, existingGapCount);

  // 批量模式
  if (Array.isArray(args.findings)) {
    return processBatchFindings(args.findings, context, budgetChecker);
  }

  // 单条模式
  if (args?.type === "gap") {
    const budget = budgetChecker.canAddGap();
    if (!budget.ok) {
      return { success: false, error: budget.error, reason: budget.reason, hint: "Too many gaps; consolidate or raise userConfig.gaps.maxFindingGaps." };
    }
  }

  const result = processSingleFinding(/** @type {FindingItem} */ (args), context);
  if (!result.success) return result;
  if (args?.type === "gap") budgetChecker.incrementGap();

  return { ...result, stats: buildStats(sharedContext) };
}

export default { definition, handler };
