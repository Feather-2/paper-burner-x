import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedCreatePlugin = vi.hoisted(() => vi.fn((config) => config));

vi.mock('../../../../../js/agents/core/plugin.js', () => ({
  createPlugin: mockedCreatePlugin,
}));

import schedulerPlugin, { TaskPriority } from '../../../../../js/agents/plugins/services/scheduler.js';

const hasOwn = Object.prototype.hasOwnProperty;

const getAtPath = (store, path) => {
  if (!path) return store;
  return path.split('.').reduce((current, key) => {
    if (current && hasOwn.call(current, key)) {
      return current[key];
    }
    return undefined;
  }, store);
};

const setAtPath = (store, path, value) => {
  if (!path) return;
  const keys = path.split('.');
  let current = store;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (i === keys.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
};

const createState = () => {
  const store = {};
  return {
    store,
    get: vi.fn((path) => getAtPath(store, path)),
    set: vi.fn((path, value) => setAtPath(store, path, value)),
    merge: vi.fn((path, updates) => {
      const current = getAtPath(store, path);
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        setAtPath(store, path, { ...current, ...updates });
      } else {
        setAtPath(store, path, { ...updates });
      }
    }),
  };
};

const createDeferred = () => {
  /** @type {(value: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const drainImmediates = async (queue, maxRounds = 50) => {
  for (let round = 0; round < maxRounds; round += 1) {
    if (queue.length === 0) {
      await flushMicrotasks();
      if (queue.length === 0) return;
    }
    const batch = queue.splice(0);
    for (const fn of batch) fn();
    await flushMicrotasks();
  }
  if (queue.length > 0) {
    throw new Error('Immediate queue did not drain');
  }
};

const createSchedulerHarness = (configOverrides = {}, onEmit = null) => {
  const immediateQueue = [];
  vi.stubGlobal('setImmediate', (callback, ...args) => {
    immediateQueue.push(() => callback(...args));
    return immediateQueue.length;
  });

  const state = createState();
  const events = {
    emit: vi.fn((event, payload) => {
      if (onEmit) onEmit(event, payload);
    }),
  };
  const log = { info: vi.fn() };

  /** @type {any} */
  const ctx = {
    config: { maxConcurrent: 2, defaultTimeout: 50, ...configOverrides },
    state,
    events,
    log,
    registerService: vi.fn(),
  };

  /** @type {any} */
  let service;
  ctx.registerService.mockImplementation((name, svc) => {
    if (name === 'scheduler') service = svc;
  });

  schedulerPlugin.install(ctx);

  if (!service) throw new Error('Scheduler service not registered');

  return { ctx, service, state, events, log, immediateQueue };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TaskPriority', () => {
  it('defines expected priority numeric values', () => {
    expect(TaskPriority).toEqual({ LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 });
    expect(TaskPriority.LOW).toBeLessThan(TaskPriority.NORMAL);
    expect(TaskPriority.NORMAL).toBeLessThan(TaskPriority.HIGH);
    expect(TaskPriority.HIGH).toBeLessThan(TaskPriority.CRITICAL);
  });
});

