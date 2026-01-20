import { describe, it, expect, vi, beforeEach } from 'vitest';

const modulePath = '../../../../js/agents/mcp/stdio-mcp-provider.js';

const transportMocks = vi.hoisted(() => ({
  instances: [],
  connectImpl: null,
  disconnectImpl: null,
  isConnectedImpl: null,
  listToolsImpl: null,
  callToolImpl: null,
  serverInfo: { name: 'mock-server' },
  capabilities: { protocol: 'mock' },
}));

vi.mock('../../../../js/agents/mcp/stdio-mcp-transport.js', () => {
  class StdioMcpTransport {
    constructor(options) {
      this.options = options;
      this.serverInfo = transportMocks.serverInfo;
      this.capabilities = transportMocks.capabilities;
      this._connected = false;

      this.connect = vi.fn(async () => {
        if (transportMocks.connectImpl) {
          await transportMocks.connectImpl(this);
          return;
        }
        this._connected = true;
      });

      this.disconnect = vi.fn(async () => {
        if (transportMocks.disconnectImpl) {
          await transportMocks.disconnectImpl(this);
          return;
        }
        this._connected = false;
      });

      this.isConnected = vi.fn(() => {
        if (transportMocks.isConnectedImpl) {
          return transportMocks.isConnectedImpl(this);
        }
        return this._connected;
      });

      this.listTools = vi.fn(async () => {
        if (transportMocks.listToolsImpl) {
          return transportMocks.listToolsImpl(this);
        }
        return [];
      });

      this.callTool = vi.fn(async (name, args) => {
        if (transportMocks.callToolImpl) {
          return transportMocks.callToolImpl(this, name, args);
        }
        return { content: [] };
      });

      transportMocks.instances.push(this);
    }
  }

  return { StdioMcpTransport };
});

vi.mock('../../../../js/agents/mcp/mcp-client.js', () => {
  class McpProvider {
    constructor({ id, name, endpoint }) {
      this.id = id;
      this.name = name;
      this.endpoint = endpoint;
    }
  }

  class McpToolDefinition {
    constructor(payload) {
      Object.assign(this, payload);
    }
  }

  class McpToolResult {
    constructor(payload) {
      Object.assign(this, payload);
    }
  }

  return { McpProvider, McpToolDefinition, McpToolResult };
});

vi.mock('../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  },
}));

let StdioMcpProvider;
let createStdioMcpProvider;
let McpToolDefinition;
let McpToolResult;

const createProvider = (options = {}) => {
  const command = options.command ?? 'mock-cmd';
  const hasAllowed = Object.prototype.hasOwnProperty.call(options, 'allowedCommands');
  const allowedCommands = hasAllowed ? options.allowedCommands : [command];
  return new StdioMcpProvider({ command, allowedCommands, ...options });
};

beforeEach(async () => {
  vi.clearAllMocks();
  transportMocks.instances = [];
  transportMocks.connectImpl = null;
  transportMocks.disconnectImpl = null;
  transportMocks.isConnectedImpl = null;
  transportMocks.listToolsImpl = null;
  transportMocks.callToolImpl = null;
  transportMocks.serverInfo = { name: 'mock-server' };
  transportMocks.capabilities = { protocol: 'mock' };

  ({ StdioMcpProvider, createStdioMcpProvider } = await import(modulePath));
  ({ McpToolDefinition, McpToolResult } = await import('../../../../js/agents/mcp/mcp-client.js'));
});

