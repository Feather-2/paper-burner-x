# core (runtime/core) - 运行时核心

Agent Loop 的核心组件。

## 核心文件

| 文件 | 职责 |
|------|------|
| `agent-loop.js` | BaseAgentLoop - 基础循环 |
| `agent-loop-lifecycle-hooks.js` | Agent 生命周期钩子封装（pre/post + skip + duration） |
| `agent-loop-message-handling.js` | BaseAgentLoop 消息与用户输入处理（MessageManager + Deque + EventBus） |
| `agent-loop-tool-dispatch.js` | BaseAgentLoop 工具调度封装（ToolRegistry / ToolResult） |
| `agent-status.js` | AgentStatus, StepStatus 枚举 |
| `lifecycle.js` | 生命周期事件 |
| `status-controller.js` | StatusController - 状态控制 |
| `message-manager.js` | MessageManager - 消息管理 |
| `tool-registry.js` | ToolRegistry - 工具注册 |
| `persisted-output.js` | 大输出持久化处理 |

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
  - 外层：`{ actor, status: \"skipped\", payload }`
  - 内层 payload：`{ runId, reason, duration }`

## 消息与用户输入 (Message Handling)

`agent-loop-message-handling.js` 负责初始化 `MessageManager`，并维护用户输入缓冲队列，便于 agent loop 在运行中接收、暂存、消费用户输入事件。

### 初始化

```javascript
initMessageHandling(loop, {
  stageName,
  actor,
  emit,
  contextConfig,
  tokenCounter,
  logger,
  maxUserInputs,
});
```

- `_messageManager`：`new MessageManager({ contextConfig, tokenCounter, logger, emit, stageName, actor })`
- `_userInputs`：`Deque<{ payload, ts }>`
- `_userInputEvent`：默认 `\"user.input\"`
- `_maxUserInputs`：`getLimit(\"MAX_USER_INPUTS\", maxUserInputs)`
- `_userInputBus` / `_userInputUnsub`：事件总线与取消订阅句柄（用于挂载/卸载监听）
- `_pauseListenerUnsub`：暂停监听的取消订阅句柄（用于实现 pause/resume 语义）

### EventBus 约定

当接入事件总线时，推荐形态：

- `subscribe(eventName, handler, { signal? }) => () => void`
- `emit(eventName, payload)`

（具体能力以 loop 注入的 eventBus 实现为准）

## 工具调度 (Tool Dispatch)

`agent-loop-tool-dispatch.js` 封装工具注册与派发，统一工具调用返回结构（`ToolResult`）并通过 `ToolRegistry` 完成查找/执行。
