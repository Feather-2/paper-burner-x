/** AgentCoordinator - 多 Agent Coordinator + Leader Election */

import { AgentStatus, AgentType, createAgentDescriptor } from './agent-registry.js';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('contracts/agent-coordinator');

const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_ASSIGN_INTERVAL_MS = 2000;

/** @typedef {{ emit: (event: string, payload?: unknown) => unknown }} EventBusLike */
/** @typedef {import('./agent-registry.js').AgentRegistry} AgentRegistry */
/** @typedef {import('./shared-task-board.js').SharedTaskBoard} SharedTaskBoard */
/** @typedef {{ agentId: string, registry: AgentRegistry, taskBoard?: SharedTaskBoard, events?: EventBusLike, heartbeatMs?: number, electionTimeoutMs?: number, assignIntervalMs?: number }} AgentCoordinatorOptions */

/** @param {unknown} v @returns {string | null} */
function str(v) { return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null; }
/** @param {unknown} v @param {number} fallback @param {number} min @returns {number} */
function ms(v, fallback, min = 100) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;
}
/** @param {unknown} obj @param {string} key @returns {boolean} */
function hasMethod(obj, key) { return !!obj && typeof obj === 'object' && typeof obj[key] === 'function'; }
/** @param {string} agentId @returns {import('./agent-registry.js').AgentDescriptor} */
function coordinatorDescriptor(agentId) {
  return createAgentDescriptor(agentId, `Coordinator ${agentId}`, AgentType.COORDINATOR, {
    status: AgentStatus.IDLE,
    capabilities: ['coordination', 'task-delegation', 'leader-election'],
    metadata: { role: 'coordinator' },
  });
}

export class AgentCoordinator {
  /** @param {AgentCoordinatorOptions} options */
  constructor(options) {
    const agentId = str(options?.agentId);
    if (!agentId) throw new Error('AgentCoordinator: options.agentId is required');
    if (!options?.registry || !hasMethod(options.registry, 'register') || !hasMethod(options.registry, 'list')) {
      throw new Error('AgentCoordinator: options.registry must be an AgentRegistry');
    }

    this._agentId = agentId;
    this._registry = options.registry;
    this._taskBoard = options.taskBoard ?? null;
    this._events = options.events ?? null;
    this.heartbeatMs = ms(options.heartbeatMs, DEFAULT_HEARTBEAT_MS);
    this.electionTimeoutMs = ms(options.electionTimeoutMs, this.heartbeatMs * 3);
    this.assignIntervalMs = ms(options.assignIntervalMs, DEFAULT_ASSIGN_INTERVAL_MS);

    this._started = false;
    this._leaderId = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._heartbeatTimer = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._electionTimer = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._assignTimer = null;
  }

  /** @returns {boolean} */
  get isLeader() { return this._started && this._leaderId === this._agentId; }

  /** @returns {string | null} */
  get leaderId() { return this._leaderId; }

  /** @returns {string} */
  get agentId() { return this._agentId; }

  /** @returns {boolean} */
  get started() { return this._started; }

  start() {
    if (this._started) return this;
    if (this._registry.lookup(this._agentId)) this._registry.unregister(this._agentId);
    this._registry.register(coordinatorDescriptor(this._agentId));
    this._started = true;

    this._startHeartbeat();
    this._startElectionLoop();
    this._startAssignmentLoop();
    this.electLeader();
    this._emit('coordinator:started', { agentId: this._agentId });
    return this;
  }

  stop() {
    this._clearTimers();
    const wasStarted = this._started;
    this._started = false;
    this._leaderId = null;
    this._registry.unregister(this._agentId);
    if (wasStarted) this._emit('coordinator:stopped', { agentId: this._agentId });
    return wasStarted;
  }

