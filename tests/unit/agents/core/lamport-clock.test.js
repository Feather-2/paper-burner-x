import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../js/agents/shared/utils/secure-id.js', () => ({
  cryptoRandomHex: vi.fn(() => 'deadbeef'),
}));

import {
  LamportClockService,
  compare,
  currentSeq,
  nextTick,
  resetClock,
  sync,
} from '../../../../js/agents/core/lamport-clock.js';
import { cryptoRandomHex } from '../../../../js/agents/shared/utils/secure-id.js';

const cryptoRandomHexMock = vi.mocked(cryptoRandomHex);

beforeEach(() => {
  cryptoRandomHexMock.mockReset();
  cryptoRandomHexMock.mockReturnValue('deadbeef');
  resetClock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetClock();
});

describe('LamportClockService', () => {
  it('nextTick increments seq and keeps a stable instance prefix', () => {
    vi.stubGlobal('performance', { now: vi.fn(() => 1000) });

    const clock = new LamportClockService();
    const first = clock.nextTick();
    const second = clock.nextTick();

    expect(first).toMatchObject({ seq: 1, ts: 1000, id: 'deadbeef_1' });
    expect(second).toMatchObject({ seq: 2, ts: 1000, id: 'deadbeef_2' });
    expect(clock.currentSeq()).toBe(2);
    expect(cryptoRandomHexMock).toHaveBeenCalledTimes(1);
  });

  it('sync updates only for finite numbers greater than current and ignores invalid input', () => {
    const clock = new LamportClockService();
    clock.nextTick();

    const longString = 'x'.repeat(10000);
    const invalids = [
      null,
      undefined,
      '',
      '   ',
      '10',
      [],
      {},
      NaN,
      Infinity,
      -1,
      0,
      longString,
      { length: 1, 0: 'x' },
    ];

    invalids.forEach((value) => {
      expect(() => clock.sync(value)).not.toThrow();
    });

    expect(clock.currentSeq()).toBe(1);

    clock.sync(10);
    expect(clock.currentSeq()).toBe(10);

    clock.sync(9);
    expect(clock.currentSeq()).toBe(10);

    clock.sync(Number.MAX_SAFE_INTEGER);
    expect(clock.currentSeq()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('currentSeq returns the current value without incrementing', () => {
    const clock = new LamportClockService();

    expect(clock.currentSeq()).toBe(0);
    clock.nextTick();
    expect(clock.currentSeq()).toBe(1);
    expect(clock.currentSeq()).toBe(1);

    clock.nextTick();
    expect(clock.currentSeq()).toBe(2);
  });

  it('resetClock clears sequence and instance id', () => {
    cryptoRandomHexMock.mockReturnValueOnce('firstid').mockReturnValueOnce('secondid');

    const clock = new LamportClockService();
    const first = clock.nextTick();
    clock.resetClock();
    const second = clock.nextTick();

    expect(first.id).toBe('firstid_1');
    expect(second.id).toBe('secondid_1');
    expect(clock.currentSeq()).toBe(1);
  });

  it('handles rapid and concurrent ticks', async () => {
    const clock = new LamportClockService();

    const rapid = Array.from({ length: 20 }, () => clock.nextTick());
    expect(rapid[0].seq).toBe(1);
    expect(rapid[rapid.length - 1].seq).toBe(20);

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => clock.nextTick()))
    );
    const seqs = concurrent.map((tick) => tick.seq).sort((a, b) => a - b);

    expect(seqs).toEqual([21, 22, 23, 24, 25]);
    expect(cryptoRandomHexMock).toHaveBeenCalledTimes(1);
  });
});

