/**
 * MessageBus 测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, MessageBus } from '../../../../js/agents/core/index.js';

describe('MessageBus', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates and owns an EventBus by default (undefined/null)', () => {
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

    it('accepts an EventBus instance without owning it', () => {
      const eventBus = new EventBus();
      const bus = new MessageBus(eventBus);

      const disposeSpy = vi.spyOn(eventBus, 'dispose');
      bus.dispose();
      expect(disposeSpy).not.toHaveBeenCalled();

      eventBus.dispose();
    });

    it('throws for invalid eventBus', () => {
      expect(() => new MessageBus(/** @type {any} */ ({}))).toThrow(TypeError);
    });

    it('dispose swallows EventBus.dispose errors when owned', () => {
      const bus = new MessageBus();
      bus.eventBus.dispose = () => {
        throw new Error('boom');
      };
      expect(() => bus.dispose()).not.toThrow();
    });
  });

  describe('emit / on / off', () => {
    /** @type {EventBus} */
    let eventBus;
    /** @type {MessageBus} */
    let bus;

    beforeEach(() => {
      eventBus = new EventBus();
      bus = new MessageBus(eventBus);
    });

    afterEach(() => {
      bus.dispose();
      eventBus.dispose();
    });

    it('emits and receives payload (non-RPC)', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);

      const record = bus.emit('test.event', { value: 42 });

      expect(record.type).toBe('test.event');
      expect(record.payload).toEqual({ value: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ value: 42 });
      expect(handler.mock.calls[0][1]?.type).toBe('test.event');
    });

    it('returns an unsubscribe function (off) that stops delivery', () => {
      const handler = vi.fn();
      const off = bus.on('topic', handler);

      bus.emit('topic', 1);
      expect(handler).toHaveBeenCalledTimes(1);

      off();
      bus.emit('topic', 2);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('coerces non-string type to event name', () => {
      const handler = vi.fn();
      bus.on(/** @type {any} */ (42), handler);

      bus.emit(/** @type {any} */ (42), 'x');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('x', expect.any(Object));
      expect(handler.mock.calls[0][1]?.type).toBe('42');
    });

    it('validates event names and handlers', () => {
      expect(() => bus.emit('bad name', {})).toThrow(/valid event name/i);
      expect(() => bus.on('bad name', () => {})).toThrow(/valid event name/i);
      expect(() => bus.on('ok', /** @type {any} */ (null))).toThrow(TypeError);
    });
  });

  describe('RPC request/response', () => {
    it('resolves with handler return value and request meta is well-formed', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      /** @type {any} */
      let capturedMeta = null;
      const offCapture = eventBus.on('math.add', (evt) => {
        capturedMeta = /** @type {any} */ (evt)?.meta;
      });

      const offServer = server.on('math.add', (payload) => {
        const body = /** @type {{ a: number, b: number }} */ (payload);
        return body.a + body.b;
      });

      const result = await client.request('math.add', { a: 2, b: 3 }, { timeoutMs: 50 });
      expect(result).toBe(5);

      expect(capturedMeta).toMatchObject({
        kind: 'rpc_request',
        requestId: expect.any(String),
        replyTo: expect.any(String),
      });
      expect(capturedMeta.replyTo).toBe(`rpc.response.${capturedMeta.requestId}`);

      offServer();
      offCapture();
      eventBus.dispose();
    });

    it('falls back to a time/random requestId when crypto.randomUUID returns a falsy value', async () => {
      const cryptoProto = Object.getPrototypeOf(globalThis.crypto);
      const randomUUIDSpy = vi.spyOn(cryptoProto, 'randomUUID').mockReturnValue('');

      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      let requestId = null;
      const off = eventBus.on('rpc.fallback', (evt) => {
        /** @type {any} */
        const meta = /** @type {any} */ (evt)?.meta;
        if (!meta || meta.kind !== 'rpc_request') return;

        requestId = meta.requestId;
        eventBus.emit(meta.replyTo, {
          payload: { ok: true, data: 'ok' },
          meta: { kind: 'rpc_response', requestId: meta.requestId },
        });
      });

      await expect(client.request('rpc.fallback', {}, { timeoutMs: 50 })).resolves.toBe('ok');
      expect(randomUUIDSpy).toHaveBeenCalled();
      expect(requestId).toMatch(/^r[0-9a-z]+_[0-9a-z]+$/i);

      off();
      eventBus.dispose();
    });

    it('rejects with handler error message', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc.fail', () => {
        throw new Error('boom');
      });

      await expect(client.request('rpc.fail', {}, { timeoutMs: 50 })).rejects.toThrow('boom');
      eventBus.dispose();
    });

    it('rejects with a generic message when handler produces an empty error message', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc.fail.empty', () => {
        throw new Error('');
      });

      await expect(client.request('rpc.fail.empty', {}, { timeoutMs: 50 })).rejects.toThrow('Request failed');
      eventBus.dispose();
    });

    it('validates request event names', () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      expect(() => client.request('bad name', {})).toThrow(/valid event name/i);

      eventBus.dispose();
    });

    it('supports response payload passthrough when body has no ok field', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      const off = eventBus.on('raw.reply', (evt) => {
        /** @type {any} */
        const meta = /** @type {any} */ (evt)?.meta;
        if (!meta || meta.kind !== 'rpc_request') return;

        eventBus.emit(meta.replyTo, {
          payload: { hello: 'world' },
          meta: { kind: 'rpc_response', requestId: meta.requestId },
        });
      });

      await expect(client.request('raw.reply', { x: 1 }, { timeoutMs: 50 })).resolves.toEqual({ hello: 'world' });

      off();
      eventBus.dispose();
    });

    it('rejects on invalid response meta (requestId mismatch)', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      let requestId = null;
      const off = eventBus.on('raw.invalid', (evt) => {
        /** @type {any} */
        const meta = /** @type {any} */ (evt)?.meta;
        if (!meta || meta.kind !== 'rpc_request') return;

        requestId = meta.requestId;
        eventBus.emit(meta.replyTo, {
          payload: { ok: true, data: 123 },
          meta: { kind: 'rpc_response', requestId: 'wrong_id' },
        });
      });

      await expect(client.request('raw.invalid', {}, { timeoutMs: 50 })).rejects.toThrow(
        `Invalid response for requestId: ${requestId}`
      );

      off();
      eventBus.dispose();
    });

    it('times out and floors timeoutMs to a positive int', async () => {
      vi.useFakeTimers();

      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      const promise = client.request('never.responds', {}, { timeoutMs: 12.9 });
      const expectation = expect(promise).rejects.toThrow('Request timeout after 12ms: never.responds');
      await vi.advanceTimersByTimeAsync(12);

      await expectation;
      eventBus.dispose();
    });

    it('supports AbortSignal (pre-aborted and in-flight abort)', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      const pre = new AbortController();
      pre.abort(new Error('stop-now'));
      await expect(client.request('aborted.pre', {}, { signal: pre.signal })).rejects.toThrow('stop-now');

      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const inflight = new AbortController();
      const promise = client.request('aborted.inflight', {}, { timeoutMs: 1000, signal: inflight.signal });
      const expectation = expect(promise).rejects.toThrow('aborted');
      inflight.abort(new Error('aborted'));
      await expectation;
      expect(clearTimeoutSpy).toHaveBeenCalled();

      eventBus.dispose();
    });

    it('uses "Request aborted" fallback when AbortSignal.reason is falsy', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      const pre = new AbortController();
      pre.abort(null);
      await expect(client.request('aborted.pre.null', {}, { signal: pre.signal })).rejects.toThrow('Request aborted');

      vi.useFakeTimers();
      const inflight = new AbortController();
      const promise = client.request('aborted.inflight.null', {}, { timeoutMs: 1000, signal: inflight.signal });
      const expectation = expect(promise).rejects.toThrow('Request aborted');
      inflight.abort(null);
      await expectation;

      eventBus.dispose();
    });

    it('accepts AbortSignal-like objects without addEventListener/removeEventListener', async () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);
      const server = new MessageBus(eventBus);

      server.on('rpc.signal.like', () => 'ok');

      const signalLike = { aborted: false };
      await expect(
        client.request('rpc.signal.like', {}, { timeoutMs: 50, signal: /** @type {any} */ (signalLike) })
      ).resolves.toBe('ok');

      eventBus.dispose();
    });

    it('validates AbortSignal option type', () => {
      const eventBus = new EventBus();
      const client = new MessageBus(eventBus);

      expect(() => client.request('ok.event', {}, { signal: /** @type {any} */ ({}) })).toThrow(TypeError);

      eventBus.dispose();
    });
  });
});
