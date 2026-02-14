# tools (deepsearch) - DeepSearch 工具

DeepSearch 阶段的工具集合：模型直接调用的原子执行单元。当前实现采用“注册层 + 目录层 + 执行层”拆分，`index.js` 负责聚合导出。

## 核心文件列表
- `js/agents/stages/deepsearch/tools/index.js` - 工具注册表；维护兼容别名（`Task`/`task`）；透传导出 `tool-catalog.js` 与 `tool-executor-ds.js`。
- `js/agents/stages/deepsearch/tools/tool-catalog.js` - `getToolDefinitions`、`ToolPriority`、`getToolCatalogPrompt`；按 `critical/important/optional` 生成工具目录提示。
- `js/agents/stages/deepsearch/tools/tool-executor-ds.js` - DeepSearch 工具执行适配层；负责配额管理器解析、执行包装、追踪与错误标准化。
- `js/agents/stages/deepsearch/tools/*/handler.js` - 每个工具的 `definition` 与 `handler` 实现。
- `js/agents/stages/deepsearch/tools/manage-todos/SKILL.md` - 待办管理工具约定。
- `js/agents/stages/deepsearch/tools/search-docs/SKILL.md` - 文档检索策略提示。
- `js/agents/stages/deepsearch/tools/write-report/SKILL.md` - 报告生成与提交规范提示。

## 关键概念
- Tool definition：每个工具导出 `definition`（`name`/`description`/`parameters`/`priority`/`layer`/`activation`），供模型选择与目录渲染使用。
- 注册与执行解耦：`index.js` 仅做注册与聚合，目录逻辑与执行逻辑分别在 `tool-catalog.js`、`tool-executor-ds.js`。
- 工具名称兼容：`task` 与 `Task` 指向同一 handler，用于兼容大小写差异。
- 工具优先级：`critical`/`important`/`optional` 影响 `getToolCatalogPrompt` 的展示顺序。
- toolQuotaManager 解析顺序：优先 `context.toolQuotaManager` / `context.stageApi.toolQuotaManager`，其次从 DI container 的 `tryGet/get('toolQuotaManager')` 获取。
- SharedContext 黑板：跨代理共享 `signal`/`summary`/`store`/`search`；`advise-task`、`get-task-result`、`record-finding`、`cross-verify` 等依赖该黑板。
- Discovery & Gap：`DiscoveryManager` + gap 状态驱动证据收集与评估（`search-docs` → addEvidence；`evaluate-gaps`/`cross-verify` → 更新状态）。
- SourceManager 文档源：`list-docs`/`read-doc`/`search-docs` 通过 SourceManager 统一读取与检索。
- 子代理任务：`task` 启动 subagent（异步/同步），`get-task-result` 查询结果，`advise-task` 向运行中任务发送建议。
- 报告流水线：`write-report` 支持增量写作、章节更新与审查；提交时执行分析门槛检查。
- 持久化输出：`get-artifact` 从 RunStore 取回大结果（支持截断/分页）。
- Todo 计划：`manage-todos`/`refine-planning` 对 `state.todos` 增删改/重排，供报告与计划检查使用。
- 守护机制：`watchdog` 在卡住或接近超时时生成深思提示或交接文档。
- 技能桥接：`skill` 用于按需调用项目内 SKILL 工作流（需白名单/沙箱约束）。

## 公开导出
- `tools`（默认导出同名对象）。
- `tool-catalog.js` 的全部导出通过 `index.js` 透传。
- `tool-executor-ds.js` 的全部导出通过 `index.js` 透传。

## 子模块索引
| 工具 | 目录 | 说明 |
| --- | --- | --- |
| advise-task | `advise-task/` | 向运行中的子代理发送建议/指令，校验任务状态后投递。 |
| ask-user | `ask-user/` | 在缺少关键信息时向用户发起澄清或确认。 |
| cross-verify | `cross-verify/` | 对已收集证据执行交叉验证并更新置信度。 |
| evaluate-gaps | `evaluate-gaps/` | 评估研究缺口（gap）状态，驱动下一步检索策略。 |
| get-artifact | `get-artifact/` | 从 RunStore 读取产物，支持大结果回传。 |
| get-task-result | `get-task-result/` | 查询子代理执行结果与状态。 |
| list-docs | `list-docs/` | 枚举可用文档源与元信息。 |
| manage-todos | `manage-todos/` | 管理 DeepSearch 计划与待办项。 |
| read-doc | `read-doc/` | 按文档与片段读取内容。 |
| record-finding | `record-finding/` | 记录阶段发现与证据摘要。 |
| refine-planning | `refine-planning/` | 根据进展重排计划、细化任务步骤。 |
| search-docs | `search-docs/` | 执行检索并回传候选证据。 |
| skill | `skill/` | 调用受控技能工作流（白名单 + 沙箱）。 |
| task | `task/` | 启动/管理子代理任务（兼容别名 `Task`）。 |
| watchdog | `watchdog/` | 卡住检测、超时提醒与交接文档生成。 |
| write-report | `write-report/` | 报告写作、合并与最终提交。 |