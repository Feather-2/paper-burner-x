import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../../../../../js/agents/core/sandbox/shims/events.js';

describe('EventEmitter shim', () => {
  it('on + emit basic functionality', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.on('test', fn);
    ee.emit('test', 'a', 'b');
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });

  it('off removes listener', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.on('test', fn);
    ee.off('test', fn);
    ee.emit('test');
    expect(fn).not.toHaveBeenCalled();
  });

  it('once fires only once', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.once('test', fn);
    ee.emit('test');
    ee.emit('test');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('emit returns true when listeners exist', () => {
    const ee = new EventEmitter();
    ee.on('test', () => {});
    expect(ee.emit('test')).toBe(true);
  });

  it('emit returns false when no listeners', () => {
    const ee = new EventEmitter();
    expect(ee.emit('test')).toBe(false);
  });

  it('removeAllListeners clears specific event', () => {
    const ee = new EventEmitter();
    ee.on('a', () => {});
    ee.on('b', () => {});
    ee.removeAllListeners('a');
    expect(ee.listenerCount('a')).toBe(0);
    expect(ee.listenerCount('b')).toBe(1);
  });

  it('removeAllListeners clears all events', () => {
    const ee = new EventEmitter();
    ee.on('a', () => {});
    ee.on('b', () => {});
    ee.removeAllListeners();
    expect(ee.eventNames()).toEqual([]);
  });

  it('listeners returns a copy', () => {
    const ee = new EventEmitter();
    const fn = () => {};
    ee.on('test', fn);
    const list = ee.listeners('test');
    list.pop();
    expect(ee.listenerCount('test')).toBe(1);
  });

  it('listenerCount', () => {
    const ee = new EventEmitter();
    ee.on('test', () => {});
    ee.on('test', () => {});
    expect(ee.listenerCount('test')).toBe(2);
  });

  it('eventNames', () => {
    const ee = new EventEmitter();
    ee.on('a', () => {});
    ee.on('b', () => {});
    expect(ee.eventNames()).toEqual(['a', 'b']);
  });

  it('prependListener adds to front', () => {
    const ee = new EventEmitter();
    const order = [];
    ee.on('test', () => order.push(1));
    ee.prependListener('test', () => order.push(0));
    ee.emit('test');
    expect(order).toEqual([0, 1]);
  });

  it('emit error throws when no listener', () => {
    const ee = new EventEmitter();
    const err = new Error('boom');
    expect(() => ee.emit('error', err)).toThrow('boom');
  });

  it('emit error does not throw when listener exists', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.on('error', fn);
    const err = new Error('boom');
    ee.emit('error', err);
    expect(fn).toHaveBeenCalledWith(err);
  });

  it('setMaxListeners / getMaxListeners', () => {
    const ee = new EventEmitter();
    expect(ee.getMaxListeners()).toBe(10);
    ee.setMaxListeners(20);
    expect(ee.getMaxListeners()).toBe(20);
  });

  it('warns when exceeding maxListeners', () => {
    const ee = new EventEmitter();
    ee.setMaxListeners(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ee.on('test', () => {});
    ee.on('test', () => {});
    ee.on('test', () => {});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('supports chaining', () => {
    const ee = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    ee.on('a', fn1).on('b', fn2);
    ee.emit('a');
    ee.emit('b');
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('prependOnceListener fires once at front', () => {
    const ee = new EventEmitter();
    const order = [];
    ee.on('test', () => order.push(1));
    ee.prependOnceListener('test', () => order.push(0));
    ee.emit('test');
    ee.emit('test');
    expect(order).toEqual([0, 1, 1]);
  });
});
