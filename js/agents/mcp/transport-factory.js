/**
 * MCP Transport Factory - 跨平台传输层创建
 * @module mcp/transport-factory
 */

import { isNodeLike } from "../shared/platform.js";

/**
 * @typedef {'stdio' | 'http' | 'sse' | 'websocket' | 'auto'} TransportType
 */

/**
 * 创建 MCP 传输
 * @param {object} options
 * @param {TransportType} [options.type='auto'] - 传输类型
 * @param {string} [options.command] - Stdio 命令 (Node.js)
 * @param {string[]} [options.args] - Stdio 参数 (Node.js)
 * @param {string} [options.url] - HTTP/SSE/WebSocket URL
 * @returns {Promise<import('./mcp-transport.js').McpTransport>}
 */
export async function createMcpTransport(options = {}) {
  const { type = 'auto' } = options;

  // Stdio 仅 Node.js
  if (type === 'stdio' || (type === 'auto' && isNodeLike() && options.command)) {
    if (!isNodeLike()) {
      throw new Error('StdioMcpTransport is only available in Node.js');
    }
    const { StdioMcpTransport } = await import('./stdio-mcp-transport.js');
    return new StdioMcpTransport(options);
  }

  // HTTP - 跨平台
  if (type === 'http' || type === 'auto') {
    const { HttpMcpTransport } = await import('./http-mcp-transport.js');
    return new HttpMcpTransport(options);
  }

  // SSE - 跨平台
  if (type === 'sse') {
    const { SseMcpTransport } = await import('./sse-mcp-transport.js');
    return new SseMcpTransport(options);
  }

  throw new Error(`Unknown MCP transport type: ${type}`);
}

/**
 * 获取当前环境支持的传输类型列表
 * @returns {TransportType[]} 支持的传输类型数组
 */
export function getSupportedTransports() {
  const supported = ['http', 'sse'];
  if (isNodeLike()) {
    supported.unshift('stdio');
  }
  return supported;
}

