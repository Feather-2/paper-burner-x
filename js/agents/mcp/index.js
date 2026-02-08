/**
 * MCP (Model Context Protocol) 模块
 *
 * 提供标准化的工具调用接口，支持两种端点：
 * - local-mcp: paper-burner 内置的轻量 MCP（默认）
 * - mcp-nexus: 本地或线上部署的 MCP-Nexus（可选增强）
 *
 * 业务层仅通过 tool schema + MCP 调用，不感知具体 endpoint。
 */

import { McpProvider, McpClient, McpToolDefinition, McpToolResult } from "./mcp-client.js";
import { LocalMcpProvider, createLocalMcpProvider } from "./local-mcp-provider.js";
import { McpNexusProvider } from "./mcp-nexus-provider.js";
import { McpResourceManager } from "./resource-manager.js";
import { createSseParser, consumeSse, consumeSseJson } from "./sse.js";

// Transport Layer
import { McpTransport, MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, McpMethods } from "./mcp-transport.js";
import { createMcpTransport, getSupportedTransports } from "./transport-factory.js";
import { isNodeLike } from "../shared/index.js";

// Stdio 相关模块仅 Node.js 可用，浏览器打包时需排除或使用 index.browser.js
/** @type {typeof import('./stdio-mcp-transport.js').StdioMcpTransport | undefined} */
let StdioMcpTransport;
/** @type {typeof import('./stdio-mcp-transport.js').createStdioMcpTransport | undefined} */
let createStdioMcpTransport;
/** @type {typeof import('./stdio-mcp-provider.js').StdioMcpProvider | undefined} */
let StdioMcpProvider;
/** @type {typeof import('./stdio-mcp-provider.js').createStdioMcpProvider | undefined} */
let createStdioMcpProvider;

// 条件加载 Stdio 模块 (Node.js only)
if (isNodeLike()) {
  Promise.all([
    import("./stdio-mcp-transport.js"),
    import("./stdio-mcp-provider.js")
  ])
    .then(([stdioTransport, stdioProvider]) => {
      StdioMcpTransport = stdioTransport.StdioMcpTransport;
      createStdioMcpTransport = stdioTransport.createStdioMcpTransport;
      StdioMcpProvider = stdioProvider.StdioMcpProvider;
      createStdioMcpProvider = stdioProvider.createStdioMcpProvider;
    })
    .catch(() => {
      // Stdio modules not available in this environment
    });
}

export {
  // Core
  McpProvider,
  McpClient,
  McpToolDefinition,
  McpToolResult,

  // Providers
  LocalMcpProvider,
  createLocalMcpProvider,
  McpNexusProvider,
  StdioMcpProvider,
  createStdioMcpProvider,

  // Transport Layer
  McpTransport,
  StdioMcpTransport,
  createStdioMcpTransport,
  createMcpTransport,
  getSupportedTransports,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  McpMethods,

  // Utilities
  McpResourceManager,
  createSseParser,
  consumeSse,
  consumeSseJson,
};

/**
 * @typedef {object} StdioProviderConfig
 * @property {string} id - Provider 标识
 * @property {string} [name] - Provider 名称
 * @property {string} command - 执行命令
 * @property {string[]} [args] - 命令参数
 */

/**
 * @typedef {object} CreateMcpClientOptions
 * @property {boolean} [useLocal=true] - 是否使用 LocalMcpProvider
 * @property {object} [localOptions] - LocalMcpProvider 配置
 * @property {string} [nexusEndpoint] - MCP-Nexus 端点 URL
 * @property {object} [nexusOptions] - McpNexusProvider 配置
 * @property {StdioProviderConfig[]} [stdioProviders] - Stdio Provider 配置��表 (Node.js only)
 */

/**
 * 创建配置好的 MCP 客户端
 * @param {CreateMcpClientOptions} [options={}] - 客户端配置
 * @returns {McpClient} 配置好的 MCP 客户端实例
 */
export function createMcpClient(options = {}) {
  const client = new McpClient();

  // 默认添加 local-mcp provider
  if (options.useLocal !== false) {
    client.addProvider(new LocalMcpProvider({
      id: "local-mcp",
      ...options.localOptions,
    }));
  }

  if (options.nexusEndpoint) {
    client.addProvider(
      new McpNexusProvider({
        id: "mcp-nexus",
        endpoint: options.nexusEndpoint,
        ...(options.nexusOptions && typeof options.nexusOptions === "object" ? options.nexusOptions : {}),
      })
    );
  }

  // 支持 stdio providers
  if (Array.isArray(options.stdioProviders)) {
    for (const config of options.stdioProviders) {
      if (config && config.command) {
        client.addProvider(new StdioMcpProvider(config));
      }
    }
  }

  return client;
}
