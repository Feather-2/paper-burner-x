# DeepSearch 决策追踪功能集成文档

## 概述

决策追踪功能允许在 PlanningTree 的每个节点记录决策过程，支持后续分析为什么某个 gap 反复 miss。

## 核心API

### 1. `recordDecision(nodeId, decision)`

记录决策到节点。

**参数：**
- `nodeId` (string): 节点 ID
- `decision` (object): 决策记录
  - `stage` (string): 阶段 'retrieve'|'gaps'|'understand'|'write'
  - `action` (string): 执行的动作
  - `reason` (string): 决策原因
  - `outcome` (string): 结果 'success'|'fail'|'partial'
  - `metrics` (object): 度量数据（hits, latency 等）

**返回：** `boolean` - 是否记录成功

**示例：**
```javascript
const nodes = state.planningTree.getNodesForGap('gap_1');
for (const node of nodes) {
  state.planningTree.recordDecision(node.nodeId, {
    stage: 'retrieve',
    action: 'BM25 search',
    reason: 'Using queryHints: definition, concept',
    outcome: 'success',
    metrics: { hits: 5, latency: 120 }
  });
}
```

### 2. `getDecisionHistory(nodeId)`

获取节点的决策历史。

**参数：**
- `nodeId` (string): 节点 ID

**返回：** `object[]` - 决策记录数组

**示例：**
```javascript
const history = state.planningTree.getDecisionHistory('plan_1');
console.log(`Total decisions: ${history.length}`);
history.forEach(d => {
  console.log(`[${d.stage}] ${d.action} -> ${d.outcome}`);
});
```

### 3. `analyzeGapFailure(gapId)`

分析 gap 失败原因。

**参数：**
- `gapId` (string): gap ID

**返回：** `object` - 分析结果
  - `failureCount` (number): 失败次数
  - `totalAttempts` (number): 总尝试次数
  - `successRate` (string): 成功率
  - `commonReasons` (array): 最常见的失败原因
  - `suggestedActions` (array): 改进建议
  - `relatedNodeIds` (array): 相关节点 ID

**示例：**
```javascript
const analysis = state.planningTree.analyzeGapFailure('gap_1');

console.log(`Failure rate: ${(100 - parseFloat(analysis.successRate) * 100).toFixed(0)}%`);
console.log('Common reasons:', analysis.commonReasons);
console.log('Suggested actions:', analysis.suggestedActions);
```

## 辅助模块：decision-tracker.js

为了简化集成，提供了辅助函数封装常见的决策记录场景。

### 导入

```javascript
import {
  recordRetrieveDecision,
  recordUnderstandDecision,
  recordGapDecision,
  trackIterativeRetrieve,
  trackQueryRefinement,
  trackRerank,
  trackClaimExtraction,
  trackGapFill,
  trackGapMiss,
  trackExternalSearch
} from './decision-tracker.js';
```

### 常用函数

#### `trackIterativeRetrieve(state, gapId, iteration, retrieved, queryHints, latency)`

记录迭代检索的决策。

**示例：**
```javascript
const startTime = Date.now();
const retrieved = await localRetriever(sourceIndex, [gap], config);
const latency = Date.now() - startTime;

trackIterativeRetrieve(
  state,
  gapId,
  iterationNumber,
  retrieved,
  gap.queryHints,
  latency
);
```

#### `trackQueryRefinement(state, gapId, oldHints, newHints, iteration)`

记录查询词优化决策。

**示例：**
```javascript
const newHints = await refineQueryHints(gap, results, stageApi, state);
if (newHints && newHints.length > 0) {
  trackQueryRefinement(state, gapId, oldHints, newHints, iteration);
}
```

#### `trackRerank(state, gaps, rerankStats)`

记录 rerank 决策。

**示例：**
```javascript
const { ranked, stats } = await rerankWithLLM(chunks, query, options);
trackRerank(state, gaps, stats);
```

#### `trackClaimExtraction(state, gapIds, claimCount, evidenceCount)`

记录 claim 提取决策。

**示例：**
```javascript
const { claims, evidences } = claimsFromChunks(retrieved, options);
const gapIds = [...new Set(claims.flatMap(c => c.gapIds || []))];
trackClaimExtraction(state, gapIds, claims.length, evidences.length);
```

#### `trackGapFill(state, gapId, filled, reason, metrics)`

记录 gap 填充决策。

**示例：**
```javascript
const filled = claim.gapIds.includes(gapId);
trackGapFill(
  state,
  gapId,
  filled,
  filled ? 'Evidence found' : 'No evidence in this iteration',
  { claimCount: claims.length }
);
```

#### `trackGapMiss(state, gapId, missCount, reason)`

记录 gap missCount 增加决策。

**示例：**
```javascript
if (!filled) {
  gap.missCount = (gap.missCount || 0) + 1;
  trackGapMiss(
    state,
    gapId,
    gap.missCount,
    'No relevant evidence found after 2 iterations'
  );
}
```

## 集成示例

### 1. 在 retrieve.js 中集成

