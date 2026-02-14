# deepsearch - 深度搜索阶段

多轮文档分析、任务规划、证据记录与报告生成。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 入口：runDeepSearchAgent / runDeepSearchTodosStage |
| `deepsearch-agent-loop.js` | 主循环：planning -> execution -> writing（含收敛检测、取消与错误分类） |
| `constants.js` | 常量与枚举：chunk/gap/并发/检索策略、校验函数（含 SMALL_DOC_TOKEN_THRESHOLD 与兼容别名） |
| `phases/planning-phase.js` | 规划阶段：system prompt 构建与收敛策略 |
| `phases/execution-phase.js` | 工具调用、超时与 checkpoint |
| `phases/writing-phase.js` | 写作阶段与回溯 |
| `state.js` | DeepSearchState 与序列化 |
| `source-manager.js` | 文档读取/检索与语义搜索 |
| `internal/model-response-handler.js` | 模型输出解析与结构化处理 |
| `tools/index.js` | 工具注册与执行 |
| `capabilities-loader.js` | 动态能力加载：集中 optional/dynamic import + 缓存（`_cached`/`_loading`）+ 并发复用 + DI 注入 |

## 子目录

| 目录 | 职责 |
|------|------|
| `tools/` | 工具定义和处理器 |
| `phases/` | 阶段划分 |
| `model/` | 预算/定价模型 |
| `report/` | 报告生成、引用 |
| `internal/` | 内部运行时组件 |
| `state/` | 状态管理 |
| `utils/` | 工具函数 |

## 工具 (tools/)

| 工具 | 文件 | 用途 |
|------|------|------|
| advise-task | `advise-task/handler.js` | 任务建议 |
| ask-user | `ask-user/handler.js` | 用户交互/澄清 |
| cross-verify | `cross-verify/handler.js` | 交叉验证事实/冲突 |
| evaluate-gaps | `evaluate-gaps/handler.js` | 缺口评估与优先级 |
| get-artifact | `get-artifact/handler.js` | 读取持久化大输出 |
| get-task-result | `get-task-result/handler.js` | 获取子任务结果 |
| list-docs | `list-docs/handler.js` | 列出可用文档 |
| manage-todos | `manage-todos/handler.js` | 任务列表管理 |
| read-doc | `read-doc/handler.js` | 读取文档内容 |
| record-finding | `record-finding/handler.js` | 记录 claims/gaps/conflicts |
| refine-planning | `refine-planning/handler.js` | 规划细化 |
| search-docs | `search-docs/handler.js` | 关键词/语义检索 |
| skill | `skill/handler.js` | 读取 Skill 指令 |
| task | `task/handler.js` | 启动子代理任务 |
| watchdog | `watchdog/handler.js` | 资源监控/回溯触发 |
| write-report | `write-report/handler.js` | 报告生成与引用 |

## 可选能力 (capabilities-loader.js)

`loadDeepSearchCapabilities()` 以 best-effort 方式加载可选能力；加载失败时仅记录 warn 日志并继续（返回值字段为 `null`）。并发调用会复用同一个加载中的 Promise（`_loading`）。

| 能力 | 字段 | 用途 |
|------|------|------|
| Skills | `SkillsManager` | Skills 指令加载与执行入口 |
| Budget | `BudgetManager` | 预算与成本控制 |
| Checkpoint | `CheckpointManager` | 阶段 checkpoint 保存/恢复 |
| Shared Context | `SharedContext` | 多轮共享上下文 |
| Backtrack | `BacktrackManager` | 回滚/重试策略 |
| Discovery | `DiscoveryManager` | 发现与索引支持 |
| Memory | `MemoryStore` | 过程记忆存储 |
| Unified Context | `UnifiedAgentContext` | 统一代理上下文封装 |
