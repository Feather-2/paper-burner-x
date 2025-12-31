# MCP 文件夹审查报告 (js/agents/mcp)

## 1. 潜在问题清单

### 1.1 协议实现与兼容性 (Protocol & Compatibility)
- **非标准 SSE 实现**: `sse.js` 手动解析 SSE 流（第 21 行）。虽然在某些受限环境下可行，但忽略了 SSE 协议中关于 `retry` 指令的重连逻辑，且对大型数据包的 Buffer 处理可能存在内存峰值问题。
- **DuckDuckGo 解析的脆弱性**: `local-mcp-provider.js` 依赖 DuckDuckGo HTML 结构的正则和 DOM 解析（第 287 行）。这类解析器非常容易因搜索引擎 UI 调整而失效。
- **混合环境导出**: `sse.js` 混合使用了 `TextDecoder`（浏览器/Node 11+）和 `node:stream` 的逻辑（虽然代码中没直接看到 node 模块，但 `readStreamTextChunks` 假设了 `getReader()` 存在）。

### 1.2 内容提取质量 (Content Extraction)
- **提取深度有限**: `smart-content-extractor.js` 使用预定义的选择器列表（第 12 行）。对于一些使用 Web Components 或 Shadow DOM 的现代网页，这种简单的 DOM 查询将无法深入提取内容。
- **Markdown 转换逻辑简单**: `elementToMarkdown`（第 325 行）对表格、嵌套列表的处理较为初级。例如，表格转换（第 404 行）仅使用 `|` 分隔，不支持单元格内的换行处理。
- **缺乏多页处理**: 目前的 `fetch_content` 仅提取单页内容。对于有分页的文章，Agent 无法通过该工具自动感知或加载后续内容。

### 1.3 安全与隐私 (Security & Privacy)
- **URL 脱敏覆盖不足**: `redactUrlForLog`（第 63 行）虽然脱敏了部分敏感字段，但基于黑名单。对于一些非标准命名的授权 Token，仍然可能通过日志泄露。
- **SSRF 风险**: 虽然本 Provider 是“Local”，但 `fetch_content` 允许 Agent 访问任意 URL（第 502 行）。如果没有外网访问限制或私y IP 过滤，可能被利用进行内网探测（SSRF）。
- **代理选择器的安全**: `LocalMcpProvider` 的 `corsProxies` 曾包含公共代理（第 427 行注释提到已移除），但现有的逻辑仍允许注入任意 `proxyEndpoint`，缺乏对代理目标的可信度验证。

### 1.4 设计与性能 (Design & Performance)
- **工具名称不规范**: `LocalMcpProvider` 的 `callTool` 支持多种别名如 `search.query`, `search`, `fetch_content` 等（第 531 行）。虽然增加了容错，但也导致工具集的规范性降低，增加了 Prompt 消耗。
- **Memory 绑定时机**: `bindMemoryStore` 采用延迟绑定（第 912 行），如果 Agent 在绑定完成前调用搜索，会丢失发现记录。这种副作用设计不如在构造函数中强制要求或使用依赖注入框架。

## 2. 改进建议
1. **引入标准库**: 在 Node 环境下优先使用 `mcp-sdk` 或标准的 `eventsource`库，减少手动维护 SSE 解析器的成本。
2. **增强内容提取**: 集成类似 `Readability.js` 的成熟算法替代自定义选择器，提高对复杂页面的主内容识别准确率。
3. **安全加固**: 为 `fetch_content` 增加域名白名单/黑名单过滤，防止 SSRF 攻击。
4. **API 标准化**: 移除工具名称的模糊匹配逻辑，强制使用标准的 MCP 工具命名规范，减少模型理解成本。
5. **代理健壮性**: 在 `_fetchWithCorsFallback` 中增加对返回内容的有效性校验（例如检查是否返回了代理自身的报错页面而非目标网页内容）。

## cc是如何解决这个问题的

Claude Code (CC) 通过一套标准的协议实现和严谨的架构设计解决了 MCP 集成中的鲁棒性和规范性问题：

1.  **标准的 SSE 与协议处理**:
    *   **健壮的解码器**: CC 实现了 `SSEDecoder` 和 `NewlineDecoder` ([`src/streaming/sse.ts`](ref/claude-code-open-main/src/streaming/sse.ts))，严格遵循 SSE 规范。它能正确处理 `event:`, `data:`, `id:` 以及 `retry:`（用于重连延迟）字段，并支持跨平台的 `Uint8Array` 缓冲处理。
    *   **纯浏览器端适配**: 使用浏览器原生的 `TextDecoder` 和 `ReadableStream` 接口，这使得 SSE 解析逻辑可以在不依赖 Node.js `eventsource` 库的情况下在浏览器端高性能运行。

2.  **规范化的工具发现与路由**:
    *   **统一前缀命名**: CC 使用 `mcp__${serverName}__${toolName}` 的强制命名规范 ([`src/mcp/adapter.ts`](ref/claude-code-open-main/src/mcp/adapter.ts))，避免了模糊匹配带来的理解偏差和 Prompt 浪费。
    *   **工具搜索机制**: 引入了 `MCPSearch` 工具 ([`src/tools/mcp.ts`](ref/claude-code-open-main/src/tools/mcp.ts))。Agent 必须先搜索并加载工具，这不仅减少了 Context 消耗，也提供了一个标准的发现流程。

3.  **分层的配置与安全管理**:
    *   **配置解耦**: `McpConfigManager` ([`src/mcp/config.ts`](ref/claude-code-open-main/src/mcp/config.ts)) 区分了全局配置和项目配置。它包含严格的 Zod Schema 验证，确保输入的合法性。
    *   **敏感信息过滤**: 配置导出时会自动对 `env` 和 `headers` 中的敏感键（如 `key`, `token`, `auth`）进行掩码处理 ([`src/mcp/config.ts`](ref/claude-code-open-main/src/mcp/config.ts))，从源头上保护了隐私。

4.  **资源与提示适配**:
    *   **资源适配器**: CC 将 MCP 资源 (Resources) 适配为 `ContextProvider` ([`src/mcp/adapter.ts`](ref/claude-code-open-main/src/mcp/adapter.ts))。这意味着资源可以像本地文件一样被 Agent 以一致的方式读取和引用。
    *   **异步加载与缓存**: 资源列表具有 `RESOURCE_CACHE_TTL` 缓存机制，避免了频繁的协议开销。
    *   **纯浏览器端适配**: 适配器模式使得我们可以轻松地在浏览器端实现一个“Virtual MCP Server”，将浏览器插件能力或本地 Storage 暴露给 Agent，而无需改变任何调用流程。
