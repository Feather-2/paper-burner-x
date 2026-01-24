import { describe, it, expect, vi, beforeEach } from 'vitest';

const modulePath = '../../../../../js/agents/plugins/transports/index.js';

// Mutable hoisted state used by mocks. This lets each test control the branch
// (node vs browser) and simulate import failures without importing real modules.
const platformState = vi.hoisted(() => ({ isNode: true }));
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
      if (args[0] === '__throw__') throw new Error('node ProcessTransport constructor failed');
      this.args = args;
    }
  }

  class BinarySkillProvider {
    constructor(...args) {
      state.binaryCtorCalls.push(args);
      if (args[0] === '__throw__') throw new Error('node BinarySkillProvider constructor failed');
      this.args = args;
    }
  }

  const createProcessTransport = vi.fn((...args) => ({ impl: 'node', kind: 'process', args }));
  const createBinarySkillProvider = vi.fn((...args) => ({ impl: 'node', kind: 'binary', args }));

  return {
    state,
    ProcessTransport,
    createProcessTransport,
    BinarySkillProvider,
    createBinarySkillProvider,
  };
});

const browserMock = vi.hoisted(() => {
  const state = {
    processCtorCalls: [],
    binaryCtorCalls: [],
  };

  class ProcessTransport {
    constructor(...args) {
      state.processCtorCalls.push(args);
      if (args[0] === '__throw__') throw new Error('browser ProcessTransport constructor failed');
      this.args = args;
    }
  }

  class BinarySkillProvider {
    constructor(...args) {
      state.binaryCtorCalls.push(args);
      if (args[0] === '__throw__') throw new Error('browser BinarySkillProvider constructor failed');
      this.args = args;
    }
  }

  const createProcessTransport = vi.fn((...args) => ({ impl: 'browser', kind: 'process', args }));
  const createBinarySkillProvider = vi.fn((...args) => ({ impl: 'browser', kind: 'binary', args }));

  return {
    state,
    ProcessTransport,
    createProcessTransport,
    BinarySkillProvider,
    createBinarySkillProvider,
    default: {
      ProcessTransport,
      createProcessTransport,
      BinarySkillProvider,
      createBinarySkillProvider,
    },
  };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({ Platform: platformState }));

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

async function importTransports() {
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
  browserMock.state.processCtorCalls.length = 0;
  browserMock.state.binaryCtorCalls.length = 0;
});

