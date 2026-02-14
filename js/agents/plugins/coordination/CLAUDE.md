# coordination - 跨环境协调

在浏览器 Tab 或 Node.js cluster 间同步 session 访问/驱逐事件，用于缓存/LRU 一致性。

该模块是 **best-effort 协调器**：保证最终一致性倾向，不保证全局严格顺序与互斥锁语义。

## 核心文件

| 文件 | 职责 |
|------|------|
| `tab-coordinator.js` | `TabCoordinator` - `BroadcastChannel` 跨 Tab 协调 + 心跳/选主 |
| `process-coordinator.js` | `ProcessCoordinator` - `cluster IPC` 跨进程协调（Node-only） |

## 语义边界（重要）

- 不是分布式锁：不提供 `acquireLock()` / `releaseLock()` / semaphore 语义。
- 选主为 best-effort：在定时器抖动、后台限频、消息延迟下可能短暂脑裂。
- 消费方必须幂等：`onAccess` / `onEviction` 回调应可重复执行且无副作用放大。

## TabCoordinator (Browser)

使用 `BroadcastChannel` 同步 `session-accessed` / `session-evicted`，并通过 `heartbeat` + `leader-election` 维持活跃 Tab 视图与 leader 状态。

```javascript
import { TabCoordinator } from 'js/agents/runtime';

const coordinator = new TabCoordinator({
  channelName: 'agent-sessions-prod',
  heartbeatMs: 5000,
  onEviction: (sessionId) => evictLocal(sessionId),
  onAccess: (sessionId) => touchLocal(sessionId),
  logger: console
});

await coordinator.init();

coordinator.broadcastAccess('session_123');
coordinator.broadcastEviction('session_123');

if (coordinator.isLeader) {
  runLeaderOnlyTask();
}

console.log(coordinator.activeTabCount);
coordinator.dispose();
```

> 并发提示：`_checkLeader()` 与 `_handleHeartbeat()` 可能交错执行；leader 侧任务应做幂等和重入保护。

## ProcessCoordinator (Node)

通过 `cluster IPC` 同步 worker 间的 session 访问/驱逐事件，消息链路为 `worker -> primary -> workers`。

`process-coordinator.js` 依赖 Node.js-only API（`globalThis.process`、`node:cluster`），不要打进浏览器 bundle。

```javascript
import { ProcessCoordinator, isClusterSupported } from 'js/agents/runtime';

if (isClusterSupported()) {
  const coordinator = new ProcessCoordinator({
    onEviction: (sessionId) => evictLocal(sessionId),
    onAccess: (sessionId) => touchLocal(sessionId),
    logger: console
  });

  await coordinator.init();
  coordinator.broadcastAccess('session_123');
  coordinator.broadcastEviction('session_123');
  coordinator.dispose();
}
```

当 cluster 不可用时，`ProcessCoordinator` 会降级为 no-op（不抛异常，保持接口兼容）。

## 消息类型

| 协调器 | 类型 |
|--------|------|
| `TabCoordinator` | `session-evicted` / `session-accessed` / `leader-election` / `heartbeat` |
| `ProcessCoordinator` | `session-evicted` / `session-accessed` |

## 消息结构（概要）

- `TabCoordinator`: `{ type, tabId, ts, sessionId? }`
- `ProcessCoordinator`: `{ type, sessionId, source }`

## 输入校验与安全

- 仅处理白名单消息类型（`MESSAGE_TYPES`）。
- 对外部消息执行结构校验（plain object、非空字符串字段、数值时间戳/来源）。
- JSON 解析路径使用 `protoSafeReviver`，降低原型污染风险。
- 无效消息忽略并可通过 `logger.warn` 记录。

## 兼容性建议

- 浏览器端仅在支持 `BroadcastChannel` 时启用 Tab 协调。
- Node 端通过 `isClusterSupported()` 进行 feature detection。
- 在多端构建中使用 conditional imports / build aliases 隔离 Node-only 模块。

## 生命周期

- `init()`：注册监听并启动协调。
- `broadcastAccess(sessionId)` / `broadcastEviction(sessionId)`：广播事件。
- `dispose()`：移除监听、停止心跳、释放资源。
