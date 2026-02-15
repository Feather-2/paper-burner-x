import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  const loggerWarn = vi.fn();
  const createLogger = vi.fn(() => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: vi.fn((...args) => console.error(...args)),
  }));

  const isValidEventName = vi.fn((name) => {
    if (typeof name !== 'string') return false;
    if (!name) return false;
    return /^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(name);
  });

  const matchPattern = vi.fn((pattern, name) => {
    if (typeof pattern !== 'string' || typeof name !== 'string') return false;
    if (pattern === '*') return true;
    const escaped = pattern.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
    return re.test(name);
  });

  const createEventId = vi.fn((runId, seq) => `evt_${runId || 'run'}_${seq}`);

  const parseSeqFromEventId = (eventId) => {
    if (typeof eventId !== 'string') return 0;
    const match = /_(\d+)$/.exec(eventId);
    return match ? Number(match[1]) : 0;
  };

  const createEventRecord = vi.fn((input = {}) => {
    const name = input?.name;
    if (!isValidEventName(name)) {
      throw new Error(`Invalid event name: ${String(name)}`);
    }

    const eventId = input?.eventId ?? createEventId(input?.runId ?? null, 0);
    const seq = typeof input?.seq === 'number' ? input.seq : parseSeqFromEventId(eventId);
    const clock = isObject(input?._clock) && typeof input._clock.seq === 'number' ? input._clock : { seq };

    return {
      schemaVersion: typeof input?.schemaVersion === 'string' ? input.schemaVersion : '0.1',
      eventId,
      runId: typeof input?.runId === 'string' ? input.runId : null,
      ts: typeof input?.ts === 'string' ? input.ts : new Date().toISOString(),
      name,
      actor: typeof input?.actor === 'string' ? input.actor : 'system',
      payload: input?.payload,
      meta: input?.meta,
      status: input?.status,
      level: input?.level,
      durationMs: input?.durationMs,
      _clock: clock,
      seq,
    };
  });

  const createEventBusClock = vi.fn((seq) => ({ seq }));

  class LamportClock {
    constructor(seq = 0) {
      this.seq = typeof seq === 'number' ? seq : 0;
    }
    tick(remoteSeq = 0) {
      const n = typeof remoteSeq === 'number' ? remoteSeq : 0;
      this.seq = Math.max(this.seq, n) + 1;
      return { seq: this.seq };
    }
    peek() {
      return { seq: this.seq };
    }
  }

  class EventBusSubscriptions {
    constructor() {
      /** @type {{ pattern: string, fn: Function, priority: number }[]} */
      this._subs = [];
    }

    on(name, handler, options = {}) {
      if (typeof handler !== 'function') throw new TypeError('handler must be a function');
      if (typeof name !== 'string' || !name) throw new TypeError('event name must be a string');
      if (name !== '*' && !isValidEventName(name) && !name.includes('*')) {
        throw new Error(`Invalid event name: ${name}`);
      }

      const priority = typeof options?.priority === 'number' ? options.priority : 0;
      this._subs.push({ pattern: name, fn: handler, priority });
      return () => this.off(name, handler);
    }

    once(name, handler) {
      if (typeof handler !== 'function') throw new TypeError('handler must be a function');
      const wrapped = (evt) => {
        this.off(name, wrapped);
        return handler(evt);
      };
      return this.on(name, wrapped);
    }

    subscribe(eventType, handler, options = {}) {
      const signal = options?.signal;
      if (signal?.aborted) return () => {};
      const unsub = this.on(eventType, handler, { priority: options?.priority });
      if (signal) {
        signal.addEventListener('abort', unsub, { once: true });
      }
      return unsub;
    }

    off(name, handler) {
      const before = this._subs.length;
      this._subs = this._subs.filter((s) => !(s.pattern === name && s.fn === handler));
      return this._subs.length !== before;
    }

    clear() {
      this._subs = [];
    }

    collectHandlers(eventName) {
      return this._subs
        .filter((s) => matchPattern(s.pattern, eventName))
        .slice()
        .sort((a, b) => b.priority - a.priority)
        .map((s) => ({ fn: s.fn, priority: s.priority }));
    }
  }

  return {
    createLogger,
    loggerWarn,
    createEventRecord,
    createEventBusClock,
    createEventId,
    matchPattern,
    isValidEventName,
    LamportClock,
    EventBusSubscriptions,
  };
});

