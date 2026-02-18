/**
 * @paper-burner/agents SDK
 *
 * Core framework entrypoint — model-agnostic agent building blocks.
 * Business stages (DeepSearch, Design, CodeSearch) are NOT exported here;
 * import them directly from their stage directories when needed.
 *
 * API layers:
 * - L1: primary SDK building blocks (Builder, Loop, Events)
 * - L2: advanced integrations (Tools, MCP, multi-agent)
 *
 * L0 convenience helpers (runDeepSearch, runDesign) live in ./convenience.js
 * and can be imported directly:  import { runDeepSearch } from "sdk/convenience.js"
 */

// ============================================================
// L1 - Primary SDK API
// ============================================================
export { createAgent, createAgentBuilder, AgentBuilder, AgentInstance } from "./AgentBuilder.js";
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

// Discovery and monitoring
export { DiscoveryManager } from "./DiscoveryManager.js";
export { AlertMonitor } from "./AlertMonitor.js";

// Internal configuration
export { AgentConfig } from "./agent-config.js";
export { scanForInjection, InjectionScanner, sanitizeOutput, isCleanOutput } from "./injection-scanner.js";

// Version
export const VERSION = "1.0.0";

// ============================================================
// L3 - HTTP API Server
// ============================================================
export { createAgentServer } from "./http/index.js";
export { STREAM_EVENT_TYPES } from "./http/stream-events.js";
