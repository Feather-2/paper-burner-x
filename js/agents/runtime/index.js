/**
 * Runtime Layer - Agent Loop Infrastructure
 *
 * Core components for the Skills-based Agent Loop architecture.
 *
 * For optional capabilities, use sub-path imports:
 * - import { ... } from 'js/agents/runtime/compression';
 * - import { ... } from 'js/agents/runtime/telemetry';
 * - import { ... } from 'js/agents/runtime/memory';
 * - import { ... } from 'js/agents/runtime/events';
 */

// ============================================
// Core Agent Loop (essential)
// ============================================
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

// ============================================
// Orchestration (multi-agent)
// ============================================
export { AgentOrchestrator, SchedulingMode } from "./orchestrator.js";
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
// Dependency Injection (essential)
// ============================================
export {
  Container,
  SINGLETON,
  TRANSIENT,
  createContainer,
  ServiceId,
  createAgentContainer,
  createTestContainer,
} from "./di/index.js";

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
// Use sub-path imports for new code
// ============================================

// Events - prefer: import { ... } from 'js/agents/runtime/events'
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

// Compression - prefer: import { ... } from 'js/agents/runtime/compression'
export {
  Watchdog,
  CicadaCompressor,
  CompressionLayer,
  CompressionCoordinator,
} from "./compression.js";

// Telemetry - prefer: import { ... } from 'js/agents/runtime/telemetry'
export {
  TokenTracker,
  TraceContext,
} from "./telemetry.js";
