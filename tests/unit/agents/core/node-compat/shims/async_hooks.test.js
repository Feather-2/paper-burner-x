import { describe, it, expect } from 'vitest';
import asyncHooks, {
  AsyncResource,
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  executionAsyncResource,
  triggerAsyncId,
} from '../../../../../../js/agents/core/node-compat/shims/async_hooks.js';

describe('async_hooks shim', () => {
  it('AsyncResource exposes lightweight scope and id helpers', () => {
    const resource = new AsyncResource('test');
    const context = { value: 3 };
    const fn = function add(a, b) {
      return this.value + a + b;
    };

    expect(resource.runInAsyncScope(fn, context, 4, 5)).toBe(12);
    expect(resource.emitDestroy()).toBe(resource);
    expect(resource.asyncId()).toBe(0);
    expect(resource.triggerAsyncId()).toBe(0);
    expect(AsyncResource.bind(fn)).toBe(fn);
  });

  it('AsyncLocalStorage manages store during run/exit and restores state', () => {
    const storage = new AsyncLocalStorage();
    expect(storage.getStore()).toBeUndefined();

    storage.enterWith('outer');
    expect(storage.getStore()).toBe('outer');

    const value = storage.run('inner', () => storage.getStore());
    expect(value).toBe('inner');
    expect(storage.getStore()).toBe('outer');

    const exitValue = storage.exit(() => storage.getStore());
    expect(exitValue).toBeUndefined();
    expect(storage.getStore()).toBe('outer');

    expect(() => storage.disable()).not.toThrow();
  });

  it('restores store even when callback throws', () => {
    const storage = new AsyncLocalStorage();
    const error = new Error('boom');
    storage.enterWith('persisted');

    expect(() => storage.run('temporary', () => {
      throw error;
    })).toThrow(error);

    expect(storage.getStore()).toBe('persisted');
  });

  it('createHook and execution helpers return inert browser-safe values', () => {
    const hook = createHook({});
    expect(hook.enable()).toBe(hook);
    expect(hook.disable()).toBe(hook);
    expect(executionAsyncId()).toBe(0);
    expect(triggerAsyncId()).toBe(0);
    expect(executionAsyncResource()).toEqual({});
  });

  it('default export mirrors named exports', () => {
    expect(asyncHooks.AsyncResource).toBe(AsyncResource);
    expect(asyncHooks.AsyncLocalStorage).toBe(AsyncLocalStorage);
    expect(asyncHooks.createHook).toBe(createHook);
    expect(asyncHooks.executionAsyncId).toBe(executionAsyncId);
    expect(asyncHooks.executionAsyncResource).toBe(executionAsyncResource);
    expect(asyncHooks.triggerAsyncId).toBe(triggerAsyncId);
  });
});
