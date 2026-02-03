/**
 * Runtime Layer - Agent Loop Infrastructure
 *
 * Core components for the Skills-based Agent Loop architecture.
 *
 * For optional capabilities, import directly from plugins/:
 * - import { ... } from 'js/agents/plugins/compression';
 * - import { ... } from 'js/agents/plugins/telemetry';
 * - import { ... } from 'js/agents/plugins/memory';
 */

// ============================================
// Core Agent Loop (essential)
// ============================================
export { BaseAgentLoop, BaseStage, checkCancelled, checkPaused, getEmitFn } from "./core/agent-loop.js";
export {
  AgentStatus,
  StepStatus,
  isValidAgentStatus,
  isValidStepStatus,
  isAgentActive,
  isAgentTerminal,
} from "./core/agent-status.js";
export { StagePausedError, StageCancelledError, StageTimeoutError } from "./core/stage-errors.js";

// ============================================
// Lifecycle & Mechanisms
// ============================================
export { createLifecycleEmitter } from "./core/lifecycle.js";
export { loadMechanisms, initMechanisms } from "./core/mechanisms.js";
export { getErrorBoundary, createDefaultErrorBoundary } from "./core/error-boundary.js";
export { ResourceGuard } from "./core/resource-guard.js";
export { normalizeReportLength, ReportLength } from "./core/constants.js";
export { maybePersistToolOutput, maybePersistJsonArtifact } from "./core/tool-output-persistence.js";
export { wrapPersistedOutput, isPersistedOutput, createPersistedOutputHook } from "./core/persisted-output.js";

// ============================================
// Orchestration (multi-agent)
// ============================================
export { AgentOrchestrator, SchedulingMode } from "./core/orchestrator.js";
export { TaskGraph } from "./core/parallel/task-graph.js";

// ============================================
// Tool Execution (essential)
// ============================================
export { ToolRegistry, normalizeToolResult, resolveToolExecutor } from "./core/tool-registry.js";
export { ToolExecutor, createToolExecutor } from "./tools/tool-executor.js";

// ============================================
// Hooks (essential)
// ============================================
export { HookRegistry, HookType, enhanceEventBusWithHooks, getHookRegistry, createPreToolUseHook } from "./hooks/index.js";

// ============================================
// Dependency Injection (re-export from core)
// ============================================
export {
  Container,
  SINGLETON,
  TRANSIENT,
  createContainer,
  ServiceId,
  createAgentContainer,
  createTestContainer,
} from "../core/di/index.js";

// ============================================
// Safety (essential)
// ============================================
export { classifyCommand, parseCompoundCommand } from "./safety/command-classifier.js";

// ============================================
// Core Components
// ============================================
export { MessageManager } from "./core/message-manager.js";
export { StatusController } from "./core/status-controller.js";
export { StageApiFactory } from "./core/api/stage-api-factory.js";
export { UnifiedAgentContext } from "./core/context/unified-agent-context.js";

// ============================================
// Re-exports for backward compatibility
// ============================================

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

