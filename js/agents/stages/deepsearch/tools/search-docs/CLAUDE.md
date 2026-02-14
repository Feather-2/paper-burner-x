# search-docs - 文档搜索工具

在 DeepSearch 工具层中搜索已加载文档，支持关键词检索、语义检索与 MMR 重排；优先调用外部检索器，失败或超时自动降级为本地检索，并可写入 gap 证据。

## 核心文件

| 文件 | 职责 |
|------|------|
| `handler.js` | 入口：参数校验、外部检索调用、超时控制、降级、本地检索、MMR 重排、事件上报 |
| `SKILL.md` | 使用说明：能力、输入输出与适用场景 |

## 关键概念

- SourceManager：同步 `state.L0.sources`，并执行本地 `search` / `semanticSearch`。
- 输入校验：
  - `query` 必填字符串，长度 `<= 2048`。
  - `sources`（可选）为文档 ID 列表，数量 `<= 100`。
  - `limit` 范围 `1-100`。
  - `semanticTimeoutMs` 上限 `60000`（仅作用于 `semanticSearch`）。
  - `retrieverTimeoutMs` 默认 `15000`，上限 `60000`（作用于外部 `retriever.search`）。
- 超时控制：统一通过 `withTimeout` 包装异步调用；超时错误会标记 `code: 'TIMEOUT'`，便于上层识别与分流。
- 外部检索器：`retriever.search` 由熔断器包裹（registry 优先取 `context` / `stageApi`，无则使用全局），失败/熔断/超时均可降级到本地检索。
- 语义检索：
  - 优先使用 `context.embeddingService`。
  - 否则读取 `embedding` / `globalConfig.embedding` 配置并缓存到 `context._pbEmbeddingService`。
  - 支持透传 `fetchImpl`。
- MMR 重排：默认开启；`mmr: false` 关闭；`mmr` 对象支持 `{ topK, lambda, maxTokens }` 并进行对象形态校验。
- 证据写入：传入 `gapId` 时通过 `discoveryManager.addEvidence` 记录命中证据。
- 事件上报：
  - 成功触发 `emit('deepsearch:search_completed')`（本地降级会包含 `fallback: 'local'`）。
  - 失败触发 `emit('deepsearch:search_failed')`。

## 返回值（SearchDocsResult）

`handler` 返回结构化结果对象，而不是直接返回数组：

- `success: boolean`：是否成功
- `results?: SearchHit[]`：命中列表（成功时）
- `fallback?: string`：降级模式标识（如 `local`）
- `mmr?: { applied?: boolean, pool?: number }`：MMR 重排元数据
- `error?: string`：错误摘要
- `message?: string`：用户可读提示

## 常见任务

- 基本搜索：传入 `query` 与 `limit`，返回 `SearchDocsResult`（命中在 `results`）。
- 限定来源：使用 `sources` 指定文档 ID 列表，只在目标文档内检索。
- 语义检索：提供 `embedding` 配置或 `embeddingService`，启用向量相似度搜索（可用 `semanticTimeoutMs` 控制超时）。
- 控制外部检索器超时：使用 `retrieverTimeoutMs` 控制 `retriever.search` 超时与降级行为。
- 调整 MMR：`mmr: false` 关闭；或设置 `{ topK, lambda, maxTokens }` 进行重排。
- 记录缺口证据：提供 `gapId`，自动把命中片段写入 discovery 黑板。

## 使用示例

```javascript
const result = await handler(
  {
    query: '关键术语',
    limit: 8,
    sources: ['doc-1'],
    retrieverTimeoutMs: 15000,
    semanticTimeoutMs: 12000,
    mmr: { lambda: 0.7, topK: 24, maxTokens: 200 }
  },
  context
);

if (result.success) {
  for (const hit of result.results ?? []) {
    console.log(hit.sourceId ?? hit.docId ?? hit.id, hit.score, hit.snippet ?? hit.text);
  }
  if (result.fallback === 'local') {
    console.warn('retriever unavailable, fallback to local search');
  }
} else {
  console.warn(result.message ?? result.error ?? 'search failed');
}
```