describe('nextTick', () => {
  it('increments global seq and keeps instance prefix stable', () => {
    vi.stubGlobal('performance', { now: vi.fn(() => 123.456) });

    const first = nextTick();
    const second = nextTick();

    expect(first).toMatchObject({ seq: 1, ts: 123.456, id: 'deadbeef_1' });
    expect(second).toMatchObject({ seq: 2, ts: 123.456, id: 'deadbeef_2' });
    expect(cryptoRandomHexMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to Date.now when performance is unavailable', () => {
    vi.stubGlobal('performance', undefined);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(98765);

    const tick = nextTick();

    expect(tick.ts).toBe(98765);
    expect(tick.seq).toBe(1);

    nowSpy.mockRestore();
  });

  it('supports rapid and concurrent calls', async () => {
    const rapid = Array.from({ length: 30 }, () => nextTick());
    const seqs = rapid.map((tick) => tick.seq);

    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(30);
    expect(new Set(seqs).size).toBe(30);

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => nextTick()))
    );
    const concurrentSeqs = concurrent.map((tick) => tick.seq).sort((a, b) => a - b);

    expect(concurrentSeqs).toEqual([31, 32, 33, 34, 35]);
  });
});

describe('sync', () => {
  it('ignores invalid inputs and updates for larger finite numbers', () => {
    nextTick();

    const longString = 'y'.repeat(10000);
    const invalids = [
      null,
      undefined,
      '',
      '   ',
      '10',
      [],
      {},
      NaN,
      Infinity,
      -1,
      0,
      longString,
      { length: 0 },
    ];

    invalids.forEach((value) => {
      expect(() => sync(value)).not.toThrow();
    });

    expect(currentSeq()).toBe(1);

    sync(10);
    expect(currentSeq()).toBe(10);

    sync(9);
    expect(currentSeq()).toBe(10);

    sync(Number.MAX_SAFE_INTEGER);
    expect(currentSeq()).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('currentSeq', () => {
  it('returns 0 initially and does not increment', () => {
    expect(currentSeq()).toBe(0);
    expect(currentSeq()).toBe(0);

    nextTick();
    expect(currentSeq()).toBe(1);
    expect(currentSeq()).toBe(1);

    sync(5);
    expect(currentSeq()).toBe(5);
  });
});

describe('resetClock', () => {
  it('resets global sequence and instance id', () => {
    cryptoRandomHexMock.mockReturnValueOnce('firstid').mockReturnValueOnce('secondid');

    const first = nextTick();
    expect(first.id).toBe('firstid_1');
    expect(currentSeq()).toBe(1);

    resetClock();
    expect(currentSeq()).toBe(0);

    const second = nextTick();
    expect(second.id).toBe('secondid_1');
    expect(second.seq).toBe(1);
  });
});

describe('compare', () => {
  it('orders by seq values', () => {
    expect(compare({ seq: 1 }, { seq: 2 })).toBe(-1);
    expect(compare({ seq: 2 }, { seq: 1 })).toBe(1);
    expect(compare({ seq: 2 }, { seq: 2 })).toBe(0);
  });

  it('handles nullish and empty inputs safely', () => {
    expect(compare(null, undefined)).toBe(0);
    expect(compare({}, { seq: 1 })).toBe(-1);
    expect(compare({ seq: 1 }, {})).toBe(1);
    expect(compare([], { seq: 1 })).toBe(-1);
    expect(compare('', { seq: 1 })).toBe(-1);
    expect(compare('   ', { seq: 1 })).toBe(-1);
  });

  it('handles boundary values and large payloads', () => {
    const hugeString = 'z'.repeat(200000);
    const deepNested = { seq: 0, payload: { a: { b: { c: { d: hugeString } } } } };
    const maxSeq = { seq: Number.MAX_SAFE_INTEGER, file: hugeString };
    const negativeSeq = { seq: -1, meta: { nested: { value: 'x' } } };
    const stringSeq = { seq: '5', data: hugeString };

    expect(compare(negativeSeq, deepNested)).toBe(-1);
    expect(compare(deepNested, maxSeq)).toBe(-1);
    expect(compare(maxSeq, deepNested)).toBe(1);
    expect(compare(stringSeq, { seq: 4 })).toBe(1);
  });
});
