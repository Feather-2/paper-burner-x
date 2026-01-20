import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

function createEventBus() {
  const listeners = new Set();
  return {
    on(name, callback) {
      if (name !== '*') {
        throw new Error(`Only wildcard subscriptions supported in test bus: ${name}`);
      }
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit(event) {
      for (const cb of listeners) cb(event);
    },
    size() {
      return listeners.size;
    },
  };
}

test('UIEventAdapter: deepsearch events update state + progress', async () => {
  const { UIEventAdapter } = await import('../../../js/ppt/dashboard/ui-event-adapter.js');
  const bus = createEventBus();
  const adapter = new UIEventAdapter(bus);
  adapter.start();

  const calls = [];
  adapter.on('deepsearch.*', (name, payload, state) => {
    calls.push({ name, payload, state });
  });

  bus.emit({ name: 'deepsearch.started', payload: {} });
  bus.emit({ name: 'deepsearch.phase.transition', payload: { to: 'gaps' } });
  bus.emit({ name: 'deepsearch.iteration.completed', payload: { iteration: 0 } });
  bus.emit({ name: 'deepsearch.gaps.completed', payload: { gaps: ['gap-1'] } });
  bus.emit({ name: 'deepsearch.completed', payload: {} });

  expect(calls.length).toBe(5);
  const last = calls[calls.length - 1].state;
  expect(last.deepsearch.status).toBe('completed');
  expect(last.deepsearch.phase).toBe('gaps');
  expect(last.deepsearch.iteration).toBe(1);
  expect(last.deepsearch.gaps).toEqual(['gap-1']);
  expect(last.deepsearchProgress).toBe(40);
});

test('UIEventAdapter: wildcard patterns route design events + compute progress', async () => {
  const { UIEventAdapter } = await import('../../../js/ppt/dashboard/ui-event-adapter.js');
  const bus = createEventBus();
  const adapter = new UIEventAdapter(bus);
  adapter.start();

  const counts = { phase: 0, prefix: 0, all: 0 };
  let lastState = null;

  adapter.on('design.phase.*', () => {
    counts.phase += 1;
  });
  adapter.on('design*', (name, payload, state) => {
    counts.prefix += 1;
    lastState = state;
  });
  adapter.on('*', () => {
    counts.all += 1;
  });

  bus.emit({ name: 'design.started', payload: { slideCount: 4 } });
  bus.emit({ name: 'design.phase.transition', payload: { to: 'generating' } });
  bus.emit({ name: 'design.batch.progress', payload: { doneSlides: 2 } });

  expect(counts.phase).toBe(1);
  expect(counts.prefix).toBe(3);
  expect(counts.all).toBe(3);

  expect(lastState).toBeTruthy();
  expect(lastState.design.phase).toBe('generating');
  expect(lastState.design.currentSlide).toBe(2);
  expect(lastState.design.totalSlides).toBe(4);
  expect(lastState.designProgress).toBe(45);
  expect(lastState.designPhaseLabel).toBe('生成页面');
});

test('UIEventAdapter: stop halts event forwarding', async () => {
  const { UIEventAdapter } = await import('../../../js/ppt/dashboard/ui-event-adapter.js');
  const bus = createEventBus();
  const adapter = new UIEventAdapter(bus);
  adapter.start();

  let calls = 0;
  adapter.on('*', () => {
    calls += 1;
  });

  bus.emit({ name: 'design.started', payload: {} });
  expect(calls).toBe(1);

  adapter.stop();
  bus.emit({ name: 'design.started', payload: {} });
  expect(calls).toBe(1);
});
