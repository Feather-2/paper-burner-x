import { createStateMachine } from "../../runtime/state-machine.js";
import { StateMachineRegistry } from "../../runtime/state-machine-registry.js";

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
export const AgentLoopStatus = Object.freeze({
  IDLE: "idle",           // 未启动
  RUNNING: "running",     // 运行中（进入主循环）
  OBSERVING: "observing", // 观察当前状态
  THINKING: "thinking",   // 思考下一步
  EXECUTING: "executing", // 执行动作
  REVIEWING: "reviewing", // 审查结果
  PAUSED: "paused",       // 暂停（等待外部输入）
  COMPLETED: "completed", // 正常完成
  ABORTED: "aborted",     // 异常终止
});

export const AGENT_LOOP_TRANSITIONS = Object.freeze({
  [AgentLoopStatus.IDLE]: [AgentLoopStatus.RUNNING],
  [AgentLoopStatus.RUNNING]: [AgentLoopStatus.OBSERVING, AgentLoopStatus.COMPLETED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.OBSERVING]: [AgentLoopStatus.THINKING, AgentLoopStatus.COMPLETED],
  [AgentLoopStatus.THINKING]: [AgentLoopStatus.EXECUTING, AgentLoopStatus.PAUSED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.EXECUTING]: [AgentLoopStatus.REVIEWING, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.REVIEWING]: [AgentLoopStatus.OBSERVING, AgentLoopStatus.COMPLETED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.PAUSED]: [AgentLoopStatus.RUNNING, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.COMPLETED]: [],
  [AgentLoopStatus.ABORTED]: [],
});

export const agentLoopMachine = createStateMachine(AGENT_LOOP_TRANSITIONS, "AgentLoop");

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

export function isValidAgentLoopStatus(value) {
  return Object.values(AgentLoopStatus).includes(value);
}
