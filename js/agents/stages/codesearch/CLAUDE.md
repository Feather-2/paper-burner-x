# codesearch - 代码搜索阶段

代码库索引、符号分析与工具化检索（tree/list_dir/glob/grep/read_file），通过三阶段 Agent Loop 产出分析摘要。

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

## 工具集

| 工具 | 说明 |
|------|------|
| `glob` | 文件模式匹配 |
| `grep` | 文件内容搜索（可选 regex） |
| `read_file` | 读取文件（支持行范围） |
| `write_file` | 写入文件（VFS-only，支持 checkpoint） |
| `multi_edit` | 多处精确替换（事务语义） |
| `list_dir` | 列出目录内容 |
| `tree` | 目录树 |
| `index_symbols` | 构建符号索引（Tree-sitter 优先，失败则 regex 回退） |
| `find_symbol` | 查询符号索引 |

## 三阶段流程

```
1. Planning Phase
   - LLM 生成 todo 列表
   - 记录初始观察

2. Execution Phase
   - LLM 选择 todo 并调用工具（支持 batch actions）
   - 更新 steps/observations 和 todo 状态
   - Watchdog 检测 loop/timeout

3. Summarizing Phase
   - LLM 生成结构化总结
   - 汇总 todo stats / budget usage
```

## 使用示例

```javascript
import { CodeSearchStage } from "js/agents/stages/codesearch";

// Browser-first：写入依赖 vfs.writeText；索引可用 vfs.readText；
// read_file / list_dir / tree / grep 需要 fs.readFile/readdir/stat。
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
