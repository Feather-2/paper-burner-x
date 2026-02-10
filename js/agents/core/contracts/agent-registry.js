/** AgentRegistry - 多 Agent 身份注册与发现 */

export const AgentType = Object.freeze({ WORKER: 'worker', COORDINATOR: 'coordinator', SPECIALIST: 'specialist', OBSERVER: 'observer' });
export const AgentStatus = Object.freeze({ IDLE: 'idle', BUSY: 'busy', STOPPED: 'stopped', DEGRADED: 'degraded' });
/** @type {Set<string>} */
export const AGENT_TYPES = new Set(Object.values(AgentType));
/** @type {Set<string>} */
export const AGENT_STATUSES = new Set(Object.values(AgentStatus));
const DEFAULT_MAX_AGENTS = 100;

/** @typedef {{ emit: (event: string, payload?: unknown) => unknown }} EventBusLike */
/** @typedef {{ agentId: string, name: string, type: typeof AgentType[keyof typeof AgentType], capabilities?: string[], status: typeof AgentStatus[keyof typeof AgentStatus], metadata?: Record<string, unknown>, registeredAt: number, lastSeenAt: number }} AgentDescriptor */
/** @typedef {{ events?: EventBusLike, maxAgents?: number }} AgentRegistryOptions */
/** @typedef {{ type?: typeof AgentType[keyof typeof AgentType], status?: typeof AgentStatus[keyof typeof AgentStatus], capability?: string }} AgentRegistryFilter */
/** @typedef {{ maxAgents: number, agents: AgentDescriptor[], ts: number }} AgentRegistrySnapshot */

/** @param {unknown} v @returns {string | null} */
function str(v) { return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null; }
/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
/** @param {unknown} v @param {number} fallback @returns {number} */
function ts(v, fallback) { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }

/** @param {unknown} capabilities @returns {string[] | undefined} */
function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return undefined;
  const seen = new Set();
  const normalized = [];
  for (const cap of capabilities) {
    const value = str(cap);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : undefined;
}

/** @param {AgentDescriptor} descriptor @returns {AgentDescriptor} */
function cloneDescriptor(descriptor) {
  return {
    agentId: descriptor.agentId,
    name: descriptor.name,
    type: descriptor.type,
    ...(descriptor.capabilities?.length ? { capabilities: [...descriptor.capabilities] } : {}),
    status: descriptor.status,
    ...(descriptor.metadata ? { metadata: { ...descriptor.metadata } } : {}),
    registeredAt: descriptor.registeredAt,
    lastSeenAt: descriptor.lastSeenAt,
  };
}

/** @param {unknown} type @returns {boolean} */
export function isValidAgentType(type) { return typeof type === 'string' && AGENT_TYPES.has(type); }
/** @param {unknown} status @returns {boolean} */
export function isValidAgentStatus(status) { return typeof status === 'string' && AGENT_STATUSES.has(status); }

/** @param {unknown} descriptor @returns {{ valid: boolean, errors: string[] }} */
export function validateAgentDescriptor(descriptor) {
  const errors = [];
  if (!isRecord(descriptor)) return { valid: false, errors: ['AgentDescriptor: expected object'] };
  const o = /** @type {Record<string, unknown>} */ (descriptor);
  if (!str(o.agentId)) errors.push('AgentDescriptor.agentId: required non-empty string');
  if (!str(o.name)) errors.push('AgentDescriptor.name: required non-empty string');
  if (!isValidAgentType(o.type)) errors.push(`AgentDescriptor.type: must be one of ${Array.from(AGENT_TYPES).join(', ')}`);
  if (!isValidAgentStatus(o.status)) errors.push(`AgentDescriptor.status: must be one of ${Array.from(AGENT_STATUSES).join(', ')}`);
  if (o.capabilities !== undefined) {
    if (!Array.isArray(o.capabilities)) {
      errors.push('AgentDescriptor.capabilities: must be string[]');
    } else {
      for (let i = 0; i < o.capabilities.length; i++) {
        if (!str(o.capabilities[i])) errors.push(`AgentDescriptor.capabilities[${i}]: required non-empty string`);
      }
    }
  }
  if (o.metadata !== undefined && !isRecord(o.metadata)) errors.push('AgentDescriptor.metadata: must be a plain object');
  if (typeof o.registeredAt !== 'number' || !Number.isFinite(o.registeredAt)) errors.push('AgentDescriptor.registeredAt: required finite number');
  if (typeof o.lastSeenAt !== 'number' || !Number.isFinite(o.lastSeenAt)) errors.push('AgentDescriptor.lastSeenAt: required finite number');
  return { valid: errors.length === 0, errors };
}

