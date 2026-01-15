# memory - 记忆系统

Agent 记忆存储、状态引擎和检索。

## 核心文件

| 文件 | 职责 |
|------|------|
| `memory-store.js` | MemoryStore - 记忆存储 |
| `state-engine.js` | StateEngine - 状态管理引擎 |
| `retrieval-engine.js` | RetrievalEngine - 记忆检索 |
| `l3-storage.js` | L3Storage - 冷存储 (LRU 淘汰 + 去重) |

## MemoryStore

```javascript
import { MemoryStore } from 'js/agents/runtime/memory';

const store = new MemoryStore({ vfs });

// 存储记忆
await store.save({
  type: 'conversation',
  content: 'User asked about...',
  embedding: [...],
  metadata: { timestamp: Date.now() },
});

// 检索
const memories = await store.search(queryEmbedding, { topK: 5 });
```

## StateEngine

```javascript
import { StateEngine } from 'js/agents/runtime/memory';

const engine = new StateEngine();

engine.set('task.status', 'running');
engine.set('task.progress', 0.5);

engine.subscribe('task.*', (path, value) => {
  console.log(`${path} changed to ${value}`);
});
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
