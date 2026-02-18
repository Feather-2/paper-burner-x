# crdt - CRDT 共识层

基于 Operation-based CRDT 的分布式数据结构，支持多 Agent 协作。

## 架构定位

```text
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

Agent 状态以结构化键值/计数器/集合为主，LWW + Counter + OR-Set 语义足够；Yjs 的光标/选区/undo 栈对 Agent 场景通常冗余。

## 设计原则

- Lamport Clock 保证因果序（op 携带 clock；合并时使用 `syncClock`）
- 操作幂等，可安全重放
- 支持离线操作 + 在线合并
- 与四总线原生集成
- 可选限制 op log 大小（`maxOpLogSize`）避免内存无限增长
- 时钟服务可注入（`clockService`）以提升可测试性与可控性

## 与 Lamport Clock 的关系

- `lamport-clock.js` 的 `nextTick()` 用于本地操作生成递增时钟
- 接收远端 op 时，`CRDTDocument` 通过 `syncClock(remoteClock)` 合并对端时钟，避免因果倒退
- `GCounter/PNCounter` 支持注入 `clockService.nextTick()`，便于测试与时钟统一
- 多副本同步强烈建议显式传入稳定 `nodeId`，避免默认推导导致碰撞/漂移

## 配置项

### `CRDTDocumentOptions`（`document.js`）

- `docId?: string` - 文档 ID；多副本同步时必须一致
- `nodeId?: string` - 当前副本节点 ID；建议显式传入稳定值
- `maxOpLogSize?: number` - 操作日志上限；超过上限应配合裁剪/快照
- `clockService?: { nextTick: () => LamportClockState }` - 可注入时钟服务（测试或统一时钟源）

### `CounterOptions`（`counters.js`）

- `nodeId?: string` - 计数器所属节点 ID
- `clockService?: { nextTick: () => LamportClockState }` - 计数器时钟提供者

### `CRDTSyncManagerOptions`（`sync-manager.js`）

- `nodeId?: string`
- `transport?: CRDTTransport`
- `events?: EventBusLike`
- `maxPendingOps?: number`
- `maxOpsPerSync?: number`
- `maxOpSize?: number`
- `topologyMode?: 'two-node' | 'multi-node-experimental'`
  - 默认 `two-node`：硬约束最多 1 个远端 peer（即 2 节点拓扑）
  - 若需 3+ 节点，请显式设置 `multi-node-experimental`（仍建议后续升级 version vector）

## 操作格式（Op）

所有可同步变更都以 op 表示，并要求：

- 可序列化（JSON safe）
- 幂等重放（同一 op 重放不会破坏状态）
- 尽量携带 `clock`（Lamport）用于因果排序与去重

### Counter ops（`counters.js`）

- `GCounterIncrementOp`: `{ type: 'increment', nodeId, value, clock }`
- `PNCounterIncrementOp`: `{ type: 'pn-increment', op: GCounterIncrementOp }`
- `PNCounterDecrementOp`: `{ type: 'pn-decrement', op: GCounterIncrementOp }`

### Document op envelope（`document.js`）

`CRDTDocumentOp` 是跨 primitive 的统一封装，固定同步元数据：

- `type: string`
- `field: string`
- `fieldType: 'register' | 'map' | 'set' | 'counter'`
- `version: number`
- `docId: string`
- `clock?: LamportClockState`
- `op?: { clock?: LamportClockState, ... }`
- `nodeId?: string`

## 序列化快照类型

- `LWWRegisterJSON<T>`
- `LWWMapJSON<V>` / `LWWMapEntry<V>`
- `ORSetJSON`
- `GCounterJSON`
- `PNCounterJSON`

上述类型用于 UI 展示、存储持久化与跨端同步；反序列化时应做字段与边界校验。

## 工程约束与建议

- 外部输入（尤其远端 op）必须先做 schema 校验再应用
- 对键名做危险字段过滤（如 `__proto__`、`constructor`、`prototype`）
- 插件注入 `clockService` 时应保证只暴露必要能力
- 为 `maxOpLogSize` 配置合理默认值并结合快照策略
- OR-Set 的 `gc()` 默认不会删除 tombstone（避免在线同步窗口“复活”）；仅在离线窗口或因果稳定证明下回收 tombstone

## 测试建议（本模块）

- 状态机转换：不同 `fieldType` 的 op 应用/回放/幂等
- 并发安全：乱序 op、重复 op、并行 merge
- 插件生命周期：异常 `clockService` 注入下的容错
- 边界条件：空 op、非法 version、超大 op log、异常 nodeId
