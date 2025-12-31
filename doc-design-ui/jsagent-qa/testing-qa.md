# Testing 文件夹审查报告 (js/agents/testing)

## 1. 潜在问题清单

### 1.1 模拟逻辑与保真度 (Mock Logic & Fidelity)
- **过度简化的模型响应**: `MockModelClient` 仅模拟了 `content` 和基础的 `usage`（第 81 行）。真实的 LLM 响应还包含 `finish_reason`、`system_fingerprint` 以及复杂的 `logprobs` 等。如果 Agent 逻辑依赖这些字段（例如根据 `finish_reason === "length"` 触发自动继续），Mock 环境将无法暴露潜在的 Bug。
- **状态无关的关键词匹配**: `MockModelClient.chat` 通过 `lastMessage.includes(keyword)` 匹配响应（第 58 行）。这种方式不支持多轮对话的状态感知。例如，针对同一个问题“结果是什么？”，在读取文档前和读取文档后应有不同的模拟响应，而目前的实现很难支持这种基于上下文的 Mock 分支。
- **缺失的流式支持**: 所有的 Mock 类（Model, MCP, EventBus）均只支持 Promise/Async 模式，不支持 `ReadableStream` 或异步迭代器。这使得测试无法覆盖 Agent 的流式输出（Streaming）和实时进度反馈逻辑。

### 1.2 场景运行器能力 (Scenario Runner)
- **有限的断言能力**: `_deepMatch` 仅执行浅层属性匹配（第 337 行）。对于复杂的嵌套对象（如 `DeepSearchState`）或无序数组（如检索结果列表），这种匹配方式要么太脆弱，要么无法有效验证数据的正确性。
- **缺乏并发场景模拟**: `ScenarioRunner` 按顺序逐个执行步骤（第 270 行）。这无法模拟主代理与多个并发运行的子代理之间的交互、资源竞争或事件交错。
- **Setup 逻辑的局限**: `setup` 函数虽然提供了初始化 Hook，但没有提供 `teardown` 或 `cleanup` 机制。在批量运行测试时（`runAll`），如果前一个场景修改了全局 Mock 状态（如 `MockMcpProvider` 的工具注册），可能会干扰后续场景。

### 1.3 基础架构与维护 (Infrastructure)
- **手动维护的 Mock 数据**: 目前没有看到从真实运行日志导出并转化为 Mock 场景的工具。这意味着所有的测试场景都需要开发者手动编写复杂的 JSON 结构，维护成本极高，且容易导致 Mock 数据与真实 API 行为脱节。
- **时序断言的缺失**: `MockEventBus` 仅记录了事件发生的先后顺序（第 186 行），但没有提供验证“事件 A 必须在事件 B 之后 100ms 内发生”或“特定 Action 触发了预期的事件序列”的简便 API。

## 2. 改进建议
1. **引入上下文 Mock**: 为 `MockModelClient` 增加基于 `predicate` 的 handler 注册，允许根据对话历史、当前迭代轮次或 Agent 状态动态返回响应。
2. **支持流式模拟**: 改造 `MockModelClient` 以支持返回 `AsyncGenerator`，模拟真实的流式 Token 输出，测试前端的打字机效果和中间状态处理。
3. **增强匹配引擎**: 集成类似 `jest-extended` 或 `chai` 的丰富断言库，支持正则表达式匹配、包含关系、自定义验证逻辑等。
4. **场景自动生成器**: 开发一个 Trace 转换工具，能将生产环境或手动测试产出的 `events.jsonl` 自动降级并序列化为 `ScenarioRunner` 可用的测试用例。
5. **并发模拟支持**: 允许在 `ScenarioRunner` 的步骤中定义 `parallel: true`块，模拟多个工具同时返回结果的竞争情况。
6. **完善资源管理**: 在 `runAll` 中为每个场景提供完全独立的 Mock 实例隔离（沙箱），确保测试的幂等性。

## cc是如何解决这个问题的

Claude Code (CC) 采用了更加工业化的自动化测试和诊断策略，通过分层模拟和真实的 Trace 回放解决了 Agent 测试中的“幻觉”和“低保真”问题：

1.  **高保真的 Trace 录制与回放 (Beta)**:
    *   **会话持久化**: CC 所有的会话数据都以标准的 JSON 格式持久化在 `~/.claude/sessions/` 目录下 ([`src/session/index.ts`](ref/claude-code-open-main/src/session/index.ts))。这些持久化的 `SessionData` 包含了完整的消息历史、工具调用参数及其返回结果。
    *   **Trace 驱动测试**: 通过加载这些真实的会话 JSON，CC 可以轻松地重现 Agent 在特定任务中的决策路径，解决了 jsagents 中“手动维护 Mock 数据”带来的巨大负担。

2.  **模块化的诊断系统 (Diagnostics)**:
    *   **实时分析**: CC 包含一个专门的 `diagnostics` 模块 ([`src/diagnostics/index.ts`](ref/claude-code-open-main/src/diagnostics/index.ts))。它不仅用于运行时错误报告，还集成在 `SystemPromptBuilder` 中，将当前的静态分析（LSP/Compiler）错误直接作为 Agent 的上下文。
    *   **闭环验证**: 在测试中，CC 能够验证 Agent 是否能根据诊断信息（如 `SyntaxError`）自动修正代码，这种基于真实编译器反馈的测试比单纯的“关键词匹配” Mock 要可靠得多。

3.  **支持流式的模拟客户端**:
    *   **Stream 架构**: CC 的 `ClaudeClient` 原生支持 `createMessageStream` ([`src/core/client.ts`](ref/claude-code-open-main/src/core/client.ts))。这意味着在测试环境中，Mock 客户端可以被设计为一个简单的异步生成器，按时序“喂给” Runtime Token，从而全面测试 UI 的打字机效果和并发中止逻辑。

4.  **纯浏览器端测试方案**:
    *   **内存文件系统模拟**: CC 的许多工具（如 Glob/Grep）虽然默认操作物理磁盘，但在测试环境下可以被替换为基于内存的 VFS。
    *   **Web Worker 沙箱**: 在浏览器端测试子代理的并发时，CC 采用的基于消息传递的子代理架构天然支持在不同 Worker 中运行，利用浏览器自带的 DevTools 性能面板即可验证事件的时序和资源竞争，无需复杂的自定义断言库。
