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
export { TaskGraph } from "./parallel/task-graph.js";

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

// Memory
export { MemoryStore } from "./memory/memory-store.js";
export { StateEngine } from "./memory/state-engine.js";
export { RetrievalEngine } from "./memory/retrieval-engine.js";

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

// Compression + Watchdog
export { Watchdog } from "./compression/watchdog.js";
export { CicadaCompressor, CompressionLayer } from "./compression/cicada-compressor.js";
export { CompressionCoordinator } from "./compression/coordinator.js";

// Telemetry
export { getRuntimeState, setRuntimeState } from "./telemetry/loop-runtime-state.js";
export { RunReplayController } from "./telemetry/replay-controller.js";
export { subscribeTelemetry } from "./telemetry/runstore-telemetry.js";
export { TraceContext, SpanStatus, SpanKind, parseTraceparent, withSpan } from "./telemetry/trace-context.js";
export { TokenTracker } from "./telemetry/token-tracker.js";

// API
export { StageApiFactory } from "./api/stage-api-factory.js";

// Context
export { UnifiedAgentContext } from "./context/unified-agent-context.js";

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

// Dependencies (Python Skill support)
export {
  DependencyManager,
  PYODIDE_BUILTIN,
  PythonSkillExecutor,
  createPythonSkillExecutor,
  executePythonSkill,
} from "./deps/index.js";

// Runtime Adapters
export { JSRuntimeAdapter } from "./core/js-adapter.js";
export { PythonRuntimeAdapter } from "./core/python-adapter.js";
export { RuntimeScheduler, TaskPriority, RuntimeHealthStatus } from "./core/scheduler.js";
