import { describe, it, expect, vi, beforeEach } from 'vitest';

let createRetryProxyImpl;
let createdProxy;
let createdOptions;

const mockedCreatePlugin = vi.hoisted(() => vi.fn((config) => config));
const mockedCreateRetryProxy = vi.hoisted(() =>
  vi.fn((options) => {
    createdOptions = options;
    createdProxy = { invoke: createRetryProxyImpl || vi.fn(async (context, next) => next()) };
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
});

describe('default', () => {
  it('should_expose_plugin_name', () => {
    expect(retryPlugin.name).toBe('resilience/retry');
  });

  it('should_expose_plugin_version', () => {
    expect(retryPlugin.version).toBe('1.0.0');
  });

  it('should_expose_non_empty_description', () => {
    expect(retryPlugin.description.length).toBeGreaterThan(0);
  });

  it('should_expose_default_config', () => {
    expect(retryPlugin.defaultConfig).toEqual({
      maxRetries: 3,
      baseDelay: 1000,
      retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT'],
    });
  });

  it('should_expose_install_function', () => {
    expect(typeof retryPlugin.install).toBe('function');
  });

  it('should_create_retry_proxy_once_when_installed', () => {
    createHarness();

    expect(mockedCreateRetryProxy).toHaveBeenCalledTimes(1);
  });

  it('should_pass_default_maxRetries_to_createRetryProxy', () => {
    createHarness();

    expect(createdOptions.maxRetries).toBe(3);
  });

  it('should_pass_default_delay_to_createRetryProxy', () => {
    createHarness();

    expect(createdOptions.delay).toBe(1000);
  });

  it('should_pass_shouldRetry_function_to_createRetryProxy', () => {
    createHarness();

    expect(createdOptions.shouldRetry).toEqual(expect.any(Function));
  });

  it('should_use_created_proxy_on_ctx_services', () => {
    const { ctx } = createHarness();

    expect(ctx.services.useProxy).toHaveBeenCalledWith(createdProxy);
  });

  it('should_register_retry_service', () => {
    const { ctx } = createHarness();

    expect(ctx.registerService).toHaveBeenCalledWith('retry', expect.any(Object));
  });

  it('should_log_when_plugin_is_installed', () => {
    const { log } = createHarness();

    expect(log.info).toHaveBeenCalledWith('Retry plugin installed');
  });

  it('should_return_zero_total_stats_when_no_stats_exist', () => {
    const { service } = createHarness();

    expect(service.getStats()).toEqual({ total: 0 });
  });

  it('should_return_true_when_resetStats_is_called', () => {
    const { service } = createHarness();

    expect(service.resetStats()).toBe(true);
  });

  it('should_reset_total_to_zero_when_resetStats_is_called', () => {
    const { service, state } = createHarness();
    state.set('retryStats', { total: 5 });

    service.resetStats();

    expect(service.getStats()).toEqual({ total: 0 });
  });

  it('should_return_stored_stats_when_retryStats_exists', () => {
    const { service, state } = createHarness();
    state.set('retryStats', { total: 2 });

    expect(service.getStats()).toEqual({ total: 2 });
  });

  it('should_forward_zero_boundary_values_to_createRetryProxy', () => {
    createHarness({ maxRetries: 0, baseDelay: 0 });

    expect(createdOptions).toEqual(
      expect.objectContaining({
        maxRetries: 0,
        delay: 0,
      }),
    );
  });

  it('should_forward_MAX_SAFE_INTEGER_boundary_values_to_createRetryProxy', () => {
    createHarness({ maxRetries: Number.MAX_SAFE_INTEGER, baseDelay: Number.MAX_SAFE_INTEGER });

    expect(createdOptions).toEqual(
      expect.objectContaining({
        maxRetries: Number.MAX_SAFE_INTEGER,
        delay: Number.MAX_SAFE_INTEGER,
      }),
    );
  });

  it('should_forward_type_boundary_values_to_createRetryProxy', () => {
    createHarness({ maxRetries: '2', baseDelay: '   ' });

    expect(createdOptions).toEqual(
      expect.objectContaining({
        maxRetries: '2',
        delay: '   ',
      }),
    );
  });

  it('should_return_true_when_error_code_is_retryable', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ code: 'ETIMEDOUT' }, {})).toBe(true);
  });

  it('should_return_false_when_error_code_is_not_retryable', () => {
    createHarness({ retryableErrors: [] });

    expect(createdOptions.shouldRetry({ code: 'ETIMEDOUT' }, {})).toBe(false);
  });

  it('should_return_true_when_error_name_is_retryable_and_code_missing', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ name: 'RATE_LIMIT' }, {})).toBe(true);
  });

  it('should_return_true_when_status_is_429', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ status: 429 }, {})).toBe(true);
  });

  it('should_return_true_when_status_is_500', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ status: 500 }, {})).toBe(true);
  });

  it('should_return_true_when_status_is_599', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ status: 599 }, {})).toBe(true);
  });

  it('should_return_false_when_status_is_600', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ status: 600 }, {})).toBe(false);
  });

  it('should_return_false_when_status_is_499', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ status: 499 }, {})).toBe(false);
  });

  it('should_return_true_when_status_is_numeric_string_500', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ status: '500' }, {})).toBe(true);
  });

  it('should_return_false_when_error_code_is_empty_string', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ code: '' }, {})).toBe(false);
  });

  it('should_return_false_when_error_code_is_whitespace_string', () => {
    createHarness();

    expect(createdOptions.shouldRetry({ code: '   ' }, {})).toBe(false);
  });

  it('should_return_false_when_error_is_empty_string', () => {
    createHarness();

    expect(createdOptions.shouldRetry('', {})).toBe(false);
  });

  it('should_return_false_when_error_is_empty_array', () => {
    createHarness();

    expect(createdOptions.shouldRetry([], {})).toBe(false);
  });

  it('should_return_false_when_error_is_empty_object', () => {
    createHarness();

    expect(createdOptions.shouldRetry({}, {})).toBe(false);
  });

  it('should_throw_TypeError_when_error_is_null', () => {
    createHarness();

    expect(() => createdOptions.shouldRetry(null, {})).toThrow(TypeError);
  });

  it('should_throw_TypeError_when_error_is_undefined', () => {
    createHarness();

    expect(() => createdOptions.shouldRetry(undefined, {})).toThrow(TypeError);
  });

  it('should_throw_TypeError_when_retryableErrors_is_not_array', () => {
    createHarness({ retryableErrors: {} });

    expect(() => createdOptions.shouldRetry({ code: 'ETIMEDOUT' }, {})).toThrow(TypeError);
  });

  it('should_return_next_result_when_invoke_succeeds', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy } = createHarness();

    await expect(proxy.invoke({ service: 'svc', method: 'm' }, vi.fn(async () => 'ok'))).resolves.toBe('ok');
  });

  it('should_not_emit_events_when_invoke_succeeds_without_retries', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events } = createHarness();

    await proxy.invoke({ service: 'svc', method: 'm' }, vi.fn(async () => 'ok'));

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('should_emit_retry_event_when_second_attempt_happens', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, events } = createHarness();
    const next = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok');

    await proxy.invoke({ service: 'svc', method: 'method' }, next);

    const retryEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:retry');
    expect(retryEvents).toHaveLength(1);
  });

  it('should_emit_retry_event_with_service_method_and_attempt', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, events } = createHarness();
    const next = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok');

    await proxy.invoke({ service: 'svc', method: 'method' }, next);

    const retryEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:retry');
    expect(retryEvents[0][1]).toEqual({ service: 'svc', method: 'method', attempt: 2 });
  });

  it('should_increment_total_retryStats_when_retry_happens', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, service } = createHarness();
    const next = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok');

    await proxy.invoke({ service: 'svc', method: 'method' }, next);

    expect(service.getStats()).toEqual({ total: 1 });
  });

  it('should_increment_total_retryStats_from_existing_value_when_retry_happens', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, service, state } = createHarness();
    state.set('retryStats', { total: 5 });
    const next = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok');

    await proxy.invoke({ service: 'svc', method: 'method' }, next);

    expect(service.getStats()).toEqual({ total: 6 });
  });

  it('should_rethrow_error_when_invoke_fails', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy } = createHarness();
    const error = new Error('boom');

    await expect(proxy.invoke({ service: 'svc', method: 'method' }, vi.fn(() => Promise.reject(error)))).rejects.toThrow(
      'boom',
    );
  });

  it('should_emit_exhausted_event_when_invoke_fails', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events } = createHarness();

    await proxy.invoke({ service: 'svc', method: 'method' }, vi.fn(async () => Promise.reject(new Error('boom')))).catch(() => {
      // expected
    });

    const exhaustedEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:exhausted');
    expect(exhaustedEvents).toHaveLength(1);
  });

  it('should_emit_exhausted_event_with_attempts_and_error_message', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events } = createHarness();

    await proxy.invoke({ service: 'svc', method: 'method' }, vi.fn(async () => Promise.reject(new Error('boom')))).catch(() => {
      // expected
    });

    const exhaustedEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:exhausted');
    expect(exhaustedEvents[0][1]).toEqual({
      service: 'svc',
      method: 'method',
      attempts: 1,
      error: 'boom',
    });
  });

  it('should_not_emit_retry_event_when_invoke_fails_on_first_attempt', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events } = createHarness();

    await proxy.invoke({ service: 'svc', method: 'method' }, vi.fn(async () => Promise.reject(new Error('boom')))).catch(() => {
      // expected
    });

    const retryEvents = events.emit.mock.calls.filter(([name]) => name === 'resilience:retry');
    expect(retryEvents).toHaveLength(0);
  });

  it('should_handle_large_nested_context_without_emitting_events', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => wrappedNext());

    const { proxy, events } = createHarness();
    const longString = 'x'.repeat(100000);
    const largeBuffer = new Uint8Array(1024 * 1024);

    let deepNested = { level: 0 };
    let cursor = deepNested;
    for (let i = 1; i <= 10; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    await proxy.invoke(
      { service: longString, method: '   ', args: [largeBuffer], meta: deepNested },
      vi.fn(async () => 'ok'),
    );

    expect(events.emit).not.toHaveBeenCalled();
  });

  it('should_increment_total_retryStats_across_concurrent_and_rapid_invokes', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, service } = createHarness();

    const createFlakyNext = () => {
      let calls = 0;
      return vi.fn(async () => {
        calls += 1;
        await Promise.resolve();
        if (calls === 1) throw new Error('retry');
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

    expect(service.getStats()).toEqual({ total: 5 });
  });

  it('should_emit_retry_event_for_each_retry_across_concurrent_and_rapid_invokes', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, events } = createHarness();

    const createFlakyNext = () => {
      let calls = 0;
      return vi.fn(async () => {
        calls += 1;
        await Promise.resolve();
        if (calls === 1) throw new Error('retry');
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
  });

  it('should_emit_attempt_2_for_all_retry_events', async () => {
    createRetryProxyImpl = vi.fn(async (context, wrappedNext) => {
      try {
        await wrappedNext();
      } catch {
        // swallow first failure to simulate retry
      }
      return wrappedNext();
    });

    const { proxy, events } = createHarness();

    const createFlakyNext = () => {
      let calls = 0;
      return vi.fn(async () => {
        calls += 1;
        await Promise.resolve();
        if (calls === 1) throw new Error('retry');
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
    expect(retryEvents.every(([, payload]) => payload.attempt === 2)).toBe(true);
  });
});