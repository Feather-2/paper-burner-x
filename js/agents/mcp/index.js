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

// Stdio 相关模块仅 Node.js 可用，按需 lazy-load 避免非叶子模块的顶层副作用
/** @type {Promise<{StdioMcpTransport: any, createStdioMcpTransport: any, StdioMcpProvider: any, createStdioMcpProvider: any}> | null} */
let _stdioPromise = null;

/**
 * Lazy-load stdio modules (Node.js only). Cached after first call.
 * @returns {Promise<{StdioMcpTransport: any, createStdioMcpTransport: any, StdioMcpProvider: any, createStdioMcpProvider: any} | null>}
 */
async function loadStdioModules() {
  if (!isNodeLike()) return null;
  if (!_stdioPromise) {
    _stdioPromise = Promise.all([
      import("./stdio-mcp-transport.js"),
      import("./stdio-mcp-provider.js")
    ]).then(([stdioTransport, stdioProvider]) => ({
      StdioMcpTransport: stdioTransport.StdioMcpTransport,
      createStdioMcpTransport: stdioTransport.createStdioMcpTransport,
      StdioMcpProvider: stdioProvider.StdioMcpProvider,
      createStdioMcpProvider: stdioProvider.createStdioMcpProvider,
    })).catch(() => null);
  }
  return _stdioPromise;
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

  // Stdio — use loadStdioModules() for lazy access
  loadStdioModules,

  // Transport Layer
  McpTransport,
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
 * @returns {Promise<McpClient>} 配置好的 MCP 客户端实例
 */
export async function createMcpClient(options = {}) {
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

  // 支持 stdio providers (lazy-load)
  if (Array.isArray(options.stdioProviders) && options.stdioProviders.length) {
    const stdio = await loadStdioModules();
    if (stdio) {
      for (const config of options.stdioProviders) {
        if (config && config.command) {
          client.addProvider(new stdio.StdioMcpProvider(config));
        }
      }
    }
  }

  return client;
}
