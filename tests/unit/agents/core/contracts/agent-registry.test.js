import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentRegistry,
  AgentType,
  AgentStatus,
  AGENT_TYPES,
  AGENT_STATUSES,
  createAgentDescriptor,
  validateAgentDescriptor,
  isValidAgentType,
  isValidAgentStatus,
} from '../../../../../js/agents/core/contracts/agent-registry.js';
import {
  AgentRegistry as AgentRegistryFromIndex,
  createAgentDescriptor as createAgentDescriptorFromIndex,
} from '../../../../../js/agents/core/contracts/index.js';

const BASE_TS = 1700000000000;

function makeDescriptor(agentId, options = {}) {
  return createAgentDescriptor(agentId, `Agent ${agentId}`, options.type ?? AgentType.WORKER, {
    status: options.status ?? AgentStatus.IDLE,
    capabilities: options.capabilities,
    metadata: options.metadata,
    registeredAt: options.registeredAt ?? BASE_TS,
    lastSeenAt: options.lastSeenAt ?? BASE_TS,
  });
}

describe('agent-registry constants and validators', () => {
  it('is exported from contracts/index.js', () => {
    expect(AgentRegistryFromIndex).toBe(AgentRegistry);
    expect(createAgentDescriptorFromIndex).toBe(createAgentDescriptor);
  });

  it('exposes expected constants', () => {
    expect(AgentType.WORKER).toBe('worker');
    expect(AgentType.COORDINATOR).toBe('coordinator');
    expect(AgentType.SPECIALIST).toBe('specialist');
    expect(AgentType.OBSERVER).toBe('observer');
    expect(AgentStatus.IDLE).toBe('idle');
    expect(AgentStatus.BUSY).toBe('busy');
    expect(AgentStatus.STOPPED).toBe('stopped');
    expect(AgentStatus.DEGRADED).toBe('degraded');
    expect(AGENT_TYPES.has('worker')).toBe(true);
    expect(AGENT_STATUSES.has('busy')).toBe(true);
  });

  it('validates type and status correctly', () => {
    expect(isValidAgentType('worker')).toBe(true);
    expect(isValidAgentType('bad')).toBe(false);
    expect(isValidAgentStatus('idle')).toBe(true);
    expect(isValidAgentStatus('running')).toBe(false);
  });

  it('validates descriptor fields', () => {
    const ok = validateAgentDescriptor(makeDescriptor('a1'));
    expect(ok.valid).toBe(true);
    expect(ok.errors).toEqual([]);

    const bad = validateAgentDescriptor({ agentId: '', type: 'x', status: 'y' });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('creates descriptor with defaults and normalized capabilities', () => {
    const descriptor = createAgentDescriptor('a-1', 'Agent One', AgentType.SPECIALIST, {
      capabilities: [' search ', '', 'search', 'review'],
    });

    expect(descriptor.status).toBe(AgentStatus.IDLE);
    expect(descriptor.capabilities).toEqual(['search', 'review']);
    expect(descriptor.registeredAt).toBeGreaterThan(0);
    expect(descriptor.lastSeenAt).toBeGreaterThanOrEqual(descriptor.registeredAt);
  });
});

describe('AgentRegistry', () => {
  let events;
  /** @type {AgentRegistry} */
  let registry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TS);
    events = { emit: vi.fn() };
    registry = new AgentRegistry({ events, maxAgents: 2 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers, looks up, and emits agent:registered', () => {
    const registered = registry.register(makeDescriptor('a1', { capabilities: ['search'] }));

    expect(registered.agentId).toBe('a1');
    expect(registry.size).toBe(1);

    const lookedUp = registry.lookup('a1');
    expect(lookedUp).toEqual(registered);

    lookedUp.name = 'mutated';
    expect(registry.lookup('a1').name).toBe('Agent a1');

    expect(events.emit).toHaveBeenCalledWith(
      'agent:registered',
      expect.objectContaining({
        actor: 'agent-registry',
        status: 'info',
        payload: expect.objectContaining({ agent: expect.objectContaining({ agentId: 'a1' }) }),
      })
    );
  });

  it('throws on duplicate registration and maxAgents overflow', () => {
    registry.register(makeDescriptor('a1'));
    expect(() => registry.register(makeDescriptor('a1'))).toThrow(/duplicate agentId/);

    registry.register(makeDescriptor('a2'));
    expect(() => registry.register(makeDescriptor('a3'))).toThrow(/maxAgents exceeded/);
  });

  it('supports filtering by type, status, and capability', () => {
    registry.register(makeDescriptor('a1', { type: AgentType.WORKER, capabilities: ['search'] }));
    registry.register(makeDescriptor('a2', {
      type: AgentType.COORDINATOR,
      status: AgentStatus.BUSY,
      capabilities: ['generate'],
    }));

    expect(registry.list()).toHaveLength(2);
    expect(registry.list({ type: AgentType.WORKER })).toHaveLength(1);
    expect(registry.list({ status: AgentStatus.BUSY })).toHaveLength(1);
    expect(registry.list({ capability: 'search' })).toHaveLength(1);
    expect(registry.findByType(AgentType.COORDINATOR)).toHaveLength(1);
    expect(registry.findByCapability('generate')).toHaveLength(1);
  });

  it('unregisters and emits agent:unregistered', () => {
    registry.register(makeDescriptor('a1'));

    const removed = registry.unregister('a1');
    expect(removed).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.lookup('a1')).toBeUndefined();

    expect(events.emit).toHaveBeenCalledWith(
      'agent:unregistered',
      expect.objectContaining({
        payload: expect.objectContaining({ agentId: 'a1' }),
      })
    );
  });

  it('updates status, updates lastSeenAt, and emits agent:status-changed', () => {
    registry.register(makeDescriptor('a1', { status: AgentStatus.IDLE }));
    vi.setSystemTime(BASE_TS + 1000);

    const updated = registry.updateStatus('a1', AgentStatus.BUSY);
    expect(updated.status).toBe(AgentStatus.BUSY);
    expect(updated.lastSeenAt).toBe(BASE_TS + 1000);

    expect(events.emit).toHaveBeenCalledWith(
      'agent:status-changed',
      expect.objectContaining({
        payload: expect.objectContaining({
          agentId: 'a1',
          previousStatus: AgentStatus.IDLE,
          status: AgentStatus.BUSY,
        }),
      })
    );

    expect(() => registry.updateStatus('a1', /** @type {any} */ ('running'))).toThrow(/invalid status/);
  });

  it('tracks heartbeat and stale agents', () => {
    registry.register(makeDescriptor('a1', { lastSeenAt: BASE_TS - 10_000 }));
    registry.register(makeDescriptor('a2', { lastSeenAt: BASE_TS - 1_000 }));

    expect(registry.getStaleAgents(5_000).map((v) => v.agentId)).toEqual(['a1']);

    vi.setSystemTime(BASE_TS + 2500);
    expect(registry.heartbeat('a1')).toBe(true);

    const staleAfterHeartbeat = registry.getStaleAgents(5_000).map((v) => v.agentId);
    expect(staleAfterHeartbeat).toEqual([]);
  });

  it('supports snapshot and restore', () => {
    registry.register(makeDescriptor('a1', { metadata: { role: 'search' } }));
    registry.register(makeDescriptor('a2', { type: AgentType.OBSERVER }));

    const snapshot = registry.snapshot();
    expect(snapshot.maxAgents).toBe(2);
    expect(snapshot.agents).toHaveLength(2);

    const other = new AgentRegistry();
    const count = other.restore(snapshot);
    expect(count).toBe(2);
    expect(other.size).toBe(2);
    expect(other.findByType(AgentType.OBSERVER)).toHaveLength(1);

    expect(() => other.restore({ agents: [{ agentId: 'x' }] })).toThrow(/invalid|required/);
  });

  it('dispose clears registrations and detaches event bus', () => {
    registry.register(makeDescriptor('a1'));
    expect(registry.size).toBe(1);

    registry.dispose();
    expect(registry.size).toBe(0);

    events.emit.mockClear();
    registry.register(makeDescriptor('a2'));
    expect(events.emit).not.toHaveBeenCalled();
  });
});
