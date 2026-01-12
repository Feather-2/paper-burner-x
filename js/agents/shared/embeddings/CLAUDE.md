# embeddings - 向量嵌入

嵌入服务和向量索引。

## 核心文件

| 文件 | 职责 |
|------|------|
| `embedding-service.js` | EmbeddingService - 嵌入生成 |
| `vector-index.js` | VectorIndex - 向量存储 |
| `hnsw-lite.js` | HnswLiteIndex - HNSW 近似最近邻 |

## EmbeddingService

```javascript
import { EmbeddingService, createEmbeddingService } from 'js/agents/shared/embeddings';

const service = await createEmbeddingService({
  provider: 'openai',
  model: 'text-embedding-3-small',
});

const embedding = await service.embed('Hello world');
// → Float32Array(1536)

const embeddings = await service.embedBatch(['Hello', 'World']);
```

## VectorIndex

```javascript
import { VectorIndex } from 'js/agents/shared/embeddings';

const index = new VectorIndex({ dimensions: 1536 });
index.add('doc-1', embedding1);
index.add('doc-2', embedding2);

const results = index.search(queryEmbedding, { topK: 5 });
// → [{ id: 'doc-1', score: 0.95 }, ...]
```

## HnswLiteIndex

高效近似最近邻：

```javascript
import { HnswLiteIndex } from 'js/agents/shared/embeddings';

const hnsw = new HnswLiteIndex({
  dimensions: 1536,
  m: 16,
  efConstruction: 200,
});

hnsw.add('doc-1', embedding1);
const neighbors = hnsw.search(query, 10);
```
