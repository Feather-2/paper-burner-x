import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileURLToPath } from 'node:url';

import ToolExecutor, { createToolExecutor, executeTool } from '../../../../js/agents/runtime/tools/tool-executor.js';

const POOLS_KEY = '__PB_TOOL_EXECUTOR_WORKER_POOLS_V1__';

function getNodeWorkerPoolKey() {
  // Keep the logic in sync with ToolExecutor._executeInNodeWorker() so we can pre-seed the global pool map.
  const toolExecutorPath = fileURLToPath(
    new URL('../../../../js/agents/runtime/tools/tool-executor.js', import.meta.url)
  );
  const workerPath = toolExecutorPath.replace(/tool-executor\.js$/i, 'tool-executor-worker.js');
  return `node:${workerPath}`;
}

function getWebWorkerPoolKey() {
  // Keep the logic in sync with ToolExecutor._executeInWebWorker() so we can pre-seed the global pool map.
  const workerEntryUrl = new URL(
    '../../../../js/agents/runtime/tools/tool-executor-webworker.js',
    import.meta.url
  ).toString();
  return `web:${workerEntryUrl}`;
}

class FakeWorker {
  constructor() {
    /** @type {Record<string, Set<Function>>} */
    this._listeners = {
      message: new Set(),
      error: new Set(),
      exit: new Set(),
    };

    /** @type {any} */
    this.lastPosted = null;

    this.on = vi.fn((type, fn) => {
      this._listeners[type]?.add(fn);
    });

    this.off = vi.fn((type, fn) => {
      this._listeners[type]?.delete(fn);
    });

    this.postMessage = vi.fn((payload) => {
      this.lastPosted = payload;
      const mode = payload?.args?.__mode;

      if (mode === 'throwPostMessage') {
        throw new Error('postMessage failed');
      }

      if (mode === 'hang') {
        // Never respond; allow the main-thread timeout to trigger cleanup.
        return;
      }

      if (mode === 'errorEvent') {
        queueMicrotask(() => {
          for (const fn of [...this._listeners.error]) fn(new Error('worker crashed'));
        });
        return;
      }

      if (mode === 'exitNonZero') {
        queueMicrotask(() => {
          for (const fn of [...this._listeners.exit]) fn(2);
        });
        return;
      }

      if (mode === 'exit0ThenResult') {
        queueMicrotask(() => {
          for (const fn of [...this._listeners.exit]) fn(0);
        });
        queueMicrotask(() => {
          for (const fn of [...this._listeners.message]) fn({ type: 'result', result: payload?.args?.value ?? 1 });
        });
        return;
      }

      if (mode === 'errorMessage') {
        queueMicrotask(() => {
          for (const fn of [...this._listeners.message]) {
            fn({
              type: 'error',
              error: { message: 'boom', name: 'TypeError', stack: 'STACK' },
            });
          }
        });
        return;
      }

      // Default: successful execution.
      queueMicrotask(() => {
        for (const fn of [...this._listeners.message]) fn({ type: 'result', result: payload?.args?.value ?? 1 });
      });
    });
  }
}

class FakePool {
  constructor(worker) {
    this.worker = worker;
    this.acquire = vi.fn(async () => ({ worker }));
    this.release = vi.fn();
    this.destroy = vi.fn(async () => {});
    this.setMaxWorkers = vi.fn();
  }
}

class FakeWebWorker {
  constructor() {
    /** @type {Record<string, Set<Function>>} */
    this._listeners = {
      message: new Set(),
      error: new Set(),
    };

    /** @type {any} */
    this.lastPosted = null;

    this.addEventListener = vi.fn((type, fn) => {
      this._listeners[type]?.add(fn);
    });

    this.removeEventListener = vi.fn((type, fn) => {
      this._listeners[type]?.delete(fn);
    });

    this.postMessage = vi.fn((payload) => {
      this.lastPosted = payload;
      const mode = payload?.args?.__mode;
      if (mode === 'throwPostMessage') {
        throw new Error('web postMessage failed');
      }
      if (mode === 'hang') return;
      if (mode === 'errorEvent') {
        queueMicrotask(() => {
          for (const fn of [...this._listeners.error]) fn(new Error('web worker crashed'));
        });
        return;
      }
      if (mode === 'errorMessage') {
        queueMicrotask(() => {
          for (const fn of [...this._listeners.message]) {
            fn({ data: { type: 'error', error: { message: 'web boom', name: 'Error', stack: 'STACK' } } });
          }
        });
        return;
      }
      queueMicrotask(() => {
        for (const fn of [...this._listeners.message]) fn({ data: { type: 'result', result: payload?.args } });
      });
    });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete globalThis[POOLS_KEY];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis[POOLS_KEY];
});

