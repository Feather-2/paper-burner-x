/**
 * CodeSearch Stage - 代码库分析
 *
 * 基于 Agent Loop 的代码探索和分析工具。
 */

export { CodeSearchStage, runCodeSearchStage, registerCodeSearchStages } from "./codesearch-stage.js";
export { createToolExecutor, formatToolDefinitionsForLLM, TOOL_DEFINITIONS } from "./code-tools.js";
export {
  CODESEARCH_SYSTEM_PROMPT,
  CODESEARCH_TODO_PLANNER_PROMPT,
  CODESEARCH_STEP_PROMPT,
  CODESEARCH_SUMMARIZE_PROMPT,
  PROMPTS,
} from "./prompts.js";
export { CodeSearchPhase, codesearchPhaseMachine, TodoStatus, TODO_TRANSITIONS, todoMachine } from "./states.js";
