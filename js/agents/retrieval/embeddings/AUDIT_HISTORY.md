# Audit History - embeddings

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] Custom error class
*Archived: 2026-01-19T23:43:55.905Z*

- **File**: js/agents/retrieval/embeddings/hnsw-lite.js:329
- **Description**: HnswLiteIndex 在维度不一致（及 fromJSON 校验）时抛出通用 Error，不符合“使用自定义 Error 类”的约定。
- **Suggestion**: 定义 HnswLiteIndexError/InvalidIndexError 等自定义错误类型并统一抛出。
```
if (this._dim !== normalized.length) {
  throw new Error(`HnswLiteIndex dimension mismatch: expected ${this._dim}, got ${normalized.length}`);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] Error handling
*Archived: 2026-01-19T23:43:42.384Z*

- **File**: js/agents/retrieval/embeddings/embedding-service.js:275
- **Description**: 请求/解析错误被吞掉，仅标记失败并返回 null，违背“异常需记录或重新抛出”的约定，定位问题困难。
- **Suggestion**: 记录日志或抛出自定义错误类型；至少将错误信息暴露给调用方以便追踪。
```
let json = null;
try {
  json = await res.json();
} catch {
  this._markFailure();
  return null;
}
```

---

## Archived: 2026-01-19

### [RESOLVED] Custom error class
*Archived: 2026-01-19T23:43:21.564Z*

- **File**: js/agents/retrieval/embeddings/vector-index.js:138
- **Description**: VectorIndex 维度不一致时抛出通用 Error，未使用自定义错误类，难以区分错误类型。
- **Suggestion**: 引入如 VectorIndexError/DimensionMismatchError 的自定义错误，并在 JSDoc 中补充 @throws。
```
if (this._dim !== normalized.length) {
  throw new Error(`VectorIndex dimension mismatch: expected ${this._dim}, got ${normalized.length}`);
}
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF
*Archived: 2026-01-19T23:43:17.531Z*

- **File**: js/agents/retrieval/embeddings/embedding-service.js:262
- **Description**: EmbeddingService 直接使用配置中的 endpoint 发起请求，未限制协议/域名；若该配置可被用户输入或插件数据控制，可能导致 SSRF 访问内网或本地服务。
- **Suggestion**: 在配置层对 endpoint 做 allowlist 校验（仅 https，禁止 localhost/内网 IP），或在调用前进行协议与主机名校验。
```
const res = await this._fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
  ...(mergedSignal ? { signal: mergedSignal } : {}),
});
```

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

