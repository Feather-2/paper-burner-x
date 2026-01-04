/**
 * Runtime Layer - Agent Loop Infrastructure
 *
 * Core components for the Skills-based Agent Loop architecture.
 */

// Core
export { BaseAgentLoop, checkCancelled, checkPaused } from "./core/agent-loop.js";
export {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
  isAgentActive,
  isAgentTerminal,
} from "./core/agent-status.js";
export { StagePausedError, StageCancelledError, StageTimeoutError } from "./core/stage-errors.js";
export { ActorType, OrchestratorState, isValidActorType } from "./core/constants.js";

// Events
export { EventBus } from "./events/event-bus.js";
export {
  RuntimeEvents,
  WatchdogEvents,
  CicadaEvents,
  DeepSearchEvents,
  DesignEvents,
  IngestEvents,
} from "./events/events.js";

// Compression + Watchdog
export { Watchdog } from "./compression/watchdog.js";
export { CicadaCompressor, CompressionLayer } from "./compression/cicada-compressor.js";

// Telemetry
export { getRuntimeState, setRuntimeState } from "./telemetry/loop-runtime-state.js";
export { RunReplayController } from "./telemetry/replay-controller.js";
export { subscribeTelemetry } from "./telemetry/runstore-telemetry.js";

// API
export { StageApiFactory } from "./api/stage-api-factory.js";

// Context
export { UnifiedAgentContext } from "./context/unified-agent-context.js";

// Tools
export { ToolExecutor, createToolExecutor } from "./tools/tool-executor.js";

// Dependency Injection
export {
  Container,
  SINGLETON,
  TRANSIENT,
  createContainer,
  ServiceId,
  createAgentContainer,
  createTestContainer,
} from "./di/index.js";
