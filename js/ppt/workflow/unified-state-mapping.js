/**
 * UnifiedStateMapping - 统一 WorkflowState 和 AgentStatus
 *
 * 简化版：移除细粒度状态，使用 todos + events 做进度追踪
 */

import { WorkflowState, transitionWorkflow } from "./workflow-states.js";
import { AgentStatus } from "../../agents/runtime/core/agent-status.js";

// 简化的状态集合
const LOOP_RUNNING_STATUSES = new Set([AgentStatus.RUNNING]);
const LOOP_PAUSED_STATUSES = new Set([AgentStatus.PAUSED]);
const LOOP_COMPLETED_STATUSES = new Set([AgentStatus.COMPLETED]);
const LOOP_FAILED_STATUSES = new Set([AgentStatus.FAILED, "failed", "aborted"]);

export const UiAgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
});

export function normalizeLoopStatusForUi(
  loopStatus,
  { empty = UiAgentStatus.IDLE, unknown = UiAgentStatus.RUNNING } = {}
) {
  if (!loopStatus || typeof loopStatus !== "string") return empty;
  if (LOOP_RUNNING_STATUSES.has(loopStatus)) return UiAgentStatus.RUNNING;
  if (LOOP_PAUSED_STATUSES.has(loopStatus)) return UiAgentStatus.PAUSED;
  if (LOOP_COMPLETED_STATUSES.has(loopStatus)) return UiAgentStatus.COMPLETED;
  if (LOOP_FAILED_STATUSES.has(loopStatus)) return UiAgentStatus.FAILED;
  if (loopStatus === AgentStatus.IDLE) return UiAgentStatus.IDLE;
  if (Object.values(UiAgentStatus).includes(loopStatus)) return loopStatus;
  return unknown;
}

/**
 * AgentStatus → WorkflowState 映射
 */
export const AgentToWorkflowMap = Object.freeze({
  deepsearch: {
    [AgentStatus.IDLE]: null,
    [AgentStatus.RUNNING]: WorkflowState.RESEARCHING,
    [AgentStatus.PAUSED]: WorkflowState.DEEPSEARCH_REVIEW,
    [AgentStatus.COMPLETED]: WorkflowState.SCRIPT_REVIEW,
    [AgentStatus.FAILED]: WorkflowState.FAILED,
  },
  design: {
    [AgentStatus.IDLE]: null,
    [AgentStatus.RUNNING]: WorkflowState.DESIGNER,
    [AgentStatus.PAUSED]: WorkflowState.DESIGNER,
    [AgentStatus.COMPLETED]: WorkflowState.COMPLETED,
    [AgentStatus.FAILED]: WorkflowState.FAILED,
  },
});

export function mapWorkflowStateFromLoopStatus(agentType, loopStatus, currentWorkflowState) {
  if (!agentType || typeof agentType !== "string") return null;
  if (!loopStatus || typeof loopStatus !== "string") return null;

  const terminalStates = [WorkflowState.FAILED, WorkflowState.COMPLETED, WorkflowState.DEEPSEARCH_REVIEW];
  if (terminalStates.includes(currentWorkflowState)) {
    return null;
  }

  const map = agentType === "design" ? AgentToWorkflowMap.design : AgentToWorkflowMap.deepsearch;
  const mapped = map?.[loopStatus];
  return typeof mapped === "string" && mapped ? mapped : null;
}

/**
 * WorkflowState → 预期 AgentStatus 范围
 */
export const WorkflowToAgentExpectation = Object.freeze({
  [WorkflowState.READING]: [AgentStatus.IDLE, AgentStatus.RUNNING],
  [WorkflowState.RESEARCHING]: [AgentStatus.RUNNING],
  [WorkflowState.DEEPSEARCH_REVIEW]: [AgentStatus.RUNNING, AgentStatus.PAUSED, AgentStatus.COMPLETED],
  [WorkflowState.DESIGNER]: [AgentStatus.RUNNING, AgentStatus.PAUSED],
});

/**
 * 从 Agent 事件推断 WorkflowState
 */
export function inferWorkflowStateFromEvent(eventName, currentWorkflowState, payload = {}) {
  // DeepSearch 事件
  if (eventName.startsWith("deepsearch.")) {
    if (eventName === "deepsearch.agent.started") {
      return WorkflowState.RESEARCHING;
    }
    if (eventName === "deepsearch.agent.completed") {
      return WorkflowState.SCRIPT_REVIEW;
    }
    if (eventName === "deepsearch.agent.failed") {
      return WorkflowState.FAILED;
    }
    if (eventName === "deepsearch.agent.paused") {
      return WorkflowState.DEEPSEARCH_REVIEW;
    }
    if (eventName === "deepsearch.agent.status.changed") {
      return mapWorkflowStateFromLoopStatus("deepsearch", payload?.to, currentWorkflowState);
    }
  }

  // Design 事件
  if (eventName.startsWith("design.")) {
    if (eventName === "design.agent.status.changed" || eventName === "design.loop.status.changed") {
      return mapWorkflowStateFromLoopStatus("design", payload?.to, currentWorkflowState);
    }
    if (eventName === "design.started") {
      return WorkflowState.DESIGNER;
    }
    if (eventName === "design.ended") {
      return WorkflowState.COMPLETED;
    }
    if (eventName === "design.phase.transition") {
      const phase = payload?.to;
      if (phase === "completed") {
        return WorkflowState.COMPLETED;
      }
    }
  }

  // Ingest 事件
  if (eventName === "ingest.completed") {
    return WorkflowState.SCANNING;
  }

  return null;
}

