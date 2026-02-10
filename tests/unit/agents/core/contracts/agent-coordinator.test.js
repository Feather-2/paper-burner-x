import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentCoordinator,
  createAgentCoordinator,
} from '../../../../../js/agents/core/contracts/agent-coordinator.js';
import {
  AgentCoordinator as AgentCoordinatorFromIndex,
  createAgentCoordinator as createAgentCoordinatorFromIndex,
} from '../../../../../js/agents/core/contracts/index.js';
import {
  AgentRegistry,
  AgentType,
  AgentStatus,
  createAgentDescriptor,
} from '../../../../../js/agents/core/contracts/agent-registry.js';
import { SharedTaskBoard } from '../../../../../js/agents/core/contracts/shared-task-board.js';

const BASE_TS = 1700000000000;

function registerAgent(registry, {
  agentId,
  type,
  status,
  registeredAt = BASE_TS,
  lastSeenAt = BASE_TS,
  capabilities,
}) {
  return registry.register(createAgentDescriptor(agentId, `Agent ${agentId}`, type, {
    status,
    capabilities,
    registeredAt,
    lastSeenAt,
  }));
}

describe('AgentCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is exported from contracts/index.js', () => {
    expect(AgentCoordinatorFromIndex).toBe(AgentCoordinator);
    expect(createAgentCoordinatorFromIndex).toBe(createAgentCoordinator);
  });

  it('starts and stops coordinator lifecycle', () => {
    const registry = new AgentRegistry();
    const events = { emit: vi.fn() };
    const coordinator = createAgentCoordinator({
      agentId: 'coord-1',
      registry,
      events,
      heartbeatMs: 1000,
      assignIntervalMs: 1000,
      electionTimeoutMs: 3000,
    });

    expect(coordinator.started).toBe(false);
    coordinator.start();

    expect(coordinator.started).toBe(true);
    expect(registry.lookup('coord-1')?.type).toBe(AgentType.COORDINATOR);
    expect(events.emit).toHaveBeenCalledWith(
      'coordinator:started',
      expect.objectContaining({
        actor: 'agent-coordinator',
        payload: expect.objectContaining({ agentId: 'coord-1' }),
      })
    );

    const stopped = coordinator.stop();
    expect(stopped).toBe(true);
    expect(coordinator.started).toBe(false);
    expect(registry.lookup('coord-1')).toBeUndefined();
    expect(events.emit).toHaveBeenCalledWith(
      'coordinator:stopped',
      expect.objectContaining({ payload: expect.objectContaining({ agentId: 'coord-1' }) })
    );
  });

  it('elects lowest non-stale coordinator deterministically', () => {
    const registry = new AgentRegistry();
    const events = { emit: vi.fn() };

    registerAgent(registry, {
      agentId: 'coord-a',
      type: AgentType.COORDINATOR,
      status: AgentStatus.IDLE,
      lastSeenAt: BASE_TS - 10_000,
    });
    registerAgent(registry, {
      agentId: 'coord-b',
      type: AgentType.COORDINATOR,
      status: AgentStatus.IDLE,
      lastSeenAt: BASE_TS,
    });

    const coordinator = new AgentCoordinator({
      agentId: 'coord-c',
      registry,
      events,
      heartbeatMs: 1000,
      electionTimeoutMs: 3000,
    });

    coordinator.start();
    expect(coordinator.leaderId).toBe('coord-b');
    expect(coordinator.isLeader).toBe(false);

    events.emit.mockClear();
    vi.setSystemTime(BASE_TS + 200);
    registry.heartbeat('coord-a');
    const nextLeader = coordinator.electLeader();

    expect(nextLeader).toBe('coord-a');
    expect(coordinator.leaderId).toBe('coord-a');
    expect(events.emit).toHaveBeenCalledWith(
      'coordinator:leader-changed',
      expect.objectContaining({
        payload: expect.objectContaining({
          previousLeader: 'coord-b',
          newLeader: 'coord-a',
        }),
      })
    );
  });

  it('assigns pending tasks to idle workers when leader', () => {
    const registry = new AgentRegistry();
    const board = new SharedTaskBoard();
    const events = { emit: vi.fn() };

    registerAgent(registry, {
      agentId: 'worker-1',
      type: AgentType.WORKER,
      status: AgentStatus.IDLE,
      capabilities: ['search'],
    });
    registerAgent(registry, {
      agentId: 'worker-2',
      type: AgentType.WORKER,
      status: AgentStatus.IDLE,
      capabilities: ['search'],
    });

    const coordinator = new AgentCoordinator({
      agentId: 'coord-1',
      registry,
      taskBoard: board,
      events,
      heartbeatMs: 1000,
      electionTimeoutMs: 3000,
      assignIntervalMs: 1000,
    });

    coordinator.start();
    expect(coordinator.isLeader).toBe(true);

    const t1 = board.addTask({ taskType: 'search:execute', createdBy: 'user-1' }).task;
    const t2 = board.addTask({ taskType: 'search:execute', createdBy: 'user-1' }).task;
    board.addTask({ taskType: 'search:execute', createdBy: 'user-1' });

    const assigned = coordinator.assignPendingTasks();

    expect(assigned).toBe(2);
    expect(board.getTask(t1.id)?.status).toBe('running');
    expect(board.getTask(t2.id)?.status).toBe('running');
    expect(board.listPending()).toHaveLength(1);
    expect(registry.lookup('worker-1')?.status).toBe(AgentStatus.BUSY);
    expect(registry.lookup('worker-2')?.status).toBe(AgentStatus.BUSY);
    expect(events.emit).toHaveBeenCalledWith(
      'coordinator:task-assigned',
      expect.objectContaining({
        payload: expect.objectContaining({ taskId: t1.id, workerId: 'worker-1' }),
      })
    );
  });

  it('handles leader failover and reclaims stale worker tasks', () => {
    const registry = new AgentRegistry();
    const board = new SharedTaskBoard();
    const events = { emit: vi.fn() };

    registerAgent(registry, {
      agentId: 'coord-a',
      type: AgentType.COORDINATOR,
      status: AgentStatus.IDLE,
      lastSeenAt: BASE_TS,
    });
    registerAgent(registry, {
      agentId: 'worker-1',
      type: AgentType.WORKER,
      status: AgentStatus.BUSY,
      lastSeenAt: BASE_TS,
    });

    const coordinator = new AgentCoordinator({
      agentId: 'coord-b',
      registry,
      taskBoard: board,
      events,
      heartbeatMs: 10_000,
      electionTimeoutMs: 3_000,
      assignIntervalMs: 10_000,
    });

    coordinator.start();
    expect(coordinator.leaderId).toBe('coord-a');

    const { task } = board.addTask({ taskType: 'search:execute', createdBy: 'user-1', priority: 1 });
    board.claim(task.id, 'worker-1');

    vi.setSystemTime(BASE_TS + 4_000);
    registry.heartbeat('coord-b');

    const staleAgents = coordinator.handleLeaderFailover();

    expect(staleAgents).toEqual(expect.arrayContaining(['coord-a', 'worker-1']));
    expect(coordinator.leaderId).toBe('coord-b');
    expect(board.getTask(task.id)?.status).toBe('cancelled');
    expect(board.listPending()).toHaveLength(1);
    expect(events.emit).toHaveBeenCalledWith(
      'coordinator:task-reclaimed',
      expect.objectContaining({
        payload: expect.objectContaining({
          taskId: task.id,
          previousAgent: 'worker-1',
        }),
      })
    );
    expect(events.emit).toHaveBeenCalledWith(
      'coordinator:failover',
      expect.objectContaining({
        payload: expect.objectContaining({ staleAgents: expect.arrayContaining(['coord-a', 'worker-1']) }),
      })
    );
  });
});
