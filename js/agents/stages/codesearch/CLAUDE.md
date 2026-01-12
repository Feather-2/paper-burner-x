# codesearch - 代码搜索阶段

代码库索引、符号分析和语义检索。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口 |
| `codesearch-stage.js` | CodeSearchStage |
| `code-tools.js` | 代码工具定义 |
| `prompts.js` | 提示词 |
| `state.js` / `states.js` | 状态管理 |
| `test.js` / `test-agent-loop.js` | 测试 |

## 子目录

| 目录 | 职责 |
|------|------|
| `indexing/` | 索引构建（symbol-indexer, index-store） |
| `phases/` | 阶段（planning, execution, summarizing） |

## 三阶段流程

```
1. Planning Phase
   - 分析查询意图
   - 确定搜索策略

2. Execution Phase
   - 符号索引查询
   - 语义向量检索
   - 正则模式匹配

3. Summarizing Phase
   - 结果聚合
   - 相关性排序
   - 生成摘要
```

## 使用示例

```javascript
import { CodeSearchStage } from 'js/agents/stages/codesearch';

const stage = new CodeSearchStage({
  indexStore: await IndexStore.create(projectPath),
  eventBus,
});

const results = await stage.search('authentication middleware implementation');
// → [{ file, symbols, relevance, snippet }]
```

## 符号索引

```javascript
import { SymbolIndexer, IndexStore } from 'js/agents/stages/codesearch/indexing';

const indexer = new SymbolIndexer();
await indexer.index(projectPath);

const store = new IndexStore(indexPath);
const symbols = await store.query({ type: 'function', name: /auth/i });
```
