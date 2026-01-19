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
export { AgentOrchestrator, SchedulingMode } from "./orchestrator.js";
export { TaskGraph } from "./core/parallel/task-graph.js";

// Events
export { EventBus } from "../core/event-bus.js";
export {
  RuntimeEvents,
  WatchdogEvents,
  CicadaEvents,
  DeepSearchEvents,
  DesignEvents,
  IngestEvents,
  CodeSearchEvents,
  AgentLifecycleEvents,
  PhaseEvents,
} from "./events/events.js";

// Lifecycle
export {
  createLifecycleEmitter,
  createEventPayload,
  createPhaseTransitionPayload,
  createStatusChangePayload,
  createStepPayload,
  LifecycleEventNames,
  canTransitionStatus,
  assertValidTransition,
} from "./core/lifecycle.js";

// Memory (moved to plugins/memory/)
export { MemoryStore } from "../plugins/memory/memory-store.js";
export { StateEngine } from "../plugins/memory/state-engine.js";
export { UnifiedMemoryStore } from "../plugins/memory/unified-memory-store.js";
export { RetrievalEngine } from "../plugins/memory/retrieval-engine.js";

// Core Components (extracted from BaseAgentLoop)
export { ToolRegistry, normalizeToolResult, resolveToolExecutor } from "./core/tool-registry.js";
export { MessageManager } from "./core/message-manager.js";
export { StatusController } from "./core/status-controller.js";

// Persisted Output (large output handling)
export {
  wrapPersistedOutput,
  cleanOldPersistedOutputs,
  createPersistedOutputHook,
  isPersistedOutput,
  OUTPUT_THRESHOLD,
  PREVIEW_SIZE,
  KEEP_RECENT_OUTPUTS,
  PERSISTED_OUTPUT_START,
  PERSISTED_OUTPUT_END,
} from "./core/persisted-output.js";

// Compression + Watchdog (moved to plugins/compression/)
export { Watchdog } from "../plugins/compression/impl/watchdog.js";
export { CicadaCompressor, CompressionLayer } from "../plugins/compression/impl/cicada-compressor.js";
export { CompressionCoordinator } from "../plugins/compression/impl/coordinator.js";
// Adaptive Context Management (主动上下文管理)
export { ContextPredictor } from "../plugins/compression/impl/context-predictor.js";
export { AdaptiveZoneManager } from "../plugins/compression/impl/adaptive-zone-manager.js";
export {
  ProactiveCompressor,
  PRESETS as PROACTIVE_PRESETS,
  autoSelectPreset as autoSelectProactivePreset,
} from "../plugins/compression/impl/proactive-compressor.js";
export { CompressionQualityMonitor } from "../plugins/compression/impl/quality-monitor.js";

// Coordination (moved to plugins/coordination/)
export { TabCoordinator } from "../plugins/coordination/tab-coordinator.js";
export { ProcessCoordinator, isClusterSupported } from "../plugins/coordination/process-coordinator.js";

// Telemetry (moved to plugins/telemetry/)
export { getRuntimeState, setRuntimeState } from "../plugins/telemetry/loop-runtime-state.js";
export { RunReplayController } from "../plugins/telemetry/replay-controller.js";
export { subscribeTelemetry } from "../plugins/telemetry/runstore-telemetry.js";
export { TraceContext, SpanStatus, SpanKind, parseTraceparent, withSpan } from "../plugins/telemetry/trace-context.js";
export { TokenTracker } from "../plugins/telemetry/token-tracker.js";

// API (moved to core/api/)
export { StageApiFactory } from "./core/api/stage-api-factory.js";

// Context (moved to core/context/)
export { UnifiedAgentContext } from "./core/context/unified-agent-context.js";
export {
  SubagentBudgetManager,
  createSubagentBudgetManager,
  MODE_ALLOCATION_RATIOS,
  MODE_PRIORITY,
} from "./core/context/subagent-budget.js";

// Checkpoints (moved to plugins/checkpoints/)
export { AgentCheckpointStore } from "../plugins/checkpoints/agent-checkpoint-store.js";

// Tools
export { ToolExecutor, createToolExecutor } from "./tools/tool-executor.js";
export { HookRegistry, HookType, enhanceEventBusWithHooks, getHookRegistry, createPreToolUseHook } from "./hooks/index.js";
export { classifyCommand, parseCompoundCommand } from "./safety/command-classifier.js";

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

// MicroKernel/ServiceProvider 已移除 (2.0.0)
// 请使用: import { Kernel, MessageBus, createPlugin } from 'js/agents/core';

// Dependencies (Python Skill support - moved to plugins/deps/)
export {
  DependencyManager,
  PYODIDE_BUILTIN,
  PythonSkillExecutor,
  createPythonSkillExecutor,
  executePythonSkill,
} from "../plugins/deps/index.js";

// Runtime Adapters
export { JSRuntimeAdapter } from "./core/js-adapter.js";
export { PythonRuntimeAdapter } from "./core/python-adapter.js";
export { RuntimeScheduler, TaskPriority, RuntimeHealthStatus } from "./core/scheduler.js";

// Transports (Binary Communication - moved to plugins/transports/)
export {
  ProcessTransport,
  createProcessTransport,
  BinarySkillProvider,
  createBinarySkillProvider,
} from "../plugins/transports/index.js";

// Error Handling (moved to core/errors/)
export {
  SilentErrorReporter,
  ErrorCategory,
  silentErrors,
  reportSilentError,
  createScopedReporter,
} from "./core/errors/index.js";
