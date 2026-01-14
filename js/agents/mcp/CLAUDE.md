# mcp - Model Context Protocol

标准化工具调用接口，支持多种传输方式：本地内置、远程 Nexus、stdio 进程通信。

## 架构

```
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

## 核心文件

| 文件 | 职责 |
|------|------|
| `mcp-client.js` | McpClient, McpProvider 接口 |
| `local-mcp-provider.js` | 本地内置 MCP (HTTP/fetch) |
| `mcp-nexus-provider.js` | MCP-Nexus 远程端点 |
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
| `content-extractor.js` | 内容提取 |
| `smart-content-extractor.js` | 智能内容提取 |
| `content-sanitizer.js` | 内容消毒 |
| `url-whitelist.js` | URL 白名单 |
| `http-proxy.js` | HTTP 代理 |

## 使用示例

### 基础用法

```javascript
import { createMcpClient } from 'js/agents/mcp';

// 使用本地 MCP
const client = createMcpClient({ useLocal: true });

// 调用工具
const result = await client.callTool('search.query', { query: 'AI news' });
```

### Transport Factory

```javascript
import { createMcpTransport, getSupportedTransports } from 'js/agents/mcp';

// 自动选择传输方式
const transport = await createMcpTransport({ 
  type: 'auto',  // 'stdio' | 'http' | 'sse' | 'auto'
  url: 'http://localhost:3000/mcp',
});

// 查看支持的传输类型
console.log(getSupportedTransports()); // ['http', 'sse'] or ['stdio', 'http', 'sse']
```

### 添加 Stdio Provider

```javascript
import { createMcpClient } from 'js/agents/mcp';

const client = createMcpClient({
  useLocal: true,
  stdioProviders: [
    {
      id: 'codex',
      name: 'Codex Shell MCP',
      command: 'codex-shell-tool-mcp',
    },
    {
      id: 'playwright',
      name: 'Playwright MCP',
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-playwright'],
    },
  ],
});

// 通过 Codex 执行 shell 命令
const result = await client.callTool('bash', { command: 'ls -la' }, { providerId: 'codex' });
```

### 直接使用 StdioMcpProvider

```javascript
import { StdioMcpProvider, McpClient } from 'js/agents/mcp';

const provider = new StdioMcpProvider({
  id: 'codex',
  command: 'codex-shell-tool-mcp',
});

await provider.connect();

const client = new McpClient();
client.addProvider(provider);

const tools = await client.listAllTools();
console.log('Available tools:', tools);
```

### 直接使用 StdioMcpTransport

```javascript
import { StdioMcpTransport } from 'js/agents/mcp';

const transport = new StdioMcpTransport({
  command: 'npx',
  args: ['-y', '@anthropic-ai/claude-code-mcp'],
});

await transport.connect();

// 列出工具
const tools = await transport.listTools();

// 调用工具
const result = await transport.callTool('read_file', { path: '/path/to/file' });

await transport.disconnect();
```

## Transport 矩阵

| Transport | Runtime | 协议 | 说明 |
|-----------|---------|------|------|
| `StdioMcpTransport` | Node.js | JSON-RPC 2.0 / JSONL | ✅ 已实现 |
| `HttpMcpTransport` | Browser/Node | HTTP (fetch) | ✅ 已实现 |
| `SseMcpTransport` | Browser/Node | Server-Sent Events (EventSource) | ✅ 已实现 |
| WebSocket | Browser/Node | WebSocket | 未来扩展 |

## MCP 协议版本

```javascript
import { MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS } from 'js/agents/mcp';

console.log(MCP_PROTOCOL_VERSION);    // "2024-11-05"
console.log(MCP_SUPPORTED_VERSIONS);  // ["2024-11-05", "2024-10-07"]
```

## 标准方法名

```javascript
import { McpMethods } from 'js/agents/mcp';

McpMethods.INITIALIZE        // "initialize"
McpMethods.INITIALIZED       // "notifications/initialized"
McpMethods.TOOLS_LIST        // "tools/list"
McpMethods.TOOLS_CALL        // "tools/call"
McpMethods.RESOURCES_LIST    // "resources/list"
McpMethods.RESOURCES_READ    // "resources/read"
McpMethods.PROMPTS_LIST      // "prompts/list"
McpMethods.PROMPTS_GET       // "prompts/get"
```

## 与 Skills 集成

```javascript
import { createMcpClient } from 'js/agents/mcp';
import { ToolRegistry } from 'js/agents/runtime';

const client = createMcpClient({
  stdioProviders: [
    { id: 'codex', command: 'codex-shell-tool-mcp' },
  ],
});

// 将 MCP 工具注册到 ToolRegistry
const registry = new ToolRegistry();

const tools = await client.listAllTools();
for (const tool of tools) {
  registry.registerTool(tool.name, async (params) => {
    const result = await client.callTool(tool.name, params, { providerId: tool.providerId });
    return { ok: result.success, data: result };
  });
}
```

## 与 BinarySkillProvider 对比

| 特性 | StdioMcpProvider | BinarySkillProvider |
|------|------------------|---------------------|
| 协议 | MCP (JSON-RPC 2.0) | 自定义 JSONL |
| 初始化 | 自动握手 (initialize) | 无 |
| 工具发现 | tools/list | 预定义 methods |
| EventBus 集成 | 手动 | 自动 |
| 适用场景 | 标准 MCP 服务器 | 自定义二进制工具 |
