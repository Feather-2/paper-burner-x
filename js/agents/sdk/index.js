/**
 * @paper-burner/agents SDK
 *
 * Public SDK entrypoint with a layered API surface:
 * - L0: one-line convenience helpers
 * - L1: primary SDK building blocks
 * - L2: advanced integrations, tools, and pre-built stages
 */

// ============================================================
// L0 - Convenience (one-line execution)
// ============================================================
export { runDeepSearch, runDesign } from "./convenience.js";

// ============================================================
// L1 - Primary SDK API
// ============================================================
export { createAgent, AgentBuilder, AgentInstance } from "./AgentBuilder.js";
export { DefaultAgentLoop } from "./DefaultAgentLoop.js";

export { EventBus } from "../core/event-bus.js";
export { AgentStatus, StepStatus, isAgentActive, isAgentTerminal } from "../runtime/core/agent-status.js";
export { StagePausedError, StageCancelledError } from "../runtime/core/stage-errors.js";

// ============================================================
// L2 - Advanced integrations and utilities
// ============================================================

// Multi-agent and backtrack
export { SubagentRegistry, globalSubagentRegistry } from "./SubagentRegistry.js";
export { BacktrackManager } from "./BacktrackManager.js";
export { SoftBacktrackManager } from "./SoftBacktrackManager.js";

// Tools
export { createTaskTool, ContextMode, TASK_TOOL_DEFINITION } from "../runtime/tools/TaskTool.js";
export { createRecallTool, RECALL_TOOL_DEFINITION } from "../runtime/tools/RecallTool.js";
export { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from "../runtime/tools/BacktrackTool.js";
export { createDMailTool, DMAIL_TOOL_DEFINITION } from "../runtime/tools/DMailTool.js";

// Shared utilities
export { createLogger, trackToolCall } from "../shared/index.js";
export { createBudgetManager, BudgetAction } from "../shared/index.js";

// MCP
export { createMcpClient, McpClient, McpProvider, loadStdioModules } from "../mcp/index.js";

// Config
export { loadAgentConfig, mergeConfigs } from "./config-loader.js";

// Pre-built stages
export { DeepSearchAgentLoop } from "../stages/deepsearch/deepsearch-agent-loop.js";
export { DesignAgentLoop } from "../stages/design/agent-loop.js";
export { CodeSearchStage } from "../stages/codesearch/codesearch-stage.js";

// Version
export const VERSION = "1.0.0";
