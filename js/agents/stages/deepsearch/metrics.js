/**
 * DeepSearch 度量衡接口
 *
 * 提供 Agent 运行时的评估指标收集和格式化
 */

/**
 * @typedef {Object} DeepSearchMetrics
 * @property {number} claimCoverage - 已验证 claims / 总 claims (0-1)
 * @property {number} evidenceTraceability - 有来源的 evidence / 总 evidence (0-1)
 * @property {number} gapFillRate - filled gaps / total gaps (0-1)
 * @property {number} backtrackCount - 回溯次数
 * @property {number} tokenEfficiency - claims / (total tokens / 1000)
 * @property {number} iteration - 当前迭代
 */

/**
 * 收集 DeepSearch 运行指标
 * @param {object} state - DeepSearchState 实例
 * @param {object} [backtrackManager] - BacktrackManager 实例
 * @returns {DeepSearchMetrics}
 */
export function collectMetrics(state, backtrackManager) {
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidence = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const tokenUsage = state?.L2?.tokenUsage || { total: 0 };

  const verifiedClaims = claims.filter((c) => c?.verified === true).length;
  const tracedEvidence = evidence.filter((e) => e?.sourceId || e?.chunkId).length;
  const filledGaps = gaps.filter((g) => g?.status === "filled").length;

  const totalTokens = typeof tokenUsage.total === "number" ? tokenUsage.total : 0;

  return {
    claimCoverage: claims.length > 0 ? verifiedClaims / claims.length : 0,
    evidenceTraceability: evidence.length > 0 ? tracedEvidence / evidence.length : 0,
    gapFillRate: gaps.length > 0 ? filledGaps / gaps.length : 0,
    backtrackCount: backtrackManager?.backtrackCount ?? 0,
    tokenEfficiency: totalTokens > 0 ? claims.length / (totalTokens / 1000) : 0,
    iteration: typeof state?.iteration === "number" ? state.iteration : 0,
  };
}

/**
 * 格式化指标报告为可读字符串
 * @param {DeepSearchMetrics} metrics
 * @returns {string}
 */
export function formatMetricsReport(metrics) {
  const m = metrics || {};
  const claimCov = typeof m.claimCoverage === "number" ? m.claimCoverage : 0;
  const evidenceTrace = typeof m.evidenceTraceability === "number" ? m.evidenceTraceability : 0;
  const gapFill = typeof m.gapFillRate === "number" ? m.gapFillRate : 0;
  const backtracks = typeof m.backtrackCount === "number" ? m.backtrackCount : 0;
  const tokenEff = typeof m.tokenEfficiency === "number" ? m.tokenEfficiency : 0;

  return [
    `Claim Coverage: ${(claimCov * 100).toFixed(1)}%`,
    `Evidence Traceability: ${(evidenceTrace * 100).toFixed(1)}%`,
    `Gap Fill Rate: ${(gapFill * 100).toFixed(1)}%`,
    `Backtracks: ${backtracks}`,
    `Token Efficiency: ${tokenEff.toFixed(2)} claims/k-tokens`,
  ].join(" | ");
}

/**
 * 验证指标是否达到质量门槛
 * @param {DeepSearchMetrics} metrics
 * @param {object} [thresholds] - 自定义阈值
 * @returns {{ passed: boolean, failures: string[] }}
 */
export function validateMetrics(metrics, thresholds = {}) {
  const defaults = {
    minClaimCoverage: 0.5,
    minEvidenceTraceability: 0.7,
    minGapFillRate: 0.6,
    maxBacktracks: 3,
  };
  const t = { ...defaults, ...thresholds };
  const m = metrics || {};
  const failures = [];

  if ((m.claimCoverage ?? 0) < t.minClaimCoverage) {
    failures.push(`claimCoverage ${((m.claimCoverage ?? 0) * 100).toFixed(1)}% < ${(t.minClaimCoverage * 100).toFixed(1)}%`);
  }
  if ((m.evidenceTraceability ?? 0) < t.minEvidenceTraceability) {
    failures.push(`evidenceTraceability ${((m.evidenceTraceability ?? 0) * 100).toFixed(1)}% < ${(t.minEvidenceTraceability * 100).toFixed(1)}%`);
  }
  if ((m.gapFillRate ?? 0) < t.minGapFillRate) {
    failures.push(`gapFillRate ${((m.gapFillRate ?? 0) * 100).toFixed(1)}% < ${(t.minGapFillRate * 100).toFixed(1)}%`);
  }
  if ((m.backtrackCount ?? 0) > t.maxBacktracks) {
    failures.push(`backtrackCount ${m.backtrackCount ?? 0} > ${t.maxBacktracks}`);
  }

  return { passed: failures.length === 0, failures };
}