vi.mock('../../../js/agents/shared/index.js', () => ({ createLogger: mocks.createLogger }));
vi.mock('../../../js/agents/core/event-record.js', () => ({
  createEventRecord: mocks.createEventRecord,
  createEventBusClock: mocks.createEventBusClock,
}));
vi.mock('../../../js/agents/core/event-bus-utils.js', () => ({
  createEventId: mocks.createEventId,
  matchPattern: mocks.matchPattern,
  isValidEventName: mocks.isValidEventName,
}));
vi.mock('../../../js/agents/core/event-bus-subscriptions.js', () => ({
  EventBusSubscriptions: mocks.EventBusSubscriptions,
}));
vi.mock('../../../js/agents/core/lamport-clock.js', () => ({
  LamportClock: mocks.LamportClock,
}));

function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

async function importEventBusModule() {
  return import('../../../js/agents/core/event-bus.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('event-bus exports', () => {
  it('should_export_default_as_EventBus', async () => {
    const mod = await importEventBusModule();
    expect(mod.default).toBe(mod.EventBus);
  });

  it('should_return_evt_run_1_when_createEventId_given_null_runId_and_seq_1', async () => {
    const mod = await importEventBusModule();
    expect(mod.createEventId(null, 1)).toBe('evt_run_1');
  });

  it('should_return_true_when_matchPattern_given_run_star_and_run_started', async () => {
    const mod = await importEventBusModule();
    expect(mod.matchPattern('run.*', 'run.started')).toBe(true);
  });

  it('should_return_false_when_isValidEventName_given_uppercase_segments', async () => {
    const mod = await importEventBusModule();
    expect(mod.isValidEventName('A.B')).toBe(false);
  });

  it('should_throw_when_createEventRecord_given_invalid_name', async () => {
    const mod = await importEventBusModule();
    expect(() => mod.createEventRecord({ name: 'Bad.Name' })).toThrow(/Invalid event name/i);
  });

  it('should_increment_seq_when_LamportClock_tick_called', async () => {
    const mod = await importEventBusModule();
    const clock = new mod.LamportClock();
    clock.tick();
    expect(clock.seq).toBe(1);
  });
});

describe('RunStoreAdapter', () => {
  it('should_throw_when_constructor_missing_getEvents', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    expect(() => new RunStoreAdapter({ appendEvents() {} })).toThrow(/getEvents/i);
  });

  it('should_throw_when_constructor_missing_append_methods', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    expect(() => new RunStoreAdapter({ getEvents() {} })).toThrow(/appendEvents\/appendEvent/i);
  });

  it('should_throw_when_appendEvents_given_non_array', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    const adapter = new RunStoreAdapter({ async getEvents() { return []; }, async appendEvents() {} });
    await expect(adapter.appendEvents('nope')).rejects.toThrow(/events must be an array/i);
  });

  it('should_return_0_when_appendEvents_given_empty_array', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    const adapter = new RunStoreAdapter({ async getEvents() { return []; }, async appendEvents() {} });
    await expect(adapter.appendEvents([])).resolves.toBe(0);
  });

  it('should_throw_when_appendEvents_events_missing_runId', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    const adapter = new RunStoreAdapter({ async getEvents() { return []; }, async appendEvents() {} });
    await expect(adapter.appendEvents([{ eventId: 'evt_x' }])).rejects.toThrow(/must include a string runId/i);
  });

  it('should_group_events_by_runId_when_runStore_supports_appendEvents', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    const runStore = { getEvents: vi.fn(async () => []), appendEvents: vi.fn(async () => {}) };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: 'run_a', eventId: 'evt_run_a_1', name: 'run.started' },
      { runId: 'run_a', eventId: 'evt_run_a_2', name: 'run.progress' },
      { runId: 'run_b', eventId: 'evt_run_b_1', name: 'run.started' },
    ];

    await adapter.appendEvents(events);

    expect(runStore.appendEvents.mock.calls).toEqual([
      ['run_a', [events[0], events[1]]],
      ['run_b', [events[2]]],
    ]);
  });

  it('should_call_appendEvent_per_event_when_runStore_only_supports_appendEvent', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    const runStore = { getEvents: vi.fn(async () => []), appendEvent: vi.fn(async () => {}) };
    const adapter = new RunStoreAdapter(runStore);

    await adapter.appendEvents([
      { runId: 'run_a', eventId: 'evt_run_a_1', name: 'run.started' },
      { runId: 'run_a', eventId: 'evt_run_a_2', name: 'run.progress' },
    ]);

    expect(runStore.appendEvent).toHaveBeenCalledTimes(2);
  });

  it('should_delegate_getEvents_to_runStore', async () => {
    const { RunStoreAdapter } = await importEventBusModule();
    const runStore = { getEvents: vi.fn(async () => []), appendEvents: vi.fn(async () => {}) };
    const adapter = new RunStoreAdapter(runStore);
    await adapter.getEvents('run_a');
    expect(runStore.getEvents).toHaveBeenCalledWith('run_a');
  });
});

