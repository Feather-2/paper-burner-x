import { createStateMachine } from "../../runtime/state-machine.js";
import { StateMachineRegistry } from "../../runtime/state-machine-registry.js";
import { TodoStatus, TODO_TRANSITIONS, todoMachine, isValidTodoStatus } from "../deepsearch/states.js";

export { TodoStatus, TODO_TRANSITIONS, todoMachine, isValidTodoStatus };

export const CodeSearchPhase = Object.freeze({
  PLANNING: "planning",
  EXECUTING: "executing",
  SUMMARIZING: "summarizing",
  COMPLETED: "completed",
});

export const CODESEARCH_PHASE_TRANSITIONS = Object.freeze({
  [CodeSearchPhase.PLANNING]: [CodeSearchPhase.EXECUTING, CodeSearchPhase.COMPLETED],
  [CodeSearchPhase.EXECUTING]: [CodeSearchPhase.SUMMARIZING, CodeSearchPhase.COMPLETED],
  [CodeSearchPhase.SUMMARIZING]: [CodeSearchPhase.COMPLETED],
  [CodeSearchPhase.COMPLETED]: [],
});

export const codesearchPhaseMachine = createStateMachine(CODESEARCH_PHASE_TRANSITIONS, "CodeSearchPhase");

const registry = StateMachineRegistry.getInstance();
registry.register("codesearch.phase", codesearchPhaseMachine, {
  module: "codesearch",
  description: "CodeSearch phase lifecycle",
  states: Object.values(CodeSearchPhase),
  transitions: CODESEARCH_PHASE_TRANSITIONS,
});
