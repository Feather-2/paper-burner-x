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

export {
  McpProvider,
  McpClient,
  McpToolDefinition,
  McpToolResult,
  LocalMcpProvider,
  createLocalMcpProvider,
  McpNexusProvider,
};

// 便捷方法：创建配置好的 MCP 客户端
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

  return client;
}
