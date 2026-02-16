// ORSet unit tests covering add/remove/apply/merge, JSON, and edge cases.
// Uses a mocked Lamport clock so tag generation stays deterministic in tests.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/core/lamport-clock.js', () => ({
  nextTick: vi.fn(),
}));

import { ORSet } from '../../../../../js/agents/core/crdt/or-set.js';
import { nextTick } from '../../../../../js/agents/core/lamport-clock.js';

const mockedNextTick = vi.mocked(nextTick);

function createClockMock({ idPrefix = 'nodeA', seqStart = 0, tsStart = 1000 } = {}) {
  let seq = seqStart;
  let ts = tsStart;
  return () => {
    seq += 1;
    ts += 1;
    return { seq, ts, id: `${idPrefix}_${seq}` };
  };
}

beforeEach(() => {
  mockedNextTick.mockReset();
  mockedNextTick.mockImplementation(createClockMock());
});

describe('ORSet', () => {
  it('initializes empty and derives nodeId from the clock when not provided', () => {
    mockedNextTick.mockImplementation(createClockMock({ idPrefix: 'auto', seqStart: 0, tsStart: 10 }));
    const set = new ORSet();

    expect(set.size).toBe(0);
    expect(set.values()).toEqual([]);
    expect(set.has('missing')).toBe(false);

    const op = set.add('x');
    expect(op.nodeId).toBe('auto');
    expect(op.type).toBe('set-add');
    expect(op.element).toBe('x');
    expect(op.tag).toMatch(/^auto_\d+_\d+$/);
  });

  it('respects provided nodeId and adds elements with unique tags', () => {
    const set = new ORSet({ nodeId: 'custom' });
    expect(mockedNextTick).not.toHaveBeenCalled();

    const op = set.add('alpha');
    expect(op.nodeId).toBe('custom');
    expect(op.tag.startsWith('custom_')).toBe(true);
    expect(set.has('alpha')).toBe(true);
    expect(set.values()).toEqual(['alpha']);
    expect(set.size).toBe(1);
  });

  it('handles nullish and boundary elements without coercion', () => {
    const set = new ORSet({ nodeId: 'bounds' });
    const emptyArray = [];
    const emptyObject = {};
    const whitespace = '   ';
    const elements = [null, undefined, '', whitespace, 0, -1, Number.MAX_SAFE_INTEGER, emptyArray, emptyObject];

    for (const element of elements) {
      set.add(element);
    }

    expect(set.size).toBe(elements.length);
    const values = set.values();
    for (const element of elements) {
      expect(set.has(element)).toBe(true);
      expect(values).toContain(element);
    }
  });

  it('treats type boundary inputs as distinct values', () => {
    const set = new ORSet({ nodeId: 'types' });
    const arrayLike = { 0: 'x', length: 1 };
    set.add('42');
    set.add(arrayLike);

    expect(set.has('42')).toBe(true);
    expect(set.has(42)).toBe(false);

    expect(set.has(arrayLike)).toBe(true);
    expect(set.has(['x'])).toBe(false);
    expect(set.values()).toEqual(expect.arrayContaining(['42', arrayLike]));
  });

  it('deletes observed tags and returns null for no-op deletes', () => {
    const set = new ORSet({ nodeId: 'del' });
    const first = set.add('item');
    const second = set.add('item');

    const removeOp = set.delete('item');
    expect(removeOp).toMatchObject({
      type: 'set-remove',
      element: 'item',
      nodeId: 'del',
    });
    expect(removeOp.tags).toEqual(expect.arrayContaining([first.tag, second.tag]));
    expect(set.has('item')).toBe(false);
    expect(set.values()).toEqual([]);

    expect(set.delete('item')).toBeNull();
    expect(set.delete('missing')).toBeNull();
  });

  it('applies add/remove operations idempotently and ignores unknown types', () => {
    const source = new ORSet({ nodeId: 'src' });
    const target = new ORSet({ nodeId: 'dst' });

    const addOp = source.add('x');
    expect(target.apply(addOp)).toBe(true);
    expect(target.apply(addOp)).toBe(false);
    expect(target.has('x')).toBe(true);

    const removeOp = target.delete('x');
    expect(removeOp).not.toBeNull();
    expect(source.apply(removeOp)).toBe(true);
    expect(source.apply(removeOp)).toBe(false);
    expect(source.has('x')).toBe(false);

    expect(target.apply({ type: 'unknown' })).toBe(false);
  });

  it('records tombstones for remote removes even when tags are unseen', () => {
    const set = new ORSet({ nodeId: 'remote' });
    const removeOp = {
      type: 'set-remove',
      element: 'ghost',
      tags: ['t1', 't2'],
      clock: { seq: 1, ts: 1, id: 'remote_1' },
      nodeId: 'remote',
    };

    expect(set.apply(removeOp)).toBe(true);
    expect(set.apply(removeOp)).toBe(false);
    expect(set.has('ghost')).toBe(false);
    expect(set._tombstones.has('t1')).toBe(true);
  });

  it('merges elements and tombstones while rejecting invalid inputs', () => {
    const a = new ORSet({ nodeId: 'A' });
    const b = new ORSet({ nodeId: 'B' });

    const addA = a.add('a');
    const addB = b.add('b');
    a.apply(addB);
    b.apply(addA);

    const removeA = a.delete('a');
    expect(removeA).not.toBeNull();

    expect(b.merge({})).toBe(false);
    expect(b.merge(a)).toBe(true);
    expect(b.has('a')).toBe(false);
    expect(b.has('b')).toBe(true);
    expect(b._tombstones.has(removeA.tags[0])).toBe(true);
    expect(b.merge(a)).toBe(false);
  });

  it('clears elements and returns remove ops for each value', () => {
    const set = new ORSet({ nodeId: 'clear' });
    expect(set.clear()).toEqual([]);

    set.add('p');
    set.add('q');
    const ops = set.clear();

    expect(ops).toHaveLength(2);
    expect(ops.every((op) => op.type === 'set-remove')).toBe(true);
    expect(set.size).toBe(0);
    expect(set.values()).toEqual([]);
  });

  it('garbage-collects fully removed elements but keeps partially removed ones', () => {
    const set = new ORSet({ nodeId: 'gc' });
    const first = set.add('keep');
    const second = set.add('keep');

    const partialRemove = {
      type: 'set-remove',
      element: 'keep',
      tags: [first.tag],
      clock: { seq: 1, ts: 1, id: 'gc_1' },
      nodeId: 'gc',
    };
    set.apply(partialRemove);

    expect(set.has('keep')).toBe(true);
    expect(set.gc()).toBe(0);

    const finalRemove = {
      type: 'set-remove',
      element: 'keep',
      tags: [second.tag],
      clock: { seq: 2, ts: 2, id: 'gc_2' },
      nodeId: 'gc',
    };
    set.apply(finalRemove);

    expect(set.gc()).toBe(1);
    expect(set.has('keep')).toBe(false);
    expect(set._elements.has('keep')).toBe(false);
    expect(set._tombstones.has(first.tag)).toBe(false);
    expect(set._tombstones.has(second.tag)).toBe(false);
    expect(set._tagToElement.has(first.tag)).toBe(false);
  });

  it('serializes and restores JSON snapshots preserving element types', () => {
    const set = new ORSet({ nodeId: 'json' });
    set.add('alpha');
    const numeric = 0;
    set.add(numeric);
    const deleteOp = set.delete(numeric);
    expect(deleteOp).not.toBeNull();

    const json = set.toJSON();
    expect(json).toMatchObject({ type: 'ORSet', nodeId: 'json' });
    expect(json.entries).toBeDefined();
    expect(json.entries.some(e => e.element === 'alpha')).toBe(true);
    expect(json.tombstones).toEqual(expect.arrayContaining(deleteOp.tags));

    const restored = ORSet.fromJSON(json);
    expect(restored.toJSON()).toEqual(json);
    expect(restored.has('alpha')).toBe(true);
    expect(restored.has('0')).toBe(false);
    expect(restored.has(0)).toBe(false);
    expect(restored.values()).toEqual(['alpha']);

    const empty = ORSet.fromJSON({ type: 'ORSet', nodeId: 'empty' });
    expect(empty.size).toBe(0);

    expect(() => ORSet.fromJSON({ type: 'nope' })).toThrow(/Invalid ORSet JSON/);
  });

  it('handles rapid successive and simulated concurrent adds with unique tags', async () => {
    const set = new ORSet({ nodeId: 'fast' });
    const ops = [set.add('a'), set.add('a'), set.add('b')];

    const concurrentOps = await Promise.all([
      Promise.resolve().then(() => set.add('c')),
      Promise.resolve().then(() => set.add('c')),
    ]);

    const tags = [...ops, ...concurrentOps].map((op) => op.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(set.size).toBe(3);
    expect(set.values()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('supports large payloads and deep nesting without losing membership', () => {
    const set = new ORSet({ nodeId: 'resource' });
    const largeFilePayload = 'x'.repeat(200000);
    const deepObject = { level: 0 };
    let cursor = deepObject;
    for (let i = 1; i <= 50; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }
    const largeArray = new Array(50000).fill('data');

    set.add(largeFilePayload);
    set.add(deepObject);
    set.add(largeArray);

    expect(set.has(largeFilePayload)).toBe(true);
    expect(set.has(deepObject)).toBe(true);
    expect(set.has(largeArray)).toBe(true);
  });
});
