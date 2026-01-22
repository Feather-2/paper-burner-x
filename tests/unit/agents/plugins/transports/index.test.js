import { describe, it, expect, vi, beforeEach } from 'vitest';

const modulePath = '../../../../../js/agents/plugins/transports/index.js';

const mockState = vi.hoisted(() => ({
  isNode: true,
  nodeImpl: {},
  browserImpl: {},
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  Platform: {
    get isNode() {
      return mockState.isNode;
    },
  },
}));

vi.mock('../../../../../js/agents/plugins/transports/index.node.js', async () => mockState.nodeImpl);
vi.mock('../../../../../js/agents/plugins/transports/index.browser.js', async () => mockState.browserImpl);

const expectedError = (name) => `${name} is not available in browser runtimes.`;

const createNodeImpl = () => {
  const state = {
    processInstances: [],
    binaryInstances: [],
    createProcessArgs: [],
    createBinaryArgs: [],
  };

  class ProcessTransport {
    constructor(...args) {
      this.args = args;
      state.processInstances.push(args);
    }
  }

  class BinarySkillProvider {
    constructor(...args) {
      this.args = args;
      state.binaryInstances.push(args);
    }
  }

  const createProcessTransport = (...args) => {
    state.createProcessArgs.push(args);
    return { kind: 'process', args };
  };
  createProcessTransport.mock = { calls: state.createProcessArgs };

  const createBinarySkillProvider = (...args) => {
    state.createBinaryArgs.push(args);
    return { kind: 'binary', args, id: state.createBinaryArgs.length };
  };
  createBinarySkillProvider.mock = { calls: state.createBinaryArgs };

  return {
    impl: {
      ProcessTransport,
      createProcessTransport,
      BinarySkillProvider,
      createBinarySkillProvider,
    },
    state,
  };
};

const createBrowserImpl = () => {
  const notSupported = (name) => {
    throw new Error(`${name} is not available in browser runtimes.`);
  };

  class ProcessTransport {
    constructor() {
      notSupported('ProcessTransport');
    }
  }

  const createProcessTransport = () => notSupported('createProcessTransport');

  class BinarySkillProvider {
    constructor() {
      notSupported('BinarySkillProvider');
    }
  }

  const createBinarySkillProvider = () => notSupported('createBinarySkillProvider');

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
};

const buildDeepNested = (depth) => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

const loadModule = async ({ isNode, nodeImpl, browserImpl }) => {
  mockState.isNode = isNode;
  mockState.nodeImpl = nodeImpl;
  mockState.browserImpl = browserImpl;
  vi.resetModules();
  return import(modulePath);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.isNode = true;
  mockState.nodeImpl = {};
  mockState.browserImpl = {};
});

describe('ProcessTransport', () => {
  it('uses the node implementation in normal cases', async () => {
    const { impl, state } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    expect(transports.ProcessTransport).toBe(impl.ProcessTransport);

    const options = { command: 'tool', args: ['--flag'], env: { PATH: '/usr/bin' } };
    const instance = new transports.ProcessTransport(options);

    expect(instance.args).toEqual([options]);
    expect(state.processInstances).toHaveLength(1);
  });

  it('passes empty and nullish constructor inputs through', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const inputs = [null, undefined, '', [], {}];

    for (const input of inputs) {
      const instance = new transports.ProcessTransport(input);
      expect(instance.args).toEqual([input]);
    }
  });

  it('throws from the browser implementation', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: false, nodeImpl: impl, browserImpl });

    expect(() => new transports.ProcessTransport()).toThrowError(
      expectedError('ProcessTransport'),
    );
  });
});

describe('createProcessTransport', () => {
  it('forwards standard arguments to the node implementation', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const options = { command: 'tool', args: ['--help'], cwd: '/tmp' };
    const result = transports.createProcessTransport(options);

    expect(impl.createProcessTransport).toHaveBeenCalledTimes(1);
    expect(impl.createProcessTransport).toHaveBeenCalledWith(options);
    expect(result).toEqual({ kind: 'process', args: [options] });
  });

  it('handles numeric and type boundary values', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const inputs = [0, -1, Number.MAX_SAFE_INTEGER, '42', { 0: 'value', length: 1 }];
    const results = inputs.map((input) => transports.createProcessTransport(input));

    expect(impl.createProcessTransport).toHaveBeenCalledTimes(inputs.length);

    inputs.forEach((input, index) => {
      expect(impl.createProcessTransport).toHaveBeenNthCalledWith(index + 1, input);
      expect(results[index]).toEqual({ kind: 'process', args: [input] });
    });
  });

  it('throws from the browser implementation', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: false, nodeImpl: impl, browserImpl });

    expect(() => transports.createProcessTransport('cmd')).toThrowError(
      expectedError('createProcessTransport'),
    );
  });
});

