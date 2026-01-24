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

### 数据流

```
runWithAgentLifecycleHooks()
    ↓
[Pre Hook] createPreAgentHook()
    ↓
preResult.skip?
  ├─ yes → emit `${stageName}.agent.skipped` → return preResult.value / { ok: false, error: reason }
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

- skip 事件：`${stageName}.agent.skipped`
- payload：`{ runId, reason, duration }`（并携带 `actor` / `status: "skipped"`）

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

- `_userInputs`: `Deque<{ payload, ts }>`
- `_userInputEvent`: 默认 `"user.input"`
- `_maxUserInputs`: `getLimit("MAX_USER_INPUTS", maxUserInputs)`

### EventBus 集成

`EventBusLike` 预期能力：
- `subscribe(eventName, handler, { signal? }) -> unsubscribe()`
- `emit(eventName, payload)`（可选）

注意在 loop dispose / 重新绑定监听时正确调用 `unsubscribe()`，避免监听器与相关资源泄漏。

## 工具调度 (Tool Dispatch)

`agent-loop-tool-dispatch.js` 基于 `ToolRegistry` 进行工具查找与执行，并统一返回 `ToolResult`：

```js
{ ok: boolean, data?: any, error?: any, ... }
```

## 持久化输出 (Persisted Output)

防止工具返回的大输出撑爆 token 窗口。

### 数据流

```
Tool.execute()
    ↓
[After Hook] createPersistedOutputHook()
    ↓
result.data > 400KB? → wrapPersistedOutput() → <persisted-output>预览</persisted-output>
    ↓
MessageManager.addMessage()
    ↓
压缩触发时 → cleanOldOutputs(3) → 保留最近 3 个大输出
```

### 使用方式

```javascript
import {
  ToolRegistry,
  createPersistedOutputHook,
  MessageManager,
} from 'js/agents/runtime';

// 方式 1: ToolRegistry after hook (推荐)
const registry = new ToolRegistry({ tools });
registry.useHook('after', createPersistedOutputHook());

// 方式 2: ToolExecutor hooks
const executor = new ToolExecutor({
  tools,
  hooks: { after: [createPersistedOutputHook()] },
});

// 方式 3: MessageManager 手动包装
const mm = new MessageManager();
const wrapped = mm.wrapToolOutput(largeContent);
mm.cleanOldOutputs(3);  // 清理旧大输出
mm.dispose();           // 不再使用时清理定时器/压缩任务
```

### 常量

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `OUTPUT_THRESHOLD` | 400000 | 触发包装的字节阈值 |
| `PREVIEW_SIZE` | 2000 | 预览字符数 |
| `KEEP_RECENT_OUTPUTS` | 3 | 保留的大输出数量 |

## 运行时适配

| 文件 | 职责 |
|------|------|
| `runtime-adapter.js` | RuntimeAdapter 基类 |
| `js-adapter.js` | JSRuntimeAdapter |
| `python-adapter.js` | PythonRuntimeAdapter |
| `scheduler.js` | RuntimeScheduler |
| `worker-pool.js` | Worker 池 |
... (39 more lines)
