import { describe, it, expect, vi, beforeEach } from 'vitest';

const modulePath = '../../../../../js/agents/plugins/transports/index.js';

const platformState = vi.hoisted(() => ({
  isNode: true,
}));

const loadState = vi.hoisted(() => ({
  throwNodeImport: false,
  throwBrowserImport: false,
  nodeImportError: new Error('index.node.js import failed'),
  browserImportError: new Error('index.browser.js import failed'),
}));

const nodeMock = vi.hoisted(() => {
  const state = {
    processCtorCalls: [],
    binaryCtorCalls: [],
  };

  class ProcessTransport {
    constructor(...args) {
      state.processCtorCalls.push(args);
      this.args = args;
    }
  }

  class BinarySkillProvider {
    constructor(...args) {
      state.binaryCtorCalls.push(args);
      this.args = args;
    }
  }

  const createProcessTransport = vi.fn((...args) => ({
    impl: 'node',
    kind: 'process',
    args,
  }));

  const createBinarySkillProvider = vi.fn((...args) => ({
    impl: 'node',
    kind: 'binary',
    args,
  }));

  return {
    state,
    ProcessTransport,
    createProcessTransport,
    BinarySkillProvider,
    createBinarySkillProvider,
  };
});

const browserMock = vi.hoisted(() => {
  const notSupported = (name) => {
    throw new Error(`${name} is not available in browser runtimes.`);
  };

  class ProcessTransport {
    constructor() {
      notSupported('ProcessTransport');
    }
  }

  const createProcessTransport = vi.fn(() => notSupported('createProcessTransport'));

  class BinarySkillProvider {
    constructor() {
      notSupported('BinarySkillProvider');
    }
  }

  const createBinarySkillProvider = vi.fn(() => notSupported('createBinarySkillProvider'));

  const defaultExport = {
    ProcessTransport,
    createProcessTransport,
    BinarySkillProvider,
    createBinarySkillProvider,
  };

  return {
    ProcessTransport,
    createProcessTransport,
    BinarySkillProvider,
    createBinarySkillProvider,
    default: defaultExport,
  };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  Platform: platformState,
}));

vi.mock('../../../../../js/agents/plugins/transports/index.node.js', () => {
  if (loadState.throwNodeImport) throw loadState.nodeImportError;
  return {
    ProcessTransport: nodeMock.ProcessTransport,
    createProcessTransport: nodeMock.createProcessTransport,
    BinarySkillProvider: nodeMock.BinarySkillProvider,
    createBinarySkillProvider: nodeMock.createBinarySkillProvider,
  };
});

vi.mock('../../../../../js/agents/plugins/transports/index.browser.js', () => {
  if (loadState.throwBrowserImport) throw loadState.browserImportError;
  return {
    ProcessTransport: browserMock.ProcessTransport,
    createProcessTransport: browserMock.createProcessTransport,
    BinarySkillProvider: browserMock.BinarySkillProvider,
    createBinarySkillProvider: browserMock.createBinarySkillProvider,
    default: browserMock.default,
  };
});

function buildDeepNested(depth) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

async function loadTransports() {
  vi.resetModules();
  return await import(modulePath);
}

beforeEach(() => {
  vi.clearAllMocks();
  platformState.isNode = true;
  loadState.throwNodeImport = false;
  loadState.throwBrowserImport = false;
  nodeMock.state.processCtorCalls.length = 0;
  nodeMock.state.binaryCtorCalls.length = 0;
});

