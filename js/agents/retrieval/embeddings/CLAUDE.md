# embeddings - 向量嵌入

嵌入服务与向量索引（浏览器优先，Node.js 兼容）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `embedding-service.js` | EmbeddingService - 嵌入生成（含 endpoint 校验/SSRF 防护） |
| `vector-index.js` | VectorIndex - 向量存储与检索（含维度校验/错误类型） |
| `hnsw-lite.js` | HnswLiteIndex - 近似最近邻（分层图 + LSH），并导出索引错误类型 |

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
- 内部会识别并拒绝明显的本机/内网目标（降低 SSRF 风险），例如：
  - 主机名：`localhost`、`.localhost`、`.local`
  - IPv4：`0.x.x.x`、`127.x.x.x`、`10.x.x.x`、`169.254.x.x`、`192.168.x.x`、`172.16-31.x.x`
  - IPv6：`::1`、`::`、`fe80:`（link-local 前缀）、`fc00::/7`（ULA，含 `fc*`/`fd*`）、以及 IPv4-mapped IPv6（如 `::ffff:192.168.0.1`）
- 该策略是“明显内网/本机目标”拦截，并不能覆盖所有形式的网络风险（例如 DNS rebinding）；生产场景建议在上层做显式 allowlist 与风险隔离。

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

备注：维度不一致时会抛出 `vector-index.js` 导出的 `DimensionMismatchError`（建议调用方捕获并给出可读错误）。

## HnswLiteIndex

高效近似最近邻（LSH + 分层图导航），并支持与 `VectorIndex` 一致的分区策略（`meta.ts` → `hot/warm/cold`）。

```javascript
import { HnswLiteIndex } from 'js/agents/shared/embeddings';

const hnsw = new HnswLiteIndex({
  maxItems: 5000,
  numHashBits: 8,
  numProbes: 8,
  seed: 42,
});
```

### 错误类型

- `hnsw-lite.js`：`HnswLiteIndexError`（基类）、`DimensionMismatchError`、`InvalidIndexError`
- `vector-index.js`：`DimensionMismatchError`

提示：如果公共入口同时 re-export 两个同名 `DimensionMismatchError`，建议在入口处使用别名导出或在文档/API 中明确区分来源模块。