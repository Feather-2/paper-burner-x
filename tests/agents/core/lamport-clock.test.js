import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LamportClock,
  compare,
  currentSeq,
  nextTick,
  resetClock,
  sortByLogicalOrder,
  stampEvent,
  sync,
} from '../../../js/agents/core/lamport-clock.js';

function getIdPrefix(id) {
  const [prefix] = String(id).split('_');
  return prefix;
}

beforeEach(() => {
  resetClock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetClock();
});

describe('core/lamport-clock', () => {
  it('nextTick generates monotonically increasing seq and stable instance prefix', () => {
    const t1 = nextTick();
    const t2 = nextTick();

    expect(t1.seq).toBe(1);
    expect(t2.seq).toBe(2);
    expect(currentSeq()).toBe(2);

    expect(typeof t1.ts).toBe('number');
    expect(typeof t2.ts).toBe('number');

    expect(t1.id).toMatch(/^[0-9a-f]{8}_1$/i);
    expect(t2.id).toMatch(/^[0-9a-f]{8}_2$/i);
    expect(getIdPrefix(t2.id)).toBe(getIdPrefix(t1.id));
  });

  it('sync updates local clock only for finite numbers greater than current', () => {
    nextTick(); // seq=1

    sync('10');
    sync(NaN);
    sync(Infinity);
    sync(-1);
    expect(currentSeq()).toBe(1);

    sync(10);
    expect(currentSeq()).toBe(10);

    sync(9);
    expect(currentSeq()).toBe(10);
  });

  it('resetClock resets sequence back to 0', () => {
    nextTick();
    nextTick();
    expect(currentSeq()).toBe(2);

    resetClock();
    expect(currentSeq()).toBe(0);
  });

  it('compare orders by seq with nullish/default handling', () => {
    expect(compare({ seq: 1 }, { seq: 2 })).toBe(-1);
    expect(compare({ seq: 2 }, { seq: 1 })).toBe(1);
    expect(compare({ seq: 2 }, { seq: 2 })).toBe(0);

    expect(compare(null, undefined)).toBe(0);
    expect(compare({}, { seq: 1 })).toBe(-1);
    expect(compare({ seq: 1 }, {})).toBe(1);
  });

  it('stampEvent attaches a new _clock for both nullish and object inputs', () => {
    const stampedNull = stampEvent(null);
    expect(stampedNull).toHaveProperty('_clock');
    expect(stampedNull._clock.seq).toBe(1);

    const evt = { type: 'x', payload: { ok: true } };
    const stampedObj = stampEvent(evt);

    expect(stampedObj).not.toBe(evt);
    expect(stampedObj).toMatchObject({ type: 'x', payload: { ok: true } });
    expect(stampedObj._clock.seq).toBe(2);
  });

  it('sortByLogicalOrder sorts by logical seq then ts fallback', () => {
    const events = [
      { seq: 3, ts: 5, label: 'seq-only' },
      { _clock: { seq: 2, ts: 20, id: 'x_2' }, label: 'b' },
      { _clock: { seq: 1, ts: 10, id: 'x_1' }, label: 'a' },
    ];

    const sorted = sortByLogicalOrder(events);
    expect(sorted.map((e) => e.label)).toEqual(['a', 'b', 'seq-only']);

    const tieSeq = sortByLogicalOrder([
      { _clock: { seq: 1, ts: 100, id: 't_1' }, label: 'late' },
      { _clock: { seq: 1, ts: 50, id: 't_1b' }, label: 'early' },
    ]);
    expect(tieSeq.map((e) => e.label)).toEqual(['early', 'late']);

    // Exercise fallback paths: seq from `seq` field and default 0; ts from `ts` field and default 0.
    const fallback = sortByLogicalOrder([
      null, // seq=0, ts=0
      { ts: 2, label: 'ts-only' }, // seq=0 (fallback), ts=2 (from `ts`)
      { seq: 1, label: 'seq-only-no-ts' }, // seq=1, ts=0
      { _clock: { seq: null, ts: null, id: 'n/a' }, seq: 2, ts: 5, label: 'nullish-clock-fields' },
      { seq: 1, ts: 100, label: 'seq+ts' },
    ]);
    expect(fallback.map((e) => e?.label)).toEqual([
      undefined,
      'ts-only',
      'seq-only-no-ts',
      'seq+ts',
      'nullish-clock-fields',
    ]);
  });

  it('sortByLogicalOrder returns [] for non-array input', () => {
    expect(sortByLogicalOrder(null)).toEqual([]);
    expect(sortByLogicalOrder(undefined)).toEqual([]);
    expect(sortByLogicalOrder({})).toEqual([]);
  });

  it('LamportClock tick/get/update behave deterministically with provided nodeId', () => {
    const clock = new LamportClock('NODE');

    const t1 = clock.tick();
    expect(t1).toMatchObject({ seq: 1, id: 'NODE_1' });

    const t2 = clock.tick();
    expect(t2).toMatchObject({ seq: 2, id: 'NODE_2' });

    const g1 = clock.get();
    expect(g1).toMatchObject({ seq: 2, id: 'NODE_2' });

    const u1 = clock.update({ seq: 10, ts: 0, id: 'REMOTE_10' });
    expect(u1).toMatchObject({ seq: 11, id: 'NODE_11' });

    const u2 = clock.update({ seq: 1, ts: 0, id: 'REMOTE_1' }); // should not rewind
    expect(u2).toMatchObject({ seq: 12, id: 'NODE_12' });

    const u3 = clock.update({ seq: '13', ts: 0, id: 'BAD' }); // invalid remote
    expect(u3).toMatchObject({ seq: 13, id: 'NODE_13' });
  });

  it('LamportClock generates a nodeId when not provided', () => {
    const clock = new LamportClock();
    const t1 = clock.tick();
    expect(t1.id).toMatch(/^[0-9a-f]{8}_1$/i);
  });

  it('LamportClockState is JSON-serializable and can be compared after roundtrip', () => {
    const a = nextTick();
    const json = JSON.stringify(a);
    const b = JSON.parse(json);

    expect(b).toMatchObject({ seq: a.seq, id: a.id });
    expect(compare(a, b)).toBe(0);

    const clock = new LamportClock('SER');
    const t = clock.tick();
    const restored = JSON.parse(JSON.stringify(t));
    expect(compare(t, restored)).toBe(0);
  });

  it('falls back to Date.now when performance is unavailable', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    vi.stubGlobal('performance', undefined);

    const tick = nextTick();
    expect(tick.ts).toBe(12345);

    const clock = new LamportClock('P');
    expect(clock.tick().ts).toBe(12345);
    expect(clock.get().ts).toBe(12345);

    nowSpy.mockRestore();
  });
});
