# memory - 记忆系统

Agent 记忆存储、状态引擎和检索。

## 核心文件

| 文件 | 职责 |
|------|------|
| `memory-store.js` | MemoryStore - 记忆存储 (兼容入口) |
| `memory-store.impl.js` | MemoryStore 实现 (分层存储/压缩/快照) |
| `unified-memory-store.js` | UnifiedMemoryStore - StateEngine SSOT + MemoryStore 风格 API |
| `state-engine.js` | StateEngine - 状态管理引擎 |
| `retrieval-engine.js` | RetrievalEngine - 记忆检索 |
| `l3-storage.js` | L3Storage - 冷存储 (LRU 淘汰 + 去重) |
| `action-types.js` | Action Types + Action Creators |
| `state-diff.js` | 状态 diff/patch 工具 |
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
