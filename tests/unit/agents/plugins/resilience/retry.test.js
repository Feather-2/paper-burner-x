import { describe, it, expect, vi, beforeEach } from 'vitest';

let createRetryProxyImpl;
let createdProxy;
let createdOptions;
let originalInvoke;

const mockedCreatePlugin = vi.hoisted(() => vi.fn((config) => config));
const mockedCreateRetryProxy = vi.hoisted(() =>
  vi.fn((options) => {
    createdOptions = options;
    originalInvoke = createRetryProxyImpl || vi.fn(async (context, next) => next());
    createdProxy = { invoke: originalInvoke };
    return createdProxy;
  }),
);

vi.mock('../../../../../js/agents/core/plugin.js', () => ({
  createPlugin: mockedCreatePlugin,
}));

vi.mock('../../../../../js/agents/core/service-bus.js', () => ({
  createRetryProxy: mockedCreateRetryProxy,
}));

import retryPlugin from '../../../../../js/agents/plugins/resilience/retry.js';

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

const createHarness = (configOverrides = {}) => {
  const state = createState();
  const events = { emit: vi.fn() };
  const log = { info: vi.fn() };
  let service = null;
  let proxy = null;

  const ctx = {
    config: { ...retryPlugin.defaultConfig, ...configOverrides },
    state,
    events,
    log,
    services: {
      useProxy: vi.fn((value) => {
        proxy = value;
      }),
    },
    registerService: vi.fn((name, value) => {
      if (name === 'retry') {
        service = value;
      }
    }),
  };

  retryPlugin.install(ctx);

  return { ctx, state, events, log, service, proxy };
};

beforeEach(() => {
  vi.clearAllMocks();
  createRetryProxyImpl = null;
  createdProxy = null;
  createdOptions = null;
  originalInvoke = null;
});

