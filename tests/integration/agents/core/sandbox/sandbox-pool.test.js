import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createFakeWasmSandboxClass() {
  /** @type {any[]} */
  const instances = [];

  class FakeWasmSandbox {
    constructor(options = {}) {
      this.options = options;
      this.capabilities = new Set(options.capabilities || []);
      this._disposed = false;

      this.recycle = vi.fn(() => true);
      this.init = vi.fn(async () => {});
      this.dispose = vi.fn(() => {
        this._disposed = true;
      });

      instances.push(this);
    }
  }

  return { FakeWasmSandbox, instances };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
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
});

describe('core/sandbox/pool', () => {
  it('hands over a released sandbox directly to a queued waiter with the same capability key', async () => {
    const { FakeWasmSandbox } = createFakeWasmSandboxClass();

    vi.doMock(
      '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
      () => ({ WasmSandbox: FakeWasmSandbox, default: FakeWasmSandbox })
    );

    const { SandboxPool } = await import('../../../../../js/agents/core/sandbox/pool.js');

    const pool = new SandboxPool({
      maxSize: 2,
      maxActive: 1,
      idleTimeoutMs: 1000,
      defaultCapabilities: ['console'],
      preWarmCount: 0,
    });

    const sb1 = await pool.acquire({ capabilities: ['console'] });
    const p2 = pool.acquire({ capabilities: ['console'] });

    pool.release(sb1);

    const sb2 = await p2;
    expect(sb2).toBe(sb1);
    expect(sb1.recycle).toHaveBeenCalled();
  });

  it('rejects a queued waiter if handoff init fails and disposes the sandbox', async () => {
    const { FakeWasmSandbox } = createFakeWasmSandboxClass();

    vi.doMock(
      '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
      () => ({ WasmSandbox: FakeWasmSandbox, default: FakeWasmSandbox })
    );

    const { SandboxPool } = await import('../../../../../js/agents/core/sandbox/pool.js');

    const pool = new SandboxPool({
      maxSize: 2,
      maxActive: 1,
      idleTimeoutMs: 1000,
      defaultCapabilities: ['console'],
      preWarmCount: 0,
    });

    const sb1 = await pool.acquire({ capabilities: ['console'] });
    // Fail the next init call (the handoff branch calls init() again before resolving).
    sb1.init.mockRejectedValueOnce(new Error('init failed'));

    const p2 = pool.acquire({ capabilities: ['console'] });
    pool.release(sb1);

    await expect(p2).rejects.toThrow('init failed');
    expect(sb1.dispose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().total).toBe(0);
  });

  it('disposes sandboxes when the pool is full on release', async () => {
    const { FakeWasmSandbox } = createFakeWasmSandboxClass();

    vi.doMock(
      '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
      () => ({ WasmSandbox: FakeWasmSandbox, default: FakeWasmSandbox })
    );

    const { SandboxPool } = await import('../../../../../js/agents/core/sandbox/pool.js');

    const pool = new SandboxPool({
      maxSize: 1,
      maxActive: 2,
      idleTimeoutMs: 1000,
      defaultCapabilities: ['console'],
      preWarmCount: 0,
    });

    const sb1 = await pool.acquire({ capabilities: ['console'] });
    const sb2 = await pool.acquire({ capabilities: ['console'] });

    pool.release(sb1); // goes into the pool
    pool.release(sb2); // pool is full -> dispose

    expect(sb2.dispose).toHaveBeenCalledTimes(1);
    const stats = pool.getStats();
    expect(stats.total).toBe(1);
    expect(stats.pooled).toBe(1);
  });

  it('evicts idle sandboxes after idleTimeoutMs', async () => {
    vi.useFakeTimers();

    const { FakeWasmSandbox } = createFakeWasmSandboxClass();

    vi.doMock(
      '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
      () => ({ WasmSandbox: FakeWasmSandbox, default: FakeWasmSandbox })
    );

    const { SandboxPool } = await import('../../../../../js/agents/core/sandbox/pool.js');

    const pool = new SandboxPool({
      maxSize: 1,
      maxActive: 1,
      idleTimeoutMs: 10,
      defaultCapabilities: ['console'],
      preWarmCount: 0,
    });

    const sb1 = await pool.acquire({ capabilities: ['console'] });
    pool.release(sb1);

    await vi.advanceTimersByTimeAsync(15);

    expect(sb1.dispose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().total).toBe(0);
  });

  it('rejects queued acquirers when disposed', async () => {
    const { FakeWasmSandbox } = createFakeWasmSandboxClass();

    vi.doMock(
      '../../../../../js/agents/core/sandbox/wasm-sandbox.js',
      () => ({ WasmSandbox: FakeWasmSandbox, default: FakeWasmSandbox })
    );

    const { SandboxPool } = await import('../../../../../js/agents/core/sandbox/pool.js');

    const pool = new SandboxPool({
      maxSize: 2,
      maxActive: 1,
      idleTimeoutMs: 1000,
      defaultCapabilities: ['console'],
      preWarmCount: 0,
    });

    const sb1 = await pool.acquire({ capabilities: ['console'] });
    const p2 = pool.acquire({ capabilities: ['console'] });

    pool.dispose();
    pool.release(sb1);

    await expect(p2).rejects.toThrow(/disposed/i);
  });
});
