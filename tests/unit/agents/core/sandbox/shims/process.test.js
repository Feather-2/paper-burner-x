import { describe, it, expect, vi } from 'vitest';
import processShim, { createProcess } from '../../../../../../js/agents/core/sandbox/shims/process.js';

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
});