describe('runtime/tools/tool-executor: additional branches', () => {
  it('normalizes null/undefined tool results to { success:true, data:null }', async () => {
    const executor = new ToolExecutor({
      tools: {
        undef: { handler: async () => undefined },
        nil: { handler: async () => null },
      },
    });

    const r1 = await executor.execute('undef', {}, {}, { retries: 0 });
    expect(r1.success).toBe(true);
    expect(r1.data).toBe(null);

    const r2 = await executor.execute('nil', {}, {}, { retries: 0 });
    expect(r2.success).toBe(true);
    expect(r2.data).toBe(null);
  });

  it('emits tool lifecycle events when emit() is provided', async () => {
    const emit = vi.fn();
    const executor = new ToolExecutor({
      emit,
      maxRetries: 0,
      tools: {
        ok: { handler: async () => 1 },
        fail: { handler: async () => { throw new Error('boom'); } },
      },
    });

    await executor.execute('ok', {}, {}, { retries: 0 });
    await executor.execute('fail', {}, {}, { retries: 0 });

    expect(emit).toHaveBeenCalledWith('tool.completed', expect.any(Object));
    expect(emit).toHaveBeenCalledWith('tool.failed', expect.any(Object));
  });

  it('supports createToolExecutor() and executeTool() helpers', async () => {
    const executor = createToolExecutor({ tools: { t: { handler: async () => 'ok' } } });
    const res = await executor.execute('t', {}, {}, { retries: 0 });
    expect(res.success).toBe(true);
    expect(res.data).toBe('ok');

    const res2 = await executeTool({ t: { handler: async () => 'ok2' } }, 't', {}, {});
    expect(res2.success).toBe(true);
    expect(res2.data).toBe('ok2');
  });

  it('supports getToolDefinitions() with parameters fallbacks', () => {
    const executor = new ToolExecutor({
      tools: {
        a: { description: 'A', parameters: { x: { type: 'string' } }, handler: async () => {} },
        b: { description: 'B', definition: { parameters: { y: { type: 'number' } } }, handler: async () => {} },
        c: { handler: async () => {} },
      },
    });

    expect(executor.getToolDefinitions()).toEqual([
      { name: 'a', description: 'A', parameters: { x: { type: 'string' } } },
      { name: 'b', description: 'B', parameters: { y: { type: 'number' } } },
      { name: 'c', description: '', parameters: {} },
    ]);
  });

  it('resolves workerPool maxWorkers from options.workerPool/maxWorkers or workerPoolMax', () => {
    const e1 = new ToolExecutor({ workerPool: { maxWorkers: 7 } });
    expect(e1._workerPoolMax).toBe(7);

    const e2 = new ToolExecutor({ workerPoolMax: 5 });
    expect(e2._workerPoolMax).toBe(5);

    const e3 = new ToolExecutor({ workerPool: { maxWorkers: 'nope' } });
    expect(e3._workerPoolMax).toBe(2);
  });

  it('continues when a before-hook throws, and allows before-hooks to rewrite params', async () => {
    const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const handler = vi.fn(async (args) => args);

    const executor = new ToolExecutor({
      logger,
      tools: { t: { handler } },
      hooks: {
        before: [
          async () => { throw new Error('hook boom'); },
          async () => ({ params: { rewritten: true } }),
        ],
        after: [],
      },
    });

    const res = await executor.execute('t', { original: true }, {}, { retries: 0 });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ rewritten: true });
    expect(handler).toHaveBeenCalledWith({ rewritten: true }, {});
    expect(logger.warn).toHaveBeenCalled();
  });

  it('allows after-hooks to override results and swallows after-hook errors', async () => {
    const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() };
    const handler = vi.fn(async () => 1);

    const executor = new ToolExecutor({
      logger,
      tools: { t: { handler } },
      hooks: {
        before: [],
        after: [
          async () => { throw new Error('after boom'); },
          async () => 42,
        ],
      },
    });

    const res = await executor.execute('t', {}, {}, { retries: 0 });

    expect(res.success).toBe(true);
    expect(res.data).toBe(42);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('retries on failure with exponential backoff', async () => {
    vi.useFakeTimers();

    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce('ok');

    const executor = new ToolExecutor({ tools: { t: { handler } }, maxRetries: 1 });

    const p = executor.execute('t', {}, {}, { retries: 1, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    const res = await p;

    expect(res.success).toBe(true);
    expect(res.data).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not timeout when the handler resolves right before timeoutMs', async () => {
    vi.useFakeTimers();

    const handler = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4));
      return 'ok';
    });

    const executor = new ToolExecutor({ tools: { t: { handler } } });

    const p = executor.execute('t', {}, {}, { retries: 0, timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(4);
    const res = await p;

    expect(res.success).toBe(true);
    expect(res.data).toBe('ok');
  });

  it('executes worker-mode tools via a pooled worker and releases/destroys resources', async () => {
    const moduleUrl = new URL('./fixtures/worker-tool.js', import.meta.url).toString();

    const worker = new FakeWorker();
    const pool = new FakePool(worker);
    const pools = new Map();
    pools.set(getNodeWorkerPoolKey(), pool);
    globalThis[POOLS_KEY] = pools;

    const handler = vi.fn(async () => {
      throw new Error('should not be called in worker mode');
    });

    const executor = new ToolExecutor({
      tools: {
        t: {
          handler,
          worker: { moduleUrl, exportName: 'handler' },
        },
      },
      workerPoolMax: 3,
    });

    const res = await executor.execute(
      't',
      { __mode: 'exit0ThenResult', value: 123 },
      // Include a non-cloneable state value so _createWorkerContextSnapshot hits its structuredClone failure path.
      { runId: 'run1', state: { fn: () => {} } },
      { isolation: 'worker', retries: 0, timeoutMs: 1000 }
    );

    expect(res.success).toBe(true);
    expect(res.data).toBe(123);
    expect(handler).not.toHaveBeenCalled();

    // Pool reuse path: existing pool => setMaxWorkers is consulted.
    expect(pool.setMaxWorkers).toHaveBeenCalledWith(3);

    // Listener registration + cleanup.
    expect(worker.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(worker.off).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.off).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.off).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(pool.release).toHaveBeenCalledTimes(1);
    expect(pool.destroy).not.toHaveBeenCalled();

    // structuredClone failure => context snapshot becomes {}
    expect(worker.lastPosted?.context).toEqual({});
  });

  it('creates a Node WorkerPool on first worker-mode execution (no pre-seeded pool)', async () => {
    const moduleUrl = new URL('./fixtures/worker-tool.js', import.meta.url).toString();

    // Ensure the pool-creation branch runs.
    delete globalThis[POOLS_KEY];

    const handler = vi.fn(async () => {
      throw new Error('should not be called in worker mode');
    });

    const executor = new ToolExecutor({
      tools: {
        t: {
          handler,
          worker: { moduleUrl, exportName: 'handler' },
        },
      },
      workerPoolMax: 1,
    });

    const res = await executor.execute('t', { value: 1 }, {}, { isolation: 'worker', retries: 0, timeoutMs: 1000 });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ value: 1 });
    expect(handler).not.toHaveBeenCalled();

    const pools = globalThis[POOLS_KEY];
    expect(pools instanceof Map).toBe(true);
    expect(pools.get(getNodeWorkerPoolKey())).toBeTruthy();
  });

  it('covers the WebWorker execution path and cleans up event listeners', async () => {
    // Only required for the "Worker unavailable" guard.
    vi.stubGlobal('Worker', function Worker() {});

    const executor = new ToolExecutor({ workerPoolMax: 2 });
    const worker = new FakeWebWorker();
    const pool = new FakePool(worker);
    const pools = new Map();
    pools.set(getWebWorkerPoolKey(), pool);
    globalThis[POOLS_KEY] = pools;

    const moduleUrl = new URL('./fixtures/worker-tool.js', import.meta.url).toString();
    const result = await executor._executeInWebWorker(moduleUrl, 'handler', { ok: true }, { runId: 'r1', state: {} }, 1000);

    expect(result).toEqual({ ok: true });
    expect(worker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(pool.release).toHaveBeenCalledTimes(1);
  });

  it('destroys web workers on webworker error paths (message/error/timeout/postMessage)', async () => {
    vi.stubGlobal('Worker', function Worker() {});

    const moduleUrl = new URL('./fixtures/worker-tool.js', import.meta.url).toString();

    async function run(mode, { timeout = 10 } = {}) {
      const executor = new ToolExecutor();
      const worker = new FakeWebWorker();
      const pool = new FakePool(worker);
      const pools = new Map();
      pools.set(getWebWorkerPoolKey(), pool);
      globalThis[POOLS_KEY] = pools;

      if (mode === 'hang') vi.useFakeTimers();

      const p = executor._executeInWebWorker(moduleUrl, 'handler', { __mode: mode }, {}, timeout);
      // Attach a rejection handler immediately so timeouts/errors don't trigger unhandledRejection warnings.
      const outcome = p.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error })
      );

      if (mode === 'hang') await vi.advanceTimersByTimeAsync(timeout);

      return { outcome: await outcome, pool, worker };
    }

    {
      const { outcome, pool } = await run('errorMessage');
      expect(outcome.ok).toBe(false);
      expect(String(outcome.error)).toMatch(/web boom/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { outcome, pool } = await run('errorEvent');
      expect(outcome.ok).toBe(false);
      expect(String(outcome.error)).toMatch(/web worker crashed/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { outcome, pool } = await run('throwPostMessage');
      expect(outcome.ok).toBe(false);
      expect(String(outcome.error)).toMatch(/web postMessage failed/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { outcome, pool } = await run('hang', { timeout: 5 });
      expect(outcome.ok).toBe(false);
      expect(String(outcome.error)).toMatch(/timed out/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it('destroys workers on worker-message errors / errors / exit non-zero / timeout / postMessage failures', async () => {
    const moduleUrl = new URL('./fixtures/worker-tool.js', import.meta.url).toString();

    async function run(mode) {
      if (mode === 'hang') {
        // Ensure the timeout inside _executeInNodeWorker is controlled by fake timers.
        vi.useFakeTimers();
      }

      const worker = new FakeWorker();
      const pool = new FakePool(worker);
      const pools = new Map();
      pools.set(getNodeWorkerPoolKey(), pool);
      globalThis[POOLS_KEY] = pools;

      const executor = new ToolExecutor({
        tools: {
          t: {
            handler: async () => 1,
            worker: { moduleUrl, exportName: 'handler' },
          },
        },
      });

      const p = executor.execute('t', { __mode: mode }, {}, { isolation: 'worker', retries: 0, timeoutMs: 5 });
      if (mode === 'hang') {
        await vi.advanceTimersByTimeAsync(5);
      }

      const res = await p;
      return { res, worker, pool };
    }

    {
      const { res, pool } = await run('errorMessage');
      expect(res.success).toBe(false);
      expect(String(res.error)).toMatch(/boom/);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { res, pool } = await run('errorEvent');
      expect(res.success).toBe(false);
      expect(String(res.error)).toMatch(/worker crashed/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { res, pool } = await run('exitNonZero');
      expect(res.success).toBe(false);
      expect(String(res.error)).toMatch(/exited with code/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { res, pool } = await run('throwPostMessage');
      expect(res.success).toBe(false);
      expect(String(res.error)).toMatch(/postMessage failed/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }

    {
      const { res, pool } = await run('hang');
      expect(res.success).toBe(false);
      expect(String(res.error)).toMatch(/timed out/i);
      expect(pool.destroy).toHaveBeenCalledTimes(1);
    }
  });
});
