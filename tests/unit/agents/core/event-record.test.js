import { describe, it, expect, vi, beforeEach } from 'vitest';

const lamportMocks = vi.hoisted(() => ({
  seq: 0,
  nextTick: vi.fn(),
  sync: vi.fn(),
  currentSeq: vi.fn(),
}));

const eventBusUtilsMocks = vi.hoisted(() => ({
  assertValidEventName: vi.fn(),
  createEventId: vi.fn(),
}));

vi.mock('../../../../js/agents/core/lamport-clock.js', () => ({
  nextTick: lamportMocks.nextTick,
  sync: lamportMocks.sync,
  currentSeq: lamportMocks.currentSeq,
}));

vi.mock('../../../../js/agents/core/event-bus-utils.js', () => ({
  assertValidEventName: eventBusUtilsMocks.assertValidEventName,
  createEventId: eventBusUtilsMocks.createEventId,
}));

import {
  createEventRecord,
  createEventBusClock,
} from '../../../../js/agents/core/event-record.js';
import {
  nextTick,
  sync,
  currentSeq,
} from '../../../../js/agents/core/lamport-clock.js';
import {
  assertValidEventName,
  createEventId,
} from '../../../../js/agents/core/event-bus-utils.js';

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.child = { level: i };
    cursor = cursor.child;
  }
  cursor.leaf = 'end';
  return root;
};

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();

  lamportMocks.seq = 0;
  lamportMocks.nextTick.mockReset();
  lamportMocks.sync.mockReset();
  lamportMocks.currentSeq.mockReset();
  eventBusUtilsMocks.assertValidEventName.mockReset();
  eventBusUtilsMocks.createEventId.mockReset();

  lamportMocks.nextTick.mockImplementation(() => {
    lamportMocks.seq += 1;
    return {
      seq: lamportMocks.seq,
      ts: lamportMocks.seq,
      id: `node_${lamportMocks.seq}`,
    };
  });

  lamportMocks.sync.mockImplementation((remoteSeq) => {
    if (
      typeof remoteSeq === 'number'
      && Number.isFinite(remoteSeq)
      && remoteSeq > lamportMocks.seq
    ) {
      lamportMocks.seq = remoteSeq;
    }
  });

  lamportMocks.currentSeq.mockImplementation(() => lamportMocks.seq);

  eventBusUtilsMocks.assertValidEventName.mockImplementation((name) => {
    const isValid = name === '*'
      || (typeof name === 'string' && /^[a-z0-9_]+([.:][a-z0-9_]+)*$/.test(name));
    if (!isValid) {
      throw new TypeError(`Invalid event name: ${String(name)}`);
    }
  });

  eventBusUtilsMocks.createEventId.mockImplementation((runId, seq) => {
    const base = runId && typeof runId === 'string' ? runId : 'run';
    return `evt_${base}_${seq}`;
  });
});

