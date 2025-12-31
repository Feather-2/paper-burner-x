# Analysis: Runtime & Orchestration (运行时与编排)

## 1. 架构 (Architecture)

### 核心编排引擎 (`js/agents/runtime/`)
- **`AgentOrchestrator`**: 采用轻量级的阶段（Stage）运行模式。它通过 `registerStage` 注册处理函数，并强制使用 `Promise` 队列实现任务的顺序执行（`_queue`），确保 UI 状态与持久化的一致性。
- **`BaseAgentLoop`**: 提供了智能体循环的基础框架。
    - **状态机**: 内置了 `AgentStatus` 管理，支持严格的状态迁移校验（`_transitionLoopStatus`）。
    - **中止/暂停机制**: 支持检测 `StagePausedError`，允许任务在特定检查点挂起。
    - **消息压缩**: 集成了 `CicadaCompressor` 进行消息压缩，支持摘要提取与历史保留（`keepLastTurns`）。
    - **Hook 系统**: 提供 `before` 和 `after` 钩子，允许在工具执行前后进行干预。
- **事件总线 (`EventBus`)**: 贯穿整个运行时的通信基座，支持基于 `runId` 的隔离，所有状态变更都通过事件向外扩散。

### 上下文管理系统
- **`UnifiedAgentContext`**: 统一状态管理门面（Facade Pattern）。它整合了 `DeepSearchState`、`MemoryStore` 和 `SharedContext`，实现了“单源真理 (SSOT)”。
- **Checkpoint 系统**: `UnifiedAgentContext` 提供了统一的 `saveCheckpoint` 和 `restoreCheckpoint` 接口，支持对任务目标、待办事项、消息、决策和 Claim 的全量持久化。
- **压缩调度器**: 在 `BaseAgentLoop` 中通过 `queueMicrotask` 异步调度压缩，确保不阻塞主循环。支持 `flushCompression` 屏障，防止在调用 LLM 前消息过载。

## 2. 优化 Trick (Optimization Tricks)

- **微任务调度压缩**: 使用 `queueMicrotask` 调度压缩任务，避免压缩逻辑阻塞即时响应。
- **信号合并机制**: `mergeSignals` 能够将父级取消信号与步骤级中止信号（如暂停）合并，实现精细化的生命周期控制。
- **严格状态迁移**: 在生产环境下强制执行 `DEFAULT_LOOP_STATUS_TRANSITIONS`，防止智能体进入非法运行状态。
- **双层摘要处理**: 压缩时会提取旧摘要并与新内容合并，防止在重复压缩过程中丢失关键的历史上下文。
- **用户输入缓冲**: 支持 `recordUserInput` 异步收集用户反馈，并通过 `drainUserInputsAsText` 批量注入上下文。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的架构原生支持“暂停/恢复”语义（`checkPaused`），并且拥有更强大的 **门面模式上下文管理** (`UnifiedAgentContext`)，使得跨组件状态同步比 Claude Code 更易于维护。
- **差距**: 
    - **后台 Shell 保持能力**: Claude Code 的 `ShellManager` 支持通过 `SIGSTOP/SIGCONT` 跨轮次维持进程状态，我们的后台任务控制相对薄弱，建议引入类似的进程挂起机制。
    - **工具输出持久化**: Claude Code 具有成熟的 `<persisted-output>` 机制（解决 400KB+ 巨型输出）。建议在 `AgentOrchestrator` 中引入“大型输出存根”机制，仅在上下文注入摘要，完整内容按需加载。
    - **监控告警**: 参考其 `monitor.ts`，为运行时增加资源配额、API Latency 追踪及成本实时统计告警。
- **改进点**: 
    - **异步阶段并行**: `AgentOrchestrator` 目前是顺序队列执行。可以参考 Claude Code 的并行思想，在不竞争 UI 资源的情况下允许非阻塞阶段（如后台代码扫描、预加载等）并行执行。
    - **任务恢复机制**: 借鉴其 `resume.ts` 的连续性设计，确保在宿主环境意外崩溃后，能根据 `checkpoint` 自动恢复最后的工作状态。
