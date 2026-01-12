# mcp - Model Context Protocol

标准化工具调用接口，支持本地和远程 MCP 端点。

## 核心文件

| 文件 | 职责 |
|------|------|
| `mcp-client.js` | McpClient, McpProvider 接口 |
| `local-mcp-provider.js` | 本地内置 MCP |
| `mcp-nexus-provider.js` | MCP-Nexus 远程端点 |
| `nexus-skill-provider.js` | Nexus Skill 提供者 |
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

```javascript
import { createMcpClient } from 'js/agents/mcp';

// 使用本地 MCP
const client = createMcpClient({ useLocal: true });

// 添加 Nexus 端点
const client = createMcpClient({
  useLocal: true,
  nexusEndpoint: 'http://localhost:3000/mcp',
});

// 调用工具
const result = await client.callTool('web_search', { query: 'AI news' });
```

## 架构

```
McpClient
  ├─ LocalMcpProvider (内置工具)
  └─ McpNexusProvider (远程 Nexus)
       ↓
  McpResourceManager (资源缓存/管理)
```
