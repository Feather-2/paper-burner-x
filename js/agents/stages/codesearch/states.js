/**
 * CodeSearch States - 简化版
 */

import { TodoStatus, isValidTodoStatus } from "../deepsearch/states.js";

export { TodoStatus, isValidTodoStatus };

/**
 * @typedef {'planning'|'executing'|'summarizing'|'completed'} CodeSearchPhaseValue
 */

/** @type {Readonly<Record<string, CodeSearchPhaseValue>>} */
export const CodeSearchPhase = Object.freeze({
  PLANNING: "planning",
  EXECUTING: "executing",
  SUMMARIZING: "summarizing",
  COMPLETED: "completed",
});

/**
 * @param {any} value
 * @returns {boolean}
 */
export function isValidCodeSearchPhase(value) {
  return Object.values(CodeSearchPhase).includes(value);
}
