# memory - 记忆系统

Agent 记忆存储、状态引擎和检索。

## 核心文件

| 文件 | 职责 |
|------|------|
| `index.js` | 模块导出 (MemoryStore / UnifiedMemoryStore / StateEngine / RetrievalEngine / action-types) |
| `memory-store.impl.js` | MemoryStore 兼容入口 (re-export) |
| `memory-store.impl.core.js` | MemoryStore 主类，组合 L0/L1/L2/L3 分层实现 |
| `memory-store.impl.l0.js` | L0 层：systemPrompt/taskGoal/todos |
| `memory-store.impl.l1.js` | L1 层：messages/signals/decisions/scratchpad/flags |
| `memory-store.impl.l2.js` | L2 层：historySummary/stageSummaries/claims |
| `memory-store.impl.l3.js` | L3 层：archive/index/checkpoint + RetrievalEngine/L3Storage 桥接 |
| `memory-store.impl.utils.js` | token/ID/字节估算工具 |
| `unified-memory-store.js` | UnifiedMemoryStore 入口 (StateEngine SSOT) |
| `unified-memory-store.query.js` | UnifiedMemoryStore 查询/汇总方法 |
| `unified-memory-store.write.js` | UnifiedMemoryStore 写入/更新方法 |
| `unified-memory-store.index.js` | RetrievalEngine 兼容 recall/semantic/hybrid |
| `unified-memory-store.lifecycle.js` | L3 持久化/压缩/统计生命周期 |
| `unified-memory-store.utils.js` | 共享工具（ID/token/数值校验） |
| `state-engine.js` | StateEngine 核心 (dispatch/queue/clock) |
| `state-engine.reducers.js` | Reducers + createInitialState |
| `state-engine.events.js` | Listener/EventBus 通知 |
| `state-engine.persistence.js` | snapshot/checkpoint 逻辑 |
| `state-engine.utils.js` | StateEngine 工具 (ID 等) |
| `retrieval-engine.js` | RetrievalEngine - 记忆检索 |
| `l3-storage.js` | L3Storage - 冷存储 (LRU 淘汰 + 去重 + VFS 持久化) |
| `l3-storage/` | L3 辅助模块 (见 `l3-storage/CLAUDE.md`) |
| `state-diff.js` | 状态 diff/patch 工具 |
| `action-types.js` | Action Types + Action Creators |
| `todo-normalize.js` | Todo 规范化 |

## MemoryStore

```javascript
import { MemoryStore } from 'js/agents/runtime/memory';

const store = new MemoryStore({ vfs, eventBus });

store.setTaskGoal('Ship v1');
store.addMessage({ role: 'user', content: 'Hello' });

// 归档
await store.archive('stage1', { summary: '...' }, ['keyword1']);

// 查看最近归档
const archives = store.listArchives(5);
```

## UnifiedMemoryStore

基于 StateEngine 的统一记忆存储，保留 MemoryStore 风格 API：

```javascript
import { UnifiedMemoryStore } from 'js/agents/runtime/memory';

const store = new UnifiedMemoryStore({ vfs, eventBus });

store.setTaskGoal('Ship v1');
store.addMessage({ role: 'user', content: 'Hello' });

// 归档
await store.archive('stage1', { summary: '...' }, ['keyword1']);
```

## StateEngine

```javascript
import { StateEngine, createInitialState, addMessage, setFlag } from 'js/agents/runtime/memory';

const engine = new StateEngine({
  initialState: createInitialState({ runId: 'session_123' }),
});

engine.subscribe((action, prevState, nextState) => {
  // 监听所有状态变更
});

await engine.dispatch(addMessage({ role: 'user', content: 'Hi' }));
await engine.dispatch(setFlag('awaitUserFeedback', true));
```

## Action Types

```javascript
import { StateEngine, createInitialState, createAction, L1_ADD_MESSAGE, batch } from 'js/agents/runtime/memory';

const engine = new StateEngine({ initialState: createInitialState() });

const action = createAction(L1_ADD_MESSAGE, {
  message: { role: 'user', content: 'Hello' },
});

await engine.dispatch(action);

// 或使用 BATCH Action 聚合
await engine.dispatch(batch([
  createAction(L1_ADD_MESSAGE, { message: { role: 'assistant', content: '...' } }),
]));
```

## RetrievalEngine

```javascript
import { RetrievalEngine } from 'js/agents/runtime/memory';

const retrieval = new RetrievalEngine({
  memoryStore,
  embeddingService,
});

const relevant = await retrieval.recall('previous discussion about auth');
```

## L3Storage

冷存储层，支持 LRU 淘汰和内容去重：

```javascript
import { L3Storage } from 'js/agents/runtime/memory';

const storage = new L3Storage({
  vfs,
  runId: 'session_123',
  maxSnapshots: 1000,        // LRU 淘汰阈值 (默认 1000)
  maxStorageBytes: 100 * 1024 * 1024,  // 100MB
  deduplicateByDefault: true, // 内容去重 (默认开启)
  eventBus,                   // 可选，用于 l3:evicted 事件
});

// 归档 (自动去重)
const id = await storage.archive('stage1', { summary: '...' }, ['keyword1']);

// 检查去重
const { duplicate, existingId } = storage.isDuplicate(data);

// 获取存储统计
const stats = storage.getStorageStats();
// { snapshotCount, estimatedBytes, maxSnapshots, maxStorageBytes }
```

## RetrievalEngine 预热

预索引归档以加速检索：

```javascript
const engine = new RetrievalEngine({ memoryStore, embeddingService });

// 预热 (分批索引)
const result = await engine.prewarm({
  batchSize: 10,
  progressCallback: (indexed, total) => console.log(`${indexed}/${total}`),
});
// { indexed: 50, skipped: 5, elapsed: 1234 }

// 检查预热状态
engine.isWarmed;              // boolean
engine.getWarmupProgress();   // { indexed, total, coverage }
```
