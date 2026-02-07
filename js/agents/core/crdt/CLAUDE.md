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

- Lamport Clock 保证因果序（op 携带 clock；合并时使用 `syncClock`）
- 操作幂等，可安全重放
- 支持离线操作 + 在线合并
- 与四总线原生集成
- 可选限制 op log 大小（`maxOpLogSize`）避免内存无限增长

## 与 Lamport Clock 的关系

- `lamport-clock.js` 的 `nextTick()` 用于为本地操作生成递增时钟，并可用于默认推导 `nodeId`
- 接收远端 op 时，`CRDTDocument` 通过 `syncClock(remoteClock)` 合并对端时钟，避免因果倒退（实现见 `document.js`）
- 多副本同步场景强烈建议显式传入稳定的 `nodeId`（避免默认推导导致的碰撞/漂移）

## 配置项（CRDTDocument）

`CRDTDocumentOptions`（见 `document.js`）：

- `docId?: string` - 文档 ID；多副本同步时必须一致
- `nodeId?: string` - 当前副本节点 ID；建议显式传入稳定值（避免默认推导带来的碰撞/漂移）
- `maxOpLogSize?: number` - 操作日志上限（限制内存占用；超过上限时实现应裁剪旧记录/配合快照，以 `document.js` 实现为准）

## 操作格式（Op）

所有可同步的变更都以「op」表示，并要求：

- 可序列化（JSON safe）
- 幂等重放（同一 op 重放不会破坏状态）
- 尽量携带 `clock`（Lamport）用于因果排序与去重

### Counter ops（counters.js）

- `GCounterIncrementOp`: `{ type: 'increment', nodeId, value, clock }`
- `PNCounterOp`: `{ type: 'pn-increment' | 'pn-decrement', op: GCounterIncrementOp }`

### Document op envelope（document.js）

`CRDTDocumentOp` 是跨 primitive 的统一封装，固定字段：

- `field`: 字段名（文档内的命名空间）
- `fieldType`: `'register' | 'map' | 'set' | 'counter'`
- `version`: 文档版本（单调递增）
- `docId`: 文档 ID
- `clock?`: 文档级时钟
- `op?`: 子 CRDT 的具体操作（可包含 `op.clock`）

说明：由于不同 primitive 的 op 结构不同，`CRDTDocumentOp` 在类型上保持宽松；实现侧必须对 `field/fieldType/op` 做运行时校验。

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
| `ORSet` | `or-set.js` | Observed-Remove 集合，TODO 列表/并发增删 |
| `CRDTDocument` | `document.js` | 复合文档，维护 op log/快照/序列化 |
| `CRDTDocumentOp` | `document.js` | 文档级 op 元数据（field/fieldType/version/docId/clock），同步传输单位 |
| `CRDTDocumentSnapshot` | `document.js` | UI/存储快照（registers/maps/sets/counters 的可读视图） |

## 入口文件（index.js）

`index.js` 作为 public API 入口，按需导出核心类型（LWWRegister/LWWMap/ORSet/GCounter/PNCounter/CRDTDocument 等）。上层优先从入口导入，避免依赖内部文件结构。

## 安全注意

- 字段名/键名/元素值在多副本同步时可能来自外部输入；实现中避免使用普通对象直接 `obj[userKey] = ...` 写入
- 推荐内部使用 `Map`/`Set` 存储；对外导出 JSON/快照时使用 `Object.create(null)` 或显式过滤 `__proto__`/`constructor`/`prototype`
- 解析外部 JSON（如 `fromJSON`/`applyRemoteOp`）时必须做结构校验，遇到未知 `type`/`fieldType` 应拒绝（抛错或返回失败），避免静默分叉

## 测试建议

- 幂等：同一 op 重放 N 次结果不变
- 收敛：不同顺序合并同一批 op 得到相同最终状态
- 并发：多个 nodeId 同时更新同一 field 的冲突处理
- 裁剪：达到 `maxOpLogSize` 后仍能正确同步（必要时依赖快照/压缩）
