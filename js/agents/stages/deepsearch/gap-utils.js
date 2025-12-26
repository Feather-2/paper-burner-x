/**
 * Gap Utils - 简化版（兼容层）
 */

export const GapStatus = Object.freeze({
  OPEN: "open",
  FILLED: "filled",
  BLOCKED: "blocked",
});

export function transitionGap(gap, newStatus, meta, emitFn) {
  if (!gap) return false;
  const oldStatus = gap.status || GapStatus.OPEN;
  if (oldStatus === newStatus) return false;

  gap.status = newStatus;
  gap.updatedAt = meta?.ts || Date.now();

  if (emitFn) {
    emitFn("deepsearch.gap.transitioned", {
      gapId: gap.gapId,
      from: oldStatus,
      to: newStatus,
    });
  }

  return true;
}

export function computeRoundHitsByGapId(gaps) {
  const result = new Map();
  for (const g of gaps || []) {
    if (g?.gapId) {
      result.set(g.gapId, g.hitCount || 0);
    }
  }
  return result;
}

export function normalizeRoundHits(hits) {
  if (hits instanceof Map) return hits;
  if (typeof hits === "object" && hits !== null) {
    return new Map(Object.entries(hits));
  }
  return new Map();
}

export default {
  GapStatus,
  transitionGap,
  computeRoundHitsByGapId,
  normalizeRoundHits,
};