describe('createEventRecord', () => {
  it('creates defaults with generated clock, timestamps, and ids', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const record = createEventRecord();

    expect(assertValidEventName).toHaveBeenCalledWith('unknown');
    expect(nextTick).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
    expect(createEventId).toHaveBeenCalledWith(undefined, 1);

    expect(record.schemaVersion).toBe('0.1');
    expect(record.name).toBe('unknown');
    expect(record.type).toBe('unknown');
    expect(record.actor).toBe('system');
    expect(record.ts).toBe('2024-01-01T00:00:00.000Z');
    expect(record.timestamp).toBe(Date.parse(record.ts));
    expect(record.eventId).toBe('evt_run_1');
    expect(record.id).toBe('evt_run_1');
    expect(record._clock).toBe(record.clock);
    expect(record.seq).toBe(1);
  });

  it('uses provided clock, syncs, and generates eventId when missing', () => {
    const clock = { seq: 7, ts: 10, id: 'remote_7' };
    const record = createEventRecord({
      name: 'order.created',
      runId: 'run-7',
      _clock: clock,
    });

    expect(sync).toHaveBeenCalledWith(7);
    expect(nextTick).not.toHaveBeenCalled();
    expect(createEventId).toHaveBeenCalledWith('run-7', 7);
    expect(record._clock).toBe(clock);
    expect(record.clock).toBe(clock);
    expect(record.seq).toBe(7);
    expect(record.eventId).toBe('evt_run-7_7');
    expect(record.id).toBe('evt_run-7_7');
    expect(record.runId).toBe('run-7');
  });

  it('prefers explicit eventId over id and avoids createEventId', () => {
    const clock = { seq: 3, ts: 0, id: 'node_3' };
    const record = createEventRecord({
      name: 'event.id',
      eventId: 'evt_explicit',
      id: 'evt_legacy',
      _clock: clock,
      ts: '2024-02-02T00:00:00.000Z',
    });

    expect(createEventId).not.toHaveBeenCalled();
    expect(record.eventId).toBe('evt_explicit');
    expect(record.id).toBe('evt_explicit');
  });

  it('falls back to legacy type when name empty and accepts timestamp boundary', () => {
    const legacyClock = { seq: 0, ts: 0, id: 'legacy_0' };
    const record = createEventRecord({
      name: '',
      type: 'legacy.event',
      timestamp: -1,
      clock: legacyClock,
    });

    expect(record.name).toBe('legacy.event');
    expect(record.type).toBe('legacy.event');
    expect(record.timestamp).toBe(-1);
    expect(record.ts).toBe(new Date(-1).toISOString());
    expect(sync).toHaveBeenCalledWith(0);
    expect(record._clock).toBe(legacyClock);
    expect(record.seq).toBe(0);
  });

  it('handles empty values, whitespace, and empty structures without coercion', () => {
    const emptyArray = [];
    const emptyObject = {};

    const record = createEventRecord({
      name: '',
      type: 'edge.empty',
      runId: '',
      eventId: '',
      id: '',
      status: '   ',
      payload: emptyArray,
      meta: emptyObject,
      actor: null,
      level: '',
      durationMs: 0,
    });

    expect(record.name).toBe('edge.empty');
    expect(record.runId).toBe('');
    expect(record.status).toBe('   ');
    expect(record.payload).toBe(emptyArray);
    expect(record.meta).toBe(emptyObject);
    expect(record.actor).toBeNull();
    expect(record.level).toBeUndefined();
    expect(record.durationMs).toBe(0);
    expect(record.eventId).toBe('evt_run_1');
    expect(createEventId).toHaveBeenCalled();
  });

  it('preserves null payload and omits meta when undefined', () => {
    const record = createEventRecord({
      name: 'nulls',
      payload: null,
      meta: undefined,
    });

    expect(record.payload).toBeNull();
    expect('meta' in record).toBe(false);
  });

  it('uses ts when timestamp is numeric string and ignores durationMs string', () => {
    const ts = '2024-02-02T02:02:02.000Z';
    const record = createEventRecord({
      name: 'type.boundary',
      ts,
      timestamp: '123',
      durationMs: '456',
    });

    expect(record.ts).toBe(ts);
    expect(record.timestamp).toBe(Date.parse(ts));
    expect('durationMs' in record).toBe(false);
  });

  it('throws on invalid event names', () => {
    expect(() => createEventRecord({ name: 'bad name' })).toThrow(TypeError);
    expect(assertValidEventName).toHaveBeenCalled();
  });

  it('generates a new clock when clock input is invalid or array-like', () => {
    const recordArray = createEventRecord({ name: 'clock.array', _clock: [] });
    const recordStringSeq = createEventRecord({
      name: 'clock.string',
      _clock: { seq: '2', ts: 0, id: 'x' },
    });

    expect(nextTick).toHaveBeenCalledTimes(2);
    expect(sync).not.toHaveBeenCalled();
    expect(recordArray.seq).toBe(1);
    expect(recordStringSeq.seq).toBe(2);
  });

  it('handles rapid consecutive and concurrent calls', async () => {
    const first = createEventRecord({ name: 'concurrent.one' });
    const second = createEventRecord({ name: 'concurrent.two' });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);

    const [a, b] = await Promise.all([
      Promise.resolve(createEventRecord({ name: 'parallel.a' })),
      Promise.resolve(createEventRecord({ name: 'parallel.b' })),
    ]);

    expect(a.seq).not.toBe(b.seq);
    expect(new Set([a.seq, b.seq]).size).toBe(2);
  });

  it('stores large payloads and deep nested meta structures', () => {
    const longText = 'x'.repeat(100000);
    const deepMeta = buildDeepObject(50);
    deepMeta.file = new Uint8Array(1024 * 256);

    const record = createEventRecord({
      name: 'resource.boundary',
      payload: longText,
      meta: deepMeta,
      durationMs: Number.MAX_SAFE_INTEGER,
    });

    expect(record.payload).toBe(longText);
    expect(record.meta).toBe(deepMeta);
    expect(record.meta.file).toHaveLength(1024 * 256);
    expect(record.durationMs).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('createEventBusClock', () => {
  it('uses currentSeq and performance.now for timestamp', () => {
    lamportMocks.seq = 42;
    const perfNow = vi.fn(() => 123.45);
    vi.stubGlobal('performance', { now: perfNow });

    const clock = createEventBusClock(7);

    expect(currentSeq).toHaveBeenCalledTimes(1);
    expect(clock).toEqual({ seq: 42, ts: 123.45, id: 'eventbus_7' });
  });

  it('falls back to Date.now when performance is unavailable', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(555);
    vi.stubGlobal('performance', undefined);
    lamportMocks.seq = 10;

    const clock = createEventBusClock(0);

    expect(clock.seq).toBe(10);
    expect(clock.ts).toBe(555);
    expect(clock.id).toBe('eventbus_0');
    nowSpy.mockRestore();
  });

  it('handles boundary seq values and concurrent calls', async () => {
    let seq = 100;
    lamportMocks.currentSeq.mockImplementation(() => {
      seq += 1;
      return seq;
    });

    const [first, second] = await Promise.all([
      Promise.resolve(createEventBusClock(-1)),
      Promise.resolve(createEventBusClock(Number.MAX_SAFE_INTEGER)),
    ]);

    expect(first.id).toBe('eventbus_-1');
    expect(second.id).toBe(`eventbus_${Number.MAX_SAFE_INTEGER}`);
    expect(first.seq).not.toBe(second.seq);
  });
});
