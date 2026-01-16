/**
 * StateBus 测试
 * 使用 node:test + node:assert/strict
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StateBus, EventBus } from '../../../js/agents/core/index.js';

describe('StateBus', () => {
  /** @type {StateBus} */
  let state;
  /** @type {EventBus} */
  let events;

  beforeEach(() => {
    events = new EventBus();
    state = new StateBus({ events, keepLog: true });
  });

  afterEach(() => {
    events.dispose();
  });

  describe('get/set', () => {
    it('should return full state when no path provided', () => {
      const root = state.get();
      assert.ok(root.meta !== undefined);
      assert.ok(root.runtime !== undefined);
    });

    it('should set and get values', () => {
      state.set('user.name', 'Alice');
      assert.equal(state.get('user.name'), 'Alice');
    });

    it('should support nested paths', () => {
      state.set('deep.nested.value', 42);
      assert.equal(state.get('deep.nested.value'), 42);
      assert.deepEqual(state.get('deep.nested'), { value: 42 });
      assert.deepEqual(state.get('deep'), { nested: { value: 42 } });
    });

    it('should return undefined for missing paths', () => {
      assert.equal(state.get('nonexistent.path'), undefined);
    });

    it('should overwrite existing values', () => {
      state.set('counter', 1);
      state.set('counter', 2);
      assert.equal(state.get('counter'), 2);
    });

    it('should not notify or update timestamp when value unchanged', () => {
      let callCount = 0;
      state.subscribe('same', () => { callCount += 1; });

      state.set('same', 1);
      const updatedAt1 = state.get('meta.updatedAt');

      state.set('same', 1);
      const updatedAt2 = state.get('meta.updatedAt');

      assert.equal(callCount, 1);
      assert.equal(updatedAt1, updatedAt2);
    });

    it('should ignore empty paths', () => {
      state.set('', 123);
      const result = state.get('');
      assert.ok(result.meta !== undefined); // still root state
    });

    it('should return undefined when traversing through non-object', () => {
      state.set('primitive', 42);
      assert.equal(state.get('primitive.nested'), undefined);
    });
  });

  describe('merge', () => {
    it('should merge objects', () => {
      state.set('config', { a: 1, b: 2 });
      state.merge('config', { b: 3, c: 4 });
      assert.deepEqual(state.get('config'), { a: 1, b: 3, c: 4 });
    });

    it('should create path if not exists', () => {
      state.merge('new.path', { x: 1 });
      assert.deepEqual(state.get('new.path'), { x: 1 });
    });

    it('should replace non-object values', () => {
      state.set('config', 123);
      state.merge('config', { ok: true });
      assert.deepEqual(state.get('config'), { ok: true });
    });

    it('should set non-object updates directly', () => {
      state.merge('config', null);
      assert.equal(state.get('config'), null);
    });

    it('should pass meta to set', () => {
      let received = null;
      state.subscribe('merged', (change) => { received = change; });
      state.merge('merged', { x: 1 }, { source: 'merge' });
      assert.equal(received.meta.source, 'merge');
    });
  });

  describe('delete', () => {
    it('should delete values', () => {
      state.set('toDelete', 'value');
      assert.equal(state.get('toDelete'), 'value');

      const result = state.delete('toDelete');
      assert.equal(result, true);
      assert.equal(state.get('toDelete'), undefined);
    });

    it('should return false for non-existent paths', () => {
      const result = state.delete('nonexistent');
      assert.equal(result, false);
    });

    it('should delete nested values', () => {
      state.set('deep.nested.value', 42);
      assert.equal(state.delete('deep.nested.value'), true);
      assert.equal(state.get('deep.nested.value'), undefined);
    });

    it('should return false when deleting with an empty path', () => {
      assert.equal(state.delete(''), false);
    });

    it('should not delete inherited properties', () => {
      state._state.protoTest = Object.create({ value: 123 });

      assert.equal(state.get('protoTest.value'), 123);
      assert.equal(state.delete('protoTest.value'), false);
      assert.equal(state.get('protoTest.value'), 123);
    });

    it('should notify change on delete with op:delete meta', () => {
      state.set('toNotify', 'value');
      let received = null;
      state.subscribe('toNotify', (change) => { received = change; });
      state.delete('toNotify');
      assert.equal(received.meta.op, 'delete');
      assert.equal(received.oldValue, 'value');
      assert.equal(received.newValue, undefined);
    });

    it('should return false when parent path is non-object', () => {
      state.set('primitive', 42);
      assert.equal(state.delete('primitive.nested'), false);
    });
  });

  describe('push', () => {
    it('should create array when missing', () => {
      state.push('items', 'a');
      assert.deepEqual(state.get('items'), ['a']);
    });

    it('should append to existing array', () => {
      state.set('items', ['a']);
      state.push('items', 'b');
      assert.deepEqual(state.get('items'), ['a', 'b']);
    });

    it('should pass meta to set', () => {
      let received = null;
      state.subscribe('pushed', (change) => { received = change; });
      state.push('pushed', 'item', { source: 'push' });
      assert.equal(received.meta.source, 'push');
    });

    it('should replace non-array with new array', () => {
      state.set('notArray', 'string');
      state.push('notArray', 'item');
      assert.deepEqual(state.get('notArray'), ['item']);
    });
  });

  describe('subscribe', () => {
    it('should notify on value change', () => {
      let received = null;
      state.subscribe('watched.value', (change) => { received = change; });

      state.set('watched.value', 'new');

      assert.equal(received.path, 'watched.value');
      assert.equal(received.newValue, 'new');
    });

    it('should support wildcard subscriptions', () => {
      let callCount = 0;
      state.subscribe('user.*', () => { callCount += 1; });

      state.set('user.name', 'Bob');
      state.set('user.age', 30);
      state.set('system.status', 'ok'); // should not trigger

      assert.equal(callCount, 2);
    });

    it('should unsubscribe correctly', () => {
      let callCount = 0;
      const unsub = state.subscribe('path', () => { callCount += 1; });

      state.set('path', 1);
      assert.equal(callCount, 1);

      unsub();
      state.set('path', 2);
      assert.equal(callCount, 1); // still 1
    });

    it('should include old and new values', () => {
      state.set('value', 'old');

      let received = null;
      state.subscribe('value', (change) => { received = change; });

      state.set('value', 'new');

      assert.equal(received.oldValue, 'old');
      assert.equal(received.newValue, 'new');
    });

    it('should support legacy subscriber signature (newValue, oldValue, path)', () => {
      state.set('legacy', 'old');
      const calls = [];
      const legacy = (newValue, oldValue, path) => {
        calls.push({ newValue, oldValue, path });
      };

      state.subscribe('legacy', legacy);
      state.set('legacy', 'new');

      assert.equal(calls.length, 1);
      assert.equal(calls[0].path, 'legacy');
      assert.equal(calls[0].oldValue, 'old');
      assert.equal(calls[0].newValue, 'new');
    });

    it('should isolate scopes via prefix matching', () => {
      let callCount = 0;
      state.subscribe('runtime.*', () => { callCount += 1; });

      state.set('runtime.tokens.input', 1);
      state.set('runtime', { iteration: 1 });
      state.set('runtimeX.tokens.input', 2);

      assert.equal(callCount, 2);
    });

    it('should support global wildcard *', () => {
      let callCount = 0;
      state.subscribe('*', () => { callCount += 1; });

      state.set('a.b', 1);
      state.set('c', 2);

      assert.equal(callCount, 2);
    });

    it('should support wildcard matching within a pattern', () => {
      const calls = [];
      state.subscribe('plugins.*.enabled', (change) => { calls.push(change.path); });

      state.set('plugins.alpha.enabled', true);
      state.set('plugins.alpha.disabled', true);
      state.set('plugins.alpha.beta.enabled', true);

      assert.equal(calls.length, 1);
      assert.equal(calls[0], 'plugins.alpha.enabled');
    });

    it('should continue notifying other subscribers when one throws', () => {
      const originalError = console.error;
      let errorCalls = 0;
      console.error = () => { errorCalls += 1; };

      let okCalls = 0;
      state.subscribe('boom', () => { throw new Error('subscriber failed'); });
      state.subscribe('boom', () => { okCalls += 1; });

      state.set('boom', 1);

      console.error = originalError;

      assert.equal(okCalls, 1);
      assert.equal(errorCalls, 1);
    });

    it('should support single-character wildcard ?', () => {
      const calls = [];
      state.subscribe('item.a?', (change) => { calls.push(change.path); });

      state.set('item.a1', 1);
      state.set('item.ab', 2);
      state.set('item.abc', 3); // should not match
      state.set('item.a', 4);   // should not match

      assert.equal(calls.length, 2);
      assert.ok(calls.includes('item.a1'));
      assert.ok(calls.includes('item.ab'));
    });

    it('should match prefix itself when pattern ends with .*', () => {
      let callCount = 0;
      state.subscribe('config.*', () => { callCount += 1; });

      state.set('config', { key: 'value' });

      assert.equal(callCount, 1);
    });
  });

  describe('change log', () => {
    it('should keep change log when enabled', () => {
      state.set('a', 1);
      state.set('b', 2);
      state.set('a', 3);

      const log = state.getChangeLog();
      assert.equal(log.length, 3);
      assert.equal(log[0].path, 'a');
      assert.equal(log[2].path, 'a');
    });

    it('should respect maxLog trimming', () => {
      const limited = new StateBus({ events, keepLog: true, maxLog: 2 });
      limited.set('a', 1);
      limited.set('b', 2);
      limited.set('c', 3);

      const log = limited.getChangeLog();
      assert.equal(log.length, 2);
      assert.equal(log[0].path, 'b');
      assert.equal(log[1].path, 'c');
    });

    it('should return last N changes', () => {
      state.set('a', 1);
      state.set('b', 2);
      state.set('c', 3);

      const log = state.getChangeLog(2);
      assert.equal(log.length, 2);
      assert.equal(log[0].path, 'b');
      assert.equal(log[1].path, 'c');
    });

    it('should return empty log when disabled', () => {
      const noLogState = new StateBus({ events, keepLog: false });
      noLogState.set('a', 1);
      assert.deepEqual(noLogState.getChangeLog(), []);
    });

    it('should include timestamp in change record', () => {
      state.set('timed', 1);
      const log = state.getChangeLog();
      assert.ok(typeof log[0].timestamp === 'number');
      assert.ok(log[0].timestamp > 0);
    });

    it('should include meta when provided', () => {
      state.set('withMeta', 1, { source: 'test' });
      const log = state.getChangeLog();
      assert.equal(log[0].meta.source, 'test');
    });

    it('should not include meta when empty', () => {
      state.set('noMeta', 1);
      const log = state.getChangeLog();
      assert.equal(log[0].meta, undefined);
    });
  });

  describe('toJSON', () => {
    it('should export state as JSON', () => {
      state.set('user.name', 'Alice');
      state.set('user.age', 25);
      state.set('config.theme', 'dark');

      const json = state.toJSON();

      assert.deepEqual(json.user, { name: 'Alice', age: 25 });
      assert.deepEqual(json.config, { theme: 'dark' });
    });

    it('should export a deep clone (mutating export does not affect state)', () => {
      state.set('user', { name: 'Alice', nested: { a: 1 } });

      const json = state.toJSON();
      json.user.name = 'Bob';
      json.user.nested.a = 2;

      assert.equal(state.get('user.name'), 'Alice');
      assert.equal(state.get('user.nested.a'), 1);
    });
  });

  describe('fromJSON', () => {
    it('should import state via fromJSON and deep clone', () => {
      const imported = { meta: { updatedAt: 1 }, nested: { a: 1 } };
      let emitted = false;
      events.on('state.imported', () => { emitted = true; });

      state.fromJSON(imported);
      assert.equal(state.get('nested.a'), 1);

      imported.nested.a = 2;
      assert.equal(state.get('nested.a'), 1);
      assert.ok(emitted);
    });

    it('should ignore non-object imports', () => {
      let emitted = false;
      events.on('state.imported', () => { emitted = true; });

      state.set('value', 1);
      state.fromJSON(null);

      assert.equal(state.get('value'), 1);
      assert.ok(!emitted);
    });

    it('should ignore undefined imports', () => {
      state.set('value', 1);
      state.fromJSON(undefined);
      assert.equal(state.get('value'), 1);
    });
  });

  describe('deepClone fallback', () => {
    it('should fall back to JSON clone when structuredClone throws', () => {
      const originalClone = globalThis.structuredClone;
      globalThis.structuredClone = () => { throw new Error('DataCloneError'); };

      try {
        state.set('when', new Date('2020-01-01T00:00:00.000Z'));
        const json = state.toJSON();
        assert.equal(json.when, '2020-01-01T00:00:00.000Z');
      } finally {
        globalThis.structuredClone = originalClone;
      }
    });

    it('should fall back to JSON clone when structuredClone is missing', () => {
      const originalClone = globalThis.structuredClone;
      globalThis.structuredClone = undefined;

      try {
        state.set('when', new Date('2020-01-01T00:00:00.000Z'));
        const json = state.toJSON();
        assert.equal(json.when, '2020-01-01T00:00:00.000Z');
      } finally {
        globalThis.structuredClone = originalClone;
      }
    });
  });

  describe('snapshot/rollback', () => {
    it('should generate snapshot id when not provided', () => {
      const id = state.snapshot();
      assert.match(id, /^snap_/);
      assert.ok(state.listSnapshots().includes(id));
    });

    it('should snapshot and rollback state', () => {
      const changes = [];
      state.subscribe('*', (change) => changes.push(change));

      state.set('value', 1);
      const snapId = state.snapshot('mySnap');
      assert.equal(snapId, 'mySnap');
      assert.deepEqual(state.listSnapshots(), ['mySnap']);

      state.set('value', 2);
      assert.equal(state.get('value'), 2);

      const ok = state.rollback('mySnap');
      assert.equal(ok, true);
      assert.equal(state.get('value'), 1);

      const rollbackChange = changes.find(c => c.meta?.rollback);
      assert.equal(rollbackChange.path, '*');
    });

    it('should throw when rolling back missing snapshot', () => {
      assert.throws(() => state.rollback('missing'), /snapshot not found/i);
    });

    it('should delete snapshot', () => {
      state.snapshot('toDelete');
      assert.equal(state.deleteSnapshot('toDelete'), true);
      assert.equal(state.deleteSnapshot('toDelete'), false);
    });

    it('should evict oldest snapshots when maxSnapshots exceeded (LRU)', () => {
      const limitedState = new StateBus({ maxSnapshots: 3 });

      limitedState.set('v', 1);
      limitedState.snapshot('snap1');
      limitedState.set('v', 2);
      limitedState.snapshot('snap2');
      limitedState.set('v', 3);
      limitedState.snapshot('snap3');

      assert.deepEqual(limitedState.listSnapshots(), ['snap1', 'snap2', 'snap3']);

      // Adding 4th should evict oldest (snap1)
      limitedState.set('v', 4);
      limitedState.snapshot('snap4');

      assert.deepEqual(limitedState.listSnapshots(), ['snap2', 'snap3', 'snap4']);
      assert.ok(!limitedState.listSnapshots().includes('snap1'));

      // Reusing existing id should not evict (updates in place)
      limitedState.set('v', 5);
      limitedState.snapshot('snap2');
      assert.deepEqual(limitedState.listSnapshots(), ['snap3', 'snap4', 'snap2']); // snap2 moved to end
    });

    it('should emit state.snapshot event', () => {
      let emitted = null;
      events.on('state.snapshot', (e) => { emitted = e.payload; });
      state.snapshot('testSnap');
      assert.equal(emitted.id, 'testSnap');
    });

    it('should emit state.rollback event', () => {
      state.set('value', 1);
      state.snapshot('rollbackTest');
      state.set('value', 2);

      let emitted = null;
      events.on('state.rollback', (e) => { emitted = e.payload; });
      state.rollback('rollbackTest');

      assert.equal(emitted.id, 'rollbackTest');
      assert.ok(emitted.oldState !== undefined);
    });

    it('should deep clone snapshot data', () => {
      state.set('nested', { a: 1 });
      state.snapshot('cloneTest');
      state.set('nested.a', 2);

      state.rollback('cloneTest');
      assert.equal(state.get('nested.a'), 1);
    });
  });

  describe('reset', () => {
    it('should reset state to defaults', () => {
      let emitted = false;
      events.on('state.reset', () => { emitted = true; });

      state.set('user.name', 'Alice');
      state.reset();

      assert.equal(state.get('user'), undefined);
      assert.equal(state.get('runtime.iteration'), 0);
      assert.ok(emitted);
    });

    it('should preserve default structure after reset', () => {
      state.reset();
      const root = state.get();
      assert.ok(root.meta !== undefined);
      assert.ok(root.runtime !== undefined);
      assert.ok(root.input !== undefined);
      assert.ok(root.context !== undefined);
      assert.ok(root.stages !== undefined);
      assert.ok(root.plugins !== undefined);
    });
  });

  describe('without EventBus', () => {
    it('should work without EventBus', () => {
      const noEvents = new StateBus({ keepLog: true });
      noEvents.set('value', 1);
      assert.equal(noEvents.get('value'), 1);
    });

    it('should not throw when emitting without EventBus', () => {
      const noEvents = new StateBus();
      noEvents.set('value', 1);
      noEvents.snapshot('test');
      noEvents.rollback('test');
      noEvents.reset();
      assert.ok(true); // no errors thrown
    });
  });

  describe('integration with EventBus', () => {
    it('should emit state.changed event', () => {
      let received = null;
      events.on('state.changed', (e) => { received = e.payload; });

      state.set('tracked', 'value');

      assert.equal(received.path, 'tracked');
      assert.equal(received.newValue, 'value');
    });

    it('should emit legacy alias state.change with meta spread', () => {
      let received = null;
      events.on('state.change', (e) => { received = e.payload; });

      state.set('tracked', 'value', { source: 'test' });

      assert.equal(received.path, 'tracked');
      assert.equal(received.source, 'test');
    });

    it('should emit state.change even when meta is not provided', () => {
      let received = null;
      events.on('state.change', (e) => { received = e.payload; });

      state._notifyChange('manual', 1, 0);

      assert.deepEqual(received, {
        path: 'manual',
        newValue: 1,
        oldValue: 0,
      });
    });
  });

  describe('path matching edge cases', () => {
    it('should not match different segment counts', () => {
      let callCount = 0;
      state.subscribe('a.*.c', () => { callCount += 1; });

      state.set('a.b.c', 1);     // 3 segments - matches
      state.set('a.b.c.d', 2);   // 4 segments - no match
      state.set('a.c', 3);       // 2 segments - no match

      assert.equal(callCount, 1);
    });

    it('should match complex wildcards in prefix', () => {
      let callCount = 0;
      state.subscribe('a.b*.*', () => { callCount += 1; });

      state.set('a.bx.c', 1);
      state.set('a.by.d.e', 2);  // 4 segments, prefix matches 2 segments

      assert.equal(callCount, 2);
    });

    it('should handle patterns without wildcards', () => {
      let callCount = 0;
      state.subscribe('exact.path', () => { callCount += 1; });

      state.set('exact.path', 1);
      state.set('exact.path.nested', 2);
      state.set('exact', 3);

      assert.equal(callCount, 1);
    });

    it('should handle asterisk in middle segment', () => {
      let callCount = 0;
      state.subscribe('a.*.c', () => { callCount += 1; });

      state.set('a.x.c', 1);
      state.set('a.y.c', 2);
      state.set('a.z.d', 3);

      assert.equal(callCount, 2);
    });
  });

  describe('constructor options', () => {
    it('should use default maxSnapshots when not provided', () => {
      const bus = new StateBus();
      // Create more than default (50) snapshots
      for (let i = 0; i < 55; i++) {
        bus.snapshot(`snap${i}`);
      }
      assert.equal(bus.listSnapshots().length, 50);
    });

    it('should use default maxLog when not provided', () => {
      const bus = new StateBus({ keepLog: true });
      // Default maxLog is 500
      for (let i = 0; i < 510; i++) {
        bus.set('counter', i);
      }
      assert.equal(bus.getChangeLog(1000).length, 500);
    });
  });
});
