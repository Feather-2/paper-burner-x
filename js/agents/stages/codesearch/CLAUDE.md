# codesearch - 代码搜索阶段

代码库索引、符号分析与工具化检索（tree/list_dir/glob/grep/read_file 等），通过三阶段 Agent Loop 产出分析摘要，并支持写入型工具在策略/检查点约束下安全回滚。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与对外导出（Stage/State/工具定义） |
| `codesearch-stage.js` | CodeSearchStage：三阶段 loop + DI 集成 + watchdog/timeout |
| `code-tools.js` | 工具定义与执行器（TOOL_DEFINITIONS / createToolExecutor / formatToolDefinitionsForLLM） |
| `prompts.js` | 提示词（system/user 模板） |
| `state.js` / `states.js` | 状态管理（phase/todo/steps/observations） |
| `test.js` / `test-agent-loop.js` | 测试（正常流程/中断恢复/边界输入） |

## 子目录

| 目录 | 职责 |
|------|------|
| `indexing/` | 索引构建（symbol-indexer, index-store） |
| `phases/` | 阶段（planning, execution, summarizing） |

## 对外导出

| 导出 | 说明 |
|------|------|
| `CodeSearchStage` | Stage 类（执行 planning/execution/summarizing） |
| `CodeSearchState` | 状态对象（可序列化/可恢复） |
| `runCodeSearchStage` | 函数式入口（便于集成） |
| `registerCodeSearchStages` | 注册到运行时/DI 容器 |
| `createToolExecutor` | 创建工具执行器（fs/vfs/basePath 注入） |
| `TOOL_DEFINITIONS` | 工具 schema（name/description/parameters/examples） |
| `formatToolDefinitionsForLLM` | 将工具 schema 格式化为 prompt 文本 |

## 工具集（LLM 可调用）

| 工具 | 说明 |
|------|------|
| `glob` | 文件模式匹配 |
| `grep` | 文件内容搜索（可选 regex） |
| `read_file` | 读取文件（支持行范围） |
| `write_file` | 写入文件（VFS-only；策略约束；支持 checkpoint/backtrack） |
| `multi_edit` | 多处精确替换（事务语义；策略约束；支持 checkpoint/backtrack） |
| `list_dir` | 列出目录内容 |
| `tree` | 目录树 |
| `index_symbols` | 构建符号索引（Tree-sitter 优先，失败则 regex 回退） |
| `find_symbol` | 查询符号索引 |

## DI 服务（可选）

这些 ServiceId 字符串用于 DI/容器集成（具体行为以实现为准）：

| ServiceId | 说明 |
|----------|------|
| `eventBus` | 生命周期事件/观测 |
| `memoryStore` | 记忆/缓存 |
| `stateEngine` | 状态机/持久化 |
| `modelRouter` | 模型调用路由 |
| `budgetManager` | 预算管理 |
| `watchdog` | loop/timeout 监控 |
| `runtimeScheduler` | 运行时调度（暂停/恢复） |
| `schemaValidator` | schema 校验 |
| `fileLock` | 文件锁（写入/多编辑） |
| `tocBuilder` | 目录/TOC 生成 |

## 三阶段流程

```
1. Planning Phase
   - LLM 生成 todo 列表
   - 记录初始观察

2. Execution Phase
   - LLM 选择 todo 并调用工具（支持 batch actions）
   - 更新 steps/observations 和 todo 状态
   - Watchdog 检测 loop/timeout
   - 写入型工具通过 policy + checkpoint 保证可回滚

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

## 工具定义注入 Prompt（可选）

当你需要把“可用工具/参数/示例”显式注入 system prompt，可使用 `TOOL_DEFINITIONS` + `formatToolDefinitionsForLLM` 生成稳定文本。

```javascript
import { TOOL_DEFINITIONS, formatToolDefinitionsForLLM } from "js/agents/stages/codesearch";

const toolText = formatToolDefinitionsForLLM(TOOL_DEFINITIONS); // 具体签名以实现为准
```

## 符号索引

```javascript
import { createToolExecutor } from "js/agents/stages/codesearch";

const tools = createToolExecutor({ fs, vfs, basePath: "." });

// 直接传 paths 列表（无需 globFn）
await tools.index_symbols({ paths: ["src/index.js", "src/auth.js"] });

// 查符号（示例：函数名或导出名）
await tools.find_symbol({ name: "createSession" });
```

## 集成要点（安全/回滚）

- `basePath` 作为沙箱根目录：所有 path/pattern 输入都应限制在 `basePath` 内（拒绝 `..`、绝对路径）。
- 正则 `grep` 需要限流/限长：避免 ReDoS（长/复杂 pattern）与全仓扫描导致的 CPU/IO 放大。
- 写入操作必须走 policy：默认拒绝跨目录写入，并确保 checkpoint/backtrack 可用。
