import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  connectImpl: null,
  disconnectImpl: null,
  callToolImpl: null,
  listToolsImpl: null,
  constructedClients: [],
}));

vi.mock(
  '/js/agents/mcp/mcp-client.js',
  () => {
    class McpClient {
      constructor(config) {
        this.config = config;
        this.connect = vi.fn(async () => {
          if (typeof mockState.connectImpl === 'function') {
            return await mockState.connectImpl(config, this);
          }
          return undefined;
        });
        this.disconnect = vi.fn(async () => {
          if (typeof mockState.disconnectImpl === 'function') {
            return await mockState.disconnectImpl(config, this);
          }
          return undefined;
        });
        this.callTool = vi.fn(async (toolName, args) => {
          if (typeof mockState.callToolImpl === 'function') {
            return await mockState.callToolImpl(config, toolName, args, this);
          }
          return { toolName, args, server: config?.name };
        });
        this.listTools = vi.fn(async () => {
          if (typeof mockState.listToolsImpl === 'function') {
            return await mockState.listToolsImpl(config, this);
          }
          return [];
        });
        mockState.constructedClients.push(this);
      }
    }

    return { McpClient };
  },
  { virtual: true }
);

import { Kernel } from '../../../../../js/agents/core/index.js';
import mcpPlugin from '../../../../../js/agents/plugins/services/mcp.js';

let kernel = null;

async function createKernel(options = {}) {
  return new Kernel({
    enableRetry: false,
    enableTimeout: false,
    keepHistory: true,
    keepLog: true,
    ...options,
  });
}

async function setupKernel(configOverrides = {}) {
  kernel = await createKernel();
  await kernel.use(mcpPlugin, { autoConnect: false, servers: [], ...configOverrides });
  await kernel.start();
  return kernel;
}

function createDeepObject(depth) {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  mockState.connectImpl = null;
  mockState.disconnectImpl = null;
  mockState.callToolImpl = null;
  mockState.listToolsImpl = null;
  mockState.constructedClients.length = 0;
});

