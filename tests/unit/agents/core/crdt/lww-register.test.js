import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/core/lamport-clock.js', () => ({
  nextTick: vi.fn(),
  compare: vi.fn(),
}));

import LWWRegisterDefault, { LWWRegister } from '../../../../../js/agents/core/crdt/lww-register.js';
import { nextTick, compare } from '../../../../../js/agents/core/lamport-clock.js';

const makeClock = (seq, id = `node${seq}_${seq}`, ts = seq * 10) => ({ seq, ts, id });

beforeEach(() => {
  vi.resetAllMocks();
  let seq = 0;
  nextTick.mockImplementation(() => {
    seq += 1;
    return makeClock(seq, `node${seq}_${seq}`);
  });
  compare.mockImplementation((a, b) => {
    const seqA = a?.seq ?? 0;
    const seqB = b?.seq ?? 0;
    if (seqA < seqB) return -1;
    if (seqA > seqB) return 1;
    return 0;
  });
});

describe('LWWRegister', () => {
  it('initializes with default clock and derives nodeId from clock id', () => {
    const clock = makeClock(5, 'alpha_5');
    nextTick.mockReturnValueOnce(clock);

    const reg = new LWWRegister();

    expect(reg.value).toBeNull();
    expect(reg.clock).toBe(clock);
    expect(reg.toJSON().nodeId).toBe('alpha');
    expect(nextTick).toHaveBeenCalledTimes(1);
  });

  it('respects provided clock and nodeId options', () => {
    const clock = makeClock(7, 'nodeZ_7');
    const reg = new LWWRegister('init', { clock, nodeId: 'override' });

    expect(reg.value).toBe('init');
    expect(reg.clock).toBe(clock);
    expect(reg.toJSON().nodeId).toBe('override');
    expect(nextTick).not.toHaveBeenCalled();
  });

  it('set updates value and returns a set operation', () => {
    const baseClock = makeClock(1, 'base_1');
    const reg = new LWWRegister('start', { clock: baseClock, nodeId: 'base' });
    const nextClock = makeClock(2, 'base_2');
    nextTick.mockReturnValueOnce(nextClock);

    const op = reg.set(0);

    expect(op).toEqual({
      type: 'set',
      value: 0,
      clock: nextClock,
      nodeId: 'base',
    });
    expect(reg.value).toBe(0);
    expect(reg.clock).toBe(nextClock);
    expect(nextTick).toHaveBeenCalledTimes(1);
  });

  it('handles nullish, empty, and boundary scalar values', () => {
    const baseClock = makeClock(1, 'nodeA_1');
    const reg = new LWWRegister('start', { clock: baseClock, nodeId: 'nodeA' });

    const values = [
      null,
      undefined,
      '',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '   ',
    ];

    for (const value of values) {
      const op = reg.set(value);
      if (value === undefined) {
        expect(op.value).toBeUndefined();
        expect(reg.value).toBeUndefined();
      } else {
        expect(op.value).toBe(value);
        expect(reg.value).toBe(value);
      }
      expect(op.nodeId).toBe('nodeA');
      expect(op.type).toBe('set');
    }

    expect(nextTick).toHaveBeenCalledTimes(values.length);
  });

  it('accepts type boundary inputs without coercion', () => {
    const baseClock = makeClock(1, 'nodeB_1');
    const reg = new LWWRegister('start', { clock: baseClock, nodeId: 'nodeB' });

    const numericString = '42';
    const arrayLike = { 0: 'x', length: 1 };

    const opString = reg.set(numericString);
    expect(opString.value).toBe(numericString);
    expect(reg.value).toBe(numericString);

    const opArrayLike = reg.set(arrayLike);
    expect(opArrayLike.value).toBe(arrayLike);
    expect(reg.value).toBe(arrayLike);
  });

  it('supports large payloads and deep nesting', () => {
    const baseClock = makeClock(1, 'nodeC_1');
    const reg = new LWWRegister('start', { clock: baseClock, nodeId: 'nodeC' });

    const largeString = 'x'.repeat(100000);
    const largeArray = new Array(50000).fill('chunk');
    const deepObject = { level: 0 };
    let cursor = deepObject;
    for (let i = 1; i <= 40; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const payload = { largeString, largeArray, deepObject };
    const op = reg.set(payload);

    expect(op.value).toBe(payload);
    expect(reg.value).toBe(payload);
    expect(reg.value.largeString).toBe(largeString);
    expect(reg.value.largeArray).toBe(largeArray);
    expect(reg.value.deepObject).toBe(deepObject);
  });

  it('handles rapid consecutive set calls with independent clocks', () => {
    const baseClock = makeClock(1, 'nodeD_1');
    const reg = new LWWRegister('start', { clock: baseClock, nodeId: 'nodeD' });

    const clockA = makeClock(2, 'nodeD_2');
    const clockB = makeClock(3, 'nodeD_3');
    const clockC = makeClock(4, 'nodeD_4');

    nextTick.mockReturnValueOnce(clockA).mockReturnValueOnce(clockB).mockReturnValueOnce(clockC);

    const opA = reg.set('a');
    const opB = reg.set('b');
    const opC = reg.set('c');

    expect(opA.clock).toBe(clockA);
    expect(opB.clock).toBe(clockB);
    expect(opC.clock).toBe(clockC);
    expect(reg.value).toBe('c');
    expect(nextTick).toHaveBeenCalledTimes(3);
  });

  it('apply ignores non-set operations', () => {
    const baseClock = makeClock(2, 'nodeE_2');
    const reg = new LWWRegister('stay', { clock: baseClock, nodeId: 'nodeE' });

    const result = reg.apply({ type: 'noop', value: 'ignored' });

    expect(result).toBe(false);
    expect(reg.value).toBe('stay');
    expect(reg.clock).toBe(baseClock);
    expect(compare).not.toHaveBeenCalled();
  });

  it('apply updates on newer clocks and uses compare', () => {
    const baseClock = makeClock(1, 'nodeF_1');
    const reg = new LWWRegister('old', { clock: baseClock, nodeId: 'nodeF' });

    const newClock = makeClock(3, 'nodeG_3');
    const op = { type: 'set', value: 'new', clock: newClock, nodeId: 'nodeG' };

    const result = reg.apply(op);

    expect(result).toBe(true);
    expect(reg.value).toBe('new');
    expect(reg.clock).toBe(newClock);
    expect(compare).toHaveBeenCalledWith(newClock, baseClock);
  });

  it('apply ignores older clocks', () => {
    const baseClock = makeClock(5, 'nodeH_5');
    const reg = new LWWRegister('current', { clock: baseClock, nodeId: 'nodeH' });

    const olderClock = makeClock(2, 'nodeI_2');
    const op = { type: 'set', value: 'old', clock: olderClock, nodeId: 'nodeI' };

    const result = reg.apply(op);

    expect(result).toBe(false);
    expect(reg.value).toBe('current');
    expect(reg.clock).toBe(baseClock);
  });

  it('converges deterministically for concurrent ops with equal clocks', () => {
    const sharedClock = makeClock(4, 'nodeJ_4');
    const opA = { type: 'set', value: 'from-A', clock: sharedClock, nodeId: 'A' };
    const opB = { type: 'set', value: 'from-B', clock: sharedClock, nodeId: 'B' };

    const reg1 = new LWWRegister('base', { clock: sharedClock, nodeId: 'A' });
    const reg2 = new LWWRegister('base', { clock: sharedClock, nodeId: 'A' });

    reg1.apply(opA);
    reg1.apply(opB);

    reg2.apply(opB);
    reg2.apply(opA);

    expect(reg1.value).toBe('from-B');
    expect(reg2.value).toBe('from-B');
  });

  it('merge returns false for non-register inputs', () => {
    const baseClock = makeClock(1, 'nodeK_1');
    const reg = new LWWRegister('base', { clock: baseClock, nodeId: 'nodeK' });

    expect(reg.merge(null)).toBe(false);
    expect(reg.merge({})).toBe(false);
  });

  it('merge updates from newer clocks', () => {
    const baseClock = makeClock(1, 'nodeL_1');
    const reg = new LWWRegister('base', { clock: baseClock, nodeId: 'nodeL' });

    const otherClock = makeClock(2, 'nodeM_2');
    const other = new LWWRegister('other', { clock: otherClock, nodeId: 'nodeM' });

    const result = reg.merge(other);

    expect(result).toBe(true);
    expect(reg.value).toBe('other');
    expect(reg.clock).toBe(otherClock);
    expect(compare).toHaveBeenCalledWith(otherClock, baseClock);
  });

  it('merge resolves equal clocks with nodeId ordering', () => {
    const baseClock = makeClock(3, 'nodeN_3');
    const reg = new LWWRegister('base', { clock: baseClock, nodeId: 'A' });

    const other = new LWWRegister('other', { clock: baseClock, nodeId: 'B' });
    const applied = reg.merge(other);

    expect(applied).toBe(true);
    expect(reg.value).toBe('other');

    const lower = new LWWRegister('lower', { clock: baseClock, nodeId: 'A' });
    const rejected = reg.merge(lower);

    expect(rejected).toBe(false);
    expect(reg.value).toBe('other');
  });

  it('merge ignores older clocks and lower nodeIds', () => {
    const baseClock = makeClock(5, 'nodeO_5');
    const reg = new LWWRegister('base', { clock: baseClock, nodeId: 'B' });

    const older = new LWWRegister('older', { clock: makeClock(1, 'nodeP_1'), nodeId: 'C' });
    const olderResult = reg.merge(older);

    expect(olderResult).toBe(false);
    expect(reg.value).toBe('base');

    const equalLower = new LWWRegister('lower', { clock: baseClock, nodeId: 'A' });
    const lowerResult = reg.merge(equalLower);

    expect(lowerResult).toBe(false);
    expect(reg.value).toBe('base');
  });

  it('serializes state with toJSON', () => {
    const clock = makeClock(9, 'nodeQ_9');
    const reg = new LWWRegister('value', { clock, nodeId: 'nodeQ' });

    expect(reg.toJSON()).toEqual({
      type: 'LWWRegister',
      value: 'value',
      clock,
      nodeId: 'nodeQ',
    });
  });

  it('deserializes from valid JSON', () => {
    const json = {
      type: 'LWWRegister',
      value: null,
      clock: makeClock(11, 'nodeR_11'),
      nodeId: 'nodeR',
    };

    const reg = LWWRegister.fromJSON(json);

    expect(reg).toBeInstanceOf(LWWRegister);
    expect(reg.value).toBeNull();
    expect(reg.clock).toBe(json.clock);
    expect(reg.toJSON()).toEqual(json);
  });

  it('throws on invalid JSON input', () => {
    expect(() => LWWRegister.fromJSON({ type: 'Other' })).toThrow('Invalid LWWRegister JSON');
    expect(() => LWWRegister.fromJSON(null)).toThrow('Invalid LWWRegister JSON');
  });
});

describe('default', () => {
  it('exports LWWRegister as the default', () => {
    expect(LWWRegisterDefault).toBe(LWWRegister);
  });
});