/**
 * @param {string} agentId
 * @param {string} name
 * @param {typeof AgentType[keyof typeof AgentType]} type
 * @param {{ capabilities?: string[], status?: typeof AgentStatus[keyof typeof AgentStatus], metadata?: Record<string, unknown>, registeredAt?: number, lastSeenAt?: number }} [options]
 * @returns {AgentDescriptor}
 */
export function createAgentDescriptor(agentId, name, type, options = {}) {
  const id = str(agentId);
  if (!id) throw new Error('createAgentDescriptor: agentId must be non-empty string');
  const resolvedName = str(name);
  if (!resolvedName) throw new Error('createAgentDescriptor: name must be non-empty string');
  if (!isValidAgentType(type)) throw new Error(`createAgentDescriptor: type must be one of ${Array.from(AGENT_TYPES).join(', ')}`);
  const status = options.status ?? AgentStatus.IDLE;
  if (!isValidAgentStatus(status)) throw new Error(`createAgentDescriptor: status must be one of ${Array.from(AGENT_STATUSES).join(', ')}`);
  const now = Date.now();
  const registeredAt = ts(options.registeredAt, now);
  const lastSeenAt = ts(options.lastSeenAt, registeredAt);
  const capabilities = normalizeCapabilities(options.capabilities);
  const metadata = isRecord(options.metadata) ? { ...options.metadata } : undefined;
  return {
    agentId: id,
    name: resolvedName,
    type,
    ...(capabilities ? { capabilities } : {}),
    status,
    ...(metadata ? { metadata } : {}),
    registeredAt,
    lastSeenAt,
  };
}

export class AgentRegistry {
  /** @param {AgentRegistryOptions} [options] */
  constructor(options = {}) {
    /** @type {Map<string, AgentDescriptor>} */
    this._agents = new Map();
    /** @type {EventBusLike | null} */
    this._events = options.events ?? null;
    this.maxAgents = Number.isInteger(options.maxAgents) && options.maxAgents > 0 ? options.maxAgents : DEFAULT_MAX_AGENTS;
  }

  /** @returns {number} */
  get size() { return this._agents.size; }

  /** @param {AgentDescriptor} descriptor @returns {AgentDescriptor} */
  register(descriptor) {
    const check = validateAgentDescriptor(descriptor);
    if (!check.valid) throw new Error(`AgentRegistry.register: ${check.errors.join('; ')}`);
    if (this._agents.has(descriptor.agentId)) throw new Error(`AgentRegistry.register: duplicate agentId "${descriptor.agentId}"`);
    if (this._agents.size >= this.maxAgents) throw new Error(`AgentRegistry.register: maxAgents exceeded (${this.maxAgents})`);
    const normalized = createAgentDescriptor(descriptor.agentId, descriptor.name, descriptor.type, {
      capabilities: descriptor.capabilities,
      status: descriptor.status,
      metadata: descriptor.metadata,
      registeredAt: descriptor.registeredAt,
      lastSeenAt: descriptor.lastSeenAt,
    });
    this._agents.set(descriptor.agentId, normalized);
    this._emit('agent:registered', { agent: cloneDescriptor(normalized) });
    return cloneDescriptor(normalized);
  }

  /** @param {string} agentId @returns {boolean} */
  unregister(agentId) {
    const id = str(agentId);
    if (!id) return false;
    const existing = this._agents.get(id);
    if (!existing) return false;
    this._agents.delete(id);
    this._emit('agent:unregistered', { agentId: id, agent: cloneDescriptor(existing) });
    return true;
  }

  /** @param {string} agentId @returns {AgentDescriptor | undefined} */
  lookup(agentId) {
    const id = str(agentId);
    if (!id) return undefined;
    const descriptor = this._agents.get(id);
    return descriptor ? cloneDescriptor(descriptor) : undefined;
  }

