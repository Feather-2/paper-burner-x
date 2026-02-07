/**
 * MessageBus tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isValidEventNameMock } = vi.hoisted(() => ({
  isValidEventNameMock: vi.fn(() => true),
}));

vi.mock('../../../../js/agents/core/event-bus.js', () => {
  function EventBus() {
    this._handlers = new Map();
  }

  EventBus.prototype.on = function on(name, handler) {
    const handlers = this._handlers.get(name);
    if (handlers) {
      handlers.add(handler);
    } else {
      this._handlers.set(name, new Set([handler]));
    }

    return () => {
      const current = this._handlers.get(name);
      if (current) {
        current.delete(handler);
        if (current.size === 0) this._handlers.delete(name);
      }
    };
  };

  EventBus.prototype.once = function once(name, handler) {
    let off = null;
    const wrapper = (evt) => {
      if (off) off();
      return handler(evt);
    };
    off = this.on(name, wrapper);
    return off;
  };

  EventBus.prototype.emit = function emit(name, data = {}) {
    const evt = this._createEvent(name, data);
    const handlers = this._handlers.get(name);
    if (handlers) {
      for (const fn of Array.from(handlers)) {
        fn(evt);
      }
    }
    return evt;
  };

  EventBus.prototype._createEvent = function _createEvent(name, data) {
    let payload = data;
    let meta;

    if (data && typeof data === 'object' && ('payload' in data || 'actor' in data || 'status' in data)) {
      payload = data.payload;
      meta = data.meta;
    }

    return { type: name, name, payload, meta };
  };

  EventBus.prototype.dispose = function dispose() {
    this._handlers.clear();
  };

  return { EventBus, isValidEventName: isValidEventNameMock };
});

import { MessageBus } from '../../../../js/agents/core/message-bus.js';
import { EventBus, isValidEventName } from '../../../../js/agents/core/event-bus.js';

const buildDeepObject = (depth) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  cursor.value = 'leaf';
  return root;
};

const readDeepValue = (obj, depth) => {
  let cursor = obj;
  for (let i = 0; i < depth; i += 1) {
    cursor = cursor.child;
  }
  return cursor.value;
};

describe('MessageBus', () => {
  beforeEach(() => {
    isValidEventName.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates and owns an EventBus for undefined/null', () => {
      const bus1 = new MessageBus();
      expect(bus1.eventBus).toBeInstanceOf(EventBus);
      const disposeSpy1 = vi.spyOn(bus1.eventBus, 'dispose');
      bus1.dispose();
      expect(disposeSpy1).toHaveBeenCalledTimes(1);

      const bus2 = new MessageBus(null);
      expect(bus2.eventBus).toBeInstanceOf(EventBus);
      const disposeSpy2 = vi.spyOn(bus2.eventBus, 'dispose');
      bus2.dispose();
      expect(disposeSpy2).toHaveBeenCalledTimes(1);
    });

    it('uses a provided EventBus without owning it', () => {
      const eventBus = new EventBus();
      const bus = new MessageBus(eventBus);

      const disposeSpy = vi.spyOn(eventBus, 'dispose');
      bus.dispose();
      expect(disposeSpy).not.toHaveBeenCalled();
    });

    it('throws for invalid EventBus values', () => {
      expect(() => new MessageBus(/** @type {any} */ ({}))).toThrow(TypeError);
    });

    it('swallows EventBus.dispose errors when owning', () => {
      const bus = new MessageBus();
      bus.eventBus.dispose = () => {
        throw new Error('boom');
      };
      expect(() => bus.dispose()).not.toThrow();
    });
  });

  describe('emit', () => {
    it('emits payloads and forwards null/undefined/empty array/object', () => {
      const bus = new MessageBus(new EventBus());
      const handler = vi.fn();

      bus.on('sample:event', handler);
      const record = bus.emit('sample:event', { value: 42 });

      expect(record).toMatchObject({ type: 'sample:event', payload: { value: 42 } });
      expect(handler).toHaveBeenCalledWith({ value: 42 }, expect.objectContaining({ type: 'sample:event' }));

      const payloads = [null, undefined, [], {}];
      payloads.forEach((payload) => bus.emit('sample:event', payload));

      payloads.forEach((payload, index) => {
        const call = handler.mock.calls[index + 1];
        expect(call[0]).toBe(payload);
      });
    });

    it('handles large payloads and deep nesting', () => {
      const bus = new MessageBus(new EventBus());
      const depth = 40;
      const longString = 'x'.repeat(200_000);
      const largeFile = new Uint8Array(2 * 1024 * 1024);
      const nested = buildDeepObject(depth);

      const handler = vi.fn((payload) => {
        expect(payload.text.length).toBe(longString.length);
        expect(payload.file.byteLength).toBe(largeFile.byteLength);
        expect(readDeepValue(payload.nested, depth)).toBe('leaf');
      });

      bus.on('resource:payload', handler);
      bus.emit('resource:payload', { text: longString, file: largeFile, nested });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('rejects empty/whitespace/null/undefined/empty array event types', () => {
      const bus = new MessageBus(new EventBus());
      const invalidTypes = ['', '   ', null, undefined, []];

      for (const type of invalidTypes) {
        expect(() => bus.emit(/** @type {any} */ (type), 'x')).toThrow(/valid event name/i);
      }
    });

    it('handles rapid consecutive emits', () => {
      const bus = new MessageBus(new EventBus());
      const handler = vi.fn();

      bus.on('fast:event', handler);
      for (let i = 0; i < 50; i += 1) {
        bus.emit('fast:event', i);
      }

      expect(handler).toHaveBeenCalledTimes(50);
      expect(handler.mock.calls[0][0]).toBe(0);
      expect(handler.mock.calls[49][0]).toBe(49);
    });

    it('supports channel/to/metadata emit options and dispatches channel subscribers', () => {
      const bus = new MessageBus(new EventBus());
      const baseHandler = vi.fn();
      const channelHandler = vi.fn();

      bus.on('topic:event', baseHandler);
      bus.onChannel('research', 'topic:event', channelHandler);

      const record = bus.emit('topic:event', { value: 7 }, {
        to: 'agent:worker',
        channel: 'research',
        metadata: { source: 'audit-f3' },
      });

      expect(record).toMatchObject({
        type: 'topic:event',
        payload: { value: 7 },
        meta: {
          to: 'agent:worker',
          channel: 'research',
          metadata: { source: 'audit-f3' },
          message: expect.objectContaining({
            type: 'topic:event',
            payload: { value: 7 },
            to: 'agent:worker',
            channel: 'research',
            metadata: { source: 'audit-f3' },
            from: expect.any(String),
            id: expect.any(String),
            ts: expect.any(Number),
          }),
        },
      });

      expect(baseHandler).toHaveBeenCalledWith(
        { value: 7 },
        expect.objectContaining({
          type: 'topic:event',
          meta: expect.objectContaining({
            channel: 'research',
            to: 'agent:worker',
            metadata: { source: 'audit-f3' },
          }),
        })
      );
      expect(channelHandler).toHaveBeenCalledWith(
        { value: 7 },
        expect.objectContaining({
          type: 'channel:research:topic:event',
          meta: expect.objectContaining({ channel: 'research' }),
        })
      );
    });

    it('does not deliver to channel handlers when channel is absent', () => {
      const bus = new MessageBus(new EventBus());
      const channelHandler = vi.fn();

      bus.onChannel('research', 'topic:event', channelHandler);
      bus.emit('topic:event', { value: 1 });

      expect(channelHandler).not.toHaveBeenCalled();
    });
  });

  describe('on', () => {
    it('returns an off function that stops delivery', () => {
      const bus = new MessageBus(new EventBus());
      const handler = vi.fn();

      const off = bus.on('topic:event', handler);
      bus.emit('topic:event', 1);
      expect(handler).toHaveBeenCalledTimes(1);

      off();
      bus.emit('topic:event', 2);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('coerces non-string event types (0, -1, MAX_SAFE_INTEGER, empty object)', () => {
      const bus = new MessageBus(new EventBus());
      const cases = [0, -1, Number.MAX_SAFE_INTEGER, {}];

      for (const value of cases) {
        const handler = vi.fn();
        const off = bus.on(/** @type {any} */ (value), handler);
        const record = bus.emit(/** @type {any} */ (value), 'ok');
        const expectedName = String(value);

        expect(record.type).toBe(expectedName);
        expect(handler).toHaveBeenCalledWith('ok', expect.objectContaining({ type: expectedName }));

        off();
      }
    });

    it('throws when handler is not a function', () => {
      const bus = new MessageBus(new EventBus());
      expect(() => bus.on('topic:event', /** @type {any} */ (null))).toThrow(TypeError);
    });

    it('rejects invalid event names on subscribe', () => {
      const bus = new MessageBus(new EventBus());
      expect(() => bus.on(/** @type {any} */ ([]), () => {})).toThrow(/valid event name/i);
    });
  });

  describe('onChannel', () => {
    it('returns no-op unsubscribe for invalid parameters', () => {
      const bus = new MessageBus(new EventBus());
      expect(bus.onChannel(/** @type {any} */ (null), 'x', () => {})).toBeTypeOf('function');
      expect(bus.onChannel('x', /** @type {any} */ (null), () => {})).toBeTypeOf('function');
      expect(bus.onChannel('x', 'y', /** @type {any} */ (null))).toBeTypeOf('function');
    });

    it('unsubscribe stops channel-specific delivery', () => {
      const bus = new MessageBus(new EventBus());
      const handler = vi.fn();

      const off = bus.onChannel('research', 'topic:event', handler);
      bus.emit('topic:event', 1, { channel: 'research' });
      expect(handler).toHaveBeenCalledTimes(1);

      off();
      bus.emit('topic:event', 2, { channel: 'research' });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('request', () => {
    it('resolves with handler return value and captures RPC metadata', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      let capturedMeta = null;
      eventBus.on('math:sum', (evt) => {
        capturedMeta = evt.meta;
      });

      server.on('math:sum', (payload) => {
        const body = /** @type {{ a: number, b: number }} */ (payload);
        return body.a + body.b;
      });

      await expect(client.request('math:sum', { a: 2, b: 3 }, { timeoutMs: 50 })).resolves.toBe(5);
      expect(capturedMeta).not.toBeNull();
      const meta = /** @type {any} */ (capturedMeta);
      expect(meta).toMatchObject({
        kind: 'rpc_request',
        requestId: expect.any(String),
        replyTo: expect.any(String),
      });
      expect(meta.replyTo).toBe(`rpc.response.${meta.requestId}`);
    });

    it('passes array-like object payloads without coercion', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      const payload = { 0: 'a', length: 1 };
      let received = null;

      server.on('rpc:arraylike', (data) => {
        received = data;
        return Array.isArray(data);
      });

      const result = await client.request('rpc:arraylike', payload, { timeoutMs: 50 });
      expect(result).toBe(false);
      expect(received).toBe(payload);
    });

    it('resolves with raw payload when response body lacks ok', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      eventBus.on('rpc:raw', (evt) => {
        const meta = /** @type {any} */ (evt).meta;
        eventBus.emit(meta.replyTo, {
          payload: { hello: 'world' },
          meta: { kind: 'rpc_response', requestId: meta.requestId },
        });
      });

      await expect(client.request('rpc:raw', { value: 1 }, { timeoutMs: 50 })).resolves.toEqual({ hello: 'world' });
    });

    it('rejects when handler throws errors', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc:fail', () => {
        throw new Error('boom');
      });

      await expect(client.request('rpc:fail', {}, { timeoutMs: 50 })).rejects.toThrow('boom');
    });

    it('rejects with fallback when handler error message is empty', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc:fail-empty', () => {
        throw new Error('');
      });

      await expect(client.request('rpc:fail-empty', {}, { timeoutMs: 50 })).rejects.toThrow('Request failed');
    });

    it('rejects when response meta does not match requestId', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      let requestId = null;
      eventBus.on('rpc:invalid', (evt) => {
        const meta = /** @type {any} */ (evt).meta;
        requestId = meta.requestId;
        eventBus.emit(meta.replyTo, {
          payload: { ok: true, data: 123 },
          meta: { kind: 'rpc_response', requestId: 'wrong_id' },
        });
      });

      const promise = client.request('rpc:invalid', {}, { timeoutMs: 50 });
      await promise.catch((err) => {
        expect(requestId).not.toBeNull();
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe(`Invalid response for requestId: ${requestId}`);
      });
    });

    it('rejects when validator marks event name invalid', () => {
      isValidEventName.mockReturnValue(false);
      const client = new MessageBus(new EventBus());
      expect(() => client.request('bad:name', {})).toThrow(/valid event name/i);
    });

    it('times out with floored timeoutMs', async () => {
      vi.useFakeTimers();
      const client = new MessageBus(new EventBus());

      const promise = client.request('rpc:timeout', {}, { timeoutMs: 12.9 });
      const expectation = expect(promise).rejects.toThrow('Request timeout after 12ms: rpc:timeout');

      await vi.advanceTimersByTimeAsync(12);
      await expectation;
    });

    it('uses default timeout for non-number or non-positive timeoutMs values', async () => {
      vi.useFakeTimers();
      const client = new MessageBus(new EventBus());
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const invalidTimeouts = ['50', 0, -1];
      for (const timeoutMs of invalidTimeouts) {
        const controller = new AbortController();
        const promise = client.request('rpc:timeout-default', {}, { timeoutMs, signal: controller.signal });
        const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];

        expect(lastCall[1]).toBe(30000);

        controller.abort();
        await expect(promise).rejects.toThrow('Request aborted');
      }
    });

    it('accepts MAX_SAFE_INTEGER timeoutMs', async () => {
      vi.useFakeTimers();
      const client = new MessageBus(new EventBus());
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const controller = new AbortController();
      const promise = client.request('rpc:timeout-max', {}, {
        timeoutMs: Number.MAX_SAFE_INTEGER,
        signal: controller.signal,
      });

      const lastCall = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
      expect(lastCall[1]).toBe(Number.MAX_SAFE_INTEGER);

      controller.abort(new Error('stop'));
      await expect(promise).rejects.toThrow('stop');
    });

    it('rejects immediately when signal is pre-aborted (with reason and fallback)', async () => {
      const client = new MessageBus(new EventBus());

      const withReason = new AbortController();
      withReason.abort(new Error('stop-now'));
      await expect(client.request('rpc:abort-pre', {}, { signal: withReason.signal })).rejects.toThrow('stop-now');

      const withoutReason = new AbortController();
      withoutReason.abort(null);
      await expect(client.request('rpc:abort-pre-null', {}, { signal: withoutReason.signal })).rejects.toThrow(
        'Request aborted'
      );
    });

    it('aborts in-flight requests and clears timers', async () => {
      vi.useFakeTimers();
      const client = new MessageBus(new EventBus());
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const controller = new AbortController();
      const promise = client.request('rpc:abort-flight', {}, { timeoutMs: 1000, signal: controller.signal });
      controller.abort(new Error('aborted'));

      await expect(promise).rejects.toThrow('aborted');
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('accepts AbortSignal-like objects without add/remove event listeners', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc:signal-like', () => 'ok');

      const signalLike = { aborted: false };
      await expect(
        client.request('rpc:signal-like', {}, { timeoutMs: 50, signal: /** @type {any} */ (signalLike) })
      ).resolves.toBe('ok');
    });

    it('throws when signal is not AbortSignal-like', () => {
      const client = new MessageBus(new EventBus());
      expect(() => client.request('rpc:bad-signal', {}, { signal: /** @type {any} */ ({}) })).toThrow(TypeError);
    });

    it('supports concurrent requests without cross-talk', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc:echo', async (payload) => {
        await Promise.resolve();
        return payload.id;
      });

      const requests = Array.from({ length: 5 }, (_, index) =>
        client.request('rpc:echo', { id: index }, { timeoutMs: 50 })
      );

      await expect(Promise.all(requests)).resolves.toEqual([0, 1, 2, 3, 4]);
    });
  });
});