describe('EventBus', () => {
  it('should_throw_when_persistenceAdapter_is_not_object', async () => {
    const { EventBus } = await importEventBusModule();
    expect(() => new EventBus({ persistenceAdapter: 123 })).toThrow(/persistenceAdapter must be an object/i);
  });

  it('should_throw_when_persistenceAdapter_missing_appendEvents', async () => {
    const { EventBus } = await importEventBusModule();
    expect(() => new EventBus({ persistenceAdapter: {} })).toThrow(/persistenceAdapter\.appendEvents/i);
  });

  it('should_throw_when_persistenceAdapter_missing_getEvents', async () => {
    const { EventBus } = await importEventBusModule();
    expect(() => new EventBus({ persistenceAdapter: { appendEvents() {} } })).toThrow(/persistenceAdapter\.getEvents/i);
  });

  it('should_return_structured_event_when_emit_given_event_like_object', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_no_adapter' });
    const evt = bus.emit('run.started', { actor: 'system', status: 'started', payload: { ok: true } });
    expect(evt).toMatchObject({
      runId: 'run_no_adapter',
      name: 'run.started',
      actor: 'system',
      status: 'started',
      payload: { ok: true },
    });
  });

  it('should_set_payload_to_null_when_emit_given_null', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_payload_null' });
    const evt = bus.emit('run.progress', null);
    expect(evt.payload).toBe(null);
  });

  it('should_not_call_appendEvents_synchronously_when_emit_with_persistenceAdapter', async () => {
    const { EventBus } = await importEventBusModule();
    const adapter = { appendEvents: vi.fn(), getEvents: vi.fn(async () => []) };
    const bus = new EventBus({ runId: 'run_persist', persistenceAdapter: adapter });
    bus.emit('run.progress', { pct: 50 });
    expect(adapter.appendEvents).not.toHaveBeenCalled();
  });

  it('should_call_appendEvents_asynchronously_when_emit_with_persistenceAdapter', async () => {
    const { EventBus } = await importEventBusModule();
    const adapter = { appendEvents: vi.fn(), getEvents: vi.fn(async () => []) };
    const bus = new EventBus({ runId: 'run_persist', persistenceAdapter: adapter });
    bus.emit('run.progress', { pct: 50 });
    await flushMicrotasks();
    expect(adapter.appendEvents).toHaveBeenCalledTimes(1);
  });

  it('should_persist_emitted_event_record_when_emit_called', async () => {
    const { EventBus } = await importEventBusModule();
    const adapter = { appendEvents: vi.fn(), getEvents: vi.fn(async () => []) };
    const bus = new EventBus({ runId: 'run_persist_payload', persistenceAdapter: adapter });

    const evt = bus.emit('run.progress', { pct: 50 });
    await flushMicrotasks();

    expect(adapter.appendEvents.mock.calls[0][0][0]).toMatchObject({
      runId: 'run_persist_payload',
      eventId: evt.eventId,
      name: 'run.progress',
      payload: { pct: 50 },
    });
  });

  it('should_log_warn_when_persistence_appendEvents_promise_rejects', async () => {
    const { EventBus } = await importEventBusModule();
    const adapter = {
      appendEvents: vi.fn(() => Promise.reject(new Error('boom'))),
      getEvents: vi.fn(async () => []),
    };
    const bus = new EventBus({ runId: 'run_persist_reject', persistenceAdapter: adapter });
    bus.emit('run.started', { actor: 'system', status: 'started' });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it('should_resolve_waitFor_with_type_and_payload_when_matching_event_emitted', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_waitfor' });

    const promise = bus.waitFor('run.started', { timeout: 1000 });
    bus.emit('run.started', { payload: { ok: true } });

    const result = await promise;
    expect(result).toMatchObject({ type: 'run.started', payload: { ok: true } });
  });

  it('should_reject_waitFor_when_signal_already_aborted', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_waitfor_abort' });
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(bus.waitFor('run.started', { timeout: 1000, signal: controller.signal })).rejects.toThrow('stop');
  });

  it('should_reject_waitFor_when_timeout_reached', async () => {
    vi.useFakeTimers();
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_waitfor_timeout' });
    const promise = bus.waitFor('run.never', { timeout: 10 });
    const assertion = expect(promise).rejects.toThrow(/EventBus\.waitFor timeout/i);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it('should_trim_history_when_exceeds_maxHistory', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_history_trim', keepHistory: true, maxHistory: 1 });
    bus.emit('run.started', { payload: { n: 1 } });
    bus.emit('run.progress', { payload: { n: 2 } });
    expect(bus.getHistory().map((e) => e.name)).toEqual(['run.progress']);
  });

  it('should_filter_history_by_pattern_when_getHistory_given_pattern', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_history_filter', keepHistory: true });
    bus.emit('run.started', { payload: { n: 1 } });
    bus.emit('textprep.chunk.started', { payload: { n: 2 } });
    expect(bus.getHistory('run.*').map((e) => e.name)).toEqual(['run.started']);
  });

  it('should_clear_history_when_clearHistory_called', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_history_clear', keepHistory: true });
    bus.emit('run.started', { payload: { n: 1 } });
    bus.clearHistory();
    expect(bus.getHistory()).toEqual([]);
  });

  it('should_return_clock_from_createEventBusClock_with_current_seq', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_clock' });
    bus.emit('run.started', {});
    bus.emit('run.progress', {});
    expect(bus.getClock()).toEqual({ seq: 2 });
  });

  it('should_call_onListenerError_when_handler_throws', async () => {
    const { EventBus } = await importEventBusModule();
    const onListenerError = vi.fn();
    const bus = new EventBus({ runId: 'run_listener_error', onListenerError });
    bus.on('run.started', () => {
      throw new Error('boom');
    });
    bus.emit('run.started', {});
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });

  it('should_call_onListenerError_when_async_handler_rejects', async () => {
    const { EventBus } = await importEventBusModule();
    const onListenerError = vi.fn();
    const bus = new EventBus({ runId: 'run_listener_reject', onListenerError });
    bus.on('run.started', () => Promise.reject(new Error('boom')));
    bus.emit('run.started', {});
    await flushMicrotasks();
    expect(onListenerError).toHaveBeenCalledTimes(1);
  });

  it('should_call_console_error_when_no_onListenerError_and_handler_throws', async () => {
    const { EventBus } = await importEventBusModule();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bus = new EventBus({ runId: 'run_console_error' });
      bus.on('run.started', () => {
        throw new Error('boom');
      });
      bus.emit('run.started', {});
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('should_dispatch_immediately_when_emitSync_called', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_emit_sync' });
    let hits = 0;
    bus.on('run.started', () => hits++);
    bus.emitSync('run.started', {});
    expect(hits).toBe(1);
  });

  it('should_throw_when_enableBackpressure_given_non_object', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_bad_opts' });
    expect(() => bus.enableBackpressure('nope')).toThrow(/options must be an object/i);
  });

  it('should_throw_when_enableBackpressure_given_array', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_bad_opts_array' });
    expect(() => bus.enableBackpressure([])).toThrow(/options must be an object/i);
  });

  it('should_throw_when_enableBackpressure_given_negative_batchWindowMs', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_bad_batch' });
    expect(() => bus.enableBackpressure({ batchWindowMs: -1 })).toThrow(/batchWindowMs/i);
  });

  it('should_throw_when_enableBackpressure_given_non_positive_maxQueueSize', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_bad_max' });
    expect(() => bus.enableBackpressure({ maxQueueSize: 0 })).toThrow(/maxQueueSize/i);
  });

  it('should_flush_pending_queue_when_disableBackpressure_called', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_disable_flush' });
    let hits = 0;
    bus.on('run.started', () => hits++);

    bus.enableBackpressure({ batchWindowMs: 10_000 });
    bus.emit('run.started', {});
    bus.disableBackpressure();

    expect(hits).toBe(1);
  });

  it('should_flush_events_in_queue_order_when_backpressure_flushes', async () => {
    vi.useFakeTimers();
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_coalesce' });

    const seen = [];
    bus.on('*', (e) => seen.push(e));
    bus.enableBackpressure({ batchWindowMs: 0 });

    bus.emit('textprep.chunk.started', { payload: { ok: 1 } });
    for (let i = 1; i <= 5; i++) bus.emit('textprep.chunk.progress', { pct: i });
    bus.emit('textprep.chunk.ended', { payload: { ok: 2 } });

    await vi.runAllTimersAsync();

    expect(seen.map((e) => [e.name, e.payload])).toEqual([
      ['textprep.chunk.started', { ok: 1 }],
      ['textprep.chunk.progress', { pct: 1 }],
      ['textprep.chunk.progress', { pct: 2 }],
      ['textprep.chunk.progress', { pct: 3 }],
      ['textprep.chunk.progress', { pct: 4 }],
      ['textprep.chunk.progress', { pct: 5 }],
      ['textprep.chunk.ended', { ok: 2 }],
    ]);
  });

  it('should_drop_oldest_when_queue_exceeds_maxQueueSize', async () => {
    vi.useFakeTimers();
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_overflow' });

    const seen = [];
    bus.on('run.started', (e) => seen.push(e));
    bus.enableBackpressure({ batchWindowMs: 0, maxQueueSize: 1 });

    bus.emit('run.started', { payload: { n: 1 } });
    bus.emit('run.started', { payload: { n: 2 } });
    await vi.runAllTimersAsync();

    expect(seen).toMatchObject([{ payload: { n: 2 } }]);
  });

  it('should_schedule_flush_with_requestAnimationFrame_when_available', async () => {
    const { EventBus } = await importEventBusModule();

    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancel = globalThis.cancelAnimationFrame;

    let rafCb = null;
    globalThis.requestAnimationFrame = (cb) => {
      rafCb = cb;
      return 1;
    };
    const cancel = vi.fn();
    globalThis.cancelAnimationFrame = cancel;

    try {
      const bus = new EventBus({ runId: 'run_bp_raf_cancel' });
      bus.on('run.progress', () => {});

      bus.enableBackpressure({ batchWindowMs: 0 });
      bus.emit('run.progress', { payload: { pct: 1 } });
      expect(typeof rafCb).toBe('function');
    } finally {
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCancel;
    }
  });

  it('should_call_cancelAnimationFrame_with_raf_id_when_disabling', async () => {
    const { EventBus } = await importEventBusModule();

    const prevRaf = globalThis.requestAnimationFrame;
    const prevCancel = globalThis.cancelAnimationFrame;

    globalThis.requestAnimationFrame = () => 42;
    const cancel = vi.fn();
    globalThis.cancelAnimationFrame = cancel;

    try {
      const bus = new EventBus({ runId: 'run_bp_raf_cancel_id' });
      bus.on('run.progress', () => {});
      bus.enableBackpressure({ batchWindowMs: 0 });
      bus.emit('run.progress', { payload: { pct: 1 } });
      bus.disableBackpressure();
      expect(cancel).toHaveBeenCalledWith(42);
    } finally {
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCancel;
    }
  });

  it('should_flush_pending_queue_when_enableBackpressure_called_while_enabled', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_bp_reenable' });
    let hits = 0;
    bus.on('run.started', () => hits++);

    bus.enableBackpressure({ batchWindowMs: 10_000 });
    bus.emit('run.started', {});
    bus.enableBackpressure({ batchWindowMs: 10_000 });

    expect(hits).toBe(1);
  });

  it('should_throw_when_on_given_non_function_handler', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_on_validate' });
    expect(() => bus.on('run.started', 123)).toThrow(/handler must be a function/i);
  });

  it('should_throw_when_on_given_invalid_event_name', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_on_validate_name' });
    expect(() => bus.on('Run.Started', () => {})).toThrow(/Invalid event name/i);
  });

  it('should_call_once_handler_only_once_when_multiple_events_emitted', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_once' });
    let onceHits = 0;
    bus.once('run.started', () => {
      onceHits += 1;
    });
    bus.emit('run.started', {});
    bus.emit('run.started', {});
    expect(onceHits).toBe(1);
  });

  it('should_not_call_handler_after_off_called', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_off' });
    let hits = 0;
    const fn = () => {
      hits += 1;
    };
    bus.on('run.ended', fn);
    bus.off('run.ended', fn);
    bus.emit('run.ended', {});
    expect(hits).toBe(0);
  });

  it('should_throw_when_replay_called_without_persistenceAdapter', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({ runId: 'run_no_adapter' });
    await expect(bus.replay('run_no_adapter')).rejects.toThrow(/persistenceAdapter is required/i);
  });

  it('should_throw_when_replay_called_with_non_string_runId', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({
      runId: 'run_bad_runid',
      persistenceAdapter: { appendEvents() {}, async getEvents() { return []; } },
    });
    await expect(bus.replay(null)).rejects.toThrow(/runId must be a string/i);
  });

  it('should_throw_when_replay_getEvents_returns_null', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({
      runId: 'run_missing',
      persistenceAdapter: { appendEvents() {}, async getEvents() { return null; } },
    });
    await expect(bus.replay('run_missing')).rejects.toThrow(/no events found.*runId=run_missing/i);
  });

  it('should_throw_when_replay_getEvents_returns_non_array', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({
      runId: 'run_nonarray',
      persistenceAdapter: { appendEvents() {}, async getEvents() { return 'nope'; } },
    });
    await expect(bus.replay('run_nonarray')).rejects.toThrow(/must return an array/i);
  });

  it('should_throw_when_replay_getEvents_throws', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({
      runId: 'run_throws',
      persistenceAdapter: { appendEvents() {}, async getEvents() { throw new Error('db down'); } },
    });
    await expect(bus.replay('run_throws')).rejects.toThrow(/failed to load events.*db down/i);
  });

  it('should_return_empty_when_replay_events_are_malformed', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({
      runId: 'run_malformed',
      persistenceAdapter: { appendEvents() {}, async getEvents() { return [null, 123]; } },
    });
    const replayed = await bus.replay('run_malformed');
    expect(replayed).toEqual([]);
  });

  it('should_mark_replayed_events_with_meta_replay_true', async () => {
    const { EventBus } = await importEventBusModule();
    const bus = new EventBus({
      runId: 'run_replay',
      persistenceAdapter: {
        appendEvents: vi.fn(),
        async getEvents(runId) {
          return [
            {
              schemaVersion: '0.1',
              runId,
              eventId: 'evt_run_replay_1',
              ts: '2025-12-12T22:30:01.000Z',
              name: 'run.progress',
              actor: 'system',
              status: 'progress',
              payload: { pct: 10 },
              meta: { fromStore: true },
            },
          ];
        },
      },
    });

    const seen = [];
    bus.on('run.progress', (e) => seen.push(e));
    await bus.replay('run_replay');

    expect(seen[0].meta).toMatchObject({ fromStore: true, replay: true });
  });

  it('should_not_persist_when_replay_called', async () => {
    const { EventBus } = await importEventBusModule();
    const adapter = {
      appendEvents: vi.fn(),
      async getEvents(runId) {
        return [
          {
            schemaVersion: '0.1',
            runId,
            eventId: 'evt_run_replay_1',
            ts: '2025-12-12T22:30:01.000Z',
            name: 'run.progress',
            actor: 'system',
            status: 'progress',
            payload: { pct: 10 },
          },
        ];
      },
    };
    const bus = new EventBus({ runId: 'run_replay_no_persist', persistenceAdapter: adapter });
    await bus.replay('run_replay_no_persist');
    await flushMicrotasks();
    expect(adapter.appendEvents).not.toHaveBeenCalled();
  });
});
