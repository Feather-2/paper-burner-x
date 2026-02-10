import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TaskBoardOrchestratorBridge,
  createTaskBoardBridge,
} from '../../../../../js/agents/core/contracts/taskboard-orchestrator-bridge.js';
import {
  TaskBoardOrchestratorBridge as TaskBoardOrchestratorBridgeFromIndex,
  createTaskBoardBridge as createTaskBoardBridgeFromIndex,
} from '../../../../../js/agents/core/contracts/index.js';

let taskSeq = 0;

function makeEvents() {
  return { emit: vi.fn() };
}

function makeTask(overrides = {}) {
  taskSeq += 1;
  return {
    id: overrides.id ?? `task-${taskSeq}`,
    taskType: 'search:execute',
    payload: { q: taskSeq },
    status: 'pending',
    priority: 5,
    createdBy: 'user-1',
    claimedBy: null,
    createdAt: Date.now() + taskSeq,
    ...overrides,
  };
}

function makeOrchestrator() {
  return {
    registerStage: vi.fn(),
    runStage: vi.fn().mockResolvedValue({ ok: true }),
    eventBus: { emit: vi.fn() },
  };
}

function makeTaskBoard(initialTasks = []) {
  const tasks = new Map(initialTasks.map((task) => [task.id, { ...task }]));

  const board = {
    claim: vi.fn((taskId, agentId) => {
      const task = tasks.get(taskId);
      if (!task) return { ok: false, error: 'task not found' };
      if (task.status !== 'pending') return { ok: false, error: 'task not pending' };
      task.status = 'running';
      task.claimedBy = agentId;
      task.claimedAt = Date.now();
      return { ok: true, task };
    }),
    complete: vi.fn((taskId, result) => {
      const task = tasks.get(taskId);
      if (!task || task.status !== 'running') return { ok: false, error: 'task not running' };
      task.status = 'completed';
      task.result = result;
      return { ok: true, task };
    }),
    fail: vi.fn((taskId, error = 'unknown error') => {
      const task = tasks.get(taskId);
      if (!task) return { ok: false, error: 'task not found' };
      task.status = 'failed';
      task.error = error;
      return { ok: true, task };
    }),
    listPending: vi.fn(() =>
      Array.from(tasks.values())
        .filter((task) => task.status === 'pending')
        .sort((a, b) => (a.priority - b.priority) || (a.createdAt - b.createdAt))
    ),
    listByAgent: vi.fn((agentId) =>
      Array.from(tasks.values()).filter((task) => task.claimedBy === agentId)
    ),
    cancel: vi.fn((taskId, error = 'cancelled') => {
      const task = tasks.get(taskId);
      if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) {
        return { ok: false, error: 'cannot cancel' };
      }
      task.status = 'cancelled';
      task.error = error;
      return { ok: true, task };
    }),
    addTask: vi.fn((input) => {
      const task = makeTask({
        taskType: input.taskType,
        payload: input.payload,
        priority: input.priority ?? 5,
        createdBy: input.createdBy ?? 'agent-1',
      });
      tasks.set(task.id, task);
      return { ok: true, task };
    }),
    getTask: (id) => tasks.get(id) ?? null,
  };

  return board;
}

function makeBridge({
  orchestrator = makeOrchestrator(),
  taskBoard = makeTaskBoard(),
  events,
  taskTypeToStageMap,
  agentId = 'agent-1',
} = {}) {
  const options = { orchestrator, taskBoard, agentId };
  if (events) options.events = events;
  if (taskTypeToStageMap) options.taskTypeToStageMap = taskTypeToStageMap;
  return { bridge: new TaskBoardOrchestratorBridge(options), orchestrator, taskBoard, events };
}

describe('TaskBoardOrchestratorBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskSeq = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor validation', () => {
    it('throws if orchestrator is missing or invalid', () => {
      const taskBoard = makeTaskBoard();
      expect(() => new TaskBoardOrchestratorBridge({ taskBoard, agentId: 'agent-1' })).toThrow(/orchestrator/i);
      expect(() => new TaskBoardOrchestratorBridge({
        orchestrator: { registerStage: vi.fn() },
        taskBoard,
        agentId: 'agent-1',
      })).toThrow(/registerStage\/runStage/);
    });

    it('throws if taskBoard is missing or invalid', () => {
      const orchestrator = makeOrchestrator();
      expect(() => new TaskBoardOrchestratorBridge({ orchestrator, agentId: 'agent-1' })).toThrow(/taskBoard/i);
      expect(() => new TaskBoardOrchestratorBridge({
        orchestrator,
        taskBoard: { claim: vi.fn(), complete: vi.fn(), fail: vi.fn() },
        agentId: 'agent-1',
      })).toThrow(/SharedTaskBoard-like/i);
    });

    it('throws if agentId is missing or empty', () => {
      const orchestrator = makeOrchestrator();
      const taskBoard = makeTaskBoard();
      expect(() => new TaskBoardOrchestratorBridge({ orchestrator, taskBoard })).toThrow(/agentId/i);
      expect(() => new TaskBoardOrchestratorBridge({ orchestrator, taskBoard, agentId: '  ' })).toThrow(/agentId/i);
    });

    it('accepts valid options', () => {
      const bridge = createTaskBoardBridge({
        orchestrator: makeOrchestrator(),
        taskBoard: makeTaskBoard(),
        agentId: 'agent-1',
        events: makeEvents(),
      });

      expect(bridge).toBeInstanceOf(TaskBoardOrchestratorBridge);
      expect(bridge.agentId).toBe('agent-1');
      expect(bridge.activeTasks).toBe(0);
    });

    it('uses orchestrator.eventBus as fallback events', async () => {
      const task = makeTask();
      const taskBoard = makeTaskBoard([task]);
      const orchestrator = makeOrchestrator();
      const bridge = new TaskBoardOrchestratorBridge({ orchestrator, taskBoard, agentId: 'agent-1' });

      await bridge.claimAndRun(task.id);

      expect(orchestrator.eventBus.emit).toHaveBeenCalledWith(
        'bridge:task-started',
        expect.objectContaining({ payload: expect.objectContaining({ taskId: task.id }) })
      );
    });
  });

  describe('claimAndRun(taskId)', () => {
    it('claims task, runs stage, and completes task', async () => {
      const task = makeTask({ payload: { query: 'abc' } });
      const taskBoard = makeTaskBoard([task]);
      const orchestrator = makeOrchestrator();
      const events = makeEvents();
      orchestrator.runStage.mockResolvedValue({ answer: 42 });
      const { bridge } = makeBridge({ taskBoard, orchestrator, events });

      const result = await bridge.claimAndRun(task.id);

      expect(result).toEqual({ ok: true, result: { answer: 42 } });
      expect(taskBoard.claim).toHaveBeenCalledWith(task.id, 'agent-1');
      expect(orchestrator.runStage).toHaveBeenCalledWith('search:execute', expect.objectContaining({ payload: { query: 'abc' } }));
      expect(taskBoard.complete).toHaveBeenCalledWith(task.id, { answer: 42 });
      expect(events.emit).toHaveBeenCalledWith('bridge:task-started', expect.any(Object));
      expect(events.emit).toHaveBeenCalledWith('bridge:task-completed', expect.any(Object));
    });

    it('returns error if claim fails', async () => {
      const task = makeTask();
      const taskBoard = makeTaskBoard([task]);
      taskBoard.claim.mockReturnValue({ ok: false, error: 'already claimed' });
      const { bridge, orchestrator } = makeBridge({ taskBoard });

      const result = await bridge.claimAndRun(task.id);

      expect(result).toEqual({ ok: false, error: 'already claimed' });
      expect(orchestrator.runStage).not.toHaveBeenCalled();
      expect(taskBoard.complete).not.toHaveBeenCalled();
    });

    it('fails task on board and emits failure when stage throws', async () => {
      const task = makeTask();
      const taskBoard = makeTaskBoard([task]);
      const orchestrator = makeOrchestrator();
      const events = makeEvents();
      orchestrator.runStage.mockRejectedValue(new Error('boom'));
      const { bridge } = makeBridge({ taskBoard, orchestrator, events });

      const result = await bridge.claimAndRun(task.id);

      expect(result).toEqual({ ok: false, error: 'boom' });
      expect(taskBoard.fail).toHaveBeenCalledWith(task.id, 'boom');
      expect(events.emit).toHaveBeenCalledWith(
        'bridge:task-failed',
        expect.objectContaining({ payload: expect.objectContaining({ taskId: task.id, error: 'boom' }) })
      );
    });

    it('fails task if no stage mapping exists for taskType', async () => {
      const task = makeTask({ taskType: '   ' });
      const taskBoard = makeTaskBoard([task]);
      const events = makeEvents();
      const { bridge, orchestrator } = makeBridge({ taskBoard, events });

      const result = await bridge.claimAndRun(task.id);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('No stage mapping for task type');
      expect(taskBoard.fail).toHaveBeenCalledWith(task.id, expect.stringContaining('No stage mapping'));
      expect(orchestrator.runStage).not.toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith('bridge:task-failed', expect.any(Object));
    });

    it('tracks activeTasks while execution is in-flight', async () => {
      const task = makeTask();
      const taskBoard = makeTaskBoard([task]);
      const orchestrator = makeOrchestrator();
      let resolveRun;
      orchestrator.runStage.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
      const { bridge } = makeBridge({ taskBoard, orchestrator });

      const pending = bridge.claimAndRun(task.id);
      expect(bridge.activeTasks).toBe(1);

      resolveRun({ done: true });
      await pending;

      expect(bridge.activeTasks).toBe(0);
    });

    it('returns error when bridge is disposed', async () => {
      const task = makeTask();
      const taskBoard = makeTaskBoard([task]);
      const { bridge } = makeBridge({ taskBoard });
      bridge.dispose();

      await expect(bridge.claimAndRun(task.id)).resolves.toEqual({ ok: false, error: 'Bridge disposed' });
    });
  });

  describe('claimNext()', () => {
    it('picks first pending task and runs it', async () => {
      const taskA = makeTask({ id: 'task-a', createdAt: 1 });
      const taskB = makeTask({ id: 'task-b', createdAt: 2 });
      const taskBoard = makeTaskBoard([taskA, taskB]);
      const { bridge, taskBoard: board } = makeBridge({ taskBoard });

      const result = await bridge.claimNext();

      expect(result).toEqual({ ok: true, taskId: 'task-a' });
      expect(board.claim).toHaveBeenCalledWith('task-a', 'agent-1');
    });

    it('returns error if no pending tasks', async () => {
      const { bridge } = makeBridge({ taskBoard: makeTaskBoard() });
      await expect(bridge.claimNext()).resolves.toEqual({ ok: false, error: 'No pending task' });
    });

    it('returns error when disposed', async () => {
      const { bridge } = makeBridge();
      bridge.dispose();
      await expect(bridge.claimNext()).resolves.toEqual({ ok: false, error: 'Bridge disposed' });
    });
  });

  describe('pollAndRun()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('starts polling, drains tasks, returns stop function, and emits events', async () => {
      const task = makeTask();
      const events = makeEvents();
      const { bridge, taskBoard } = makeBridge({ taskBoard: makeTaskBoard([task]), events });

      const stop = bridge.pollAndRun({ intervalMs: 100, maxConcurrent: 1 });
      await Promise.resolve();

      expect(typeof stop).toBe('function');
      expect(taskBoard.claim).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith('bridge:poll-started', expect.any(Object));

      taskBoard.listPending.mockClear();
      stop();
      expect(events.emit).toHaveBeenCalledWith('bridge:poll-stopped', expect.any(Object));
      vi.advanceTimersByTime(500);
      expect(taskBoard.listPending).not.toHaveBeenCalled();
    });

    it('respects maxConcurrent limit', async () => {
      const tasks = [makeTask({ id: 't1' }), makeTask({ id: 't2' }), makeTask({ id: 't3' })];
      const taskBoard = makeTaskBoard(tasks);
      const orchestrator = makeOrchestrator();
      const resolvers = [];
      orchestrator.runStage.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
      const { bridge } = makeBridge({ taskBoard, orchestrator });

      const stop = bridge.pollAndRun({ intervalMs: 100, maxConcurrent: 2 });
      await Promise.resolve();

      expect(orchestrator.runStage).toHaveBeenCalledTimes(2);
      expect(bridge.activeTasks).toBe(2);

      resolvers.forEach((resolve) => resolve({ ok: true }));
      await Promise.resolve();
      stop();
    });

    it('does nothing when disposed', () => {
      const events = makeEvents();
      const taskBoard = makeTaskBoard([makeTask()]);
      const { bridge } = makeBridge({ taskBoard, events });
      bridge.dispose();

      const stop = bridge.pollAndRun({ intervalMs: 100, maxConcurrent: 2 });
      vi.advanceTimersByTime(500);

      expect(taskBoard.listPending).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalledWith('bridge:poll-started', expect.any(Object));
      stop();
    });
  });

  describe('registerTaskHandler()', () => {
    it('registers stage on orchestrator and maps taskType to stage name', async () => {
      const task = makeTask({ taskType: 'search:execute' });
      const taskBoard = makeTaskBoard([task]);
      const orchestrator = makeOrchestrator();
      const { bridge } = makeBridge({
        taskBoard,
        orchestrator,
        taskTypeToStageMap: { 'search:execute': 'stage.search.execute' },
      });

      const handler = vi.fn().mockResolvedValue({ ok: true });
      const stageName = bridge.registerTaskHandler('search:execute', handler);
      await bridge.claimAndRun(task.id);

      expect(stageName).toBe('stage.search.execute');
      expect(orchestrator.registerStage).toHaveBeenCalledWith('stage.search.execute', expect.any(Function));
      expect(orchestrator.runStage).toHaveBeenCalledWith('stage.search.execute', expect.any(Object));
    });

    it('throws if taskType is empty or handler is invalid', () => {
      const { bridge } = makeBridge();
      expect(() => bridge.registerTaskHandler('', vi.fn())).toThrow(/taskType required/);
      expect(() => bridge.registerTaskHandler('search:execute', null)).toThrow(/handler must be a function/);
    });
  });

  describe('reclaimAbandoned(staleAgentIds)', () => {
    it('reclaims running tasks of stale agents and skips own/non-running tasks', () => {
      const runningStale = makeTask({ id: 'stale-running', status: 'running', claimedBy: 'stale-1', priority: 1 });
      const doneStale = makeTask({ id: 'stale-done', status: 'completed', claimedBy: 'stale-1' });
      const ownRunning = makeTask({ id: 'own-running', status: 'running', claimedBy: 'agent-1' });
      const events = makeEvents();
      const { bridge, taskBoard } = makeBridge({
        taskBoard: makeTaskBoard([runningStale, doneStale, ownRunning]),
        events,
      });

      const result = bridge.reclaimAbandoned(['stale-1', 'agent-1']);

      expect(result).toEqual({ reclaimed: 1 });
      expect(taskBoard.cancel).toHaveBeenCalledTimes(1);
      expect(taskBoard.cancel).toHaveBeenCalledWith('stale-running', 'stale agent: stale-1');
      expect(taskBoard.addTask).toHaveBeenCalledWith(expect.objectContaining({
        taskType: runningStale.taskType,
        payload: runningStale.payload,
        priority: runningStale.priority,
      }));
      expect(taskBoard.listByAgent).toHaveBeenCalledWith('stale-1');
      expect(taskBoard.listByAgent).not.toHaveBeenCalledWith('agent-1');
      expect(events.emit).toHaveBeenCalledWith(
        'bridge:task-reclaimed',
        expect.objectContaining({ payload: expect.objectContaining({ taskId: 'stale-running' }) })
      );
    });
  });

  describe('getStatus()', () => {
    it('returns expected status shape and reflects polling state', () => {
      vi.useFakeTimers();
      const { bridge } = makeBridge({ taskTypeToStageMap: { 'search:execute': 'stage.search.execute' } });

      expect(bridge.getStatus()).toEqual({
        agentId: 'agent-1',
        activeTasks: 0,
        mappedTaskTypes: ['search:execute'],
        polling: { running: false, intervalMs: null, maxConcurrent: null },
      });

      const stop = bridge.pollAndRun({ intervalMs: 250, maxConcurrent: 3 });
      expect(bridge.getStatus().polling).toEqual({ running: true, intervalMs: 250, maxConcurrent: 3 });

      stop();
      expect(bridge.getStatus().polling).toEqual({ running: false, intervalMs: null, maxConcurrent: null });
    });
  });

  describe('dispose()', () => {
    it('stops polling, clears running tasks, and prevents further operations', async () => {
      vi.useFakeTimers();
      const task = makeTask();
      const taskBoard = makeTaskBoard([task]);
      const orchestrator = makeOrchestrator();
      const events = makeEvents();
      let resolveRun;
      orchestrator.runStage.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
      const { bridge } = makeBridge({ taskBoard, orchestrator, events });

      const running = bridge.claimAndRun(task.id);
      expect(bridge.activeTasks).toBe(1);
      bridge.pollAndRun({ intervalMs: 100, maxConcurrent: 1 });
      bridge.dispose();

      expect(bridge.activeTasks).toBe(0);
      expect(bridge.getStatus().polling.running).toBe(false);
      expect(events.emit).toHaveBeenCalledWith('bridge:poll-stopped', expect.any(Object));
      await expect(bridge.claimAndRun(task.id)).resolves.toEqual({ ok: false, error: 'Bridge disposed' });
      await expect(bridge.claimNext()).resolves.toEqual({ ok: false, error: 'Bridge disposed' });
      expect(bridge.reclaimAbandoned(['stale-1'])).toEqual({ reclaimed: 0 });

      resolveRun({ ok: true });
      await running;
    });
  });

  describe('barrel export', () => {
    it('index.js exports TaskBoardOrchestratorBridge and createTaskBoardBridge', () => {
      expect(TaskBoardOrchestratorBridgeFromIndex).toBe(TaskBoardOrchestratorBridge);
      expect(createTaskBoardBridgeFromIndex).toBe(createTaskBoardBridge);
    });
  });
});
