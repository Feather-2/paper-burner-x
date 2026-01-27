import { describe, it, expect, vi, beforeEach } from 'vitest';

const SCHEDULER_PATH = '../../../../../js/agents/plugins/services/scheduler.js';
const PLUGIN_CORE_PATH = '../../../../../js/agents/plugins/core/plugin.js';

vi.mock(PLUGIN_CORE_PATH, () => ({
  createPlugin: vi.fn(definition => definition),
}));

function deferred() {
  /** @type {(value: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function getPathValue(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPathValue(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

function mergePathObject(obj, path, partial) {
  const existing = getPathValue(obj, path);
  const base = existing != null && typeof existing === 'object' ? existing : {};
  setPathValue(obj, path, { ...base, ...partial });
}

function createMockCtx(configOverrides = {}) {
  const stateData = {};

  const state = {
    get: vi.fn(path => getPathValue(stateData, path)),
    set: vi.fn((path, value) => setPathValue(stateData, path, value)),
    merge: vi.fn((path, partial) => mergePathObject(stateData, path, partial)),
  };

  const events = { emit: vi.fn() };

  const services = new Map();
  const registerService = vi.fn((name, service) => {
    services.set(name, service);
  });

  return {
    config: { maxConcurrent: 5, defaultTimeout: 60000, ...configOverrides },
    state,
    stateData,
    events,
    registerService,
    services,
  };
}

function emitted(ctx, eventName) {
  return ctx.events.emit.mock.calls.filter(([name]) => name === eventName);
}

async function flushImmediate() {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  await Promise.resolve();
}

async function withScheduler(configOverrides, fn) {
  vi.useFakeTimers();
  vi.stubGlobal('setImmediate', undefined);

  const mod = await import(SCHEDULER_PATH);
  const plugin = mod.default;

  const ctx = createMockCtx(configOverrides);
  plugin.install(ctx);

  const service = ctx.services.get('scheduler');
  if (!service) throw new Error('scheduler service was not registered');

  try {
    await fn({ mod, plugin, ctx, service });
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TaskPriority', () => {
  it('defines expected numeric priorities', async () => {
    const mod = await import(SCHEDULER_PATH);

    expect(mod.TaskPriority).toEqual({
      LOW: 0,
      NORMAL: 1,
      HIGH: 2,
      CRITICAL: 3,
    });

    const values = Object.values(mod.TaskPriority);
    expect(values.every(v => typeof v === 'number')).toBe(true);
    expect(new Set(values).size).toBe(values.length);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(3);
  });
});

describe('default (scheduler plugin)', () => {
  it('exposes expected plugin metadata and uses createPlugin', async () => {
    const mod = await import(SCHEDULER_PATH);
    const plugin = mod.default;

    expect(plugin).toMatchObject({
      name: 'service/scheduler',
      version: '1.0.0',
      description: '任务调度器',
      defaultConfig: { maxConcurrent: 5, defaultTimeout: 60000 },
    });
    expect(typeof plugin.install).toBe('function');

    const core = await import(PLUGIN_CORE_PATH);
    expect(core.createPlugin).toHaveBeenCalledTimes(1);
    expect(core.createPlugin).toHaveBeenCalledWith(expect.objectContaining({ name: 'service/scheduler' }));
  });

  it('install registers the scheduler service', async () => {
    await withScheduler({}, async ({ ctx, service }) => {
      expect(ctx.registerService).toHaveBeenCalledTimes(1);
      expect(ctx.registerService).toHaveBeenCalledWith('scheduler', expect.any(Object));
      expect(typeof service.schedule).toBe('function');
      expect(typeof service.cancel).toBe('function');
    });
  });

  describe('schedule', () => {
    it('resolves non-function tasks for null/undefined/empty values and boundary numbers', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ service }) => {
        const cases = [
          { name: 'null', value: null },
          { name: 'undefined', value: undefined },
          { name: 'empty string', value: '' },
          { name: 'whitespace string', value: '   ' },
          { name: 'empty array', value: [] },
          { name: 'empty object', value: {} },
          { name: '0', value: 0 },
          { name: '-1', value: -1 },
          { name: 'MAX_SAFE_INTEGER', value: Number.MAX_SAFE_INTEGER },
        ];

        for (const { name, value } of cases) {
          const p = service.schedule(value);
          await flushImmediate();
          // eslint-disable-next-line no-await-in-loop
          await expect(p, name).resolves.toBe(value);
        }
      });
    });

    it('passes through large and deeply nested results', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ service }) => {
        const bigString = 'x'.repeat(100_000);
        const bigArray = Array.from({ length: 10_000 }, (_, i) => i);

        let deep = { leaf: 'ok' };
        for (let i = 0; i < 120; i++) deep = { next: deep };

        const p1 = service.schedule(() => bigString);
        const p2 = service.schedule(() => bigArray);
        const p3 = service.schedule(() => deep);

        await flushImmediate();
        await flushImmediate();

        await expect(p1).resolves.toBe(bigString);
        await expect(p2).resolves.toBe(bigArray);
        await expect(p3).resolves.toBe(deep);
      });
    });

    it('emits queued/start/complete events and updates stats/running', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ mod, ctx, service }) => {
        const p = service.schedule(() => 123, undefined);

        expect(ctx.state.get('stats.queued')).toBeUndefined();
        expect(ctx.stateData.stats?.queued).toBe(1);

        const queuedCalls = emitted(ctx, 'scheduler.task.queued');
        expect(queuedCalls).toHaveLength(1);
        expect(queuedCalls[0][1]).toMatchObject({ id: 1, priority: mod.TaskPriority.NORMAL });

        await flushImmediate();
        await expect(p).resolves.toBe(123);

        const startCalls = emitted(ctx, 'scheduler.task.start');
        const completeCalls = emitted(ctx, 'scheduler.task.complete');
        const errorCalls = emitted(ctx, 'scheduler.task.error');

        expect(startCalls).toHaveLength(1);
        expect(startCalls[0][1]).toMatchObject({ id: 1, priority: mod.TaskPriority.NORMAL });
        expect(completeCalls).toHaveLength(1);
        expect(completeCalls[0][1]).toMatchObject({ id: 1 });
        expect(errorCalls).toHaveLength(0);

        const runningValues = ctx.state.set.mock.calls
          .filter(([k]) => k === 'running')
          .map(([, v]) => v);
        expect(runningValues).toContain(1);
        expect(runningValues[runningValues.length - 1]).toBe(0);
      });
    });

    it('executes higher priority tasks first when queued before processing', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ mod, ctx, service }) => {
        const seen = [];

        const dLow = deferred();
        const dCritical = deferred();
        const dNormal = deferred();

        const pLow = service.schedule(() => {
          seen.push('LOW');
          return dLow.promise;
        }, mod.TaskPriority.LOW);

        const pCritical = service.schedule(() => {
          seen.push('CRITICAL');
          return dCritical.promise;
        }, mod.TaskPriority.CRITICAL);

        const pNormal = service.schedule(() => {
          seen.push('NORMAL');
          return dNormal.promise;
        }, mod.TaskPriority.NORMAL);

        await flushImmediate();
        expect(seen[0]).toBe('CRITICAL');

        const starts = emitted(ctx, 'scheduler.task.start');
        expect(starts).toHaveLength(1);
        expect(starts[0][1]).toMatchObject({ id: 2, priority: mod.TaskPriority.CRITICAL });

        dCritical.resolve('c');
        await flushImmediate();

        dNormal.resolve('n');
        await flushImmediate();

        dLow.resolve('l');
        await flushImmediate();

        await expect(pCritical).resolves.toBe('c');
        await expect(pNormal).resolves.toBe('n');
        await expect(pLow).resolves.toBe('l');

        expect(seen).toEqual(['CRITICAL', 'NORMAL', 'LOW']);
      });
    });

    it('executes FIFO within the same priority', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ mod, ctx, service }) => {
        const seen = [];

        const d1 = deferred();
        const d2 = deferred();

        const p1 = service.schedule(() => {
          seen.push('first');
          return d1.promise;
        }, mod.TaskPriority.NORMAL);

        const p2 = service.schedule(() => {
          seen.push('second');
          return d2.promise;
        }, mod.TaskPriority.NORMAL);

        await flushImmediate();
        expect(seen).toEqual(['first']);
        expect(emitted(ctx, 'scheduler.task.start')[0][1]).toMatchObject({ id: 1, priority: mod.TaskPriority.NORMAL });

        d1.resolve('ok1');
        await flushImmediate();

        d2.resolve('ok2');
        await flushImmediate();

        await expect(p1).resolves.toBe('ok1');
        await expect(p2).resolves.toBe('ok2');

        const starts = emitted(ctx, 'scheduler.task.start');
        expect(starts).toHaveLength(2);
        expect(starts[0][1]).toMatchObject({ id: 1 });
        expect(starts[1][1]).toMatchObject({ id: 2 });
      });
    });

    it('enforces maxConcurrent under rapid scheduling', async () => {
      await withScheduler({ maxConcurrent: 2, defaultTimeout: 10_000 }, async ({ ctx, service }) => {
        let current = 0;
        let maxSeen = 0;

        const tasks = Array.from({ length: 5 }, () => deferred());
        const promises = tasks.map((d, idx) =>
          service.schedule(() => {
            current++;
            maxSeen = Math.max(maxSeen, current);
            return d.promise.finally(() => {
              current--;
            });
          }, idx % 2 === 0 ? 1 : 1)
        );

        await flushImmediate();

        const started = emitted(ctx, 'scheduler.task.start');
        expect(started).toHaveLength(2);
        expect(maxSeen).toBe(2);
        expect(current).toBe(2);

        tasks[0].resolve('t1');
        tasks[1].resolve('t2');
        await flushImmediate();

        tasks[2].resolve('t3');
        tasks[3].resolve('t4');
        await flushImmediate();

        tasks[4].resolve('t5');
        await flushImmediate();

        await expect(Promise.all(promises)).resolves.toEqual(['t1', 't2', 't3', 't4', 't5']);
        expect(maxSeen).toBe(2);

        const runningValues = ctx.state.set.mock.calls
          .filter(([k]) => k === 'running')
          .map(([, v]) => v);
        expect(Math.max(...runningValues)).toBe(2);
        expect(runningValues[runningValues.length - 1]).toBe(0);
      });
    });

    it('rejects when priority key is invalid (type/boundary)', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ service, ctx }) => {
        const invalidPriorities = [
          -1,
          Number.MAX_SAFE_INTEGER,
          null,
          '2',
          '   ',
          {},
          [],
        ];

        for (const prio of invalidPriorities) {
          ctx.events.emit.mockClear();

          // eslint-disable-next-line no-await-in-loop
          await expect(service.schedule(() => 1, prio)).rejects.toBeInstanceOf(Error);
          expect(emitted(ctx, 'scheduler.task.queued')).toHaveLength(0);
          expect(emitted(ctx, 'scheduler.task.start')).toHaveLength(0);
        }
      });
    });

    it('rejects and emits error when taskFn throws', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ ctx, service }) => {
        const p = service.schedule(() => {
          throw new Error('boom');
        });

        await flushImmediate();
        await expect(p).rejects.toThrow('boom');

        const errors = emitted(ctx, 'scheduler.task.error');
        expect(errors).toHaveLength(1);
        expect(errors[0][1]).toMatchObject({ id: 1, error: 'boom' });

        const completes = emitted(ctx, 'scheduler.task.complete');
        expect(completes).toHaveLength(0);
      });
    });

    it('rejects and emits error when taskFn rejects', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ ctx, service }) => {
        const p = service.schedule(() => Promise.reject(new Error('nope')));

        await flushImmediate();
        await expect(p).rejects.toThrow('nope');

        const errors = emitted(ctx, 'scheduler.task.error');
        expect(errors).toHaveLength(1);
        expect(errors[0][1]).toMatchObject({ id: 1, error: 'nope' });
      });
    });

    it('times out long-running task and emits error', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 50 }, async ({ ctx, service }) => {
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

        const p = service.schedule(() => new Promise(() => {}));

        await flushImmediate();

        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();
        await Promise.resolve();

        await expect(p).rejects.toThrow('Task timeout');

        const errors = emitted(ctx, 'scheduler.task.error');
        expect(errors).toHaveLength(1);
        expect(errors[0][1]).toMatchObject({ id: 1, error: 'Task timeout' });

        expect(clearSpy).toHaveBeenCalled();
      });
    });

    it('clears timeout on completion (no later error)', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 10 }, async ({ ctx, service }) => {
        const p = service.schedule(() => 'ok');
        await flushImmediate();
        await expect(p).resolves.toBe('ok');

        const errorsBefore = emitted(ctx, 'scheduler.task.error').length;

        await vi.advanceTimersByTimeAsync(10);
        await Promise.resolve();
        await Promise.resolve();

        const errorsAfter = emitted(ctx, 'scheduler.task.error').length;
        expect(errorsAfter).toBe(errorsBefore);
      });
    });
  });

  describe('cancel', () => {
    it('cancels a queued task and rejects its promise (maxConcurrent=0 boundary)', async () => {
      await withScheduler({ maxConcurrent: 0, defaultTimeout: 1000 }, async ({ ctx, service }) => {
        const p = service.schedule(() => 'never runs');

        const ok = service.cancel(1);
        expect(ok).toBe(true);

        await expect(p).rejects.toThrow('Task cancelled');

        const cancelled = emitted(ctx, 'scheduler.task.cancelled');
        expect(cancelled).toHaveLength(1);
        expect(cancelled[0][1]).toMatchObject({ id: 1 });
      });
    });

    it('returns false for missing/invalid taskId values', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ ctx, service }) => {
        const cases = [0, -1, Number.MAX_SAFE_INTEGER, '1', null, undefined, {}, [], '   '];

        for (const id of cases) {
          ctx.events.emit.mockClear();
          expect(service.cancel(id)).toBe(false);
          expect(emitted(ctx, 'scheduler.task.cancelled')).toHaveLength(0);
        }
      });
    });

    it('does not cancel a running task', async () => {
      await withScheduler({ maxConcurrent: 1, defaultTimeout: 1000 }, async ({ ctx, service }) => {
        const d = deferred();

        const p = service.schedule(() => d.promise);

        await flushImmediate();
        expect(emitted(ctx, 'scheduler.task.start')).toHaveLength(1);

        expect(service.cancel(1)).toBe(false);
        expect(emitted(ctx, 'scheduler.task.cancelled')).toHaveLength(0);

        d.resolve('done');
        await flushImmediate();

        await expect(p).resolves.toBe('done');
      });
    });
  });
});