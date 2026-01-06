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
  });

  describe('health check', () => {
    it('should check service health', async () => {
      bus.register('healthy', { fn: () => {} }, {
        healthCheck: () => true,
      });

      const result = await bus.healthCheck('healthy');
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
});

describe('Service Proxies', () => {
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

      bus.useProxy(createRetryProxy({ maxRetries: 3 }));

      const result = await bus.call('flaky', 'method', []);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  describe('createTimeoutProxy', () => {
    it('should timeout slow calls', async () => {
      const bus = new ServiceBus();

      bus.register('slow', {
        method: async () => {
          await new Promise(r => setTimeout(r, 1000));
          return 'done';
        },
      });

      bus.useProxy(createTimeoutProxy({ timeout: 50 }));

      await expect(bus.call('slow', 'method', [])).rejects.toThrow(/timeout/i);
    });
  });
});
