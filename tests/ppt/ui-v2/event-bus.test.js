const test = require('node:test');
const assert = require('node:assert/strict');

async function loadEventBus() {
  return await import('../../../js/ppt/ui-v2/core/event-bus.js');
}

test('UIEventBus: on/off/emit basic events', async () => {
  const { UIEventBus } = await loadEventBus();
  const bus = new UIEventBus();

  const received = [];
  const off = bus.on('a', (name, payload) => received.push({ name, payload }));

  bus.emit('a', { x: 1 });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { name: 'a', payload: { x: 1 } });

  off();
  bus.emit('a', { x: 2 });
  assert.equal(received.length, 1);
});

test('UIEventBus: wildcard subscription (deepsearch.*)', async () => {
  const { UIEventBus } = await loadEventBus();
  const bus = new UIEventBus();

  const received = [];
  const off = bus.on('deepsearch.*', (name, payload) => received.push({ name, payload }));

  bus.emit('deepsearch.log.info', { message: 'hi' });
  bus.emit('design.started', {});
  bus.emit('deepsearch', { nope: true }); // no dot, should not match "deepsearch.*"

  assert.equal(received.length, 1);
  assert.equal(received[0].name, 'deepsearch.log.info');

  off();
});

test('UIEventBus: once() triggers only once', async () => {
  const { UIEventBus } = await loadEventBus();
  const bus = new UIEventBus();

  let count = 0;
  bus.once('a', () => count++);
  bus.emit('a');
  bus.emit('a');
  assert.equal(count, 1);
});

test('UIEventBus: history is capped at 100 events', async () => {
  const { UIEventBus } = await loadEventBus();
  const bus = new UIEventBus();

  for (let i = 0; i < 120; i++) {
    bus.emit(`e.${i}`, { i });
  }

  const history = bus.getHistory();
  assert.equal(history.length, 100);
  assert.equal(history[0].name, 'e.20');
  assert.equal(history.at(-1).name, 'e.119');
});

test('UIEventBus: on() rejects non-function handlers', async () => {
  const { UIEventBus } = await loadEventBus();
  const bus = new UIEventBus();

  assert.throws(() => bus.on('a', null), { name: 'TypeError' });
});

