/**
 * MCP Provider Plugin
 *
 * 将 MCP (Model Context Protocol) 服务注册为内核服务
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

/**
 * @typedef {object} McpServerConfig
 * @property {string} name - 服务器名称标识
 * @property {string} url - 服务器 URL
 * @property {Record<string, any>} [options] - 附加选项
 */

/** 禁止作为状态路径键的原型污染关键字 */
const PROTO_BLACKLIST = new Set(['__proto__', 'constructor', 'prototype']);

/** 允许的 MCP URL 协议 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * 校验 serverConfig.name 防止原型污染
 * @param {string} name
 * @returns {string}
 * @throws {Error} 若 name 包含禁止关键字
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('MCP server name must be a non-empty string');
  }
  if (PROTO_BLACKLIST.has(name)) {
    throw new Error(`Invalid MCP server name: "${name}" is reserved`);
  }
  return name;
}

/**
 * 校验 serverConfig.url 防止 SSRF
 * @param {string} url
 * @returns {string}
 * @throws {Error} 若 URL 协议不在白名单
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('MCP server url must be a non-empty string');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid MCP server url: "${url}"`);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`MCP server url protocol not allowed: "${parsed.protocol}"`);
  }
  return url;
}

export default createPlugin({
  name: 'service/mcp',
  version: '1.0.0',
  description: 'MCP 服务集成',

  defaultConfig: {
    servers: [],
    autoConnect: true,
    autoConnectConcurrency: 4,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async install(ctx) {
    const clients = new Map();
    const autoConnectConcurrency = Number.isFinite(ctx.config.autoConnectConcurrency)
      ? Math.max(1, Math.floor(ctx.config.autoConnectConcurrency))
      : 4;
    const mcpClientModulePromise = import('../../mcp/mcp-client.js');

    /**
     * @param {McpServerConfig} serverConfig
     * @returns {Promise<any>}
     */
    const connectServer = async (serverConfig) => {
      validateUrl(serverConfig.url);
      const safeName = sanitizeName(serverConfig.name || serverConfig.url);

      const { McpClient } = await mcpClientModulePromise;
      const client = /** @type {InstanceType<typeof McpClient> & { connect: () => Promise<void> }} */ (
        new McpClient(/** @type {ConstructorParameters<typeof McpClient>[0]} */ (serverConfig))
      );
      if (!client || typeof client.connect !== 'function') {
        throw new Error('MCP client.connect is not available');
      }
      await client.connect();

      clients.set(safeName, client);
      ctx.state.set(`servers.${safeName}`, { status: 'connected' });
      ctx.events.emit('mcp:connected', { server: serverConfig.name });

      return client;
    };

    ctx.registerService('mcp', {
      /**
       * 连接 MCP 服务器
       * @param {McpServerConfig} serverConfig
       * @returns {Promise<any>}
       */
      async connect(serverConfig) {
        return connectServer(serverConfig);
      },

      /**
       * 获取已连接的客户端
       * @param {string} name
       * @returns {any | null}
       */
      getClient(name) {
        return clients.get(name);
      },

      /**
       * 调用 MCP 工具
       * @param {string} serverName
       * @param {string} toolName
       * @param {any} args
       * @returns {Promise<any>}
       */
      async callTool(serverName, toolName, args) {
        const client = clients.get(serverName);
        if (!client) {
          throw new Error(`MCP server not connected: ${serverName}`);
        }

        ctx.events.emit('mcp:tool:call', { server: serverName, tool: toolName });
        const result = await client.callTool(toolName, args);
        ctx.events.emit('mcp:tool:result', { server: serverName, tool: toolName, success: true });

        return result;
      },

      /**
       * 获取可用工具列表
       * @param {string} serverName
       * @returns {Promise<any[]>}
       */
      async listTools(serverName) {
        const client = clients.get(serverName);
        if (!client) return [];
        return client.listTools();
      },

      /**
       * 断开所有连接
       * @returns {Promise<void>}
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
       * @returns {{ connectedServers: string[], count: number }}
       */
      getStatus() {
        return {
          connectedServers: [...clients.keys()],
          count: clients.size,
        };
      },
    });

    const autoConnectServers = async (servers) => {
      const list = Array.isArray(servers) ? servers : [];
      if (list.length === 0) return;

      let cursor = 0;
      const workerCount = Math.min(autoConnectConcurrency, list.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= list.length) return;

          const server = list[index];
          try {
            await connectServer(server);
          } catch (err) {
            ctx.log.warn(`Auto-connect failed for ${server.name}:`, err.message);
          }
        }
      });

      await Promise.all(workers);
    };

    // 自动连接配置的服务器
    if (ctx.config.autoConnect && ctx.config.servers.length > 0) {
      await autoConnectServers(ctx.config.servers);
    }

    ctx.log.info('MCP service plugin installed');
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async onStop(ctx) {
    await ctx.services.call('mcp', 'disconnectAll', []);
  },
});
