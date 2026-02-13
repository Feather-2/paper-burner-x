import { describe, it, expect, vi } from 'vitest';
import { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate } from '../../../../../../js/agents/core/node-compat/shims/timers.js';

describe('timers shim', () => {
  it('setTimeout executes callback after delay', async () => {
    const callback = vi.fn();
    setTimeout(callback, 10);
    expect(callback).not.toHaveBeenCalled();
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('setTimeout passes arguments to callback', async () => {
    const callback = vi.fn();
    setTimeout(callback, 10, 'arg1', 'arg2');
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
    expect(callback).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('clearTimeout cancels scheduled callback', async () => {
    const callback = vi.fn();
    const id = setTimeout(callback, 10);
    clearTimeout(id);
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
    expect(callback).not.toHaveBeenCalled();
  });

  it('setInterval executes callback repeatedly', async () => {
    const callback = vi.fn();
    const id = setInterval(callback, 10);
    await new Promise(resolve => globalThis.setTimeout(resolve, 35));
    clearInterval(id);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('clearInterval stops repeated execution', async () => {
    const callback = vi.fn();
    const id = setInterval(callback, 10);
    await new Promise(resolve => globalThis.setTimeout(resolve, 15));
    clearInterval(id);
    const callCount = callback.mock.calls.length;
    await new Promise(resolve => globalThis.setTimeout(resolve, 20));
    expect(callback).toHaveBeenCalledTimes(callCount);
  });

  it('setImmediate executes callback asynchronously', async () => {
    const callback = vi.fn();
    setImmediate(callback);
    expect(callback).not.toHaveBeenCalled();
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('setImmediate passes arguments to callback', async () => {
    const callback = vi.fn();
    setImmediate(callback, 'arg1', 'arg2');
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    expect(callback).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('clearImmediate cancels scheduled callback', async () => {
    const callback = vi.fn();
    const id = setImmediate(callback);
    clearImmediate(id);
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    expect(callback).not.toHaveBeenCalled();
  });
});
