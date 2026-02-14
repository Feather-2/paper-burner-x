# codesearch - 代码搜索阶段

代码库索引、符号分析与工具化检索（`tree`/`list_dir`/`glob`/`grep`/`read_file` 等），通过三阶段 Agent Loop 产出分析摘要，并支持写入型工具在策略/检查点约束下安全回滚。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口与对外导出（Stage/State/工具定义） |
| `codesearch-stage.js` | `CodeSearchStage`：三阶段 loop + DI 集成 + watchdog/timeout |
| `code-tools.js` | 工具执行层与聚合导出（执行器装配、索引接入、写入策略调用） |
| `code-tools-helpers.js` | 工具 schema 与通用辅助函数（`TOOL_DEFINITIONS`、路径/参数/文本归一化） |
| `prompts.js` | 提示词（system/user 模板） |
| `state.js` / `states.js` | 状态管理（phase/todo/steps/observations） |
| `test.js` / `test-agent-loop.js` | 测试（正常流程/中断恢复/边界输入） |

## 子目录

| 目录 | 职责 |
|------|------|
| `indexing/` | 索引构建（symbol-indexer, index-store） |
| `phases/` | 阶段实现（planning, execution, summarizing） |

## 对外导出

| 导出 | 说明 |
|------|------|
| `CodeSearchStage` | Stage 类（执行 planning/execution/summarizing） |
| `CodeSearchState` | 状态对象（可序列化/可恢复） |
| `runCodeSearchStage` | 函数式入口（便于集成） |
| `registerCodeSearchStages` | 注册到运行时/DI 容器 |
| `createToolExecutor` | 创建工具执行器（`fs`/`vfs`/`basePath` 注入） |
| `TOOL_DEFINITIONS` | 工具 schema（name/description/parameters/examples） |
| `formatToolDefinitionsForLLM` | 将工具 schema 格式化为 prompt 文本 |

## 工具集（LLM 可调用）

| 工具 | 说明 |
|------|------|
| `glob` | 文件模式匹配 |
| `grep` | 文件内容搜索（可选 regex） |
| `read_file` | 读取文件（支持行范围） |
| `write_file` | 写入文件（VFS-first；策略约束；支持 checkpoint/backtrack） |
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

```text
1. Planning Phase
   - LLM 生成 todo 列表与执行策略
   - 记录初始观察与约束（范围/预算/输出格式）

2. Execution Phase
   - LLM 选择 todo 并调用工具（支持批量行动）
   - 工具结果写回 observations/steps
   - 写入型工具可启用 checkpoint，失败时 backtrack

3. Summarizing Phase
   - 汇总证据、结论与未决风险
   - 产出结构化摘要（发现/依据/建议）
```

## 工具定义与执行分层

- `code-tools-helpers.js`：负责工具定义与纯函数辅助逻辑（可复用、便于测试）。
- `code-tools.js`：负责执行器装配（`vfs/fs` 注入、索引器、策略写入、事件上报）。
- 通过“定义层/执行层”解耦，降低单文件复杂度并提高可维护性。

## 写入与回滚约束

- `write_file` / `multi_edit` 默认走策略化写入接口，避免直接裸写。
- 建议默认启用 checkpoint，并在阶段失败时统一触发回滚。
- 建议对路径进行规范化与工作区边界校验，避免越界读写。

## Browser-first 兼容性

- 优先使用 VFS 接口；Node 文件系统能力作为可选注入。
- 保持 ES Modules + JSDoc，无 TypeScript 构建依赖。
- 工具层避免绑定 Node-only 全局对象，确保浏览器可运行。

## 测试重点

- 正常流程：planning → execution → summarizing 端到端连通。
- 异常恢复：工具失败、超时、中断后的 checkpoint/backtrack。
- 边界输入：空路径、非法行号、超长 pattern、并发调用。
- 质量约束：避免伪测试与过度 mock，优先验证真实工具行为。