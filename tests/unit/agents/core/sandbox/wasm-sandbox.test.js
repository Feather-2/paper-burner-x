import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeQuickJS({ onEvalCode } = {}) {
  const errorHandle = { dispose: vi.fn() };
  const valueHandle = { dispose: vi.fn() };

  const vm = {
    global: {},
    evalCode: vi.fn((code) => {
      if (typeof onEvalCode === 'function') return onEvalCode(code, { errorHandle, valueHandle });
      return { error: null, value: valueHandle };
    }),
    setProp: vi.fn(),
    dump: vi.fn(() => 'Boom'),
    dispose: vi.fn(),
  };

  const runtime = {
    setMemoryLimit: vi.fn(),
    setMaxStackSize: vi.fn(),
    newContext: vi.fn(() => vm),
    computeMemoryUsage: vi.fn(() => ({ malloc_size: 123 })),
    setInterruptHandler: vi.fn(),
    executePendingJobs: vi.fn(() => ({ value: 0, error: null })),
    dispose: vi.fn(),
  };

  const quickjs = { newRuntime: vi.fn(() => runtime) };
  return { quickjs, runtime, vm, errorHandle, valueHandle };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
  vi.unmock('quickjs-emscripten');
  vi.unmock('quickjs-emscripten-core');
});

afterEach(() => {
  try {
    vi.runOnlyPendingTimers();
    vi.clearAllTimers();
  } catch {
    // ignore
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unmock('quickjs-emscripten');
  vi.unmock('quickjs-emscripten-core');
});

describe('core/sandbox/wasm-sandbox', () => {
  it('falls back to quickjs-emscripten-core when quickjs-emscripten is unavailable', async () => {
    const { quickjs, runtime } = createFakeQuickJS();

    // Force the primary optional dependency path to fail so we deterministically
    // exercise the quickjs-emscripten-core fallback.
    vi.doMock(
      'quickjs-emscripten',
      () => {
        throw new Error('no quickjs');
      },
      { virtual: true }
    );

    /** @type {any} */
    let coreFactory = null;
    vi.doMock(
      'quickjs-emscripten-core',
      () => {
        coreFactory = vi.fn(async () => quickjs);
        return { newQuickJSWASMModule: coreFactory };
      },
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 10, maxStackDepth: 1 },
    });
    await sb.init();

    expect(coreFactory).toHaveBeenCalledTimes(1);
    expect(runtime.setMemoryLimit).toHaveBeenCalledWith(128);
    expect(runtime.setMaxStackSize).toHaveBeenCalledWith(1 * 1024);

    sb.dispose();
  });

  it('throws a helpful error when no QuickJS WASM implementation is available', async () => {
    // Make the failure deterministic by simulating both optional deps being present
    // but failing at runtime. This ensures we exercise the final error branch.
    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => {
          throw new Error('no quickjs');
        }),
      }),
      { virtual: true }
    );
    vi.doMock(
      'quickjs-emscripten-core',
      () => ({
        newQuickJSWASMModule: vi.fn(async () => {
          throw new Error('no quickjs core');
        }),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({ capabilities: [] });
    await expect(sb.init()).rejects.toThrow(/requires quickjs-emscripten/i);
  });

  it('reports Execution timeout when interrupted and evalCode returns an error', async () => {
    vi.useFakeTimers();

    const { quickjs, runtime, errorHandle } = createFakeQuickJS({
      onEvalCode: (code) => {
        // Fire the host timeout callback before we return the QuickJS error.
        // This makes `interrupted === true` in WasmSandbox.execute.
        if (String(code).includes('trigger-timeout')) {
          vi.runOnlyPendingTimers();
          return { error: errorHandle, value: null };
        }
        return { error: null, value: { dispose: vi.fn() } };
      },
    });

    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => quickjs),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 5, maxStackDepth: 1 },
    });
    await sb.init();

    const res = await sb.execute('/* trigger-timeout */');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Execution timeout');
    expect(runtime.setInterruptHandler).toHaveBeenCalled();

    sb.dispose();
  });

  it('returns dumped error when evalCode fails without interruption', async () => {
    const { quickjs, errorHandle } = createFakeQuickJS({
      onEvalCode: (code) => {
        if (String(code).includes('boom')) return { error: errorHandle, value: null };
        return { error: null, value: { dispose: vi.fn() } };
      },
    });

    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => quickjs),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 250, maxStackDepth: 1 },
    });
    await sb.init();

    const res = await sb.execute('/* boom */');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Boom');

    sb.dispose();
  });

  it('skips non-serializable context values when injecting context', async () => {
    const { quickjs, vm } = createFakeQuickJS();

    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => quickjs),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 250, maxStackDepth: 1 },
    });
    await sb.init();

    const circular = {};
    // @ts-ignore - intentional circular reference for JSON.stringify failure.
    circular.self = circular;

    await sb.execute('1', { circular });

    // Only the actual code execution should call evalCode; the context injection should be skipped.
    expect(vm.evalCode).toHaveBeenCalledTimes(1);

    sb.dispose();
  });

  it('returns undefined when dumping the return value fails', async () => {
    const { quickjs, vm, valueHandle } = createFakeQuickJS();
    vm.dump.mockImplementation((handle) => {
      if (handle === valueHandle) throw new Error('cannot dump');
      return 'Boom';
    });

    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => quickjs),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 250, maxStackDepth: 1 },
    });
    await sb.init();

    const res = await sb.execute('1');
    expect(res.success).toBe(true);
    expect(res.data).toBeUndefined();

    sb.dispose();
  });

  it('executeAsync converts pending jobs errors into a failed result', async () => {
    const pendingError = { dispose: vi.fn() };
    const { quickjs, runtime, vm } = createFakeQuickJS();
    runtime.executePendingJobs.mockReturnValueOnce({ value: 1, error: pendingError });
    vm.dump.mockImplementation((handle) => (handle === pendingError ? 'PendingBoom' : 'Boom'));

    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => quickjs),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 250, maxStackDepth: 1 },
    });
    await sb.init();

    const res = await sb.executeAsync('return Promise.resolve(1);');
    expect(res.success).toBe(false);
    expect(res.error).toBe('PendingBoom');
    expect(pendingError.dispose).toHaveBeenCalledTimes(1);

    sb.dispose();
  });

  it('recycle resets vm/runtime for reuse and returns false when already disposed', async () => {
    const { quickjs, vm, runtime } = createFakeQuickJS();

    vi.doMock(
      'quickjs-emscripten',
      () => ({
        getQuickJS: vi.fn(async () => quickjs),
      }),
      { virtual: true }
    );

    const { WasmSandbox } = await import('../../../../js/agents/core/sandbox/wasm-sandbox.js');

    const sb = new WasmSandbox({
      capabilities: [],
      limits: { memoryLimit: 128, timeoutMs: 250, maxStackDepth: 1 },
    });
    await sb.init();

    expect(sb.recycle({ state: { next: true } })).toBe(true);
    expect(vm.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);

    sb.dispose();
    expect(sb.recycle()).toBe(false);
  });
});