  /** @returns {string | null} */
  electLeader() {
    const now = Date.now();
    const coordinators = this._registry.list({ type: AgentType.COORDINATOR });
    const alive = coordinators.filter((agent) => agent.lastSeenAt + this.electionTimeoutMs >= now);
    alive.sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));

    const previousLeader = this._leaderId;
    const nextLeader = alive.length > 0 ? alive[0].agentId : null;
    this._leaderId = nextLeader;

    if (previousLeader !== nextLeader) {
      this._emit('coordinator:leader-changed', { previousLeader, newLeader: nextLeader });
      if (nextLeader) this._emit('coordinator:leader-elected', { leaderId: nextLeader });
    }
    return nextLeader;
  }

  /** @returns {number} */
  assignPendingTasks() {
    if (!this._started || !this.isLeader || !this._taskBoard) return 0;
    this._syncWorkerStatuses();
    const pending = this._taskBoard.listPending();
    if (pending.length === 0) return 0;

    const now = Date.now();
    const idleWorkers = this._registry
      .list({ type: AgentType.WORKER, status: AgentStatus.IDLE })
      .filter((worker) => worker.lastSeenAt + this.electionTimeoutMs >= now);
    if (idleWorkers.length === 0) return 0;

    let assigned = 0;
    for (let i = 0; i < pending.length && i < idleWorkers.length; i++) {
      const task = pending[i];
      const workerId = idleWorkers[i].agentId;
      const claimed = this._taskBoard.claim(task.id, workerId);
      if (!claimed.ok) continue;
      this._registry.updateStatus(workerId, AgentStatus.BUSY);
      this._emit('coordinator:task-assigned', { taskId: task.id, workerId });
      assigned++;
    }
    return assigned;
  }

  /** @returns {string[]} */
  handleLeaderFailover() {
    if (!this._started) return [];
    const stale = this._registry.getStaleAgents(this.electionTimeoutMs).filter((agent) => agent.agentId !== this._agentId);
    if (stale.length === 0) return [];

    const staleAgentIds = Array.from(new Set(stale.map((agent) => agent.agentId)));
    this._emit('coordinator:failover', { staleAgents: staleAgentIds });
    this._reclaimStaleTasks(staleAgentIds);
    if (this._leaderId && staleAgentIds.includes(this._leaderId)) this.electLeader();
    return staleAgentIds;
  }

  /** @returns {{ agentId: string, isLeader: boolean, leaderId: string | null, workerCount: number, pendingTasks: number, started: boolean }} */
  getStatus() {
    return {
      agentId: this._agentId,
      isLeader: this.isLeader,
      leaderId: this._leaderId,
      workerCount: this._registry.list({ type: AgentType.WORKER }).length,
      pendingTasks: this._taskBoard ? this._taskBoard.listPending().length : 0,
      started: this._started,
    };
  }

  dispose() {
    this.stop();
    this._events = null;
    this._taskBoard = null;
  }

  _startHeartbeat() {
    this._clearTimer('_heartbeatTimer');
    this._heartbeatTimer = setInterval(() => {
      if (!this._started) return;
      if (!this._registry.heartbeat(this._agentId)) {
        try {
          this._registry.register(coordinatorDescriptor(this._agentId));
        } catch (err) {
          logger.debug('Failed to re-register coordinator in heartbeat', { agentId: this._agentId, error: err.message });
        }
      }
    }, this.heartbeatMs);
  }

  _startElectionLoop() {
    this._clearTimer('_electionTimer');
    this._electionTimer = setInterval(() => {
      if (!this._started) return;
      this.handleLeaderFailover();
      this.electLeader();
    }, this.heartbeatMs);
  }

  _startAssignmentLoop() {
    this._clearTimer('_assignTimer');
    this._assignTimer = setInterval(() => {
      if (this._started && this.isLeader) this.assignPendingTasks();
    }, this.assignIntervalMs);
  }

  /** @returns {number} */
  _syncWorkerStatuses() {
    if (!this._taskBoard) return 0;
    const workers = this._registry.list({ type: AgentType.WORKER, status: AgentStatus.BUSY });
    if (workers.length === 0) return 0;

    let recovered = 0;
    for (const worker of workers) {
      const tasks = this._taskBoard.listByAgent(worker.agentId);
      const hasRunningTask = tasks.some((task) => task.status === 'running');
      if (hasRunningTask) continue;
      this._registry.updateStatus(worker.agentId, AgentStatus.IDLE);
      this._emit('coordinator:worker-idle', { workerId: worker.agentId });
      recovered++;
    }

    return recovered;
  }

  /** @param {string[]} staleAgentIds @returns {number} */
  _reclaimStaleTasks(staleAgentIds) {
    if (!this._taskBoard || !Array.isArray(staleAgentIds) || staleAgentIds.length === 0) return 0;
    let reclaimed = 0;
    for (const candidate of staleAgentIds) {
      const staleAgentId = str(candidate);
      if (!staleAgentId) continue;
      const tasks = this._taskBoard.listByAgent(staleAgentId);
      for (const task of tasks) {
        if (task.status !== 'running') continue;
        const cancelled = this._taskBoard.cancel(task.id, `stale agent: ${staleAgentId}`);
        if (!cancelled.ok) continue;
        const requeued = this._taskBoard.addTask({
          taskType: task.taskType,
          payload: task.payload,
          priority: task.priority,
          createdBy: task.createdBy || this._agentId,
        });
        if (!requeued.ok) continue;
        reclaimed++;
        this._emit('coordinator:task-reclaimed', { taskId: task.id, previousAgent: staleAgentId });
      }
    }
    return reclaimed;
  }

  _clearTimers() {
    this._clearTimer('_heartbeatTimer');
    this._clearTimer('_electionTimer');
    this._clearTimer('_assignTimer');
  }

  /** @param {'_heartbeatTimer' | '_electionTimer' | '_assignTimer'} key */
  _clearTimer(key) {
    const timer = this[key];
    if (timer) clearInterval(timer);
    this[key] = null;
  }

  /** @param {string} event @param {Record<string, unknown>} payload */
  _emit(event, payload) {
    if (!this._events || typeof this._events.emit !== 'function') return;
    try {
      this._events.emit(event, { actor: 'agent-coordinator', status: 'info', payload });
    } catch (err) {
      logger.debug('Event emission failed', { event, error: err.message });
    }
  }
}

/** @param {AgentCoordinatorOptions} options @returns {AgentCoordinator} */
export function createAgentCoordinator(options) {
  return new AgentCoordinator(options);
}
