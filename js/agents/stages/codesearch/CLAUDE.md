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
import { CodeSearchStage } from "js/agents/stages/codesearch";

// Browser-first: 提供 vfs.readText / vfs.writeText；Node 环境可注入 fs + globFn
const stage = new CodeSearchStage({ maxSteps: 12, timeoutMs: 120_000 });

const result = await stage.execute(
  { runId: "codesearch-001" },
  { query: "authentication middleware implementation", basePath: "." },
  { eventBus, fs, vfs, globFn }
);
// → { summary, steps, todos, todoCompletionStats, ... }
```

## 符号索引

```javascript
import { createToolExecutor } from "js/agents/stages/codesearch";

const tools = createToolExecutor({ fs, vfs, basePath: "." });

// 直接传 paths 列表（无需 globFn）
await tools.index_symbols({ paths: ["src/index.js", "src/auth.js"] });

const symbols = await tools.find_symbol({ query: "auth", pathPrefix: "src/" });
// → [{ name, kind, file, startLine, ... }]
```
