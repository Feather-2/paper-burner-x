# 智能粒度选择器使用指南

## 📖 概述

智能粒度选择器根据问题类型自动选择最佳的意群粒度（summary/digest/full），在信息完整性和Token消耗之间取得最优平衡。

---

## 🎯 核心功能

### 1. 问题类型分析

自动识别4种问题类型：

| 问题类型 | 特征 | 示例 |
|---------|------|------|
| **overview** | 概览性问题 | "这篇文章讲了什么？"、"总结一下主要内容" |
| **analytical** | 分析性问题 | "为什么会出现这个现象？"、"比较两种方法的优缺点" |
| **extraction** | 信息提取问题 | "实验的具体步骤是什么？"、"表3的数据是多少？" |
| **specific** | 具体性问题 | 其他具体查询（默认类型） |

### 2. 粒度自动选择

根据问题类型选择最佳粒度：

| 问题类型 | 推荐粒度 | 意群数量上限 | 说明 |
|---------|---------|------------|------|
| **overview** | summary | 10 | 快速扫描更多意群，获得全局视图 |
| **analytical** | digest | 5 | 平衡细节与数量，支持深入分析 |
| **extraction** | full | 3 | 确保信息完整，精确提取数据 |
| **specific** | digest | 5 | 通用平衡策略 |

### 3. 动态调整

- **意群数量少时自动提升粒度**：
  - 2个意群：summary → digest
  - 1个意群：任何粒度 → full

- **Token超限时自动降级**：
  - full → digest
  - digest → summary
  - 或减少意群数量

- **根据意群特征调整**：
  - 意群<2000字：直接用full
  - 缺少digest：用full或summary替代

---

## 🚀 使用方法

### 基础用法

```javascript
// 1. 单粒度选择
const strategy = window.SmartGranularitySelector.selectGranularity(
  "这篇论文的主要贡献是什么？",
  semanticGroups,
  { maxTokens: 8000 }
);

console.log(strategy);
// {
//   granularity: 'digest',
//   maxGroups: 5,
//   queryType: 'analytical',
//   reasoning: '分析性查询：使用精要提供足够细节',
//   estimatedTokens: 2500
// }
```

### 混合粒度选择

```javascript
// 2. 混合粒度选择（更智能）
const rankedGroups = [
  { group: semanticGroups[3], score: 0.95 },
  { group: semanticGroups[1], score: 0.82 },
  { group: semanticGroups[5], score: 0.71 },
  // ...
];

const selections = window.SmartGranularitySelector.selectMixedGranularity(
  "详细说明第三章的实验步骤",
  rankedGroups,
  { maxTokens: 8000 }
);

console.log(selections);
// [
//   { group: {...}, granularity: 'full', score: 0.95, tokens: 4000 },   // 最相关：full
//   { group: {...}, granularity: 'digest', score: 0.82, tokens: 2000 }, // 次相关：digest
//   { group: {...}, granularity: 'summary', score: 0.71, tokens: 500 }  // 其他：summary
// ]
```

### 构建上下文

```javascript
// 3. 构建混合粒度上下文
const context = window.SmartGranularitySelector.buildMixedContext(selections);

console.log(context);
// 【group-3 - full】
// 关键词: 实验设计、对照组、变量控制
// 内容:
// [完整文本...]
//
// 【group-1 - digest】
// 关键词: 统计分析、假设检验
// 内容:
// [精要内容...]
//
// 【group-5 - summary】
// 关键词: 结果讨论、局限性
// 内容:
// [摘要...]
```

---

## 🔧 集成到多轮取材

智能粒度选择器已集成到流式多轮取材中：

```javascript
// streaming-multi-hop.js 中的使用
async function* streamingMultiHopRetrieve(userQuestion, docContentInfo, config, options) {
  // 1. 自动分析问题类型
  const granularityStrategy = window.SmartGranularitySelector.selectGranularity(
    userQuestion,
    groups,
    { maxTokens: options.maxTokens || 8000 }
  );

  // 2. 通知UI
  yield {
    type: 'granularity_analysis',
    strategy: granularityStrategy
  };

  // 3. 在系统Prompt中提供建议
  const sys = `...
