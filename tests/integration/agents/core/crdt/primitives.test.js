import { beforeEach, describe, expect, it } from 'vitest';

import { resetClock, currentSeq } from '../../../../../js/agents/core/lamport-clock.js';
import { LWWRegister } from '../../../../../js/agents/core/crdt/lww-register.js';
import { LWWMap } from '../../../../../js/agents/core/crdt/lww-map.js';
import { ORSet } from '../../../../../js/agents/core/crdt/or-set.js';
import { GCounter, PNCounter } from '../../../../../js/agents/core/crdt/counters.js';
import { CRDTDocument } from '../../../../../js/agents/core/crdt/document.js';

function makeClock(seq, ts = 0, id = `test_${seq}`) {
  return { seq, ts, id };
}

beforeEach(() => {
  resetClock();
});

describe('CRDT primitives', () => {
  describe('LWWRegister', () => {
    it('resolves conflicts by Lamport clock then nodeId tie-break', () => {
      const reg = new LWWRegister('init', { nodeId: 'A', clock: makeClock(1) });
      expect(reg.value).toBe('init');
      expect(reg.clock.seq).toBe(1);

      const localOp = reg.set('local');
      expect(localOp).toMatchObject({ type: 'set', value: 'local', nodeId: 'A' });
      expect(reg.value).toBe('local');

      expect(reg.apply({ type: 'noop' })).toBe(false);

      const older = { type: 'set', value: 'older', clock: makeClock(0), nodeId: 'Z' };
      expect(reg.apply(older)).toBe(false);
      expect(reg.value).toBe('local');

      const sameClock = reg.clock;
      const tieLose = { type: 'set', value: 'tie-lose', clock: sameClock, nodeId: 'A' };
      expect(reg.apply(tieLose)).toBe(false);
      expect(reg.value).toBe('local');

      const tieWin = { type: 'set', value: 'tie-win', clock: sameClock, nodeId: 'B' };
      expect(reg.apply(tieWin)).toBe(true);
      expect(reg.value).toBe('tie-win');
    });

    it('merges deterministically and supports JSON roundtrip', () => {
      const a = new LWWRegister('a', { nodeId: 'A', clock: makeClock(1) });
      const b = new LWWRegister('b', { nodeId: 'B', clock: makeClock(2) });

      expect(a.merge({})).toBe(false);
      expect(a.merge(b)).toBe(true);
      expect(a.value).toBe('b');

      const c = new LWWRegister('c', { nodeId: 'C', clock: makeClock(2) });
      expect(a.merge(c)).toBe(true); // tie-break on nodeId
      expect(a.value).toBe('c');

      const json = a.toJSON();
      const restored = LWWRegister.fromJSON(json);
      expect(restored.toJSON()).toEqual(json);
      expect(() => LWWRegister.fromJSON({ type: 'nope' })).toThrow(/Invalid LWWRegister JSON/);
    });
  });

  describe('LWWMap', () => {
    it('supports set/delete and view helpers (keys/values/entries/toObject)', () => {
      const map = new LWWMap({ nodeId: 'A' });
      map.set('k1', 'v1');
      map.set('k2', 'v2');

      expect(map.size).toBe(2);
      expect(map.get('k1')).toBe('v1');
      expect(map.has('k2')).toBe(true);
      expect(map.keys()).toEqual(['k1', 'k2']);
      expect(map.values()).toEqual(['v1', 'v2']);
      expect(map.entries()).toEqual([
        ['k1', 'v1'],
        ['k2', 'v2'],
      ]);
      expect(map.toObject()).toEqual({ k1: 'v1', k2: 'v2' });

      map.delete('k1');
      expect(map.get('k1')).toBeUndefined();
      expect(map.has('k1')).toBe(false);
      expect(map.size).toBe(1);
      expect(map.keys()).toEqual(['k2']);
      expect(map.toObject()).toEqual({ k2: 'v2' });
    });

    it('resolves conflicts by clock then nodeId tie-break (apply/merge) and supports clear', () => {
      const map = new LWWMap({ nodeId: 'A' });

      const base = map.set('tie', 'a');
      const win = { ...base, value: 'b', nodeId: 'B' };
      expect(map.apply(win)).toBe(true);
      expect(map.get('tie')).toBe('b');

      const lose = { ...base, value: 'c', nodeId: 'A' };
      expect(map.apply(lose)).toBe(false);
      expect(map.get('tie')).toBe('b');

      const older = { type: 'map-set', key: 'tie', value: 'old', clock: makeClock(0), nodeId: 'Z' };
      expect(map.apply(older)).toBe(false);

      expect(map.apply({ type: 'unknown' })).toBe(false);

      const a = new LWWMap({ nodeId: 'A' });
      const op = a.set('k', 'v1');
      const b = new LWWMap({ nodeId: 'B' });
      b.apply({ ...op, value: 'v2', nodeId: 'B' }); // same clock, higher nodeId

      expect(a.merge({})).toBe(false);
      expect(a.merge(b)).toBe(true);
      expect(a.get('k')).toBe('v2');

      a.set('x', 1);
      a.set('y', 2);
      const ops = a.clear();
      expect(ops).toHaveLength(3);
      expect(ops.every((o) => o.type === 'map-delete')).toBe(true);
      expect(a.size).toBe(0);

      const json = b.toJSON();
      const restored = LWWMap.fromJSON(json);
      expect(restored.toJSON()).toEqual(json);
      expect(() => LWWMap.fromJSON({ type: 'nope' })).toThrow(/Invalid LWWMap JSON/);
    });
  });

  describe('ORSet', () => {
    it('implements observed-remove semantics and idempotent application', () => {
      const a = new ORSet({ nodeId: 'A' });
      const b = new ORSet({ nodeId: 'B' });

      const addX = a.add('x');
      expect(a.has('x')).toBe(true);

      // Remove before observing the add should be a no-op.
      expect(b.delete('x')).toBeNull();
      b.apply(addX);
      expect(b.has('x')).toBe(true);

      const removeX = b.delete('x');
      expect(removeX).toMatchObject({ type: 'set-remove', element: 'x', nodeId: 'B' });
      expect(removeX.tags).toContain(addX.tag);

      expect(a.apply(removeX)).toBe(true);
      expect(a.apply(removeX)).toBe(false); // idempotent
      expect(a.has('x')).toBe(false);
      expect(b.has('x')).toBe(false);
    });

    it('merges tombstones and supports gc/clear + JSON roundtrip', () => {
      const a = new ORSet({ nodeId: 'A' });
      const b = new ORSet({ nodeId: 'B' });

      const addA = a.add('a');
      const addB = b.add('b');
      a.apply(addB);
      b.apply(addA);
      expect(a.values().sort()).toEqual(['a', 'b']);
      expect(b.values().sort()).toEqual(['a', 'b']);

      const removeA = a.delete('a');
      expect(removeA).not.toBeNull();
      expect(b.merge(a)).toBe(true);
      expect(b.has('a')).toBe(false);

      const gcSet = new ORSet({ nodeId: 'A' });
      const addX = gcSet.add('x');
      gcSet.delete('x');
      expect(gcSet.has('x')).toBe(false);
      expect(gcSet.gc()).toBe(1);
      expect(gcSet._elements.has('x')).toBe(false);
      expect(gcSet._tombstones.has(addX.tag)).toBe(true);
      expect(gcSet.gc({ offline: true })).toBe(0);
      expect(gcSet._tombstones.has(addX.tag)).toBe(false);

      const clearSet = new ORSet({ nodeId: 'A' });
      clearSet.add('p');
      clearSet.add('q');
      const ops = clearSet.clear();
      expect(ops).toHaveLength(2);
      expect(clearSet.size).toBe(0);

      const json = b.toJSON();
      const restored = ORSet.fromJSON(json);
      expect(restored.toJSON()).toEqual(json);
      expect(() => ORSet.fromJSON({ type: 'nope' })).toThrow(/Invalid ORSet JSON/);

      expect(clearSet.apply({ type: 'unknown' })).toBe(false);
    });
  });

  describe('Counters', () => {
    it('GCounter grows monotonically and merges by per-node max', () => {
      const a = new GCounter({ nodeId: 'A' });
      expect(a.value).toBe(0);

      const inc3 = a.increment(3);
      expect(a.value).toBe(3);
      expect(inc3).toMatchObject({ type: 'increment', nodeId: 'A', value: 3 });

      expect(() => a.increment(-1)).toThrow(/can only increment/);

      const b = new GCounter({ nodeId: 'B' });
      expect(b.apply(inc3)).toBe(true);
      expect(b.apply(inc3)).toBe(false); // idempotent
      expect(b.value).toBe(3);

      const c = new GCounter({ nodeId: 'C' });
      c.increment(1);
      expect(c.merge(b)).toBe(true);
      expect(c.value).toBe(4);

      const json = c.toJSON();
      const restored = GCounter.fromJSON(json);
      expect(restored.toJSON()).toEqual(json);
      expect(() => GCounter.fromJSON({ type: 'nope' })).toThrow(/Invalid GCounter JSON/);
    });

    it('PNCounter supports inc/dec, applies remote ops, and merges', () => {
      const a = new PNCounter({ nodeId: 'A' });
      expect(a.value).toBe(0);

      const inc5 = a.increment(5);
      const dec2 = a.decrement(2);
      expect(a.value).toBe(3);

      // Negative deltas are routed to the opposite operation.
      a.increment(-2);
      a.decrement(-1);
      expect(a.value).toBe(2);

      const b = new PNCounter({ nodeId: 'B' });
      expect(b.apply(inc5)).toBe(true);
      expect(b.apply(dec2)).toBe(true);
      expect(b.value).toBe(3);

      const c = new PNCounter({ nodeId: 'C' });
      c.increment(1);
      expect(c.merge(b)).toBe(true);
      expect(c.value).toBe(4);

      const json = c.toJSON();
      const restored = PNCounter.fromJSON(json);
      expect(restored.toJSON()).toEqual(json);
      expect(() => PNCounter.fromJSON({ type: 'nope' })).toThrow(/Invalid PNCounter JSON/);
    });
  });

  describe('CRDTDocument', () => {
    it('records ops, updates version, and produces deterministic snapshots', () => {
      const doc = new CRDTDocument({ nodeId: 'A', docId: 'doc', maxOpLogSize: 2 });
      expect(doc.version).toBe(0);
      expect(doc.nodeId).toBe('A');
      expect(doc.docId).toBe('doc');

      doc.setRegister('title', 'hello');
      expect(doc.getRegister('title')).toBe('hello');

      doc.setMapValue('meta', 'k', 'v');
      doc.deleteMapValue('meta', 'k');
      doc.setMapValue('meta', 'k', 'v2');

      doc.addToSet('tags', 'x');
      expect(doc.removeFromSet('tags', 'x')).not.toBeNull();
      doc.addToSet('tags', 'x');

      // Only keep the last 2 ops.
      expect(doc._opLog).toHaveLength(2);

      const versionBefore = doc.version;
      expect(doc.removeFromSet('tags', 'missing')).toBeNull();
      expect(doc.version).toBe(versionBefore);

      doc.incrementCounter('cnt', 2);
      doc.decrementCounter('cnt', 1);

      doc.getCounter('gcnt', 'g');
      doc.incrementCounter('gcnt', 2);
      expect(() => doc.decrementCounter('gcnt', 1)).toThrow(/cannot decrement/);

      const snap = doc.snapshot();
      expect(snap.registers).toEqual({ title: 'hello' });
      expect(snap.maps).toEqual({ meta: { k: 'v2' } });
      expect(snap.sets.tags).toEqual(['x']);
      expect(snap.counters).toMatchObject({ cnt: 1, gcnt: 2 });
    });

    it('syncs by op log (applyOps) and merges consistently across replicas', () => {
      const a = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
      const b = new CRDTDocument({ nodeId: 'B', docId: 'doc' });

      a.setRegister('r', 'va');
      a.setMapValue('m', 'k', 'v1');
      a.addToSet('s', 'x');
      a.incrementCounter('pn', 2);
      a.decrementCounter('pn', 1);

      // Ensure applyOp rejects invalid ops early.
      expect(b.applyOp(null)).toBe(false);
      expect(b.applyOp({})).toBe(false);

      const ops = a.getOps(0);
      expect(b.applyOps(ops)).toBe(ops.length);
      expect(b.applyOps(ops)).toBe(0); // idempotent

      const snapA = a.snapshot();
      const snapB = b.snapshot();
      expect(snapB.version).toBe(snapA.version);
      expect(snapB.registers).toEqual(snapA.registers);
      expect(snapB.maps).toEqual(snapA.maps);
      expect(snapB.sets).toEqual(snapA.sets);
      expect(snapB.counters).toEqual(snapA.counters);

      // Merge should converge as well.
      const c = new CRDTDocument({ nodeId: 'C', docId: 'doc' });
      c.setRegister('r', 'vc');
      expect(a.merge({})).toBe(false);
      expect(a.merge(c)).toBe(true);
      expect(a.snapshot().registers.r).toBe('vc');
    });

    it('merges missing field types and updates version to max', () => {
      const a = new CRDTDocument({ nodeId: 'A', docId: 'doc' });
      const b = new CRDTDocument({ nodeId: 'B', docId: 'doc' });

      b.setRegister('r', 'vr');
      b.setMapValue('m', 'k', 'v');
      b.addToSet('s', 'x');
      b.getCounter('g', 'g');
      b.incrementCounter('g', 2);
      b.incrementCounter('pn', 3);

      expect(a.version).toBe(0);
      expect(b.version).toBeGreaterThan(0);
      expect(a.merge(b)).toBe(true);
      expect(a.version).toBe(b.version);

      const snapA = a.snapshot();
      const snapB = b.snapshot();
      expect(snapA.registers).toEqual(snapB.registers);
      expect(snapA.maps).toEqual(snapB.maps);
      expect(snapA.sets).toEqual(snapB.sets);
      expect(snapA.counters).toEqual(snapB.counters);
    });

    it('advances Lamport clock from applied ops and supports JSON roundtrip', () => {
      const doc = new CRDTDocument({ nodeId: 'B', docId: 'doc' });
      expect(currentSeq()).toBe(0);

      const mapOp = {
        type: 'map-set',
        key: 'k',
        value: 'v',
        clock: makeClock(100),
        nodeId: 'A',
        field: 'm',
        fieldType: 'map',
        version: 1,
        docId: 'doc',
      };
      expect(doc.applyOp(mapOp)).toBe(true);
      expect(currentSeq()).toBe(100);
      expect(doc.version).toBe(1);

      const pnOp = {
        type: 'pn-increment',
        op: { type: 'increment', nodeId: 'A', value: 1, clock: makeClock(200) },
        nodeId: 'A',
        field: 'c',
        fieldType: 'counter',
        version: 2,
        docId: 'doc',
      };
      expect(doc.applyOp(pnOp)).toBe(true);
      expect(currentSeq()).toBe(200);
      expect(doc.version).toBe(2);
      expect(doc.snapshot().counters.c).toBe(1);

      doc.setRegister('r', 'v');
      doc.addToSet('s', 'x');
      doc.getCounter('g', 'g');
      doc.incrementCounter('g', 2);

      const json = doc.toJSON();
      const restored = CRDTDocument.fromJSON(json);
      expect(restored.snapshot()).toEqual(doc.snapshot());
      expect(() => CRDTDocument.fromJSON({ type: 'nope' })).toThrow(/Invalid CRDTDocument JSON/);
    });
  });
});
