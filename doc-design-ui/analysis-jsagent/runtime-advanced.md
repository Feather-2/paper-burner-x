# Analysis: Runtime Advanced Features (运行时高级特性)

## 1. 架构 (Architecture)

### 上下文压缩系统 (`js/agents/runtime/compression/`)
- **`CicadaCompressor`**: 实现了多层级压缩策略。
    - **`TOOL_OUTPUT`**: 自动缩减巨型工具返回值，保留关键 Key（如 `status`, `error`）。
    - **`SESSION_HISTORY`**: 合并相邻角色消息，移除思考过程（Thinking），并基于 `keepLastTurns` 进行滑动窗口压缩。
    - **`LLM_SUMMARY`**: 递归调用模型生成结构化摘要，涵盖决策轨迹和待办事项。
- **健康哨兵 (`Watchdog`)**: 实时监控迭代次数、总耗时及“无进展”时长（stuck），支持 `observe` 模式订阅异常事件并触发干预。

### 遥测与状态追踪 (`js/agents/runtime/telemetry/`)
- **运行状态容器 (`LoopRuntimeState`)**: 基于 `AbortSignal` 的 `WeakMap` 存储模式，实现了对中止/暂停原因和 Checkpoint ID 的解耦追踪。它还内置了严格的状态迁移校验（`LOOP_RUNTIME_TRANSITIONS`）。
- **执行回放与持久化**: 支持将任务轨迹持久化，并通过 `replay-controller.js` 实现决策过程的离线分析。

## 2. 优化 Trick (Optimization Tricks)

- **智能摘要锚点**: 在压缩历史时，`CicadaCompressor` 会识别并强制保留 System Prompt 中的锚点（Anchors），防止核心约束在多次压缩中产生语义偏移。
- **采样截断**: 针对巨型字符串，采用“头尾保留”策略（`truncateText`），在不显著增加 Token 消耗的情况下保留上下文语义。
- **交接文档自生成**: `buildHandoff` 逻辑能自动根据当前状态生成标准化的任务交接书，支持跨会话的任务接力。
- **无感遥测注入**: 利用 `AbortSignal` 作为上下文标识符，使得遥测逻辑无需显式修改核心业务函数的参数签名即可实现深度追踪。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 **Cicada 压缩模型** 具备更强的结构化语义（如 `keyPoints`, `decisions` 数组），而不仅仅是文本摘要，这为 `Recall` 工具提供了更好的索引基础。
- **优势**: **Watchdog 卡死检测**。由于我们处理的是长耗时的 PPT 生成，Watchdog 对长时间无输出状态的监控比 Claude Code 的纯 CLI 交互环境更具实战价值。
- **差距**: Claude Code 的流式处理机制（`StreamingMessageStream`）在高频短对话中响应更快。
- **改进点**: 将 `CicadaCompressor` 的压缩分层逻辑暴露为中间件，允许开发者在 `AgentBuilder` 中自定义特定的压缩层。