```javascript
import { trackIterativeRetrieve, trackQueryRefinement, trackRerank } from './decision-tracker.js';

async function iterativeRetrieve(gap, sourceIndexes, localRetriever, routerConfig, stageApi, state, emit, maxIterations = 2) {
  const gapId = gap?.gapId || "gap_unknown";

  for (let iter = 0; iter < maxIterations; iter++) {
    for (const sourceIndex of sourceIndexes) {
      const startTime = Date.now();
      const retrieved = localRetriever(sourceIndex, [gap], routerConfig);
      const latency = Date.now() - startTime;

      // 记录决策
      trackIterativeRetrieve(state, gapId, iter + 1, retrieved, gap.queryHints, latency);
    }

    // 查询词优化
    const newHints = await refineQueryHints(gap, retrieved, stageApi, state);
    if (newHints) {
      trackQueryRefinement(state, gapId, gap.queryHints, newHints, iter + 1);
      gap.queryHints = newHints;
    }
  }
}

// Rerank 集成
const { ranked, stats } = await rerankWithLLM(chunks, query, options);
trackRerank(state, gaps, stats);
```

### 2. 在 understand.js 中集成

```javascript
import { trackClaimExtraction } from './decision-tracker.js';

export async function runDeepSearchUnderstandStage(runContext, input, stageApi = {}) {
  // ... 现有代码 ...

  const { claims, evidences } = claimsFromChunks(retrieved, options);

  // 记录 claim 提取决策
  const gapIds = [...new Set(claims.flatMap(c => c.gapIds || []))];
  trackClaimExtraction(state, gapIds, claims.length, evidences.length);

  // ... 现有代码 ...
}
```

### 3. 在 gaps.js 中集成

```javascript
import { trackGapFill, trackGapMiss } from './decision-tracker.js';

export async function runDeepSearchGapsStage(runContext, input, stageApi = {}) {
  // ... 现有代码 ...

  // 在更新 gap 状态时记录
  for (const gap of gaps) {
    const filled = claims.some(c => c.gapIds?.includes(gap.gapId));

    if (filled) {
      gap.status = 'filled';
      trackGapFill(state, gap.gapId, true, 'Evidence collected', {
        claimCount: claims.filter(c => c.gapIds?.includes(gap.gapId)).length
      });
    } else {
      gap.missCount = (gap.missCount || 0) + 1;
      trackGapMiss(state, gap.gapId, gap.missCount, 'No evidence in this iteration');
    }
  }

  // ... 现有代码 ...
}
```

## 分析失败原因示例

```javascript
// 在迭代结束后分析失败的 gaps
const openGaps = gaps.filter(g => g.status === 'open' && g.missCount > 2);

for (const gap of openGaps) {
  const analysis = state.planningTree.analyzeGapFailure(gap.gapId);

  console.log(`\n=== Analysis for ${gap.gapId} ===`);
  console.log(`Question: ${gap.question}`);
  console.log(`Failure rate: ${(100 - parseFloat(analysis.successRate) * 100).toFixed(0)}%`);
  console.log(`Attempts: ${analysis.totalAttempts}, Failures: ${analysis.failureCount}`);

  console.log('\nCommon reasons:');
  analysis.commonReasons.forEach(r => {
    console.log(`  - ${r.reason} (${r.count} times)`);
  });

  console.log('\nSuggested actions:');
  analysis.suggestedActions.forEach(a => {
    console.log(`  [${a.stage || a.reason}] ${a.suggestion}`);
  });
}
```

输出示例：
```
=== Analysis for gap_1 ===
Question: What is the core concept?
Failure rate: 67%
Attempts: 12, Failures: 8

Common reasons:
  - no hits found (5 times)
  - low quality results (2 times)
  - timeout error (1 times)

Suggested actions:
  [retrieve] 检索阶段反复失败，建议：1) 调整查询词更具体；2) 启用迭代检索；3) 尝试外部搜索
  [no hits found] 检索无结果，建议扩大搜索范围或使用更通用的关键词
  [low quality results] 结果质量低，建议启用 LLM rerank 或调整 BM25 参数
```

## 序列化支持

决策历史会自动包含在序列化结果中：

```javascript
// 序列化
const serialized = state.planningTree.serialize();
// serialized.nodes 中包含每个节点的 decisions 数组

// 反序列化
const tree = PlanningTree.fromJSON(serialized);
// decisions 会被正确恢复
```

## 测试

运行测试：
```bash
npm test tests/agents/deepsearch/planning-tree-decisions.test.js
```

测试覆盖：
- ✓ recordDecision 正确记录决策
- ✓ getDecisionHistory 返回完整历史
- ✓ analyzeGapFailure 分析失败原因
- ✓ _generateSuggestions 生成改进建议
- ✓ 序列化/反序列化支持
- ✓ 完整生命周期追踪

## 最佳实践

1. **始终记录关键决策点**
   - 每次检索操作
   - 查询词调整
   - Gap 状态变更

2. **提供有意义的 reason**
   - 不要只写 "failed"，要说明为什么失败
   - 好：`"BM25 returned 0 hits using hints: [definition, concept]"`
   - 差：`"failed"`

3. **记录有用的 metrics**
   - hits 数量
   - latency 耗时
   - iteration 迭代次数
   - score 评分

4. **定期分析失败 gaps**
   - 在每次迭代后调用 `analyzeGapFailure`
   - 根据建议调整策略

5. **使用辅助函数简化集成**
   - 优先使用 `decision-tracker.js` 中的封装函数
   - 保持代码整洁

## 性能考虑

- 决策记录是轻量级操作（仅内存写入）
- 不会显著影响运行时性能
- 序列化后的 JSON 会略大（每个决策约 100-200 字节）
- 如果担心内存占用，可以限制每个节点的决策数量（比如只保留最近 50 条）

## 未来扩展

可能的扩展方向：
- 决策可视化 UI
- 自动化策略调优（基于历史决策）
- 决策导出为训练数据
- A/B 测试不同策略的效果
