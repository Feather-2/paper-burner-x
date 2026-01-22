import { describe, it, expect, vi, beforeEach } from 'vitest';

var wasmInstances = [];
var initBehaviors = [];
var loggerError;

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

vi.mock('../../../../../js/agents/core/sandbox/wasm-sandbox.js', () => {
  class MockWasmSandbox {
    constructor(options) {
      this.options = options;
      this.capabilities = options.capabilities;
      this._disposed = false;
      this.lastRecycle = null;
      this.recycle = vi.fn((payload) => {
        this.lastRecycle = payload;
      });
      this.init = vi.fn(() => {
        if (!initBehaviors.length) return Promise.resolve();

        const behavior = initBehaviors.shift();
        if (behavior instanceof Error) return Promise.reject(behavior);
        if (behavior && typeof behavior.then === 'function') return behavior;
        if (typeof behavior === 'function') return Promise.resolve().then(behavior);
        return Promise.resolve(behavior);
      });
      this.dispose = vi.fn(() => {
        this._disposed = true;
      });
      wasmInstances.push(this);
    }
  }

  const WasmSandbox = vi.fn(function WasmSandbox(options) {
    return new MockWasmSandbox(options);
  });

  return { WasmSandbox };
});

vi.mock('../../../../../js/agents/core/sandbox/constants.js', () => ({
  SandboxPreset: { SKILL: ['skill-default'] },
  ResourceLimits: { STANDARD: { cpu: 1, memory: 256 } },
}));

vi.mock('../../../../../js/agents/shared/index.js', () => {
  loggerError = vi.fn();
  return {
    createLogger: vi.fn(() => ({ error: loggerError })),
  };
});

import SandboxPool, { SandboxPool as NamedSandboxPool } from '../../../../../js/agents/core/sandbox/pool.js';
import { WasmSandbox } from '../../../../../js/agents/core/sandbox/wasm-sandbox.js';
import { SandboxPreset, ResourceLimits } from '../../../../../js/agents/core/sandbox/constants.js';

