import { GapStatus, DecisionStage, DecisionOutcome, PlanNodeStatus } from "./states.js";

export class PlanningTree {
  constructor({ rootGoal = '', runId = '' } = {}) {
    this.rootId = 'plan_root';
    this.nodes = new Map();
    this.activeNodeId = this.rootId;

    // Strategy statistics: { strategy: { attempts, hits, totalLatency } }
    this.strategyStats = new Map([
      ['grep', { attempts: 0, hits: 0, totalLatency: 0 }],
      ['bm25', { attempts: 0, hits: 0, totalLatency: 0 }],
      ['tool-chain', { attempts: 0, hits: 0, totalLatency: 0 }],
      ['external', { attempts: 0, hits: 0, totalLatency: 0 }]
    ]);

    // Create root node
    this.nodes.set(this.rootId, {
      nodeId: this.rootId,
      parentId: null,
      type: 'goal',
      content: rootGoal,
      status: 'active',
      children: [],
      decisions: [],
      metadata: { createdAt: new Date().toISOString(), iteration: 0 }
    });
  }

  addNode(parentId, type, content, metadata = {}) {
    const nodeId = `plan_${this.nodes.size}`;
    const node = {
      nodeId,
      parentId,
      type,
      content,
      status: 'pending',
      children: [],
      decisions: [],
      metadata: { createdAt: new Date().toISOString(), ...metadata }
    };
    this.nodes.set(nodeId, node);
    const parent = this.nodes.get(parentId);
    if (parent) parent.children.push(nodeId);
    return nodeId;
  }

  updateStatus(nodeId, status) {
    const node = this.nodes.get(nodeId);
    if (node) node.status = status;
  }

  getActiveNodes() {
    return [...this.nodes.values()].filter(n => n.status === 'active');
  }

  getNodePath(nodeId) {
    const path = [];
    let current = this.nodes.get(nodeId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.nodes.get(current.parentId) : null;
    }
    return path;
  }

  expandFromGap(gap) {
    const parentId = this.rootId;
    const subgoalId = this.addNode(parentId, 'subgoal', gap.question, { sourceGapId: gap.gapId });
    const queryIds = (gap.queryHints || []).map(hint => 
      this.addNode(subgoalId, 'query', hint, { sourceGapId: gap.gapId })
    );
    return [subgoalId, ...queryIds];
  }

  getNodesForGap(gapId) {
    return [...this.nodes.values()].filter(n => n.metadata?.sourceGapId === gapId);
  }

  /**
   * 记录决策到节点
   * @param {string} nodeId - 节点 ID
   * @param {object} decision - 决策记录
   * @param {string} decision.stage - 阶段：'retrieve'|'gaps'|'understand'|'write'
   * @param {string} decision.action - 执行的动作
   * @param {string} decision.reason - 决策原因
   * @param {string} decision.outcome - 结果：'success'|'fail'|'partial'
   * @param {object} decision.metrics - 度量数据（hits, latency 等）
   * @returns {boolean} 是否记录成功
   */
  recordDecision(nodeId, decision) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    if (!Array.isArray(node.decisions)) {
      node.decisions = [];
    }

    const record = {
      stage: String(decision?.stage || 'unknown'),
      action: String(decision?.action || ''),
      reason: String(decision?.reason || ''),
      outcome: ['success', 'fail', 'partial'].includes(decision?.outcome)
        ? decision.outcome
        : 'unknown',
      metrics: decision?.metrics && typeof decision.metrics === 'object'
        ? { ...decision.metrics }
        : {},
      timestamp: new Date().toISOString()
    };

