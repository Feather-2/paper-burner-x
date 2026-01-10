import test from 'node:test';
import assert from 'node:assert/strict';

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
  const { UIEventAdapter } = await import('../../js/ppt/dashboard/ui-event-adapter.js');
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

  assert.equal(calls.length, 5);
  const last = calls[calls.length - 1].state;
  assert.equal(last.deepsearch.status, 'completed');
  assert.equal(last.deepsearch.phase, 'gaps');
  assert.equal(last.deepsearch.iteration, 1);
  assert.deepEqual(last.deepsearch.gaps, ['gap-1']);
  assert.equal(last.deepsearchProgress, 40);
});

test('UIEventAdapter: wildcard patterns route design events + compute progress', async () => {
  const { UIEventAdapter } = await import('../../js/ppt/dashboard/ui-event-adapter.js');
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

  assert.equal(counts.phase, 1);
  assert.equal(counts.prefix, 3);
  assert.equal(counts.all, 3);

  assert.ok(lastState);
  assert.equal(lastState.design.phase, 'generating');
  assert.equal(lastState.design.currentSlide, 2);
  assert.equal(lastState.design.totalSlides, 4);
  assert.equal(lastState.designProgress, 45);
  assert.equal(lastState.designPhaseLabel, '生成页面');
});

test('UIEventAdapter: stop halts event forwarding', async () => {
  const { UIEventAdapter } = await import('../../js/ppt/dashboard/ui-event-adapter.js');
  const bus = createEventBus();
  const adapter = new UIEventAdapter(bus);
  adapter.start();

  let calls = 0;
  adapter.on('*', () => {
    calls += 1;
  });

  bus.emit({ name: 'design.started', payload: {} });
  assert.equal(calls, 1);

  adapter.stop();
  bus.emit({ name: 'design.started', payload: {} });
  assert.equal(calls, 1);
});
