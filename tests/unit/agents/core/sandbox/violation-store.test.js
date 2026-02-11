import { describe, it, expect, vi } from 'vitest';
import { ViolationStore, createViolationStore } from '../../../../../js/agents/core/sandbox/violation-store.js';

describe('ViolationStore', () => {
  it('records violations', () => {
    const store = new ViolationStore();
    store.add({ type: 'network', detail: 'blocked evil.com' });
    expect(store.size).toBe(1);
    expect(store.getAll()[0].type).toBe('network');
    expect(store.getAll()[0].detail).toBe('blocked evil.com');
  });

  it('auto-sets timestamp', () => {
    const store = new ViolationStore();
    store.add({ type: 'fs:write', detail: 'denied /etc/passwd' });
    expect(store.getAll()[0].timestamp).toBeGreaterThan(0);
  });

  it('preserves provided timestamp', () => {
    const store = new ViolationStore();
    store.add({ type: 'exec', detail: 'blocked exec', timestamp: 12345 });
    expect(store.getAll()[0].timestamp).toBe(12345);
  });

  it('ring buffer caps at maxEntries', () => {
    const store = new ViolationStore({ maxEntries: 3 });
    store.add({ type: 'network', detail: 'a' });
    store.add({ type: 'network', detail: 'b' });
    store.add({ type: 'network', detail: 'c' });
    store.add({ type: 'network', detail: 'd' });
    expect(store.size).toBe(3);
    expect(store.getAll()[0].detail).toBe('b');
    expect(store.getAll()[2].detail).toBe('d');
  });

  it('getByType filters violations', () => {
    const store = new ViolationStore();
    store.add({ type: 'network', detail: 'net1' });
    store.add({ type: 'fs:write', detail: 'fs1' });
    store.add({ type: 'network', detail: 'net2' });
    expect(store.getByType('network')).toHaveLength(2);
    expect(store.getByType('fs:write')).toHaveLength(1);
    expect(store.getByType('exec')).toHaveLength(0);
  });

  it('subscribe notifies on new violations', () => {
    const store = new ViolationStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.add({ type: 'network', detail: 'test' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].detail).toBe('test');
  });

  it('unsubscribe stops notifications', () => {
    const store = new ViolationStore();
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    unsub();
    store.add({ type: 'network', detail: 'after unsub' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('subscriber errors are swallowed', () => {
    const store = new ViolationStore();
    store.subscribe(() => { throw new Error('boom'); });
    const fn = vi.fn();
    store.subscribe(fn);
    store.add({ type: 'network', detail: 'ok' });
    expect(fn).toHaveBeenCalled();
  });

  it('clear removes all entries', () => {
    const store = new ViolationStore();
    store.add({ type: 'network', detail: 'a' });
    store.add({ type: 'network', detail: 'b' });
    store.clear();
    expect(store.size).toBe(0);
    expect(store.getAll()).toEqual([]);
  });

  it('getAll returns a copy', () => {
    const store = new ViolationStore();
    store.add({ type: 'network', detail: 'a' });
    const copy = store.getAll();
    copy.push({ type: 'exec', detail: 'injected', timestamp: 0 });
    expect(store.size).toBe(1);
  });

  it('createViolationStore factory works', () => {
    const store = createViolationStore({ maxEntries: 5 });
    expect(store).toBeInstanceOf(ViolationStore);
    expect(store._max).toBe(5);
  });

  it('stores meta field', () => {
    const store = new ViolationStore();
    store.add({ type: 'network', detail: 'blocked', meta: { url: 'http://evil.com', method: 'GET' } });
    expect(store.getAll()[0].meta).toEqual({ url: 'http://evil.com', method: 'GET' });
  });

  describe('totalCount', () => {
    it('tracks total violations added', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'a' });
      store.add({ type: 'network', detail: 'b' });
      expect(store.totalCount).toBe(2);
    });

    it('keeps counting after ring buffer eviction', () => {
      const store = new ViolationStore({ maxEntries: 2 });
      store.add({ type: 'network', detail: 'a' });
      store.add({ type: 'network', detail: 'b' });
      store.add({ type: 'network', detail: 'c' });
      expect(store.size).toBe(2);
      expect(store.totalCount).toBe(3);
    });

    it('is not reset by clear()', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'a' });
      store.add({ type: 'network', detail: 'b' });
      store.clear();
      expect(store.size).toBe(0);
      expect(store.totalCount).toBe(2);
    });

    it('starts at zero', () => {
      const store = new ViolationStore();
      expect(store.totalCount).toBe(0);
    });
  });

  describe('subscribe emitExisting', () => {
    it('emits existing entries when emitExisting is true', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'a' });
      store.add({ type: 'fs:write', detail: 'b' });
      const fn = vi.fn();
      store.subscribe(fn, { emitExisting: true });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[0][0].detail).toBe('a');
      expect(fn.mock.calls[1][0].detail).toBe('b');
    });

    it('does not emit existing when emitExisting is false', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'a' });
      const fn = vi.fn();
      store.subscribe(fn, { emitExisting: false });
      expect(fn).not.toHaveBeenCalled();
    });

    it('does not emit existing when no options given (backward compat)', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'a' });
      const fn = vi.fn();
      store.subscribe(fn);
      expect(fn).not.toHaveBeenCalled();
    });

    it('still receives future violations after emitExisting', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'old' });
      const fn = vi.fn();
      store.subscribe(fn, { emitExisting: true });
      expect(fn).toHaveBeenCalledTimes(1);
      store.add({ type: 'network', detail: 'new' });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[1][0].detail).toBe('new');
    });

    it('swallows errors during emitExisting replay', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'a' });
      store.add({ type: 'network', detail: 'b' });
      const bad = vi.fn(() => { throw new Error('boom'); });
      expect(() => store.subscribe(bad, { emitExisting: true })).not.toThrow();
      expect(bad).toHaveBeenCalledTimes(2);
    });
  });

  describe('getByCommand', () => {
    it('filters by meta.encodedCommand', () => {
      const store = new ViolationStore();
      store.add({ type: 'exec', detail: 'cmd1', meta: { encodedCommand: 'abc' } });
      store.add({ type: 'exec', detail: 'cmd2', meta: { encodedCommand: 'def' } });
      store.add({ type: 'exec', detail: 'cmd3', meta: { encodedCommand: 'abc' } });
      const results = store.getByCommand('abc');
      expect(results).toHaveLength(2);
      expect(results[0].detail).toBe('cmd1');
      expect(results[1].detail).toBe('cmd3');
    });

    it('returns empty array when no match', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'x', meta: { encodedCommand: 'abc' } });
      expect(store.getByCommand('zzz')).toEqual([]);
    });

    it('handles entries without meta', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'no meta' });
      store.add({ type: 'exec', detail: 'has meta', meta: { encodedCommand: 'abc' } });
      expect(store.getByCommand('abc')).toHaveLength(1);
    });

    it('handles entries with meta but no encodedCommand', () => {
      const store = new ViolationStore();
      store.add({ type: 'network', detail: 'other meta', meta: { url: 'http://x.com' } });
      expect(store.getByCommand('abc')).toEqual([]);
    });
  });
});