describe('ProcessTransport', () => {
  it('exports the node implementation in normal cases', async () => {
    platformState.isNode = true;
    const transports = await loadTransports();

    expect(transports.ProcessTransport).toBe(nodeMock.ProcessTransport);

    const options = { command: 'tool', args: ['--flag'], env: { PATH: '/usr/bin' } };
    const instance = new transports.ProcessTransport(options);

    expect(instance.args).toEqual([options]);
    expect(nodeMock.state.processCtorCalls).toEqual([[options]]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
  ])('forwards %s constructor input without modification', async (_label, input) => {
    platformState.isNode = true;
    const { ProcessTransport } = await loadTransports();

    const instance = new ProcessTransport(input);

    expect(instance.args).toEqual([input]);
  });

  it('throws from the browser implementation', async () => {
    platformState.isNode = false;
    const { ProcessTransport } = await loadTransports();

    expect(() => new ProcessTransport()).toThrowError(
      'ProcessTransport is not available in browser runtimes.',
    );
  });
});

describe('createProcessTransport', () => {
  it('forwards standard arguments to the node implementation', async () => {
    platformState.isNode = true;
    const transports = await loadTransports();

    const options = { command: 'tool', args: ['--help'], cwd: '/tmp' };
    const result = transports.createProcessTransport(options);

    expect(nodeMock.createProcessTransport).toHaveBeenCalledTimes(1);
    expect(nodeMock.createProcessTransport).toHaveBeenCalledWith(options);
    expect(result).toEqual({ impl: 'node', kind: 'process', args: [options] });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
    ['zero', 0],
    ['negative one', -1],
    ['max safe integer', Number.MAX_SAFE_INTEGER],
    ['whitespace string', '   '],
    ['numeric string (string as number)', '42'],
    ['array-like object (object as array)', { 0: 'value', length: 1 }],
  ])('handles boundary input: %s', async (_label, input) => {
    platformState.isNode = true;
    const transports = await loadTransports();

    transports.createProcessTransport(input);

    expect(nodeMock.createProcessTransport).toHaveBeenCalledTimes(1);
    expect(nodeMock.createProcessTransport).toHaveBeenCalledWith(input);
  });

  it('propagates node implementation errors', async () => {
    platformState.isNode = true;
    const error = new Error('node createProcessTransport failed');
    nodeMock.createProcessTransport.mockImplementationOnce(() => {
      throw error;
    });
    const { createProcessTransport } = await loadTransports();

    expect(() => createProcessTransport({})).toThrow('node createProcessTransport failed');
  });

  it('handles concurrent calls', async () => {
    platformState.isNode = true;
    const { createProcessTransport } = await loadTransports();

    const inputs = Array.from({ length: 5 }, (_, index) => ({ index }));
    const results = await Promise.all(
      inputs.map((input) => Promise.resolve(createProcessTransport(input))),
    );

    expect(nodeMock.createProcessTransport).toHaveBeenCalledTimes(5);
    expect(results.map((result) => result.args[0])).toEqual(inputs);
  });

  it('handles rapid successive calls', async () => {
    platformState.isNode = true;
    const { createProcessTransport } = await loadTransports();

    for (let i = 0; i < 3; i += 1) {
      createProcessTransport(`fast-${i}`);
    }

    expect(nodeMock.createProcessTransport).toHaveBeenCalledTimes(3);
    expect(nodeMock.createProcessTransport.mock.calls.map((call) => call[0])).toEqual([
      'fast-0',
      'fast-1',
      'fast-2',
    ]);
  });

  it('throws from the browser implementation', async () => {
    platformState.isNode = false;
    const transports = await loadTransports();

    expect(() => transports.createProcessTransport('cmd')).toThrowError(
      'createProcessTransport is not available in browser runtimes.',
    );
    expect(browserMock.createProcessTransport).toHaveBeenCalledTimes(1);
  });
});

describe('BinarySkillProvider', () => {
  it('exports the node implementation in normal cases', async () => {
    platformState.isNode = true;
    const transports = await loadTransports();

    expect(transports.BinarySkillProvider).toBe(nodeMock.BinarySkillProvider);

    const config = { name: 'skill', args: ['--flag'] };
    const instance = new transports.BinarySkillProvider(config, 'meta');

    expect(instance.args).toEqual([config, 'meta']);
    expect(nodeMock.state.binaryCtorCalls).toEqual([[config, 'meta']]);
  });

  it('passes resource-boundary inputs through', async () => {
    platformState.isNode = true;
    const { BinarySkillProvider } = await loadTransports();

    const emptyValues = [null, undefined, '', [], {}];
    const longString = 'x'.repeat(200_000);
    const largeFileLike = new Uint8Array(1024 * 1024);
    const deepNested = buildDeepNested(50);
    const inputs = [...emptyValues, '   ', longString, largeFileLike, deepNested];

    for (const input of inputs) {
      const instance = new BinarySkillProvider(input);
      expect(instance.args).toEqual([input]);
    }
  });

  it('throws from the browser implementation', async () => {
    platformState.isNode = false;
    const { BinarySkillProvider } = await loadTransports();

    expect(() => new BinarySkillProvider()).toThrowError(
      'BinarySkillProvider is not available in browser runtimes.',
    );
  });
});

describe('createBinarySkillProvider', () => {
  it('forwards standard arguments to the node implementation', async () => {
    platformState.isNode = true;
    const transports = await loadTransports();

    const options = { name: 'alpha', command: 'tool' };
    const result = transports.createBinarySkillProvider(options);

    expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledTimes(1);
    expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledWith(options);
    expect(result).toEqual({ impl: 'node', kind: 'binary', args: [options] });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
    ['zero', 0],
    ['negative one', -1],
    ['max safe integer', Number.MAX_SAFE_INTEGER],
    ['whitespace string', '   '],
    ['numeric string (string as number)', '123'],
    ['array-like object (object as array)', { 0: 'x', length: 1 }],
  ])('handles boundary input: %s', async (_label, input) => {
    platformState.isNode = true;
    const transports = await loadTransports();

    transports.createBinarySkillProvider(input);

    expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledTimes(1);
    expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledWith(input);
  });

  it('propagates node implementation errors', async () => {
    platformState.isNode = true;
    const error = new Error('node createBinarySkillProvider failed');
    nodeMock.createBinarySkillProvider.mockImplementationOnce(() => {
      throw error;
    });
    const { createBinarySkillProvider } = await loadTransports();

    expect(() => createBinarySkillProvider({})).toThrow('node createBinarySkillProvider failed');
  });

  it('handles concurrent calls', async () => {
    platformState.isNode = true;
    const { createBinarySkillProvider } = await loadTransports();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        Promise.resolve(createBinarySkillProvider(`call-${index}`)),
      ),
    );

    expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledTimes(5);
    expect(results.map((result) => result.args[0])).toEqual([
      'call-0',
      'call-1',
      'call-2',
      'call-3',
      'call-4',
    ]);
  });

  it('handles rapid successive calls', async () => {
    platformState.isNode = true;
    const { createBinarySkillProvider } = await loadTransports();

    for (let i = 0; i < 3; i += 1) {
      createBinarySkillProvider(`fast-${i}`);
    }

    expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledTimes(3);
    expect(nodeMock.createBinarySkillProvider.mock.calls.map((call) => call[0])).toEqual([
      'fast-0',
      'fast-1',
      'fast-2',
    ]);
  });

  it('throws from the browser implementation', async () => {
    platformState.isNode = false;
    const transports = await loadTransports();

    expect(() => transports.createBinarySkillProvider()).toThrowError(
      'createBinarySkillProvider is not available in browser runtimes.',
    );
    expect(browserMock.createBinarySkillProvider).toHaveBeenCalledTimes(1);
  });
});

