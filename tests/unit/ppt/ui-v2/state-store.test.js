import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedEventBus = vi.hoisted(() => {
  const eventBus = {
    on: vi.fn(() => vi.fn()),
    emit: vi.fn(),
  };

  return {
    eventBus,
    getUIEventBus: vi.fn(() => eventBus),
  };
});

vi.mock('../../../../js/shared/core/event-bus.js', () => ({
  getUIEventBus: mockedEventBus.getUIEventBus,
}));

async function loadStateStore() {
  return await import('../../../../js/ppt/ui-v2/core/state-store.js');
}

describe('StateStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    mockedEventBus.eventBus.on.mockClear();
    mockedEventBus.eventBus.emit.mockClear();
    mockedEventBus.getUIEventBus.mockClear();

    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getState() returns a defensive deep clone', async () => {
    const { StateStore, WorkflowState } = await loadStateStore();
    const store = new StateStore();

    expect(mockedEventBus.getUIEventBus).toHaveBeenCalledTimes(1);

    const snapshot = store.getState();
    snapshot.workflow.state = 'hijacked';
    snapshot.ui.logs.push({ scope: 'test', level: 'info', message: 'x' });
    snapshot.data.files.push('file1');

    expect(store.get('workflow.state')).toBe(WorkflowState.IDLE);
    expect(store.get('ui.logs')).toEqual([]);
    expect(store.get('data.files')).toEqual([]);
  });

  it('get(path) returns nested values (or undefined)', async () => {
    const { StateStore, WorkflowState } = await loadStateStore();
    const store = new StateStore();

    expect(store.get('workflow.state')).toBe(WorkflowState.IDLE);
    expect(store.get('deepsearch.progress.current')).toBe(0);
    expect(store.get('does.not.exist')).toBeUndefined();

    store.set('data.report', null);
    expect(store.get('data.report.title')).toBeUndefined();
  });

  it('set(path, value) updates nested state and notifies subscribers', async () => {
    const { StateStore } = await loadStateStore();
    const store = new StateStore();

    const events = [];
    store.subscribe((evt) => events.push(evt));

    store.set('data.taskGoal', 'Demo');
    expect(store.get('data.taskGoal')).toBe('Demo');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ path: 'data.taskGoal', newValue: 'Demo', oldValue: '' }));
    expect(events[0].state.data.taskGoal).toBe('Demo');

    // Creates intermediate objects when needed.
    store.set('ui.modals.example.open', true);
    expect(store.get('ui.modals.example.open')).toBe(true);

    // No-op updates should not notify.
    const emitCallsBefore = mockedEventBus.eventBus.emit.mock.calls.length;
    store.set('data.taskGoal', 'Demo');
    expect(events).toHaveLength(2);
    expect(mockedEventBus.eventBus.emit).toHaveBeenCalledTimes(emitCallsBefore);

    // Emits through event bus on state change.
    expect(mockedEventBus.eventBus.emit).toHaveBeenCalledWith(
      'ui.state.changed',
      expect.objectContaining({ path: 'data.taskGoal', newValue: 'Demo', oldValue: '' })
    );
  });

  it('update(updates) applies multiple changes', async () => {
    const { StateStore, WorkflowState } = await loadStateStore();
    const store = new StateStore();

    const events = [];
    store.subscribe((evt) => events.push(evt));

    store.update({
      'data.taskGoal': 'Updated',
      'workflow.runId': 'run_1',
      'workflow.state': WorkflowState.IDLE, // unchanged, should not trigger
    });

    expect(store.get('data.taskGoal')).toBe('Updated');
    expect(store.get('workflow.runId')).toBe('run_1');

    expect(events.map((e) => e.path)).toEqual(['data.taskGoal', 'workflow.runId']);
    expect(mockedEventBus.eventBus.emit).toHaveBeenCalledTimes(2);
  });

  it('subscribe() returns an unsubscribe function', async () => {
    const { StateStore } = await loadStateStore();
    const store = new StateStore();

    const handler = vi.fn();
    const unsubscribe = store.subscribe(handler);

    store.set('data.taskGoal', 'A');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set('data.taskGoal', 'B');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reset() restores initial state and notifies with empty path', async () => {
    const { StateStore, WorkflowState, ViewType } = await loadStateStore();
    const store = new StateStore();

    store.set('data.taskGoal', 'X');
    store.set('workflow.state', WorkflowState.READING);
    store.set('ui.view', ViewType.DEEPSEARCH_PREMIUM);

    const events = [];
    store.subscribe((evt) => events.push(evt));

    store.reset();

    expect(store.get('data.taskGoal')).toBe('');
    expect(store.get('workflow.state')).toBe(WorkflowState.IDLE);
    expect(store.get('ui.view')).toBe(ViewType.UPLOAD);

    const last = events.at(-1);
    expect(last).toEqual(expect.objectContaining({ path: '', oldValue: null }));
  });

  it('exports frozen constants (WorkflowState, AgentStatus, ViewType)', async () => {
    const { WorkflowState, AgentStatus, ViewType } = await loadStateStore();

    expect(Object.isFrozen(WorkflowState)).toBe(true);
    expect(Object.isFrozen(AgentStatus)).toBe(true);
    expect(Object.isFrozen(ViewType)).toBe(true);

    expect(WorkflowState.REVIEWING).toBe(WorkflowState.SCRIPT_REVIEW);
    expect(WorkflowState.DESIGNING).toBe(WorkflowState.DESIGNER);

    expect(AgentStatus).toEqual(
      expect.objectContaining({
        IDLE: 'idle',
        RUNNING: 'running',
        PAUSED: 'paused',
        COMPLETED: 'completed',
        FAILED: 'failed',
      })
    );

    expect(ViewType).toEqual(
      expect.objectContaining({
        UPLOAD: 'upload',
        BRIEFING: 'briefing',
        SCRIPT_REVIEW: 'script_review',
        DESIGNER: 'designer',
      })
    );
  });
});
