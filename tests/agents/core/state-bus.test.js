/**
 * StateBus 测试
 * 使用 node:test + node:assert/strict
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
      expect(root.meta !== undefined).toBeTruthy();
      expect(root.runtime !== undefined).toBeTruthy();
    });

    it('should set and get values', () => {
      state.set('user.name', 'Alice');
      expect(state.get('user.name')).toBe('Alice');
    });

    it('should support nested paths', () => {
      state.set('deep.nested.value', 42);
      expect(state.get('deep.nested.value')).toBe(42);
      expect(state.get('deep.nested')).toEqual({ value: 42 });
      expect(state.get('deep')).toEqual({ nested: { value: 42 } });
    });

    it('should return undefined for missing paths', () => {
      expect(state.get('nonexistent.path')).toBe(undefined);
    });

    it('should overwrite existing values', () => {
      state.set('counter', 1);
      state.set('counter', 2);
      expect(state.get('counter')).toBe(2);
    });

    it('should not notify or update timestamp when value unchanged', () => {
      let callCount = 0;
      state.subscribe('same', () => { callCount += 1; });

      state.set('same', 1);
      const updatedAt1 = state.get('meta.updatedAt');

      state.set('same', 1);
      const updatedAt2 = state.get('meta.updatedAt');

      expect(callCount).toBe(1);
      expect(updatedAt1).toBe(updatedAt2);
    });

    it('should ignore empty paths', () => {
      state.set('', 123);
      const result = state.get('');
      expect(result.meta !== undefined).toBeTruthy(); // still root state
    });

    it('should return undefined when traversing through non-object', () => {
      state.set('primitive', 42);
      expect(state.get('primitive.nested')).toBe(undefined);
    });
  });

  describe('merge', () => {
    it('should merge objects', () => {
      state.set('config', { a: 1, b: 2 });
      state.merge('config', { b: 3, c: 4 });
      expect(state.get('config')).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should create path if not exists', () => {
      state.merge('new.path', { x: 1 });
      expect(state.get('new.path')).toEqual({ x: 1 });
    });

    it('should replace non-object values', () => {
      state.set('config', 123);
      state.merge('config', { ok: true });
      expect(state.get('config')).toEqual({ ok: true });
    });

    it('should set non-object updates directly', () => {
      state.merge('config', null);
      expect(state.get('config')).toBe(null);
    });

    it('should pass meta to set', () => {
      let received = null;
      state.subscribe('merged', (change) => { received = change; });
      state.merge('merged', { x: 1 }, { source: 'merge' });
      expect(received.meta.source).toBe('merge');
    });
  });

  describe('delete', () => {
    it('should delete values', () => {
      state.set('toDelete', 'value');
      expect(state.get('toDelete')).toBe('value');

      const result = state.delete('toDelete');
      expect(result).toBe(true);
      expect(state.get('toDelete')).toBe(undefined);
    });

    it('should return false for non-existent paths', () => {
      const result = state.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete nested values', () => {
      state.set('deep.nested.value', 42);
      expect(state.delete('deep.nested.value')).toBe(true);
      expect(state.get('deep.nested.value')).toBe(undefined);
    });

    it('should return false when deleting with an empty path', () => {
      expect(state.delete('')).toBe(false);
    });

    it('should not delete inherited properties', () => {
      state._state.protoTest = Object.create({ value: 123 });

      expect(state.get('protoTest.value')).toBe(123);
      expect(state.delete('protoTest.value')).toBe(false);
      expect(state.get('protoTest.value')).toBe(123);
    });

    it('should notify change on delete with op:delete meta', () => {
      state.set('toNotify', 'value');
      let received = null;
      state.subscribe('toNotify', (change) => { received = change; });
      state.delete('toNotify');
      expect(received.meta.op).toBe('delete');
      expect(received.oldValue).toBe('value');
      expect(received.newValue).toBe(undefined);
    });

    it('should return false when parent path is non-object', () => {
      state.set('primitive', 42);
      expect(state.delete('primitive.nested')).toBe(false);
    });
  });

  describe('push', () => {
    it('should create array when missing', () => {
      state.push('items', 'a');
      expect(state.get('items')).toEqual(['a']);
    });

    it('should append to existing array', () => {
      state.set('items', ['a']);
      state.push('items', 'b');
      expect(state.get('items')).toEqual(['a', 'b']);
    });

    it('should pass meta to set', () => {
      let received = null;
      state.subscribe('pushed', (change) => { received = change; });
      state.push('pushed', 'item', { source: 'push' });
      expect(received.meta.source).toBe('push');
    });

    it('should replace non-array with new array', () => {
      state.set('notArray', 'string');
      state.push('notArray', 'item');
      expect(state.get('notArray')).toEqual(['item']);
    });
  });

  describe('subscribe', () => {
    it('should notify on value change', () => {
      let received = null;
      state.subscribe('watched.value', (change) => { received = change; });

      state.set('watched.value', 'new');

      expect(received.path).toBe('watched.value');
      expect(received.newValue).toBe('new');
    });

    it('should support wildcard subscriptions', () => {
      let callCount = 0;
      state.subscribe('user.*', () => { callCount += 1; });

      state.set('user.name', 'Bob');
      state.set('user.age', 30);
      state.set('system.status', 'ok'); // should not trigger

      expect(callCount).toBe(2);
    });

    it('should unsubscribe correctly', () => {
      let callCount = 0;
      const unsub = state.subscribe('path', () => { callCount += 1; });

      state.set('path', 1);
      expect(callCount).toBe(1);

      unsub();
      state.set('path', 2);
      expect(callCount).toBe(1); // still 1
    });

    it('should include old and new values', () => {
      state.set('value', 'old');

      let received = null;
      state.subscribe('value', (change) => { received = change; });

      state.set('value', 'new');

      expect(received.oldValue).toBe('old');
      expect(received.newValue).toBe('new');
    });

    it('should support legacy subscriber signature (newValue, oldValue, path)', () => {
      state.set('legacy', 'old');
      const calls = [];
      const legacy = (newValue, oldValue, path) => {
        calls.push({ newValue, oldValue, path });
      };

      state.subscribe('legacy', legacy);
      state.set('legacy', 'new');

      expect(calls.length).toBe(1);
      expect(calls[0].path).toBe('legacy');
      expect(calls[0].oldValue).toBe('old');
      expect(calls[0].newValue).toBe('new');
    });

    it('should isolate scopes via prefix matching', () => {
      let callCount = 0;
      state.subscribe('runtime.*', () => { callCount += 1; });

      state.set('runtime.tokens.input', 1);
      state.set('runtime', { iteration: 1 });
      state.set('runtimeX.tokens.input', 2);

      expect(callCount).toBe(2);
    });

    it('should support global wildcard *', () => {
      let callCount = 0;
      state.subscribe('*', () => { callCount += 1; });

      state.set('a.b', 1);
      state.set('c', 2);

      expect(callCount).toBe(2);
    });

    it('should support wildcard matching within a pattern', () => {
      const calls = [];
      state.subscribe('plugins.*.enabled', (change) => { calls.push(change.path); });

      state.set('plugins.alpha.enabled', true);
      state.set('plugins.alpha.disabled', true);
      state.set('plugins.alpha.beta.enabled', true);

      expect(calls.length).toBe(1);
      expect(calls[0]).toBe('plugins.alpha.enabled');
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

      expect(okCalls).toBe(1);
      expect(errorCalls).toBe(1);
    });

    it('should support single-character wildcard ?', () => {
      const calls = [];
      state.subscribe('item.a?', (change) => { calls.push(change.path); });

      state.set('item.a1', 1);
      state.set('item.ab', 2);
      state.set('item.abc', 3); // should not match
      state.set('item.a', 4);   // should not match

      expect(calls.length).toBe(2);
      expect(calls.includes('item.a1')).toBeTruthy();
      expect(calls.includes('item.ab')).toBeTruthy();
    });

    it('should match prefix itself when pattern ends with .*', () => {
      let callCount = 0;
      state.subscribe('config.*', () => { callCount += 1; });

      state.set('config', { key: 'value' });

      expect(callCount).toBe(1);
    });
  });

  describe('change log', () => {
    it('should keep change log when enabled', () => {
      state.set('a', 1);
      state.set('b', 2);
      state.set('a', 3);

      const log = state.getChangeLog();
      expect(log.length).toBe(3);
      expect(log[0].path).toBe('a');
      expect(log[2].path).toBe('a');
    });

    it('should respect maxLog trimming', () => {
      const limited = new StateBus({ events, keepLog: true, maxLog: 2 });
      limited.set('a', 1);
      limited.set('b', 2);
      limited.set('c', 3);

      const log = limited.getChangeLog();
      expect(log.length).toBe(2);
      expect(log[0].path).toBe('b');
      expect(log[1].path).toBe('c');
    });

    it('should return last N changes', () => {
      state.set('a', 1);
      state.set('b', 2);
      state.set('c', 3);

      const log = state.getChangeLog(2);
      expect(log.length).toBe(2);
      expect(log[0].path).toBe('b');
      expect(log[1].path).toBe('c');
    });

    it('should return empty log when disabled', () => {
      const noLogState = new StateBus({ events, keepLog: false });
      noLogState.set('a', 1);
      expect(noLogState.getChangeLog()).toEqual([]);
    });

    it('should include timestamp in change record', () => {
      state.set('timed', 1);
      const log = state.getChangeLog();
      expect(typeof log[0].timestamp === 'number').toBeTruthy();
      expect(log[0].timestamp > 0).toBeTruthy();
    });

    it('should include meta when provided', () => {
      state.set('withMeta', 1, { source: 'test' });
      const log = state.getChangeLog();
      expect(log[0].meta.source).toBe('test');
    });

    it('should not include meta when empty', () => {
      state.set('noMeta', 1);
      const log = state.getChangeLog();
      expect(log[0].meta).toBe(undefined);
    });
  });

  describe('toJSON', () => {
    it('should export state as JSON', () => {
      state.set('user.name', 'Alice');
      state.set('user.age', 25);
      state.set('config.theme', 'dark');

      const json = state.toJSON();

      expect(json.user).toEqual({ name: 'Alice', age: 25 });
      expect(json.config).toEqual({ theme: 'dark' });
    });

    it('should export a deep clone (mutating export does not affect state)', () => {
      state.set('user', { name: 'Alice', nested: { a: 1 } });

      const json = state.toJSON();
      json.user.name = 'Bob';
      json.user.nested.a = 2;

      expect(state.get('user.name')).toBe('Alice');
      expect(state.get('user.nested.a')).toBe(1);
    });
  });

  describe('fromJSON', () => {
    it('should import state via fromJSON and deep clone', () => {
      const imported = { meta: { updatedAt: 1 }, nested: { a: 1 } };
      let emitted = false;
      events.on('state.imported', () => { emitted = true; });

      state.fromJSON(imported);
      expect(state.get('nested.a')).toBe(1);

      imported.nested.a = 2;
      expect(state.get('nested.a')).toBe(1);
      expect(emitted).toBeTruthy();
    });

    it('should ignore non-object imports', () => {
      let emitted = false;
      events.on('state.imported', () => { emitted = true; });

      state.set('value', 1);
      state.fromJSON(null);

      expect(state.get('value')).toBe(1);
      expect(!emitted).toBeTruthy();
    });

    it('should ignore undefined imports', () => {
      state.set('value', 1);
      state.fromJSON(undefined);
      expect(state.get('value')).toBe(1);
    });
  });

  describe('deepClone fallback', () => {
    it('should fall back to JSON clone when structuredClone throws', () => {
      const originalClone = globalThis.structuredClone;
      globalThis.structuredClone = () => { throw new Error('DataCloneError'); };

      try {
        state.set('when', new Date('2020-01-01T00:00:00.000Z'));
        const json = state.toJSON();
        expect(json.when).toBe('2020-01-01T00:00:00.000Z');
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
        expect(json.when).toBe('2020-01-01T00:00:00.000Z');
      } finally {
        globalThis.structuredClone = originalClone;
      }
    });
  });

  describe('snapshot/rollback', () => {
    it('should generate snapshot id when not provided', () => {
      const id = state.snapshot();
      expect(id).toMatch(/^snap_/);
      expect(state.listSnapshots()).toContain(id);
    });

    it('should snapshot and rollback state', () => {
      const changes = [];
      state.subscribe('*', (change) => changes.push(change));

      state.set('value', 1);
      const snapId = state.snapshot('mySnap');
      expect(snapId).toBe('mySnap');
      expect(state.listSnapshots()).toEqual(['mySnap']);

      state.set('value', 2);
      expect(state.get('value')).toBe(2);

      const ok = state.rollback('mySnap');
      expect(ok).toBe(true);
      expect(state.get('value')).toBe(1);

      const rollbackChange = changes.find(c => c.meta?.rollback);
      expect(rollbackChange.path).toBe('*');
    });

    it('should throw when rolling back missing snapshot', () => {
      expect(() => state.rollback('missing')).toThrow(/snapshot not found/i);
    });

    it('should delete snapshot', () => {
      state.snapshot('toDelete');
      expect(state.deleteSnapshot('toDelete')).toBe(true);
      expect(state.deleteSnapshot('toDelete')).toBe(false);
    });

    it('should evict oldest snapshots when maxSnapshots exceeded (LRU)', () => {
      const limitedState = new StateBus({ maxSnapshots: 3 });

      limitedState.set('v', 1);
      limitedState.snapshot('snap1');
      limitedState.set('v', 2);
      limitedState.snapshot('snap2');
      limitedState.set('v', 3);
      limitedState.snapshot('snap3');

      expect(limitedState.listSnapshots()).toEqual(['snap1', 'snap2', 'snap3']);

      // Adding 4th should evict oldest (snap1)
      limitedState.set('v', 4);
      limitedState.snapshot('snap4');

      expect(limitedState.listSnapshots()).toEqual(['snap2', 'snap3', 'snap4']);
      expect(limitedState.listSnapshots().includes('snap1')).toBe(false);

      // Reusing existing id should not evict (updates in place)
      limitedState.set('v', 5);
      limitedState.snapshot('snap2');
      expect(limitedState.listSnapshots()).toEqual(['snap3', 'snap4', 'snap2']); // snap2 moved to end
    });

    it('should emit state.snapshot event', () => {
      let emitted = null;
      events.on('state.snapshot', (e) => { emitted = e.payload; });
      state.snapshot('testSnap');
      expect(emitted.id).toBe('testSnap');
    });

    it('should emit state.rollback event', () => {
      state.set('value', 1);
      state.snapshot('rollbackTest');
      state.set('value', 2);

      let emitted = null;
      events.on('state.rollback', (e) => { emitted = e.payload; });
      state.rollback('rollbackTest');

      expect(emitted.id).toBe('rollbackTest');
      expect(emitted.oldState !== undefined).toBeTruthy();
    });

    it('should deep clone snapshot data', () => {
      state.set('nested', { a: 1 });
      state.snapshot('cloneTest');
      state.set('nested.a', 2);

      state.rollback('cloneTest');
      expect(state.get('nested.a')).toBe(1);
    });
  });

  describe('reset', () => {
    it('should reset state to defaults', () => {
      let emitted = false;
      events.on('state.reset', () => { emitted = true; });

      state.set('user.name', 'Alice');
      state.reset();

      expect(state.get('user')).toBe(undefined);
      expect(state.get('runtime.iteration')).toBe(0);
      expect(emitted).toBeTruthy();
    });

    it('should preserve default structure after reset', () => {
      state.reset();
      const root = state.get();
      expect(root.meta !== undefined).toBeTruthy();
      expect(root.runtime !== undefined).toBeTruthy();
      expect(root.input !== undefined).toBeTruthy();
      expect(root.context !== undefined).toBeTruthy();
      expect(root.stages !== undefined).toBeTruthy();
      expect(root.plugins !== undefined).toBeTruthy();
    });
  });

  describe('without EventBus', () => {
    it('should work without EventBus', () => {
      const noEvents = new StateBus({ keepLog: true });
      noEvents.set('value', 1);
      expect(noEvents.get('value')).toBe(1);
    });

    it('should not throw when emitting without EventBus', () => {
      const noEvents = new StateBus();
      noEvents.set('value', 1);
      noEvents.snapshot('test');
      noEvents.rollback('test');
      noEvents.reset();
      expect(true).toBeTruthy(); // no errors thrown
    });
  });

  describe('integration with EventBus', () => {
    it('should emit state.changed event', () => {
      let received = null;
      events.on('state.changed', (e) => { received = e.payload; });

      state.set('tracked', 'value');

      expect(received.path).toBe('tracked');
      expect(received.newValue).toBe('value');
    });

    it('should emit legacy alias state.change with meta spread', () => {
      let received = null;
      events.on('state.change', (e) => { received = e.payload; });

      state.set('tracked', 'value', { source: 'test' });

      expect(received.path).toBe('tracked');
      expect(received.source).toBe('test');
    });

    it('should emit state.change even when meta is not provided', () => {
      let received = null;
      events.on('state.change', (e) => { received = e.payload; });

      state._notifyChange('manual', 1, 0);

      expect(received).toEqual({
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

      expect(callCount).toBe(1);
    });

    it('should match complex wildcards in prefix', () => {
      let callCount = 0;
      state.subscribe('a.b*.*', () => { callCount += 1; });

      state.set('a.bx.c', 1);
      state.set('a.by.d.e', 2);  // 4 segments, prefix matches 2 segments

      expect(callCount).toBe(2);
    });

    it('should handle patterns without wildcards', () => {
      let callCount = 0;
      state.subscribe('exact.path', () => { callCount += 1; });

      state.set('exact.path', 1);
      state.set('exact.path.nested', 2);
      state.set('exact', 3);

      expect(callCount).toBe(1);
    });

    it('should handle asterisk in middle segment', () => {
      let callCount = 0;
      state.subscribe('a.*.c', () => { callCount += 1; });

      state.set('a.x.c', 1);
      state.set('a.y.c', 2);
      state.set('a.z.d', 3);

      expect(callCount).toBe(2);
    });
  });

  describe('constructor options', () => {
    it('should use default maxSnapshots when not provided', () => {
      const bus = new StateBus();
      // Create more than default (50) snapshots
      for (let i = 0; i < 55; i++) {
        bus.snapshot(`snap${i}`);
      }
      expect(bus.listSnapshots().length).toBe(50);
    });

    it('should use default maxLog when not provided', () => {
      const bus = new StateBus({ keepLog: true });
      // Default maxLog is 500
      for (let i = 0; i < 510; i++) {
        bus.set('counter', i);
      }
      expect(bus.getChangeLog(1000).length).toBe(500);
    });
  });
});
