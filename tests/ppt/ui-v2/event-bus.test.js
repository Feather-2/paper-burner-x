/**
 * @file tests/ppt/ui-v2/event-bus.test.js
 * @description UI V2 EventBus 单元测试（UIEventBus / getUIEventBus）
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UIEventBus, getUIEventBus, resetUIEventBus } from '../../../js/ppt/ui-v2/core/event-bus.js';

describe('UIEventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new UIEventBus();
  });

  it('supports on/off subscribe/unsubscribe and emit', () => {
    const handler = vi.fn();
    const off = bus.on('a', handler);

    bus.emit('a', { x: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('a', { x: 1 });

    off();
    bus.emit('a', { x: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports once() single-use handler', () => {
    const handler = vi.fn();

    bus.once('a', handler);
    bus.emit('a', { x: 1 });
    bus.emit('a', { x: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('a', { x: 1 });
  });

  it("supports wildcard pattern 'deepsearch.*'", () => {
    const handler = vi.fn();
    const off = bus.on('deepsearch.*', handler);

    bus.emit('deepsearch.log.info', { message: 'hi' });
    bus.emit('design.started', {});
    bus.emit('deepsearch', { nope: true }); // no dot, should not match "deepsearch.*"
    bus.emit('deepsearchX.log.info', { nope: true }); // different prefix

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('deepsearch.log.info', { message: 'hi' });

    off();
    bus.emit('deepsearch.log.warn', { message: 'bye' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports global wildcard pattern '*'", () => {
    const handler = vi.fn();
    const off = bus.on('*', handler);

    bus.emit('deepsearch.log.info', { i: 1 });
    bus.emit('design.started', { i: 2 });
    bus.emit('deepsearch', { i: 3 }); // no dot, should still match '*'

    expect(handler).toHaveBeenCalledTimes(3);

    off();
    bus.emit('design.finished', { i: 4 });
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('caps history at 100 events', () => {
    for (let i = 0; i < 120; i++) {
      bus.emit(`e.${i}`, { i });
    }

    const history = bus.getHistory();
    expect(history).toHaveLength(100);
    expect(history[0].name).toBe('e.20');
    expect(history.at(-1).name).toBe('e.119');
  });

  it('rejects non-function handlers in on()', () => {
    expect(() => bus.on('a', null)).toThrow(TypeError);
  });
});

describe('getUIEventBus', () => {
  beforeEach(() => {
    resetUIEventBus();
  });

  it('returns a singleton instance', () => {
    const a = getUIEventBus();
    const b = getUIEventBus();

    expect(a).toBe(b);
    expect(a).toBeInstanceOf(UIEventBus);
  });

  it('creates a new instance after resetUIEventBus()', () => {
    const a = getUIEventBus();

    resetUIEventBus();
    const b = getUIEventBus();

    expect(b).toBeInstanceOf(UIEventBus);
    expect(b).not.toBe(a);
  });
});
