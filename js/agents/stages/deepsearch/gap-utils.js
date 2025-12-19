import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/value-utils.js";
import { GAP_CONFIG } from "./constants.js";
import { DeepSearchEvents } from "./events.js";

export const GapStatus = Object.freeze({
  OPEN: "open",
  SEARCHING: "searching",       // 正在检索
  UNDERSTANDING: "understanding", // 正在理解
  FILLED: "filled",
  BLOCKED: "blocked",
});

/**
 * 统一的 gap 状态转换函数，确保字段一致性
 */
export function transitionGap(g, to, { runId, iteration, reason, ts, evidenceCount }, emitFn) {
  const from = toNonEmptyString(g?.status) || GapStatus.OPEN;
  if (from === to) return false; // 无转换

  const gapId = toNonEmptyString(g?.gapId) || "unknown";
  const effectiveReason =
    reason ||
    (to === GapStatus.FILLED
      ? "evidence"
      : to === GapStatus.SEARCHING
        ? "searching"
        : to === GapStatus.UNDERSTANDING
          ? "understanding"
          : to === GapStatus.BLOCKED
            ? "no_hits"
            : "reopen");

  if (to === GapStatus.FILLED) {
    g.status = GapStatus.FILLED;
    g.filledAt = ts;
    g.filledIteration = iteration;
    if (typeof evidenceCount === "number") g.evidenceCount = evidenceCount;
    // 清理 blocked 相关字段
    delete g.blockedAt;
    delete g.blockedReason;
    // 清理中间状态字段
    delete g.searchStartedAt;
    delete g.understandStartedAt;
  } else if (to === GapStatus.SEARCHING) {
    g.status = GapStatus.SEARCHING;
    g.searchStartedAt = ts;
    // 清理终态相关字段
    delete g.filledAt;
    delete g.filledIteration;
    delete g.evidenceCount;
    delete g.blockedAt;
    delete g.blockedReason;
  } else if (to === GapStatus.UNDERSTANDING) {
    g.status = GapStatus.UNDERSTANDING;
    g.understandStartedAt = ts;
    // 清理终态相关字段
    delete g.filledAt;
    delete g.filledIteration;
    delete g.evidenceCount;
    delete g.blockedAt;
    delete g.blockedReason;
  } else if (to === GapStatus.BLOCKED) {
    g.status = GapStatus.BLOCKED;
    g.blockedAt = ts;
    g.blockedReason = String(g.blockedReason || reason || "no_retrieval_hits");
    // 清理 filled 相关字段
    delete g.filledAt;
    delete g.filledIteration;
    delete g.evidenceCount;
    // 清理中间状态字段
    delete g.searchStartedAt;
    delete g.understandStartedAt;
  } else {
    // OPEN
    g.status = GapStatus.OPEN;
    g.missCount = 0;
    delete g.filledAt;
    delete g.filledIteration;
    delete g.evidenceCount;
    delete g.blockedAt;
    delete g.blockedReason;
    delete g.searchStartedAt;
    delete g.understandStartedAt;
  }

  emitFn?.(DeepSearchEvents.GAP_STATUS_CHANGED, {
    runId,
    gapId,
    from,
    to: g.status,
    reason: effectiveReason,
    iteration,
  });

  return true;
}

export function normalizeRoundHits(roundHits) {
  if (roundHits instanceof Map) return roundHits;

  const hits = new Map();

  if (Array.isArray(roundHits)) {
    for (const gid of roundHits.map((x) => toNonEmptyString(x)).filter(Boolean)) {
      hits.set(gid, (hits.get(gid) || 0) + 1);
    }
    return hits;
  }

  if (isPlainObject(roundHits)) {
    for (const [k, v] of Object.entries(roundHits)) {
      const gid = toNonEmptyString(k);
      if (!gid) continue;
      const n = safeInt(v);
      hits.set(gid, n !== null && n > 0 ? n : 0);
    }
    return hits;
  }

  return hits;
}

export function computeRoundHitsByGapId(roundHits, qualityThreshold = GAP_CONFIG.QUALITY_THRESHOLD) {
  const allHits = new Map();
  const qualityHits = new Map();
  const threshold = typeof qualityThreshold === "number" && Number.isFinite(qualityThreshold) ? qualityThreshold : GAP_CONFIG.QUALITY_THRESHOLD;

  const bump = (m, gid) => m.set(gid, (m.get(gid) || 0) + 1);

  for (const r of Array.isArray(roundHits) ? roundHits : []) {
    const score = typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : 0;
    const matched = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map((x) => toNonEmptyString(x)).filter(Boolean) : [];
    const gids = matched.length ? [...new Set(matched)] : [toNonEmptyString(r?.gapId)].filter(Boolean);
    if (!gids.length) continue;

    for (const gid of gids) {
      bump(allHits, gid);
      if (score >= threshold) bump(qualityHits, gid);
    }
  }

  return { allHits, qualityHits };
}
