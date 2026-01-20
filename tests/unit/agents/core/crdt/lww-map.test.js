import { describe, it, expect, vi, beforeEach } from 'vitest';

const lamportMocks = vi.hoisted(() => ({
  seq: 0,
  prefix: 'node',
  nextTick: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('../../../../../js/agents/core/lamport-clock.js', () => ({
  nextTick: lamportMocks.nextTick,
  compare: lamportMocks.compare,
}));

import { LWWMap } from '../../../../../js/agents/core/crdt/lww-map.js';
import { nextTick, compare } from '../../../../../js/agents/core/lamport-clock.js';

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  cursor.leaf = 'end';
  return root;
};

beforeEach(() => {
  lamportMocks.seq = 0;
  lamportMocks.prefix = 'node';
  lamportMocks.nextTick.mockReset();
  lamportMocks.compare.mockReset();

  lamportMocks.nextTick.mockImplementation(() => {
    lamportMocks.seq += 1;
    return {
      seq: lamportMocks.seq,
      ts: lamportMocks.seq,
      id: `${lamportMocks.prefix}_${lamportMocks.seq}`,
    };
  });

  lamportMocks.compare.mockImplementation((a, b) => {
    const seqA = Number.isFinite(a?.seq) ? a.seq : 0;
    const seqB = Number.isFinite(b?.seq) ? b.seq : 0;
    if (seqA < seqB) return -1;
    if (seqA > seqB) return 1;
    return 0;
  });
});

describe('LWWMap', () => {
  it('uses the provided nodeId without calling nextTick in the constructor', () => {
    const map = new LWWMap({ nodeId: 'custom' });

    expect(nextTick).not.toHaveBeenCalled();

    const op = map.set('k', 'v');
    expect(op).toMatchObject({ type: 'map-set', key: 'k', value: 'v', nodeId: 'custom' });
    expect(op.clock.seq).toBe(1);
    expect(map.get('k')).toBe('v');
    expect(nextTick).toHaveBeenCalledTimes(1);
  });

  it('derives nodeId from nextTick when none is provided', () => {
    lamportMocks.prefix = 'auto';

    const map = new LWWMap();
    expect(nextTick).toHaveBeenCalledTimes(1);

    const op = map.set('k', 'v');
    expect(op.nodeId).toBe('auto');
    expect(op.clock.seq).toBe(2);
    expect(nextTick).toHaveBeenCalledTimes(2);
  });

  it('stores empty and boundary values without coercion', () => {
    const map = new LWWMap({ nodeId: 'node' });
    const emptyArray = [];
    const emptyObject = {};
    const arrayLike = { 0: 'x', length: 1 };

    map.set('', 'empty-key');
    map.set('null', null);
    map.set('undef', undefined);
    map.set('empty-string', '');
    map.set('empty-array', emptyArray);
    map.set('empty-object', emptyObject);
    map.set('zero', 0);
    map.set('neg', -1);
    map.set('max', Number.MAX_SAFE_INTEGER);
    map.set('space', '   ');
    map.set('42', 'string-key');
    map.set(42, 'number-key');
    map.set('array-like', arrayLike);

    expect(map.get('')).toBe('empty-key');
    expect(map.get('null')).toBeNull();
    expect(map.has('undef')).toBe(true);
    expect(map.get('undef')).toBeUndefined();
    expect(map.get('empty-string')).toBe('');
    expect(map.get('empty-array')).toBe(emptyArray);
    expect(map.get('empty-object')).toBe(emptyObject);
    expect(map.get('zero')).toBe(0);
    expect(map.get('neg')).toBe(-1);
    expect(map.get('max')).toBe(Number.MAX_SAFE_INTEGER);
    expect(map.get('space')).toBe('   ');
    expect(map.get('42')).toBe('string-key');
    expect(map.get(42)).toBe('number-key');
    expect(map.get('array-like')).toBe(arrayLike);
    expect(map.has('missing')).toBeFalsy();

    expect(map.size).toBe(13);
  });

  it('keys/values/entries/toObject exclude deleted entries', () => {
    const map = new LWWMap({ nodeId: 'node' });

    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);
    map.delete('b');

    expect(map.keys().sort()).toEqual(['a', 'c']);
    expect(map.values().sort()).toEqual([1, 3]);
    expect(map.entries()).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
    expect(map.toObject()).toEqual({ a: 1, c: 3 });
    expect(map.has('b')).toBe(false);
    expect(map.get('b')).toBeUndefined();
    expect(map.size).toBe(2);
  });

  it('returns ops with clocks and handles rapid consecutive updates', async () => {
    const map = new LWWMap({ nodeId: 'node' });

    const op1 = map.set('k', 'v1');
    const op2 = map.set('k', 'v2');
    const op3 = map.set('k', 'v3');

    expect(op1.clock.seq).toBe(1);
    expect(op2.clock.seq).toBe(2);
    expect(op3.clock.seq).toBe(3);
    expect(map.get('k')).toBe('v3');
    expect(map.size).toBe(1);

    const [opA, opB] = await Promise.all([
      Promise.resolve(map.set('a', 1)),
      Promise.resolve(map.set('b', 2)),
    ]);

    expect(opA.clock).not.toBe(opB.clock);
    expect(new Set([opA.clock.seq, opB.clock.seq]).size).toBe(2);
  });

  it('delete returns ops and marks entries deleted even when missing', () => {
    const map = new LWWMap({ nodeId: 'node' });

    const opMissing = map.delete('missing');
    expect(opMissing).toMatchObject({ type: 'map-delete', key: 'missing', nodeId: 'node' });
    expect(map.has('missing')).toBe(false);
    expect(map.get('missing')).toBeUndefined();
    expect(map.size).toBe(0);

    map.set('k', 'v');
    const op = map.delete('k');
    expect(op.type).toBe('map-delete');
    expect(map.has('k')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('apply enforces clock ordering and nodeId tie-breaks', () => {
    const map = new LWWMap({ nodeId: 'local' });

    map.set('k', 'local');

    expect(map.apply({ type: 'noop', key: 'k' })).toBe(false);

    const older = map.apply({
      type: 'map-set',
      key: 'k',
      value: 'old',
      clock: { seq: 0, ts: 0, id: 'remote_0' },
      nodeId: 'remote',
    });
    expect(older).toBe(false);
    expect(map.get('k')).toBe('local');

    const tieLower = map.apply({
      type: 'map-set',
      key: 'k',
      value: 'tie-lower',
      clock: { seq: 1, ts: 1, id: 'remote_1' },
      nodeId: 'aaa',
    });
    expect(tieLower).toBe(false);
    expect(map.get('k')).toBe('local');

    const tieHigher = map.apply({
      type: 'map-set',
      key: 'k',
      value: 'tie-higher',
      clock: { seq: 1, ts: 1, id: 'remote_1' },
      nodeId: 'zzz',
    });
    expect(tieHigher).toBe(true);
    expect(map.get('k')).toBe('tie-higher');

    const newerDelete = map.apply({
      type: 'map-delete',
      key: 'k',
      clock: { seq: 2, ts: 2, id: 'remote_2' },
      nodeId: 'remote',
    });
    expect(newerDelete).toBe(true);
    expect(map.get('k')).toBeUndefined();
    expect(map.has('k')).toBe(false);

    expect(compare).toHaveBeenCalled();
  });

  it('apply delete retains previous value in metadata', () => {
    const map = new LWWMap({ nodeId: 'local' });

    const payload = { nested: true };
    map.set('k', payload);

    const applied = map.apply({
      type: 'map-delete',
      key: 'k',
      clock: { seq: 2, ts: 2, id: 'remote_2' },
      nodeId: 'remote',
    });

    expect(applied).toBe(true);

    const json = map.toJSON();
    expect(json.entries.k.value).toBe(payload);
    expect(json.entries.k.deleted).toBe(true);

    const missing = map.apply({
      type: 'map-delete',
      key: 'missing',
      clock: { seq: 3, ts: 3, id: 'remote_3' },
      nodeId: 'remote',
    });
    expect(missing).toBe(true);
    expect(map.toJSON().entries.missing.value).toBeUndefined();
  });

  it('merge respects clocks and nodeId tie-breaks', () => {
    const mapA = new LWWMap({ nodeId: 'A' });
    const mapB = new LWWMap({ nodeId: 'B' });

    mapA.apply({
      type: 'map-set',
      key: 'newer',
      value: 'a1',
      clock: { seq: 2, ts: 2, id: 'a_2' },
      nodeId: 'm',
    });

    mapA.apply({
      type: 'map-set',
      key: 'tie',
      value: 'from-a',
      clock: { seq: 5, ts: 5, id: 'a_5' },
      nodeId: 'aa',
    });

    mapA.apply({
      type: 'map-set',
      key: 'keep',
      value: 'keep',
      clock: { seq: 5, ts: 5, id: 'a_5' },
      nodeId: 'z',
    });

    mapB.apply({
      type: 'map-set',
      key: 'newer',
      value: 'b1',
      clock: { seq: 3, ts: 3, id: 'b_3' },
      nodeId: 'b',
    });

    mapB.apply({
      type: 'map-set',
      key: 'tie',
      value: 'from-b',
      clock: { seq: 5, ts: 5, id: 'b_5' },
      nodeId: 'zz',
    });

    mapB.apply({
      type: 'map-set',
      key: 'keep',
      value: 'lose',
      clock: { seq: 5, ts: 5, id: 'b_5' },
      nodeId: 'a',
    });

    mapB.apply({
      type: 'map-set',
      key: 'onlyB',
      value: 'only-b',
      clock: { seq: 1, ts: 1, id: 'b_1' },
      nodeId: 'b',
    });

    const changed = mapA.merge(mapB);

    expect(changed).toBe(true);
    expect(mapA.get('newer')).toBe('b1');
    expect(mapA.get('tie')).toBe('from-b');
    expect(mapA.get('keep')).toBe('keep');
    expect(mapA.get('onlyB')).toBe('only-b');

    expect(compare).toHaveBeenCalled();
  });

  it('merge rejects non-LWWMap inputs', () => {
    const map = new LWWMap({ nodeId: 'node' });
    expect(map.merge(null)).toBe(false);
    expect(map.merge({})).toBe(false);
  });

  it('clear returns delete ops and removes entries', () => {
    const map = new LWWMap({ nodeId: 'node' });

    map.set('a', 1);
    map.set('b', 2);

    const ops = map.clear();

    expect(ops).toHaveLength(2);
    expect(ops.map((op) => op.type)).toEqual(['map-delete', 'map-delete']);
    expect(map.size).toBe(0);
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(false);
  });

  it('serializes and deserializes with validation', () => {
    const map = new LWWMap({ nodeId: 'node' });

    map.set('a', 1);
    map.delete('a');
    map.set('b', { nested: true });

    const json = map.toJSON();
    expect(json).toMatchObject({ type: 'LWWMap', nodeId: 'node' });
    expect(Object.keys(json.entries).sort()).toEqual(['a', 'b']);

    const restored = LWWMap.fromJSON(json);
    expect(restored).toBeInstanceOf(LWWMap);
    expect(restored.get('a')).toBeUndefined();
    expect(restored.has('a')).toBe(false);
    expect(restored.get('b')).toEqual({ nested: true });

    const empty = LWWMap.fromJSON({ type: 'LWWMap', nodeId: 'x' });
    expect(empty.size).toBe(0);

    expect(() => LWWMap.fromJSON(null)).toThrow('Invalid LWWMap JSON');
    expect(() => LWWMap.fromJSON({ type: 'Wrong' })).toThrow('Invalid LWWMap JSON');
  });

  it('handles large payloads and deep nesting', () => {
    const map = new LWWMap({ nodeId: 'node' });

    const longKey = 'k'.repeat(10000);
    const largeString = 'v'.repeat(1024 * 1024);
    const deepObject = buildDeepObject(40);
    const largeArray = new Array(10000).fill('data');
    const payload = { largeString, deepObject, largeArray };

    map.set(longKey, payload);

    const stored = map.get(longKey);
    expect(stored).toBe(payload);
    expect(stored.largeString.length).toBe(1024 * 1024);
    expect(stored.deepObject).toBe(deepObject);
    expect(stored.largeArray).toBe(largeArray);
  });
});
