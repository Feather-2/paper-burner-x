const test = require("node:test");
const assert = require("node:assert/strict");

test("PlanningTree: recordStrategyResult updates statistics", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Test goal", runId: "run_1" });

  // 初始状态
  const grepStats = tree.strategyStats.get('grep');
  assert.equal(grepStats.attempts, 0);
  assert.equal(grepStats.hits, 0);
  assert.equal(grepStats.totalLatency, 0);

  // 记录一次结果
  tree.recordStrategyResult('grep', { hits: 5, latency: 120 });
  assert.equal(grepStats.attempts, 1);
  assert.equal(grepStats.hits, 5);
  assert.equal(grepStats.totalLatency, 120);

  // 记录第二次
  tree.recordStrategyResult('grep', { hits: 3, latency: 80 });
  assert.equal(grepStats.attempts, 2);
  assert.equal(grepStats.hits, 8);
  assert.equal(grepStats.totalLatency, 200);

  // 记录 BM25 结果
  tree.recordStrategyResult('bm25', { hits: 2, latency: 150 });
  const bm25Stats = tree.strategyStats.get('bm25');
  assert.equal(bm25Stats.attempts, 1);
  assert.equal(bm25Stats.hits, 2);
  assert.equal(bm25Stats.totalLatency, 150);
});

test("PlanningTree: recordStrategyResult handles edge cases", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  // 无参数调用
  tree.recordStrategyResult('grep');
  const stats1 = tree.strategyStats.get('grep');
  assert.equal(stats1.attempts, 1);
  assert.equal(stats1.hits, 0);

  // 负数 hits（应该被忽略）
  tree.recordStrategyResult('grep', { hits: -5, latency: 100 });
  assert.equal(stats1.attempts, 2);
  assert.equal(stats1.hits, 0);

  // 非数字 latency
  tree.recordStrategyResult('grep', { hits: 3, latency: 'invalid' });
  assert.equal(stats1.attempts, 3);
  assert.equal(stats1.hits, 3);
  assert.equal(stats1.totalLatency, 100);

  // 新策略（动态创建）
  tree.recordStrategyResult('custom-strategy', { hits: 10, latency: 50 });
  const customStats = tree.strategyStats.get('custom-strategy');
  assert.equal(customStats.attempts, 1);
  assert.equal(customStats.hits, 10);
  assert.equal(customStats.totalLatency, 50);
});

test("PlanningTree: getStrategyHitRate returns default for insufficient samples", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  // 无样本时返回默认值
  assert.equal(tree.getStrategyHitRate('grep'), 0.6);
  assert.equal(tree.getStrategyHitRate('bm25'), 0.5);
  assert.equal(tree.getStrategyHitRate('tool-chain'), 0.7);
  assert.equal(tree.getStrategyHitRate('external'), 0.4);

  // 样本数不足 3 次
  tree.recordStrategyResult('grep', { hits: 5, latency: 100 });
  tree.recordStrategyResult('grep', { hits: 3, latency: 100 });
  assert.equal(tree.getStrategyHitRate('grep'), 0.6); // 仍返回默认值

  // 达到最小样本数后返回实际命中率
  tree.recordStrategyResult('grep', { hits: 4, latency: 100 });
  const hitRate = tree.getStrategyHitRate('grep');
  assert(Math.abs(hitRate - 4.0) < 0.01); // (5+3+4)/3 = 4.0
});

test("PlanningTree: getStrategyHitRate calculates average hits per attempt", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  // 记录多次结果
  tree.recordStrategyResult('bm25', { hits: 6, latency: 100 });
  tree.recordStrategyResult('bm25', { hits: 8, latency: 120 });
  tree.recordStrategyResult('bm25', { hits: 4, latency: 90 });
  tree.recordStrategyResult('bm25', { hits: 2, latency: 80 });

  const hitRate = tree.getStrategyHitRate('bm25');
  assert(Math.abs(hitRate - 5.0) < 0.01); // (6+8+4+2)/4 = 5.0
});

test("PlanningTree: getBestStrategy for code sources", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  const codeSources = [
    { sourceId: 's1', kind: 'code' },
    { sourceId: 's2', kind: 'file' }
  ];

  // 无历史数据时，应该选择 grep（默认 hit rate 0.6 > tool-chain 0.7? No, tool-chain is higher）
  // 实际上 tool-chain 默认 0.7 > grep 0.6，所以应该选 tool-chain
  let strategy = tree.getBestStrategy(codeSources);
  assert.equal(strategy, 'tool-chain');

  // 模拟 grep 有更好的历史数据
  tree.recordStrategyResult('grep', { hits: 10, latency: 50 });
  tree.recordStrategyResult('grep', { hits: 12, latency: 60 });
  tree.recordStrategyResult('grep', { hits: 8, latency: 55 });
  // grep hit rate = 30/3 = 10.0

  tree.recordStrategyResult('tool-chain', { hits: 5, latency: 100 });
  tree.recordStrategyResult('tool-chain', { hits: 6, latency: 120 });
  tree.recordStrategyResult('tool-chain', { hits: 4, latency: 90 });
  // tool-chain hit rate = 15/3 = 5.0

  strategy = tree.getBestStrategy(codeSources);
  assert.equal(strategy, 'grep');
});

test("PlanningTree: getBestStrategy for document sources", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  const docSources = [
    { sourceId: 's1', kind: 'url' },
    { sourceId: 's2', kind: 'pdf' },
    { sourceId: 's3', kind: 'doc' }
  ];

  // 纯文档类应该始终选择 BM25
  const strategy = tree.getBestStrategy(docSources);
  assert.equal(strategy, 'bm25');
});

