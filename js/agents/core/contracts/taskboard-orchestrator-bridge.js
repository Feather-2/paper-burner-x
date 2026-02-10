/** TaskBoardOrchestratorBridge - SharedTaskBoard 与 Orchestrator 桥接器 */
/** @typedef {{ emit: (event: string, payload?: unknown) => unknown }} EventBusLike */
/** @typedef {import('./shared-task-board.js').SharedTaskBoard} SharedTaskBoard */
/** @typedef {{ id: string, taskType: string, payload: unknown, status: string, priority: number, createdBy: string, claimedBy: string | null, createdAt: number }} BoardTask */
/** @typedef {{ registerStage: (name: string, handler: (ctx: any, input: any, api: any) => Promise<any>, options?: Record<string, unknown>) => void, runStage: (name: string, input?: any) => Promise<any>, eventBus?: EventBusLike }} OrchestratorLike */
/** @typedef {{ orchestrator: OrchestratorLike, taskBoard: SharedTaskBoard, agentId: string, events?: EventBusLike, taskTypeToStageMap?: Record<string, string> }} TaskBoardBridgeOptions */

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_CONCURRENT = 1;

/** @param {unknown} v @returns {string | null} */
function str(v) { return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null; }
/** @param {unknown} v @param {number} fallback @param {number} min @returns {number} */
function num(v, fallback, min = 1) { return typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback; }
/** @param {unknown} obj @param {string} key @returns {boolean} */
function hasMethod(obj, key) { return !!obj && typeof obj === 'object' && typeof obj[key] === 'function'; }
/** @param {unknown} error @returns {string} */
function toError(error) { return str(error?.message) || String(error); }

export class TaskBoardOrchestratorBridge {
  /** @param {TaskBoardBridgeOptions} options */
  constructor(options) {
    const orchestrator = options?.orchestrator;
    if (!orchestrator || !hasMethod(orchestrator, 'registerStage') || !hasMethod(orchestrator, 'runStage')) {
      throw new Error('TaskBoardOrchestratorBridge: options.orchestrator must provide registerStage/runStage');
    }
    const taskBoard = options?.taskBoard;
    if (!taskBoard || !hasMethod(taskBoard, 'claim') || !hasMethod(taskBoard, 'complete') || !hasMethod(taskBoard, 'fail') || !hasMethod(taskBoard, 'listPending')) {
      throw new Error('TaskBoardOrchestratorBridge: options.taskBoard must be a SharedTaskBoard-like instance');
    }
    const agentId = str(options?.agentId);
    if (!agentId) throw new Error('TaskBoardOrchestratorBridge: options.agentId is required');

    this._orchestrator = orchestrator;
    this._taskBoard = taskBoard;
    this._agentId = agentId;
    this._events = options?.events ?? orchestrator?.eventBus ?? null;
    this._disposed = false;
    /** @type {Map<string, string>} */
    this._taskTypeToStageMap = new Map();
    if (options?.taskTypeToStageMap && typeof options.taskTypeToStageMap === 'object') {
      for (const [taskTypeRaw, stageRaw] of Object.entries(options.taskTypeToStageMap)) {
        const taskType = str(taskTypeRaw);
        const stage = str(stageRaw);
        if (taskType && stage) this._taskTypeToStageMap.set(taskType, stage);
      }
    }
    /** @type {Set<string>} */
    this._runningTaskIds = new Set();
    /** @type {ReturnType<typeof setInterval> | null} */
    this._pollTimer = null;
    this._pollTickRunning = false;
    this._pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    this._pollMaxConcurrent = DEFAULT_MAX_CONCURRENT;
  }

  /** @returns {string} */
  get agentId() { return this._agentId; }
  /** @returns {number} */
  get activeTasks() { return this._runningTaskIds.size; }

  /** @param {string} taskId @returns {Promise<{ ok: boolean, error?: string, result?: unknown }>} */
  async claimAndRun(taskId) {
    if (this._disposed) return { ok: false, error: 'Bridge disposed' };
    const id = str(taskId);
    if (!id) return { ok: false, error: 'taskId required' };

    const claimed = this._taskBoard.claim(id, this._agentId);
    if (!claimed.ok) return { ok: false, error: claimed.error };

    const task = claimed.task;
    const stageName = this._taskTypeToStageMap.get(task.taskType) || task.taskType;
    if (!str(stageName)) {
      const error = `No stage mapping for task type: ${String(task.taskType)}`;
      this._taskBoard.fail(id, error);
      this._emit('bridge:task-failed', { taskId: id, taskType: task.taskType, agentId: this._agentId, error });
      return { ok: false, error };
    }

    const startedAt = Date.now();
    this._runningTaskIds.add(id);
    this._emit('bridge:task-started', { taskId: id, taskType: task.taskType, agentId: this._agentId });

    try {
      const result = await this._orchestrator.runStage(stageName, { task, payload: task.payload });
      const completed = this._taskBoard.complete(id, result);
      if (!completed.ok) {
        const error = `Task stage succeeded but complete() failed: ${completed.error}`;
        this._emit('bridge:task-failed', { taskId: id, taskType: task.taskType, agentId: this._agentId, error });
        return { ok: false, error, result };
      }
      this._emit('bridge:task-completed', { taskId: id, taskType: task.taskType, agentId: this._agentId, durationMs: Date.now() - startedAt });
      return { ok: true, result };
    } catch (error) {
      const message = toError(error);
      this._taskBoard.fail(id, message);
      this._emit('bridge:task-failed', { taskId: id, taskType: task.taskType, agentId: this._agentId, error: message });
      return { ok: false, error: message };
    } finally {
      this._runningTaskIds.delete(id);
    }
  }

