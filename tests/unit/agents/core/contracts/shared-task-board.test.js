import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharedTaskBoard, TaskBoardEvents } from '../../../../../js/agents/core/contracts/shared-task-board.js';

describe('SharedTaskBoard', () => {
  /** @type {SharedTaskBoard} */
  let board;
  let eventBus;

  beforeEach(() => {
    eventBus = { emit: vi.fn() };
    board = new SharedTaskBoard({ eventBus, boardId: 'test-board' });
  });

  describe('addTask', () => {
    it('adds a task and returns ok', () => {
      const result = board.addTask({ taskType: 'search:execute', createdBy: 'agent-1' });
      expect(result.ok).toBe(true);
      expect(result.task.taskType).toBe('search:execute');
      expect(result.task.status).toBe('pending');
      expect(result.task.createdBy).toBe('agent-1');
      expect(result.task.claimedBy).toBeNull();
      expect(result.task.priority).toBe(5);
      expect(board.size).toBe(1);
    });

    it('emits TASK_ADDED event', () => {
      board.addTask({ taskType: 'search:execute', createdBy: 'agent-1' });
      expect(eventBus.emit).toHaveBeenCalledWith(
        TaskBoardEvents.TASK_ADDED,
        expect.objectContaining({ actor: 'taskboard', payload: expect.objectContaining({ boardId: 'test-board' }) })
      );
    });

    it('rejects missing taskType or createdBy', () => {
      expect(board.addTask({ createdBy: 'a' }).ok).toBe(false);
      expect(board.addTask({ taskType: 'x' }).ok).toBe(false);
      expect(board.addTask({}).ok).toBe(false);
    });

    it('rejects non domain:action taskType even when createdBy is provided', () => {
      const result = board.addTask({ taskType: 'invalid-format', createdBy: 'agent-1' });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('domain:action');
    });

    it('clamps priority to 0-10', () => {
      const r1 = board.addTask({ taskType: 'a:b', createdBy: 'x', priority: -5 });
      const r2 = board.addTask({ taskType: 'a:b', createdBy: 'x', priority: 99 });
      expect(r1.task.priority).toBe(0);
      expect(r2.task.priority).toBe(10);
    });

    it('stores payload', () => {
      const r = board.addTask({ taskType: 'a:b', createdBy: 'x', payload: { query: 'test' } });
      expect(r.task.payload).toEqual({ query: 'test' });
    });
  });

  describe('claim', () => {
    it('claims a pending task atomically', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      const result = board.claim(task.id, 'agent-2');
      expect(result.ok).toBe(true);
      expect(result.task.status).toBe('running');
      expect(result.task.claimedBy).toBe('agent-2');
      expect(result.task.claimedAt).toBeGreaterThan(0);
    });

    it('rejects double claim', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      const result = board.claim(task.id, 'agent-3');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not pending');
    });

    it('emits TASK_CLAIMED event', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      eventBus.emit.mockClear();
      board.claim(task.id, 'agent-2');
      expect(eventBus.emit).toHaveBeenCalledWith(
        TaskBoardEvents.TASK_CLAIMED,
        expect.objectContaining({ actor: 'taskboard' })
      );
    });

    it('rejects missing params', () => {
      expect(board.claim(null, 'a').ok).toBe(false);
      expect(board.claim('x', null).ok).toBe(false);
    });

    it('rejects non-existent task', () => {
      expect(board.claim('nope', 'agent-1').ok).toBe(false);
    });
  });

  describe('complete', () => {
    it('completes a running task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      const result = board.complete(task.id, { answer: 42 });
      expect(result.ok).toBe(true);
      expect(result.task.status).toBe('completed');
      expect(result.task.result).toEqual({ answer: 42 });
      expect(result.task.completedAt).toBeGreaterThan(0);
    });

    it('rejects completing a non-running task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      expect(board.complete(task.id).ok).toBe(false);
    });

    it('emits TASK_COMPLETED event', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      eventBus.emit.mockClear();
      board.complete(task.id, 'done');
      expect(eventBus.emit).toHaveBeenCalledWith(TaskBoardEvents.TASK_COMPLETED, expect.any(Object));
    });
  });

  describe('fail', () => {
    it('fails a running task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      const result = board.fail(task.id, 'timeout');
      expect(result.ok).toBe(true);
      expect(result.task.status).toBe('failed');
      expect(result.task.error).toBe('timeout');
    });

    it('defaults error to unknown', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      const result = board.fail(task.id);
      expect(result.task.error).toBe('unknown');
    });

    it('rejects failing a non-running task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      expect(board.fail(task.id, 'err').ok).toBe(false);
    });
  });

  describe('cancel', () => {
    it('cancels a pending task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      const result = board.cancel(task.id, 'no longer needed');
      expect(result.ok).toBe(true);
      expect(result.task.status).toBe('cancelled');
      expect(result.task.error).toBe('no longer needed');
    });

    it('cancels a running task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      const result = board.cancel(task.id);
      expect(result.ok).toBe(true);
      expect(result.task.status).toBe('cancelled');
    });

    it('rejects cancelling a terminal task', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'agent-1' });
      board.claim(task.id, 'agent-2');
      board.complete(task.id, 'done');
      expect(board.cancel(task.id).ok).toBe(false);
    });
  });

  describe('listPending', () => {
    it('returns pending tasks sorted by priority then createdAt', () => {
      board.addTask({ taskType: 'a:b', createdBy: 'x', priority: 3 });
      board.addTask({ taskType: 'c:d', createdBy: 'x', priority: 1 });
      board.addTask({ taskType: 'e:f', createdBy: 'x', priority: 3 });

      const pending = board.listPending();
      expect(pending).toHaveLength(3);
      expect(pending[0].priority).toBe(1);
      expect(pending[1].taskType).toBe('a:b');
      expect(pending[2].taskType).toBe('e:f');
    });

    it('excludes non-pending tasks', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'x' });
      board.addTask({ taskType: 'c:d', createdBy: 'x' });
      board.claim(task.id, 'agent-1');
      expect(board.listPending()).toHaveLength(1);
    });
  });

  describe('listByAgent', () => {
    it('returns tasks claimed by a specific agent', () => {
      const { task: t1 } = board.addTask({ taskType: 'a:b', createdBy: 'x' });
      const { task: t2 } = board.addTask({ taskType: 'c:d', createdBy: 'x' });
      board.addTask({ taskType: 'e:f', createdBy: 'x' });
      board.claim(t1.id, 'agent-1');
      board.claim(t2.id, 'agent-2');
      expect(board.listByAgent('agent-1')).toHaveLength(1);
      expect(board.listByAgent('agent-2')).toHaveLength(1);
      expect(board.listByAgent('agent-3')).toHaveLength(0);
    });

    it('returns empty for invalid agentId', () => {
      expect(board.listByAgent(null)).toHaveLength(0);
      expect(board.listByAgent('')).toHaveLength(0);
    });
  });

  describe('getTask', () => {
    it('returns cloned task by id', () => {
      const { task } = board.addTask({ taskType: 'a:b', createdBy: 'x' });
      const stored = board.getTask(task.id);
      expect(stored).toEqual(task);
      expect(stored).not.toBe(task);
    });

    it('returns null for unknown id', () => {
      expect(board.getTask('nope')).toBeNull();
    });

    it('does not allow external mutation through returned task objects', () => {
      const { task } = board.addTask({
        taskType: 'a:b',
        createdBy: 'x',
        payload: { nested: { value: 1 } },
      });

      const view = board.getTask(task.id);
      view.payload.nested.value = 999;

      const fresh = board.getTask(task.id);
      expect(fresh.payload.nested.value).toBe(1);
    });
  });

  describe('snapshot and restore', () => {
    it('creates and restores a snapshot', () => {
      board.addTask({ taskType: 'a:b', createdBy: 'x' });
      board.addTask({ taskType: 'c:d', createdBy: 'y' });
      const snapshot = board.getSnapshot();

      expect(snapshot.boardId).toBe('test-board');
      expect(snapshot.tasks).toHaveLength(2);
      expect(snapshot.ts).toBeGreaterThan(0);

      snapshot.tasks[0].status = 'failed';
      const fresh = board.getTask(snapshot.tasks[0].id);
      expect(fresh.status).toBe('pending');

      const board2 = new SharedTaskBoard();
      const result = board2.restore(snapshot);
      expect(result.ok).toBe(true);
      expect(result.count).toBe(2);
      expect(board2.size).toBe(2);
      expect(board2.boardId).toBe('test-board');
    });

    it('rejects invalid snapshot', () => {
      expect(board.restore(null).ok).toBe(false);
      expect(board.restore({}).ok).toBe(false);
      expect(board.restore({ tasks: 'bad' }).ok).toBe(false);
    });

    it('restore skips invalid tasks and normalizes valid entries', () => {
      const snapshot = {
        boardId: 'restored-board',
        tasks: [
          {
            id: 'task-ok',
            taskType: 'search:execute',
            status: 'pending',
            priority: 999,
            createdBy: 'agent-1',
            createdAt: 1000,
          },
          {
            id: 'task-bad-type',
            taskType: 'not-valid',
            status: 'pending',
            createdBy: 'agent-2',
            createdAt: 1001,
          },
          {
            id: 'task-bad-status',
            taskType: 'search:execute',
            status: 'unknown',
            createdBy: 'agent-3',
            createdAt: 1002,
          },
        ],
      };

      const result = board.restore(snapshot);
      expect(result).toEqual({ ok: true, count: 1 });
      expect(board.boardId).toBe('restored-board');

      const task = board.getTask('task-ok');
      expect(task).toBeTruthy();
      expect(task.priority).toBe(10);
      expect(task.status).toBe('pending');
      expect(board.getTask('task-bad-type')).toBeNull();
      expect(board.getTask('task-bad-status')).toBeNull();
    });
  });

  describe('dispose', () => {
    it('rejects operations after dispose', () => {
      board.dispose();
      expect(board.addTask({ taskType: 'a:b', createdBy: 'x' }).ok).toBe(false);
      expect(board.claim('x', 'y').ok).toBe(false);
      expect(board.complete('x').ok).toBe(false);
      expect(board.fail('x').ok).toBe(false);
      expect(board.cancel('x').ok).toBe(false);
      expect(board.restore({ tasks: [] }).ok).toBe(false);
    });

    it('clears tasks on dispose', () => {
      board.addTask({ taskType: 'a:b', createdBy: 'x' });
      expect(board.size).toBe(1);
      board.dispose();
      expect(board.size).toBe(0);
    });
  });

  describe('without eventBus', () => {
    it('works without eventBus', () => {
      const noEventBoard = new SharedTaskBoard();
      const result = noEventBoard.addTask({ taskType: 'a:b', createdBy: 'x' });
      expect(result.ok).toBe(true);
      noEventBoard.dispose();
    });
  });

  describe('TaskBoardEvents', () => {
    it('is frozen with expected values', () => {
      expect(Object.isFrozen(TaskBoardEvents)).toBe(true);
      expect(TaskBoardEvents.TASK_ADDED).toBe('taskboard:task:added');
      expect(TaskBoardEvents.TASK_CLAIMED).toBe('taskboard:task:claimed');
      expect(TaskBoardEvents.TASK_COMPLETED).toBe('taskboard:task:completed');
      expect(TaskBoardEvents.TASK_FAILED).toBe('taskboard:task:failed');
      expect(TaskBoardEvents.TASK_CANCELLED).toBe('taskboard:task:cancelled');
    });
  });
});
