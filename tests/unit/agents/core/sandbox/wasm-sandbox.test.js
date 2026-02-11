import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxCapability, ResourceLimits } from '../../../../../js/agents/core/sandbox/constants.js';

let quickjsEmscriptenImpl = null;
let quickjsCoreImpl = null;

vi.mock(
  'quickjs-emscripten',
  () => ({
    getQuickJS: (...args) => {
      if (!quickjsEmscriptenImpl) {
        throw new Error('quickjs-emscripten mock not set');
      }
      return quickjsEmscriptenImpl(...args);
    },
  }),
  { virtual: true }
);

vi.mock(
  'quickjs-emscripten-core',
  () => ({
    newQuickJSWASMModule: (...args) => {
      if (!quickjsCoreImpl) {
        throw new Error('quickjs-emscripten-core mock not set');
      }
      return quickjsCoreImpl(...args);
    },
  }),
  { virtual: true }
);

const createHandle = (value) => ({ value, dispose: vi.fn() });

const createQuickJsMock = (options = {}) => {
  const functionHandles = {};

  const vm = {
    global: {},
    newObject: vi.fn(() => createHandle({})),
    newFunction: vi.fn((name, fn) => {
      const handle = createHandle({ name });
      handle.fn = fn;
      handle.name = name;
      functionHandles[name] = handle;
      return handle;
    }),
    newString: vi.fn((value) => createHandle(String(value))),
    newPromise: vi.fn(() => {
      const promiseHandle = createHandle('__promise__');
      return {
        handle: promiseHandle,
        resolve: vi.fn(),
        reject: vi.fn(),
      };
    }),
    setProp: vi.fn(),
    dump: vi.fn((handle) => {
      if (handle && Object.prototype.hasOwnProperty.call(handle, 'value')) {
        return handle.value;
      }
      return handle;
    }),
    getString: vi.fn((handle) => {
      if (handle && Object.prototype.hasOwnProperty.call(handle, 'value')) {
        return String(handle.value);
      }
      return String(handle);
    }),
    evalCode: vi.fn((code) => {
      if (typeof options.onEvalCode === 'function') {
        return options.onEvalCode(code, { createHandle });
      }
      return { error: null, value: createHandle(undefined) };
    }),
    dispose: vi.fn(),
  };

  const runtime = {
    setMemoryLimit: vi.fn(),
    setMaxStackSize: vi.fn(),
    newContext: vi.fn(() => vm),
    computeMemoryUsage: vi.fn(() => ({ malloc_size: 99 })),
    setInterruptHandler: vi.fn(),
    executePendingJobs: vi.fn(() => ({ value: 0, error: null })),
    dispose: vi.fn(),
  };

  const quickjs = { newRuntime: vi.fn(() => runtime) };

  return { quickjs, runtime, vm, functionHandles };
};

const loadWasmSandbox = async ({ quickjsMock, emscriptenImpl, coreImpl } = {}) => {
  vi.resetModules();

  if (emscriptenImpl) {
    quickjsEmscriptenImpl = emscriptenImpl;
  } else if (quickjsMock) {
    quickjsEmscriptenImpl = vi.fn(async () => quickjsMock.quickjs);
  } else {
    quickjsEmscriptenImpl = null;
  }

  if (coreImpl) {
    quickjsCoreImpl = coreImpl;
  } else if (quickjsMock) {
    quickjsCoreImpl = vi.fn(async () => quickjsMock.quickjs);
  } else {
    quickjsCoreImpl = null;
  }

  return import('../../../../../js/agents/core/sandbox/wasm-sandbox.js');
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
  quickjsEmscriptenImpl = null;
  quickjsCoreImpl = null;
});