  /** @returns {Promise<{ ok: boolean, taskId?: string, error?: string }>} */
  async claimNext() {
    if (this._disposed) return { ok: false, error: 'Bridge disposed' };
    const task = this._taskBoard.listPending()[0];
    if (!task) return { ok: false, error: 'No pending task' };
    const result = await this.claimAndRun(task.id);
    return { ok: result.ok, taskId: task.id, ...(result.error ? { error: result.error } : {}) };
  }

  /** @param {{ intervalMs?: number, maxConcurrent?: number }} [options] @returns {() => void} */
  pollAndRun(options = {}) {
    if (this._disposed) return () => {};
    this._stopPolling();

    this._pollIntervalMs = num(options.intervalMs, DEFAULT_POLL_INTERVAL_MS, 100);
    this._pollMaxConcurrent = num(options.maxConcurrent, DEFAULT_MAX_CONCURRENT, 1);
    this._pollTimer = setInterval(() => { void this._drainPending(); }, this._pollIntervalMs);

    void this._drainPending();
    this._emit('bridge:poll-started', { agentId: this._agentId, intervalMs: this._pollIntervalMs, maxConcurrent: this._pollMaxConcurrent });
    return () => { this._stopPolling(); };
  }

  /** @param {string} taskType @param {(task: BoardTask, stageApi: any) => Promise<unknown>} handler @returns {string} */
  registerTaskHandler(taskType, handler) {
    const type = str(taskType);
    if (!type) throw new Error('registerTaskHandler: taskType required');
    if (typeof handler !== 'function') throw new Error('registerTaskHandler: handler must be a function');

    const stageName = this._taskTypeToStageMap.get(type) || type;
    this._orchestrator.registerStage(stageName, async (_ctx, input, stageApi) => {
      const fallbackTask = /** @type {BoardTask} */ ({ id: '', taskType: type, payload: input?.payload ?? input, status: 'running', priority: 5, createdBy: this._agentId, claimedBy: this._agentId, createdAt: Date.now() });
      const task = input?.task && typeof input.task === 'object' ? input.task : fallbackTask;
      return handler(task, stageApi);
    });
    this._taskTypeToStageMap.set(type, stageName);
    return stageName;
  }

  /** @param {string[]} staleAgentIds @returns {{ reclaimed: number }} */
  reclaimAbandoned(staleAgentIds) {
    if (this._disposed || !Array.isArray(staleAgentIds) || staleAgentIds.length === 0) return { reclaimed: 0 };
    let reclaimed = 0;

    for (const candidate of staleAgentIds) {
      const staleAgentId = str(candidate);
      if (!staleAgentId || staleAgentId === this._agentId) continue;
      const tasks = this._taskBoard.listByAgent(staleAgentId);
      for (const task of tasks) {
        if (task.status !== 'running') continue;
        const cancelled = this._taskBoard.cancel(task.id, `stale agent: ${staleAgentId}`);
        if (!cancelled.ok) continue;
        const requeued = this._taskBoard.addTask({ taskType: task.taskType, payload: task.payload, priority: task.priority, createdBy: task.createdBy || this._agentId });
        if (!requeued.ok) continue;
        reclaimed++;
        this._emit('bridge:task-reclaimed', { taskId: task.id, previousAgent: staleAgentId });
      }
    }
    return { reclaimed };
  }

  /** @returns {{ agentId: string, activeTasks: number, mappedTaskTypes: string[], polling: { running: boolean, intervalMs: number | null, maxConcurrent: number | null } }} */
  getStatus() {
    return {
      agentId: this._agentId,
      activeTasks: this.activeTasks,
      mappedTaskTypes: Array.from(this._taskTypeToStageMap.keys()),
      polling: { running: !!this._pollTimer, intervalMs: this._pollTimer ? this._pollIntervalMs : null, maxConcurrent: this._pollTimer ? this._pollMaxConcurrent : null },
    };
  }

  dispose() {
    if (this._disposed) return;
    this._stopPolling();
    this._disposed = true;
    this._runningTaskIds.clear();
    this._events = null;
  }

  async _drainPending() {
    if (this._disposed || !this._pollTimer || this._pollTickRunning) return;
    this._pollTickRunning = true;
    try {
      const pending = this._taskBoard.listPending();
      for (let i = 0; i < pending.length && this.activeTasks < this._pollMaxConcurrent; i++) void this.claimAndRun(pending[i].id);
    } finally {
      this._pollTickRunning = false;
    }
  }

  _stopPolling() {
    if (!this._pollTimer) return false;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._emit('bridge:poll-stopped', { agentId: this._agentId });
    return true;
  }

  /** @param {string} event @param {Record<string, unknown>} payload */
  _emit(event, payload) {
    if (!this._events || typeof this._events.emit !== 'function') return;
    try { this._events.emit(event, { actor: 'taskboard-bridge', status: 'info', payload }); } catch {}
  }
}

/** @param {TaskBoardBridgeOptions} options @returns {TaskBoardOrchestratorBridge} */
export function createTaskBoardBridge(options) { return new TaskBoardOrchestratorBridge(options); }
