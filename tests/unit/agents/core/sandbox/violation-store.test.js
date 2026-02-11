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
});
