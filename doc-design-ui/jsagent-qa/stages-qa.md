# Stages 文件夹审查报告 (js/agents/stages)

## 1. 潜在问题清单

### 1.1 核心循环逻辑 (Agent Loop)
- **极度复杂的 `run` 方法**: `DeepSearchAgentLoop.run` 函数（第 279 行开始）承担了太多的初始化和副作用逻辑。它既要加载可选机制、Skills 系统，又要构建初始消息、注入各种 ephemeral 提示词，还要负责主循环和错误处理。这种“上帝方法”违反了单一职责原则，使得核心循环的逻辑极其难以测试和维护。
- **Ephemeral 注入的维护负担**: 代码中存在大量的手动 Ephemeral 消息注入逻辑（Shadow, Blackboard, Memory, Budget, Reminder，第 530-646 行）。这些注入逻辑耦合在 `while` 循环内部，任何新的上下文工程实验都需要修改这个核心文件，缺乏一个统一的注入拦截器链（Middleware）。
- **同步状态机缺陷**: 虽然代码中引用了状态逻辑（`state-logic.js`），但 `AgentLoop` 内部的状态转换仍然充满了命令式的 `if/else` 修改。特别是在系统错误回滚 `iteration` 的逻辑（第 915 行），容易与 `ModelResponseHandler` 的重试逻辑产生竞态条件。

### 1.2 并行与子代理 (Concurrency & Subagents)
- **内存任务注册表的泄露风险**: `tools/task/handler.js` 维护了一个全局的 `runningTasks` Map（第 26 行）。虽然有 `pruneRunningTasks` 逻辑，但如果大量子任务长时间处于 `running` 状态，它们将永远不会被清理（第 70 行）。在常驻服务模式下，这会导致缓慢的内存增长。
- **子代理上下文穿透风险**: `createTaskScopedSharedContext` 使用 Proxy 来限制子代理对 SharedContext 的访问（第 23 行）。然而，Proxy 仅拦截了部分方法，对于直接的对象属性访问或通过非拦截方法获取的引用，子代理仍然可能“越狱”读取到非授权的任务数据。
- **工厂函数的冗余**: `researcher` 和 `analyzer` 工厂函数逻辑高度重复（第 63, 106 行），唯一的区别是迭代次数。这种硬编码的工厂模式不利于未来动态扩展更多类型的子代理（如 Coder, Reviewer）。

### 1.3 健壮性与鲁棒性 (Robustness)
- **重试机制的局限**: `ModelResponseHandler` 的重试逻辑基于简单的计数（第 438 行）。对于特定类型的错误（如 API 的 JSON 截断），简单的重试可能反复产生相同的错误。缺乏针对错误模式的指数退避或 Prompt 修正策略（Self-Correction）。
- **同步数据同步损耗**: `iteration` 内部频繁调用 `this.memory.syncAll()`（第 562 行）和 `this.sourceManager.syncSources()`。在处理大量文档元数据时，这种每轮必做的全量同步会导致主循环明显的帧率下降。

### 1.4 代码质量 (Code Quality)
- **动态导入的错误屏蔽**: `loadMechanisms` 捕获了所有导入错误（第 43 行等），虽然有 `shouldReportMechanismLoadError` 过滤，但这可能导致某些关键的优化组件（如 `MemoryStore`）在配置错误时静默回退到基础模式，用户感知不到性能下降的原因。
- **幻数与硬编码配置**: 循环中存在大量的硬编码轮次建议（第 423-425 行），这些逻辑应该从 `prompts` 模版中提取到配置层。

## 2. 改进建议
1. **重构 Loop 为管道模式**: 将 `DeepSearchAgentLoop` 的 `while` 循环抽象为 `ContextProcessorChain`，将 Shadow/Blackboard/Memory 等注入逻辑转化为独立的处理器插件。
2. **引入有限状态机 (FSM)**: 彻底使用类似 XState 的方案管理 Agent 状态，确保在并发 Action 和异步子代理回调中的状态一致性。
3. **完善子代理沙箱**: 除了 Proxy 拦截，应在子代理启动时为其提供完全独立的 `ScopedSharedContext` 实例，从物理上隔离内存空间。
4. **优化任务清理策略**: 为 `runningTasks` 引入 `maxRunningTime` 保护，自动中止超时未响应的子代理，并释放其持有的文件句柄和内存索引。
5. **增强错误自愈能力**: 在 `ModelResponseHandler` 中增加 `CorrectionPrompt` 机制。例如，当发现模型输出的 JSON 被截断时，下一轮注入特定的“请继续从 ... 处完成 JSON”指令。

## cc是如何解决这个问题的

Claude Code (CC) 通过精简的核心循环、解耦的工具系统和自动化的状态持久化，解决了 Stage (阶段) 和 Loop (循环) 的复杂性问题：

1.  **极简的 Conversation Loop**:
    *   **职责单一化**: CC 的 `ConversationLoop` ([`src/core/loop.ts`](ref/claude-code-open-main/src/core/loop.ts)) 仅负责消息的发送、响应解析、工具调度和基本的消息清理（`cleanOldPersistedOutputs`）。它不处理复杂的初始化，而是通过外部传入的 `PromptContext` 和 `Client` 实例进行驱动。
    *   **异步流式处理**: 支持流式输出 (`processMessageStream`)，将文本生成和工具执行解耦，极大提升了用户体验，并减少了主线程阻塞，解决了 jsagents 中“全量同步导致的帧率下降”问题。

2.  **模块化的 Ephemeral 数据管理**:
    *   **持久化输出优化**: CC 使用 `<persisted-output>` 标签处理大型工具返回 ([`src/core/loop.ts`](ref/claude-code-open-main/src/core/loop.ts))。只有最新的 N 个大型输出（默认 3 个）会被保留在上下文中，旧的会自动清理。这避免了 jsagents 建议中担心的“上下文工程维护负担”，通过简单的阈值和数量控制实现了自动化的上下文回收。

3.  **健壮的任务与子代理调度**:
    *   **UUID 与文件持久化**: CC 并不将子代理任务仅保存在内存中，而是通过 `saveAgentState` ([`src/tools/agent.ts`](ref/claude-code-open-main/src/tools/agent.ts)) 将状态实时写入磁盘 JSON 文件。这不仅解决了内存泄露风险，还支持跨进程或重启后的 `resume` 恢复。
    *   **Hooks 系统**: 启动和停止子代理采用 `runSubagentStartHooks` 和 `runSubagentStopHooks` ([`src/tools/agent.ts`](ref/claude-code-open-main/src/tools/agent.ts))，这提供了一个标准的、解耦的拦截点，类似于 jsagents 建议的管道模式。

4.  **智能重试与权限集成**:
    *   **权限批准回调**: 工具执行通过 `handlePermissionRequest` 动态获取授权 ([`src/core/loop.ts`](ref/claude-code-open-main/src/core/loop.ts))。
    *   **纯浏览器端适配**: 核心循环完全基于 Promise 队列和 AsyncGenerator，其持久化标签逻辑和消息清理算法是纯字符串处理，不依赖 Node.js 特性，可直接移植到浏览器的消息管理模块中。
