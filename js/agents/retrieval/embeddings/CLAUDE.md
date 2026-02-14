# embeddings - 向量嵌入

嵌入服务与向量索引（浏览器优先，Node.js 兼容）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `embedding-service.js` | `EmbeddingService` - 嵌入生成、批量队列、endpoint/hostname 校验（含 SSRF 基础防护） |
| `vector-index.js` | `VectorIndex` - 精确向量检索与分区过滤，维度校验与错误类型 |
| `hnsw-lite.js` | `HnswLiteIndex` - 近似最近邻（LSH + 分层图），并导出索引错误类型 |

## EmbeddingService

```javascript
import { EmbeddingService, createEmbeddingService } from 'js/agents/retrieval/embeddings';

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
const embeddings = await service.embed(['Hello', 'World']);
```

批处理/队列（用于合并请求）：

```javascript
const pending = service.enqueue(['A', 'B']);
await service.flush();
const vectors = await pending;
```

### endpoint 安全策略（基础防护）

- 对 `endpoint` 做 URL 与 host 合法性校验。
- 拒绝明显本机/内网目标，包含：
  - 主机名：`localhost`、`*.localhost`、`*.local`
  - IPv4：`0.0.0.0/8`、`127.0.0.0/8`、`10.0.0.0/8`、`169.254.0.0/16`、`192.168.0.0/16`、`172.16.0.0/12`
  - IPv6：`::1`、`::`、`fe80::/10`、`fc00::/7`（含 `fd*`）
  - IPv4-mapped IPv6（含 `::ffff:a.b.c.d` 与 `ffff:xxxx:xxxx` 结尾形式）
- 该策略用于降低 SSRF 风险，不等价于完整网络隔离；生产场景建议叠加 endpoint allowlist 与服务端出口控制。

## VectorIndex

```javascript
import { VectorIndex } from 'js/agents/retrieval/embeddings';

const index = new VectorIndex({ maxItems: 1000 });
index.upsert('doc-1', embedding1, { ts: Date.now() });
index.upsert('doc-2', embedding2);

const results = index.search(queryEmbedding, {
  topK: 5,
  minScore: 0.2,
  partitions: ['hot', 'warm'],
});
```

备注：维度不一致会抛出 `DimensionMismatchError`，建议调用方捕获并输出可读错误。

## HnswLiteIndex

面向小规模向量集合（<10000）的近似检索实现：

- LSH 快速缩小候选集
- 分层图导航提升查询速度
- 候选集上执行精确余弦相似度

分区策略与 `VectorIndex` 保持一致：`meta.ts` 映射为 `hot/warm/cold`。

```javascript
import { HnswLiteIndex } from 'js/agents/retrieval/embeddings';

const ann = new HnswLiteIndex({ maxItems: 10000 });
ann.upsert('doc-1', embedding1, { ts: Date.now() });

const hits = ann.search(queryEmbedding, {
  topK: 5,
  partitions: ['hot', 'warm'],
});
```

导出错误类型：

- `HnswLiteIndexError`
- `DimensionMismatchError`
- `InvalidIndexError`
