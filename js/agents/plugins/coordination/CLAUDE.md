# coordination - 跨环境协调

在浏览器 Tab 或 Node cluster 间同步 session 的访问/驱逐事件，用于缓存/LRU 一致性。

## 核心文件

| 文件 | 职责 |
|------|------|
| `tab-coordinator.js` | TabCoordinator - BroadcastChannel 跨 Tab 协调 + 心跳/选主 |
| `process-coordinator.js` | ProcessCoordinator - cluster IPC 跨进程协调 |

## TabCoordinator (Browser)

BroadcastChannel 同步消息，心跳检测活跃 Tab 并选出 leader。

```javascript
import { TabCoordinator } from 'js/agents/runtime';

const coordinator = new TabCoordinator({
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

```javascript
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

## 注意事项

- BroadcastChannel 不可用时 TabCoordinator 自动降级为 no-op。
- ProcessCoordinator 仅在 Node + cluster 环境生效；可先调用 `isClusterSupported()`。
- `broadcastAccess/broadcastEviction` 会忽略空 sessionId。
- 可选传入 `logger`（需实现 `warn`）用于输出内部警告。
