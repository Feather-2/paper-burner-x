/**
 * StateBus 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateBus, EventBus } from '../../../js/agents/core/index.js';

describe('StateBus', () => {
  let state;
  let events;

  beforeEach(() => {
    events = new EventBus();
    state = new StateBus({ events, keepLog: true });
  });

  afterEach(() => {
    events.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('get/set', () => {
    it('should return full state when no path provided', () => {
      const root = state.get();
      expect(root).toHaveProperty('meta');
      expect(root).toHaveProperty('runtime');
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
      expect(state.get('nonexistent.path')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      state.set('counter', 1);
      state.set('counter', 2);
      expect(state.get('counter')).toBe(2);
    });

    it('should not notify or update timestamp when value unchanged', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

      const callback = vi.fn();
      state.subscribe('same', callback);

      state.set('same', 1);
      const updatedAt1 = state.get('meta.updatedAt');

      vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
      state.set('same', 1);
      const updatedAt2 = state.get('meta.updatedAt');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(updatedAt1).toBe(updatedAt2);
    });

    it('should ignore empty paths', () => {
      state.set('', 123);
      expect(state.get('')).toHaveProperty('meta'); // still root state
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
      expect(state.get('config')).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete values', () => {
      state.set('toDelete', 'value');
      expect(state.get('toDelete')).toBe('value');

      const result = state.delete('toDelete');
      expect(result).toBe(true);
      expect(state.get('toDelete')).toBeUndefined();
    });

    it('should return false for non-existent paths', () => {
      const result = state.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete nested values', () => {
      state.set('deep.nested.value', 42);
      expect(state.delete('deep.nested.value')).toBe(true);
      expect(state.get('deep.nested.value')).toBeUndefined();
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
  });

  describe('subscribe', () => {
    it('should notify on value change', () => {
      const callback = vi.fn();
      state.subscribe('watched.value', callback);

      state.set('watched.value', 'new');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].path).toBe('watched.value');
      expect(callback.mock.calls[0][0].newValue).toBe('new');
    });

    it('should support wildcard subscriptions', () => {
      const callback = vi.fn();
      state.subscribe('user.*', callback);

      state.set('user.name', 'Bob');
      state.set('user.age', 30);
      state.set('system.status', 'ok'); // should not trigger

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', () => {
      const callback = vi.fn();
      const unsub = state.subscribe('path', callback);

      state.set('path', 1);
      expect(callback).toHaveBeenCalledTimes(1);

      unsub();
      state.set('path', 2);
      expect(callback).toHaveBeenCalledTimes(1); // still 1
    });

    it('should include old and new values', () => {
      state.set('value', 'old');

      const callback = vi.fn();
      state.subscribe('value', callback);

      state.set('value', 'new');

      expect(callback.mock.calls[0][0].oldValue).toBe('old');
      expect(callback.mock.calls[0][0].newValue).toBe('new');
    });

    it('should support legacy subscriber signature (newValue, oldValue, path)', () => {
      state.set('legacy', 'old');
      const legacy = vi.fn((newValue, oldValue, path) => {
        expect(path).toBe('legacy');
        expect(oldValue).toBe('old');
        expect(newValue).toBe('new');
      });

      state.subscribe('legacy', legacy);
      state.set('legacy', 'new');

      expect(legacy).toHaveBeenCalledTimes(1);
      expect(legacy).toHaveBeenCalledWith('new', 'old', 'legacy');
    });

    it('should isolate scopes via prefix matching', () => {
      const callback = vi.fn();
      state.subscribe('runtime.*', callback);

      state.set('runtime.tokens.input', 1);
      state.set('runtime', { iteration: 1 });
      state.set('runtimeX.tokens.input', 2);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should support global wildcard *', () => {
      const callback = vi.fn();
      state.subscribe('*', callback);

      state.set('a.b', 1);
      state.set('c', 2);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should support wildcard matching within a pattern', () => {
      const callback = vi.fn();
      state.subscribe('plugins.*.enabled', callback);

      state.set('plugins.alpha.enabled', true);
      state.set('plugins.alpha.disabled', true);
      state.set('plugins.alpha.beta.enabled', true);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].path).toBe('plugins.alpha.enabled');
    });

    it('should continue notifying other subscribers when one throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ok = vi.fn();

      state.subscribe('boom', () => { throw new Error('subscriber failed'); });
      state.subscribe('boom', ok);

      state.set('boom', 1);

      expect(ok).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
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
  });

  describe('import/reset', () => {
    it('should import state via fromJSON and deep clone', () => {
      const imported = { meta: { updatedAt: 1 }, nested: { a: 1 } };
      const handler = vi.fn();
      events.on('state.imported', handler);

      state.fromJSON(imported);
      expect(state.get('nested.a')).toBe(1);

      imported.nested.a = 2;
      expect(state.get('nested.a')).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should ignore non-object imports', () => {
      const handler = vi.fn();
      events.on('state.imported', handler);

      state.set('value', 1);
      state.fromJSON(null);

      expect(state.get('value')).toBe(1);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should work without EventBus', () => {
      const noEvents = new StateBus({ keepLog: true });
      noEvents.set('value', 1);
      expect(noEvents.get('value')).toBe(1);
    });

    it('should reset state to defaults', () => {
      const handler = vi.fn();
      events.on('state.reset', handler);

      state.set('user.name', 'Alice');
      state.reset();

      expect(state.get('user')).toBeUndefined();
      expect(state.get('runtime.iteration')).toBe(0);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('integration with EventBus', () => {
    it('should emit state change events', async () => {
      const handler = vi.fn();
      events.on('state.changed', handler);

      state.set('tracked', 'value');

      // Wait for async emit
      await new Promise(r => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
    });

    it('should emit legacy alias state.change with meta spread', () => {
      const handler = vi.fn();
      events.on('state.change', handler);

      state.set('tracked', 'value', { source: 'test' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].payload.path).toBe('tracked');
      expect(handler.mock.calls[0][0].payload.source).toBe('test');
    });

    it('should emit state.change even when meta is not provided', () => {
      const handler = vi.fn();
      events.on('state.change', handler);

      state._notifyChange('manual', 1, 0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].payload).toEqual({
        path: 'manual',
        newValue: 1,
        oldValue: 0,
      });
    });
  });
});
