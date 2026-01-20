import { describe, it, expect, vi, beforeEach } from 'vitest';

let GCounter;
let PNCounter;
let nextTick;
let tickSeq = 0;

vi.mock('../../../../../js/agents/core/lamport-clock.js', () => ({
  nextTick: vi.fn(),
}));

beforeEach(async () => {
  vi.resetModules();
  tickSeq = 0;

  const lamport = await import('../../../../../js/agents/core/lamport-clock.js');
  nextTick = lamport.nextTick;
  nextTick.mockReset();
  nextTick.mockImplementation(() => {
    tickSeq += 1;
    return {
      seq: tickSeq,
      ts: tickSeq * 100,
      id: `node${tickSeq}_${tickSeq}`,
    };
  });

  const counters = await import('../../../../../js/agents/core/crdt/counters.js');
  GCounter = counters.GCounter;
  PNCounter = counters.PNCounter;
});

describe('GCounter', () => {
  it('initializes with provided nodeId and zero value', () => {
    const counter = new GCounter({ nodeId: 'A' });

    expect(counter.value).toBe(0);
    expect(nextTick).not.toHaveBeenCalled();
    expect(counter.toJSON()).toEqual({
      type: 'GCounter',
      nodeId: 'A',
      counts: { A: 0 },
    });
  });

  it('defaults nodeId from clock when nodeId is missing or empty', () => {
    nextTick
      .mockImplementationOnce(() => ({ seq: 1, ts: 10, id: 'auto_1' }))
      .mockImplementationOnce(() => ({ seq: 2, ts: 20, id: 'empty_2' }));

    const counterA = new GCounter();
    const counterB = new GCounter({ nodeId: '' });

    expect(counterA.toJSON().nodeId).toBe('auto');
    expect(counterB.toJSON().nodeId).toBe('empty');
    expect(counterA.toJSON().counts).toEqual({ auto: 0 });
    expect(counterB.toJSON().counts).toEqual({ empty: 0 });
    expect(nextTick).toHaveBeenCalledTimes(2);
  });

  it('increment updates value and returns op with clock; delta 0 preserves count', () => {
    nextTick.mockImplementationOnce(() => ({ seq: 7, ts: 70, id: 'clock_7' }));

    const counter = new GCounter({ nodeId: 'A' });

    const op = counter.increment();
    expect(op).toEqual({
      type: 'increment',
      nodeId: 'A',
      value: 1,
      clock: { seq: 7, ts: 70, id: 'clock_7' },
    });
    expect(counter.value).toBe(1);

    const zeroOp = counter.increment(0);
    expect(zeroOp.type).toBe('increment');
    expect(zeroOp.value).toBe(1);
    expect(counter.value).toBe(1);
  });

  it('handles MAX_SAFE_INTEGER increments', () => {
    const counter = new GCounter({ nodeId: 'A' });

    const op = counter.increment(Number.MAX_SAFE_INTEGER);

    expect(op.value).toBe(Number.MAX_SAFE_INTEGER);
    expect(counter.value).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws on negative delta', () => {
    const counter = new GCounter({ nodeId: 'A' });

    expect(() => counter.increment(-1)).toThrow('GCounter can only increment');
  });

  it('apply ignores non-increment ops and empty inputs', () => {
    const counter = new GCounter({ nodeId: 'A' });

    expect(counter.apply({})).toBe(false);
    expect(counter.apply([])).toBe(false);
    expect(counter.apply({ type: 'noop' })).toBe(false);
    expect(counter.value).toBe(0);
  });

  it('apply updates state for higher values and ignores stale values', () => {
    const counter = new GCounter({ nodeId: 'A' });

    counter.increment(2);

    const stale = { type: 'increment', nodeId: 'A', value: 1, clock: { seq: 0, ts: 0, id: 'A_0' } };
    const fresh = { type: 'increment', nodeId: 'A', value: 5, clock: { seq: 0, ts: 0, id: 'A_1' } };
    const remote = { type: 'increment', nodeId: 'B', value: 3, clock: { seq: 0, ts: 0, id: 'B_1' } };

    expect(counter.apply(stale)).toBe(false);
    expect(counter.apply(fresh)).toBe(true);
    expect(counter.apply(remote)).toBe(true);
    expect(counter.value).toBe(8);
  });

  it('merge integrates higher counts and ignores non-GCounter input', () => {
    const counterA = new GCounter({ nodeId: 'A' });
    counterA.increment(1);

    const counterB = new GCounter({ nodeId: 'B' });
    counterB.increment(5);
    counterB.apply({ type: 'increment', nodeId: 'A', value: 4, clock: { seq: 0, ts: 0, id: 'A_1' } });

    expect(counterA.merge(counterB)).toBe(true);
    expect(counterA.value).toBe(9);
    expect(counterA.merge({})).toBe(false);
  });

  it('toJSON/fromJSON roundtrip converts string counts and preserves whitespace nodeId', () => {
    const json = {
      type: 'GCounter',
      nodeId: '   ',
      counts: { '   ': '2', other: '3' },
    };

    const counter = GCounter.fromJSON(json);

    expect(counter.value).toBe(5);
    expect(counter.toJSON()).toEqual({
      type: 'GCounter',
      nodeId: '   ',
      counts: { '   ': 2, other: 3 },
    });
  });

  it('fromJSON rejects invalid payloads', () => {
    const invalids = [null, undefined, {}, [], { type: 'PNCounter' }];

    for (const value of invalids) {
      expect(() => GCounter.fromJSON(value)).toThrow('Invalid GCounter JSON');
    }
  });

  it('handles concurrent increments', async () => {
    const counter = new GCounter({ nodeId: 'A' });

    const tasks = Array.from({ length: 25 }, () => Promise.resolve().then(() => counter.increment(1)));
    await Promise.all(tasks);

    expect(counter.value).toBe(25);
  });

  it('accepts array-like counts objects (object-as-array boundary)', () => {
    const json = {
      type: 'GCounter',
      nodeId: 'arr',
      counts: { 0: 2, 1: 3, length: 2 },
    };

    const counter = GCounter.fromJSON(json);

    expect(counter.value).toBe(7);
    expect(counter.toJSON().counts).toEqual({ 0: 2, 1: 3, length: 2 });
  });

  it('handles large payload counts (large file boundary)', () => {
    const size = 5000;
    const counts = {};
    for (let i = 0; i < size; i += 1) {
      counts[`node-${i}`] = 1;
    }

    const counter = GCounter.fromJSON({ type: 'GCounter', nodeId: 'bulk', counts });

    expect(counter.value).toBe(size);
  });

  it('handles very long nodeId strings (long string boundary)', () => {
    const longId = 'x'.repeat(10000);
    const counter = new GCounter({ nodeId: longId });

    counter.increment(1);

    const json = counter.toJSON();
    expect(json.nodeId.length).toBe(longId.length);
    expect(json.counts[longId]).toBe(1);
  });

  it('handles deeply nested count values (deep nesting boundary)', () => {
    const deep = { a: { b: { c: { d: { e: [] } } } } };
    const counter = GCounter.fromJSON({
      type: 'GCounter',
      nodeId: 'deep',
      counts: { deep },
    });

    expect(Number.isNaN(counter.value)).toBe(true);
  });
});