  /** @param {AgentRegistryFilter} [filter] @returns {AgentDescriptor[]} */
  list(filter = {}) {
    if (filter.type !== undefined && !isValidAgentType(filter.type)) return [];
    if (filter.status !== undefined && !isValidAgentStatus(filter.status)) return [];
    const capability = filter.capability !== undefined ? str(filter.capability) : null;
    if (filter.capability !== undefined && !capability) return [];
    const result = [];
    for (const descriptor of this._agents.values()) {
      if (filter.type && descriptor.type !== filter.type) continue;
      if (filter.status && descriptor.status !== filter.status) continue;
      if (capability && !descriptor.capabilities?.includes(capability)) continue;
      result.push(cloneDescriptor(descriptor));
    }
    return result;
  }

  /** @param {string} capability @returns {AgentDescriptor[]} */
  findByCapability(capability) { return this.list({ capability }); }

  /** @param {typeof AgentType[keyof typeof AgentType]} type @returns {AgentDescriptor[]} */
  findByType(type) { return this.list({ type }); }

  /**
   * @param {string} agentId
   * @param {typeof AgentStatus[keyof typeof AgentStatus]} status
   * @returns {AgentDescriptor | undefined}
   */
  updateStatus(agentId, status) {
    if (!isValidAgentStatus(status)) throw new Error(`AgentRegistry.updateStatus: invalid status "${String(status)}"`);
    const id = str(agentId);
    if (!id) return undefined;
    const descriptor = this._agents.get(id);
    if (!descriptor) return undefined;
    const previousStatus = descriptor.status;
    descriptor.status = status;
    descriptor.lastSeenAt = Date.now();
    this._emit('agent:status-changed', { agentId: id, previousStatus, status, agent: cloneDescriptor(descriptor) });
    return cloneDescriptor(descriptor);
  }

  /** @param {string} agentId @returns {boolean} */
  heartbeat(agentId) {
    const id = str(agentId);
    if (!id) return false;
    const descriptor = this._agents.get(id);
    if (!descriptor) return false;
    descriptor.lastSeenAt = Date.now();
    return true;
  }

  /** @param {number} thresholdMs @returns {AgentDescriptor[]} */
  getStaleAgents(thresholdMs) {
    if (typeof thresholdMs !== 'number' || !Number.isFinite(thresholdMs) || thresholdMs < 0) return [];
    const cutoff = Date.now() - thresholdMs;
    const stale = [];
    for (const descriptor of this._agents.values()) {
      if (descriptor.lastSeenAt < cutoff) stale.push(cloneDescriptor(descriptor));
    }
    return stale;
  }

  /** @returns {AgentRegistrySnapshot} */
  snapshot() { return { maxAgents: this.maxAgents, agents: this.list(), ts: Date.now() }; }

  /** @param {{ maxAgents?: number, agents: AgentDescriptor[] }} snapshot @returns {number} */
  restore(snapshot) {
    if (!isRecord(snapshot) || !Array.isArray(snapshot.agents)) throw new Error('AgentRegistry.restore: invalid snapshot');
    const nextMax = Number.isInteger(snapshot.maxAgents) && snapshot.maxAgents > 0 ? snapshot.maxAgents : this.maxAgents;
    if (snapshot.agents.length > nextMax) throw new Error(`AgentRegistry.restore: snapshot exceeds maxAgents (${nextMax})`);

    /** @type {Map<string, AgentDescriptor>} */
    const restored = new Map();
    for (const descriptor of snapshot.agents) {
      const check = validateAgentDescriptor(descriptor);
      if (!check.valid) throw new Error(`AgentRegistry.restore: ${check.errors.join('; ')}`);
      if (restored.has(descriptor.agentId)) throw new Error(`AgentRegistry.restore: duplicate agentId "${descriptor.agentId}" in snapshot`);
      restored.set(descriptor.agentId, createAgentDescriptor(descriptor.agentId, descriptor.name, descriptor.type, {
        capabilities: descriptor.capabilities,
        status: descriptor.status,
        metadata: descriptor.metadata,
        registeredAt: descriptor.registeredAt,
        lastSeenAt: descriptor.lastSeenAt,
      }));
    }

    this.maxAgents = nextMax;
    this._agents = restored;
    return this._agents.size;
  }

  dispose() { this._agents.clear(); this._events = null; }

  /** @param {string} eventName @param {Record<string, unknown>} payload */
  _emit(eventName, payload) {
    if (!this._events || typeof this._events.emit !== 'function') return;
    try {
      this._events.emit(eventName, { actor: 'agent-registry', status: 'info', payload });
    } catch {
      // best-effort
    }
  }
}