describe('WasmSandbox', () => {
  it('initializes runtime and console capability', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const onLog = vi.fn();
    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.CONSOLE],
      limits: { memoryLimit: 256, timeoutMs: 5, maxStackDepth: 2 },
      onLog,
    });

    await sb.init();

    expect(quickjsMock.runtime.setMemoryLimit).toHaveBeenCalledWith(256);
    expect(quickjsMock.runtime.setMaxStackSize).toHaveBeenCalledWith(2 * 1024);

    const keys = Object.keys(quickjsMock.functionHandles);
    expect(keys).toEqual(expect.arrayContaining(['log', 'warn', 'error', 'info', 'debug']));

    const arg1 = createHandle('hello');
    const arg2 = createHandle(42);
    quickjsMock.functionHandles.log.fn(arg1, arg2);

    expect(onLog).toHaveBeenCalledWith('log', ['hello', 42]);
    expect(quickjsMock.functionHandles.log.dispose).toHaveBeenCalledTimes(1);

    sb.dispose();
  });

  it('falls back to quickjs-emscripten-core when primary loader fails', async () => {
    const quickjsMock = createQuickJsMock();
    const emscriptenImpl = vi.fn(async () => {
      throw new Error('no quickjs');
    });
    const coreImpl = vi.fn(async () => quickjsMock.quickjs);

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock, emscriptenImpl, coreImpl });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    expect(emscriptenImpl).toHaveBeenCalledTimes(1);
    expect(coreImpl).toHaveBeenCalledTimes(1);

    sb.dispose();
  });

  it('throws a helpful error when no QuickJS WASM implementation is available', async () => {
    const emscriptenImpl = vi.fn(async () => {
      throw new Error('no quickjs');
    });
    const coreImpl = vi.fn(async () => {
      throw new Error('no quickjs core');
    });

    const { WasmSandbox } = await loadWasmSandbox({ emscriptenImpl, coreImpl });

    const sb = new WasmSandbox({ capabilities: [] });
    await expect(sb.init()).rejects.toThrow(/quickjs-emscripten/i);
  });

  it('throws on init after dispose', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    sb.dispose();

    await expect(sb.init()).rejects.toThrow('Sandbox has been disposed');
  });

  it('injects state, emit, and fetch capabilities', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const onEmit = vi.fn();
    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.STATE, SandboxCapability.EMIT, SandboxCapability.FETCH],
      state: { count: 1n, empty: '', zero: 0 },
      onEmit,
    });

    await sb.init();

    const evalCalls = quickjsMock.vm.evalCode.mock.calls.map(([code]) => String(code));
    expect(evalCalls.some((code) => code.includes('"count":"1"'))).toBe(true);
    expect(evalCalls.some((code) => code.includes('globalThis.fetch'))).toBe(true);

    const propCalls = quickjsMock.vm.setProp.mock.calls;
    expect(propCalls.some(([target, prop]) => target === quickjsMock.vm.global && prop === 'state')).toBe(true);
    expect(propCalls.some(([target, prop]) => target === quickjsMock.vm.global && prop === 'emit')).toBe(true);
    expect(propCalls.some(([target, prop]) => target === quickjsMock.vm.global && prop === '__hostFetch')).toBe(true);

    const emitHandle = quickjsMock.functionHandles.emit;
    const nameHandle = createHandle('event:ping');
    const payloadHandle = createHandle({ ok: true });
    emitHandle.fn(nameHandle, payloadHandle);

    expect(onEmit).toHaveBeenCalledWith('event:ping', { ok: true });

    const fetchHandle = quickjsMock.functionHandles.__hostFetch;
    // New signature: (url, method, headersJson, body) → promise handle
    const fetchResult = fetchHandle.fn(
      createHandle('https://example.com'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );

    // Returns a promise handle (via vm.newPromise)
    expect(quickjsMock.vm.newPromise).toHaveBeenCalled();
    expect(fetchResult.value).toBe('__promise__');

    sb.dispose();
  });

  it('emit handles payload dump failures', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const onEmit = vi.fn();
    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.EMIT],
      onEmit,
    });

    await sb.init();

    const payloadHandle = createHandle({ bad: true });
    quickjsMock.vm.dump.mockImplementation((handle) => {
      if (handle === payloadHandle) throw new Error('dump failed');
      if (handle && Object.prototype.hasOwnProperty.call(handle, 'value')) return handle.value;
      return handle;
    });

    const emitHandle = quickjsMock.functionHandles.emit;
    emitHandle.fn(createHandle('event:fail'), payloadHandle);

    expect(onEmit).toHaveBeenCalledWith('event:fail', null);

    sb.dispose();
  });

  it('executes with boundary context values and resource sizes', async () => {
    const quickjsMock = createQuickJsMock();
    quickjsMock.vm.evalCode.mockImplementation((code) => ({
      error: null,
      value: createHandle(code),
    }));

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { ...ResourceLimits.LIGHT, timeoutMs: 5 },
    });

    await sb.init();

    const bigFile = 'F'.repeat(6000);
    const longString = 'L'.repeat(3000);
    const deepNested = { level1: { level2: { level3: { value: 'deep' } } } };
    const context = {
      nil: null,
      undef: undefined,
      emptyStr: '',
      emptyArr: [],
      emptyObj: {},
      zero: 0,
      negative: -1,
      maxSafe: Number.MAX_SAFE_INTEGER,
      whitespace: '   ',
      numAsString: '00042',
      arrayAsObject: { 0: 'a', length: 1 },
      bigFile,
      longString,
      deepNested,
    };

    const result = await sb.execute('1', context);

    expect(result.ok).toBe(true);

    const evalCalls = quickjsMock.vm.evalCode.mock.calls.map(([code]) => String(code));
    expect(evalCalls.length).toBe(Object.keys(context).length + 1);

    expect(evalCalls).toContain('(null)');
    expect(evalCalls).toContain('(undefined)');
    expect(evalCalls).toContain('([])');
    expect(evalCalls).toContain('({})');
    expect(evalCalls).toContain('(0)');
    expect(evalCalls).toContain('(-1)');

    expect(evalCalls.some((code) => code.includes('""'))).toBe(true);
    expect(evalCalls.some((code) => code.includes('"   "'))).toBe(true);
    expect(evalCalls.some((code) => code.includes(String(Number.MAX_SAFE_INTEGER)))).toBe(true);
    expect(evalCalls.some((code) => code.includes('"00042"'))).toBe(true);
    expect(evalCalls.some((code) => code.includes('"length":1'))).toBe(true);
    expect(evalCalls.some((code) => code.includes('"value":"deep"'))).toBe(true);
    expect(evalCalls.some((code) => code.includes(bigFile.slice(0, 20)))).toBe(true);
    expect(evalCalls.some((code) => code.includes(longString.slice(0, 20)))).toBe(true);

    expect(quickjsMock.vm.setProp).toHaveBeenCalledTimes(Object.keys(context).length);

    sb.dispose();
  });

  it('skips non-serializable context values', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { ...ResourceLimits.LIGHT, timeoutMs: 5 },
    });

    await sb.init();

    const circular = {};
    circular.self = circular;

    await sb.execute('1', { ok: 1, circular });

    expect(quickjsMock.vm.evalCode).toHaveBeenCalledTimes(2);
    expect(quickjsMock.vm.setProp.mock.calls.some(([, key]) => key === 'ok')).toBe(true);

    sb.dispose();
  });

  it('reports execution timeout when interrupted and evalCode returns an error', async () => {
    vi.useFakeTimers();

    try {
      const errorHandle = createHandle('Boom');
      const quickjsMock = createQuickJsMock({
        onEvalCode: (code) => {
          if (String(code).includes('trigger-timeout')) {
            vi.runOnlyPendingTimers();
            return { error: errorHandle, value: null };
          }
          return { error: null, value: createHandle(undefined) };
        },
      });

      const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

      const sb = new WasmSandbox({
        capabilities: [],
        limits: { memoryLimit: 256, timeoutMs: 1, maxStackDepth: 1 },
      });

      await sb.init();

      const result = await sb.execute('/* trigger-timeout */');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Execution timeout');
      expect(quickjsMock.runtime.setInterruptHandler).toHaveBeenCalled();

      sb.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns dumped error when evalCode reports an error', async () => {
    const errorHandle = createHandle('EvalBoom');
    const quickjsMock = createQuickJsMock({
      onEvalCode: (code) => {
        if (String(code).includes('boom')) return { error: errorHandle, value: null };
        return { error: null, value: createHandle(undefined) };
      },
    });

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const result = await sb.execute('boom');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('EvalBoom');
    expect(errorHandle.dispose).toHaveBeenCalledTimes(1);

    sb.dispose();
  });

  it('returns undefined when dumping the return value fails', async () => {
    const valueHandle = createHandle('value');
    const quickjsMock = createQuickJsMock({
      onEvalCode: () => ({ error: null, value: valueHandle }),
    });

    quickjsMock.vm.dump.mockImplementation((handle) => {
      if (handle === valueHandle) throw new Error('dump failed');
      if (handle && Object.prototype.hasOwnProperty.call(handle, 'value')) return handle.value;
      return handle;
    });

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const result = await sb.execute('1');

    expect(result.ok).toBe(true);
    expect(result.value).toBeUndefined();

    sb.dispose();
  });

  it('handles thrown eval errors', async () => {
    const quickjsMock = createQuickJsMock();
    quickjsMock.vm.evalCode.mockImplementation(() => {
      throw new Error('kaboom');
    });

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const result = await sb.execute('1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('kaboom');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    sb.dispose();
  });

  it('supports concurrent and rapid consecutive execute calls', async () => {
    const quickjsMock = createQuickJsMock();
    quickjsMock.vm.evalCode.mockImplementation((code) => {
      const text = String(code);
      let value = 0;
      if (text.includes('1+1')) value = 2;
      if (text.includes('2+2')) value = 4;
      if (text.includes('3+3')) value = 6;
      if (text.includes('4+4')) value = 8;
      return { error: null, value: createHandle(value) };
    });

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const [first, second] = await Promise.all([
      sb.execute('1+1'),
      sb.execute('2+2'),
    ]);

    expect(first.value).toBe(2);
    expect(second.value).toBe(4);

    const third = await sb.execute('3+3');
    const fourth = await sb.execute('4+4');

    expect(third.value).toBe(6);
    expect(fourth.value).toBe(8);

    sb.dispose();
  });

  it('executeAsync flushes pending jobs and surfaces pending errors', async () => {
    const pendingError = createHandle('PendingBoom');
    const quickjsMock = createQuickJsMock();
    quickjsMock.runtime.executePendingJobs
      .mockReturnValueOnce({ value: 1, error: pendingError })
      .mockReturnValueOnce({ value: 0, error: null });

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const result = await sb.executeAsync('return Promise.resolve(1);');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('PendingBoom');
    expect(pendingError.dispose).toHaveBeenCalledTimes(1);

    sb.dispose();
  });

  it('executeAsync stops after pending jobs drain', async () => {
    const quickjsMock = createQuickJsMock();
    quickjsMock.runtime.executePendingJobs
      .mockReturnValueOnce({ value: 1, error: null })
      .mockReturnValueOnce({ value: 0, error: null });

    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const result = await sb.executeAsync('return Promise.resolve(1);');

    expect(result.ok).toBe(true);
    expect(quickjsMock.runtime.executePendingJobs).toHaveBeenCalled();

    sb.dispose();
  });

  it('recycle resets vm/runtime and applies option overrides', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const onLog = vi.fn();
    const onEmit = vi.fn();
    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const recycled = sb.recycle({
      state: { next: true },
      onLog,
      onEmit,
      limits: { timeoutMs: 10 },
    });

    expect(recycled).toBe(true);
    expect(sb.state).toEqual({ next: true });
    expect(sb.onLog).toBe(onLog);
    expect(sb.onEmit).toBe(onEmit);
    expect(sb.limits.timeoutMs).toBe(10);
    expect(quickjsMock.vm.dispose).toHaveBeenCalledTimes(1);
    expect(quickjsMock.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(sb._initialized).toBe(false);

    sb.dispose();
    expect(sb.recycle()).toBe(false);
  });

  it('updateState syncs state when initialized and skips on serialization failure', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [SandboxCapability.STATE] });
    await sb.init();

    quickjsMock.vm.evalCode.mockClear();

    sb.updateState({ count: 0, label: 'ok' });

    expect(sb.state.count).toBe(0);
    expect(sb.state.label).toBe('ok');
    expect(quickjsMock.vm.evalCode.mock.calls[0][0]).toContain('globalThis.state');

    const circular = {};
    circular.self = circular;

    quickjsMock.vm.evalCode.mockClear();
    sb.updateState({ circular });

    expect(quickjsMock.vm.evalCode).not.toHaveBeenCalled();

    sb.dispose();
  });

  it('getMemoryUsage returns null without a runtime and returns usage when available', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const fresh = new WasmSandbox({ capabilities: [] });
    expect(fresh.getMemoryUsage()).toBeNull();

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    const usage = sb.getMemoryUsage();
    expect(usage).toEqual({ malloc_size: 99 });

    sb.dispose();
  });

  it('dispose releases runtime and vm safely', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({ capabilities: [] });
    await sb.init();

    sb.dispose();

    expect(quickjsMock.vm.dispose).toHaveBeenCalledTimes(1);
    expect(quickjsMock.runtime.dispose).toHaveBeenCalledTimes(1);
    expect(sb._disposed).toBe(true);
    expect(sb._initialized).toBe(false);

    sb.dispose();
    expect(quickjsMock.vm.dispose).toHaveBeenCalledTimes(1);
    expect(quickjsMock.runtime.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('createSandbox', () => {
  it('creates and initializes a sandbox instance', async () => {
    const quickjsMock = createQuickJsMock();
    const { createSandbox, WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = await createSandbox({
      capabilities: [SandboxCapability.CONSOLE],
      limits: { memoryLimit: 512, timeoutMs: 10, maxStackDepth: 2 },
    });

    expect(sb).toBeInstanceOf(WasmSandbox);
    expect(sb._initialized).toBe(true);
    expect(quickjsMock.runtime.setMemoryLimit).toHaveBeenCalledWith(512);

    sb.dispose();
  });

  it('propagates initialization errors from WasmSandbox', async () => {
    const emscriptenImpl = vi.fn(async () => {
      throw new Error('no quickjs');
    });
    const coreImpl = vi.fn(async () => {
      throw new Error('no quickjs core');
    });

    const { createSandbox } = await loadWasmSandbox({ emscriptenImpl, coreImpl });

    await expect(createSandbox({ capabilities: [] })).rejects.toThrow(/quickjs-emscripten/i);
  });
});

describe('WasmSandbox NetworkPolicy', () => {
  it('allows fetch without policy (no restrictions)', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
    });

    await sb.init();

    const fetchHandle = quickjsMock.functionHandles.__hostFetch;
    const result = fetchHandle.fn(
      createHandle('https://example.com/api'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );

    // No policy → should proceed to real fetch (returns promise handle)
    expect(quickjsMock.vm.newPromise).toHaveBeenCalled();
    expect(result.value).toBe('__promise__');

    sb.dispose();
  });

  it('blocks fetch when URL is not in allowedDomains', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: {
        allowedDomains: ['api.example.com'],
      },
    });

    await sb.init();

    const fetchHandle = quickjsMock.functionHandles.__hostFetch;
    const result = fetchHandle.fn(
      createHandle('https://evil.com/steal'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );

    // Blocked → returns error string (not a promise)
    expect(result.value).toContain('__fetchError');
    expect(result.value).toContain('ERR_NETWORK_POLICY');
    expect(result.value).toContain('evil.com');

    sb.dispose();
  });

  it('allows fetch when URL matches allowedDomains', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: {
        allowedDomains: ['api.example.com', '*.github.com'],
      },
    });

    await sb.init();

    const fetchHandle = quickjsMock.functionHandles.__hostFetch;
    const result = fetchHandle.fn(
      createHandle('https://api.example.com/data'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );

    expect(quickjsMock.vm.newPromise).toHaveBeenCalled();
    expect(result.value).toBe('__promise__');

    sb.dispose();
  });

  it('blocks fetch when URL matches deniedDomains', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: {
        deniedDomains: ['evil.com', '*.malware.org'],
      },
    });

    await sb.init();

    const fetchHandle = quickjsMock.functionHandles.__hostFetch;

    // Exact match
    const r1 = fetchHandle.fn(
      createHandle('https://evil.com/payload'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );
    expect(r1.value).toContain('ERR_NETWORK_POLICY');

    // Wildcard match
    const r2 = fetchHandle.fn(
      createHandle('https://sub.malware.org/c2'),
      createHandle('POST'),
      createHandle('{}'),
      createHandle('')
    );
    expect(r2.value).toContain('ERR_NETWORK_POLICY');

    // Allowed (not denied)
    const r3 = fetchHandle.fn(
      createHandle('https://safe.com/ok'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );
    expect(r3.value).toBe('__promise__');

    sb.dispose();
  });

  it('deniedDomains takes priority over allowedDomains', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: {
        allowedDomains: ['*.example.com'],
        deniedDomains: ['blocked.example.com'],
      },
    });

    await sb.init();

    const fetchHandle = quickjsMock.functionHandles.__hostFetch;

    // Denied even though it matches allowedDomains wildcard
    const r1 = fetchHandle.fn(
      createHandle('https://blocked.example.com/api'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );
    expect(r1.value).toContain('ERR_NETWORK_POLICY');

    // Allowed subdomain
    const r2 = fetchHandle.fn(
      createHandle('https://api.example.com/ok'),
      createHandle('GET'),
      createHandle('{}'),
      createHandle('')
    );
    expect(r2.value).toBe('__promise__');

    sb.dispose();
  });

  it('validates domain patterns on construction', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    expect(() => new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: { allowedDomains: ['*'] },
    })).toThrow(/too broad/);

    expect(() => new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: { deniedDomains: ['http://evil.com'] },
    })).toThrow(/protocol/);
  });

  it('stores networkPolicy on instance', async () => {
    const quickjsMock = createQuickJsMock();
    const { WasmSandbox } = await loadWasmSandbox({ quickjsMock });

    const policy = { allowedDomains: ['api.example.com'] };
    const sb = new WasmSandbox({
      capabilities: [SandboxCapability.FETCH],
      networkPolicy: policy,
    });

    expect(sb.networkPolicy).toBe(policy);

    const sb2 = new WasmSandbox({ capabilities: [] });
    expect(sb2.networkPolicy).toBeNull();
  });
});
