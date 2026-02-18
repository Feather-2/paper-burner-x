/**
 * SharedTaskBoard - 跨 Agent 共享任务列表 + Claim 语义
 *
 * 受 Claude Agent Teams 共享任务可见性启发。
 * 多个 Agent 可以：
 * - addTask(): 发布任务到共享面板
 * - claim(taskId, agentId): 认领任务（原子性，防止重复认领）
 * - complete(taskId, result): 标记完成
 * - fail(taskId, error): 标记失败
 * - listPending(): 查看待认领任务
 * - getSnapshot(): 获取完整快照（用于持久化）
 *
 * 设计原则：
 * - 纯内存实现，通过 getSnapshot/restore 支持持久化
 * - EventBus 通知（可选），不强依赖
 * - 线程安全语义：claim 是原子操作
 * - 与 agent-message.js 的 TaskStatus 复用状态枚举
 */

import { TaskStatus } from './agent-message.js';
import { deepClone } from '../../shared/utils/value-utils.js';

// ─── 常量 ───────────────────────────────────────────────

export const TaskBoardEvents = Object.freeze({
  TASK_ADDED: 'taskboard:task:added',
  TASK_CLAIMED: 'taskboard:task:claimed',
  TASK_COMPLETED: 'taskboard:task:completed',
  TASK_FAILED: 'taskboard:task:failed',
  TASK_CANCELLED: 'taskboard:task:cancelled',
});

// ─── 内部工具 ───────────────────────────────────────────

/** @param {unknown} v @returns {string | null} */
function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

