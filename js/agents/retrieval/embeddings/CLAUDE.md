# embeddings - 向量嵌入

嵌入服务与向量索引（浏览器优先，Node.js 兼容）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `embedding-service.js` | EmbeddingService - 嵌入生成（含 endpoint 校验/SSRF 防护） |
| `vector-index.js` | VectorIndex - 向量存储与检索 |
| `hnsw-lite.js` | HnswLiteIndex - 近似最近邻（分层图 + LSH） |

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

### 安全与网络限制

- `endpoint` 会做基础的 URL/参数校验。
- 内部会识别并拒绝明显的本机/内网目标（如 `localhost`、`.localhost`、`.local`、`127.0.0.1`、`10.x.x.x`、`192.168.x.x`、`172.16-31.x.x`、`::1`、`fc00::/7`、`fe80::/10` 及 IPv4-mapped IPv6 等），用于降低 SSRF 风险。
- 若你的场景需要访问本地/内网 embeddings 服务，请在上层做显式 allowlist 与风险隔离。

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

备注：维度不一致时会抛出 `DimensionMismatchError`（建议调用方捕获并给出可读错误）。

## HnswLiteIndex

高效近似最近邻（LSH + 分桶 + 分层图导航），并支持与 `VectorIndex` 一致的分区策略（`meta.ts` → `hot/warm/cold`）。

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

const neighbors = hnsw.search(queryEmbedding, {
  topK: 10,
  efSearch: 16,
  partitions: ['hot', 'warm'],
});

const snapshot = hnsw.toJSON();
const restored = HnswLiteIndex.fromJSON(snapshot);
```

### 错误类型

- `HnswLiteIndexError`: HnswLiteIndex 的基础错误类型
- `DimensionMismatchError`: 向量维度不一致
- `InvalidIndexError`: 索引快照/数据不合法
