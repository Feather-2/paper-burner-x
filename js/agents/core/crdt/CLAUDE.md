# crdt - CRDT 共识层

基于 Operation-based CRDT 的分布式数据结构，支持多 Agent 协作。

## 设计原则

- Lamport Clock 保证因果序
- 操作幂等，可安全重放
- 支持离线操作 + 在线合并

## 数据类型

| 类型 | 文件 | 用途 |
|------|------|------|
| `LWWRegister` | `lww-register.js` | Last-Writer-Wins 寄存器，简单值 |
| `GCounter` | `counters.js` | 只增计数器 |
| `PNCounter` | `counters.js` | 正负计数器 |
| `LWWMap` | `lww-map.js` | LWW 键值对，状态管理 |
| `ORSet` | `or-set.js` | Observed-Remove 集合，TODO 列表 |
| `CRDTDocument` | `document.js` | 复合文档 |
| `CRDTSyncManager` | `sync-manager.js` | 同步管理器 |

## 操作类型

```javascript
const OpType = {
  SET: 'set',
  DELETE: 'delete',
  INCREMENT: 'increment',
  DECREMENT: 'decrement',
  ADD: 'add',
  REMOVE: 'remove',
};
```

## 使用示例

```javascript
import { LWWMap, CRDTSyncManager, createMemoryTransport } from 'js/agents/core/crdt';

// 创建分布式 Map
const map = new LWWMap('agent-1');
map.set('status', 'running');
map.set('progress', 0.5);

// 同步
const sync = new CRDTSyncManager({
  transport: createMemoryTransport(),
});
sync.register('state', map);
await sync.sync();
```
