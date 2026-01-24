# tools (deepsearch) - DeepSearch 工具

DeepSearch 阶段的工具集合：模型直接调用的原子执行单元。入口由 `index.js` 聚合，并提供执行、目录提示与配额/追踪/错误封装。

## 核心文件列表
- `js/agents/stages/deepsearch/tools/index.js` - 工具注册表、`getToolDefinitions`/`getToolCatalogPrompt`、`executeTool`、ToolExecutor 适配、配额/追踪/错误封装；包含 toolQuotaManager 解析与工具名兼容（`Task`/`task`）。
- `js/agents/stages/deepsearch/tools/*/handler.js` - 每个工具的 `definition` 与 `handler` 实现。
- `js/agents/stages/deepsearch/tools/manage-todos/SKILL.md` - 待办管理工具的操作约定。
- `js/agents/stages/deepsearch/tools/search-docs/SKILL.md` - 文档检索策略提示。
- `js/agents/stages/deepsearch/tools/write-report/SKILL.md` - 报告生成与提交规范提示。

## 关键概念
- Tool definition：每个工具导出 `definition`（`name`/`description`/`parameters`/`priority`/`layer`/`activation`），用于模型选择与工具目录生成。
- Tool 执行与配额：`executeTool` 通过 toolQuotaManager 控制调用（warn/block），并上报事件与 trace span；错误需统一包装为可诊断的错误类型。
- toolQuotaManager 解析顺序：优先使用 `context.toolQuotaManager`/`context.stageApi.toolQuotaManager`，其次从 DI container 中 `tryGet/get('toolQuotaManager')` 获取（用于不同运行环境注入）。
- 工具名称兼容：`task` 与 `Task` 指向同一实现，避免大小写差异导致工具不可用（目录提示应优先展示规范名称 `task`）。
- 工具优先级：`critical`/`important`/`optional` 影响 `getToolCatalogPrompt` 的排序展示。
- SharedContext 黑板：跨代理共享 `signal`/`summary`/`store`/`search`；`advise-task`、`get-task-result`、`record-finding`、`cross-verify` 等依赖该黑板读写。
- Discovery & Gap：`DiscoveryManager` + gap 状态驱动证据收集与评估（`search-docs` → addEvidence；`evaluate-gaps`/`cross-verify` → 更新状态）。
- SourceManager 文档源：`list-docs`/`read-doc`/`search-docs` 通过 SourceManager 同步文档与读取/检索。
- 子代理任务：`task` 启动 subagent（异步/同步），`get-task-result` 查询结果，`advise-task` 对运行中任务发送建议。
- 报告流水线：`write-report` 支持增量写作/章节更新/审查；提交时执行分析门槛检查。
- 持久化输出：`get-artifact` 从 RunStore 取回大结果（支持截断/分页）。
- Todo 计划：`manage-todos`/`refine-planning` 对 `state.todos` 增删改/重排，供报告与计划检查使用。
- 守护机制：`watchdog` 在卡住或接近超时时生成深思提示或交接文档。
- 技能桥接：`skill` 用于按需调用项目内 SKILL 工作流（必须经过白名单/沙箱约束，避免执行未授权操作）。

## 子模块索引
| 工具 | 目录 | 说明 |
| --- | --- | --- |
| advise-task | `advise-task/` | 向运行中的子代理发送建议/指令，基于 SharedContext 信号并校验任务状态。 |
| ask-user | `ask-user/` | 交互式向用户提问并等待回答；无交互模式时返回提示并上报事件。 |
| cross-verify | `cross-verify/` | 对冲突事实发起交叉验证子任务，收集证据并回写 discovery/sharedContext。 |
| evaluate-gaps | `evaluate-gaps/` | 评估 gap 状态与证据覆盖，更新缺口优先级与下一步动作。 |
| get-artifact | `get-artifact/` | 从 RunStore 取回大结果/附件（支持截断与分页）。 |
| get-task-result | `get-task-result/` | 查询子代理任务结果与状态（成功/失败/进行中）。 |
| list-docs | `list-docs/` | 列出可用文档源/文档清单（通过 SourceManager）。 |
| manage-todos | `manage-todos/` | 对 `state.todos` 增删改/重排，支持计划与报告联动。 |
| read-doc | `read-doc/` | 读取单篇文档内容（通过 SourceManager）。 |
| record-finding | `record-finding/` | 记录发现/证据/引用到 SharedContext/discovery，供后续评估与报告使用。 |
| refine-planning | `refine-planning/` | 细化计划步骤、拆分任务并更新待办/里程碑。 |
| search-docs | `search-docs/` | 文档检索与证据抽取（关键词/语义），并可回写 evidence。 |
| skill | `skill/` | 以白名单方式桥接项目内 SKILL 工作流（必须沙箱化/最小权限）。 |
| task | `task/` | 启动子代理任务（异步/同步）；兼容别名 `Task`。 |
| watchdog | `watchdog/` | 卡住/超时检测与自救提示生成（深思/交接文档）。 |
| write-report | `write-report/` | 报告增量写作/章节更新/审查与提交门槛检查。 |