describe('plugins/transports/index.js exports', () => {
  describe('ProcessTransport', () => {
    it('should_export_node_ProcessTransport_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.ProcessTransport).toBe(nodeMock.ProcessTransport);
    });

    it('should_export_browser_ProcessTransport_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.ProcessTransport).toBe(browserMock.ProcessTransport);
    });

    it('should_forward_constructor_args_to_node_ProcessTransport_when_constructed', async () => {
      platformState.isNode = true;
      const { ProcessTransport } = await importTransports();
      const options = { command: 'tool', args: ['--flag'] };

      new ProcessTransport(options);

      expect(nodeMock.state.processCtorCalls[0]).toEqual([options]);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['empty array', []],
      ['empty object', {}],
    ])('should_forward_constructor_args_to_node_ProcessTransport_when_input_is_%s', async (_label, input) => {
      platformState.isNode = true;
      const { ProcessTransport } = await importTransports();

      new ProcessTransport(input);

      expect(nodeMock.state.processCtorCalls[0]).toEqual([input]);
    });

    it('should_throw_when_node_ProcessTransport_constructor_throws', async () => {
      platformState.isNode = true;
      const { ProcessTransport } = await importTransports();

      expect(() => new ProcessTransport('__throw__')).toThrow('node ProcessTransport constructor failed');
    });

    it('should_throw_when_browser_ProcessTransport_constructor_throws', async () => {
      platformState.isNode = false;
      const { ProcessTransport } = await importTransports();

      expect(() => new ProcessTransport('__throw__')).toThrow('browser ProcessTransport constructor failed');
    });
  });

  describe('createProcessTransport', () => {
    it('should_export_node_createProcessTransport_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.createProcessTransport).toBe(nodeMock.createProcessTransport);
    });

    it('should_export_browser_createProcessTransport_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.createProcessTransport).toBe(browserMock.createProcessTransport);
    });

    it('should_call_node_createProcessTransport_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      const options = { command: 'tool', cwd: '/tmp' };

      createProcessTransport(options);

      expect(nodeMock.createProcessTransport).toHaveBeenCalledWith(options);
    });

    it('should_return_value_from_node_createProcessTransport_when_impl_returns_value', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      const output = { ok: true };
      nodeMock.createProcessTransport.mockReturnValueOnce(output);

      const result = createProcessTransport({ command: 'x' });

      expect(result).toBe(output);
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
      ['numeric string', '42'],
      ['array-like object', { 0: 'value', length: 1 }],
    ])('should_forward_boundary_input_to_node_createProcessTransport_when_input_is_%s', async (_label, input) => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();

      createProcessTransport(input);

      expect(nodeMock.createProcessTransport).toHaveBeenCalledWith(input);
    });

    it('should_forward_resource_boundary_input_to_node_createProcessTransport_when_input_is_long_string', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      const longString = 'x'.repeat(200_000);

      createProcessTransport(longString);

      expect(nodeMock.createProcessTransport).toHaveBeenCalledWith(longString);
    });

    it('should_forward_resource_boundary_input_to_node_createProcessTransport_when_input_is_large_file_like', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      const largeFileLike = new Uint8Array(1024 * 1024);

      createProcessTransport(largeFileLike);

      expect(nodeMock.createProcessTransport.mock.calls[0][0]).toBe(largeFileLike);
    });

    it('should_forward_resource_boundary_input_to_node_createProcessTransport_when_input_is_deep_nested', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      const deepNested = buildDeepNested(64);

      createProcessTransport(deepNested);

      expect(nodeMock.createProcessTransport.mock.calls[0][0]).toBe(deepNested);
    });

    it('should_throw_when_node_createProcessTransport_throws', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      nodeMock.createProcessTransport.mockImplementationOnce(() => {
        throw new Error('node createProcessTransport failed');
      });

      expect(() => createProcessTransport({})).toThrow('node createProcessTransport failed');
    });

    it('should_resolve_when_node_createProcessTransport_returns_promise', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      nodeMock.createProcessTransport.mockResolvedValueOnce('ok');

      const result = await createProcessTransport('cmd');

      expect(result).toBe('ok');
    });

    it('should_reject_when_node_createProcessTransport_returns_rejected_promise', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();
      nodeMock.createProcessTransport.mockRejectedValueOnce(new Error('node rejected'));

      await expect(createProcessTransport('cmd')).rejects.toThrow('node rejected');
    });

    it('should_support_concurrent_calls_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();

      await Promise.all([1, 2, 3].map((n) => Promise.resolve(createProcessTransport({ n }))));

      expect(nodeMock.createProcessTransport).toHaveBeenCalledTimes(3);
    });

    it('should_support_rapid_consecutive_calls_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const { createProcessTransport } = await importTransports();

      for (let i = 0; i < 5; i += 1) createProcessTransport(i);

      expect(nodeMock.createProcessTransport).toHaveBeenCalledTimes(5);
    });

    it('should_call_browser_createProcessTransport_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const { createProcessTransport } = await importTransports();

      createProcessTransport({ command: 'x' });

      expect(browserMock.createProcessTransport).toHaveBeenCalledTimes(1);
    });

    it('should_return_value_from_browser_createProcessTransport_when_impl_returns_value', async () => {
      platformState.isNode = false;
      const { createProcessTransport } = await importTransports();
      const output = { ok: 'browser' };
      browserMock.createProcessTransport.mockReturnValueOnce(output);

      const result = createProcessTransport({ command: 'x' });

      expect(result).toBe(output);
    });

    it('should_throw_when_browser_createProcessTransport_throws', async () => {
      platformState.isNode = false;
      const { createProcessTransport } = await importTransports();
      browserMock.createProcessTransport.mockImplementationOnce(() => {
        throw new Error('browser createProcessTransport failed');
      });

      expect(() => createProcessTransport({})).toThrow('browser createProcessTransport failed');
    });
  });

  describe('BinarySkillProvider', () => {
    it('should_export_node_BinarySkillProvider_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.BinarySkillProvider).toBe(nodeMock.BinarySkillProvider);
    });

    it('should_export_browser_BinarySkillProvider_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.BinarySkillProvider).toBe(browserMock.BinarySkillProvider);
    });

    it('should_forward_constructor_args_to_node_BinarySkillProvider_when_constructed', async () => {
      platformState.isNode = true;
      const { BinarySkillProvider } = await importTransports();
      const config = { name: 'skill', args: ['--flag'] };

      new BinarySkillProvider(config, 'meta');

      expect(nodeMock.state.binaryCtorCalls[0]).toEqual([config, 'meta']);
    });

    it('should_forward_resource_boundary_input_to_node_BinarySkillProvider_when_input_is_long_string', async () => {
      platformState.isNode = true;
      const { BinarySkillProvider } = await importTransports();
      const longString = 'x'.repeat(200_000);

      new BinarySkillProvider(longString);

      expect(nodeMock.state.binaryCtorCalls[0]).toEqual([longString]);
    });

    it('should_forward_resource_boundary_input_to_node_BinarySkillProvider_when_input_is_large_file_like', async () => {
      platformState.isNode = true;
      const { BinarySkillProvider } = await importTransports();
      const largeFileLike = new Uint8Array(1024 * 1024);

      new BinarySkillProvider(largeFileLike);

      expect(nodeMock.state.binaryCtorCalls[0][0]).toBe(largeFileLike);
    });

    it('should_throw_when_node_BinarySkillProvider_constructor_throws', async () => {
      platformState.isNode = true;
      const { BinarySkillProvider } = await importTransports();

      expect(() => new BinarySkillProvider('__throw__')).toThrow('node BinarySkillProvider constructor failed');
    });

    it('should_throw_when_browser_BinarySkillProvider_constructor_throws', async () => {
      platformState.isNode = false;
      const { BinarySkillProvider } = await importTransports();

      expect(() => new BinarySkillProvider('__throw__')).toThrow('browser BinarySkillProvider constructor failed');
    });
  });

  describe('createBinarySkillProvider', () => {
    it('should_export_node_createBinarySkillProvider_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.createBinarySkillProvider).toBe(nodeMock.createBinarySkillProvider);
    });

    it('should_export_browser_createBinarySkillProvider_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.createBinarySkillProvider).toBe(browserMock.createBinarySkillProvider);
    });

    it('should_call_node_createBinarySkillProvider_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      const options = { name: 'alpha', command: 'tool' };

      createBinarySkillProvider(options);

      expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledWith(options);
    });

    it('should_return_value_from_node_createBinarySkillProvider_when_impl_returns_value', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      const output = { ok: true };
      nodeMock.createBinarySkillProvider.mockReturnValueOnce(output);

      const result = createBinarySkillProvider({ name: 'x' });

      expect(result).toBe(output);
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
      ['numeric string', '123'],
      ['array-like object', { 0: 'x', length: 1 }],
    ])(
      'should_forward_boundary_input_to_node_createBinarySkillProvider_when_input_is_%s',
      async (_label, input) => {
        platformState.isNode = true;
        const { createBinarySkillProvider } = await importTransports();

        createBinarySkillProvider(input);

        expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledWith(input);
      },
    );

    it('should_forward_resource_boundary_input_to_node_createBinarySkillProvider_when_input_is_long_string', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      const longString = 'x'.repeat(200_000);

      createBinarySkillProvider(longString);

      expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledWith(longString);
    });

    it('should_forward_resource_boundary_input_to_node_createBinarySkillProvider_when_input_is_large_file_like', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      const largeFileLike = new Uint8Array(1024 * 1024);

      createBinarySkillProvider(largeFileLike);

      expect(nodeMock.createBinarySkillProvider.mock.calls[0][0]).toBe(largeFileLike);
    });

    it('should_forward_resource_boundary_input_to_node_createBinarySkillProvider_when_input_is_deep_nested', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      const deepNested = buildDeepNested(64);

      createBinarySkillProvider(deepNested);

      expect(nodeMock.createBinarySkillProvider.mock.calls[0][0]).toBe(deepNested);
    });

    it('should_throw_when_node_createBinarySkillProvider_throws', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      nodeMock.createBinarySkillProvider.mockImplementationOnce(() => {
        throw new Error('node createBinarySkillProvider failed');
      });

      expect(() => createBinarySkillProvider({})).toThrow('node createBinarySkillProvider failed');
    });

    it('should_resolve_when_node_createBinarySkillProvider_returns_promise', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      nodeMock.createBinarySkillProvider.mockResolvedValueOnce('ok');

      const result = await createBinarySkillProvider('cmd');

      expect(result).toBe('ok');
    });

    it('should_reject_when_node_createBinarySkillProvider_returns_rejected_promise', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();
      nodeMock.createBinarySkillProvider.mockRejectedValueOnce(new Error('node rejected'));

      await expect(createBinarySkillProvider('cmd')).rejects.toThrow('node rejected');
    });

    it('should_support_concurrent_calls_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();

      await Promise.all([1, 2, 3].map((n) => Promise.resolve(createBinarySkillProvider({ n }))));

      expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledTimes(3);
    });

    it('should_support_rapid_consecutive_calls_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const { createBinarySkillProvider } = await importTransports();

      for (let i = 0; i < 5; i += 1) createBinarySkillProvider(i);

      expect(nodeMock.createBinarySkillProvider).toHaveBeenCalledTimes(5);
    });

    it('should_call_browser_createBinarySkillProvider_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const { createBinarySkillProvider } = await importTransports();

      createBinarySkillProvider({ name: 'x' });

      expect(browserMock.createBinarySkillProvider).toHaveBeenCalledTimes(1);
    });

    it('should_return_value_from_browser_createBinarySkillProvider_when_impl_returns_value', async () => {
      platformState.isNode = false;
      const { createBinarySkillProvider } = await importTransports();
      const output = { ok: 'browser' };
      browserMock.createBinarySkillProvider.mockReturnValueOnce(output);

      const result = createBinarySkillProvider({ name: 'x' });

      expect(result).toBe(output);
    });

    it('should_throw_when_browser_createBinarySkillProvider_throws', async () => {
      platformState.isNode = false;
      const { createBinarySkillProvider } = await importTransports();
      browserMock.createBinarySkillProvider.mockImplementationOnce(() => {
        throw new Error('browser createBinarySkillProvider failed');
      });

      expect(() => createBinarySkillProvider({})).toThrow('browser createBinarySkillProvider failed');
    });
  });

  describe('default export', () => {
    it('should_export_node_namespace_as_default_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();
      const nodeNamespace = await import('../../../../../js/agents/plugins/transports/index.node.js');

      expect(transports.default).toBe(nodeNamespace);
    });

    it('should_export_browser_namespace_as_default_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();
      const browserNamespace = await import('../../../../../js/agents/plugins/transports/index.browser.js');

      expect(transports.default).toBe(browserNamespace);
    });

    it('should_expose_ProcessTransport_on_default_export_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.default.ProcessTransport).toBe(transports.ProcessTransport);
    });

    it('should_expose_createProcessTransport_on_default_export_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.default.createProcessTransport).toBe(transports.createProcessTransport);
    });

    it('should_expose_BinarySkillProvider_on_default_export_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.default.BinarySkillProvider).toBe(transports.BinarySkillProvider);
    });

    it('should_expose_createBinarySkillProvider_on_default_export_when_Platform_isNode_is_true', async () => {
      platformState.isNode = true;
      const transports = await importTransports();

      expect(transports.default.createBinarySkillProvider).toBe(transports.createBinarySkillProvider);
    });

    it('should_expose_ProcessTransport_on_default_export_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.default.ProcessTransport).toBe(transports.ProcessTransport);
    });

    it('should_expose_createProcessTransport_on_default_export_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.default.createProcessTransport).toBe(transports.createProcessTransport);
    });

    it('should_expose_BinarySkillProvider_on_default_export_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.default.BinarySkillProvider).toBe(transports.BinarySkillProvider);
    });

    it('should_expose_createBinarySkillProvider_on_default_export_when_Platform_isNode_is_false', async () => {
      platformState.isNode = false;
      const transports = await importTransports();

      expect(transports.default.createBinarySkillProvider).toBe(transports.createBinarySkillProvider);
    });
  });

  describe('Platform.isNode truthiness boundaries', () => {
    it.each([['null', null], ['undefined', undefined], ['empty string', ''], ['zero', 0]])(
      'should_select_browser_impl_when_Platform_isNode_is_falsey_%s',
      async (_label, value) => {
        platformState.isNode = value;
        const transports = await importTransports();

        expect(transports.ProcessTransport).toBe(browserMock.ProcessTransport);
      },
    );

    it.each([
      ['negative one', -1],
      ['max safe integer', Number.MAX_SAFE_INTEGER],
      ['string zero', '0'],
      ['whitespace string', '   '],
      ['empty array', []],
      ['empty object', {}],
    ])('should_select_node_impl_when_Platform_isNode_is_truthy_%s', async (_label, value) => {
      platformState.isNode = value;
      const transports = await importTransports();

      expect(transports.ProcessTransport).toBe(nodeMock.ProcessTransport);
    });
  });

  describe('module import error paths', () => {
    it('should_reject_import_when_node_impl_import_fails', async () => {
      platformState.isNode = true;
      vi.resetModules();
      vi.doMock('../../../../../js/agents/plugins/transports/index.node.js', () => {
        throw new Error('index.node.js import failed');
      });

      let error;
      try {
        await import(modulePath);
      } catch (err) {
        error = err;
      }

      expect(error?.cause?.message).toBe('index.node.js import failed');
    });

    it('should_reject_import_when_browser_impl_import_fails', async () => {
      platformState.isNode = false;
      vi.resetModules();
      vi.doMock('../../../../../js/agents/plugins/transports/index.browser.js', () => {
        throw new Error('index.browser.js import failed');
      });

      let error;
      try {
        await import(modulePath);
      } catch (err) {
        error = err;
      }

      expect(error?.cause?.message).toBe('index.browser.js import failed');
    });

    it('should_reject_import_when_Platform_isNode_getter_throws', async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(platformState, 'isNode');
      Object.defineProperty(platformState, 'isNode', {
        configurable: true,
        get() {
          throw new Error('Platform.isNode access failed');
        },
      });

      try {
        await expect(importTransports()).rejects.toThrow('Platform.isNode access failed');
      } finally {
        if (originalDescriptor) Object.defineProperty(platformState, 'isNode', originalDescriptor);
        else {
          delete platformState.isNode;
          platformState.isNode = true;
        }
      }
    });
  });
});