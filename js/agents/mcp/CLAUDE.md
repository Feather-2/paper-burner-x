# mcp - Model Context Protocol

标准化工具调用接口，支持多种传输方式：本地内置、远程 Nexus、stdio 进程通信。

## 架构

```text
┌─────────────────────────────────────────────────────────────────┐
│                         McpClient                               │
│  - 统一调用接口                                                  │
│  - 多 Provider 路由                                              │
│  - Circuit Breaker / 超时控制                                    │
├─────────────────────────────────────────────────────────────────┤
│                        Providers                                 │
│  ├─ LocalMcpProvider (内置 HTTP/fetch)                          │
│  ├─ McpNexusProvider (远程 HTTP)                                │
│  └─ StdioMcpProvider (stdio 进程通信，Node-only)                │
├─────────────────────────────────────────────────────────────────┤
│                      Transport Layer                             │
│  ├─ McpTransport (抽象基类)                                      │
│  ├─ StdioMcpTransport (Node.js only)                            │
│  ├─ HttpMcpTransport (跨平台)                                   │
│  ├─ SseMcpTransport (跨平台)                                    │
│  └─ createMcpTransport() (Factory)                              │
├─────────────────────────────────────────────────────────────────┤
│                   Protocol & Validation                          │
│  ├─ TransportKind (jsonrpc/toolapi/rest)                        │
│  ├─ isValidTransportKind()                                      │
│  └─ normalizeTransportKind()                                    │
├─────────────────────────────────────────────────────────────────┤
│                Content & Safety Utilities                        │
│  - auditUrl()/filterUrlParams()                                 │
│  - content-extractor / smart-content-extractor                  │
│  - sanitizeExtractedText()/stripUrls()                          │
│  - isSensitiveQueryParamKey()                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 协议与传输

- 传输层（Transport）：`stdio` / `http` / `sse`，决定消息如何到达对端。
- 协议类型（TransportKind）：`jsonrpc` / `toolapi` / `rest`，决定消息体语义与封装。
- 约定：所有外部输入的协议类型先经 `normalizeTransportKind()` 归一化，再参与分发。
- 约定：协议值校验必须通过 `isValidTransportKind()`，非法值应显式拒绝，不可静默降级。

## URL 安全与隐私约定

- 所有外部 URL 出网前必须通过 `auditUrl()` 校验，并使用 `safeUrl` 参与日志/错误信息。
- URL query 进入日志、提示词、异常信息前，必须通过 `filterUrlParams()` 去敏。
- 对敏感参数键（token/key/secret/auth/session/signature 等）使用 `isSensitiveQueryParamKey()` 识别并剥离。
- 禁止记录原始凭据：包含凭据、hash、敏感 query 的 URL 不得原样输出。

## 内容提取与净化

- `content-extractor` 负责页面内容抽取、摘要截断、结构化结果输出。
- `smart-content-extractor` 负责正文识别与噪声过滤。
- 所有提取文本在进入日志、模型上下文或用户可见输出前，必须执行：
  1. `sanitizeExtractedText()`（去危险片段/控制字符）
  2. 按需 `stripUrls()`（去除潜在敏感链接）

## 浏览器兼容性

- 模块默认 Browser-first，使用 ES Modules。
- `StdioMcpTransport` 为 Node-only 能力，不得在浏览器路径直接加载。
- 不使用 `require()`、`__dirname`、`__filename` 等 Node CJS 语法。

## 开发约束

- MCP 消息（request/response/notification）必须进行 schema 校验。
- 所有网络请求必须配置合理超时与重试上限，避免无限等待。
- 错误处理必须保留可观测性（日志/错误码），但不得暴露敏感信息。

## 测试重点

- 协议兼容性：`jsonrpc/toolapi/rest` 的路由与回退行为。
- 网络异常：超时、重试、断路器、代理失败。
- 认证安全：API key/token 在日志、错误、上下文中的脱敏行为。
- URL 审计：白名单命中、私网拦截、敏感 query 剥离。
