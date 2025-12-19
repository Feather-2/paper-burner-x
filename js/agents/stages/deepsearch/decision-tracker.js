/**
 * 决策追踪辅助模块
 * 封装与 PlanningTree 交互的决策记录逻辑
 */

import { DecisionOutcome, DecisionStage } from "./states.js";

/**
 * 记录检索决策
 * @param {object} state - DeepSearchState 实例
 * @param {string} gapId - gap ID
 * @param {object} decision - 决策对象
 */
export function recordRetrieveDecision(state, gapId, decision) {
  if (!state?.planningTree || !gapId) return;

  const nodes = state.planningTree.getNodesForGap(gapId);
  for (const node of nodes) {
    state.planningTree.recordDecision(node.nodeId, {
      stage: DecisionStage.RETRIEVE,
      ...decision
    });
  }
}

/**
 * 记录理解阶段决策
 * @param {object} state - DeepSearchState 实例
 * @param {string} gapId - gap ID
 * @param {object} decision - 决策对象
 */
export function recordUnderstandDecision(state, gapId, decision) {
  if (!state?.planningTree || !gapId) return;

  const nodes = state.planningTree.getNodesForGap(gapId);
  for (const node of nodes) {
    state.planningTree.recordDecision(node.nodeId, {
      stage: DecisionStage.UNDERSTAND,
      ...decision
    });
  }
}

/**
 * 记录 Gap 状态变更决策
 * @param {object} state - DeepSearchState 实例
 * @param {string} gapId - gap ID
 * @param {object} decision - 决策对象
 */
export function recordGapDecision(state, gapId, decision) {
  if (!state?.planningTree || !gapId) return;

  const nodes = state.planningTree.getNodesForGap(gapId);
  for (const node of nodes) {
    state.planningTree.recordDecision(node.nodeId, {
      stage: DecisionStage.GAPS,
      ...decision
    });
  }
}

/**
 * 辅助：记录迭代检索的决策
 */
export function trackIterativeRetrieve(state, gapId, iteration, retrieved, queryHints, latency) {
  recordRetrieveDecision(state, gapId, {
    action: `localRetriever (iteration ${iteration})`,
    reason: `Using queryHints: ${queryHints.slice(0, 3).join(', ')}`,
    outcome: retrieved.length > 0 ? DecisionOutcome.SUCCESS : DecisionOutcome.FAIL,
    metrics: { hits: retrieved.length, latency, iteration }
  });
}

/**
 * 辅助：记录查询词优化决策
 */
export function trackQueryRefinement(state, gapId, oldHints, newHints, iteration) {
  recordRetrieveDecision(state, gapId, {
    action: 'refine query hints',
    reason: `Refined from [${oldHints.join(', ')}] to [${newHints.join(', ')}]`,
    outcome: DecisionOutcome.SUCCESS,
    metrics: { iteration, oldHintCount: oldHints.length, newHintCount: newHints.length }
  });
}

/**
 * 辅助：记录 rerank 决策
 */
export function trackRerank(state, gaps, rerankStats) {
  if (!state?.planningTree || !Array.isArray(gaps)) return;

  for (const gap of gaps) {
    const gapId = gap?.gapId;
    if (!gapId) continue;

    recordRetrieveDecision(state, gapId, {
      action: 'LLM rerank',
      reason: rerankStats.skipped
        ? `Skipped: ${rerankStats.reason || 'unknown'}`
        : `Reranked ${rerankStats.inputCount} chunks to ${rerankStats.outputCount}`,
      outcome: rerankStats.skipped ? DecisionOutcome.PARTIAL : DecisionOutcome.SUCCESS,
      metrics: {
        inputCount: rerankStats.inputCount,
        outputCount: rerankStats.outputCount,
        skipped: rerankStats.skipped
      }
    });
  }
}

/**
 * 辅助：记录 claim 提取决策
 */
export function trackClaimExtraction(state, gapIds, claimCount, evidenceCount) {
  if (!state?.planningTree || !Array.isArray(gapIds)) return;

  for (const gapId of gapIds) {
    recordUnderstandDecision(state, gapId, {
      action: 'extract claims from evidence',
      reason: `Extracted ${claimCount} claims from ${evidenceCount} evidence`,
    outcome: claimCount > 0 ? DecisionOutcome.SUCCESS : DecisionOutcome.FAIL,
    metrics: { claimCount, evidenceCount }
  });
}
}

/**
 * 辅助：记录 gap 填充决策
 */
export function trackGapFill(state, gapId, filled, reason, metrics = {}) {
  recordGapDecision(state, gapId, {
    action: filled ? 'gap filled' : 'gap remains open',
    reason: String(reason || ''),
    outcome: filled ? DecisionOutcome.SUCCESS : DecisionOutcome.PARTIAL,
    metrics
  });
}

/**
 * 辅助：记录 gap missCount 增加决策
 */
export function trackGapMiss(state, gapId, missCount, reason) {
  recordGapDecision(state, gapId, {
    action: 'gap miss count increased',
    reason: String(reason || 'no evidence found in this iteration'),
    outcome: DecisionOutcome.FAIL,
    metrics: { missCount }
  });
}

/**
 * 辅助：记录外部搜索决策
 */
export function trackExternalSearch(state, gapId, triggered, resultCount, reason) {
  recordRetrieveDecision(state, gapId, {
    action: triggered ? 'external search triggered' : 'external search skipped',
    reason: String(reason || ''),
    outcome: triggered && resultCount > 0 ? DecisionOutcome.SUCCESS : triggered ? DecisionOutcome.PARTIAL : DecisionOutcome.FAIL,
    metrics: { resultCount }
  });
}
