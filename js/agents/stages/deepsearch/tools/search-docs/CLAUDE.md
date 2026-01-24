# search-docs - 文档搜索工具

在 DeepSearch 工具层中搜索已加载的文档，支持关键词/语义检索与 MMR 重排；优先使用外部检索器，失败或超时时降级为本地检索，并可写入 gap 证据。

## 核心文件

| 文件 | 职责 |
|------|------|
| `handler.js` | 入口：参数校验、执行检索、MMR 重排、超时与降级逻辑 |
| `SKILL.md` | 使用说明：能力、输入输出与适用场景 |

## 关键概念

- SourceManager：同步 `state.L0.sources`，并执行本地 `search`/`semanticSearch`。
- 输入校验：
  - `query` 必填字符串，长度 ≤ 2048。
  - `sources`（可选）为文档 ID 列表，数量 ≤ 100。
  - `limit` 范围 1-100。
  - `semanticTimeoutMs` 上限 60000（仅作用于 `semanticSearch`）。
  - `retrieverTimeoutMs` 默认 15000，上限 60000（用于外部检索器 `retriever.search`）。
- 语义检索：优先使用 `context.embeddingService`；否则读取 `embedding`/`globalConfig.embedding` 配置并缓存到 `context._pbEmbeddingService`，可透传 `fetchImpl`。
- 外部检索器：`retriever.search` 由熔断器包裹（registry 优先取 `context`/`stageApi`，无则使用全局），并受 `retrieverTimeoutMs` 约束；失败/熔断/超时时降级为本地检索。
- MMR 重排：默认开启；`mmr: false` 关闭；`mmr` 支持 `{ topK, lambda, maxTokens }`。
- 证据写入：带 `gapId` 时通过 `discoveryManager.addEvidence` 记录证据。
- 事件上报：成功触发 `emit('deepsearch:search_completed')`（本地检索包含 `fallback: 'local'`）；本地检索失败触发 `emit('deepsearch:search_failed')`。

## 常见任务

- 基本搜索：传入 `query` 与 `limit`，返回匹配结果列表。
- 限定来源：使用 `sources` 指定文档 ID 列表，只在目标文档内检索。
- 语义检索：提供 `embedding` 配置或 `embeddingService`，启用向量相似度搜索（可用 `semanticTimeoutMs` 控制超时）。
- 控制外部检索器超时：使用 `retrieverTimeoutMs` 控制 `retriever.search` 超时与降级行为。
- 调整 MMR：`mmr: false` 关闭；或设置 `{ topK, lambda, maxTokens }` 进行重排。
- 记录缺口证据：提供 `gapId`，自动把命中片段写入 discovery 黑板。

## 使用示例

```javascript
const res = await handler(
  {
    query: '关键术语',
    limit: 8,
    sources: ['doc-1'],
    retrieverTimeoutMs: 15000,
    mmr: { lambda: 0.7, topK: 24, maxTokens: 200 }
  },
  context
);
```
