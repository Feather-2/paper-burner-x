import { describe, it, expect } from 'vitest';
import {
  TraceContextPropagator,
  createTracePropagator,
  injectTrace,
  extractTrace,
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
} from '../../../../../js/agents/core/contracts/trace-propagator.js';
import {
  TraceContextPropagator as TraceContextPropagatorFromIndex,
  createTracePropagator as createTracePropagatorFromIndex,
  injectTrace as injectTraceFromIndex,
  extractTrace as extractTraceFromIndex,
  generateTraceId as generateTraceIdFromIndex,
  generateSpanId as generateSpanIdFromIndex,
  formatTraceparent as formatTraceparentFromIndex,
  parseTraceparent as parseTraceparentFromIndex,
} from '../../../../../js/agents/core/contracts/index.js';

describe('trace-propagator exports', () => {
  it('is re-exported by contracts/index.js', () => {
    expect(TraceContextPropagatorFromIndex).toBe(TraceContextPropagator);
    expect(createTracePropagatorFromIndex).toBe(createTracePropagator);
    expect(injectTraceFromIndex).toBe(injectTrace);
    expect(extractTraceFromIndex).toBe(extractTrace);
    expect(generateTraceIdFromIndex).toBe(generateTraceId);
    expect(generateSpanIdFromIndex).toBe(generateSpanId);
    expect(formatTraceparentFromIndex).toBe(formatTraceparent);
    expect(parseTraceparentFromIndex).toBe(parseTraceparent);
  });
});

describe('trace id helpers', () => {
  it('generates trace/span ids with expected sizes', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('formats and parses traceparent', () => {
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const traceparent = formatTraceparent(traceId, spanId, true);
    expect(traceparent).toBe(`00-${traceId}-${spanId}-01`);
    expect(parseTraceparent(traceparent)).toEqual({ traceId, spanId, traceparent });
    expect(parseTraceparent('bad')).toBeNull();
  });
});

describe('TraceContextPropagator', () => {
  it('injects and extracts trace from generic carriers', () => {
    const propagator = new TraceContextPropagator();
    const traceContext = {
      traceId: 'a'.repeat(32),
      currentSpan: { spanId: 'b'.repeat(16), parentSpanId: 'c'.repeat(16), traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` },
    };
    const carrier = propagator.inject(traceContext, {});
    expect(carrier.traceId).toBe('a'.repeat(32));
    expect(carrier.spanId).toBe('b'.repeat(16));
    expect(carrier.parentSpanId).toBe('c'.repeat(16));
    expect(carrier.traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    expect(propagator.extract(carrier)).toEqual({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      parentSpanId: 'c'.repeat(16),
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    });
  });

  it('propagates to message metadata and extracts back', () => {
    const propagator = createTracePropagator();
    const traceContext = { traceId: 'd'.repeat(32), spanId: 'e'.repeat(16), traceparent: `00-${'d'.repeat(32)}-${'e'.repeat(16)}-01` };
    const message = propagator.propagateToMessage(traceContext, { kind: 'task-request', agentId: 'a1', taskType: 'search:run', payload: {} });
    expect(message.metadata).toEqual({
      traceId: 'd'.repeat(32),
      spanId: 'e'.repeat(16),
      traceparent: `00-${'d'.repeat(32)}-${'e'.repeat(16)}-01`,
    });
    expect(propagator.extractFromMessage(message)).toEqual({
      traceId: 'd'.repeat(32),
      spanId: 'e'.repeat(16),
      traceparent: `00-${'d'.repeat(32)}-${'e'.repeat(16)}-01`,
    });
  });

  it('wraps event data and extracts from event record-like payload', () => {
    const propagator = new TraceContextPropagator();
    const wrapped = propagator.wrapEventData(
      { traceId: 'f'.repeat(32), spanId: '1'.repeat(16), traceparent: `00-${'f'.repeat(32)}-${'1'.repeat(16)}-01` },
      { payload: { x: 1 } }
    );
    expect(wrapped.trace).toEqual({
      traceId: 'f'.repeat(32),
      spanId: '1'.repeat(16),
      traceparent: `00-${'f'.repeat(32)}-${'1'.repeat(16)}-01`,
    });
    const record = { name: 'agent:step', payload: wrapped };
    expect(propagator.extractFromEvent(record)).toEqual({
      traceId: 'f'.repeat(32),
      spanId: '1'.repeat(16),
      traceparent: `00-${'f'.repeat(32)}-${'1'.repeat(16)}-01`,
    });
  });

  it('creates a child trace context with started span', () => {
    const propagator = new TraceContextPropagator();
    const parentCarrier = { traceparent: `00-${'2'.repeat(32)}-${'3'.repeat(16)}-01` };
    const { traceContext, span } = propagator.createChildContext(parentCarrier, 'agent:run');
    expect(traceContext.traceId).toBe('2'.repeat(32));
    expect(span.parentSpanId).toBe('3'.repeat(16));
    expect(span.traceId).toBe('2'.repeat(32));
    expect(span.name).toBe('agent:run');
    expect(String(span.traceparent)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});
