# Audit History - mcp

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 沙箱逃逸 / 未隔离执行
*Archived: 2026-01-19T23:56:35.140Z*

- **File**: js/agents/mcp/stdio-mcp-provider.js:64
- **Description**: StdioMcpProvider 直接执行 options.command 启动外部进程，缺少 allowlist 或隔离机制；若配置来源不可信，会导致任意命令执行。
- **Suggestion**: 引入受信任命令 allowlist/签名配置；或要求显式高权限开关并在受限运行时中执行。
```
if (!options.command) {
  throw new Error("StdioMcpProvider: command is required");
}

this.command = options.command;
```

---

## Archived: 2026-01-19

### [RESOLVED] 不安全反序列化 / 异常吞掉
*Archived: 2026-01-19T23:56:24.299Z*

- **File**: js/agents/mcp/sse.js:522
- **Description**: SSE 事件数据直接 JSON.parse，缺少大小/Schema 校验且解析异常被静默忽略；这符合清单中的“JSON.parse 未验证外部数据”，同时会隐藏恶意/畸形 payload。
- **Suggestion**: 限制 payload 大小并做 JSON-RPC/MCP Schema 校验；将解析失败计数或记录到 logger/回调中。
```
const data = toNonEmptyString(evt?.data);
if (!data) return;
try {
  const parsed = JSON.parse(data);
  onData(parsed, evt);
} catch {
  // ignore invalid JSON payloads
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 测试缺口
*Archived: 2026-01-19T23:56:04.900Z*

- **File**: tests/unit/agents/mcp/mcp-client.test.js:552
- **Description**: 测试覆盖了常规行为，但未验证协议消息 Schema 校验与 Nexus 端点白名单/私网阻断等安全边界。
- **Suggestion**: 补充对无效 JSON-RPC 结构的拒绝测试，以及对 Nexus 端点 allowlist/denylist 的单测。
```
// McpTransport Tests
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF / URL 白名单
*Archived: 2026-01-19T23:54:11.971Z*

- **File**: js/agents/mcp/nexus-skill-provider.js:343
- **Description**: NexusSkillProvider 使用 baseUrl 拼接请求地址且未做校验；在 Node/服务端场景若 baseUrl 可被用户控制，会形成 SSRF 风险。
- **Suggestion**: 在构造时验证 baseUrl（仅 http/https），默认阻断私网地址；必要时提供显式 allowlist 选项。
```
const url = `${this.baseUrl}${path}`;
const controller = new AbortController();
```

---

## Archived: 2026-01-19

### [RESOLVED] 协议 Schema 校验缺失
*Archived: 2026-01-19T23:53:16.585Z*

- **File**: js/agents/mcp/mcp-transport.js:143
- **Description**: MCP/JSON-RPC 入站消息未做结构校验，直接进入 pending resolve/事件分发；恶意或畸形消息可能导致协议状态异常，违反“协议安全”要求。
- **Suggestion**: 在处理前校验 jsonrpc 版本、id 类型、method 字符串与 params/result/error 结构；不合法消息应拒绝并记录。
```
_handleMessage(message) {
  if (message.id !== undefined && this._pending.has(message.id)) {
    ...
  }
  this.emit("message", message);
  if (message.method) {
    this.emit(`notification:${message.method}`, message.params);
  }
}
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF / URL 白名单
*Archived: 2026-01-19T23:51:56.430Z*

- **File**: js/agents/mcp/mcp-nexus-provider.js:312
- **Description**: McpNexusProvider 直接使用 endpoint/sseEndpoint 作为远程请求基址，缺少白名单/私网校验；若该配置可被用户控制（服务端/代理场景），可能触发 SSRF 访问内网资源。
- **Suggestion**: 对 endpoint 与 sseEndpoint 做协议+主机白名单校验，默认拒绝私网/loopback，仅在显式允许时放行。
```
this.baseUrl = normalizeBaseUrl(endpoint);
if (!this.baseUrl) throw new Error("McpNexusProvider requires endpoint");
```

---

## Archived: 2026-01-18

### [RESOLVED] compatibility
*Archived: 2026-01-18T21:07:33.028Z*

- **File**: js/agents/mcp/index.js:19
- **Description**: index.js 静态引入 stdio 相关模块，浏览器打包时可能因 Node-only API（如 process / runtime/transports/process-transport.js）报错，违反跨平台要求。
- **Suggestion**: 将 stdio 相关导出移动到 Node 专用入口（如 index.node.js），或改为条件/动态 import 并在浏览器入口仅暴露 http/sse。
```
import { StdioMcpTransport, createStdioMcpTransport } from "./stdio-mcp-transport.js";
import { StdioMcpProvider, createStdioMcpProvider } from "./stdio-mcp-provider.js";
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:07:33.028Z*

- **File**: js/agents/mcp/index.js:55
- **Description**: createMcpClient 导出函数缺少 @param/@returns 类型注解，options 结构不明确。
- **Suggestion**: 补充 JSDoc 与 options typedef，明确 useLocal/localOptions/nexusEndpoint/nexusOptions/stdioProviders 的类型。
```
// 便捷方法：创建配置好的 MCP 客户端
export function createMcpClient(options = {}) {
  const client = new McpClient();
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:07:33.028Z*

- **File**: js/agents/mcp/smart-content-extractor.js:917
- **Description**: htmlToMarkdown/htmlToPlainText 导出函数只有描述性注释，缺少 @param/@returns 类型注解。
- **Suggestion**: 补充 JSDoc，标注 html 与 options 参数类型及返回值 string。
```
/**
 * 简单包装：只返回 Markdown
 */
export function htmlToMarkdown(html, options = {}) {
  const { markdown } = extractSmartContent(html, options);
  return markdown;
}

/**
 * 简单包装：只返回纯文本
 */
export function htmlToPlainText(html, options = {}) {
  const { plainText } = extractSmartContent(html, options);
  return plainText;
}
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:07:33.028Z*

- **File**: js/agents/mcp/transport-factory.js:51
- **Description**: getSupportedTransports 导出函数缺少 @returns 类型注解。
- **Suggestion**: 增加 @returns {TransportType[]} 并保持与 TransportType typedef 一致。
```
/**
 * 获取当前环境支持的传输类型列表
 */
export function getSupportedTransports() {
  const supported = ['http', 'sse'];
  if (isNodeLike()) {
    supported.unshift('stdio');
  }
  return supported;
}
```

---

