# Audit History - mcp

Archived issues from security audits.

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