describe('default', () => {
  it('exposes plugin metadata and defaults', () => {
    expect(schedulerPlugin.name).toBe('service/scheduler');
    expect(schedulerPlugin.version).toBe('1.0.0');
    expect(schedulerPlugin.description).toBe('任务调度器');
    expect(schedulerPlugin.defaultConfig).toEqual({
      maxConcurrent: 5,
      defaultTimeout: 60000,
    });
    expect(typeof schedulerPlugin.install).toBe('function');
  });

  it('registers the scheduler service and logs install', () => {
    const { ctx, service, log } = createSchedulerHarness();

    expect(ctx.registerService).toHaveBeenCalledWith('scheduler', expect.any(Object));
    expect(service).toBeTruthy();
    expect(typeof service.schedule).toBe('function');
    expect(typeof service.cancel).toBe('function');
    expect(typeof service.getStatus).toBe('function');
    expect(typeof service.getQueueLength).toBe('function');
    expect(log.info).toHaveBeenCalledWith('Scheduler plugin installed');
  });

  it('schedule() resolves boundary/resource values and increments stats', async () => {
    const { service, state, immediateQueue } = createSchedulerHarness({ defaultTimeout: 1000 });

    const longString = 'x'.repeat(200_000);
    const largeBytes = new Uint8Array(1024 * 1024);

    const deepNested = {};
    let cursor = deepNested;
    for (let depth = 0; depth < 200; depth += 1) {
      cursor.next = { depth };
      cursor = cursor.next;
    }

    const values = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { 0: 'a', length: 1 },
      longString,
      largeBytes,
      deepNested,
    ];

    const promises = values.map((value) => service.schedule(value));
    await drainImmediates(immediateQueue);

    const results = await Promise.all(promises);
    for (let i = 0; i < values.length; i += 1) {
      expect(results[i]).toBe(values[i]);
    }
    expect(state.get('stats.queued')).toBe(values.length);
  });

  it('schedule() emits queued/start/complete events for successful tasks', async () => {
    const emitted = [];
    const { service, events, immediateQueue } = createSchedulerHarness({}, (event, payload) => {
      emitted.push([event, payload]);
    });

    const promise = service.schedule(() => 'done', TaskPriority.HIGH);
    await drainImmediates(immediateQueue);

    await expect(promise).resolves.toBe('done');

    const queued = emitted.find(([event]) => event === 'scheduler.task.queued');
    const started = emitted.find(([event]) => event === 'scheduler.task.start');
    const completed = emitted.find(([event]) => event === 'scheduler.task.complete');

    expect(queued).toBeTruthy();
    expect(started).toBeTruthy();
    expect(completed).toBeTruthy();
    expect(queued[1]).toMatchObject({ priority: TaskPriority.HIGH, id: expect.any(Number) });
    expect(started[1]).toMatchObject({ priority: TaskPriority.HIGH, id: queued[1].id });
    expect(completed[1]).toEqual({ id: queued[1].id });
    expect(events.emit).toHaveBeenCalled();
  });

  it('schedule() respects priority ordering with maxConcurrent=1', async () => {
    const startedPriorities = [];
    const { service, immediateQueue } = createSchedulerHarness({ maxConcurrent: 1 }, (event, payload) => {
      if (event === 'scheduler.task.start') startedPriorities.push(payload.priority);
    });

    const low = createDeferred();
    const normal = createDeferred();
    const high = createDeferred();
    const critical = createDeferred();

    const lowPromise = service.schedule(() => low.promise, TaskPriority.LOW);
    const normalPromise = service.schedule(() => normal.promise, TaskPriority.NORMAL);
    const highPromise = service.schedule(() => high.promise, TaskPriority.HIGH);
    const criticalPromise = service.schedule(() => critical.promise, TaskPriority.CRITICAL);

    await drainImmediates(immediateQueue);
    expect(startedPriorities).toEqual([TaskPriority.CRITICAL]);

    critical.resolve('critical');
    await flushMicrotasks();
    await drainImmediates(immediateQueue);
    expect(startedPriorities).toEqual([TaskPriority.CRITICAL, TaskPriority.HIGH]);

    high.resolve('high');
    await flushMicrotasks();
    await drainImmediates(immediateQueue);
    expect(startedPriorities).toEqual([TaskPriority.CRITICAL, TaskPriority.HIGH, TaskPriority.NORMAL]);

    normal.resolve('normal');
    await flushMicrotasks();
    await drainImmediates(immediateQueue);
    expect(startedPriorities).toEqual([TaskPriority.CRITICAL, TaskPriority.HIGH, TaskPriority.NORMAL, TaskPriority.LOW]);

    low.resolve('low');
    await expect(Promise.all([lowPromise, normalPromise, highPromise, criticalPromise])).resolves.toEqual([
      'low',
      'normal',
      'high',
      'critical',
    ]);
  });

  it('schedule() enforces maxConcurrent under concurrent calls', async () => {
    const started = [];
    const completed = [];

    const { service, immediateQueue } = createSchedulerHarness({ maxConcurrent: 2, defaultTimeout: 1000 }, (event, payload) => {
      if (event === 'scheduler.task.start') started.push(payload.id);
      if (event === 'scheduler.task.complete') completed.push(payload.id);
    });

    const first = createDeferred();
    const second = createDeferred();
    const third = createDeferred();

    const p1 = service.schedule(() => first.promise);
    const p2 = service.schedule(() => second.promise);
    const p3 = service.schedule(() => third.promise);

    await drainImmediates(immediateQueue);
    expect(started.length).toBe(2);
    expect(service.getStatus()).toEqual({ running: 2, queued: 1, maxConcurrent: 2 });

    first.resolve('a');
    await flushMicrotasks();
    await drainImmediates(immediateQueue);
    expect(started.length).toBe(3);
    expect(service.getStatus()).toEqual({ running: 2, queued: 0, maxConcurrent: 2 });

    second.resolve('b');
    third.resolve('c');
    await flushMicrotasks();
    await drainImmediates(immediateQueue);

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(['a', 'b', 'c']);
    expect(completed.length).toBe(3);
    expect(service.getStatus()).toEqual({ running: 0, queued: 0, maxConcurrent: 2 });
  });

  it('schedule() handles priority type boundaries', async () => {
    const { service, immediateQueue } = createSchedulerHarness();

    const ok = service.schedule(() => 'ok', '1');
    await drainImmediates(immediateQueue);
    await expect(ok).resolves.toBe('ok');

    await expect(service.schedule('bad', -1)).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', Number.MAX_SAFE_INTEGER)).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', null)).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', {})).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', { 0: 'a', length: 1 })).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', [])).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', '   ')).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', 'not-a-priority')).rejects.toThrow(TypeError);
  });

  it('cancel() cancels queued tasks, cannot cancel running tasks, and rejects invalid ids', async () => {
    const { service, events, immediateQueue } = createSchedulerHarness({ maxConcurrent: 0 });
    const queuedPromise = service.schedule(() => 'value', TaskPriority.HIGH);
    const queuedPayload = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.queued')?.[1];

    expect(queuedPayload).toEqual({ id: expect.any(Number), priority: TaskPriority.HIGH });
    expect(service.getQueueLength(TaskPriority.HIGH)).toBe(1);
    expect(service.getQueueLength()).toBe(1);
    expect(service.getStatus()).toEqual({ running: 0, queued: 1, maxConcurrent: 0 });

    expect(service.cancel(queuedPayload.id)).toBe(true);
    expect(service.getQueueLength()).toBe(0);
    expect(events.emit).toHaveBeenCalledWith('scheduler.task.cancelled', { id: queuedPayload.id });
    await expect(queuedPromise).rejects.toThrow('Task cancelled');

    const boundaryIds = [null, undefined, '', '   ', [], {}, 0, -1, Number.MAX_SAFE_INTEGER, '123', { 0: 'a', length: 1 }];
    for (const value of boundaryIds) {
      expect(service.cancel(value)).toBe(false);
    }

    const runningTask = createDeferred();
    const runningHarness = createSchedulerHarness({ maxConcurrent: 1, defaultTimeout: 1000 });
    const runningPromise = runningHarness.service.schedule(() => runningTask.promise);
    const runningId = runningHarness.events.emit.mock.calls.find(([event]) => event === 'scheduler.task.queued')?.[1]?.id;

    await drainImmediates(runningHarness.immediateQueue);
    expect(runningHarness.service.getStatus()).toEqual({ running: 1, queued: 0, maxConcurrent: 1 });
    expect(runningHarness.service.cancel(runningId)).toBe(false);

    runningTask.resolve('ok');
    await flushMicrotasks();
    await drainImmediates(runningHarness.immediateQueue);
    await expect(runningPromise).resolves.toBe('ok');

    await drainImmediates(immediateQueue);
  });

  it('rejects and emits errors when tasks throw or reject', async () => {
    const errors = [];
    const { service, state, immediateQueue } = createSchedulerHarness({ defaultTimeout: 1000 }, (event, payload) => {
      if (event === 'scheduler.task.error') errors.push(payload.error);
    });

    const syncThrow = service.schedule(() => {
      throw new Error('boom');
    });
    await drainImmediates(immediateQueue);
    await expect(syncThrow).rejects.toThrow('boom');

    const asyncReject = service.schedule(() => Promise.reject(new Error('nope')));
    await drainImmediates(immediateQueue);
    await expect(asyncReject).rejects.toThrow('nope');

    expect(errors).toContain('boom');
    expect(errors).toContain('nope');
    expect(state.get('running')).toBe(0);
  });

  it('times out long-running tasks and emits scheduler.task.error', async () => {
    vi.useFakeTimers();
    const errors = [];
    const { service, state, immediateQueue } = createSchedulerHarness({ defaultTimeout: 10 }, (event, payload) => {
      if (event === 'scheduler.task.error') errors.push(payload.error);
    });

    const promise = service.schedule(() => new Promise(() => {}));
    const rejection = expect(promise).rejects.toThrow('Task timeout');
    await drainImmediates(immediateQueue);

    await vi.advanceTimersByTimeAsync(11);
    await flushMicrotasks();
    await drainImmediates(immediateQueue);

    await rejection;
    expect(errors).toContain('Task timeout');
    expect(state.get('running')).toBe(0);

    vi.useRealTimers();
  });
});
