import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const sandboxInstances = [];
  const wasmSandboxInit = vi.fn().mockResolvedValue(undefined);
  const wasmSandboxRecycle = vi.fn();
  const mockLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };

  class WasmSandboxMock {
    constructor(options) {
      this.options = options;
      this.init = wasmSandboxInit;
      this.recycle = wasmSandboxRecycle;
      this.dispose = vi.fn().mockResolvedValue(undefined);
      this.terminate = vi.fn().mockResolvedValue(undefined);
      sandboxInstances.push(this);
    }
  }

  const SandboxPreset = { SKILL: ['capA', 'capB'] };
  const ResourceLimits = { STANDARD: { cpuMs: 1000, memoryMb: 64 } };

  return {
    sandboxInstances,
    wasmSandboxInit,
    wasmSandboxRecycle,
    mockLogger,
    WasmSandboxMock,
    SandboxPreset,
    ResourceLimits,
  };
});

vi.mock('../../../../../js/agents/core/sandbox/wasm-sandbox.js', () => ({
  WasmSandbox: hoisted.WasmSandboxMock,
}));

vi.mock('../../../../../js/agents/core/sandbox/constants.js', () => ({
  SandboxPreset: hoisted.SandboxPreset,
  ResourceLimits: hoisted.ResourceLimits,
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: vi.fn(() => hoisted.mockLogger),
}));

import { SandboxPool } from '../../../../../js/agents/core/sandbox/pool.js';

beforeEach(() => {
  hoisted.sandboxInstances.length = 0;
  hoisted.wasmSandboxInit.mockReset().mockResolvedValue(undefined);
  hoisted.wasmSandboxRecycle.mockReset();
  hoisted.mockLogger.error.mockReset();
  hoisted.mockLogger.warn.mockReset();
  hoisted.mockLogger.info.mockReset();
  hoisted.mockLogger.debug.mockReset();
});

