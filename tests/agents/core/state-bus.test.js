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
  });

  describe('get/set', () => {
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

  describe('integration with EventBus', () => {
    it('should emit state change events', async () => {
      const handler = vi.fn();
      events.on('state.changed', handler);

      state.set('tracked', 'value');

      // Wait for async emit
      await new Promise(r => setTimeout(r, 10));

      expect(handler).toHaveBeenCalled();
    });
  });
});
