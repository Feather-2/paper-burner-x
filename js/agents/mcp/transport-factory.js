/**
 * MCP Transport Factory - 跨平台传输层创建
 * @module mcp/transport-factory
 */

import { isNodeLike, toNonEmptyString } from "../shared/index.js";

/**
 * @typedef {'stdio' | 'http' | 'sse' | 'websocket' | 'auto'} TransportType
 */

/**
 * 创建 MCP 传输
 * @param {{ type?: TransportType, command?: string, args?: string[], url?: string }} [options] - Transport options
 * @returns {Promise<import('./mcp-transport.js').McpTransport>}
 */
export async function createMcpTransport(options = {}) {
  const { type = "auto" } = options;

  // Stdio 仅 Node.js
  if (type === "stdio" || (type === "auto" && isNodeLike() && options.command)) {
    if (!isNodeLike()) {
      throw new Error("StdioMcpTransport is only available in Node.js");
    }
    const { StdioMcpTransport } = await import('./stdio-mcp-transport.js');
    const command = toNonEmptyString(options.command);
    if (!command) throw new Error("StdioMcpTransport requires command");
    return new StdioMcpTransport(
      /** @type {import('./stdio-mcp-transport.js').StdioMcpTransportOptions} */ ({ ...options, command })
    );
  }

  // HTTP - 跨平台
  if (type === "http" || type === "auto") {
    const { HttpMcpTransport } = await import('./http-mcp-transport.js');
    const url = toNonEmptyString(options.url);
    if (!url) throw new Error("HttpMcpTransport requires url");
    return new HttpMcpTransport(
      /** @type {import('./http-mcp-transport.js').HttpMcpTransportOptions} */ ({ ...options, url })
    );
  }

  // SSE - 跨平台
  if (type === "sse") {
    const { SseMcpTransport } = await import('./sse-mcp-transport.js');
    const url = toNonEmptyString(options.url);
    if (!url) throw new Error("SseMcpTransport requires url");
    return new SseMcpTransport(
      /** @type {import('./sse-mcp-transport.js').SseMcpTransportOptions} */ ({ ...options, url })
    );
  }

  throw new Error(`Unknown MCP transport type: ${type}`);
}

/**
 * 获取当前环境支持的传输类型列表
 * @returns {TransportType[]} 支持的传输类型数组
 */
export function getSupportedTransports() {
  /** @type {TransportType[]} */
  const supported = ["http", "sse"];
  if (isNodeLike()) {
    supported.unshift("stdio");
  }
  return supported;
}