describe('SandboxPool', () => {
  beforeEach(() => {
    wasmInstances = [];
    initBehaviors = [];
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('exports SandboxPool as both named and default', () => {
    expect(SandboxPool).toBe(NamedSandboxPool);
  });

  it('applies defaults and boundary options', () => {
    const defaults = new SandboxPool();

    expect(defaults.maxSize).toBe(4);
    expect(defaults.maxActive).toBe(4);
    expect(defaults.idleTimeoutMs).toBe(60000);
    expect(defaults.defaultCapabilities).toBe(SandboxPreset.SKILL);
    expect(defaults.defaultLimits).toBe(ResourceLimits.STANDARD);

    const zeros = new SandboxPool({
      maxSize: 0,
      maxActive: 0,
      idleTimeoutMs: 0,
      defaultCapabilities: [],
      defaultLimits: {},
    });

    expect(zeros.maxSize).toBe(4);
    expect(zeros.maxActive).toBe(4);
    expect(zeros.idleTimeoutMs).toBe(60000);
    expect(zeros.defaultCapabilities).toEqual([]);
    expect(zeros.defaultLimits).toEqual({});

    const negatives = new SandboxPool({
      maxSize: -1,
      maxActive: -1,
      idleTimeoutMs: -1,
    });

    expect(negatives.maxSize).toBe(-1);
    expect(negatives.maxActive).toBe(1);
    expect(negatives.idleTimeoutMs).toBe(-1);

    const stringNumbers = new SandboxPool({
      maxSize: '2',
      maxActive: '3',
      idleTimeoutMs: '   ',
    });

    expect(stringNumbers.maxSize).toBe('2');
    expect(stringNumbers.maxActive).toBe(3);
    expect(stringNumbers.idleTimeoutMs).toBe('   ');

    const maxValue = new SandboxPool({ maxSize: Number.MAX_SAFE_INTEGER });
    expect(maxValue.maxSize).toBe(Number.MAX_SAFE_INTEGER);

    expect(() => new SandboxPool(null)).toThrow(TypeError);
  });

  it('generates deterministic capability keys and rejects invalid inputs', () => {
    const pool = new SandboxPool();

    expect(pool._getCapabilityKey(['b', 'a'])).toBe('a,b');
    expect(pool._getCapabilityKey([])).toBe('');
    expect(pool._getCapabilityKey([''])).toBe('');
    expect(pool._getCapabilityKey(['   ', 'a'])).toBe('   ,a');

    expect(() => pool._getCapabilityKey({})).toThrow(TypeError);
    expect(() => pool._getCapabilityKey(null)).toThrow(TypeError);
    expect(() => pool._getCapabilityKey(undefined)).toThrow(TypeError);
  });

  it('creates new sandbox with merged limits and tracks stats', async () => {
    const pool = new SandboxPool({
      defaultCapabilities: ['alpha'],
      defaultLimits: { cpu: 1, memory: 2 },
    });

    const onLog = vi.fn();
    const onEmit = vi.fn();

    const sandbox = await pool.acquire({
      limits: { memory: 9 },
      state: { ready: true },
      onLog,
      onEmit,
    });

    expect(WasmSandbox).toHaveBeenCalledTimes(1);
    expect(WasmSandbox.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        capabilities: ['alpha'],
        limits: { cpu: 1, memory: 9 },
        state: { ready: true },
        onLog,
        onEmit,
      })
    );
    expect(sandbox.init).toHaveBeenCalledTimes(1);

    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        active: 1,
        pooled: 0,
        total: 1,
        waiting: 0,
      })
    );

    pool.release(sandbox);
  });

  it('handles edge-case acquire option values', async () => {
    const pool = new SandboxPool();

    await expect(pool.acquire(null)).rejects.toThrow(TypeError);
    await expect(pool.acquire({ capabilities: {} })).rejects.toThrow(TypeError);

    const defaulted = await pool.acquire({ capabilities: null });
    expect(defaulted.options.capabilities).toBe(SandboxPreset.SKILL);
    pool.release(defaulted);

    const sandbox = await pool.acquire({ capabilities: [], limits: null, state: null });
    expect(sandbox.options.capabilities).toEqual([]);
    expect(sandbox.options.limits).toEqual(pool.defaultLimits);
    pool.release(sandbox);

    pool.dispose();
    await expect(pool.acquire()).rejects.toThrow('Pool has been disposed');
  });

  it('reuses pooled sandbox and recycles with resource-heavy state', async () => {
    const pool = new SandboxPool({ maxSize: 2, idleTimeoutMs: 100000 });

    const first = await pool.acquire({ capabilities: ['cap'] });
    pool.release(first);

    const largeFile = new Uint8Array(1024 * 1024);
    const longString = 'x'.repeat(50000);
    const deepState = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: { text: longString },
            },
          },
        },
      },
    };
    const limits = { memory: 512, maxBytes: Number.MAX_SAFE_INTEGER };
    const onLog = vi.fn();
    const onEmit = vi.fn();

    const second = await pool.acquire({
      capabilities: ['cap'],
      state: { file: largeFile, deep: deepState, text: '' },
      limits,
      onLog,
      onEmit,
    });

    expect(second).toBe(first);
    expect(first.lastRecycle).not.toBeNull();
    expect(first.lastRecycle.state).toEqual({
      file: largeFile,
      deep: deepState,
      text: '',
    });
    expect(first.lastRecycle.limits).toEqual({
      ...pool.defaultLimits,
      ...limits,
    });
    expect(first.lastRecycle.onLog).toBe(onLog);
    expect(first.lastRecycle.onEmit).toBe(onEmit);

    pool.release(second);
  });

  it('queues when maxActive reached and hands off on release for same key', async () => {
    const pool = new SandboxPool({ maxActive: 1, maxSize: 2 });

    const first = await pool.acquire({ capabilities: ['a'] });
    const pending = pool.acquire({ capabilities: ['a'], state: { id: 2 } });

    let resolved = false;
    pending.then(() => {
      resolved = true;
    });

    await flushPromises();

    expect(resolved).toBe(false);
    expect(pool.getStats()).toEqual(expect.objectContaining({ active: 1, waiting: 1 }));
    expect(WasmSandbox).toHaveBeenCalledTimes(1);

    pool.release(first);

    const second = await pending;
    expect(second).toBe(first);
    expect(first.lastRecycle.state).toEqual({ id: 2 });
  });

  it('rejects waiter and disposes sandbox when handoff init fails', async () => {
    const pool = new SandboxPool({ maxActive: 1, maxSize: 2 });

    const first = await pool.acquire({ capabilities: ['a'] });
    const pending = pool.acquire({ capabilities: ['a'], state: { id: 3 } });

    await flushPromises();
    initBehaviors.push(new Error('handoff init failed'));

    pool.release(first);

    await expect(pending).rejects.toThrow('handoff init failed');
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().total).toBe(0);
  });

  it('supports concurrent acquires when under maxActive', async () => {
    const pool = new SandboxPool({ maxActive: 2, maxSize: 2 });

    const [first, second] = await Promise.all([
      pool.acquire({ capabilities: ['a'], state: {} }),
      pool.acquire({ capabilities: ['b'], state: {} }),
    ]);

    expect(first).not.toBe(second);
    expect(pool.getStats().active).toBe(2);

    pool.release(first);
    pool.release(second);
  });

  it('rejects waiters and disposes sandbox when drain init fails', async () => {
    const pool = new SandboxPool({ maxActive: 1, maxSize: 1 });

    const first = await pool.acquire({ capabilities: ['a'] });
    const pending = pool.acquire({ capabilities: ['b'] });

    initBehaviors.push(new Error('init failed'));
    pool.release(first);

    await expect(pending).rejects.toThrow('init failed');
    expect(pool.getStats().total).toBe(1);
    expect(wasmInstances.length).toBe(2);
    expect(wasmInstances[1].dispose).toHaveBeenCalledTimes(1);
  });

  it('logs and rejects all waiters when drain throws', async () => {
    const pool = new SandboxPool();

    const reject = vi.fn();
    pool._waitQueue.push({ key: 'x', options: {}, resolve: vi.fn(), reject });

    pool._drainWaitQueue = vi.fn(() => {
      throw new Error('boom');
    });

    pool._scheduleDrain();
    await flushPromises();

    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError.mock.calls[0][0]).toBe('SandboxPool drain failed');
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toBe('boom');
  });

  it('disposes sandbox when pool is at capacity', async () => {
    const pool = new SandboxPool({ maxSize: 1, maxActive: 2 });

    const first = await pool.acquire({ capabilities: ['a'] });
    const second = await pool.acquire({ capabilities: ['a'] });

    pool.release(first);
    pool.release(second);

    expect(pool._pools.get('a').length).toBe(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(pool.getStats().total).toBe(1);
  });

  it('evicts idle sandboxes after timeout', async () => {
    vi.useFakeTimers();

    const pool = new SandboxPool({ maxSize: 1, idleTimeoutMs: 50 });
    const sandbox = await pool.acquire({ capabilities: ['a'] });

    pool.release(sandbox);

    expect(pool.getStats().pooled).toBe(1);

    await vi.runAllTimersAsync();

    expect(sandbox.dispose).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual(expect.objectContaining({ pooled: 0, total: 0 }));

    vi.useRealTimers();
  });

  it('ignores null, undefined, or already disposed sandboxes on release', async () => {
    const pool = new SandboxPool();

    expect(() => pool.release(null)).not.toThrow();
    expect(() => pool.release(undefined)).not.toThrow();

    const sandbox = await pool.acquire({ capabilities: ['a'] });
    sandbox._disposed = true;

    pool.release(sandbox);

    expect(pool.getStats()).toEqual(expect.objectContaining({ pooled: 0, active: 0 }));
  });

  it('releases sandboxes in withSandbox on success and failure', async () => {
    const pool = new SandboxPool();
    const releaseSpy = vi.spyOn(pool, 'release');

    const result = await pool.withSandbox({ capabilities: ['a'] }, async () => 'ok');
    expect(result).toBe('ok');

    await expect(
      pool.withSandbox({ capabilities: ['b'] }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  it('reports stats and clears pooled sandboxes', async () => {
    const pool = new SandboxPool({ maxActive: 2, maxSize: 2, idleTimeoutMs: 100000 });

    const first = await pool.acquire({ capabilities: ['a'] });
    const second = await pool.acquire({ capabilities: ['b'] });

    pool.release(first);

    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        active: 1,
        pooled: 1,
        total: 2,
        waiting: 0,
      })
    );

    pool.clear();
    expect(pool.getStats()).toEqual(expect.objectContaining({ pooled: 0, total: 1 }));
    expect(first.dispose).toHaveBeenCalledTimes(1);

    pool.release(second);
  });

  it('rejects waiters and blocks acquire after dispose', async () => {
    const pool = new SandboxPool({ maxActive: 1, maxSize: 1 });

    const active = await pool.acquire({ capabilities: ['a'] });
    const pending = pool.acquire({ capabilities: ['b'] });

    expect(pool.getStats()).toEqual(
      expect.objectContaining({
        active: 1,
        pooled: 0,
        total: 1,
        waiting: 1,
      })
    );

    pool.dispose();
    pool.dispose();

    await expect(pending).rejects.toThrow('Pool has been disposed');
    await expect(pool.acquire()).rejects.toThrow('Pool has been disposed');

    pool.release(active);
  });
});
