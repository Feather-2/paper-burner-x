/**
 * ServiceBus 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ServiceBus,
  EventBus,
  createRetryProxy,
  createTimeoutProxy,
  createCacheProxy,
} from '../../../js/agents/core/index.js';

describe('ServiceBus', () => {
  let bus;
  let events;

  beforeEach(() => {
    events = new EventBus();
    bus = new ServiceBus({ events });
  });

  afterEach(() => {
    events.dispose();
  });

  describe('register', () => {
    it('should register service instance', async () => {
      const service = { method: () => 'result' };
      bus.register('myService', service);

      const retrieved = await bus.get('myService');
      expect(retrieved).toBe(service);
    });

    it('should throw on duplicate registration', () => {
      bus.register('dup', {});
      expect(() => bus.register('dup', {})).toThrow();
    });

    it('should allow override with option', () => {
      bus.register('override', { v: 1 });
      bus.register('override', { v: 2 }, { override: true });

      expect(bus.has('override')).toBe(true);
    });
  });

  describe('registerFactory', () => {
    it('should lazy load service', async () => {
      const factory = vi.fn(() => ({ lazy: true }));
      bus.registerFactory('lazySvc', factory);

      expect(factory).not.toHaveBeenCalled();

      const service = await bus.get('lazySvc');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.lazy).toBe(true);
    });

    it('should throw on duplicate factory registration', () => {
      bus.registerFactory('dupFactory', () => ({}));
      expect(() => bus.registerFactory('dupFactory', () => ({}))).toThrow(/already registered/i);
    });

    it('should allow override existing factory', () => {
      const factory1 = vi.fn(() => ({ v: 1 }));
      const factory2 = vi.fn(() => ({ v: 2 }));

      bus.registerFactory('overrideFactory', factory1);
      bus.registerFactory('overrideFactory', factory2, { override: true });

      expect(bus.has('overrideFactory')).toBe(true);
    });

    it('should throw if service already registered without override', () => {
      bus.register('svc', {});
      expect(() => bus.registerFactory('svc', () => ({}))).toThrow(/already registered/i);
    });

    it('should cache after first load', async () => {
      const factory = vi.fn(() => ({ id: Math.random() }));
      bus.registerFactory('cached', factory);

      const first = await bus.get('cached');
      const second = await bus.get('cached');

      expect(factory).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
    });

    it('should support async factory', async () => {
      bus.registerFactory('async', async () => {
        await new Promise(r => setTimeout(r, 10));
        return { async: true };
      });

      const service = await bus.get('async');
      expect(service.async).toBe(true);
    });
  });

  describe('get', () => {
    it('should return null for unknown service', async () => {
      await expect(bus.get('missing')).resolves.toBeNull();
    });

    it('should move factory to services after resolve', async () => {
      bus.registerFactory('fromFactory', () => ({ ok: true }));

      expect(bus.list().some(s => s.name === 'fromFactory')).toBe(false);

      const resolved = await bus.get('fromFactory');
      expect(resolved).toEqual({ ok: true });
      expect(bus.list().some(s => s.name === 'fromFactory')).toBe(true);
    });
  });

  describe('has', () => {
    it('should return true for registered services', () => {
      bus.register('exists', {});
      expect(bus.has('exists')).toBe(true);
    });

    it('should return true for registered factories', () => {
      bus.registerFactory('factory', () => ({}));
      expect(bus.has('factory')).toBe(true);
    });

    it('should return false for unknown services', () => {
      expect(bus.has('unknown')).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should remove service', () => {
      bus.register('toRemove', {});
      expect(bus.has('toRemove')).toBe(true);

      bus.unregister('toRemove');
      expect(bus.has('toRemove')).toBe(false);
    });
  });

  describe('call', () => {
    it('should call service method', async () => {
      bus.register('calc', {
        add: (a, b) => a + b,
      });

      const result = await bus.call('calc', 'add', [2, 3]);
      expect(result).toBe(5);
    });

    it('should handle async methods', async () => {
      bus.register('asyncSvc', {
        fetch: async (id) => {
          await new Promise(r => setTimeout(r, 10));
          return { id, data: 'fetched' };
        },
      });

      const result = await bus.call('asyncSvc', 'fetch', [42]);
      expect(result).toEqual({ id: 42, data: 'fetched' });
    });

    it('should throw for unknown service', async () => {
      await expect(bus.call('unknown', 'method', [])).rejects.toThrow();
    });

    it('should throw for unknown method', async () => {
      bus.register('svc', { known: () => {} });
      await expect(bus.call('svc', 'unknown', [])).rejects.toThrow();
    });
  });

  describe('invoke', () => {
    it('should parse service.method path', async () => {
      bus.register('math', {
        multiply: (a, b) => a * b,
      });

      const result = await bus.invoke('math.multiply', 4, 5);
      expect(result).toBe(20);
    });

    it('should throw on invalid path', async () => {
      await expect(bus.invoke('invalid')).rejects.toThrow(/expected 'service\.method'/i);
    });
  });

  describe('list', () => {
    it('should list all services', () => {
      bus.register('svc1', {});
      bus.register('svc2', {});
      bus.registerFactory('svc3', () => ({}));

      const list = bus.list();
      expect(list.length).toBe(2); // factories not in list until resolved
      expect(list.some(e => e.name === 'svc1')).toBe(true);
      expect(list.some(e => e.name === 'svc2')).toBe(true);
    });
  });

  describe('stats', () => {
    it('should track call stats', async () => {
      bus.register('tracked', { fn: () => 'ok' });

      await bus.call('tracked', 'fn', []);
      await bus.call('tracked', 'fn', []);

      const stats = bus.getStats();
      const tracked = stats.find(s => s.name === 'tracked');

      expect(tracked.calls).toBe(2);
      expect(tracked.errors).toBe(0);
    });

    it('should track errors', async () => {
      bus.register('failing', {
        fail: () => { throw new Error('oops'); },
      });

      await expect(bus.call('failing', 'fail', [])).rejects.toThrow();

      const stats = bus.getStats();
      const failing = stats.find(s => s.name === 'failing');

      expect(failing.errors).toBe(1);
    });

    it('should get and reset stats for a service', async () => {
      bus.register('resettable', { fn: () => 'ok' });

      await bus.call('resettable', 'fn', []);
      const before = bus.getStats('resettable');
      expect(before).not.toBeNull();
      expect(before.calls).toBe(1);

      bus.resetStats();
      const after = bus.getStats('resettable');
      expect(after.calls).toBe(0);
      expect(after.errors).toBe(0);
      expect(after.totalTime).toBe(0);
    });
  });

  describe('health check', () => {
    it('should report not found', async () => {
      const result = await bus.healthCheck('missing');
      expect(result.healthy).toBe(false);
      expect(result.error).toBe('not found');
    });

    it('should check service health', async () => {
      bus.register('healthy', { fn: () => {} }, {
        healthCheck: () => true,
      });

      const result = await bus.healthCheck('healthy');
      expect(result.healthy).toBe(true);
    });

    it('should use instance healthCheck when option not provided', async () => {
      const instance = { healthCheck: vi.fn(() => true) };
      bus.register('instanceCheck', instance);

      const result = await bus.healthCheck('instanceCheck');
      expect(result.healthy).toBe(true);
      expect(instance.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('should handle health check throwing', async () => {
      bus.register('throws', {}, {
        healthCheck: () => { throw new Error('boom'); },
      });

      const result = await bus.healthCheck('throws');
      expect(result.healthy).toBe(false);
      expect(result.error).toMatch(/boom/);
    });

    it('should default to healthy when no check defined', async () => {
      bus.register('noCheck', { fn: () => {} });

      const result = await bus.healthCheck('noCheck');
      expect(result.healthy).toBe(true);
    });

    it('should report unhealthy', async () => {
      bus.register('sick', { fn: () => {} }, {
        healthCheck: () => false,
      });

      const result = await bus.healthCheck('sick');
      expect(result.healthy).toBe(false);
    });

    it('should check all services', async () => {
      bus.register('ok1', {}, { healthCheck: () => true });
      bus.register('ok2', {}, { healthCheck: () => true });

      const results = await bus.healthCheckAll();
      expect(results.every(r => r.healthy)).toBe(true);
    });
  });

  describe('proxy management', () => {
    it('should normalize function proxies and remove by name', async () => {
      const calls = [];
      async function orderProxy(ctx, next) {
        calls.push(`before:${ctx.service}.${ctx.method}`);
        const result = await next();
        calls.push(`after:${ctx.service}.${ctx.method}`);
        return result;
      }

      bus.register('svc', { fn: () => 'ok' });
      bus.useProxy(orderProxy);

      const result = await bus.call('svc', 'fn', []);
      expect(result).toBe('ok');
      expect(calls).toEqual(['before:svc.fn', 'after:svc.fn']);

      expect(bus.removeProxy('orderProxy')).toBe(true);
      expect(bus.removeProxy('orderProxy')).toBe(false);
    });

    it('should support object proxies with invoke()', async () => {
      const proxy = {
        name: 'objectProxy',
        invoke: vi.fn(async (_ctx, next) => next()),
      };

      bus.register('svc', { fn: () => 'ok' });
      bus.useProxy(proxy);

      await expect(bus.call('svc', 'fn', [])).resolves.toBe('ok');
      expect(proxy.invoke).toHaveBeenCalledTimes(1);
      expect(bus.removeProxy('objectProxy')).toBe(true);
    });

    it('should allow unnamed object proxies (proxyName undefined)', async () => {
      const proxy = {
        invoke: vi.fn(async (_ctx, next) => next()),
      };

      bus.register('svc', { fn: () => 'ok' });
      bus.useProxy(proxy);

      await expect(bus.call('svc', 'fn', [])).resolves.toBe('ok');
      expect(bus._proxies[0].proxyName).toBeUndefined();
    });

    it('should throw for invalid proxy inputs', () => {
      expect(() => bus.useProxy({})).toThrow(/invoke/i);
    });
  });

  describe('clear', () => {
    it('should remove all services, factories, proxies, and stats', async () => {
      bus.register('svc', { fn: () => 'ok' });
      bus.registerFactory('lazy', () => ({}));
      bus.useProxy(createTimeoutProxy({ timeout: 1 }));

      await bus.call('svc', 'fn', []);
      expect(bus.getStats('svc')).not.toBeNull();

      bus.clear();

      expect(bus.has('svc')).toBe(false);
      expect(bus.has('lazy')).toBe(false);
      expect(bus.getStats('svc')).toBeNull();
      expect(bus.list()).toEqual([]);
    });
  });
});

describe('Service Proxies', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createRetryProxy', () => {
    it('should retry on failure', async () => {
      let attempts = 0;
      const bus = new ServiceBus();

      bus.register('flaky', {
        method: () => {
          attempts++;
          if (attempts < 3) throw new Error('fail');
          return 'success';
        },
      });

      bus.useProxy(createRetryProxy({ maxRetries: 3, delay: 1 }));

      const resultPromise = bus.call('flaky', 'method', []);
      await expect(resultPromise).resolves.toBe('success');
      expect(attempts).toBe(3);
    });

    it('should use backoff when delay not provided', async () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      let attempts = 0;
      const bus = new ServiceBus();
      bus.register('svc', {
        method: () => {
          attempts++;
          if (attempts === 1) throw new Error('fail');
          return 'ok';
        },
      });

      bus.useProxy(createRetryProxy({ maxRetries: 1, backoff: 10 }));

      const promise = bus.call('svc', 'method', []);
      const assertion = expect(promise).resolves.toBe('ok');
      await vi.runAllTimersAsync();
      await assertion;

      expect(attempts).toBe(2);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10);
    });

    it('should stop retrying when shouldRetry returns false', async () => {
      const bus = new ServiceBus();
      const shouldRetry = vi.fn(() => false);
      const method = vi.fn(() => { throw new Error('nope'); });

      bus.register('svc', { method });
      bus.useProxy(createRetryProxy({ maxRetries: 5, delay: 1, shouldRetry }));

      await expect(bus.call('svc', 'method', [])).rejects.toThrow(/nope/);
      expect(method).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    });

    it('should throw last error after exhausting retries', async () => {
      vi.useFakeTimers();
      const bus = new ServiceBus();
      const error = new Error('still failing');
      const method = vi.fn(() => { throw error; });

      bus.register('svc', { method });
      bus.useProxy(createRetryProxy({ maxRetries: 2, delay: 10 }));

      const promise = bus.call('svc', 'method', []);
      const assertion = expect(promise).rejects.toBe(error);
      await vi.runAllTimersAsync();

      await assertion;
      expect(method).toHaveBeenCalledTimes(3); // 0..maxRetries
    });

    it('should be callable as a function (delegates to invoke)', async () => {
      const proxy = createRetryProxy({ maxRetries: 0, delay: 1 });
      const next = vi.fn(async () => 'ok');
      const ctx = { service: 'svc', method: 'm', args: [], options: {}, startTime: Date.now() };

      await expect(proxy(ctx, next)).resolves.toBe('ok');
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('createTimeoutProxy', () => {
    it('should timeout slow calls', async () => {
      vi.useFakeTimers();
      const bus = new ServiceBus();

      bus.register('slow', {
        method: () => new Promise(() => {}),
      });

      bus.useProxy(createTimeoutProxy({ timeout: 50 }));

      const promise = bus.call('slow', 'method', []);
      const assertion = expect(promise).rejects.toThrow(/timeout/i);
      await vi.advanceTimersByTimeAsync(60);

      await assertion;
    });

    it('should respect per-call timeout override', async () => {
      vi.useFakeTimers();
      const bus = new ServiceBus();

      bus.register('slow', {
        method: () => new Promise(() => {}),
      });

      bus.useProxy(createTimeoutProxy({ timeout: 1000 }));

      const promise = bus.call('slow', 'method', [], { timeout: 10 });
      const assertion = expect(promise).rejects.toThrow(/slow\.method/i);
      await vi.advanceTimersByTimeAsync(15);

      await assertion;
    });
  });

  describe('createCacheProxy', () => {
    it('should cache results and expire by ttl', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

      const bus = new ServiceBus();
      const method = vi.fn(() => `v${method.mock.calls.length}`);
      bus.register('svc', { method });
      bus.useProxy(createCacheProxy({ ttl: 1000 }));

      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v1');
      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v1');
      expect(method).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2024-01-01T00:00:01.100Z'));
      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v2');
      expect(method).toHaveBeenCalledTimes(2);
    });

    it('should bypass cache when disabled or ttl <= 0', async () => {
      const bus = new ServiceBus();
      const method = vi.fn(() => `v${method.mock.calls.length}`);
      bus.register('svc', { method });
      bus.useProxy(createCacheProxy({ ttl: 1000 }));

      await expect(bus.call('svc', 'method', [1], { cache: false })).resolves.toBe('v1');
      await expect(bus.call('svc', 'method', [1], { cache: false })).resolves.toBe('v2');
      await expect(bus.call('svc', 'method', [1], { cache: 0 })).resolves.toBe('v3');

      expect(method).toHaveBeenCalledTimes(3);
    });

    it('should not store entries when maxSize is 0', async () => {
      const bus = new ServiceBus();
      const method = vi.fn(() => `v${method.mock.calls.length}`);
      bus.register('svc', { method });
      bus.useProxy(createCacheProxy({ ttl: 1000, maxSize: 0 }));

      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v1');
      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v2');
      expect(method).toHaveBeenCalledTimes(2);
    });

    it('should evict oldest entry when maxSize is reached', async () => {
      const bus = new ServiceBus();
      const method = vi.fn((x) => `v${x}-${method.mock.calls.length}`);
      bus.register('svc', { method });
      bus.useProxy(createCacheProxy({ ttl: 1000, maxSize: 1 }));

      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v1-1');
      await expect(bus.call('svc', 'method', [2])).resolves.toBe('v2-2');
      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v1-3');

      expect(method).toHaveBeenCalledTimes(3);
    });

    it('should support custom keyFn', async () => {
      const bus = new ServiceBus();
      const method = vi.fn((x) => `v${x}-${method.mock.calls.length}`);
      bus.register('svc', { method });
      bus.useProxy(createCacheProxy({
        ttl: 1000,
        keyFn: (ctx) => `${ctx.service}:${ctx.method}`,
      }));

      await expect(bus.call('svc', 'method', [1])).resolves.toBe('v1-1');
      await expect(bus.call('svc', 'method', [2])).resolves.toBe('v1-1');
      expect(method).toHaveBeenCalledTimes(1);
    });
  });
});
