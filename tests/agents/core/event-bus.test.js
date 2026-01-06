/**
 * EventBus 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, LamportClock } from '../../../js/agents/core/index.js';

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ keepHistory: true });
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('emit and on', () => {
    it('should emit and receive events', async () => {
      const handler = vi.fn();
      bus.on('test.event', handler);

      await bus.emit('test.event', { value: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].type).toBe('test.event');
      expect(handler.mock.calls[0][0].payload).toEqual({ value: 42 });
    });

    it('should support wildcard patterns', async () => {
      const handler = vi.fn();
      bus.on('user.*', handler);

      await bus.emit('user.login', { id: 1 });
      await bus.emit('user.logout', { id: 1 });
      await bus.emit('system.error', {}); // should not match

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should support global wildcard *', async () => {
      const handler = vi.fn();
      bus.on('*', handler);

      await bus.emit('any.event', {});
      await bus.emit('another', {});

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', async () => {
      const handler = vi.fn();
      const unsub = bus.on('test', handler);

      await bus.emit('test', {});
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      await bus.emit('test', {});
      expect(handler).toHaveBeenCalledTimes(1); // still 1
    });
  });

  describe('emitSync', () => {
    it('should emit synchronously', () => {
      const handler = vi.fn();
      bus.on('sync.event', handler);

      bus.emitSync('sync.event', { sync: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('once', () => {
    it('should only fire once', async () => {
      const handler = vi.fn();
      bus.once('one.time', handler);

      await bus.emit('one.time', {});
      await bus.emit('one.time', {});

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('priority', () => {
    it('should call high priority handlers first', async () => {
      const order = [];

      bus.on('priority.test', () => order.push('normal'));
      bus.on('priority.test', () => order.push('high'), { priority: 10 });
      bus.on('priority.test', () => order.push('low'), { priority: -10 });

      await bus.emit('priority.test', {});

      expect(order).toEqual(['high', 'normal', 'low']);
    });
  });

  describe('waitFor', () => {
    it('should wait for event', async () => {
      const promise = bus.waitFor('delayed.event');

      setTimeout(() => {
        bus.emitSync('delayed.event', { delayed: true });
      }, 10);

      const event = await promise;
      expect(event.type).toBe('delayed.event');
      expect(event.payload).toEqual({ delayed: true });
    });

    it('should timeout if event not received', async () => {
      await expect(
        bus.waitFor('never.happens', { timeout: 50 })
      ).rejects.toThrow();
    });

    it('should support abort signal', async () => {
      const controller = new AbortController();

      const promise = bus.waitFor('aborted.event', { signal: controller.signal });

      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('history', () => {
    it('should keep event history when enabled', async () => {
      await bus.emit('event.1', { n: 1 });
      await bus.emit('event.2', { n: 2 });

      const history = bus.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].type).toBe('event.1');
      expect(history[1].type).toBe('event.2');
    });

    it('should respect maxHistory', async () => {
      const smallBus = new EventBus({ keepHistory: true, maxHistory: 3 });

      for (let i = 0; i < 5; i++) {
        await smallBus.emit('event', { i });
      }

      const history = smallBus.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].payload.i).toBe(2); // oldest kept

      smallBus.dispose();
    });
  });

  describe('Lamport clock', () => {
    it('should increment clock on each event', async () => {
      const clock1 = bus.getClock();
      await bus.emit('tick', {});
      const clock2 = bus.getClock();

      expect(clock2.seq).toBeGreaterThan(clock1.seq);
    });
  });
});

describe('LamportClock', () => {
  it('should start at 0', () => {
    const clock = new LamportClock('node1');
    const state = clock.get();
    expect(state.seq).toBe(0);
  });

  it('should increment on tick', () => {
    const clock = new LamportClock('node1');
    clock.tick();
    clock.tick();
    expect(clock.get().seq).toBe(2);
  });

  it('should update from remote clock', () => {
    const clock1 = new LamportClock('node1');
    const clock2 = new LamportClock('node2');

    clock1.tick();
    clock1.tick();
    clock1.tick(); // seq = 3

    clock2.tick(); // seq = 1

    clock2.update(clock1.get()); // should jump to 4

    expect(clock2.get().seq).toBe(4);
  });

  it('should include node id', () => {
    const clock = new LamportClock('my-node');
    const state = clock.tick();
    expect(state.id).toContain('my-node');
  });
});