/**
 * 验证 WorkflowState 和 AgentStatus 是否一致
 */
export function validateStateConsistency(workflowState, agentStatus, agentType = "deepsearch") {
  const expected = WorkflowToAgentExpectation[workflowState] || [];
  const consistent = expected.length === 0 || expected.includes(agentStatus);

  return {
    consistent,
    expected,
    actual: agentStatus,
    workflowState,
    agentType,
  };
}

/**
 * 状态同步器 - 自动根据 Agent 事件更新 Workflow 状态
 */
export class StateSynchronizer {
  constructor(workflowContext) {
    this.context = workflowContext;
    this._agentStatus = { deepsearch: AgentStatus.IDLE, design: AgentStatus.IDLE };
  }

  handleAgentEvent(eventName, payload = {}) {
    // 终态不再处理状态转换事件
    if (this.context.state === WorkflowState.FAILED || this.context.state === WorkflowState.COMPLETED) {
      return;
    }

    // 更新内部 agent 状态跟踪
    if (eventName === "deepsearch.agent.status.changed") {
      this._agentStatus.deepsearch = payload?.to || this._agentStatus.deepsearch;
    }
    if (eventName === "deepsearch.agent.started" || eventName === "deepsearch.started") {
      if (this._agentStatus.deepsearch === AgentStatus.IDLE) this._agentStatus.deepsearch = AgentStatus.RUNNING;
    }
    if (eventName === "deepsearch.agent.paused") {
      this._agentStatus.deepsearch = AgentStatus.PAUSED;
    }
    if (eventName === "deepsearch.agent.completed") {
      this._agentStatus.deepsearch = AgentStatus.COMPLETED;
    }
    if (eventName === "deepsearch.agent.aborted" || eventName === "deepsearch.agent.failed") {
      this._agentStatus.deepsearch = AgentStatus.FAILED;
    }
    if (eventName === "design.agent.status.changed" || eventName === "design.loop.status.changed") {
      this._agentStatus.design = payload?.to || this._agentStatus.design;
    }
    if (eventName === "design.ended" || eventName === "design.agent.completed" || eventName === "design.completed") {
      this._agentStatus.design = AgentStatus.COMPLETED;
    }
    if (eventName === "design.failed" || eventName === "design.agent.failed" || eventName === "design.agent.aborted") {
      this._agentStatus.design = AgentStatus.FAILED;
    }

    // 推断 workflow 状态
    const suggested = inferWorkflowStateFromEvent(eventName, this.context.state, payload);

    if (suggested && suggested !== this.context.state) {
      const ok = transitionWorkflow(this.context, suggested, {
        triggeredBy: eventName,
        agentStatus: this._agentStatus,
      });

      if (!ok) {
        console.warn(`[StateSynchronizer] 无法转换到 ${suggested}，当前状态 ${this.context.state}`);
      }
    }

    // 监测状态一致性
    const consistency = this.checkConsistency();
    if (!consistency.consistent && consistency.primary) {
      console.warn(`[StateSynchronizer] ${eventName} 触发后检测到状态不一致:`, {
        workflowState: consistency.primary.workflowState,
        agentStatus: consistency.primary.actual,
        expected: consistency.primary.expected,
        agentType: consistency.primary.agentType,
        payload,
      });
    }
  }

  getAgentStatus(agentType = "deepsearch") {
    return this._agentStatus[agentType];
  }

  checkConsistency() {
    const state = this.context.state;
    const deepsearchRelevant = new Set([WorkflowState.READING, WorkflowState.RESEARCHING, WorkflowState.DEEPSEARCH_REVIEW]);
    const designRelevant = new Set([WorkflowState.DESIGNER]);

    if (designRelevant.has(state)) {
      const designResult = validateStateConsistency(state, this._agentStatus.design, "design");
      return { consistent: designResult.consistent, primary: designResult, deepsearch: null, design: designResult };
    }

    if (deepsearchRelevant.has(state)) {
      const deepsearchResult = validateStateConsistency(state, this._agentStatus.deepsearch, "deepsearch");
      return { consistent: deepsearchResult.consistent, primary: deepsearchResult, deepsearch: deepsearchResult, design: null };
    }

    return { consistent: true, primary: null, deepsearch: null, design: null };
  }
}

export default StateSynchronizer;
