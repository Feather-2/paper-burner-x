# core (runtime/core) - 运行时核心

Agent Loop 与 Orchestrator 的核心组件，负责循环执行、消息编排、生命周期钩子、状态流转与工具分发。

## 模块职责

- 管理单次 run 的生命周期（start -> running -> end/stop）
- 统一 pre/post hooks 调用与耗时统计
- 处理输入消息、队列与事件发射
- 统一工具注册、查找、分发与结果封装
- 处理大输出持久化，避免上下文膨胀

## 核心文件

| 文件 | 职责 |
|------|------|
| `agent-loop.js` | BaseAgentLoop 基础循环与流程骨架 |
| `agent-loop-lifecycle-hooks.js` | Agent 生命周期钩子封装（pre/post + skip + duration） |
| `agent-loop-message-handling.js` | BaseAgentLoop 消息与用户输入处理（MessageManager + Deque + EventBus） |
| `agent-loop-tool-dispatch.js` | BaseAgentLoop 工具调度封装（ToolRegistry / ToolResult） |
| `agent-coordination.js` | AgentOrchestrator 协调层：child agent 注册、start/stop/end、生命周期事件发射 |
| `agent-status.js` | AgentStatus、StepStatus 枚举 |
| `lifecycle.js` | 生命周期事件定义 |
| `status-controller.js` | StatusController 状态控制 |
| `message-manager.js` | MessageManager 消息管理 |
| `tool-registry.js` | ToolRegistry 工具注册、查找与约束 |
| `persisted-output.js` | 大输出持久化处理 |
| `constants.js` | ActorType、OrchestratorState 常量 |
| `orchestrator-helpers.js` | 协调辅助函数（如 stop reason 分类） |

## Agent 协调与生命周期（agent-coordination.js）

### 主要方法

- `registerAgent(agent)`：注册可释放子 Agent（具备 `dispose()`），在 orchestrator 释放时统一清理。
- `start()`：切换到 `RUNNING`，发射运行开始与 `AgentLifecycleEvents.BUSY`。
- `stop(reason = cancelled)`：规范化 reason，区分失败/取消，触发 `AbortController.abort(reason)` 并发射停止相关事件。
- `end(reason = completed)`：将运行态收敛为结束态并发射 ended 事件（幂等）。

### 状态流转

`IDLE -> RUNNING -> ENDED | CANCELLED | FAILED`

### 事件负载约定

- `BUSY`: `{ actor: system, status: busy, payload: { runId } }`
- `STOPPED`: `{ actor: system, status: stopped, payload: { reason, runId } }`

## 生命周期钩子（agent-loop-lifecycle-hooks.js）

`runWithAgentLifecycleHooks(options)` 负责在单次 `loop.run()` 前后执行 hooks，并统一计算 `durationMs`。

### 约定

- pre/post hooks 必须走统一异常边界，异常需被记录并结构化返回。
- hooks 的异常不应破坏主流程结束态收敛。
- 支持 `sessionId`、`runId`、`input`、`context`、`stageApi` 等运行时透传字段。
- 输出需包含可观测字段（如状态、耗时、停止原因）。

## 消息处理（agent-loop-message-handling.js / message-manager.js）

- 管理用户输入标准化、消息队列入出队与去重。
- 通过 EventBus 发送关键节点事件，保证上层可观测。
- 对空输入、空消息、非法消息结构执行边界防护。

## 工具分发（agent-loop-tool-dispatch.js / tool-registry.js）

- 工具调用前执行参数校验、工具存在性校验、超时与取消信号绑定。
- 工具执行结果使用统一结构封装，异常以可恢复错误向上返回。
- 对工具名与参数对象进行安全约束，避免原型污染与意外属性注入。

## 大输出持久化（persisted-output.js）

- 对超长输出进行持久化与引用化，降低上下文窗口压力。
- 保证引用对象可追踪、可回收，避免内存泄漏。

## 常量与辅助（constants.js / orchestrator-helpers.js）

- 统一 actor、状态枚举与 stop reason 分类逻辑。
- 避免魔法字符串，确保状态机和事件名一致性。

## 安全与质量基线

- 禁止 `eval`、`new Function` 与未转义 `innerHTML`。
- 用户可控输入不得直接作为对象路径写入（防原型污染）。
- 外部 URL 请求需白名单或协议限制（防 SSRF）。
- 错误信息对用户侧做降噪，内部保留诊断上下文。
- 异步流程必须显式传播或处理异常，不允许空 `catch`。

## 测试重点

- 工具调用边界：`null/undefined/空对象/超长参数/并发调用`。
- Hook 异常隔离：pre/post 抛错不应中断 run 收敛。
- 内存压力：大输出持久化后的回收与引用一致性。
- 并发场景：快速连续 `start/stop/end` 的状态机正确性。