# mcp - Model Context Protocol

标准化工具调用接口，支持多种传输方式：本地内置、远程 Nexus、stdio 进程通信。

## 架构

```text
┌─────────────────────────────────────────────────────────────────┐
│                         McpClient                               │
│  - 统一调用接口                                                  │
│  - 多 Provider 路由                                              │
│  - Circuit Breaker                                              │
├─────────────────────────────────────────────────────────────────┤
│                        Providers                                 │
│  ├─ LocalMcpProvider (内置 HTTP/fetch)                          │
│  ├─ McpNexusProvider (远程 HTTP)                                │
│  └─ StdioMcpProvider (stdio 进程通信)                           │
├─────────────────────────────────────────────────────────────────┤
│                      Transport Layer                             │
│  ├─ McpTransport (抽象基类)                                      │
│  ├─ StdioMcpTransport (Node.js only)                            │
│  ├─ HttpMcpTransport (跨平台)                                   │
│  ├─ SseMcpTransport (跨平台)                                    │
│  └─ createMcpTransport() (Factory)                              │
├─────────────────────────────────────────────────────────────────┤
│                Content & Safety Utilities                         │
│  - auditUrl()/filterUrlParams()                                  │
│  - content-extractor / smart-content-extractor                    │
│  - sanitizeExtractedText()/stripUrls()                            │
└─────────────────────────────────────────────────────────────────┘
```

## 协议与传输

- 传输层（Transport）：stdio / HTTP / SSE，决定消息如何到达对端。
- 协议类型（TransportKind）：`jsonrpc` / `toolapi` / `rest`，决定消息体的语义与封装方式。
- 约定：所有外部 URL 在出网前必须通过 `auditUrl()` 校验与净化，并使用 `safeUrl` 参与日志/错误信息。
- 约定：任何外部网页/HTML 解析出的文本在进入日志、模型上下文或用户可见输出前，必须经过 `sanitizeExtractedText()`；按需使用 `stripUrls()` 以避免泄露敏感 query 参数。

## 内容提取与净化

该模块在需要处理外部网页内容（例如搜索结果落地页、远程端点返回的 HTML/片段等）时，提供“抓取 → 提取 → 净化”的工具链。

- **抓取前**：对用户可控 URL 必须先 `auditUrl()`，并仅允许白名单协议/域名（禁止私网、localhost、内网 IP、非预期协议等）。
- **提取**：`extractTextFromHtml()` 使用单次线性扫描提取文本，并对输入/输出做上限控制，降低 OOM/CPU 风险。
- **净化**：`sanitizeExtractedText()` 清理危险/噪声内容；`stripUrls()` + `filterUrlParams()` 过滤敏感参数；日志/错误仅输出 `safeUrl`。

> 注意：本模块输出应视为“不可信文本”。禁止将外部内容直接拼接进 `innerHTML`。

## 核心文件

| 文件 | 职责 |
|------|------|
| `mcp-client.js` | McpClient, McpProvider 接口 |
| `constants.js` | TransportKind、isValidTransportKind、normalizeTransportKind 等基础枚举/工具 |
| `local-mcp-provider.js` | 本地内置 MCP (HTTP/fetch) |
| `mcp-nexus-provider.js` | MCP-Nexus 远程端点（注意 URL 白名单、超时、重试与脱敏日志） |
| `stdio-mcp-provider.js` | Stdio 进程通信 Provider |
| `mcp-transport.js` | Transport 抽象接口 |
| `stdio-mcp-transport.js` | Stdio Transport 实现（Node.js only） |
| `transport-factory.js` | createMcpTransport(), getSupportedTransports() |
| `content-extractor.js` | 外部 HTML → 文本提取（有输入/输出上限） |
| `smart-content-extractor.js` | 页面主内容抽取（启发式/结构化） |
| `content-sanitizer.js` | 文本净化与 URL 脱敏（token/key 等） |
| `url-whitelist.js` | URL 白名单、auditUrl()/filterUrlParams() |

## 测试重点（建议）

- 协议兼容性：`TransportKind`/normalize 行为与非法值回退。
- 网络异常：超时、DNS 失败、非 2xx、重试策略与熔断。
- 认证流程：API key 脱敏（日志/错误中不出现明文）。
- SSRF：对 `auditUrl()` 的白名单与私网/localhost 拦截测试。
- 内容安全：`sanitizeExtractedText()`/`stripUrls()` 边界测试（空值、超长、深层嵌套 URL、含 token 参数）。
