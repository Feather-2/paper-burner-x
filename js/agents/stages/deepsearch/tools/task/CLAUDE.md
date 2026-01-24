# task (deepsearch tool) - 子任务工具

启动独立 SubAgent 处理 DeepSearch 子任务，支持异步/同步执行，并维护任务状态与清理。

## 模块描述

- 通过 `handler` 从 `globalSubagentRegistry` 创建子代理并执行；子代理注册采用动态 `import` 延迟加载，避免循环依赖。
- 默认异步：立即返回 `taskId`，结果可通过 get-task-result 查询；同步模式会等待完成。
- 任务结果写入 `sharedContext`，并记录到任务注册表用于状态查询、TTL 过期与清理。
- 请求参数在入口做基础校验（子代理类型/Prompt/SourceIds/长度上限），并对数值配置做正整数解析（避免 NaN/负数）。

## 核心文件

| 文件 | 用途 |
|------|------|
| `handler.js` | Task 工具定义、执行逻辑、任务管理与状态查询 |

## 关键概念

- 子代理类型：`researcher`（fast）与 `analyzer`（normal）；注册通过 `subagents.js` 延迟导入，注册失败会记录 warn（调用方需按失败路径处理）。
- 任务 ID：使用 `makeSecureTimestampedId()` 生成 `taskId`，降低可预测性，便于跨会话/并发追踪。
- 输入验证：`subagent_type` 白名单、`prompt` 非空且有最大长度、`sourceIds` 过滤非法值。
- 超时与取消：每个任务使用 `AbortController`，可由 `stageApi.signal` 级联取消，超时后标记失败。
- TaskManager：维护运行中/已完成任务；`TaskRecord` 记录 `startedAt/completedAt/expiresAt`，支持 TTL 清理与容量上限。
- 资源清理：清理定时器/interval 通过可释放的管理对象统一维护；Node 环境下如存在 `unref()` 会避免定时器阻塞进程退出（浏览器环境无此能力）。
- 结果压缩：保留 `summary`/`ok` 与 `report`/`analysis`/`findings` 预览，控制内存占用；压缩后用 `compacted` 标记并缓存 `result` 预览。
- 事件与上下文：`emit` 发送 started/completed/failed 事件；`sharedContext.store` 持久化结果。
- Source 继承：`sourceIds` 优先，否则继承 `state.L0.sources`，由 `SourceManager` 对齐。
- 配置来源：从 `stageApi.env` 读取并覆盖默认配置（浏览器环境兼容）。

## 常见任务

- 启动子任务（异步）：调用 `Task` 工具返回 `taskId`，后续用 `get-task-result` 获取结果。
- 启动子任务（同步）：设置 `async=false`，等待完成并返回 `summary`/`error`。
- 查询/等待任务：`getTaskStatus(taskId)` 或 `waitForTask(taskId, timeout)`（超时返回 `status=timeout`）。
- 调整并发与清理：配置 `DEEPSEARCH_MAX_RUNNING_TASKS`、`DEEPSEARCH_TASK_TTL_MS`、`DEEPSEARCH_TASK_CLEANUP_INTERVAL_MS`、`DEEPSEARCH_TASK_RESULT_PREVIEW_CHARS`、`DEEPSEARCH_TASK_TIMEOUT_MS`。
- 测试/HMR：必要时调用 `resetTaskManager()` 清空单例与定时器；如同时重置子代理注册状态，需确保延迟注册逻辑可重新执行。
