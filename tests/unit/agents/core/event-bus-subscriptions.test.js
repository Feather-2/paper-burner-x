import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../js/agents/core/event-bus-utils.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    assertValidEventName: vi.fn(actual.assertValidEventName),
    assertValidEventPattern: vi.fn(actual.assertValidEventPattern),
    matchPattern: vi.fn(actual.matchPattern),
  };
});

import { EventBusSubscriptions } from '../../../../js/agents/core/event-bus-subscriptions.js';
import {
  assertValidEventName,
  assertValidEventPattern,
  matchPattern,
} from '../../../../js/agents/core/event-bus-utils.js';

function createAbortSignal() {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener: vi.fn((type, callback) => {
      if (type === 'abort') listeners.add(callback);
    }),
    removeEventListener: vi.fn((type, callback) => {
      if (type === 'abort') listeners.delete(callback);
    }),
  };

  signal.abort = () => {
    if (signal.aborted) return;
    signal.aborted = true;
    for (const callback of [...listeners]) callback();
  };

  return signal;
}

describe('EventBusSubscriptions', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBusSubscriptions();
    vi.clearAllMocks();
  });

  describe('on', () => {
    it('registers exact listeners and unsubscribes', () => {
      const handler = vi.fn();

      const unsubscribe = bus.on('user.login', handler);

      expect(assertValidEventName).toHaveBeenCalledWith('user.login');
      const handlers = bus.collectHandlers('user.login');
      expect(handlers).toHaveLength(1);
      expect(handlers[0].fn).toBe(handler);
      expect(handlers[0].priority).toBe(0);

      unsubscribe();
      expect(bus.collectHandlers('user.login')).toHaveLength(0);
    });

    it('registers wildcard listeners and validates pattern', () => {
      const handler = vi.fn();

      bus.on('user.*', handler);

      expect(assertValidEventPattern).toHaveBeenCalledWith('user.*');
      const handlers = bus.collectHandlers('user.login');
      expect(handlers.some((item) => item.fn === handler)).toBe(true);
      expect(matchPattern).toHaveBeenCalledWith('user.*', 'user.login');
    });

    it('delegates to subscribe for non-zero priority', () => {
      const handler = vi.fn();
      const spy = vi.spyOn(bus, 'subscribe');

      const unsubscribe = bus.on('priority.event', handler, { priority: 5 });

      expect(spy).toHaveBeenCalledWith('priority.event', handler, { priority: 5 });
      const handlers = bus.collectHandlers('priority.event');
      expect(handlers.some((item) => item.fn === handler && item.priority === 5)).toBe(true);

      unsubscribe();
      expect(bus.collectHandlers('priority.event')).toHaveLength(0);
    });

    it.each([null, undefined, ''])('throws for invalid handler %p', (badHandler) => {
      expect(() => bus.on('test.event', badHandler)).toThrow(/handler must be a function/i);
    });

    it.each([null, undefined, ''])('throws for invalid event name %p', (badName) => {
      expect(() => bus.on(badName, () => {})).toThrow(/Invalid event name/);
    });

    it('rejects whitespace-only event names', () => {
      expect(() => bus.on('   ', () => {})).toThrow(/Invalid event name/);
      expect(assertValidEventName).toHaveBeenCalledWith('   ');
    });
  });

  describe('once', () => {
    it('removes wrapper after first invocation', () => {
      const handler = vi.fn();
      bus.once('only.once', handler);

      const handlers = bus.collectHandlers('only.once');
      expect(handlers).toHaveLength(1);

      handlers[0].fn({ type: 'only.once' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(bus.collectHandlers('only.once')).toHaveLength(0);
    });

    it('off accepts original handler for once wrapper', () => {
      const handler = vi.fn();
      bus.once('wrapped.once', handler);

      expect(bus.off('wrapped.once', handler)).toBe(true);
      expect(bus.collectHandlers('wrapped.once')).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    it('throws for non-function handler', () => {
      expect(() => bus.subscribe('test.event', 'not-a-fn')).toThrow(/handler must be a function/i);
    });

    it.each([null, undefined, '', [], {}])(
      'throws for invalid event type %p (object-as-array boundary)',
      (badName) => {
        expect(() => bus.subscribe(badName, () => {})).toThrow(/Invalid event name/);
      }
    );

    it.each([
      ['string', '1'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['object', {}],
    ])('throws for invalid priority %s', (_label, value) => {
      expect(() => bus.subscribe('test.event', () => {}, { priority: value })).toThrow(
        /priority must be a finite number/i
      );
    });

    it('returns no-op when signal is already aborted', () => {
      const handler = vi.fn();
      const unsubscribe = bus.subscribe('aborted.event', handler, { signal: { aborted: true } });

      expect(typeof unsubscribe).toBe('function');
      expect(bus.collectHandlers('aborted.event')).toHaveLength(0);
    });

    it('removes listener when AbortSignal aborts and is idempotent', () => {
      const signal = createAbortSignal();
      const handler = vi.fn();

      const unsubscribe = bus.subscribe('signal.event', handler, { signal });

      expect(signal.addEventListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
        { once: true }
      );
      expect(bus.collectHandlers('signal.event')).toHaveLength(1);

      signal.abort();

      expect(bus.collectHandlers('signal.event')).toHaveLength(0);
      unsubscribe();
      unsubscribe();
      expect(signal.removeEventListener).toHaveBeenCalledTimes(1);
    });

    it('registers wildcard subscriptions with priority', () => {
      const handler = vi.fn();

      bus.subscribe('user.*', handler, { priority: 2 });

      const handlers = bus.collectHandlers('user.login');
      expect(handlers).toHaveLength(1);
      expect(handlers[0].fn).toBe(handler);
      expect(handlers[0].priority).toBe(2);
      expect(matchPattern).toHaveBeenCalledWith('user.*', 'user.login');
    });

    it('accepts priority boundaries and orders handlers', () => {
      const order = [];
      const low = () => order.push('low');
      const normal = () => order.push('normal');
      const high = () => order.push('high');

      bus.subscribe('priority.event', low, { priority: -1 });
      bus.subscribe('priority.event', normal, { priority: 0 });
      bus.subscribe('priority.event', high, { priority: Number.MAX_SAFE_INTEGER });

      const handlers = bus.collectHandlers('priority.event');
      handlers.forEach(({ fn }) => fn({ type: 'priority.event' }));

      expect(order).toEqual(['high', 'normal', 'low']);
    });
  });

  describe('off', () => {
    it('returns false when no handler is found', () => {
      const handler = vi.fn();

      expect(bus.off('missing.event', handler)).toBe(false);
    });

    it('removes direct and wildcard listeners', () => {
      const direct = vi.fn();
      const wildcard = vi.fn();

      bus.on('system.ready', direct);
      bus.on('system.*', wildcard);

      expect(bus.off('system.ready', direct)).toBe(true);
      expect(bus.off('system.*', wildcard)).toBe(true);
      expect(bus.collectHandlers('system.ready')).toHaveLength(0);
    });
  });

  describe('collectHandlers', () => {
    it('collects direct, wildcard, and wildcard priority handlers', () => {
      const direct = vi.fn();
      const wildcard = vi.fn();
      const wildcardPriority = vi.fn();

      bus.on('user.login', direct);
      bus.on('user.*', wildcard);
      bus.subscribe('user.*', wildcardPriority, { priority: 3 });

      const handlers = bus.collectHandlers('user.login');
      const functions = handlers.map((item) => item.fn);

      expect(functions).toEqual(expect.arrayContaining([direct, wildcard, wildcardPriority]));
      expect(handlers.find((item) => item.fn === wildcardPriority).priority).toBe(3);
      expect(matchPattern).toHaveBeenCalledWith('user.*', 'user.login');
    });
  });

  describe('clear', () => {
    it('clears all listener maps', () => {
      bus.on('alpha', () => {});
      bus.on('alpha.*', () => {});
      bus.subscribe('beta', () => {}, { priority: 1 });
      bus.subscribe('beta.*', () => {}, { priority: 1 });

      bus.clear();

      expect(bus.collectHandlers('alpha')).toHaveLength(0);
      expect(bus.collectHandlers('beta')).toHaveLength(0);
      expect(bus._listeners.size).toBe(0);
      expect(bus._wildcardListeners.size).toBe(0);
      expect(bus._priorityListeners.size).toBe(0);
      expect(bus._wildcardPriorityListeners.size).toBe(0);
    });
  });

  describe('boundaries', () => {
    it('handles concurrent registrations and rapid consecutive unsubscriptions', async () => {
      const handlers = Array.from({ length: 25 }, () => vi.fn());

      const unsubs = await Promise.all(
        handlers.map((handler) => Promise.resolve().then(() => bus.on('burst.event', handler)))
      );

      expect(bus.collectHandlers('burst.event')).toHaveLength(25);

      unsubs.forEach((unsub) => {
        unsub();
        unsub();
      });

      expect(bus.collectHandlers('burst.event')).toHaveLength(0);
    });

    it('handles very long event names (long string boundary)', () => {
      const longName = 'a'.repeat(10000);
      const handler = vi.fn();

      bus.on(longName, handler);

      const handlers = bus.collectHandlers(longName);
      expect(handlers).toHaveLength(1);
      expect(handlers[0].fn).toBe(handler);
      expect(assertValidEventName).toHaveBeenCalledWith(longName);
    });

    it('handles deeply nested event names', () => {
      const deepName = Array.from({ length: 50 }, (_, index) => 'seg' + index).join('.');
      const handler = vi.fn();

      bus.on(deepName, handler);

      expect(bus.collectHandlers(deepName)).toHaveLength(1);
      expect(assertValidEventName).toHaveBeenCalledWith(deepName);
    });

    it('handles large handler sets (resource boundary)', () => {
      const handlerCount = 1000;
      for (let i = 0; i < handlerCount; i += 1) {
        bus.on('bulk.event', () => {});
      }

      expect(bus.collectHandlers('bulk.event')).toHaveLength(handlerCount);
    });
  });
});