describe('PNCounter', () => {
  it('initializes with provided nodeId and zero value', () => {
    const counter = new PNCounter({ nodeId: 'A' });

    expect(counter.value).toBe(0);

    const json = counter.toJSON();
    expect(json.nodeId).toBe('A');
    expect(json.positive.counts).toEqual({ A: 0 });
    expect(json.negative.counts).toEqual({ A: 0 });
  });

  it('increment and decrement update value and return ops', () => {
    const counter = new PNCounter({ nodeId: 'A' });

    const inc = counter.increment(2);
    const dec = counter.decrement(1);

    expect(inc.type).toBe('pn-increment');
    expect(inc.op.type).toBe('increment');
    expect(inc.op.nodeId).toBe('A');
    expect(dec.type).toBe('pn-decrement');
    expect(counter.value).toBe(1);
  });

  it('negative deltas flip between increment/decrement', () => {
    const counter = new PNCounter({ nodeId: 'A' });

    const op1 = counter.increment(-1);
    expect(op1.type).toBe('pn-decrement');
    expect(counter.value).toBe(-1);

    const op2 = counter.decrement(-2);
    expect(op2.type).toBe('pn-increment');
    expect(counter.value).toBe(1);
  });

  it('apply handles increment/decrement ops and ignores unknown types', () => {
    const counter = new PNCounter({ nodeId: 'A' });

    const incOp = {
      type: 'pn-increment',
      op: { type: 'increment', nodeId: 'B', value: 3, clock: { seq: 0, ts: 0, id: 'B_1' } },
    };
    const decOp = {
      type: 'pn-decrement',
      op: { type: 'increment', nodeId: 'B', value: 1, clock: { seq: 0, ts: 0, id: 'B_2' } },
    };

    expect(counter.apply(incOp)).toBe(true);
    expect(counter.value).toBe(3);
    expect(counter.apply(decOp)).toBe(true);
    expect(counter.value).toBe(2);
    expect(counter.apply({ type: 'noop' })).toBe(false);
  });

  it('merge combines state and ignores non-PNCounter input', () => {
    const counterA = new PNCounter({ nodeId: 'A' });
    counterA.increment(1);

    const counterB = new PNCounter({ nodeId: 'B' });
    counterB.increment(3);
    counterB.decrement(1);

    expect(counterA.merge(counterB)).toBe(true);
    expect(counterA.value).toBe(3);
    expect(counterA.merge({})).toBe(false);
  });

  it('fromJSON rejects invalid payloads', () => {
    const invalids = [null, undefined, {}, [], { type: 'GCounter' }];

    for (const value of invalids) {
      expect(() => PNCounter.fromJSON(value)).toThrow('Invalid PNCounter JSON');
    }
  });

  it('handles rapid sequential updates without shared state', () => {
    const counter = new PNCounter({ nodeId: 'A' });

    for (let i = 0; i < 50; i += 1) {
      counter.increment(1);
    }
    for (let i = 0; i < 30; i += 1) {
      counter.decrement(1);
    }

    expect(counter.value).toBe(20);
  });
});
