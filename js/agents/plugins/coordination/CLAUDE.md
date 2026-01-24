# coordination - 跨环境协调

在浏览器 Tab 或 Node.js cluster 间同步 session 的访问/驱逐事件，用于缓存/LRU 一致性。

## 核心文件

| 文件 | 职责 |
|------|------|
| `tab-coordinator.js` | TabCoordinator - BroadcastChannel 跨 Tab 协调 + 心跳/选主 |
| `process-coordinator.js` | ProcessCoordinator - cluster IPC 跨进程协调（Node-only） |

## TabCoordinator (Browser)

BroadcastChannel 同步消息，心跳检测活跃 Tab 并选出 leader。

```javascript
import { TabCoordinator } from 'js/agents/runtime';

const coordinator = new TabCoordinator({
  // 建议在同一 origin 下为不同应用/环境设置唯一的 channelName，避免冲突
  channelName: 'agent-sessions',
  heartbeatMs: 5000,
  onEviction: (sessionId) => evictLocal(sessionId),
  onAccess: (sessionId) => touchLocal(sessionId),
  logger: console,
});

await coordinator.init();

coordinator.broadcastAccess('session_123');
coordinator.broadcastEviction('session_123');

if (coordinator.isLeader) {
  console.log('leader tab');
}
console.log(coordinator.activeTabCount);

coordinator.dispose();
```

## ProcessCoordinator (Node)

使用 cluster IPC 协调进程：worker → primary → 广播给所有 worker。

注意：`process-coordinator.js` 依赖 Node.js-only API（`globalThis.process`、`node:cluster`）。
不要打进浏览器 bundle；在 Node 入口文件中使用，或通过 conditional imports / build aliases 隔离。

```javascript
// Node-only entry file (do not bundle for browser)
import { ProcessCoordinator, isClusterSupported } from 'js/agents/runtime';

if (isClusterSupported()) {
  const coordinator = new ProcessCoordinator({
    onEviction: (sessionId) => evictLocal(sessionId),
    onAccess: (sessionId) => touchLocal(sessionId),
    logger: console,
  });

  await coordinator.init();

  coordinator.broadcastAccess('session_123');
  coordinator.broadcastEviction('session_123');

  coordinator.dispose();
}
```

## 消息类型

| 协调器 | 类型 |
|--------|------|
| TabCoordinator | `session-evicted` / `session-accessed` / `leader-election` / `heartbeat` |
| ProcessCoordinator | `session-evicted` / `session-accessed` |

## 消息结构（概要）

- TabCoordinator: `{ type, tabId, ts, sessionId? }`
- ProcessCoordinator: `{ type, sessionId, source }`（source 用于标识消息来源，避免自回环）

## 注意事项

- BroadcastChannel 不可用时 TabCoordinator 自动降级为 no-op。
- BroadcastChannel 消息是同源内“广播”且不带鉴权；在同一 origin 多应用场景建议自定义 `channelName` 做隔离。
- ProcessCoordinator 仅在 Node + cluster 环境生效；可先调用 `isClusterSupported()`。
- 浏览器构建时避免静态引入 `process-coordinator.js`；确保通过 Node-only 入口、conditional imports 或构建别名隔离。
