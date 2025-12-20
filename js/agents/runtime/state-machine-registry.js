/**
 * State machine registry for global visibility and snapshots.
 */

function cloneTransitions(transitions) {
  if (!transitions || typeof transitions !== "object") return {};
  const cloned = {};
  for (const [from, targets] of Object.entries(transitions)) {
    cloned[from] = Array.isArray(targets) ? [...targets] : [];
  }
  return cloned;
}

function normalizeMetadata(metadata) {
  const moduleName = typeof metadata?.module === "string" ? metadata.module : "unknown";
  const description = typeof metadata?.description === "string" ? metadata.description : "";
  const states = Array.isArray(metadata?.states) ? [...metadata.states] : [];
  const transitions = cloneTransitions(metadata?.transitions);
  return {
    module: moduleName,
    description,
    states,
    transitions,
  };
}

function resolveCurrentState(machine) {
  if (!machine) return null;
  if (typeof machine.getState === "function") return machine.getState();
  if (typeof machine.getCurrentState === "function") return machine.getCurrentState();
  if ("currentState" in machine) return machine.currentState;
  if ("state" in machine) return machine.state;
  if ("status" in machine) return machine.status;
  if ("current" in machine) return machine.current;
  return null;
}

export class StateMachineRegistry {
  constructor() {
    this._entries = new Map();
  }

  static getInstance() {
    if (!StateMachineRegistry._instance) {
      StateMachineRegistry._instance = new StateMachineRegistry();
    }
    return StateMachineRegistry._instance;
  }

  register(name, machine, metadata = {}) {
    const key = typeof name === "string" ? name.trim() : "";
    if (!key) {
      throw new Error("StateMachineRegistry.register(): name is required");
    }
    if (!machine) {
      throw new Error("StateMachineRegistry.register(): machine is required");
    }
    if (this._entries.has(key)) {
      throw new Error(`StateMachineRegistry.register(): '${key}' already registered`);
    }

    const entry = {
      name: key,
      machine,
      metadata: normalizeMetadata(metadata),
    };

    this._entries.set(key, entry);
    return entry;
  }

  get(name) {
    return this._entries.get(name)?.machine;
  }

  getAll() {
    return new Map(Array.from(this._entries, ([name, entry]) => [name, entry.machine]));
  }

  getAllNames() {
    return Array.from(this._entries.keys());
  }

  exportSnapshot() {
    const snapshot = {};
    for (const [name, entry] of this._entries.entries()) {
      snapshot[name] = {
        name,
        module: entry.metadata.module,
        description: entry.metadata.description,
        states: Array.isArray(entry.metadata.states) ? [...entry.metadata.states] : [],
        transitions: cloneTransitions(entry.metadata.transitions),
        currentState: resolveCurrentState(entry.machine),
      };
    }
    return snapshot;
  }

  unregister(name) {
    return this._entries.delete(name);
  }
}