智能粒度建议：
- 问题类型: ${granularityStrategy.queryType}
- 推荐粒度: ${granularityStrategy.granularity}
- 建议: ${granularityStrategy.reasoning}
- 意群数量上限: ${granularityStrategy.maxGroups}
...`;

  // LLM会参考这些建议生成fetch_group指令
}
```

---

## 📊 性能优化

### Token使用对比

| 场景 | 固定粒度 | 智能粒度 | 节省 |
|-----|---------|---------|------|
| **概览问题** | digest×5 = 5000 tokens | summary×10 = 800 tokens | 84% |
| **分析问题** | full×5 = 10000 tokens | digest×5 = 5000 tokens | 50% |
| **提取问题** | digest×5 = 5000 tokens | full×3 = 6000 tokens | -20% (值得) |

### 典型场景示例

**场景1：总结性问题**
```javascript
问题: "这本书的核心观点是什么？"
分析: overview类型
策略: summary × 10个意群 = 800 tokens
效果: 快速扫描全书，提取核心观点
```

**场景2：详细查询**
```javascript
问题: "第五章表2的实验数据是多少？"
分析: extraction类型
策略: full × 2个意群 = 8000 tokens
效果: 确保数据精确，不遗漏细节
```

**场景3：混合查询**
```javascript
问题: "比较两种算法的性能差异，并解释原因"
分析: analytical类型
策略:
  - 最相关意群: full × 1 = 4000 tokens
  - 次相关意群: digest × 2 = 2000 tokens
  - 其他意群: summary × 2 = 200 tokens
总计: 6200 tokens
效果: 平衡细节与覆盖范围
```

---

## 🎨 自定义规则

### 修改问题类型模式

```javascript
// 添加新的问题类型
window.SmartGranularitySelector.QUERY_PATTERNS.extraction.push(
  /列表|清单|list|enumerate/
);
```

### 调整粒度规则

```javascript
// 修改分析性问题的策略
window.SmartGranularitySelector.GRANULARITY_RULES.analytical = {
  default: 'full',      // 改为使用full
  maxGroups: 3,         // 减少意群数量
  description: '分析性查询：使用全文深入分析'
};
```

### 自定义Token估算

```javascript
// 根据实际模型调整估算比例
const originalEstimate = window.SmartGranularitySelector.estimateTokenUsage;
window.SmartGranularitySelector.estimateTokenUsage = function(groups, granularity) {
  const baseTokens = originalEstimate(groups, granularity);
  // 为GPT-4调整系数（中文token比例更高）
  return Math.ceil(baseTokens * 1.3);
};
```

---

## 🐛 调试技巧

### 查看分析结果

```javascript
// 在浏览器控制台测试
const query = "这篇文章的主要结论是什么？";
const groups = window.data.semanticGroups;

const strategy = window.SmartGranularitySelector.selectGranularity(query, groups);
console.table(strategy);
```

### 对比不同问题类型

```javascript
const queries = [
  "总结全文",
  "为什么会出现这个结果？",
  "表3的数据是多少？",
  "第二章讲了什么？"
];

queries.forEach(q => {
  const s = window.SmartGranularitySelector.selectGranularity(q, groups);
  console.log(`\n问题: ${q}`);
  console.log(`类型: ${s.queryType}`);
  console.log(`粒度: ${s.granularity}`);
  console.log(`Token: ${s.estimatedTokens}`);
});
```

### 混合粒度可视化

```javascript
const rankedGroups = groups.map((g, i) => ({
  group: g,
  score: 1 - i * 0.1
}));

const selections = window.SmartGranularitySelector.selectMixedGranularity(
  "详细分析主要观点",
  rankedGroups,
  { maxTokens: 8000 }
);

console.table(selections.map(s => ({
  groupId: s.group.groupId,
  granularity: s.granularity,
  score: s.score.toFixed(2),
  tokens: s.tokens
})));
```

---

## 🔍 常见问题

### Q1: 为什么有时粒度和预期不一致？

