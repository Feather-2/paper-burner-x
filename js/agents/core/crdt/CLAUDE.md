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
- 可选限制 op log 大小（`maxOpLogSize`）避免内存无限增长

## 配置项（CRDTDocument）

`CRDTDocumentOptions`（见 `document.js`）：

- `docId?: string` - 文档 ID；多副本同步时必须一致
- `nodeId?: string` - 当前副本节点 ID；建议显式传入稳定值（避免默认推导带来的碰撞/漂移）
- `maxOpLogSize?: number` - 操作日志上限（限制内存占用；超过上限时实现应裁剪旧记录/配合快照，以 `document.js` 实现为准）

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
| `GCounter` | `counters.js` | 只增计数器（每节点独立计数，合并求和） |
| `PNCounter` | `counters.js` | 正负计数器（positive - negative） |
| `LWWMap` | `lww-map.js` | LWW 键值对，状态管理 |
| `ORSet` | `or-set.js` | Observed-Remove 集合，TODO 列表 |
| `CRDTDocument` | `document.js` | 复合文档，维护 op log/快照/序列化 |
| `CRDTDocumentOp` | `document.js` | 文档级 op 元数据（field/fieldType/version/docId/clock），同步传输单位 |
| `CRDTDocumentSnapshot` | `document.js` | 文档快照（register/map/set/counter 的可读值结构） |
| `CRDTSyncManager` | `sync-manager.js` | 同步管理器，广播/同步文档 op |
| `createMemoryTransport` | `sync-manager.js` | 内存传输层（测试/演示） |
| `OpType` / `createOp` | `index.js` | 低层 op 构造器（兼容旧接口） |

## 操作结构（关键字段）

- 字段类型 `CRDTFieldType`：`'register' | 'map' | 'set' | 'counter'`
- 文档级 op（`CRDTDocumentOp`）固定包含：
  - `docId`：文档 ID
  - `field`：字段名
  - `fieldType`：字段类型
  - `version`：文档版本（单调递增）
  - 可选 `clock`：LamportClockState（用于因果/排序/幂等辅助）
  - 可选 `op`：子 op payload（不同 CRDT primitive 的具体字段，例如 map 的 `key`、set 的 `element`、counter 的 `op` 等）

计数器 op 形状（见 `counters.js`）：

```js
// GCounterIncrementOp
{ type: 'increment', nodeId, value, clock }

// PNCounterOp
{ type: 'pn-increment', op: { type: 'increment', nodeId, value, clock } }
{ type: 'pn-decrement', op: { type: 'increment', nodeId, value, clock } }
```

快照形状（`CRDTDocumentSnapshot`）：

- `registers/maps/sets/counters` 是面向 UI/存储的可读结构；其中 `counters` 存储聚合后的数值。

## 同步模型

- `CRDTDocument` 负责聚合多个 CRDT 字段（register/map/set/counter），写入时记录 op log 和版本；产生的同步单位为 `CRDTDocumentOp`（必须带 `field` 和 `fieldType`，并包含 `docId/version` 等元数据）。
- `CRDTSyncManager` 只同步 **CRDTDocument 产生的 op**，不会自动监听文档变更；业务层需要在写入后调用 `broadcastOp`。
- `createMemoryTransport` 是内存 hub，通过 `register(nodeId)` 生成每个节点的 transport。
