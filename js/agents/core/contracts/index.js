/**
 * Runtime Contracts - 运行时契约验证
 *
 * 在 Agent 边界进行轻量级结构验证，防止类型欺骗。
 * 设计原则：
 * - 边界验证，非全量验证
 * - 宽进严出
 * - fail-fast 但不 crash
 */

export { validateRpcRequest, validateRpcResponse } from "./rpc-message.js";
export { validateLlmResponse, validateToolCall } from "./llm-response.js";
export { validateToolResult, normalizeToolResult } from "./tool-result.js";
export {
  isDisposable,
  safeDispose,
  disposeAll,
  using,
  createCompositeDisposable,
} from "./disposable.js";
export {
  AgentMessageKind,
  TaskStatus,
  AgentRunStatus,
  validateTaskRequest,
  validateTaskResult,
  validateStatusUpdate,
  validateKnowledgeShare,
  validateAgentMessage,
  createTaskRequest,
  createTaskResult,
  createStatusUpdate,
  createKnowledgeShare,
} from "./agent-message.js";
export { SharedTaskBoard, TaskBoardEvents } from "./shared-task-board.js";
export { TaskBoardOrchestratorBridge, createTaskBoardBridge } from "./taskboard-orchestrator-bridge.js";
export { AgentCoordinator, createAgentCoordinator } from "./agent-coordinator.js";
export {
  AgentRegistry,
  createAgentDescriptor,
  validateAgentDescriptor,
  isValidAgentType,
  isValidAgentStatus,
  AgentType,
  AgentStatus,
} from "./agent-registry.js";
export {
  TraceContextPropagator,
  createTracePropagator,
  injectTrace,
  extractTrace,
  generateTraceId,
  generateSpanId,
  formatTraceparent,
  parseTraceparent,
} from "./trace-propagator.js";
