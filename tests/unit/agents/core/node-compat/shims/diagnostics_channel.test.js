import { describe, it, expect, vi } from 'vitest';
import diagnosticsChannel, {
  Channel,
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  TracingChannel,
  tracingChannel,
} from '../../../../../../js/agents/core/node-compat/shims/diagnostics_channel.js';

let counter = 0;
const uniqueName = (prefix = 'diag') => `${prefix}:${Date.now()}:${++counter}`;

describe('diagnostics_channel shim', () => {
  it('Channel supports subscribe/publish/unsubscribe lifecycle', () => {
    const ch = new Channel(uniqueName('direct'));
    const handler = vi.fn();

    expect(ch.hasSubscribers).toBe(false);
    ch.subscribe(handler);
    expect(ch.hasSubscribers).toBe(true);

    ch.publish({ type: 'event' });
    expect(handler).toHaveBeenCalledWith({ type: 'event' }, ch.name);

    expect(ch.unsubscribe(handler)).toBe(true);
    expect(ch.unsubscribe(handler)).toBe(false);
    expect(ch.hasSubscribers).toBe(false);
    expect(ch.unbindStore({})).toBe(false);
    expect(() => ch.bindStore({}, () => {})).not.toThrow();
  });

  it('Channel.publish catches subscriber errors and reports them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ch = new Channel(uniqueName('error'));
    ch.subscribe(() => {
      throw new Error('subscriber failure');
    });

    expect(() => ch.publish({})).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('channel() caches by name and top-level subscribe helpers delegate correctly', () => {
    const name = uniqueName('helpers');
    const handler = vi.fn();
    const first = channel(name);
    const second = channel(name);

    expect(first).toBe(second);
    expect(hasSubscribers(name)).toBe(false);
    expect(hasSubscribers(uniqueName('missing'))).toBe(false);

    subscribe(name, handler);
    expect(hasSubscribers(name)).toBe(true);
    first.publish('payload');
    expect(handler).toHaveBeenCalledWith('payload', name);

    expect(unsubscribe(name, handler)).toBe(true);
    expect(unsubscribe(name, handler)).toBe(false);
    expect(unsubscribe(uniqueName('never-created'), handler)).toBe(false);
  });

  it('TracingChannel handles sync/async success and failure paths', async () => {
    const channels = {
      start: new Channel(uniqueName('trace-start')),
      end: new Channel(uniqueName('trace-end')),
      asyncStart: new Channel(uniqueName('trace-async-start')),
      asyncEnd: new Channel(uniqueName('trace-async-end')),
      error: new Channel(uniqueName('trace-error')),
    };

    const tracing = new TracingChannel(channels);
    const handlers = {
      start: vi.fn(),
      end: vi.fn(),
      asyncStart: vi.fn(),
      asyncEnd: vi.fn(),
      error: vi.fn(),
    };

    expect(tracing.hasSubscribers).toBe(false);
    tracing.subscribe(handlers);
    expect(tracing.hasSubscribers).toBe(true);

    const context = { id: 1 };
    expect(tracing.traceSync(() => 'ok', context)).toBe('ok');
    expect(handlers.start).toHaveBeenCalledWith(context, channels.start.name);
    expect(handlers.end).toHaveBeenCalledWith(context, channels.end.name);

    const syncError = new Error('sync failed');
    expect(() => tracing.traceSync(() => {
      throw syncError;
    }, { phase: 'sync-error' })).toThrow(syncError);
    expect(handlers.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: syncError, phase: 'sync-error' }),
      channels.error.name
    );

    await expect(tracing.tracePromise(async () => 7, { phase: 'async-ok' })).resolves.toBe(7);
    expect(handlers.asyncEnd).toHaveBeenCalledWith({ phase: 'async-ok' }, channels.asyncEnd.name);
    expect(handlers.asyncStart).not.toHaveBeenCalled();

    const asyncError = new Error('async failed');
    await expect(tracing.tracePromise(async () => {
      throw asyncError;
    }, { phase: 'async-error' })).rejects.toThrow(asyncError);

    const original = () => 'noop';
    expect(tracing.traceCallback(original)).toBe(original);

    tracing.unsubscribe(handlers);
    expect(tracing.hasSubscribers).toBe(false);
  });

  it('tracingChannel creates TracingChannel instances from a name', () => {
    const trace = tracingChannel(uniqueName('factory'));
    expect(trace).toBeInstanceOf(TracingChannel);
    expect(trace.channels.start).toBeInstanceOf(Channel);
  });

  it('default export mirrors named exports', () => {
    expect(diagnosticsChannel.channel).toBe(channel);
    expect(diagnosticsChannel.hasSubscribers).toBe(hasSubscribers);
    expect(diagnosticsChannel.subscribe).toBe(subscribe);
    expect(diagnosticsChannel.unsubscribe).toBe(unsubscribe);
    expect(diagnosticsChannel.tracingChannel).toBe(tracingChannel);
    expect(diagnosticsChannel.Channel).toBe(Channel);
    expect(diagnosticsChannel.TracingChannel).toBe(TracingChannel);
  });
});
