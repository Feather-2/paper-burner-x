# memory - 记忆系统

Agent 记忆存储、状态引擎和检索。

## 核心文件

| 文件 | 职责 |
|------|------|
| `memory-store.js` | MemoryStore - 记忆存储 |
| `state-engine.js` | StateEngine - 状态管理引擎 |
| `retrieval-engine.js` | RetrievalEngine - 记忆检索 |

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
