import { createStateMachine } from "./state-machine.js";

export const AgentLoopStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  OBSERVING: "observing",
  THINKING: "thinking",
  EXECUTING: "executing",
  REVIEWING: "reviewing",
  PAUSED: "paused",
  COMPLETED: "completed",
  ABORTED: "aborted",
});

export const AGENT_LOOP_TRANSITIONS = Object.freeze({
  [AgentLoopStatus.IDLE]: [AgentLoopStatus.RUNNING],
  [AgentLoopStatus.RUNNING]: [AgentLoopStatus.OBSERVING, AgentLoopStatus.PAUSED, AgentLoopStatus.COMPLETED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.OBSERVING]: [AgentLoopStatus.THINKING, AgentLoopStatus.PAUSED, AgentLoopStatus.COMPLETED],
  [AgentLoopStatus.THINKING]: [AgentLoopStatus.EXECUTING, AgentLoopStatus.PAUSED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.EXECUTING]: [AgentLoopStatus.REVIEWING, AgentLoopStatus.PAUSED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.REVIEWING]: [AgentLoopStatus.OBSERVING, AgentLoopStatus.PAUSED, AgentLoopStatus.COMPLETED, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.PAUSED]: [AgentLoopStatus.RUNNING, AgentLoopStatus.ABORTED],
  [AgentLoopStatus.COMPLETED]: [],
  [AgentLoopStatus.ABORTED]: [],
});

export function createAgentLoopMachine(name = "AgentLoop") {
  return createStateMachine(AGENT_LOOP_TRANSITIONS, name);
}

export function isValidAgentLoopStatus(value) {
  return Object.values(AgentLoopStatus).includes(value);
}