describe('BinarySkillProvider', () => {
  it('uses the node implementation in normal cases', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    expect(transports.BinarySkillProvider).toBe(impl.BinarySkillProvider);

    const config = { name: 'skill', args: ['--flag'] };
    const instance = new transports.BinarySkillProvider(config, 'meta');

    expect(instance.args).toEqual([config, 'meta']);
  });

  it('passes resource boundary inputs through', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const longString = 'a'.repeat(100000);
    const largeBinary = new Uint8Array(5 * 1024 * 1024);
    const deepNested = buildDeepNested(64);
    const inputs = ['   ', longString, largeBinary, deepNested];

    for (const input of inputs) {
      const instance = new transports.BinarySkillProvider(input);
      expect(instance.args).toEqual([input]);
    }
  });

  it('throws from the browser implementation', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: false, nodeImpl: impl, browserImpl });

    expect(() => new transports.BinarySkillProvider()).toThrowError(
      expectedError('BinarySkillProvider'),
    );
  });
});

describe('createBinarySkillProvider', () => {
  it('forwards standard arguments to the node implementation', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const options = { name: 'alpha', command: 'tool' };
    const result = transports.createBinarySkillProvider(options);

    expect(impl.createBinarySkillProvider).toHaveBeenCalledTimes(1);
    expect(impl.createBinarySkillProvider).toHaveBeenCalledWith(options);
    expect(result).toEqual({ kind: 'binary', args: [options], id: 1 });
  });

  it('handles concurrent calls', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        Promise.resolve(transports.createBinarySkillProvider(`call-${index}`)),
      ),
    );

    expect(impl.createBinarySkillProvider).toHaveBeenCalledTimes(5);
    expect(results.map((result) => result.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles rapid successive calls', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const results = [];

    for (let i = 0; i < 3; i += 1) {
      results.push(transports.createBinarySkillProvider(`fast-${i}`));
    }

    expect(impl.createBinarySkillProvider).toHaveBeenCalledTimes(3);
    expect(impl.createBinarySkillProvider).toHaveBeenNthCalledWith(1, 'fast-0');
    expect(impl.createBinarySkillProvider).toHaveBeenNthCalledWith(2, 'fast-1');
    expect(impl.createBinarySkillProvider).toHaveBeenNthCalledWith(3, 'fast-2');
    expect(results.map((result) => result.id)).toEqual([1, 2, 3]);
  });

  it('throws from the browser implementation', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: false, nodeImpl: impl, browserImpl });

    expect(() => transports.createBinarySkillProvider()).toThrowError(
      expectedError('createBinarySkillProvider'),
    );
  });
});

describe('default export', () => {
  it('exposes node members consistently', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    expect(transports.default.ProcessTransport).toBe(transports.ProcessTransport);
    expect(transports.default.createProcessTransport).toBe(transports.createProcessTransport);
    expect(transports.default.BinarySkillProvider).toBe(transports.BinarySkillProvider);
    expect(transports.default.createBinarySkillProvider).toBe(transports.createBinarySkillProvider);
    expect(transports.default.ProcessTransport).toBe(impl.ProcessTransport);
  });

  it('forwards boundary inputs through default references', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: true, nodeImpl: impl, browserImpl });

    const instance = new transports.default.ProcessTransport('');
    const result = transports.default.createProcessTransport([]);

    expect(instance.args).toEqual(['']);
    expect(result).toEqual({ kind: 'process', args: [[]] });
  });

  it('throws from default browser stubs', async () => {
    const { impl } = createNodeImpl();
    const browserImpl = createBrowserImpl();
    const transports = await loadModule({ isNode: false, nodeImpl: impl, browserImpl });

    expect(() => transports.default.createBinarySkillProvider()).toThrowError(
      expectedError('createBinarySkillProvider'),
    );
  });
});
