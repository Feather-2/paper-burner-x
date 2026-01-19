import { afterEach, describe, expect, it, vi } from 'vitest';

import TraceContext, {
  Span,
  SpanStatus,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  withSpan as withSpanHelper,
} from '../../../../js/agents/runtime/telemetry/trace-context.js';

import {
  LoopRuntimeState,
  LoopRuntimeStatuses,
  clearRuntimeState,
  ensureRuntimeState,
  getRuntimeState,
  setRuntimeState,
} from '../../../../js/agents/runtime/telemetry/loop-runtime-state.js';

import { RunReplayController } from '../../../../js/agents/runtime/telemetry/replay-controller.js';

function silenceConsole() {
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
  return () => spies.forEach((s) => s.mockRestore());
}

function overrideGlobalProperty(key, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => {
    if (original) Object.defineProperty(globalThis, key, original);
    else Reflect.deleteProperty(globalThis, key);
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runtime/telemetry TraceContext', () => {
  it('Span supports attributes/events/status, and end() finalizes span', () => {
    const restoreConsole = silenceConsole();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const span = new Span({ name: 'work', traceId: 'a'.repeat(32), attributes: { a: 1 } });
    expect(span.traceparent).toBe(`00-${span.traceId}-${span.spanId}-01`);
    expect(span.isEnded).toBe(false);

    span.setAttribute('k', 'v');
    span.setAttributes({ b: 2 });
    span.addEvent('evt', { x: 1 });
    span.recordException(new Error('boom'));

    expect(span.status).toBe(SpanStatus.ERROR);
    expect(span.statusMessage).toBe('boom');
    expect(span.attributes).toMatchObject({ a: 1, b: 2, k: 'v' });
    expect(span.events.map((e) => e.name)).toEqual(['evt', 'exception']);

    vi.setSystemTime(new Date('2020-01-01T00:00:01.000Z'));
    span.end();
    const endedAt = span.endTime;
    expect(span.isEnded).toBe(true);
    expect(endedAt).toBe(Date.now());

    span.setAttribute('after', 1);
    span.addEvent('after');
    expect(span.attributes.after).toBeUndefined();
    expect(span.events.map((e) => e.name)).toEqual(['evt', 'exception']);

    span.end();
    expect(span.endTime).toBe(endedAt);

    restoreConsole();
  });

  it('TraceContext startSpan/endSpan manage stack and onSpanEnd callback', () => {
    const restoreConsole = silenceConsole();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const onSpanEnd = vi.fn();
    const ctx = new TraceContext({
      traceId: 'b'.repeat(32),
      parentSpanId: 'c'.repeat(16),
      onSpanEnd,
      maxSpans: 5,
    });

    const spanA = ctx.startSpan('a');
    expect(spanA.parentSpanId).toBe('c'.repeat(16));
    expect(ctx.currentSpan).toBe(spanA);

    const spanB = ctx.createSpan('b');
    expect(spanB.parentSpanId).toBe(spanA.spanId);
    expect(ctx.currentSpan).toBe(spanB);

    ctx.endSpan();
    expect(spanB.isEnded).toBe(true);
    expect(onSpanEnd).toHaveBeenCalledWith(spanB);
    expect(ctx.currentSpan).toBe(spanA);

    ctx.endSpan(spanA);
    expect(spanA.isEnded).toBe(true);
    expect(onSpanEnd).toHaveBeenCalledWith(spanA);
    expect(ctx.currentSpan).toBe(null);

    ctx.endSpan();

    restoreConsole();
  });

  it('TraceContext.withSpan wraps success and error flows', async () => {
    const restoreConsole = silenceConsole();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const ctx = new TraceContext({ traceId: 'd'.repeat(32) });

    const result = await ctx.withSpan('ok-op', (span) => {
      span.setAttribute('x', 1);
      return 123;
    });
    expect(result).toBe(123);
    expect(ctx.currentSpan).toBe(null);

    await expect(
      ctx.withSpan('fail-op', () => {
        throw new Error('bad');
      })
    ).rejects.toThrow('bad');

    const spans = ctx.getSpans();
    const okSpan = spans.find((s) => s.name === 'ok-op');
    const failSpan = spans.find((s) => s.name === 'fail-op');

    expect(okSpan).toMatchObject({ status: 'ok', attributes: { x: 1 } });
    expect(okSpan.endTime).not.toBe(null);

    expect(failSpan.status).toBe('error');
    expect(failSpan.events.some((e) => e.name === 'exception')).toBe(true);

    restoreConsole();
  });

  it('TraceContext builds span tree, reports stats, and trims old ended spans', () => {
    const restoreConsole = silenceConsole();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const ctx = new TraceContext({ traceId: 'e'.repeat(32), maxSpans: 5 });

    const root = ctx.startSpan('root');
    vi.setSystemTime(new Date('2020-01-01T00:00:00.100Z'));
    const child = ctx.startSpan('child');
    expect(child.parentSpanId).toBe(root.spanId);

    ctx.endSpan();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.200Z'));
    ctx.endSpan();

    const tree = ctx.getSpanTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('root');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe('child');

    const stats = ctx.stats;
    expect(stats).toMatchObject({
      traceId: 'e'.repeat(32),
      totalSpans: 2,
      activeSpans: 0,
      completedSpans: 2,
      errorSpans: 0,
    });
    expect(stats.avgDuration).toBeGreaterThanOrEqual(0);

    // Trigger trimming: create > maxSpans ended spans
    const endedSpanIds = [];
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(`2020-01-01T00:00:01.0${i}0Z`));
      const s = ctx.startSpan(`s${i}`);
      ctx.endSpan(s);
      endedSpanIds.push(s.spanId);
    }
    const sizeBefore = ctx.getSpans().length;
    expect(sizeBefore).toBeGreaterThan(2);

    vi.setSystemTime(new Date('2020-01-01T00:00:02.000Z'));
    ctx.startSpan('overflow');
    const sizeAfter = ctx.getSpans().length;
    expect(sizeAfter).toBeLessThanOrEqual(5);

    restoreConsole();
  });

  it('getTraceparent uses current span or generates a valid header when idle', () => {
    const restoreConsole = silenceConsole();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const ctx = new TraceContext({ traceId: 'f'.repeat(32) });
    const span = ctx.startSpan('active');
    expect(ctx.getTraceparent()).toBe(span.traceparent);
    ctx.endSpan(span);

    const header = ctx.getTraceparent();
    const parsed = TraceContext.parseTraceparent(header);
    expect(parsed).toMatchObject({ version: '00', traceId: 'f'.repeat(32), sampled: true });

    restoreConsole();
  });

  it('parseTraceparent validates version, length, and sampled flag', () => {
    const ok = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
    const okNotSampled = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-00`;
    expect(parseTraceparent(ok)).toEqual({
      version: '00',
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      sampled: true,
    });
    expect(parseTraceparent(okNotSampled)?.sampled).toBe(false);

    expect(parseTraceparent(/** @type {any} */ (null))).toBe(null);
    expect(parseTraceparent('00-too-few-parts')).toBe(null);
    expect(parseTraceparent(`01-${'1'.repeat(32)}-${'2'.repeat(16)}-01`)).toBe(null);
    expect(parseTraceparent(`00-${'1'.repeat(31)}-${'2'.repeat(16)}-01`)).toBe(null);
    expect(parseTraceparent(`00-${'1'.repeat(32)}-${'2'.repeat(15)}-01`)).toBe(null);
  });

  it('withSpan helper is a safe no-op when traceContext is missing', async () => {
    const restoreConsole = silenceConsole();

    const noop = await withSpanHelper(null, 'x', (span) => {
      expect(span).toBe(null);
      return 'ok';
    });
    expect(noop).toBe('ok');

    const traceContext = {
      withSpan: vi.fn(async (_name, fn) => await fn({ spanId: 's' })),
    };
    const value = await withSpanHelper(traceContext, 'wrapped', (span) => span?.spanId);
    expect(traceContext.withSpan).toHaveBeenCalledTimes(1);
    expect(value).toBe('s');

    restoreConsole();
  });

  it('generateTraceId/generateSpanId fall back to Math.random when crypto is missing', () => {
    const restoreConsole = silenceConsole();

    const restoreCrypto = overrideGlobalProperty('crypto', undefined);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(generateTraceId()).toBe('00'.repeat(16));
    expect(generateSpanId()).toBe('00'.repeat(8));

    randomSpy.mockRestore();
    restoreCrypto();
    restoreConsole();
  });
});

describe('runtime/telemetry LoopRuntimeState', () => {
  it('normalizes constructor inputs and serializes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const cursorObj = { step: 1 };
    const cursorArr = ['a', 'b'];
    const state = new LoopRuntimeState({
      status: 'running',
      cursor: cursorObj,
      pausedReason: '  ',
      lastCheckpointId: ' ckpt_1 ',
      statusHistory: [{ from: 1, to: 'running', timestamp: 0 }, { from: 'running', to: 'paused', timestamp: '  ' }],
    });

    expect(state.status).toBe(LoopRuntimeStatuses.RUNNING);
    expect(state.cursor).toEqual({ step: 1 });
    expect(state.cursor).not.toBe(cursorObj);
    expect(state.pausedReason).toBe(null);
    expect(state.lastCheckpointId).toBe('ckpt_1');
    expect(state.statusHistory[0]).toEqual({ from: '1', to: 'running', timestamp: '1970-01-01T00:00:00.000Z' });
    expect(state.statusHistory[1].from).toBe('running');
    expect(state.statusHistory[1].to).toBe('paused');
    expect(typeof state.statusHistory[1].timestamp).toBe('string');

    const json = state.toJSON();
    expect(json).toMatchObject({
      status: 'running',
      cursor: { step: 1 },
      pausedReason: null,
      lastCheckpointId: 'ckpt_1',
    });

    const restored = LoopRuntimeState.fromJSON(json);
    expect(restored).toBeInstanceOf(LoopRuntimeState);
    expect(restored.toJSON()).toEqual(json);

    const stateWithArrCursor = new LoopRuntimeState({ cursor: cursorArr });
    expect(stateWithArrCursor.cursor).toEqual(['a', 'b']);
    expect(stateWithArrCursor.cursor).not.toBe(cursorArr);

    const stateWithStringCursor = new LoopRuntimeState({ cursor: '  ckpt_2  ' });
    expect(stateWithStringCursor.cursor).toBe('ckpt_2');

    const stateWithBadCursor = new LoopRuntimeState({ cursor: 123 });
    expect(stateWithBadCursor.cursor).toBe(null);
  });

  it('validates transitions and rejects invalid moves', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));

    const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });
    expect(state.canTransition(LoopRuntimeStatuses.RUNNING)).toBe(true);
    expect(state.canTransition(LoopRuntimeStatuses.PAUSED)).toBe(false);

    state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: '2020-01-01T00:00:00.000Z' });
    expect(state.status).toBe(LoopRuntimeStatuses.RUNNING);

    state.transitionTo(LoopRuntimeStatuses.PAUSED, { timestamp: 0 });
    expect(state.status).toBe(LoopRuntimeStatuses.PAUSED);
    expect(state.statusHistory).toHaveLength(2);

    expect(() => state.transitionTo(LoopRuntimeStatuses.COMPLETED)).toThrow(/Invalid runtime transition/);
  });

  it('stores per-signal runtime state via set/get/ensure/clear', () => {
    const a = new AbortController();
    const b = new AbortController();

    expect(getRuntimeState(a.signal)).toBe(null);
    expect(getRuntimeState(/** @type {any} */ (null))).toBe(null);

    const stateA = setRuntimeState(a.signal, { status: LoopRuntimeStatuses.RUNNING, lastCheckpointId: 'ckpt_a' });
    expect(stateA).toBeInstanceOf(LoopRuntimeState);
    expect(getRuntimeState(a.signal)?.lastCheckpointId).toBe('ckpt_a');
    expect(getRuntimeState(b.signal)).toBe(null);

    const ensured = ensureRuntimeState(a.signal, { status: LoopRuntimeStatuses.PAUSED });
    expect(ensured).toBe(stateA);

    const stateB = ensureRuntimeState(b.signal, { status: LoopRuntimeStatuses.PAUSED, pausedReason: 'user' });
    expect(getRuntimeState(b.signal)).toBe(stateB);
    expect(stateB.status).toBe(LoopRuntimeStatuses.PAUSED);

    clearRuntimeState(a.signal);
    clearRuntimeState(b.signal);
    expect(getRuntimeState(a.signal)).toBe(null);
    expect(getRuntimeState(b.signal)).toBe(null);

    expect(() => setRuntimeState(/** @type {any} */ ('nope'), { status: LoopRuntimeStatuses.RUNNING })).toThrow(
      /signal must be an object/i
    );
  });
});

describe('runtime/telemetry RunReplayController', () => {
  it('validates constructor inputs', () => {
    expect(() => new RunReplayController()).toThrow(/runStore\.getEvents/);
    expect(
      () =>
        new RunReplayController({
          runStore: { getEvents: () => [] },
          eventBus: {},
        })
    ).toThrow(/eventBus must implement/);
  });

  it('loads events, emits replay records, and supports play/pause/seek/stop', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('1970-01-01T00:00:00.000Z'));

    const emitted = [];
    const controller = new RunReplayController({
      runStore: { getEvents: vi.fn(() => []) },
      eventBus: {
        emit: vi.fn((name, record) => emitted.push({ name, record })),
      },
      speed: 2,
      maxDelayMs: 1000,
    });

    await controller.load('run_1', {
      events: [
        { name: 'evt.b', ts: 2, seq: 2 },
        { name: 'evt.a', ts: 1, seq: 1 },
        { name: 'evt.c', ts: 3 },
        { name: 123, ts: 100 },
        'not-an-object',
      ],
    });

    expect(controller.state).toMatchObject({ runId: 'run_1', status: 'idle', total: 5, cursor: 0 });

    controller.step();
    controller.step();
    controller.step();

    expect(emitted.map((e) => e.name)).toEqual(['evt.a', 'evt.b', 'evt.c']);
    expect(emitted[0].record.meta?.replay).toBe(true);

    controller.seek({ index: -10 });
    expect(controller.state.cursor).toBe(0);
    controller.seek({ offsetMs: 9999 });
    expect(controller.state.cursor).toBe(5);

    controller.stop();
    expect(controller.state).toMatchObject({ status: 'idle', cursor: 0, elapsedMs: 0 });

    controller.seek({ index: 0 });
    controller.play();
    controller.pause();
    const pausedState = controller.state;
    expect(pausedState.status).toBe('paused');
  });

  it('dispatches via eventBus._dispatch when available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('1970-01-01T00:00:00.000Z'));

    const dispatched = [];
    const controller = new RunReplayController({
      runStore: { getEvents: vi.fn(() => []) },
      eventBus: {
        _dispatch: vi.fn((record) => dispatched.push(record)),
      },
      speed: 1,
      maxDelayMs: 0,
    });

    await controller.load('run_1', { events: [{ name: 'evt.a', ts: 0 }, { name: 'evt.b', ts: 1 }] });
    controller.play();
    vi.runAllTimers();

    expect(controller.state.status).toBe('completed');
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0].meta?.replay).toBe(true);
  });
});
