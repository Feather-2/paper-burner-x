  /**
 * UnifiedStateMapping - 统一 WorkflowState 和 AgentLoopStatus
 *
 * 解决问题：
 * 1. WorkflowState (UI层) 和 AgentLoopStatus (Agent层) 双轨运行
 * 2. UI 无法精确追踪 Agent 实际进度
 * 3. 状态同步缺乏清晰对应关系
 */

import { WorkflowState, transitionWorkflow } from "./workflow-states.js";
import { AgentLoopStatus } from "../../agents/stages/deepsearch/states.js";
import { DesignLoopStatus } from "../../agents/stages/design/states.js";

const LOOP_RUNNING_STATUSES = new Set([
  AgentLoopStatus.RUNNING,
  AgentLoopStatus.OBSERVING,
  AgentLoopStatus.THINKING,
  AgentLoopStatus.EXECUTING,
  AgentLoopStatus.REVIEWING,
]);
const LOOP_PAUSED_STATUSES = new Set([AgentLoopStatus.PAUSED]);
const LOOP_COMPLETED_STATUSES = new Set([AgentLoopStatus.COMPLETED]);
const LOOP_FAILED_STATUSES = new Set([AgentLoopStatus.ABORTED, "failed"]);

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
  if (loopStatus === AgentLoopStatus.IDLE) return UiAgentStatus.IDLE;
  if (Object.values(UiAgentStatus).includes(loopStatus)) return loopStatus;
  return unknown;
}

/**
 * AgentLoopStatus → WorkflowState 映射
 * 根据当前 workflow 阶段和 agent 状态，推断 UI 应显示的状态
 */
export const AgentToWorkflowMap = Object.freeze({
  // DeepSearch Agent 状态映射
  deepsearch: {
    [AgentLoopStatus.IDLE]: null,
    [AgentLoopStatus.RUNNING]: WorkflowState.RESEARCHING,
    [AgentLoopStatus.OBSERVING]: WorkflowState.RESEARCHING,
    [AgentLoopStatus.THINKING]: WorkflowState.RESEARCHING,
    [AgentLoopStatus.EXECUTING]: WorkflowState.RESEARCHING,
    [AgentLoopStatus.REVIEWING]: WorkflowState.DEEPSEARCH_REVIEW,
    [AgentLoopStatus.PAUSED]: WorkflowState.DEEPSEARCH_REVIEW,
    [AgentLoopStatus.COMPLETED]: WorkflowState.SCRIPT_REVIEW,
    [AgentLoopStatus.ABORTED]: WorkflowState.FAILED,
  },

  // Design Agent 状态映射
  design: {
    [DesignLoopStatus.IDLE]: null,
    [DesignLoopStatus.RUNNING]: WorkflowState.DESIGNER,
    [DesignLoopStatus.OBSERVING]: WorkflowState.DESIGNER,
    [DesignLoopStatus.THINKING]: WorkflowState.DESIGNER,
    [DesignLoopStatus.EXECUTING]: WorkflowState.DESIGNER,
    [DesignLoopStatus.REVIEWING]: WorkflowState.DESIGNER,
    [DesignLoopStatus.PAUSED]: WorkflowState.DESIGNER,
    [DesignLoopStatus.COMPLETED]: WorkflowState.COMPLETED,
    [DesignLoopStatus.ABORTED]: WorkflowState.FAILED,
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
 * WorkflowState → 预期 AgentLoopStatus 范围
 * 用于验证状态一致性
 */
export const WorkflowToAgentExpectation = Object.freeze({
  [WorkflowState.READING]: [AgentLoopStatus.IDLE, AgentLoopStatus.RUNNING],
  [WorkflowState.RESEARCHING]: [
    AgentLoopStatus.RUNNING,
    AgentLoopStatus.OBSERVING,
    AgentLoopStatus.THINKING,
    AgentLoopStatus.EXECUTING,
  ],
  [WorkflowState.DEEPSEARCH_REVIEW]: [
    AgentLoopStatus.EXECUTING, // 允许在执行末尾进入审阅态
    AgentLoopStatus.REVIEWING,
    AgentLoopStatus.PAUSED,
    AgentLoopStatus.COMPLETED,
  ],
  [WorkflowState.DESIGNER]: [
    DesignLoopStatus.RUNNING,
    DesignLoopStatus.OBSERVING,
    DesignLoopStatus.THINKING,
    DesignLoopStatus.EXECUTING,
    DesignLoopStatus.REVIEWING,
    DesignLoopStatus.PAUSED,
  ],
});

/**
 * 从 Agent 事件推断 WorkflowState
 * @param {string} eventName - 事件名称
 * @param {string} currentWorkflowState - 当前 workflow 状态
 * @param {object} payload - 事件载荷
 * @returns {string|null} 推荐的 WorkflowState，或 null 表示不变
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
 * 验证 WorkflowState 和 AgentLoopStatus 是否一致
 * @param {string} workflowState - UI 层状态
 * @param {string} agentStatus - Agent 层状态
 * @param {string} agentType - "deepsearch" | "design"
 * @returns {{consistent: boolean, expected: string[], actual: string}}
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
    this._agentStatus = { deepsearch: AgentLoopStatus.IDLE, design: DesignLoopStatus.IDLE };
  }

  /**
   * 处理 Agent 事件，自动同步状态
   * @param {string} eventName - 事件名称
   * @param {object} payload - 事件载荷
   */
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
      if (this._agentStatus.deepsearch === AgentLoopStatus.IDLE) this._agentStatus.deepsearch = AgentLoopStatus.RUNNING;
    }
    if (eventName === "deepsearch.agent.paused") {
      this._agentStatus.deepsearch = AgentLoopStatus.PAUSED;
    }
    if (eventName === "deepsearch.agent.completed") {
      this._agentStatus.deepsearch = AgentLoopStatus.COMPLETED;
    }
    if (eventName === "deepsearch.agent.aborted" || eventName === "deepsearch.agent.failed") {
      this._agentStatus.deepsearch = AgentLoopStatus.ABORTED;
    }
    if (eventName === "design.agent.status.changed" || eventName === "design.loop.status.changed") {
      this._agentStatus.design = payload?.to || this._agentStatus.design;
    }
    if (eventName === "design.ended" || eventName === "design.agent.completed" || eventName === "design.completed") {
      this._agentStatus.design = DesignLoopStatus.COMPLETED;
    }
    if (eventName === "design.failed" || eventName === "design.agent.failed" || eventName === "design.agent.aborted") {
      this._agentStatus.design = DesignLoopStatus.ABORTED;
    }

    // 推断 workflow 状态
    const suggested = inferWorkflowStateFromEvent(
      eventName,
      this.context.state,
      payload
    );

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

  /**
   * 获取当前 Agent 状态
   */
  getAgentStatus(agentType = "deepsearch") {
    return this._agentStatus[agentType];
  }

  /**
   * 检查状态一致性
   */
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