describe('StdioMcpProvider', () => {
  it('throws when options is null or undefined', () => {
    expect(() => new StdioMcpProvider()).toThrow();
    expect(() => new StdioMcpProvider(null)).toThrow();
  });

  it('throws when command is missing or blank', () => {
    const values = [undefined, null, '', '   '];
    values.forEach((value) => {
      expect(() => new StdioMcpProvider({ command: value, allowUnsafeCommand: true })).toThrow(
        'StdioMcpProvider: command is required'
      );
    });
  });

  it('requires allowlist unless unsafe is allowed', () => {
    expect(() => new StdioMcpProvider({ command: 'cmd' })).toThrow(
      'StdioMcpProvider: command not allowed without allowlist or allowUnsafeCommand'
    );
    expect(() => new StdioMcpProvider({ command: 'cmd', allowedCommands: [] })).toThrow(
      'StdioMcpProvider: command not allowed without allowlist or allowUnsafeCommand'
    );
    expect(() => new StdioMcpProvider({ command: 'cmd', allowedCommands: {} })).toThrow(
      'StdioMcpProvider: command not allowed without allowlist or allowUnsafeCommand'
    );
  });

  it('rejects commands outside allowlist', () => {
    expect(() => new StdioMcpProvider({ command: 'cmd', allowedCommands: ['other'] })).toThrow(
      'StdioMcpProvider: command is not in allowedCommands'
    );
  });

  it('accepts allowUnsafeCommand flags', () => {
    const provider = new StdioMcpProvider({ command: 'cmd', allowUnsafeCommand: true });
    const providerAlias = new StdioMcpProvider({ command: 'cmd', allowUnsafeCommands: true });

    expect(provider.command).toBe('cmd');
    expect(providerAlias.command).toBe('cmd');
  });

  it('applies id/name defaults and trims input', () => {
    const provider = createProvider({ id: '  custom-id  ' });
    const namedProvider = createProvider({ id: 'id', name: '  Name  ' });
    const defaultedProvider = createProvider({ id: '   ', name: ' ' });

    expect(provider.id).toBe('custom-id');
    expect(provider.name).toBe('custom-id');
    expect(namedProvider.id).toBe('id');
    expect(namedProvider.name).toBe('Name');
    expect(defaultedProvider.id).toBe('stdio-mcp');
    expect(defaultedProvider.name).toBe('stdio-mcp');
  });

  it('stores options and preserves type boundaries', () => {
    const argsObject = { not: 'array' };
    const deepEnv = { nested: { level: { value: 'x' } } };

    const provider = createProvider({
      args: argsObject,
      env: deepEnv,
      cwd: '',
      timeout: '5000',
      autoConnect: false,
      lazyConnect: true,
    });

    expect(provider.args).toBe(argsObject);
    expect(provider.env).toBe(deepEnv);
    expect(provider.cwd).toBe('');
    expect(provider.timeout).toBe('5000');
    expect(provider.autoConnect).toBe(false);
    expect(provider.lazyConnect).toBe(true);
  });

  it('accepts boundary timeout values', () => {
    const values = [0, -1, Number.MAX_SAFE_INTEGER];
    values.forEach((value) => {
      const provider = createProvider({ timeout: value });
      expect(provider.timeout).toBe(value);
    });
  });

  it('supports long command strings and ignores empty allowlist entries', () => {
    const longCommand = `cmd-${'x'.repeat(10000)}`;
    const provider = new StdioMcpProvider({
      command: longCommand,
      allowedCommands: [' ', '', longCommand, null],
    });

    expect(provider.command).toBe(longCommand);
  });

  it('connect creates transport with expected options', async () => {
    const env = { KEY: 'VALUE' };
    const provider = createProvider({
      args: ['--flag'],
      env,
      cwd: '/tmp',
      timeout: 1234,
    });

    await provider.connect();

    expect(transportMocks.instances).toHaveLength(1);
    const transport = transportMocks.instances[0];
    expect(transport.options).toEqual({
      command: 'mock-cmd',
      args: ['--flag'],
      env,
      cwd: '/tmp',
      timeout: 1234,
      autoInit: true,
    });
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });

  it('connect is idempotent when already connected', async () => {
    const provider = createProvider();

    await provider.connect();
    await provider.connect();

    expect(transportMocks.instances).toHaveLength(1);
    expect(transportMocks.instances[0].connect).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent connect calls', async () => {
    let resolveConnect;
    const connectPromise = new Promise((resolve) => {
      resolveConnect = resolve;
    });

    transportMocks.connectImpl = (instance) =>
      connectPromise.then(() => {
        instance._connected = true;
      });

    const provider = createProvider();
    const first = provider.connect();
    const second = provider.connect();

    expect(transportMocks.instances).toHaveLength(1);
    expect(transportMocks.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(provider._connectPromise).not.toBeNull();

    resolveConnect();
    await Promise.all([first, second]);
    expect(provider._connectPromise).toBeNull();
  });

  it('reports connection status and server info', async () => {
    const provider = createProvider();

    expect(provider.isConnected()).toBe(false);
    expect(provider.getServerInfo()).toBeNull();
    expect(provider.getCapabilities()).toBeNull();

    await provider.connect();

    expect(provider.isConnected()).toBe(true);
    expect(provider.getServerInfo()).toEqual({ name: 'mock-server' });
    expect(provider.getCapabilities()).toEqual({ protocol: 'mock' });
  });

  it('disconnects and clears cache', async () => {
    transportMocks.listToolsImpl = () => [
      { name: 'tool', description: 'd', inputSchema: { type: 'object' } },
    ];
    const provider = createProvider();

    await provider.listTools();

    const transport = transportMocks.instances[0];
    expect(provider._toolsCache).toHaveLength(1);

    await provider.disconnect();

    expect(transport.disconnect).toHaveBeenCalledTimes(1);
    expect(provider._transport).toBeNull();
    expect(provider._toolsCache).toBeNull();
  });

  it('lists tools and caches definitions', async () => {
    const rawTools = [
      { name: 'alpha', description: 'Alpha', inputSchema: { type: 'object' } },
      { name: 'beta', description: '', inputSchema: null },
    ];
    transportMocks.listToolsImpl = () => rawTools;

    const provider = createProvider();
    const first = await provider.listTools();
    const transport = transportMocks.instances[0];

    expect(first).toHaveLength(2);
    expect(first[0]).toBeInstanceOf(McpToolDefinition);
    expect(first[0]).toMatchObject({
      name: 'alpha',
      description: 'Alpha',
      inputSchema: { type: 'object' },
    });
    expect(transport.listTools).toHaveBeenCalledTimes(1);

    const second = await provider.listTools();

    expect(transport.listTools).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
  });

  it('returns error results for invalid tool names', async () => {
    const provider = createProvider();
    const invalidNames = [null, undefined, '', '   '];

    for (const name of invalidNames) {
      const result = await provider.callTool(name, { foo: 'bar' });

      expect(result).toBeInstanceOf(McpToolResult);
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toBe('Tool name is required');
    }

    const transport = transportMocks.instances[0];
    expect(transport.callTool).not.toHaveBeenCalled();
  });

  it('wraps tool error responses', async () => {
    transportMocks.callToolImpl = () => ({
      isError: true,
      content: [{ type: 'text', text: 'bad request' }],
    });

    const provider = createProvider();
    const result = await provider.callTool('badTool', {});

    expect(result).toBeInstanceOf(McpToolResult);
    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.error).toBe('bad request');
    expect(result.content).toEqual([{ type: 'text', text: 'bad request' }]);
  });

  it('returns error results when transport throws', async () => {
    transportMocks.callToolImpl = () => {
      throw new Error('boom');
    };

    const provider = createProvider();
    const result = await provider.callTool('tool', {});

    expect(result).toBeInstanceOf(McpToolResult);
    expect(result.success).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.error).toBe('boom');
    expect(result.content).toEqual([{ type: 'text', text: 'Error: boom' }]);
  });

  it('forwards args and returns success for tool calls', async () => {
    const hugeContent = 'a'.repeat(120000);
    const args = {
      file: { name: 'big.txt', content: hugeContent },
      nested: { level1: { level2: { level3: { value: 'deep' } } } },
    };

    transportMocks.callToolImpl = () => ({
      content: [{ type: 'text', text: 'ok' }],
    });

    const provider = createProvider();
    const result = await provider.callTool(0, args);

    const transport = transportMocks.instances[0];
    expect(transport.callTool).toHaveBeenCalledWith('0', args);
    expect(result).toBeInstanceOf(McpToolResult);
    expect(result.success).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('returns ok status and tool count on healthCheck', async () => {
    transportMocks.listToolsImpl = () => [
      { name: 't1', description: 'A', inputSchema: {} },
      { name: 't2', description: 'B', inputSchema: {} },
    ];

    const provider = createProvider();
    const result = await provider.healthCheck();

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe(provider.id);
    expect(result.toolCount).toBe(2);
    expect(result.serverInfo).toEqual({ name: 'mock-server' });
    expect(result.ts).toEqual(expect.any(String));
  });

  it('refreshes tools during healthCheck when requested', async () => {
    transportMocks.listToolsImpl = () => [{ name: 't1', description: '', inputSchema: {} }];

    const provider = createProvider();
    await provider.listTools();
    const transport = transportMocks.instances[0];

    transportMocks.listToolsImpl = () => [{ name: 't2', description: '', inputSchema: {} }];
    const result = await provider.healthCheck({ refreshTools: true });

    expect(transport.listTools).toHaveBeenCalledTimes(2);
    expect(result.toolCount).toBe(1);
    expect(provider._toolsCache[0].name).toBe('t2');
  });

  it('returns error status on healthCheck failure', async () => {
    transportMocks.listToolsImpl = () => {
      throw new Error('down');
    };

    const provider = createProvider();
    const result = await provider.healthCheck();

    expect(result.ok).toBe(false);
    expect(result.providerId).toBe(provider.id);
    expect(result.error).toBe('down');
    expect(result.ts).toEqual(expect.any(String));
  });

  it('refreshTools clears cache and reloads tools', async () => {
    transportMocks.listToolsImpl = () => [{ name: 't1', description: '', inputSchema: {} }];

    const provider = createProvider();
    await provider.listTools();
    const transport = transportMocks.instances[0];

    transportMocks.listToolsImpl = () => [{ name: 't2', description: '', inputSchema: {} }];
    const refreshed = await provider.refreshTools();

    expect(transport.listTools).toHaveBeenCalledTimes(2);
    expect(refreshed[0].name).toBe('t2');
  });
});

describe('createStdioMcpProvider', () => {
  it('creates a StdioMcpProvider instance', () => {
    const provider = createStdioMcpProvider({ command: 'cmd', allowUnsafeCommand: true });

    expect(provider).toBeInstanceOf(StdioMcpProvider);
    expect(provider.command).toBe('cmd');
  });
});
