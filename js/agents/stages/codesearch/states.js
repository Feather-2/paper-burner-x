/**
 * CodeSearch States - 简化版
 */

import { TodoStatus, isValidTodoStatus } from "../deepsearch/states.js";

export { TodoStatus, isValidTodoStatus };

export const CodeSearchPhase = Object.freeze({
  PLANNING: "planning",
  EXECUTING: "executing",
  SUMMARIZING: "summarizing",
  COMPLETED: "completed",
});

export function isValidCodeSearchPhase(value) {
  return Object.values(CodeSearchPhase).includes(value);
}