describe('SandboxPool', () => {
  it('sets defaults when options omitted (undefined)', () => {
    const pool = new SandboxPool();

    expect(pool.maxSize).toBe(4);
    expect(pool.maxActive).toBe(4);
    expect(pool.idleTimeoutMs).toBe(60000);
    expect(pool.defaultCapabilities).toBe(hoisted.SandboxPreset.SKILL);
    expect(pool.defaultLimits).toBe(hoisted.ResourceLimits.STANDARD);
  });

  it('handles option boundary values (0, -1, MAX_SAFE_INTEGER) and type boundaries (string maxSize)', () => {
    const customCaps = [];
    const customLimits = {};

    const poolA = new SandboxPool({
      maxSize: 0,
      maxActive: -1,
      idleTimeoutMs: 0,
      defaultCapabilities: customCaps,
      defaultLimits: customLimits,
    });

    expect(poolA.maxSize).toBe(4);
    expect(poolA.maxActive).toBe(1);
    expect(poolA.idleTimeoutMs).toBe(60000);
    expect(poolA.defaultCapabilities).toBe(customCaps);
    expect(poolA.defaultLimits).toBe(customLimits);

    const poolB = new SandboxPool({ maxSize: '2' });
    expect(poolB.maxSize).toBe('2');
    expect(poolB.maxActive).toBe(2);

    const poolC = new SandboxPool({ maxSize: Number.MAX_SAFE_INTEGER });
    expect(poolC.maxSize).toBe(Number.MAX_SAFE_INTEGER);
    expect(poolC.maxActive).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('_getCapabilityKey returns a stable sorted key and handles empty/whitespace inputs', () => {
    const pool = new SandboxPool();

    expect(pool._getCapabilityKey(['b', 'a'])).toBe('a,b');
    expect(pool._getCapabilityKey(['b', 'a', 'a'])).toBe('a,a,b');
    expect(pool._getCapabilityKey([])).toBe('');
    expect(pool._getCapabilityKey([' ', '', 'a'])).toBe(', ,a');
    expect(pool._getCapabilityKey('ba')).toBe('a,b');

    expect(() => pool._getCapabilityKey({})).toThrow();
  });

  it('acquire rejects after pool is disposed', async () => {
    const pool = new SandboxPool();
    pool._disposed = true;

    await expect(pool.acquire()).rejects.toThrow('Pool has been disposed');
  });

  it('acquire rejects on null options and non-iterable capabilities object', async () => {
    const pool = new SandboxPool();

    await expect(pool.acquire(null)).rejects.toThrow();
    await expect(pool.acquire({ capabilities: {} })).rejects.toThrow();
  });

  it('acquire resolves capability defaults and empty arrays correctly', async () => {
    const pool = new SandboxPool({
      defaultCapabilities: ['a', 'b'],
      defaultLimits: { cpuMs: 1, memoryMb: 2 },
    });

    const sbDefault = await pool.acquire({ capabilities: null });
    expect(hoisted.sandboxInstances[0].options.capabilities).toBe(pool.defaultCapabilities);

    const emptyCaps = [];
    const sbEmpty = await pool.acquire({ capabilities: emptyCaps });
    expect(hoisted.sandboxInstances[1].options.capabilities).toBe(emptyCaps);

    expect(sbDefault).not.toBe(sbEmpty);
    expect(pool._totalCount).toBe(2);
    expect(pool._inUseCount).toBe(2);
    expect(hoisted.wasmSandboxInit).toHaveBeenCalledTimes(2);
  });

  it('acquire creates a new sandbox with merged limits and forwards deep state/handlers', async () => {
    const defaultLimits = { cpuMs: 1, memoryMb: 2 };
    const pool = new SandboxPool({
      defaultCapabilities: ['capX'],
      defaultLimits,
    });

    const deepState = {
      a: { b: { c: { d: { payload: 'x'.repeat(20000) } } } },
    };
    const onLog = vi.fn();
    const onEmit = vi.fn();

    const sandbox = await pool.acquire({
      capabilities: ['z', 'a'],
      limits: { memoryMb: 128 },
      state: deepState,
      onLog,
      onEmit,
    });

    expect(hoisted.sandboxInstances).toHaveLength(1);
    const instance = hoisted.sandboxInstances[0];

    expect(instance).toBe(sandbox);
    expect(instance.options).toEqual({
      capabilities: ['z', 'a'],
      limits: { cpuMs: 1, memoryMb: 128 },
      state: deepState,
      onLog,
      onEmit,
    });

    expect(defaultLimits).toEqual({ cpuMs: 1, memoryMb: 2 });
    expect(hoisted.wasmSandboxInit).toHaveBeenCalledTimes(1);
    expect(pool._totalCount).toBe(1);
    expect(pool._inUseCount).toBe(1);
  });

  it('acquire reuses an idle sandbox, clears timeout, and applies safe recycle defaults', async () => {
    const pool = new SandboxPool({
      defaultCapabilities: ['a', 'b'],
      defaultLimits: { cpuMs: 10, memoryMb: 64 },
    });

    const sb1 = await pool.acquire();

    pool._inUseCount = 0;
    const key = pool._getCapabilityKey(pool.defaultCapabilities);
    pool._pools.set(key, [{ sandbox: sb1, timeoutId: undefined }]);

    const sb2 = await pool.acquire({
      state: '',
      onLog: '',
      onEmit: undefined,
      limits: { cpuMs: 99 },
    });

    expect(sb2).toBe(sb1);
    expect(hoisted.sandboxInstances).toHaveLength(1);

    expect(hoisted.wasmSandboxRecycle).toHaveBeenCalledTimes(1);
    const recycleArgs = hoisted.wasmSandboxRecycle.mock.calls[0]?.[0];

    expect(recycleArgs).toEqual(
      expect.objectContaining({
        state: {},
        limits: { cpuMs: 99, memoryMb: 64 },
      }),
    );
    expect(typeof recycleArgs.onLog).toBe('function');
    expect(typeof recycleArgs.onEmit).toBe('function');

    expect(hoisted.wasmSandboxInit).toHaveBeenCalledTimes(2);
    expect(pool._inUseCount).toBe(1);
  });

  it('queues concurrent acquires at maxActive and drains FIFO once capacity is free', async () => {
    const pool = new SandboxPool({
      maxActive: 1,
      defaultCapabilities: ['a'],
      defaultLimits: { cpuMs: 1 },
    });

    const sb1 = await pool.acquire();

    const p2 = pool.acquire({ state: { requestId: 2 } });
    const p3 = pool.acquire({ state: { requestId: 3 } });

    expect(pool._waitQueue).toHaveLength(2);

    // Flush the drain microtask scheduled by acquire() so it doesn't race the manual drain below.
    // At this point the pool is still at maxActive, so the scheduled drain is a no-op.
    await Promise.resolve();

    const key = pool._getCapabilityKey(pool.defaultCapabilities);

    pool._inUseCount = 0;
    pool._pools.set(key, [{ sandbox: sb1, timeoutId: undefined }]);
    await pool._drainWaitQueue();

    const sb2 = await p2;
    expect(sb2).toBe(sb1);
    expect(hoisted.wasmSandboxRecycle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ state: { requestId: 2 } }),
    );

    let p3Resolved = false;
    p3.then(() => {
      p3Resolved = true;
    });
    await Promise.resolve();
    expect(p3Resolved).toBe(false);
    expect(pool._waitQueue).toHaveLength(1);

    pool._inUseCount = 0;
    pool._pools.set(key, [{ sandbox: sb1, timeoutId: undefined }]);
    await pool._drainWaitQueue();

    const sb3 = await p3;
    expect(sb3).toBe(sb1);
    expect(hoisted.wasmSandboxRecycle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ state: { requestId: 3 } }),
    );
    expect(pool._waitQueue).toHaveLength(0);
  });

  it('_scheduleDrain logs and rejects all waiters when drain fails', async () => {
    const pool = new SandboxPool({ maxActive: 1 });

    await pool.acquire();

    const err = new Error('boom');
    pool._drainWaitQueue = vi.fn().mockRejectedValue(err);

    const p = pool.acquire({ state: { id: 1 } });

    await expect(p).rejects.toThrow('boom');
    expect(pool._waitQueue).toHaveLength(0);
    expect(hoisted.mockLogger.error).toHaveBeenCalledWith(
      'SandboxPool drain failed',
      expect.objectContaining({ error: 'boom' }),
    );
  });

  it('_rejectAllWaiters clears the queue and normalizes non-Error reasons', () => {
    const pool = new SandboxPool();

    const reject1 = vi.fn();
    const reject2 = vi.fn();
    pool._waitQueue.push(
      { key: 'k', options: {}, resolve: vi.fn(), reject: reject1 },
      { key: 'k', options: {}, resolve: vi.fn(), reject: reject2 },
    );

    pool._rejectAllWaiters('  ');

    expect(pool._waitQueue).toHaveLength(0);
    expect(reject1).toHaveBeenCalledWith(expect.any(Error));
    expect(reject2).toHaveBeenCalledWith(expect.any(Error));
    expect(reject1.mock.calls[0][0].message).toContain('  ');
  });
});
