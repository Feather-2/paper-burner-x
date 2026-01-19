# crdt - CRDT 共识层

基于 Operation-based CRDT 的分布式数据结构，支持多 Agent 协作。

## 架构定位

```
┌─────────────────────────────────────────┐
│            应用层                        │
├──────────────────┬──────────────────────┤
│  Agent 状态       │  富文本协作 (未来)    │
│  (自研 CRDT)      │  (Yjs)              │
├──────────────────┴──────────────────────┤
│         EventBus / StateBus (桥接)       │
├─────────────────────────────────────────┤
│         MessageBus (跨 Agent 同步)       │
├─────────────────────────────────────────┤
│              VFS (持久化)                │
└─────────────────────────────────────────┘
```

**为什么自研而非直接用 Yjs？**

| 维度 | 自研 CRDT | Yjs |
|------|-----------|-----|
| 体积 | 几 KB | ~15KB |
| 语义 | LWWRegister/GCounter 直接对应 Agent 状态 | 为富文本设计 |
| 集成 | 原生融入 EventBus/StateBus | 需要桥接层 |
| 调试 | 状态透明可读 | 内部编码 |

Agent 状态是结构化的键值/计数器/集合，LWW 语义足够；Yjs 的光标/选区/undo 栈对 Agent 是冗余。

## 设计原则

- Lamport Clock 保证因果序
- 操作幂等，可安全重放
- 支持离线操作 + 在线合并
- 与三总线原生集成

## 适用场景

| 场景 | CRDT 类型 | 说明 |
|------|-----------|------|
| Agent 当前阶段/状态码 | LWWRegister | 单值，最后写入生效 |
| 共享配置/上下文 | LWWMap | 键值对状态 |
| 任务列表/已处理文档 | ORSet | 集合，支持并发添加/删除 |
| Token 计数/进度 | GCounter/PNCounter | 分布式计数 |
| 复合文档状态 | CRDTDocument | 组合多种类型 |

## 数据类型

| 类型 | 文件 | 用途 |
|------|------|------|
| `LWWRegister` | `lww-register.js` | Last-Writer-Wins 寄存器，简单值 |
| `GCounter` | `counters.js` | 只增计数器 |
| `PNCounter` | `counters.js` | 正负计数器 |
| `LWWMap` | `lww-map.js` | LWW 键值对，状态管理 |
| `ORSet` | `or-set.js` | Observed-Remove 集合，TODO 列表 |
| `CRDTDocument` | `document.js` | 复合文档，维护 op log/快照/序列化 |
| `CRDTSyncManager` | `sync-manager.js` | 同步管理器，广播/同步文档 op |
| `createMemoryTransport` | `sync-manager.js` | 内存传输层（测试/演示） |
| `OpType` / `createOp` | `index.js` | 低层 op 构造器（兼容旧接口） |

## 同步模型

- `CRDTDocument` 负责聚合多个 CRDT 字段（register/map/set/counter），写入时记录 op log 和版本。
- `CRDTSyncManager` 只同步 **CRDTDocument 产生的 op**（必须带 `field` 和 `fieldType`），不会自动监听文档变更；业务层需要在写入后调用 `broadcastOp`。
- `createMemoryTransport` 是内存 hub，通过 `register(nodeId)` 生成每个节点的 transport。

## 操作类型

### 低层 OpType（createOp）

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

> `createOp/OpType` 主要用于低层自定义封装；CRDT 原语实际使用的 op 类型如下：

- LWWRegister: `set`
- LWWMap: `map-set` / `map-delete`
- ORSet: `set-add` / `set-remove`
- GCounter: `increment`
- PNCounter: `pn-increment` / `pn-decrement`

### CRDTDocument op 包装

```javascript
{
  type: 'map-set',
  field: 'state',
  fieldType: 'map',
  key: 'status',
  value: 'running',
  clock: { seq: 3, ts: 0, id: 'nodeA_3' },
  nodeId: 'nodeA',
  version: 3,
  docId: 'doc-1'
}
```

## 使用示例

```javascript
import { CRDTDocument, CRDTSyncManager, createMemoryTransport } from 'js/agents/core/crdt';

const transportHub = createMemoryTransport();
const nodeA = new CRDTSyncManager({
  nodeId: 'nodeA',
  transport: transportHub.register('nodeA'),
});
const nodeB = new CRDTSyncManager({
  nodeId: 'nodeB',
  transport: transportHub.register('nodeB'),
});

const docA = nodeA.createDocument('doc-1');
const docB = nodeB.createDocument('doc-1');

nodeA.connect();
nodeB.connect();

// 写入本地文档
let lastVersion = 0;
docA.setMapValue('state', 'status', 'running');

// 广播本次写入产生的 op（基于版本差异）
const ops = docA.getOps(lastVersion);
for (const op of ops) {
  nodeA.broadcastOp(docA.docId, op);
}
lastVersion = docA.version;

// 远端可读取快照
const snapshot = docB.snapshot();
```

> 注意：`CRDTDocument` 的写入方法返回的是 **原始 op**，用于同步时应以 `getOps()` 取出带 `field/fieldType` 的文档级 op。

## 与三总线集成

`CRDTSyncManager` 可接入 EventBus，通过 `events.emit` 触发以下事件（事件名遵循 `domain:action`）：

- `crdt:opSent`
- `crdt:opApplied`
- `crdt:opRejected`
- `crdt:syncRejected`
- `crdt:syncPartial`
- `crdt:syncComplete`
- `crdt:peerJoin`
- `crdt:peerLeave`
- `crdt:pendingOverflow`
- `crdt:connect`
- `crdt:disconnect`

```javascript
import { CRDTSyncManager } from 'js/agents/core/crdt';

const sync = new CRDTSyncManager({
  nodeId: 'orchestrator',
  transport: messageBusTransport,
  events: kernel.events,
});

const doc = sync.createDocument('agents.shared');

// 如果 EventBus 支持订阅，可监听并桥接到 StateBus
kernel.events.on?.('crdt:opApplied', ({ docId }) => {
  if (docId === doc.docId) {
    kernel.state.set('agents.shared', doc.snapshot());
  }
});
```

## 未来规划：Yjs 集成

当需要支持 **人类 + Agent 协同编辑富文本**（如论文、报告）时，将引入 Yjs 作为可选依赖。

**分工**：
- **Agent 状态** → 继续使用自研 CRDT（轻量、原生集成）
- **富文本内容** → Yjs (Y.Text/Y.XmlFragment)

**集成方案**：

```javascript
// 未来的 YjsPlugin (约 200-300 行)
import * as Y from 'yjs';
import { createPlugin } from 'js/agents/core';

export const yjsPlugin = createPlugin({
  name: 'yjs',
  setup(ctx) {
    const yDoc = new Y.Doc();

    // 事件桥接
    yDoc.on('update', (update, origin) => {
      ctx.events.emit('crdt:yjs:update', { update, origin });
    });

    // 持久化到 VFS
    ctx.services.register('yjs', {
      doc: yDoc,
      async save(path) {
        const state = Y.encodeStateAsUpdate(yDoc);
        await ctx.vfs.write(path, state);
      },
      async load(path) {
        const state = await ctx.vfs.read(path);
        if (state) Y.applyUpdate(yDoc, state);
      },
    });
  },
});
```

**同步层选项**：
- `y-websocket` — 标准 WebSocket 同步
- `y-webrtc` — P2P 同步
- 自定义 provider (基于 MessageBus) — 复用现有基础设施

**触发条件**：当产品需求明确包含 '多人协同编辑论文正文' 时引入。