let _counter = 0;
function createTaskId() {
  const c = globalThis?.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `task_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
}

/** @param {BoardTask} task @returns {BoardTask} */
function cloneTask(task) {
  return deepClone(task);
}

/** @param {BoardTask[]} tasks @returns {BoardTask[]} */
function cloneTasks(tasks) {
  return tasks.map((task) => cloneTask(task));
}

// ─── 类型定义 ───────────────────────────────────────────

/**
 * @typedef {Object} BoardTask
 * @property {string} id
 * @property {string} taskType - domain:action 格式
 * @property {unknown} payload
 * @property {typeof TaskStatus[number]} status
 * @property {number} priority - 0=最高, 默认 5
 * @property {string} createdBy - 创建者 agentId
 * @property {string | null} claimedBy - 认领者 agentId
 * @property {unknown} [result] - 完成结果
 * @property {string | null} [error] - 失败原因
 * @property {number} createdAt
 * @property {number} [claimedAt]
 * @property {number} [completedAt]
 */

/**
 * @typedef {Object} SharedTaskBoardOptions
 * @property {import('../event-bus.js').EventBus} [eventBus]
 * @property {string} [boardId]
 */

// ─── SharedTaskBoard ────────────────────────────────────

export class SharedTaskBoard {
  /**
   * @param {SharedTaskBoardOptions} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, BoardTask>} */
    this._tasks = new Map();
    this._eventBus = options?.eventBus ?? null;
    this.boardId = str(options?.boardId) || 'default';
    this.disposed = false;
  }

  /**
   * Add a task to the board.
   * @param {{ taskType: string, payload?: unknown, priority?: number, createdBy: string }} params
   * @returns {{ ok: true, task: BoardTask } | { ok: false, error: string }}
   */
  addTask(params) {
    if (this.disposed) return { ok: false, error: 'Board disposed' };
    const taskType = str(params?.taskType);
    if (!taskType) return { ok: false, error: 'taskType required' };
    const createdBy = str(params?.createdBy);
    if (!createdBy) return { ok: false, error: 'createdBy required' };

    const priority = typeof params?.priority === 'number' && Number.isFinite(params.priority)
      ? Math.max(0, Math.min(10, Math.floor(params.priority)))
      : 5;

    /** @type {BoardTask} */
    const task = {
      id: createTaskId(),
      taskType,
      payload: params?.payload ?? null,
      status: 'pending',
      priority,
      createdBy,
      claimedBy: null,
      error: null,
      createdAt: Date.now(),
    };

    this._tasks.set(task.id, task);
    this._emit(TaskBoardEvents.TASK_ADDED, { task });
    return { ok: true, task: cloneTask(task) };
  }

  /**
   * Claim a pending task (atomic — first claimer wins).
   * @param {string} taskId
   * @param {string} agentId
   * @returns {{ ok: true, task: BoardTask } | { ok: false, error: string }}
   */
  claim(taskId, agentId) {
    if (this.disposed) return { ok: false, error: 'Board disposed' };
    const id = str(taskId);
    const agent = str(agentId);
    if (!id || !agent) return { ok: false, error: 'taskId and agentId required' };

    const task = this._tasks.get(id);
    if (!task) return { ok: false, error: `Task not found: ${id}` };
    if (task.status !== 'pending') return { ok: false, error: `Task not pending: ${task.status}` };

    task.status = 'running';
    task.claimedBy = agent;
    task.claimedAt = Date.now();

    this._emit(TaskBoardEvents.TASK_CLAIMED, { task });
    return { ok: true, task: cloneTask(task) };
  }

  /**
   * Mark a claimed task as completed.
   * @param {string} taskId
   * @param {unknown} [result]
   * @returns {{ ok: true, task: BoardTask } | { ok: false, error: string }}
   */
  complete(taskId, result) {
    if (this.disposed) return { ok: false, error: 'Board disposed' };
    const id = str(taskId);
    if (!id) return { ok: false, error: 'taskId required' };

    const task = this._tasks.get(id);
    if (!task) return { ok: false, error: `Task not found: ${id}` };
    if (task.status !== 'running') return { ok: false, error: `Task not running: ${task.status}` };

    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();

    this._emit(TaskBoardEvents.TASK_COMPLETED, { task });
    return { ok: true, task: cloneTask(task) };
  }

  /**
   * Mark a claimed task as failed.
   * @param {string} taskId
   * @param {string} [error]
   * @returns {{ ok: true, task: BoardTask } | { ok: false, error: string }}
   */
  fail(taskId, error) {
    if (this.disposed) return { ok: false, error: 'Board disposed' };
    const id = str(taskId);
    if (!id) return { ok: false, error: 'taskId required' };

    const task = this._tasks.get(id);
    if (!task) return { ok: false, error: `Task not found: ${id}` };
    if (task.status !== 'running') return { ok: false, error: `Task not running: ${task.status}` };

    task.status = 'failed';
    task.error = str(error) || 'unknown';
    task.completedAt = Date.now();

    this._emit(TaskBoardEvents.TASK_FAILED, { task });
    return { ok: true, task: cloneTask(task) };
  }

  /**
   * Cancel a pending or running task.
   * @param {string} taskId
   * @param {string} [reason]
   * @returns {{ ok: true, task: BoardTask } | { ok: false, error: string }}
   */
  cancel(taskId, reason) {
    if (this.disposed) return { ok: false, error: 'Board disposed' };
    const id = str(taskId);
    if (!id) return { ok: false, error: 'taskId required' };

    const task = this._tasks.get(id);
    if (!task) return { ok: false, error: `Task not found: ${id}` };
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return { ok: false, error: `Task already terminal: ${task.status}` };
    }

    task.status = 'cancelled';
    task.error = str(reason) || 'cancelled';
    task.completedAt = Date.now();

    this._emit(TaskBoardEvents.TASK_CANCELLED, { task });
    return { ok: true, task: cloneTask(task) };
  }

  /**
   * List all pending tasks sorted by priority (lowest number = highest priority).
   * @returns {BoardTask[]}
   */
  listPending() {
    const pending = [];
    for (const task of this._tasks.values()) {
      if (task.status === 'pending') pending.push(task);
    }
    pending.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
    return cloneTasks(pending);
  }

  /**
   * List tasks claimed by a specific agent.
   * @param {string} agentId
   * @returns {BoardTask[]}
   */
  listByAgent(agentId) {
    const agent = str(agentId);
    if (!agent) return [];
    const result = [];
    for (const task of this._tasks.values()) {
      if (task.claimedBy === agent) result.push(task);
    }
    return cloneTasks(result);
  }

  /**
   * Get a task by ID.
   * @param {string} taskId
   * @returns {BoardTask | null}
   */
  getTask(taskId) {
    const task = this._tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  /** @returns {number} */
  get size() { return this._tasks.size; }

  /**
   * Get a serializable snapshot of all tasks.
   * @returns {{ boardId: string, tasks: BoardTask[], ts: number }}
   */
  getSnapshot() {
    return {
      boardId: this.boardId,
      tasks: cloneTasks(Array.from(this._tasks.values())),
      ts: Date.now(),
    };
  }

  /**
   * Restore from a snapshot.
   * @param {{ boardId?: string, tasks: Array<BoardTask> }} snapshot
   * @returns {{ ok: true, count: number } | { ok: false, error: string }}
   */
  restore(snapshot) {
    if (this.disposed) return { ok: false, error: 'Board disposed' };
    if (!snapshot || !Array.isArray(snapshot.tasks)) return { ok: false, error: 'Invalid snapshot' };

    this._tasks.clear();
    let count = 0;
    for (const task of snapshot.tasks) {
      if (task && typeof task === 'object' && str(task.id)) {
        this._tasks.set(task.id, cloneTask(task));
        count++;
      }
    }
    if (str(snapshot.boardId)) this.boardId = snapshot.boardId;
    return { ok: true, count };
  }

  /**
   * @param {string} eventName
   * @param {Record<string, unknown>} payload
   */
  _emit(eventName, payload) {
    if (!this._eventBus || typeof this._eventBus.emit !== 'function') return;
    try {
      const safePayload = deepClone(payload);
      this._eventBus.emit(eventName, {
        actor: 'taskboard',
        status: 'info',
        payload: { ...safePayload, boardId: this.boardId },
      });
    } catch {
      // best-effort
    }
  }

  dispose() {
    this.disposed = true;
    this._tasks.clear();
    this._eventBus = null;
  }
}