describe('default', () => {
  it('exposes plugin metadata and defaults', () => {
    expect(retryPlugin.name).toBe('resilience/retry');
    expect(retryPlugin.version).toBe('1.0.0');
    expect(typeof retryPlugin.description).toBe('string');
    expect(retryPlugin.description.length).toBeGreaterThan(0);
    expect(retryPlugin.defaultConfig).toEqual({
      maxRetries: 3,
      baseDelay: 1000,
      retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT'],
    });
    expect(typeof retryPlugin.install).toBe('function');
  });

  it('installs retry proxy and service with logging', () => {
    const { ctx, service, log, proxy } = createHarness();

    expect(mockedCreateRetryProxy).toHaveBeenCalledTimes(1);
    expect(createdOptions).toEqual({
      maxRetries: 3,
      delay: 1000,
      shouldRetry: expect.any(Function),
    });
    expect(ctx.services.useProxy).toHaveBeenCalledWith(proxy);
    expect(proxy).toBe(createdProxy);

    expect(ctx.registerService).toHaveBeenCalledWith('retry', expect.any(Object));
    expect(service).toBeTruthy();
    expect(typeof service.getStats).toBe('function');
    expect(typeof service.resetStats).toBe('function');
    expect(service.getStats()).toEqual({ total: 0 });

    expect(service.resetStats()).toBe(true);
    expect(service.getStats()).toEqual({ total: 0 });
    expect(log.info).toHaveBeenCalledWith('Retry plugin installed');
  });

  it('forwards boundary config values to createRetryProxy', () => {
    const cases = [
      { maxRetries: 0, baseDelay: 0, retryableErrors: [] },
      { maxRetries: -1, baseDelay: -1, retryableErrors: [] },
      { maxRetries: Number.MAX_SAFE_INTEGER, baseDelay: Number.MAX_SAFE_INTEGER, retryableErrors: [] },
      { maxRetries: '2', baseDelay: '   ', retryableErrors: [] },
    ];

    for (const overrides of cases) {
      createHarness(overrides);
      expect(createdOptions.maxRetries).toBe(overrides.maxRetries);
      expect(createdOptions.delay).toBe(overrides.baseDelay);
      expect(typeof createdOptions.shouldRetry).toBe('function');
    }
  });

  it('evaluates retryable errors and status boundaries, including empty values', () => {
    createHarness();
    const shouldRetry = createdOptions.shouldRetry;
    const context = { service: 'svc', method: 'method' };

    expect(shouldRetry({ code: 'ETIMEDOUT' }, context)).toBe(true);
    expect(shouldRetry({ name: 'RATE_LIMIT' }, context)).toBe(true);
    expect(shouldRetry({ status: 429 }, context)).toBe(true);
    expect(shouldRetry({ status: 500 }, context)).toBe(true);
    expect(shouldRetry({ status: 599 }, context)).toBe(true);
    expect(shouldRetry({ status: 600 }, context)).toBe(false);
    expect(shouldRetry({ status: 499 }, context)).toBe(false);
    expect(shouldRetry({ status: 0 }, context)).toBe(false);
    expect(shouldRetry({ status: -1 }, context)).toBe(false);
    expect(shouldRetry({ status: Number.MAX_SAFE_INTEGER }, context)).toBe(false);
    expect(shouldRetry({ status: '500' }, context)).toBe(true);

    expect(shouldRetry({ code: '' }, context)).toBe(false);
    expect(shouldRetry({ code: '   ' }, context)).toBe(false);
    expect(shouldRetry('', context)).toBe(false);
    expect(shouldRetry([], context)).toBe(false);
    expect(shouldRetry({}, context)).toBe(false);
  });

  it('throws on nullish error inputs', () => {
    createHarness();
    const shouldRetry = createdOptions.shouldRetry;

    expect(() => shouldRetry(null, {})).toThrow(TypeError);
    expect(() => shouldRetry(undefined, {})).toThrow(TypeError);
  });

  it('throws when retryableErrors is not an array', () => {
    createHarness({ retryableErrors: {} });
    const shouldRetry = createdOptions.shouldRetry;

    expect(() => shouldRetry({ code: 'ETIMEDOUT' }, {})).toThrow(TypeError);
  });

  it('wraps invoke to emit retry events and update stats', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch (error) {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, events, state, service } = createHarness();
    const context = { service: 'svc', method: 'method' };
    const next = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail once'))
      .mockResolvedValueOnce('ok');

    await expect(proxy.invoke(context, next)).resolves.toBe('ok');

    expect(originalInvoke).toHaveBeenCalledWith(context, expect.any(Function));
    expect(next).toHaveBeenCalledTimes(2);

    const retryEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:retry');
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0][1]).toEqual({ service: 'svc', method: 'method', attempt: 2 });

    expect(state.get('retryStats.total')).toBe(1);
    expect(service.getStats()).toEqual({ total: 1 });

    const exhaustedEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:exhausted');
    expect(exhaustedEvents).toHaveLength(0);
  });

  it('emits exhausted event and rethrows when invoke fails', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events, service } = createHarness();
    const context = { service: 'svc', method: 'method' };
    const error = new Error('boom');
    const next = vi.fn(() => {
      throw error;
    });

    await expect(proxy.invoke(context, next)).rejects.toThrow('boom');

    const exhaustedEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:exhausted');
    expect(exhaustedEvents).toHaveLength(1);
    expect(exhaustedEvents[0][1]).toEqual({
      service: 'svc',
      method: 'method',
      attempts: 1,
      error: 'boom',
    });

    const retryEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:retry');
    expect(retryEvents).toHaveLength(0);
    expect(service.getStats()).toEqual({ total: 0 });
  });

  it('passes through large and nested context values without retrying', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events, service } = createHarness();
    const longString = 'x'.repeat(100000);
    const largeBuffer = new Uint8Array(1024 * 1024);
    let deepNested = { level: 0 };
    let cursor = deepNested;
    for (let i = 1; i <= 10; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const context = {
      service: longString,
      method: '   ',
      args: [largeBuffer],
      meta: deepNested,
    };

    const next = vi.fn(async () => 'ok');

    await expect(proxy.invoke(context, next)).resolves.toBe('ok');

    expect(originalInvoke).toHaveBeenCalledWith(context, expect.any(Function));
    expect(next).toHaveBeenCalledTimes(1);
    expect(events.emit).not.toHaveBeenCalled();
    expect(service.getStats()).toEqual({ total: 0 });
  });

  it('handles concurrent and rapid invoke calls', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch (error) {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, events, state } = createHarness();

    const createFlakyNext = () => {
      let calls = 0;
      return vi.fn(async () => {
        calls += 1;
        await Promise.resolve();
        if (calls === 1) {
          throw new Error('retry');
        }
        return `ok-${calls}`;
      });
    };

    await Promise.all([
      proxy.invoke({ service: 'svc-a', method: 'm1' }, createFlakyNext()),
      proxy.invoke({ service: 'svc-b', method: 'm2' }, createFlakyNext()),
    ]);

    for (let i = 0; i < 3; i += 1) {
      await proxy.invoke({ service: 'rapid', method: `m${i}` }, createFlakyNext());
    }

    const retryEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:retry');
    expect(retryEvents).toHaveLength(5);
    retryEvents.forEach(([, payload]) => {
      expect(payload.attempt).toBe(2);
    });
    expect(state.get('retryStats.total')).toBe(5);
  });
});
