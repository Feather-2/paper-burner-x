/**
 * @paper-burner/agents SDK
 *
 * 公共 API 入口，提供：
 * - createAgent() - 流式构建 Agent
 * - 核心类型导出
 * - Runtime 组件重导出
 */

// SDK 核心
export { createAgent, AgentBuilder, AgentInstance } from "./AgentBuilder.js";
export { SubagentRegistry, globalSubagentRegistry } from "./SubagentRegistry.js";

// Runtime 组件
export { BaseAgentLoop } from "../runtime/core/agent-loop.js";
export { EventBus } from "../runtime/events/event-bus.js";
export { AgentStatus, StepStatus, isAgentActive, isAgentTerminal } from "../runtime/core/agent-status.js";
export { StagePausedError, StageCancelledError } from "../runtime/core/stage-errors.js";

// Context Management (Cicada + Watchdog + AlertMonitor)
export { CicadaCompressor, CompressionLayer } from "../runtime/compression/cicada-compressor.js";
export { Watchdog } from "../runtime/compression/watchdog.js";
export { AlertMonitor } from "./AlertMonitor.js";

// Tools
export { createTaskTool, ContextMode, TASK_TOOL_DEFINITION } from "../runtime/tools/TaskTool.js";
export { createRecallTool, RECALL_TOOL_DEFINITION } from "../runtime/tools/RecallTool.js";
export { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from "../runtime/tools/BacktrackTool.js";

// Shared 工具
export { createLogger, trackToolCall } from "../shared/utils/logger.js";
export { createBudgetManager, BudgetAction } from "../shared/utils/budget.js";

// MCP
export { createMcpClient, McpClient, McpProvider } from "../mcp/index.js";

// Config
export { loadAgentConfig, mergeConfigs } from "./config-loader.js";

// 预构建 Agents
export { DeepSearchAgentLoop } from "../stages/deepsearch/deepsearch-agent-loop.js";
export { DesignAgentLoop } from "../stages/design/agent-loop.js";
export { CodeSearchStage } from "../stages/codesearch/codesearch-stage.js";

// 版本信息
export const VERSION = "1.0.0";
