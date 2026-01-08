import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Kernel } from '../../../js/agents/core/index.js';
import mcpPlugin from '../../../js/agents/plugins/services/mcp.js';

let connectOverride = null;
let disconnectOverride = null;
let callToolOverride = null;
let listToolsOverride = null;
/** @type {any[]} */
const constructedClients = [];

vi.mock('../../../js/agents/mcp/mcp-client.js', () => {
  class McpClient {
    constructor(config) {
      this.config = config;
      this.connect = vi.fn(async () => {
        if (typeof connectOverride === 'function') {
          return await connectOverride(config, this);
        }
      });
      this.disconnect = vi.fn(async () => {
        if (typeof disconnectOverride === 'function') {
          return await disconnectOverride(config, this);
        }
      });
      this.callTool = vi.fn(async (toolName, args) => {
        if (typeof callToolOverride === 'function') {
          return await callToolOverride(config, toolName, args, this);
        }
        return { toolName, args, server: config?.name };
      });
      this.listTools = vi.fn(async () => {
        if (typeof listToolsOverride === 'function') {
          return await listToolsOverride(config, this);
        }
        return [];
      });

      constructedClients.push(this);
    }
  }

  return { McpClient };
});

async function createKernel(options = {}) {
  return new Kernel({
    enableRetry: false,
    enableTimeout: false,
    keepHistory: true,
    keepLog: true,
    ...options,
  });
}

describe('service/mcp plugin', () => {
  /** @type {Kernel | null} */
  let kernel = null;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    connectOverride = null;
    disconnectOverride = null;
    callToolOverride = null;
    listToolsOverride = null;
    constructedClients.length = 0;
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.stop().catch(() => {});
      kernel = null;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('connect stores client, updates state, emits mcp.connected, and exposes getClient/getStatus', async () => {
    kernel = await createKernel();
    await kernel.use(mcpPlugin, { autoConnect: false, servers: [] });
    await kernel.start();

    const events = [];
    kernel.events.on('mcp.connected', (evt) => events.push(evt.payload));

    const serverConfig = { name: 'local', url: 'http://localhost:9999' };
    const client = await kernel.services.call('mcp', 'connect', [serverConfig]);

    expect(constructedClients).toHaveLength(1);
    expect(constructedClients[0].connect).toHaveBeenCalledTimes(1);

    expect(client).toBe(constructedClients[0]);
    expect(await kernel.services.call('mcp', 'getClient', ['local'])).toBe(client);

    expect(kernel.state.get('plugins.service/mcp.servers.local')).toEqual({ status: 'connected' });
    expect(events).toEqual([{ server: 'local' }]);

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: ['local'], count: 1 });
  });

  it('connect uses server url as fallback key when name is missing', async () => {
    kernel = await createKernel();
    await kernel.use(mcpPlugin, { autoConnect: false, servers: [] });
    await kernel.start();

    const serverConfig = { url: 'http://only-url' };
    const client = await kernel.services.call('mcp', 'connect', [serverConfig]);

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: ['http://only-url'], count: 1 });
    expect(await kernel.services.call('mcp', 'getClient', ['http://only-url'])).toBe(client);

    // Current implementation writes scoped state using `serverConfig.name`, which becomes "undefined".
    expect(kernel.state.get('plugins.service/mcp.servers.undefined')).toEqual({ status: 'connected' });
  });

  it('callTool throws when server not connected; listTools returns [] when missing', async () => {
    kernel = await createKernel();
    await kernel.use(mcpPlugin, { autoConnect: false, servers: [] });
    await kernel.start();

    await expect(kernel.services.call('mcp', 'callTool', ['missing', 'tool', {}])).rejects.toThrow(
      /MCP server not connected/i
    );
    await expect(kernel.services.call('mcp', 'listTools', ['missing'])).resolves.toEqual([]);
  });

  it('callTool emits events and returns tool result; listTools proxies to client', async () => {
    callToolOverride = vi.fn(async (_config, toolName, args) => ({ ok: true, toolName, args }));
    listToolsOverride = vi.fn(async () => [{ name: 'echo' }]);

    kernel = await createKernel();
    await kernel.use(mcpPlugin, { autoConnect: false, servers: [] });
    await kernel.start();

    const toolEvents = [];
    kernel.events.on('mcp.tool.call', (evt) => toolEvents.push({ type: 'call', payload: evt.payload }));
    kernel.events.on('mcp.tool.result', (evt) => toolEvents.push({ type: 'result', payload: evt.payload }));

    await kernel.services.call('mcp', 'connect', [{ name: 'local', url: 'http://localhost:9999' }]);

    const result = await kernel.services.call('mcp', 'callTool', ['local', 'echo', { a: 1 }]);
    expect(result).toEqual({ ok: true, toolName: 'echo', args: { a: 1 } });

    expect(callToolOverride).toHaveBeenCalledTimes(1);
    expect(constructedClients[0].callTool).toHaveBeenCalledWith('echo', { a: 1 });

    expect(toolEvents).toEqual([
      { type: 'call', payload: { server: 'local', tool: 'echo' } },
      { type: 'result', payload: { server: 'local', tool: 'echo', success: true } },
    ]);

    await expect(kernel.services.call('mcp', 'listTools', ['local'])).resolves.toEqual([{ name: 'echo' }]);
    expect(constructedClients[0].listTools).toHaveBeenCalledTimes(1);
  });

  it('disconnectAll clears clients, updates state for successful disconnect, and logs warnings on failure', async () => {
    disconnectOverride = vi.fn(async (config) => {
      if (config.name === 'bad') {
        throw new Error('boom');
      }
    });

    kernel = await createKernel();
    await kernel.use(mcpPlugin, { autoConnect: false, servers: [] });
    await kernel.start();

    await kernel.services.call('mcp', 'connect', [{ name: 'good', url: 'http://good' }]);
    await kernel.services.call('mcp', 'connect', [{ name: 'bad', url: 'http://bad' }]);

    await kernel.services.call('mcp', 'disconnectAll', []);

    expect(disconnectOverride).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalled();

    // Successful disconnect updates scoped state.
    expect(kernel.state.get('plugins.service/mcp.servers.good')).toEqual({ status: 'disconnected' });
    // Failed disconnect leaves the last known state as-is.
    expect(kernel.state.get('plugins.service/mcp.servers.bad')).toEqual({ status: 'connected' });

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: [], count: 0 });
  });

  it('autoConnect attempts configured servers and continues when one fails', async () => {
    connectOverride = vi.fn(async (config) => {
      if (config.failConnect) {
        throw new Error('nope');
      }
    });

    kernel = await createKernel();
    await kernel.use(mcpPlugin, {
      autoConnect: true,
      servers: [
        { name: 'ok', url: 'http://ok' },
        { name: 'fail', url: 'http://fail', failConnect: true },
      ],
    });

    await kernel.start();

    expect(connectOverride).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalled();

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: ['ok'], count: 1 });
  });

  it('kernel.stop triggers plugin onStop which disconnects all clients', async () => {
    kernel = await createKernel();
    await kernel.use(mcpPlugin, { autoConnect: false, servers: [] });
    await kernel.start();

    await kernel.services.call('mcp', 'connect', [{ name: 'local', url: 'http://localhost:9999' }]);
    expect(await kernel.services.call('mcp', 'getStatus', [])).toEqual({ connectedServers: ['local'], count: 1 });

    await kernel.stop();
    kernel = null;

    expect(constructedClients[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
