# core (runtime/core) - 运行时核心

Agent Loop 与 Orchestrator 的核心组件，负责循环执行、消息编排、生命周期钩子、状态流转与工具分发。

## 核心文件

| 文件 | 职责 |
|------|------|
| `agent-loop.js` | BaseAgentLoop - 基础循环 |
| `agent-loop-lifecycle-hooks.js` | Agent 生命周期钩子封装（pre/post + skip + duration） |
| `agent-loop-message-handling.js` | BaseAgentLoop 消息与用户输入处理（MessageManager + Deque + EventBus） |
| `agent-loop-tool-dispatch.js` | BaseAgentLoop 工具调度封装（ToolRegistry / ToolResult） |
| `agent-coordination.js` | AgentOrchestrator 协调层：child agent 注册、start/stop/end、生命周期事件发射 |
| `agent-status.js` | AgentStatus, StepStatus 枚举 |
| `lifecycle.js` | 生命周期事件 |
| `status-controller.js` | StatusController - 状态控制 |
| `message-manager.js` | MessageManager - 消息管理 |
| `tool-registry.js` | ToolRegistry - 工具注册 |
| `persisted-output.js` | 大输出持久化处理 |
| `constants.js` | ActorType / OrchestratorState 常量定义 |
| `orchestrator-helpers.js` | 协调辅助函数（如 stop reason 分类） |

## Agent 协调与生命周期 (AgentCoordination)

`agent-coordination.js` 提供 AgentOrchestrator 的协调方法，聚焦状态流转与生命周期事件。

### 主要方法

- `registerAgent(agent)`：注册可释放的子 Agent（具备 `dispose()`），在 orchestrator 释放时统一清理。
- `start()`：切换到 `RUNNING`，发射 run-started 与 `AgentLifecycleEvents.BUSY`。
- `stop(reason = "cancelled")`：
  - 使用 `toNonEmptyString()` 规范化 reason
  - 通过 `isFailureStopReason()` 判定失败/取消
  - 调用 `AbortController.abort(reason)` 广播停止
  - 发射 failed/cancelled/ended 与 `AgentLifecycleEvents.STOPPED`
- `end(reason = "completed")`：将运行态收敛为结束态，并发射 ended 事件（幂等）。

### 状态流转

`IDLE -> RUNNING -> (ENDED | CANCELLED | FAILED)`

### 事件负载约定

- `BUSY`: `{ actor: ActorType.SYSTEM, status: "busy", payload: { runId } }`
- `STOPPED`: `{ actor: ActorType.SYSTEM, status: "stopped", payload: { reason, runId } }`

## Agent 生命周期钩子 (Lifecycle Hooks)

`agent-loop-lifecycle-hooks.js` 提供 `runWithAgentLifecycleHooks()`，用于在一次 `loop.run()` 前后统一执行 pre/post hooks，并统一计算耗时（ms）。

### 函数签名

```javascript
runWithAgentLifecycleHooks({
  loop,
  runId,
  sessionId,  // string | null
  input,
  context,
  stageApi,
  startTime,  // 可选：用于对齐外层计时
})
```

- `startTime`：若传入 number，则作为 `startedAt` 使用；否则使用 `Date.now()`。
- `stageApi`：运行时上下文能力，支持 `signal/eventBus/emit/checkCancelled`。

### 数据流

```
runWithAgentLifecycleHooks()
    ↓
[Pre Hook] createPreAgentHook()
    ↓
preResult.skip?
  ├─ yes → emit `${loop.stageName}.agent.skipped` → return preResult.value / { ok: false, error: reason }
  └─ no  → loop.run(input, context)
              ↓
          [Post Hook] createPostAgentHook() (success/error)
              ↓
          return result / throw err
```

### Hook 上下文

- pre: `{ eventBus, stageApi, signal }`
  - `eventBus`：来自 `loop.eventBus`（若存在）
  - `signal`：来自 `context.signal`（若存在）
  - `stageApi`：由上层注入，预期包含取消/中断能力（如 `AbortSignal` / `checkCancelled()`）
- post: `{ eventBus, stageApi }`
- duration: `Date.now() - startedAt`

### 事件

- skip 事件：`${loop.stageName}.agent.skipped`
- emit 选择：`loop.emit || loop.eventBus.emit`（若存在）
- payload：
  - 外层：`{ actor, status: "skipped", payload }`
  - 内层 payload：`{ runId, reason, duration }`

## 消息与用户输入 (Message Handling)

`agent-loop-message-handling.js` 负责初始化 `MessageManager`，并维护用户输入缓冲（Deque）、消息状态与事件桥接。

## 相关约定

- 事件名格式：`domain:action`
- 服务名格式：camelCase
- 所有对外可见状态事件应包含 `runId`
- 停止与结束流程应保证幂等（重复调用不产生副作用）
