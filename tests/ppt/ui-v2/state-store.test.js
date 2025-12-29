const test = require('node:test');
const assert = require('node:assert/strict');

async function loadEventBus() {
  return await import('../../../js/ppt/ui-v2/core/event-bus.js');
}

async function loadStateStore() {
  return await import('../../../js/ppt/ui-v2/core/state-store.js');
}

test('StateStore: get/set/update basic operations', async () => {
  const { UIEventBus } = await loadEventBus();
  const { StateStore, WorkflowState } = await loadStateStore();

  const bus = new UIEventBus();
  const store = new StateStore(bus);

  assert.equal(store.get('workflow.state'), WorkflowState.IDLE);

  store.set('data.taskGoal', 'Demo');
  assert.equal(store.get('data.taskGoal'), 'Demo');

  store.update({
    'data.taskGoal': 'Updated',
    'workflow.runId': 'run_1',
  });
  assert.equal(store.get('data.taskGoal'), 'Updated');
  assert.equal(store.get('workflow.runId'), 'run_1');
});

test('StateStore: subscribe/unsubscribe', async () => {
  const { UIEventBus } = await loadEventBus();
  const { StateStore } = await loadStateStore();

  const bus = new UIEventBus();
  const store = new StateStore(bus);

  const events = [];
  const unsub = store.subscribe((evt) => events.push(evt));

  store.set('data.taskGoal', 'A');
  assert.equal(events.length, 1);
  assert.equal(events[0].path, 'data.taskGoal');
  assert.equal(events[0].newValue, 'A');

  unsub();
  store.set('data.taskGoal', 'B');
  assert.equal(events.length, 1);
});

test('StateStore: getState() returns deep clone (mutations do not leak back)', async () => {
  const { UIEventBus } = await loadEventBus();
  const { StateStore, WorkflowState } = await loadStateStore();

  const bus = new UIEventBus();
  const store = new StateStore(bus);

  const snapshot = store.getState();
  snapshot.workflow.state = 'hijacked';
  snapshot.ui.logs.push({ scope: 'test', level: 'info', message: 'x' });

  assert.equal(store.get('workflow.state'), WorkflowState.IDLE);
  assert.equal(store.get('ui.logs').length, 0);
});

test('StateStore: reset() restores initial state and notifies with empty path', async () => {
  const { UIEventBus } = await loadEventBus();
  const { StateStore, WorkflowState, ViewType } = await loadStateStore();

  const bus = new UIEventBus();
  const store = new StateStore(bus);

  store.set('data.taskGoal', 'X');
  store.set('workflow.state', WorkflowState.READING);
  store.set('ui.view', ViewType.DEEPSEARCH_PREMIUM);

  const events = [];
  store.subscribe((evt) => events.push(evt));

  store.reset();

  assert.equal(store.get('data.taskGoal'), '');
  assert.equal(store.get('workflow.state'), WorkflowState.IDLE);
  assert.equal(store.get('ui.view'), ViewType.UPLOAD);

  const last = events.at(-1);
  assert.ok(last);
  assert.equal(last.path, '');
  assert.equal(last.oldValue, null);
});

