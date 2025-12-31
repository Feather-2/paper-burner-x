# Analysis: MCP & Archive (协议与存档)

## 1. 架构 (Architecture)

### MCP 扩展体系 (`js/agents/mcp/`)
- **多提供商适配 (`McpProvider`)**: 
  - `LocalMcpProvider`: 内置了基于 DuckDuckGo 的搜索 (`search`) 和网页抓取 (`fetch_content`) 工具。支持 `workerEndpoint` (Cloudflare Worker) 和 CORS 代理两种模式。
  - `McpNexusProvider`: 对接 MCP Nexus 云端中转服务，支持跨环境的工具共享。
- **统一客户端 (`McpClient`)**: 负责管理多个 Provider，并根据工具名称自动路由。支持便捷方法如 `search()` 和 `fetch()`，能够自动尝试标准名称（如 `search.query`）和别名。
- **Memory 2.0 集成**: `LocalMcpProvider` 与 `MemoryStore` 深度绑定，搜索结果会自动同步到 `syncTable.discoveries` 中。

### 存档与检查点 (`js/agents/shared/archive/`)
- **多级适配器**: 
  - `MapAdapter`: 内存存储。
  - `IndexedDBAdapter`: 浏览器持久化存储，解决刷新丢失问题。
  - `FallbackAdapter`: 自动降级策略，优先使用持久化存储。
- **版本化存档 (`Archive`)**: 提供了基于 `runId` 和 `timestamp` (带计数器防冲突) 的快照存储。支持 `deleteOlderThan` 的自动清理逻辑。
- **Schema 定义**: 统一了 `CheckpointType.PRE_ACTION` 等关键快照点。

## 2. 优化 Trick (Optimization Tricks)

- **CORS 代理冷却机制**: `LocalMcpProvider` 维护了 `_corsProxyUnhealthyUntilMs`，当某个代理失败时自动进入冷却期，优先使用 `_lastGoodProxy`。
- **敏感信息脱敏**: `redactUrlForLog` 自动识别并脱敏 URL 中的 API Key、Token 等敏感参数。
- **轻量级 HTML 状态机**: `extractTextFromHtml` 采用线性扫描而非正则 replace，极大降低了大文档处理时的内存压力。
- **存档 ID 计数器**: 处理高频存档时，通过 `runId:timestamp-counter` 解决同毫秒内的 ID 冲突。

## 3. 对比 Claude Code (analysis-cc) 的优势与差距

- **优势**: 我们的 **Local MCP** 无需外部 Node.js 进程即可在浏览器中实现搜索功能。
- **优势**: **MCP Nexus** 架构支持团队共享工具，这比 Claude Code 纯本地的 MCP 更加适合协作。
- **优势**: 存档系统原生支持 **浏览器 IndexedDB**，具备更好的跨环境运行能力。
- **差距**: Claude Code 的自动发现机制能扫描 `package.json`，我们的系统目前更多依赖 `createMcpClient` 的显式配置。
- **改进点**: 引入 Claude Code 的 `Progressive Fetch` 逻辑，在 `fetch_content` 时支持流式返回文本以降低感知延迟。
