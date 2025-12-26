/**
 * Runtime Layer - Agent Loop Infrastructure
 *
 * Core components for the Skills-based Agent Loop architecture.
 */

// Core infrastructure
export { EventBus } from "./event-bus.js";
export { createStateMachine } from "./state-machine.js";
export { stateMachineRegistry } from "./state-machine-registry.js";
export { BaseAgentLoop } from "./agent-loop.js";

// Watchdog + Compression
export { Watchdog, DelegationMode, DelegationReason } from "./watchdog.js";
export { CicadaCompressor, CompressionLayer } from "./cicada-compressor.js";
export { AsyncCompressor } from "./async-compressor.js";
export {
  RemoteCompactor,
  CompactProvider,
  FastModelProvider,
  LocalCompactProvider,
  CompactionStrategy,
  CompactionStatus,
} from "./remote-compactor.js";

// Capability (保留观察)
export { CapabilityLoader } from "./capability-loader.js";

// Events
export {
  RuntimeEvents,
  PhaseEvents,
  WatchdogEvents,
  CicadaEvents,
} from "./events.js";

// Constants
export { RuntimeConstants } from "./constants.js";
