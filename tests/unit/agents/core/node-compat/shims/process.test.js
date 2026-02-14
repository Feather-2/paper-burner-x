import { describe, it, expect, vi } from 'vitest';
import processShim, { createProcess } from '../../../../../../js/agents/core/node-compat/shims/process.js';

describe('process shim', () => {
  it('process.platform === linux', () => {
    expect(processShim.platform).toBe('linux');
  });

  it('process.cwd() returns string', () => {
    expect(typeof processShim.cwd()).toBe('string');
  });

  it('process.chdir updates cwd', () => {
    const proc = createProcess({ cwd: '/home' });
    proc.chdir('/tmp');
    expect(proc.cwd()).toBe('/tmp');
  });

  it('process.env contains NODE_ENV', () => {
    expect(processShim.env.NODE_ENV).toBe('development');
  });

  it('process.nextTick executes callback', async () => {
    const fn = vi.fn();
    processShim.nextTick(fn, 'a', 'b');
    await new Promise(r => setTimeout(r, 10));
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });

  it('process.hrtime returns [seconds, nanoseconds]', () => {
    const time = processShim.hrtime();
    expect(Array.isArray(time)).toBe(true);
    expect(time.length).toBe(2);
    expect(typeof time[0]).toBe('number');
    expect(typeof time[1]).toBe('number');
  });

  it('process.hrtime.bigint() returns bigint', () => {
    const val = processShim.hrtime.bigint();
    expect(typeof val).toBe('bigint');
  });

  it('process.on / emit events', () => {
    const proc = createProcess();
    const fn = vi.fn();
    proc.on('test-event', fn);
    proc.emit('test-event', 42);
    expect(fn).toHaveBeenCalledWith(42);
  });

  it('process.stdout.write does not throw', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => processShim.stdout.write('hello')).not.toThrow();
    spy.mockRestore();
  });

  it('process.memoryUsage() returns object with rss', () => {
    const mem = processShim.memoryUsage();
    expect(typeof mem).toBe('object');
    expect(typeof mem.rss).toBe('number');
    expect(mem.rss).toBeGreaterThan(0);
  });

  it('process.uptime() returns number', () => {
    expect(typeof processShim.uptime()).toBe('number');
  });

  it('process.exit throws', () => {
    const proc = createProcess();
    expect(() => proc.exit(1)).toThrow('Process exited with code 1');
  });

  it('multiple nextTick calls execute in order', async () => {
    const proc = createProcess();
    const order = [];
    proc.nextTick(() => order.push(1));
    proc.nextTick(() => order.push(2));
    proc.nextTick(() => order.push(3));
    await new Promise(r => globalThis.setTimeout(r, 20));
    expect(order).toEqual([1, 2, 3]);
  });

  it('nextTick error does not break other callbacks', async () => {
    const proc = createProcess();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn();
    proc.nextTick(() => { throw new Error('boom'); });
    proc.nextTick(fn);
    await new Promise(r => globalThis.setTimeout(r, 20));
    expect(fn).toHaveBeenCalled();
    spy.mockRestore();
  });
});
