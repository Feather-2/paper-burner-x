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

## 与三总线集成

```javascript
import { Kernel } from 'js/agents/core';
import { LWWMap } from 'js/agents/core/crdt';

const kernel = await quickKernel('standard');
const sharedState = new LWWMap('orchestrator');

// CRDT 变更 → EventBus
sharedState.on('change', (op) => {
  kernel.events.emit('crdt:change', op);
});

// StateBus 订阅 CRDT 快照
kernel.state.set('agents.shared', sharedState.snapshot());
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

**触发条件**：当产品需求明确包含"多人协同编辑论文正文"时引入。