describe('default export', () => {
  it('is the selected implementation module namespace (node)', async () => {
    platformState.isNode = true;
    const transports = await loadTransports();
    const implNamespace = await import(
      '../../../../../js/agents/plugins/transports/index.node.js'
    );

    expect(transports.default).toBe(implNamespace);
    expect(transports.default.ProcessTransport).toBe(transports.ProcessTransport);
    expect(transports.default.createProcessTransport).toBe(transports.createProcessTransport);
    expect(transports.default.BinarySkillProvider).toBe(transports.BinarySkillProvider);
    expect(transports.default.createBinarySkillProvider).toBe(transports.createBinarySkillProvider);
  });

  it('is the selected implementation module namespace (browser)', async () => {
    platformState.isNode = false;
    const transports = await loadTransports();
    const implNamespace = await import(
      '../../../../../js/agents/plugins/transports/index.browser.js'
    );

    expect(transports.default).toBe(implNamespace);
    expect(transports.default.ProcessTransport).toBe(transports.ProcessTransport);
    expect(transports.default.createProcessTransport).toBe(transports.createProcessTransport);
    expect(transports.default.BinarySkillProvider).toBe(transports.BinarySkillProvider);
    expect(transports.default.createBinarySkillProvider).toBe(transports.createBinarySkillProvider);
  });

  it('selects implementation based on Platform.isNode truthiness boundaries', async () => {
    const falseyValues = [null, undefined, '', 0];
    const truthyValues = [-1, Number.MAX_SAFE_INTEGER, '0', '   ', [], {}];

    for (const value of falseyValues) {
      platformState.isNode = value;
      const transports = await loadTransports();
      expect(transports.ProcessTransport).toBe(browserMock.ProcessTransport);
    }

    for (const value of truthyValues) {
      platformState.isNode = value;
      const transports = await loadTransports();
      expect(transports.ProcessTransport).toBe(nodeMock.ProcessTransport);
    }
  });

  it('rejects module import when Platform.isNode access throws', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(platformState, 'isNode');
    Object.defineProperty(platformState, 'isNode', {
      configurable: true,
      get() {
        throw new Error('Platform.isNode access failed');
      },
    });

    try {
      await expect(loadTransports()).rejects.toThrow('Platform.isNode access failed');
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(platformState, 'isNode', originalDescriptor);
      } else {
        // Restore to a normal data property for subsequent tests.
        delete platformState.isNode;
        platformState.isNode = true;
      }
    }
  });
});
