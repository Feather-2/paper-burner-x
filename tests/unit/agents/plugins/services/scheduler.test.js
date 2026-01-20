import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    } else {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
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

const createSchedulerHarness = (configOverrides = {}, emitHook = null) => {
  const state = createState();
  const events = {
    emit: vi.fn((event, payload) => {
      if (emitHook) {
        emitHook(event, payload);
      }
    }),
  };
  const log = { info: vi.fn() };
  let service = null;
  const ctx = {
    config: { maxConcurrent: 2, defaultTimeout: 50, ...configOverrides },
    state,
    events,
    log,
    registerService: vi.fn((name, svc) => {
      if (name === 'scheduler') {
        service = svc;
      }
    }),
  };
  schedulerPlugin.install(ctx);
  return { ctx, service, state, events, log };
};

const flushImmediate = () =>
  new Promise((resolve) => {
    const immediate = globalThis.setImmediate || ((callback) => setTimeout(callback, 0));
    immediate(resolve);
  });

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TaskPriority', () => {
  it('defines the expected priority levels', () => {
    expect(TaskPriority).toEqual({
      LOW: 0,
      NORMAL: 1,
      HIGH: 2,
      CRITICAL: 3,
    });
  });
});

describe('default', () => {
  it('exposes plugin metadata and defaults', () => {
    expect(schedulerPlugin.name).toBe('service/scheduler');
    expect(schedulerPlugin.version).toBe('1.0.0');
    expect(typeof schedulerPlugin.description).toBe('string');
    expect(schedulerPlugin.description.length).toBeGreaterThan(0);
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

  it('resolves boundary and resource values', async () => {
    const { service, state } = createSchedulerHarness({ defaultTimeout: 1000 });
    const longString = 'x'.repeat(100000);
    const largeBuffer = new Uint8Array(1024 * 1024);

    const deepNested = { level: 0 };
    let cursor = deepNested;
    for (let i = 1; i <= 10; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const cases = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      longString,
      largeBuffer,
      deepNested,
    ];

    for (const value of cases) {
      const result = await service.schedule(value);
      expect(result).toBe(value);
    }

    expect(state.get('stats.queued')).toBe(cases.length);
  });

  it('accepts numeric string priorities', async () => {
    const { service } = createSchedulerHarness();
    const promise = service.schedule(() => 'ok', '1');

    expect(service.getQueueLength('1')).toBe(1);
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects invalid priority values', async () => {
    const { service } = createSchedulerHarness();

    await expect(service.schedule('bad', -1)).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', Number.MAX_SAFE_INTEGER)).rejects.toThrow(TypeError);
    await expect(service.schedule('bad', {})).rejects.toThrow(TypeError);
  });

  it('emits lifecycle events for successful tasks', async () => {
    let queuedId = null;
    const { service, events } = createSchedulerHarness({}, (event, payload) => {
      if (event === 'scheduler.task.queued') {
        queuedId = payload.id;
      }
    });

    const result = await service.schedule(() => 'done', TaskPriority.HIGH);

    expect(result).toBe('done');

    const queuedCall = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.queued');
    const startCall = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.start');
    const completeCall = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.complete');

    expect(queuedCall).toBeTruthy();
    expect(startCall).toBeTruthy();
    expect(completeCall).toBeTruthy();
    expect(queuedCall[1]).toMatchObject({ id: queuedId, priority: TaskPriority.HIGH });
    expect(startCall[1]).toMatchObject({ id: queuedId, priority: TaskPriority.HIGH });
    expect(completeCall[1]).toMatchObject({ id: queuedId });
  });

  it('executes higher priority tasks first', async () => {
    const { service } = createSchedulerHarness({ maxConcurrent: 1 });
    const order = [];

    const lowTask = () => {
      order.push('low');
      return 'low';
    };
    const criticalTask = () => {
      order.push('critical');
      return 'critical';
    };

    const lowPromise = service.schedule(lowTask, TaskPriority.LOW);
    const criticalPromise = service.schedule(criticalTask, TaskPriority.CRITICAL);

    await Promise.all([lowPromise, criticalPromise]);

    expect(order[0]).toBe('critical');
    expect(order[1]).toBe('low');
  });

  it('limits concurrency during rapid consecutive scheduling', async () => {
    const deferreds = [createDeferred(), createDeferred(), createDeferred()];
    let running = 0;
    let maxRunning = 0;
    const started = [];

    const { service } = createSchedulerHarness(
      { maxConcurrent: 2, defaultTimeout: 1000 },
      (event, payload) => {
        if (event === 'scheduler.task.start') {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          started.push(payload.id);
        }
        if (event === 'scheduler.task.complete' || event === 'scheduler.task.error') {
          running -= 1;
        }
      }
    );

    const promises = deferreds.map((deferred) => service.schedule(() => deferred.promise));

    await flushImmediate();
    expect(maxRunning).toBe(2);
    expect(started.length).toBe(2);

    deferreds[0].resolve('a');
    deferreds[1].resolve('b');
    await flushImmediate();
    await flushImmediate();
    expect(started.length).toBe(3);
    expect(maxRunning).toBe(2);

    deferreds[2].resolve('c');
    await Promise.all(promises);
    expect(maxRunning).toBe(2);
  });

  it('reports queue lengths by priority and handles type boundaries', async () => {
    const { service } = createSchedulerHarness({ maxConcurrent: 2 });

    const lowPromise = service.schedule(() => 'low', TaskPriority.LOW);
    const highPromise = service.schedule(() => 'high', TaskPriority.HIGH);
    const normalPromise = service.schedule(() => 'normal', '1');

    expect(service.getQueueLength()).toBe(3);
    expect(service.getQueueLength(TaskPriority.LOW)).toBe(1);
    expect(service.getQueueLength(TaskPriority.HIGH)).toBe(1);
    expect(service.getQueueLength('1')).toBe(1);
    expect(service.getQueueLength({})).toBe(0);

    await Promise.all([lowPromise, highPromise, normalPromise]);
  });

  it('reports running and queued counts accurately', async () => {
    const first = createDeferred();
    const second = createDeferred();
    const { service } = createSchedulerHarness({ maxConcurrent: 1, defaultTimeout: 1000 });

    const firstPromise = service.schedule(() => first.promise);
    const secondPromise = service.schedule(() => second.promise);

    await flushImmediate();
    expect(service.getStatus()).toEqual({ running: 1, queued: 1, maxConcurrent: 1 });

    first.resolve('one');
    await flushImmediate();
    expect(service.getStatus()).toEqual({ running: 1, queued: 0, maxConcurrent: 1 });

    second.resolve('two');
    await Promise.all([firstPromise, secondPromise]);
    await flushImmediate();
    expect(service.getStatus()).toEqual({ running: 0, queued: 0, maxConcurrent: 1 });
  });

  it('cancels queued tasks and returns false for missing/running tasks', async () => {
    let queuedId = null;
    const { service, events } = createSchedulerHarness({ maxConcurrent: 1 }, (event, payload) => {
      if (event === 'scheduler.task.queued') {
        queuedId = payload.id;
      }
    });

    const promise = service.schedule(() => 'value');
    expect(service.cancel(queuedId)).toBe(true);
    await expect(promise).rejects.toThrow('Task cancelled');

    const cancelCall = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.cancelled');
    expect(cancelCall).toBeTruthy();
    expect(cancelCall[1]).toEqual({ id: queuedId });
    expect(service.getQueueLength()).toBe(0);

    const runningDeferred = createDeferred();
    const runningPromise = service.schedule(() => runningDeferred.promise);

    await flushImmediate();
    expect(service.cancel(queuedId)).toBe(false);
    expect(service.cancel(12345)).toBe(false);

    runningDeferred.resolve('ok');
    await expect(runningPromise).resolves.toBe('ok');
  });

  it('rejects and emits errors when tasks throw', async () => {
    const { service, events, state } = createSchedulerHarness();

    const promise = service.schedule(() => {
      throw new Error('boom');
    });

    await expect(promise).rejects.toThrow('boom');

    const errorCall = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.error');
    expect(errorCall).toBeTruthy();
    expect(errorCall[1]).toMatchObject({ error: 'boom' });
    expect(state.get('running')).toBe(0);
  });

  it('times out long-running tasks and emits errors', async () => {
    vi.useFakeTimers();
    const { service, events, state } = createSchedulerHarness({ defaultTimeout: 10 });

    const promise = service.schedule(() => new Promise(() => {}));

    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('Task timeout');

    const errorCall = events.emit.mock.calls.find(([event]) => event === 'scheduler.task.error');
    expect(errorCall).toBeTruthy();
    expect(errorCall[1]).toMatchObject({ error: 'Task timeout' });
    expect(state.get('running')).toBe(0);
  });
});
