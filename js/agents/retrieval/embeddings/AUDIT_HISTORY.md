# Audit History - embeddings

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] async-cancellation
*Archived: 2026-01-18T21:44:53.850Z*

- **File**: js/agents/shared/embeddings/embedding-service.js:443
- **Description**: enqueue/embed 接收 signal/timeoutMs，但 flush 组批时未传入或筛除，已取消/超时请求仍可能触发网络调用。
- **Suggestion**: 在组批阶段过滤已 abort 的请求，并合并最短 timeout/signal 传给 `_callEmbeddings`，或在 enqueue 时拒绝已取消请求。
```
const vectors = await this._callEmbeddings(batchTexts);
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:44:53.850Z*

- **File**: js/agents/shared/embeddings/embedding-service.js:137
- **Description**: normalizeEmbeddingConfig/createEmbeddingService 缺少 @param/@returns 类型注解，不符合 JSDoc 约定。
- **Suggestion**: 为两个导出函数补齐 JSDoc，注明参数类型与返回值（EmbeddingConfig|null / EmbeddingService）。
```
export function normalizeEmbeddingConfig(raw) {
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:44:53.850Z*

- **File**: js/agents/shared/embeddings/vector-index.js:71
- **Description**: VectorIndex 的公开方法（constructor/has/clear/delete/upsert）缺少 JSDoc 类型标注。
- **Suggestion**: 为公开方法补齐 @param/@returns，至少覆盖 id、vector、meta 与返回的 boolean。
```
export class VectorIndex {
```

### [RESOLVED] jsdoc-missing
*Archived: 2026-01-18T21:44:53.850Z*

- **File**: js/agents/shared/embeddings/hnsw-lite.js:254
- **Description**: HnswLiteIndex 的公开方法（has/clear/delete/upsert/getPartitionStats/getStats/toJSON/fromJSON）缺少 JSDoc 类型标注。
- **Suggestion**: 补齐公开 API 的 JSDoc @param/@returns，并标注序列化 JSON 结构。
```
has(id) {
```

---

