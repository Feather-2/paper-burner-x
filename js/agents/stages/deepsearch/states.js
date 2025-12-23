import { createStateMachine } from "../../runtime/state-machine.js";
import { StateMachineRegistry } from "../../runtime/state-machine-registry.js";
import {
  AgentLoopStatus,
  AGENT_LOOP_TRANSITIONS,
  createAgentLoopMachine,
  isValidAgentLoopStatus,
} from "../../runtime/agent-loop-status.js";

// === Phase 状态 ===
export const PhaseStatus = Object.freeze({
  SCAN: "scan",
  GAPS: "gaps",
  ROUND: "round",
  WRITE: "write",
  CONDENSE: "condense",
  COMPLETED: "completed",
});

export const PHASE_TRANSITIONS = Object.freeze({
  [PhaseStatus.SCAN]: [PhaseStatus.GAPS, PhaseStatus.COMPLETED],
  [PhaseStatus.GAPS]: [PhaseStatus.ROUND, PhaseStatus.WRITE],
  [PhaseStatus.ROUND]: [PhaseStatus.GAPS, PhaseStatus.WRITE],
  [PhaseStatus.WRITE]: [PhaseStatus.CONDENSE, PhaseStatus.ROUND],
  [PhaseStatus.CONDENSE]: [PhaseStatus.COMPLETED],
  [PhaseStatus.COMPLETED]: [],
});

export const phaseMachine = createStateMachine(PHASE_TRANSITIONS, "DeepSearchPhase");

// === Gap 状态（完整版，含 SEARCHING/UNDERSTANDING）===
export const GapStatus = Object.freeze({
  OPEN: "open",
  SEARCHING: "searching",
  UNDERSTANDING: "understanding",
  FILLED: "filled",
  BLOCKED: "blocked",
  STALE: "stale",
});

export const GAP_TRANSITIONS = Object.freeze({
  [GapStatus.OPEN]: [GapStatus.SEARCHING, GapStatus.BLOCKED],
  [GapStatus.SEARCHING]: [GapStatus.UNDERSTANDING, GapStatus.OPEN, GapStatus.BLOCKED],
  [GapStatus.UNDERSTANDING]: [GapStatus.FILLED, GapStatus.SEARCHING, GapStatus.BLOCKED],
  [GapStatus.FILLED]: [GapStatus.OPEN, GapStatus.STALE],
  [GapStatus.BLOCKED]: [GapStatus.OPEN],
  [GapStatus.STALE]: [GapStatus.OPEN],
});

export const gapMachine = createStateMachine(GAP_TRANSITIONS, "Gap");

const registry = StateMachineRegistry.getInstance();
registry.register("deepsearch.phase", phaseMachine, {
  module: "deepsearch",
  description: "DeepSearch phase lifecycle",
  states: Object.values(PhaseStatus),
  transitions: PHASE_TRANSITIONS,
});
registry.register("deepsearch.gap", gapMachine, {
  module: "deepsearch",
  description: "DeepSearch gap lifecycle",
  states: Object.values(GapStatus),
  transitions: GAP_TRANSITIONS,
});

// === Gap 优先级 ===
export const GapPriority = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

// === Todo 状态 ===
export const TodoStatus = Object.freeze({
  OPEN: "open",
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

// === PlanNode 状态 ===
export const PlanNodeStatus = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  BLOCKED: "blocked",
});

// === PlanNode 类型 ===
export const PlanNodeType = Object.freeze({
  GOAL: "goal",
  SUBGOAL: "subgoal",
  QUERY: "query",
});

// === Decision 结果 ===
export const DecisionOutcome = Object.freeze({
  SUCCESS: "success",
  FAIL: "fail",
  PARTIAL: "partial",
  UNKNOWN: "unknown",
});

// === Decision 阶段 ===
export const DecisionStage = Object.freeze({
  SCAN: "scan",
  GAPS: "gaps",
  RETRIEVE: "retrieve",
  UNDERSTAND: "understand",
  WRITE: "write",
  CONDENSE: "condense",
  UNKNOWN: "unknown",
});

// === Agent Loop 执行状态 ===
export { AgentLoopStatus, AGENT_LOOP_TRANSITIONS, isValidAgentLoopStatus };
export const agentLoopMachine = createAgentLoopMachine("AgentLoop");

registry.register("deepsearch.agentLoop", agentLoopMachine, {
  module: "deepsearch",
  description: "Agent Loop execution lifecycle",
  states: Object.values(AgentLoopStatus),
  transitions: AGENT_LOOP_TRANSITIONS,
});

// === 验证函数 ===
export function isValidGapPriority(value) {
  return Object.values(GapPriority).includes(value);
}

export function isValidGapStatus(value) {
  return Object.values(GapStatus).includes(value);
}

export function isValidPlanNodeStatus(value) {
  return Object.values(PlanNodeStatus).includes(value);
}

export function isValidPlanNodeType(value) {
  return Object.values(PlanNodeType).includes(value);
}

export function isValidDecisionOutcome(value) {
  return Object.values(DecisionOutcome).includes(value);
}

export function isValidDecisionStage(value) {
  return Object.values(DecisionStage).includes(value);
}

// isValidAgentLoopStatus re-exported from runtime/agent-loop-status.js
