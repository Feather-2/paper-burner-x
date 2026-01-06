/**
 * MCP Provider Plugin
 *
 * 将 MCP (Model Context Protocol) 服务注册为内核服务
 */

import { createPlugin } from '../../core/plugin.js';

export default createPlugin({
  name: 'service/mcp',
  version: '1.0.0',
  description: 'MCP 服务集成',

  defaultConfig: {
    servers: [],
    autoConnect: true,
  },

  async install(ctx) {
    const clients = new Map();

    ctx.registerService('mcp', {
      /**
       * 连接 MCP 服务器
       */
      async connect(serverConfig) {
        const { McpClient } = await import('../../mcp/mcp-client.js');
        const client = new McpClient(serverConfig);
        await client.connect();

        clients.set(serverConfig.name || serverConfig.url, client);
        ctx.state.set(`servers.${serverConfig.name}`, { status: 'connected' });
        ctx.events.emit('mcp.connected', { server: serverConfig.name });

        return client;
      },

      /**
       * 获取已连接的客户端
       */
      getClient(name) {
        return clients.get(name);
      },

      /**
       * 调用 MCP 工具
       */
      async callTool(serverName, toolName, args) {
        const client = clients.get(serverName);
        if (!client) {
          throw new Error(`MCP server not connected: ${serverName}`);
        }

        ctx.events.emit('mcp.tool.call', { server: serverName, tool: toolName });
        const result = await client.callTool(toolName, args);
        ctx.events.emit('mcp.tool.result', { server: serverName, tool: toolName, success: true });

        return result;
      },

      /**
       * 获取可用工具列表
       */
      async listTools(serverName) {
        const client = clients.get(serverName);
        if (!client) return [];
        return client.listTools();
      },

      /**
       * 断开所有连接
       */
      async disconnectAll() {
        for (const [name, client] of clients) {
          try {
            await client.disconnect();
            ctx.state.set(`servers.${name}`, { status: 'disconnected' });
          } catch (err) {
            ctx.log.warn(`Failed to disconnect ${name}:`, err.message);
          }
        }
        clients.clear();
      },

      /**
       * 获取状态
       */
      getStatus() {
        return {
          connectedServers: [...clients.keys()],
          count: clients.size,
        };
      },
    });

    // 自动连接配置的服务器
    if (ctx.config.autoConnect && ctx.config.servers.length > 0) {
      for (const server of ctx.config.servers) {
        try {
          await ctx.services.call('mcp', 'connect', [server]);
        } catch (err) {
          ctx.log.warn(`Auto-connect failed for ${server.name}:`, err.message);
        }
      }
    }

    ctx.log.info('MCP service plugin installed');
  },

  async onStop(ctx) {
    await ctx.services.call('mcp', 'disconnectAll', []);
  },
});
