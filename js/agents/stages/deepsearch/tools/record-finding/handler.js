/**
 * record-finding skill handler
 *
 * 让 Agent 主动记录研究发现（claims, gaps, conflicts）
 * 自动同步到 SharedContext 供子代理/主代理共享
 */

import { makeSecureTimestampedId } from "../../../../shared/utils/secure-id.js";
import { toNonNegativeInt } from "../../../../shared/utils/value-utils.js";

/**
 * @typedef {object} FindingRecordResult
 * @property {boolean} success
 * @property {any=} finding
 * @property {string=} error
 * @property {string=} reason
 * @property {string=} content
 * @property {number=} index
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
 */
/**
 * @param {any} item
 * @param {any} context
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

  // 构建标准引用格式
  let ref = null;
  if (source) {
    if (lineStart && lineEnd && lineStart !== lineEnd) {
      ref = `[${source}:L${lineStart}-L${lineEnd}]`;
    } else if (lineStart) {
      ref = `[${source}:L${lineStart}]`;
    } else {
      ref = `[${source}]`;
    }
  }

  const finding = {
    id: makeSecureTimestampedId(type),
    type,
    content: trimmedContent,
    source: source || null,
    lineStart: Number.isFinite(lineStart) ? lineStart : null,
    lineEnd: Number.isFinite(lineEnd) ? lineEnd : null,
    ref, // 标准引用格式
    sources: Array.isArray(sources) ? sources : (source ? [source] : []),
    confidence: type === "claim" ? (Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7) : null,
    priority: type === "gap" ? (priority || "medium") : null,
    tags: Array.isArray(tags) ? tags : [],
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
 * @param {Object} args
 * @param {Array} [args.findings] - 批量发现数组
 * @param {string} [args.type] - claim | gap | conflict（单条时）
 * @param {string} [args.content] - 发现内容（单条时）
 * @param {Object} context - { state, emit, sharedContext }
 */
export async function handler(args, context) {
  const { sharedContext, state } = context;
  const gapBudget = resolveGapFindingBudget(state);
  const existingGapCount = sharedContext?.search ? sharedContext.search("finding_gap").length : 0;
  let gapAddedThisCall = 0;
  const canAddGap = () => {
    if (gapBudget.maxTotal > 0 && existingGapCount + gapAddedThisCall >= gapBudget.maxTotal) {
      return { ok: false, error: "gap_budget_exceeded", reason: "max_total" };
    }
    if (gapBudget.maxPerCall > 0 && gapAddedThisCall >= gapBudget.maxPerCall) {
      return { ok: false, error: "gap_budget_exceeded", reason: "max_per_call" };
    }
    return { ok: true };
  };

  // 批量模式：显式传入 findings 数组
  if (Array.isArray(args.findings)) {
    if (args.findings.length === 0) {
      return { success: true, recorded: 0, skipped: 0, findings: [], errors: [], stats: { claims: 0, gaps: 0, conflicts: 0 } };
    }
    /** @type {FindingRecordResult[]} */
    const results = [];
    for (let i = 0; i < args.findings.length; i++) {
      const item = args.findings[i];
      if (item?.type === "gap") {
        const budget = canAddGap();
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
      if (!r.success) r.index = i; // 记录原始索引便于调试
      if (!r.success && !r.content) r.content = item?.content?.slice?.(0, 50) || `[item ${i}]`;
      if (r.success && item?.type === "gap") gapAddedThisCall += 1;
      results.push(r);
    }
    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const stats = sharedContext ? {
      claims: sharedContext.search("finding_claim").length,
      gaps: sharedContext.search("finding_gap").length,
      conflicts: sharedContext.search("finding_conflict").length,
    } : { claims: 0, gaps: 0, conflicts: 0 };

    return {
      success: succeeded.length > 0,
      recorded: succeeded.length,
      skipped: failed.length,
      findings: succeeded.map(r => r.finding),
      errors: failed.map(r => ({ error: r.error, content: r.content, index: r.index })),
      stats,
    };
  }

  // 单条模式（向后兼容）
  if (args?.type === "gap") {
    const budget = canAddGap();
    if (!budget.ok) {
      return { success: false, error: budget.error, reason: budget.reason, hint: "Too many gaps; consolidate or raise userConfig.gaps.maxFindingGaps." };
    }
  }
  const result = processSingleFinding(args, context);
  if (!result.success) return result;
  if (args?.type === "gap") gapAddedThisCall += 1;

  const stats = sharedContext ? {
    claims: sharedContext.search("finding_claim").length,
    gaps: sharedContext.search("finding_gap").length,
    conflicts: sharedContext.search("finding_conflict").length,
  } : { claims: 0, gaps: 0, conflicts: 0 };

  return { ...result, stats };
}

export default { definition, handler };
