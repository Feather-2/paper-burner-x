# search-docs - 文档搜索工具

在 DeepSearch 工具层中搜索已加载的文档，支持关键词/语义检索与 MMR 重排；优先使用外部检索器，失败时降级为本地检索，并可写入 gap 证据。

## 核心文件

| 文件 | 职责 |
|------|------|
| `handler.js` | 入口：解析参数、执行检索、MMR 重排与降级逻辑 |
| `SKILL.md` | 使用说明：能力、输入输出与适用场景 |

## 关键概念

- SourceManager：同步 `state.L0.sources`，并执行本地 `search`/`semanticSearch`。
- 语义检索：优先使用 `context.embeddingService`；否则读取 `embedding`/`globalConfig.embedding` 配置并缓存到 `context._pbEmbeddingService`，可透传 `fetchImpl`。
- 外部检索器：`retriever.search` 由熔断器包裹（registry 优先取 `context`/`stageApi`，无则使用全局），失败或熔断时降级为本地检索。
- MMR 重排：默认开启；`mmr: false` 关闭，配置支持 `lambda`/`maxTokens`/`poolFactor`/`poolLimit`（默认 `lambda=0.7`、`maxTokens=200`、`poolFactor=3`）。
- MMR 池大小：`poolLimit` 至少为 `limit`，最大 100；未指定时按 `limit * poolFactor` 计算。
- 输入校验：`query` 必填字符串；`limit` 范围 1-100；`semanticTimeoutMs` 上限 60000。
- 证据写入：带 `gapId` 时通过 `discoveryManager.addEvidence` 记录证据。
- 事件上报：成功触发 `emit('deepsearch:search_completed')`（本地检索包含 `fallback: 'local'`）；本地检索失败触发 `emit('deepsearch:search_failed')`。

## 常见任务

- 基本搜索：传入 `query` 与 `limit`，返回匹配结果列表。
- 限定来源：使用 `sources` 指定文档 ID 列表，只在目标文档内检索。
- 语义检索：提供 `embedding` 配置或 `embeddingService`，启用向量相似度搜索。
- 调整 MMR：`mmr: false` 关闭；或设置 { lambda, maxTokens, poolFactor, poolLimit } 进行重排。
- 记录缺口证据：提供 `gapId`，自动把命中片段写入 discovery 黑板。
- 控制超时：`semanticTimeoutMs` 仅作用于 `semanticSearch` 的超时控制，外部检索器需自行处理超时。

## 使用示例

```javascript
const res = await handler(
  { query: '关键术语', limit: 8, sources: ['doc-1'], mmr: { lambda: 0.7 } },
  context
);
```
