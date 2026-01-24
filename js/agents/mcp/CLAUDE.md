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
│  └─ StdioMcpProvider (stdio 进程通信) ← NEW                     │
├─────────────────────────────────────────────────────────────────┤
│                      Transport Layer                             │
│  ├─ McpTransport (抽象基类)                                      │
│  ├─ StdioMcpTransport (Node.js only)                            │
│  ├─ HttpMcpTransport (跨平台) ← NEW                              │
│  ├─ SseMcpTransport (跨平台) ← NEW                               │
│  └─ createMcpTransport() (Factory) ← NEW                        │
└─────────────────────────────────────────────────────────────────┘
```

## 协议与传输

- 传输层（Transport）：stdio / HTTP / SSE，决定消息如何到达对端。
- 协议类型（TransportKind）：`jsonrpc` / `toolapi` / `rest`，决定消息体的语义与封装方式。
- 约定：所有外部 URL 在出网前必须通过 `auditUrl()` 校验与净化，并使用 `safeUrl` 参与日志/错误信息。

## 核心文件

| 文件 | 职责 |
|------|------|
| `mcp-client.js` | McpClient, McpProvider 接口 |
| `constants.js` | TransportKind、isValidTransportKind、normalizeTransportKind 等基础枚举/工具 |
| `local-mcp-provider.js` | 本地内置 MCP (HTTP/fetch) |
| `mcp-nexus-provider.js` | MCP-Nexus 远程端点（注意 URL 白名单与超时） |
| `stdio-mcp-provider.js` | Stdio 进程通信 Provider |
| `mcp-transport.js` | Transport 抽象接口 |
| `stdio-mcp-transport.js` | Stdio Transport 实现 |
| `transport-factory.js` | createMcpTransport(), getSupportedTransports() |
| `http-mcp-transport.js` | HTTP 传输 (fetch-based, 跨平台) |
| `sse-mcp-transport.js` | SSE 传输 (EventSource, 跨平台) |
| `resource-manager.js` | MCP 资源管理 |
| `sse.js` | SSE 解析器 |

## 内容处理

| 文件 | 职责 |
|------|------|
| `content-extractor.js` | 页面内容提取（包含大输入安全边界） |
| `smart-content-extractor.js` | 智能内容提取（结构化结果） |
| `content-sanitizer.js` | 提取结果净化、URL 去敏（stripUrls / sanitizeExtractedText） |
| `url-whitelist.js` | URL 审计与白名单（auditUrl / filterUrlParams） |

## 安全约定（必须遵守）

- 协议安全：对 MCP 请求/响应做 schema 校验（拒绝未知字段/类型不匹配）。
- SSRF 防护：所有用户可控 URL 必须经过 allowlist/denylist；阻断 localhost/私网 IP、metadata 地址、非 http(s) 协议。
- 认证安全：禁止在日志中输出 token/apiKey/Authorization；URL 需剥离敏感 query/hash/credentials。
- 超时与重试：所有网络请求必须设置 `timeoutMs` 并支持 Abort；重试需有上限与退避策略。

## 测试重点

- 协议兼容性：jsonrpc/toolapi/rest 的请求/响应一致性。
- 网络异常：超时、DNS 失败、SSE 断流、重试与熔断行为。
- 认证流程：敏感参数剥离、日志脱敏、错误信息分级。