afterEach(async () => {
  if (kernel) {
    await kernel.stop().catch(() => {});
    kernel = null;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('default', () => {
  it('exposes plugin metadata and defaults', () => {
    expect(mcpPlugin.name).toBe('service/mcp');
    expect(mcpPlugin.version).toBe('1.0.0');
    expect(mcpPlugin.description).toContain('MCP');
    expect(mcpPlugin.defaultConfig).toEqual({
      servers: [],
      autoConnect: true,
    });
    expect(typeof mcpPlugin.install).toBe('function');
    expect(typeof mcpPlugin.onStop).toBe('function');
  });

  it('connects, emits events, tracks state, and exposes service methods', async () => {
    mockState.connectImpl = vi.fn(async () => undefined);
    mockState.callToolImpl = vi.fn(async (_config, toolName, args) => ({ ok: true, toolName, args }));
    mockState.listToolsImpl = vi.fn(async () => [{ name: 'tool.a' }]);

    await setupKernel();

    const connectedEvents = [];
    const callEvents = [];
    const resultEvents = [];
    kernel.events.on('mcp:connected', (evt) => connectedEvents.push(evt.payload));
    kernel.events.on('mcp:tool:call', (evt) => callEvents.push(evt.payload));
    kernel.events.on('mcp:tool:result', (evt) => resultEvents.push(evt.payload));

    const serverConfig = { name: 'local', url: 'http://localhost:1234', options: {} };
    const client = await kernel.services.call('mcp', 'connect', [serverConfig]);

    expect(client).toBe(mockState.constructedClients[0]);
    expect(mockState.connectImpl).toHaveBeenCalledTimes(1);
    expect(kernel.state.get('plugins.service/mcp.servers.local')).toEqual({ status: 'connected' });

    const fetchedClient = await kernel.services.call('mcp', 'getClient', ['local']);
    expect(fetchedClient).toBe(client);

    const tools = await kernel.services.call('mcp', 'listTools', ['local']);
    expect(tools).toEqual([{ name: 'tool.a' }]);

    const result = await kernel.services.call('mcp', 'callTool', ['local', 'search', { q: 'hi' }]);
    expect(result).toEqual({ ok: true, toolName: 'search', args: { q: 'hi' } });

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: ['local'], count: 1 });

    expect(connectedEvents).toEqual([{ server: 'local' }]);
    expect(callEvents).toEqual([{ server: 'local', tool: 'search' }]);
    expect(resultEvents).toEqual([{ server: 'local', tool: 'search', success: true }]);
  });

  it('returns empty results and errors for missing clients', async () => {
    await setupKernel();

    const tools = await kernel.services.call('mcp', 'listTools', ['missing']);
    expect(tools).toEqual([]);

    const missingClient = await kernel.services.call('mcp', 'getClient', ['missing']);
    expect(missingClient).toBeUndefined();

    await expect(kernel.services.call('mcp', 'callTool', ['missing', 'tool', {}]))
      .rejects.toThrow(/MCP server not connected/i);

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: [], count: 0 });
  });

  it('rejects invalid server configs and url values', async () => {
    await setupKernel();

    const invalidConfigs = [null, undefined, [], {}];
    for (const config of invalidConfigs) {
      await expect(kernel.services.call('mcp', 'connect', [config])).rejects.toThrow();
    }

    const invalidUrls = [null, undefined, '', 0, -1, Number.MAX_SAFE_INTEGER];
    for (const url of invalidUrls) {
      await expect(kernel.services.call('mcp', 'connect', [{ name: 'bad', url }]))
        .rejects.toThrow(/MCP server url must be a non-empty string/);
    }

    const invalidUrlStrings = ['   ', 'not-a-url'];
    for (const url of invalidUrlStrings) {
      await expect(kernel.services.call('mcp', 'connect', [{ name: 'bad', url }]))
        .rejects.toThrow(/Invalid MCP server url/);
    }

    await expect(kernel.services.call('mcp', 'connect', [{ name: 'bad', url: 'ftp://example.com' }]))
      .rejects.toThrow(/protocol not allowed/i);
  });

  it('rejects unsafe or non-string names', async () => {
    await setupKernel();

    const url = 'http://safe';
    const reservedNames = ['__proto__', 'constructor', 'prototype'];
    for (const name of reservedNames) {
      await expect(kernel.services.call('mcp', 'connect', [{ name, url }]))
        .rejects.toThrow(/reserved/);
    }

    const badNames = [-1, Number.MAX_SAFE_INTEGER, {}, []];
    for (const name of badNames) {
      await expect(kernel.services.call('mcp', 'connect', [{ name, url }]))
        .rejects.toThrow(/MCP server name must be a non-empty string/);
    }
  });

  it('falls back to url for falsy names and accepts whitespace', async () => {
    await setupKernel();

    const urlA = 'http://fallback-a';
    const clientA = await kernel.services.call('mcp', 'connect', [{ name: null, url: urlA }]);
    expect(await kernel.services.call('mcp', 'getClient', [urlA])).toBe(clientA);

    const urlB = 'http://fallback-b';
    const clientB = await kernel.services.call('mcp', 'connect', [{ name: undefined, url: urlB }]);
    expect(await kernel.services.call('mcp', 'getClient', [urlB])).toBe(clientB);

    const urlC = 'http://fallback-c';
    const clientC = await kernel.services.call('mcp', 'connect', [{ name: 0, url: urlC }]);
    expect(await kernel.services.call('mcp', 'getClient', [urlC])).toBe(clientC);

    const urlD = 'http://fallback-d';
    const clientD = await kernel.services.call('mcp', 'connect', [{ name: '', url: urlD }]);
    expect(await kernel.services.call('mcp', 'getClient', [urlD])).toBe(clientD);

    const whitespaceName = '   ';
    const clientE = await kernel.services.call('mcp', 'connect', [{ name: whitespaceName, url: 'http://space' }]);
    expect(await kernel.services.call('mcp', 'getClient', [whitespaceName])).toBe(clientE);
  });

  it('disconnectAll handles errors, updates state, and clears clients', async () => {
    mockState.disconnectImpl = vi.fn(async (config) => {
      if (config.name === 'bad') {
        throw new Error('boom');
      }
      return undefined;
    });

    await setupKernel();

    await kernel.services.call('mcp', 'connect', [{ name: 'good', url: 'http://good' }]);
    await kernel.services.call('mcp', 'connect', [{ name: 'bad', url: 'http://bad' }]);

    await kernel.services.call('mcp', 'disconnectAll', []);

    expect(mockState.disconnectImpl).toHaveBeenCalledTimes(2);
    expect(kernel.state.get('plugins.service/mcp.servers.good')).toEqual({ status: 'disconnected' });
    expect(kernel.state.get('plugins.service/mcp.servers.bad')).toEqual({ status: 'connected' });
    expect(console.warn).toHaveBeenCalledWith('[agent:service/mcp]', 'Failed to disconnect bad:', 'boom');

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status).toEqual({ connectedServers: [], count: 0 });
  });

  it('autoConnect tries configured servers and logs failures', async () => {
    mockState.connectImpl = vi.fn(async (config) => {
      if (config.name === 'bad') {
        throw new Error('nope');
      }
      return undefined;
    });

    await setupKernel({
      autoConnect: true,
      servers: [
        { name: 'good', url: 'http://good' },
        { name: 'bad', url: 'http://bad' },
      ],
    });

    expect(mockState.connectImpl).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith('[agent:service/mcp]', 'Auto-connect failed for bad:', 'nope');

    const status = await kernel.services.call('mcp', 'getStatus', []);
    expect(status.connectedServers).toContain('good');
    expect(status.connectedServers).not.toContain('bad');
    expect(status.count).toBe(1);
  });

  it('onStop triggers disconnectAll', async () => {
    mockState.disconnectImpl = vi.fn(async () => undefined);

    await setupKernel();

    await kernel.services.call('mcp', 'connect', [{ name: 'stop', url: 'http://stop' }]);
    await kernel.stop();

    expect(mockState.disconnectImpl).toHaveBeenCalledTimes(1);
    kernel = null;
  });

  it('passes boundary values, resource payloads, and supports concurrent calls', async () => {
    const callArgs = [];
    mockState.callToolImpl = vi.fn(async (_config, toolName, args) => {
      callArgs.push({ toolName, args });
      return { toolName, args };
    });

    await setupKernel();
    await kernel.services.call('mcp', 'connect', [{ name: 'edge', url: 'http://edge' }]);

    const deepObject = createDeepObject(12);
    const longString = 'x'.repeat(50000);
    const largeFile = new Uint8Array(1024 * 1024);
    const arrayLike = { 0: 'a', length: 1 };

    const [fastA, fastB] = await Promise.all([
      kernel.services.call('mcp', 'callTool', ['edge', 'fast', { seq: 1 }]),
      kernel.services.call('mcp', 'callTool', ['edge', 'fast', { seq: 2 }]),
    ]);

    expect(fastA.args).toEqual({ seq: 1 });
    expect(fastB.args).toEqual({ seq: 2 });

    const cases = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      arrayLike,
      longString,
      largeFile,
      deepObject,
    ];

    for (const args of cases) {
      const result = await kernel.services.call('mcp', 'callTool', ['edge', 'echo', args]);
      expect(result.args).toBe(args);
    }

    expect(mockState.callToolImpl).toHaveBeenCalledTimes(cases.length + 2);
    expect(callArgs.some((call) => call.args === '123')).toBe(true);
    expect(callArgs.some((call) => call.args === arrayLike)).toBe(true);
    expect(callArgs.some((call) => call.args === longString)).toBe(true);
    expect(callArgs.some((call) => call.args === largeFile)).toBe(true);
    expect(callArgs.some((call) => call.args === deepObject)).toBe(true);
  });
});
