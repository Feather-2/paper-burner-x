/**
 * EventBus 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EventBus,
  LamportClock,
  RunStoreAdapter,
  createEventRecord,
  isValidEventName,
  matchPattern,
} from '../../../js/agents/core/index.js';

function nextMicrotask() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ keepHistory: true });
  });

  afterEach(() => {
    bus.dispose();
    try {
      vi.runOnlyPendingTimers();
      vi.clearAllTimers();
    } catch {}
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('emit and on', () => {
    it('should emit and receive events', async () => {
      const handler = vi.fn();
      bus.on('test.event', handler);

      await bus.emit('test.event', { value: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe('test.event');
      expect(handler.mock.calls[0][0].schemaVersion).toBe('0.1');
      expect(handler.mock.calls[0][0].payload).toEqual({ value: 42 });
    });

    it('should support wildcard patterns', async () => {
      const handler = vi.fn();
      bus.on('user.*', handler);

      await bus.emit('user.login', { id: 1 });
      await bus.emit('user.logout', { id: 1 });
      await bus.emit('system.error', {}); // should not match

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should support global wildcard *', async () => {
      const handler = vi.fn();
      bus.on('*', handler);

      await bus.emit('any.event', {});
      await bus.emit('another', {});

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', async () => {
      const handler = vi.fn();
      const unsub = bus.on('test', handler);

      await bus.emit('test', {});
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      await bus.emit('test', {});
      expect(handler).toHaveBeenCalledTimes(1); // still 1
    });

    it('should accept EventRecord-like payload/meta input', async () => {
      const handler = vi.fn();
      bus.on('record.like', handler);

      const evt = await bus.emit('record.like', {
        actor: 'alice',
        status: 'ok',
        level: 'info',
        payload: { value: 1 },
        meta: { source: 'test' },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(evt.actor).toBe('alice');
      expect(evt.status).toBe('ok');
      expect(evt.level).toBe('info');
      expect(evt.payload).toEqual({ value: 1 });
      expect(evt.meta).toEqual({ source: 'test' });
    });
  });

  describe('emitSync', () => {
    it('should emit synchronously', () => {
      const handler = vi.fn();
      bus.on('sync.event', handler);

      bus.emitSync('sync.event', { sync: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('once', () => {
    it('should only fire once', async () => {
      const handler = vi.fn();
      bus.once('one.time', handler);

      await bus.emit('one.time', {});
      await bus.emit('one.time', {});

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('off() should accept original handler for once() wrapper', async () => {
      const handler = vi.fn();
      bus.once('wrapped.once', handler);

      expect(bus.off('wrapped.once', handler)).toBe(true);
      await bus.emit('wrapped.once', {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('priority', () => {
    it('should call high priority handlers first', async () => {
      const order = [];

      bus.on('priority.test', () => order.push('normal'));
      bus.on('priority.test', () => order.push('high'), { priority: 10 });
      bus.on('priority.test', () => order.push('low'), { priority: -10 });

      await bus.emit('priority.test', {});

      expect(order).toEqual(['high', 'normal', 'low']);
    });

    it('should support wildcard priority subscriptions', async () => {
      const handler = vi.fn();
      bus.subscribe('user.*', handler, { priority: 5 });

      await bus.emit('user.login', { id: 1 });
      await bus.emit('system.error', {}); // should not match

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].name).toBe('user.login');
    });
  });

  describe('waitFor', () => {
    it('should wait for event', async () => {
      const promise = bus.waitFor('delayed.event');

      setTimeout(() => {
        bus.emitSync('delayed.event', { delayed: true });
      }, 10);

      const event = await promise;
      expect(event.type).toBe('delayed.event');
      expect(event.payload).toEqual({ delayed: true });
    });

    it('should timeout if event not received', async () => {
      await expect(
        bus.waitFor('never.happens', { timeout: 50 })
      ).rejects.toThrow();
      expect(bus._waiters.size).toBe(0);
    });

    it('should support abort signal', async () => {
      const controller = new AbortController();

      const promise = bus.waitFor('aborted.event', { signal: controller.signal });

      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toThrow();
      expect(bus._waiters.size).toBe(0);
    });

    it('should resolve if event occurs before abort', async () => {
      const controller = new AbortController();
      const promise = bus.waitFor('race.event', { signal: controller.signal });

      bus.emitSync('race.event', { ok: true });
      controller.abort(new Error('abort after emit'));

      const evt = await promise;
      expect(evt.type).toBe('race.event');
      expect(evt.payload).toEqual({ ok: true });
    });

    it('should accept numeric timeout argument', async () => {
      const promise = bus.waitFor('numeric.timeout', 1000);
      bus.emitSync('numeric.timeout', { ok: true });

      const evt = await promise;
      expect(evt.type).toBe('numeric.timeout');
      expect(evt.payload).toEqual({ ok: true });
    });

    it('should reject immediately if signal already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('already aborted'));

      await expect(
        bus.waitFor('never', { signal: controller.signal })
      ).rejects.toThrow(/already aborted/i);
    });
  });

  describe('history', () => {
    it('should keep event history when enabled', async () => {
      await bus.emit('event.1', { n: 1 });
      await bus.emit('event.2', { n: 2 });

      const history = bus.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].type).toBe('event.1');
      expect(history[1].type).toBe('event.2');
    });

    it('should respect maxHistory', async () => {
      const smallBus = new EventBus({ keepHistory: true, maxHistory: 3 });

      for (let i = 0; i < 5; i++) {
        await smallBus.emit('event', { i });
      }

      const history = smallBus.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].payload.i).toBe(2); // oldest kept

      smallBus.dispose();
    });

    it('should filter history by wildcard pattern', async () => {
      await bus.emit('user.login', { id: 1 });
      await bus.emit('user.logout', { id: 1 });
      await bus.emit('system.ready', {});

      const userEvents = bus.getHistory('user.*');
      expect(userEvents.map(e => e.name)).toEqual(['user.login', 'user.logout']);
    });

    it('should clear history', async () => {
      await bus.emit('event.1', { n: 1 });
      expect(bus.getHistory().length).toBe(1);
      bus.clearHistory();
      expect(bus.getHistory()).toEqual([]);
    });
  });

  describe('Lamport clock', () => {
    it('should increment clock on each event', async () => {
      const clock1 = bus.getClock();
      await bus.emit('tick', {});
      const clock2 = bus.getClock();

      expect(clock2.seq).toBeGreaterThan(clock1.seq);
    });
  });

  describe('persistenceAdapter', () => {
    it('should append events asynchronously via queueMicrotask', async () => {
      const appendEvents = vi.fn(() => Promise.resolve());
      const adapter = { appendEvents, getEvents: vi.fn(async () => []) };
      const persistBus = new EventBus({ runId: 'run_persist', persistenceAdapter: adapter });

      persistBus.emit('run.started', { ok: true });
      expect(appendEvents).not.toHaveBeenCalled();

      await nextMicrotask();

      expect(appendEvents).toHaveBeenCalledTimes(1);
      const [events] = appendEvents.mock.calls[0];
      expect(Array.isArray(events)).toBe(true);
      expect(events[0].runId).toBe('run_persist');
      expect(events[0].name).toBe('run.started');
      persistBus.dispose();
    });

    it('should swallow synchronous errors thrown by appendEvents', async () => {
      const appendEvents = vi.fn(() => {
        throw new Error('append failed');
      });
      const adapter = { appendEvents, getEvents: vi.fn(async () => []) };
      const persistBus = new EventBus({ persistenceAdapter: adapter });

      expect(() => persistBus.emit('run.progress', { pct: 1 })).not.toThrow();
      await nextMicrotask();
      expect(appendEvents).toHaveBeenCalledTimes(1);
      persistBus.dispose();
    });

    it('should catch rejected appendEvents promises', async () => {
      const appendEvents = vi.fn(() => Promise.reject(new Error('rejected')));
      const adapter = { appendEvents, getEvents: vi.fn(async () => []) };
      const persistBus = new EventBus({ persistenceAdapter: adapter });

      persistBus.emit('run.progress', { pct: 1 });
      await nextMicrotask();
      expect(appendEvents).toHaveBeenCalledTimes(1);
      persistBus.dispose();
    });

    it('replay() should require a persistenceAdapter', async () => {
      const noPersistBus = new EventBus();
      await expect(noPersistBus.replay('run_x')).rejects.toThrow(/persistenceAdapter required/i);
      noPersistBus.dispose();
    });

    it('replay() should dispatch events and mark meta.replay', async () => {
      const adapter = {
        appendEvents: vi.fn(),
        getEvents: vi.fn(async (runId) => ([
          { runId, name: 'run.started', payload: { ok: true }, meta: { fromStore: true } },
          // missing runId should be filled from replay(runId)
          { name: 'run.progress', payload: { pct: 50 } },
        ])),
      };

      const replayBus = new EventBus({ persistenceAdapter: adapter });
      const seen = [];
      replayBus.on('run.*', (e) => seen.push(e));

      const replayed = await replayBus.replay('run_replay');

      expect(replayed.map(e => e.name)).toEqual(['run.started', 'run.progress']);
      expect(seen).toHaveLength(2);
      expect(seen[0].meta).toEqual({ fromStore: true, replay: true });
      expect(seen[1].runId).toBe('run_replay');
      expect(seen[1].meta).toEqual({ replay: true });
      expect(adapter.appendEvents).not.toHaveBeenCalled();
      replayBus.dispose();
    });

    it('replay() should return empty array when getEvents() is not an array', async () => {
      const adapter = {
        appendEvents: vi.fn(),
        getEvents: vi.fn(async () => null),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      await expect(replayBus.replay('run_x')).resolves.toEqual([]);
      replayBus.dispose();
    });
  });

  describe('backpressure', () => {
    it('should coalesce *.progress events and only dispatch the latest', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      bus.on('run.progress', handler);

      bus.enableBackpressure({ batchWindowMs: 50 });
      bus.emit('run.progress', { pct: 1 });
      bus.emit('run.progress', { pct: 2 });

      expect(handler).toHaveBeenCalledTimes(0);

      // scheduled flush runs later (setTimeout), so drive it manually
      vi.runAllTimers();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].payload).toEqual({ pct: 2 });

      bus.disableBackpressure();
      vi.runAllTimers();
      vi.useRealTimers();
    });

    it('should defer non-coalesced events and dispatch on flush', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      bus.on('run.started', handler);

      bus.enableBackpressure({ batchWindowMs: 50 });
      bus.emit('run.started', { ok: true });

      expect(handler).toHaveBeenCalledTimes(0);
      vi.runAllTimers();
      expect(handler).toHaveBeenCalledTimes(1);

      bus.disableBackpressure();
      vi.useRealTimers();
    });

    it('should dispatch non-coalesced events immediately when deferNonCoalesced=false', () => {
      const handler = vi.fn();
      bus.on('run.started', handler);

      bus.enableBackpressure({ deferNonCoalesced: false });
      bus.emit('run.started', { ok: true });

      expect(handler).toHaveBeenCalledTimes(1);
      bus.disableBackpressure();
    });

    it('should drop oldest items when queue exceeds maxQueueSize', () => {
      vi.useFakeTimers();
      const bpBus = new EventBus();
      const handler = vi.fn();
      bpBus.on('evt', handler);

      bpBus.enableBackpressure({
        batchWindowMs: 50,
        maxQueueSize: 1,
        // never coalesce; push as normal events
        coalescePattern: /$^/,
      });

      bpBus.emit('evt', { n: 1 });
      bpBus.emit('evt', { n: 2 });

      vi.runAllTimers();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].payload).toEqual({ n: 2 });

      bpBus.dispose();
      vi.useRealTimers();
    });

    it('should use requestAnimationFrame when available', () => {
      const handler = vi.fn();
      bus.on('run.progress', handler);

      const previous = globalThis.requestAnimationFrame;
      const raf = vi.fn((cb) => cb());
      globalThis.requestAnimationFrame = raf;

      try {
        bus.enableBackpressure({ batchWindowMs: 50 });
        bus.emit('run.progress', { pct: 1 });

        expect(raf).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.requestAnimationFrame = previous;
        bus.disableBackpressure();
      }
    });
  });

  describe('error handling', () => {
    it('should isolate handler errors and report via console.error by default', () => {
      const good = vi.fn();
      const bad = vi.fn(() => {
        throw new Error('boom');
      });

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      bus.on('err.event', bad);
      bus.on('err.event', good);

      expect(() => bus.emitSync('err.event', {})).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should delegate sync/async errors to onListenerError', async () => {
      const onListenerError = vi.fn();
      const errBus = new EventBus({ onListenerError });

      const syncErr = new Error('sync');
      const asyncErr = new Error('async');
      const badSync = vi.fn(() => { throw syncErr; });
      const badAsync = vi.fn(() => Promise.reject(asyncErr));

      errBus.on('err', badSync);
      errBus.on('err', badAsync);

      errBus.emit('err', {});
      await nextMicrotask();

      expect(onListenerError).toHaveBeenCalledWith(
        syncErr,
        expect.objectContaining({ name: 'err' }),
        badSync
      );
      expect(onListenerError).toHaveBeenCalledWith(
        asyncErr,
        expect.objectContaining({ name: 'err' }),
        badAsync
      );
      errBus.dispose();
    });

    it('should swallow errors thrown inside onListenerError', () => {
      const errBus = new EventBus({
        onListenerError: () => {
          throw new Error('onListenerError failed');
        },
      });

      errBus.on('err', () => {
        throw new Error('handler failed');
      });

      expect(() => errBus.emitSync('err', {})).not.toThrow();
      errBus.dispose();
    });
  });

  describe('subscribe AbortSignal', () => {
    it('should auto-unsubscribe when signal aborts', async () => {
      const controller = new AbortController();
      const handler = vi.fn();

      bus.subscribe('abort.test', handler, { signal: controller.signal });

      await bus.emit('abort.test', { n: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      controller.abort();
      await bus.emit('abort.test', { n: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should be a noop if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const handler = vi.fn();
      const unsub = bus.subscribe('already.aborted', handler, { signal: controller.signal });

      expect(typeof unsub).toBe('function');
      await bus.emit('already.aborted', {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('misc', () => {
    it('on() should validate handler type', () => {
      expect(() => bus.on('bad.handler', null)).toThrow(/handler must be a function/i);
    });

    it('clear() should remove listeners and reset history', async () => {
      const handler = vi.fn();
      bus.on('clear.event', handler);
      await bus.emit('clear.event', {});
      expect(bus.getHistory().length).toBe(1);

      bus.clear();
      expect(bus.getHistory()).toEqual([]);
      bus.emitSync('clear.event', {});
      expect(handler).toHaveBeenCalledTimes(1);
      expect(bus.getHistory().map(e => e.name)).toEqual(['clear.event']);
    });

    it('getClock() should return a snapshot object', () => {
      const clock = bus.getClock();
      expect(clock).toEqual(expect.objectContaining({
        seq: expect.any(Number),
        id: expect.stringMatching(/^eventbus_/),
        ts: expect.any(Number),
      }));
    });
  });
});

describe('matchPattern / isValidEventName', () => {
  it('isValidEventName should validate event names and global wildcard', () => {
    expect(isValidEventName('*')).toBe(true);
    expect(isValidEventName('user.login')).toBe(true);
    expect(isValidEventName('user_login')).toBe(true);
    expect(isValidEventName('Bad Name')).toBe(false);
    expect(isValidEventName('a..b')).toBe(false);
  });

  it('matchPattern should support fast path prefix.* and exact match', () => {
    expect(matchPattern('user.*', 'user')).toBe(true);
    expect(matchPattern('user.*', 'user.login')).toBe(true);
    expect(matchPattern('user.login', 'user.login')).toBe(true);
    expect(matchPattern('user.login', 'user.logout')).toBe(false);
  });

  it('matchPattern should support general * and ? wildcards (no ReDoS regex)', () => {
    expect(matchPattern('run.*.progress', 'run.step.progress')).toBe(true);
    expect(matchPattern('a*?d', 'abcd')).toBe(true);
    expect(matchPattern('a*?d', 'abdd')).toBe(true);
    expect(matchPattern('a*?d', 'ad')).toBe(false);
  });

  it('matchPattern should return false for non-string inputs', () => {
    expect(matchPattern(null, 'x')).toBe(false);
    expect(matchPattern('x', null)).toBe(false);
  });
});

describe('createEventRecord', () => {
  it('should support legacy aliases (id/type/timestamp/clock)', () => {
    const record = createEventRecord({
      id: 'evt_legacy_1',
      type: 'legacy.event',
      timestamp: 1_700_000_000_000,
      clock: { seq: 7, ts: 0, id: 'node' },
    });

    expect(record.eventId).toBe('evt_legacy_1');
    expect(record.name).toBe('legacy.event');
    expect(record.timestamp).toBe(1_700_000_000_000);
    expect(record.seq).toBe(7);
    expect(record._clock.seq).toBe(7);
    expect(record.actor).toBe('system');
  });

  it('should derive timestamp from ts when timestamp is missing', () => {
    const ts = '2020-01-01T00:00:00.000Z';
    const record = createEventRecord({ name: 'ts.test', ts });
    expect(record.ts).toBe(ts);
    expect(record.timestamp).toBe(Date.parse(ts));
  });

  it('should fall back to Date.now() when ts is invalid and timestamp missing', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    const record = createEventRecord({ name: 'bad.ts', ts: 'not-a-date' });
    expect(record.timestamp).toBe(1234567890);
    nowSpy.mockRestore();
  });
});

describe('RunStoreAdapter', () => {
  it('should validate constructor args', () => {
    expect(() => new RunStoreAdapter(null)).toThrow(/runStore must be an object/i);
    expect(() => new RunStoreAdapter({ appendEvents() {} })).toThrow(/getEvents must be a function/i);
    expect(() => new RunStoreAdapter({ getEvents() {} })).toThrow(/appendEvents\/appendEvent must be a function/i);
  });

  it('appendEvents should validate input', () => {
    const adapter = new RunStoreAdapter({
      getEvents: vi.fn(async () => []),
      appendEvents: vi.fn(async () => {}),
    });

    expect(() => adapter.appendEvents(null)).toThrow(/events must be an array/i);
    expect(adapter.appendEvents([])).toBe(0);
  });

  it('should batch by runId when runStore.appendEvents exists', async () => {
    const runStore = {
      getEvents: vi.fn(async () => []),
      appendEvents: vi.fn(async () => {}),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: 'r1', name: 'a' },
      { runId: 'r1', name: 'b' },
      { runId: 'r2', name: 'c' },
      { runId: null, name: 'ignored' },
      'not-an-object',
    ];

    await expect(adapter.appendEvents(events)).resolves.toBe(events.length);
    expect(runStore.appendEvents).toHaveBeenCalledTimes(2);
    expect(runStore.appendEvents).toHaveBeenCalledWith('r1', expect.arrayContaining([
      expect.objectContaining({ name: 'a' }),
      expect.objectContaining({ name: 'b' }),
    ]));
    expect(runStore.appendEvents).toHaveBeenCalledWith('r2', expect.arrayContaining([
      expect.objectContaining({ name: 'c' }),
    ]));
  });

  it('should fall back to per-event append when appendEvent-only', async () => {
    const runStore = {
      getEvents: vi.fn(async () => []),
      appendEvent: vi.fn(async () => {}),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: 'r1', name: 'a' },
      { runId: 'r2', name: 'b' },
      { runId: null, name: 'ignored' },
    ];

    await expect(adapter.appendEvents(events)).resolves.toBe(events.length);
    expect(runStore.appendEvent).toHaveBeenCalledTimes(2);
    expect(runStore.appendEvent).toHaveBeenCalledWith('r1', expect.objectContaining({ name: 'a' }));
    expect(runStore.appendEvent).toHaveBeenCalledWith('r2', expect.objectContaining({ name: 'b' }));
  });
});

describe('LamportClock', () => {
  it('should start at 0', () => {
    const clock = new LamportClock('node1');
    const state = clock.get();
    expect(state.seq).toBe(0);
  });

  it('should increment on tick', () => {
    const clock = new LamportClock('node1');
    clock.tick();
    clock.tick();
    expect(clock.get().seq).toBe(2);
  });

  it('should update from remote clock', () => {
    const clock1 = new LamportClock('node1');
    const clock2 = new LamportClock('node2');

    clock1.tick();
    clock1.tick();
    clock1.tick(); // seq = 3

    clock2.tick(); // seq = 1

    clock2.update(clock1.get()); // should jump to 4

    expect(clock2.get().seq).toBe(4);
  });

  it('should include node id', () => {
    const clock = new LamportClock('my-node');
    const state = clock.tick();
    expect(state.id).toContain('my-node');
  });
});
