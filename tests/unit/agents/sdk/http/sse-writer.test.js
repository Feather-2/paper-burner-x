import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SseWriter, SSE_HEADERS } from '../../../../../js/agents/sdk/http/sse-writer.js';
import { STREAM_EVENT_TYPES, BUS_TO_SSE_MAP, mapBusEventToStreamEvent } from '../../../../../js/agents/sdk/http/stream-events.js';

describe('SseWriter', () => {
  /** @type {{ chunks: string[], write: Function, end: Function }} */
  let target;

  beforeEach(() => {
    target = {
      chunks: [],
      write: vi.fn((chunk) => target.chunks.push(chunk)),
      end: vi.fn(),
    };
  });

  it('writes SSE events in correct format', () => {
    const writer = new SseWriter(target, { autoHeartbeat: false });
    writer.writeEvent('message_start', { id: '123' });

    expect(target.chunks).toHaveLength(1);
    const parsed = JSON.parse(target.chunks[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('message_start');
    expect(parsed.id).toBe('123');
  });

  it('serializes circular payloads without throwing', () => {
    const writer = new SseWriter(target, { autoHeartbeat: false });
    const payload = { id: '123' };
    payload.self = payload;

    expect(() => writer.writeEvent('message_start', payload)).not.toThrow();

    const parsed = JSON.parse(target.chunks[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('message_start');
    expect(parsed.id).toBe('123');
    expect(parsed.self).toMatchObject({ id: '123', self: '[Circular]' });
  });

  it('writes ping events', () => {
    const writer = new SseWriter(target, { autoHeartbeat: false });
    writer.writePing();

    const parsed = JSON.parse(target.chunks[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('ping');
  });

  it('starts and stops heartbeat', async () => {
    vi.useFakeTimers();
    const writer = new SseWriter(target, { heartbeatMs: 100, autoHeartbeat: true });

    expect(target.chunks).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(target.chunks).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(target.chunks).toHaveLength(2);

    writer.stopHeartbeat();
    vi.advanceTimersByTime(200);
    expect(target.chunks).toHaveLength(2);

    vi.useRealTimers();
  });

  it('does not write after close', () => {
    const writer = new SseWriter(target, { autoHeartbeat: false });
    writer.close();
    writer.writeEvent('test', {});
    writer.writePing();
    expect(target.chunks).toHaveLength(0);
    expect(target.end).toHaveBeenCalledOnce();
  });

  it('writeError writes error event then closes', () => {
    const writer = new SseWriter(target, { autoHeartbeat: false });
    writer.writeError('something broke');

    expect(target.chunks).toHaveLength(1);
    const parsed = JSON.parse(target.chunks[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('error');
    expect(parsed.error).toBe('something broke');
    expect(writer.closed).toBe(true);
  });

  it('double close is safe', () => {
    const writer = new SseWriter(target, { autoHeartbeat: false });
    writer.close();
    writer.close();
    expect(target.end).toHaveBeenCalledOnce();
  });
});

describe('SSE_HEADERS', () => {
  it('has correct content type', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream');
    expect(SSE_HEADERS['Cache-Control']).toBe('no-cache');
    expect(SSE_HEADERS['Connection']).toBe('keep-alive');
  });
});

describe('STREAM_EVENT_TYPES', () => {
  it('contains all required event types', () => {
    expect(STREAM_EVENT_TYPES.MESSAGE_START).toBe('message_start');
    expect(STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA).toBe('content_block_delta');
    expect(STREAM_EVENT_TYPES.MESSAGE_STOP).toBe('message_stop');
    expect(STREAM_EVENT_TYPES.PING).toBe('ping');
    expect(STREAM_EVENT_TYPES.AGENT_START).toBe('agent_start');
    expect(STREAM_EVENT_TYPES.AGENT_STOP).toBe('agent_stop');
    expect(STREAM_EVENT_TYPES.TOOL_EXECUTION_START).toBe('tool_execution_start');
    expect(STREAM_EVENT_TYPES.ERROR).toBe('error');
  });

  it('has all expected keys', () => {
    const keys = Object.keys(STREAM_EVENT_TYPES);
    expect(keys).toContain('MESSAGE_START');
    expect(keys).toContain('CONTENT_BLOCK_START');
    expect(keys).toContain('CONTENT_BLOCK_DELTA');
    expect(keys).toContain('CONTENT_BLOCK_STOP');
    expect(keys).toContain('MESSAGE_DELTA');
    expect(keys).toContain('MESSAGE_STOP');
    expect(keys).toContain('PING');
    expect(keys).toContain('AGENT_START');
    expect(keys).toContain('AGENT_STOP');
    expect(keys).toContain('ITERATION_START');
    expect(keys).toContain('ITERATION_STOP');
    expect(keys).toContain('TOOL_EXECUTION_START');
    expect(keys).toContain('TOOL_EXECUTION_OUTPUT');
    expect(keys).toContain('TOOL_EXECUTION_RESULT');
    expect(keys).toContain('ERROR');
  });
});

describe('BUS_TO_SSE_MAP', () => {
  it('maps bus events to SSE types', () => {
    expect(BUS_TO_SSE_MAP['agent:start']).toBe(STREAM_EVENT_TYPES.AGENT_START);
    expect(BUS_TO_SSE_MAP['agent:stop']).toBe(STREAM_EVENT_TYPES.AGENT_STOP);
    expect(BUS_TO_SSE_MAP['agent:end']).toBe(STREAM_EVENT_TYPES.AGENT_STOP);
    expect(BUS_TO_SSE_MAP['llm:start']).toBe(STREAM_EVENT_TYPES.MESSAGE_START);
    expect(BUS_TO_SSE_MAP['llm:token']).toBe(STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA);
    expect(BUS_TO_SSE_MAP['llm:complete']).toBe(STREAM_EVENT_TYPES.MESSAGE_STOP);
    expect(BUS_TO_SSE_MAP['tool:start']).toBe(STREAM_EVENT_TYPES.TOOL_EXECUTION_START);
    expect(BUS_TO_SSE_MAP['tool:output']).toBe(STREAM_EVENT_TYPES.TOOL_EXECUTION_OUTPUT);
    expect(BUS_TO_SSE_MAP['tool:complete']).toBe(STREAM_EVENT_TYPES.TOOL_EXECUTION_RESULT);
    expect(BUS_TO_SSE_MAP['tool:error']).toBe(STREAM_EVENT_TYPES.TOOL_EXECUTION_RESULT);
    expect(BUS_TO_SSE_MAP['agent:error']).toBe(STREAM_EVENT_TYPES.ERROR);
    expect(BUS_TO_SSE_MAP['run:error']).toBe(STREAM_EVENT_TYPES.ERROR);
  });
});

describe('mapBusEventToStreamEvent', () => {
  it('returns correct mapping for known bus events', () => {
    const result = mapBusEventToStreamEvent('llm:token', { content: 'hello' });
    expect(result).not.toBeNull();
    expect(result.type).toBe(STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA);
    expect(result.content).toBe('hello');
  });

  it('spreads object data into result', () => {
    const result = mapBusEventToStreamEvent('agent:start', { session_id: 's1' });
    expect(result.type).toBe(STREAM_EVENT_TYPES.AGENT_START);
    expect(result.session_id).toBe('s1');
  });

  it('wraps non-object data in data field', () => {
    const result = mapBusEventToStreamEvent('llm:token', 'raw-string');
    expect(result.type).toBe(STREAM_EVENT_TYPES.CONTENT_BLOCK_DELTA);
    expect(result.data).toBe('raw-string');
  });

  it('returns null for unmapped events', () => {
    expect(mapBusEventToStreamEvent('unknown:event', {})).toBeNull();
    expect(mapBusEventToStreamEvent('random', 'data')).toBeNull();
  });
});
