# embeddings - 向量嵌入

嵌入服务与向量索引（浏览器优先，Node.js 兼容）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `embedding-service.js` | EmbeddingService - 嵌入生成 |
| `vector-index.js` | VectorIndex - 向量存储 |
| `hnsw-lite.js` | HnswLiteIndex - 近似最近邻 |

## EmbeddingService

```javascript
import { EmbeddingService, createEmbeddingService } from 'js/agents/shared/embeddings';

const service = createEmbeddingService({
  endpoint: 'https://api.openai.com/v1/embeddings',
  model: 'text-embedding-3-small',
  apiKey: 'sk-***',
  headers: { 'OpenAI-Organization': 'org_xxx' },
  timeoutMs: 5000,
  batchSize: 32,
  flushIntervalMs: 30,
  maxQueue: 2000,
  cooldownMs: 300000,
});

const [embedding] = await service.embed('Hello world');
// → [Float32Array(1536)]

const embeddings = await service.embed(['Hello', 'World']);
```

批处理/队列（可用于合并请求）：

```javascript
const pending = service.enqueue(['A', 'B']);
await service.flush();
const vectors = await pending;
```

## VectorIndex

```javascript
import { VectorIndex } from 'js/agents/shared/embeddings';

const index = new VectorIndex({ maxItems: 1000 });
index.upsert('doc-1', embedding1, { ts: Date.now() });
index.upsert('doc-2', embedding2);

const results = index.search(queryEmbedding, {
  topK: 5,
  minScore: 0.2,
  partitions: ['hot', 'warm'],
});
// → [{ id: 'doc-1', score: 0.95, meta: { ... } }, ...]
```

## HnswLiteIndex

高效近似最近邻（LSH + 分桶）：

```javascript
import { HnswLiteIndex } from 'js/agents/shared/embeddings';

const hnsw = new HnswLiteIndex({
  maxItems: 5000,
  numHashBits: 8,
  numProbes: 8,
  seed: 42,
  rebuildThreshold: 0.3,
});

hnsw.upsert('doc-1', embedding1, { ts: Date.now() });
const neighbors = hnsw.search(queryEmbedding, { topK: 10, efSearch: 16 });

const snapshot = hnsw.toJSON();
const restored = HnswLiteIndex.fromJSON(snapshot);
```