    node.decisions.push(record);
    return true;
  }

  /**
   * 记录 Gap 状态变化到相关节点
   * @param {string} gapId - Gap ID
   * @param {object} params - 状态变化参数
   * @param {string} params.from - 原状态
   * @param {string} params.to - 目标状态
   * @param {string} params.reason - 变化原因
   * @param {number} params.iteration - 当前迭代
   */
  recordGapStatusChange(gapId, { from, to, reason, iteration }) {
    const nodes = this.getNodesForGap(gapId);
    if (!nodes.length) return;

    const decision = {
      stage: DecisionStage.RETRIEVE,
      action: `gap_${to}`,
      reason: reason || '',
      outcome: to === GapStatus.FILLED
        ? DecisionOutcome.SUCCESS
        : to === GapStatus.BLOCKED
          ? DecisionOutcome.FAIL
          : DecisionOutcome.UNKNOWN,
      metrics: { iteration, from, to },
      timestamp: new Date().toISOString()
    };

    for (const node of nodes) {
      if (!Array.isArray(node.decisions)) {
        node.decisions = [];
      }
      node.decisions.push(decision);

      if (to === GapStatus.FILLED) {
        this.updateStatus(node.nodeId, PlanNodeStatus.COMPLETED);
      } else if (to === GapStatus.BLOCKED) {
        this.updateStatus(node.nodeId, PlanNodeStatus.FAILED);
      }
    }
  }

  /**
   * 获取节点的决策历史
   * @param {string} nodeId - 节点 ID
   * @returns {object[]} 决策记录数组
   */
  getDecisionHistory(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    return Array.isArray(node.decisions) ? [...node.decisions] : [];
  }

  /**
   * 分析 gap 失败原因
   * @param {string} gapId - gap ID
   * @returns {object} 分析结果
   */
  analyzeGapFailure(gapId) {
    const relatedNodes = this.getNodesForGap(gapId);
    const allDecisions = [];

    for (const node of relatedNodes) {
      const decisions = Array.isArray(node.decisions) ? node.decisions : [];
      allDecisions.push(...decisions);
    }

    const failures = allDecisions.filter(d => d.outcome === 'fail');
    const partials = allDecisions.filter(d => d.outcome === 'partial');
    const failureCount = failures.length + partials.length;

    // 统计失败原因
    const reasonCounts = new Map();
    for (const d of [...failures, ...partials]) {
      const reason = String(d.reason || 'unknown');
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }

    // 排序获取最常见的原因
    const commonReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    // 根据失败模式生成建议
    const suggestedActions = this._generateSuggestions(failures, partials, commonReasons);

    return {
      failureCount,
      totalAttempts: allDecisions.length,
      successRate: allDecisions.length > 0
        ? (allDecisions.filter(d => d.outcome === 'success').length / allDecisions.length).toFixed(2)
        : '0.00',
      commonReasons,
      suggestedActions,
      relatedNodeIds: relatedNodes.map(n => n.nodeId)
    };
  }

  /**
   * 根据失败模式生成改进建议
   * @private
   */
  _generateSuggestions(failures, partials, commonReasons) {
    const suggestions = [];
    const stageFailures = new Map();

    for (const d of [...failures, ...partials]) {
      stageFailures.set(d.stage, (stageFailures.get(d.stage) || 0) + 1);
    }

    // 检索阶段失败
    if (stageFailures.get('retrieve') > 2) {
      suggestions.push({
        stage: 'retrieve',
        suggestion: '检索阶段反复失败，建议：1) 调整查询词更具体；2) 启用迭代检索；3) 尝试外部搜索'
      });
    }

    // 理解阶段失败
    if (stageFailures.get('understand') > 2) {
      suggestions.push({
        stage: 'understand',
        suggestion: '理解阶段失败，建议：1) 检查检索质量；2) 降低 dedupeThreshold；3) 增加上下文窗口'
      });
    }

    // Gap 状态变更失败
    if (stageFailures.get('gaps') > 2) {
      suggestions.push({
        stage: 'gaps',
        suggestion: 'Gap 填充失败，建议：1) 细化 gap 问题；2) 调整优先级；3) 考虑拆分为子问题'
      });
    }

    // 根据常见原因添加建议
    for (const { reason, count } of commonReasons) {
      if (reason.includes('no hits') || reason.includes('empty')) {
        suggestions.push({
          reason,
          suggestion: '检索无结果，建议扩大搜索范围或使用更通用的关键词'
        });
      } else if (reason.includes('low quality') || reason.includes('irrelevant')) {
        suggestions.push({
          reason,
          suggestion: '结果质量低，建议启用 LLM rerank 或调整 BM25 参数'
        });
      } else if (reason.includes('timeout')) {
        suggestions.push({
          reason,
          suggestion: '超时问题，建议增加 timeoutMs 或优化索引'
        });
      }
    }

    return suggestions.slice(0, 5);
  }

  serialize() {
    return {
      rootId: this.rootId,
      nodes: Object.fromEntries(this.nodes),
      activeNodeId: this.activeNodeId,
      strategyStats: Object.fromEntries(this.strategyStats)
    };
  }

  static fromJSON(json) {
    const tree = new PlanningTree();
    tree.rootId = json.rootId;
    tree.nodes = new Map(Object.entries(json.nodes || {}));
    tree.activeNodeId = json.activeNodeId;

    // Restore strategyStats if available
    if (json.strategyStats && typeof json.strategyStats === 'object') {
      tree.strategyStats = new Map(Object.entries(json.strategyStats));
    }

    return tree;
  }

  /**
   * 获取节点在树中的深度
   * @param {string} nodeId - 节点 ID
   * @returns {number} 深度（root=0）
   */
  getNodeDepth(nodeId) {
    const path = this.getNodePath(nodeId);
    return path.length > 0 ? path.length - 1 : 0;
  }

  /**
   * 记录检索策略的执行结果
   * @param {string} strategy - 策略名称 ('grep', 'bm25', 'tool-chain', 'external')
   * @param {object} result - 结果对象
   * @param {number} result.hits - 检索到的结果数量
   * @param {number} result.latency - 执行耗时（毫秒）
   */
  recordStrategyResult(strategy, { hits = 0, latency = 0 } = {}) {
    const strategyKey = String(strategy || '').toLowerCase();

    // 初始化策略统计（如果不存在）
    if (!this.strategyStats.has(strategyKey)) {
      this.strategyStats.set(strategyKey, { attempts: 0, hits: 0, totalLatency: 0 });
    }

    const stats = this.strategyStats.get(strategyKey);
    stats.attempts += 1;
    stats.hits += typeof hits === 'number' && hits > 0 ? hits : 0;
    stats.totalLatency += typeof latency === 'number' && latency >= 0 ? latency : 0;
  }

  /**
   * 获取策略的命中率
   * @param {string} strategy - 策略名称
   * @returns {number} 命中率 (0-1)，如果没有足够样本返回默认值
   */
  getStrategyHitRate(strategy) {
    const strategyKey = String(strategy || '').toLowerCase();

    // 默认命中率假设
    const defaults = {
      'grep': 0.6,
      'bm25': 0.5,
      'tool-chain': 0.7,
      'external': 0.4
    };

    const stats = this.strategyStats.get(strategyKey);
    const minSamples = 3;

    // 如果样本数不足，返回默认值
    if (!stats || stats.attempts < minSamples) {
      return defaults[strategyKey] ?? 0.5;
    }

    // 计算平均命中率（每次尝试的平均 hits）
    return stats.attempts > 0 ? stats.hits / stats.attempts : 0;
  }

  /**
   * 根据 source 类型和历史数据选择最佳检索策略
   * @param {Array} sources - source 对象数组
   * @returns {string} 推荐的策略名称
   */
  getBestStrategy(sources = []) {
    // 分析 source 类型
    const sourceTypes = new Set();
    for (const src of Array.isArray(sources) ? sources : []) {
      const kind = String(src?.kind || src?.type || 'unknown').toLowerCase();
      sourceTypes.add(kind);
    }

    // 策略选择逻辑
    const hasCode = sourceTypes.has('code') || sourceTypes.has('file');
    const hasDocs = sourceTypes.has('url') || sourceTypes.has('pdf') || sourceTypes.has('doc');

    // 1. 纯代码类 source → 优先 grep
    if (hasCode && !hasDocs) {
      const grepHitRate = this.getStrategyHitRate('grep');
      const toolChainHitRate = this.getStrategyHitRate('tool-chain');
      return grepHitRate >= toolChainHitRate ? 'grep' : 'tool-chain';
    }

    // 2. 纯文档类 source → 优先 BM25
    if (hasDocs && !hasCode) {
      return 'bm25';
    }

    // 3. 混合类型或未知 → 根据历史命中率选择
    const strategies = ['grep', 'bm25', 'tool-chain'];
    let bestStrategy = 'bm25';
    let bestHitRate = 0;

    for (const strategy of strategies) {
      const hitRate = this.getStrategyHitRate(strategy);
      if (hitRate > bestHitRate) {
        bestHitRate = hitRate;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  /**
   * 统计有多少其他 gaps 依赖于指定 gap
   * @param {string} gapId - gap ID
   * @param {Array} allGaps - 所有 gaps 数组
   * @returns {number} 依赖此 gap 的数量
   */
  countDependents(gapId, allGaps) {
    let count = 0;
    for (const gap of allGaps || []) {
      const dependencies = gap?.metadata?.dependencies || [];
      if (Array.isArray(dependencies) && dependencies.includes(gapId)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 计算 gap 的综合优先级分数
   * @param {object} gap - gap 对象
   * @param {Array} allGaps - 所有 gaps 数组（用于依赖分析）
   * @returns {number} 分数，越高越优先
   */
  computeGapScore(gap, allGaps = []) {
    // 权重配置
    const priorityWeight = 10;
    const missWeight = 5;
    const dependencyBonus = 2;
    const depthPenaltyFactor = 0.5;

    // 1. Priority: high=3, medium=2, low=1
    const priorityMap = { high: 3, medium: 2, low: 1 };
    const priority = String(gap?.priority || 'medium').toLowerCase();
    const priorityValue = priorityMap[priority] || 1;

    // 2. MissCount: 越低越优先（衰减因子）
    const missCount = typeof gap?.missCount === 'number' && gap.missCount >= 0 ? gap.missCount : 0;
    const missScore = 1 / (1 + missCount);

    // 3. 依赖关系：如果其他 gaps 依赖此 gap，提高优先级
    const gapId = String(gap?.gapId || '');
    const dependentCount = this.countDependents(gapId, allGaps);
    const dependencyScore = dependentCount * dependencyBonus;

    // 4. 节点深度：浅层节点优先（breadth-first）
    const nodes = this.getNodesForGap(gapId);
    const avgDepth = nodes.length > 0
      ? nodes.reduce((sum, n) => sum + this.getNodeDepth(n.nodeId), 0) / nodes.length
      : 0;
    const depthPenalty = avgDepth * depthPenaltyFactor;

    // 综合计分
    const score = (priorityWeight * priorityValue) + (missWeight * missScore) + dependencyScore - depthPenalty;
    return score;
  }

  /**
   * 对 gaps 数组进行优先级排序
   * @param {Array} gaps - open gaps 数组
   * @returns {Array} 排序后的 gaps（新数组）
   */
  sortGapsByPriority(gaps) {
    if (!Array.isArray(gaps) || gaps.length === 0) return [];

    // 浅拷贝并计算分数
    const gapsWithScores = gaps.map(gap => ({
      gap,
      score: this.computeGapScore(gap, gaps)
    }));

    // 按分数降序排序（分数相同时按 gapId 稳定排序）
    gapsWithScores.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return String(a.gap?.gapId || '').localeCompare(String(b.gap?.gapId || ''));
    });

    return gapsWithScores.map(item => item.gap);
  }
}