test("PlanningTree: getBestStrategy for mixed sources", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  const mixedSources = [
    { sourceId: 's1', kind: 'code' },
    { sourceId: 's2', kind: 'url' },
    { sourceId: 's3', type: 'file' } // 测试 type 字段
  ];

  // 无历史数据时，应该选择默认最高的策略
  let strategy = tree.getBestStrategy(mixedSources);
  assert.equal(strategy, 'tool-chain'); // 默认 0.7 最高

  // 模拟 BM25 有最好的历史
  tree.recordStrategyResult('bm25', { hits: 15, latency: 100 });
  tree.recordStrategyResult('bm25', { hits: 18, latency: 110 });
  tree.recordStrategyResult('bm25', { hits: 12, latency: 90 });
  // bm25 hit rate = 45/3 = 15.0

  tree.recordStrategyResult('grep', { hits: 5, latency: 50 });
  tree.recordStrategyResult('grep', { hits: 6, latency: 60 });
  tree.recordStrategyResult('grep', { hits: 4, latency: 55 });
  // grep hit rate = 15/3 = 5.0

  strategy = tree.getBestStrategy(mixedSources);
  assert.equal(strategy, 'bm25');
});

test("PlanningTree: getBestStrategy handles empty/unknown sources", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();

  // 空数组
  let strategy = tree.getBestStrategy([]);
  assert.equal(strategy, 'tool-chain'); // 默认最高

  // 未知类型
  strategy = tree.getBestStrategy([
    { sourceId: 's1', kind: 'unknown' },
    { sourceId: 's2' } // 无 kind 字段
  ]);
  assert.equal(strategy, 'tool-chain'); // 默认最高
});

test("PlanningTree: serialize/deserialize preserves strategyStats", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree({ rootGoal: "Test", runId: "run_1" });

  // 记录一些策略结果
  tree.recordStrategyResult('grep', { hits: 10, latency: 100 });
  tree.recordStrategyResult('grep', { hits: 8, latency: 90 });
  tree.recordStrategyResult('grep', { hits: 12, latency: 110 });
  tree.recordStrategyResult('bm25', { hits: 5, latency: 120 });
  tree.recordStrategyResult('bm25', { hits: 7, latency: 130 });
  tree.recordStrategyResult('bm25', { hits: 3, latency: 100 });

  // 序列化
  const json = tree.serialize();
  assert.ok(json.strategyStats);
  assert.equal(Object.keys(json.strategyStats).length, 4); // 4 个策略

  // 反序列化
  const restored = PlanningTree.fromJSON(JSON.parse(JSON.stringify(json)));

  // 验证 strategyStats 被正确恢复
  assert.ok(restored.strategyStats instanceof Map);
  assert.equal(restored.strategyStats.size, 4);

  const grepStats = restored.strategyStats.get('grep');
  assert.equal(grepStats.attempts, 3);
  assert.equal(grepStats.hits, 30);
  assert.equal(grepStats.totalLatency, 300);

  const bm25Stats = restored.strategyStats.get('bm25');
  assert.equal(bm25Stats.attempts, 3);
  assert.equal(bm25Stats.hits, 15);
  assert.equal(bm25Stats.totalLatency, 350);

  // 验证 hit rate 计算正确
  assert(Math.abs(restored.getStrategyHitRate('grep') - 10.0) < 0.01);
  assert(Math.abs(restored.getStrategyHitRate('bm25') - 5.0) < 0.01);
});

test("PlanningTree: deserialize handles missing strategyStats gracefully", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  // 模拟旧版本的序列化数据（无 strategyStats）
  const oldJson = {
    rootId: 'plan_root',
    nodes: {
      'plan_root': {
        nodeId: 'plan_root',
        parentId: null,
        type: 'goal',
        content: 'Old goal',
        status: 'active',
        children: [],
        metadata: { createdAt: new Date().toISOString(), iteration: 0 }
      }
    },
    activeNodeId: 'plan_root'
    // 没有 strategyStats
  };

  const tree = PlanningTree.fromJSON(oldJson);

  // 应该创建默认的 strategyStats
  assert.ok(tree.strategyStats instanceof Map);
  assert.equal(tree.strategyStats.size, 4);

  // 所有策略初始化为 0
  const grepStats = tree.strategyStats.get('grep');
  assert.equal(grepStats.attempts, 0);
  assert.equal(grepStats.hits, 0);

  // hit rate 应该返回默认值
  assert.equal(tree.getStrategyHitRate('grep'), 0.6);
});

test("Integration: getBestStrategy adapts to changing performance", async () => {
  const { PlanningTree } = await import("../../../js/agents/stages/deepsearch/planning-tree.js");

  const tree = new PlanningTree();
  const mixedSources = [
    { sourceId: 's1', kind: 'code' },
    { sourceId: 's2', kind: 'url' }
  ];

  // 初始：tool-chain 默认最高
  assert.equal(tree.getBestStrategy(mixedSources), 'tool-chain');

  // 模拟 grep 表现很好
  for (let i = 0; i < 5; i++) {
    tree.recordStrategyResult('grep', { hits: 10 + i, latency: 50 });
  }

  // grep 累计 60 hits / 5 attempts = 12.0 hit rate
  assert(Math.abs(tree.getStrategyHitRate('grep') - 12.0) < 0.01);
  assert.equal(tree.getBestStrategy(mixedSources), 'grep');

  // 模拟 BM25 后来居上
  for (let i = 0; i < 5; i++) {
    tree.recordStrategyResult('bm25', { hits: 15 + i, latency: 100 });
  }

  // bm25 累计 85 hits / 5 attempts = 17.0 hit rate
  assert(Math.abs(tree.getStrategyHitRate('bm25') - 17.0) < 0.01);
  assert.equal(tree.getBestStrategy(mixedSources), 'bm25');
});
