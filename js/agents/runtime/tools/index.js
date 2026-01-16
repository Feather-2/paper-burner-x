/**
 * runtime/tools - 运行时工具模块
 *
 * 导出工具执行器、内置工具和平台适配器。
 */

// Tool Executor
export {
  ToolExecutor,
  createToolExecutor,
} from './tool-executor.js';

// Built-in Tools
export { createTaskTool, TASK_TOOL_DEFINITION, ContextMode } from './TaskTool.js';
export { createRecallTool, RECALL_TOOL_DEFINITION } from './RecallTool.js';
export { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from './BacktrackTool.js';

// Schema Validator
export { validateToolSchema } from './schema-validator.js';

// Tool Quotas
export { ToolQuotaManager } from './tool-quotas.js';

// Platform Tools (跨平台适配器)
export {
  createPlatformTools,
  getPlatformType,
  hasCapability,
} from './platform/index.js';