**原因**：
1. Token限制触发降级
2. 意群数量少自动提升粒度
3. 意群本身缺少某个粒度的数据

**解决**：
- 检查`estimatedTokens`是否超限
- 查看`adjustByGroupFeatures()`的调整逻辑
- 确保意群数据完整（summary/digest/full都存在）

### Q2: 如何强制使用特定粒度？

```javascript
const strategy = window.SmartGranularitySelector.selectGranularity(
  query,
  groups,
  { forceGranularity: 'full' }  // 强制使用full
);
```

### Q3: 混合粒度和单一粒度哪个更好？

| 特性 | 单一粒度 | 混合粒度 |
|-----|---------|---------|
| **实现复杂度** | 简单 | 复杂 |
| **Token效率** | 一般 | 优秀 |
| **信息完整性** | 一致 | 自适应 |
| **推荐场景** | 简单查询 | 复杂查询 |

**建议**：
- 概览问题：单一粒度（summary）
- 分析问题：混合粒度（最相关用full，其他用digest/summary）
- 提取问题：单一粒度（full）

### Q4: 如何优化Token使用？

```javascript
// 方案1：更激进的降级策略
const strategy = window.SmartGranularitySelector.selectGranularity(
  query,
  groups,
  { maxTokens: 5000 }  // 设置更低的限制
);

// 方案2：使用混合粒度
const selections = window.SmartGranularitySelector.selectMixedGranularity(
  query,
  rankedGroups,
  {
    maxTokens: 6000,
    // 自定义排序：确保最相关的在前面
  }
);

// 方案3：手动过滤低分意群
const filteredGroups = rankedGroups.filter(item => item.score > 0.5);
const selections = window.SmartGranularitySelector.selectMixedGranularity(
  query,
  filteredGroups,
  { maxTokens: 8000 }
);
```

---

## 🎁 最佳实践

### 1. 结合向量搜索

```javascript
// 先用向量搜索获取相关意群并排序
const rankedGroups = await window.SemanticVectorSearch.search(query, groups, {
  topK: 12,
  threshold: 0.3
});

// 再用智能粒度选择器决定每个意群的粒度
const selections = window.SmartGranularitySelector.selectMixedGranularity(
  query,
  rankedGroups,
  { maxTokens: 8000 }
);

// 构建上下文
const context = window.SmartGranularitySelector.buildMixedContext(selections);
```

### 2. 根据文档类型调整

```javascript
// 学术论文：更倾向使用digest
if (documentType === 'academic-paper') {
  window.SmartGranularitySelector.GRANULARITY_RULES.overview.default = 'digest';
}

// 小说：倾向使用full（保持情节连贯）
if (documentType === 'novel') {
  window.SmartGranularitySelector.GRANULARITY_RULES.analytical.default = 'full';
  window.SmartGranularitySelector.GRANULARITY_RULES.analytical.maxGroups = 3;
}
```

### 3. 监控和优化

```javascript
// 记录粒度策略和实际效果
const strategy = window.SmartGranularitySelector.selectGranularity(query, groups);

console.log({
  query,
  queryType: strategy.queryType,
  granularity: strategy.granularity,
  estimatedTokens: strategy.estimatedTokens,
  actualTokens: null, // 实际调用后填充
  responseQuality: null, // 用户反馈后填充
});

// 根据数据优化规则
```

---

## 📝 总结

智能粒度选择器通过以下方式优化对话质量：

1. **自动化**：无需用户手动选择粒度
2. **智能化**：根据问题类型自动调整
3. **高效化**：在保证信息完整的前提下最小化Token消耗
4. **灵活化**：支持混合粒度和动态调整

**核心价值**：
- 概览问题节省 **80%+** Token
- 分析问题节省 **50%** Token
- 提取问题提升 **信息完整性**
- 混合粒度兼顾 **效率与质量**

---

## 📄 相关文档

- [意群功能使用指南](../agents/SEMANTIC_GROUPS_USAGE.md)
- [向量搜索使用指南](../agents/VECTOR_SEARCH_USAGE.md)
- [BM25检索指南](../agents/BM25_SEARCH_GUIDE.md)
