/**
 * Workflow State Machine
 * 统一状态枚举、转换表、验证函数
 */

// 工作流状态枚举
export const WorkflowState = Object.freeze({
  IDLE: "idle",
  READING: "reading",
  SCANNING: "scanning",
  RESEARCHING: "researching",
  DEEPSEARCH_REVIEW: "deepsearch_review",
  SCRIPT_REVIEW: "script_review",
  OUTLINE_REVIEW: "outline_review",
  OUTLINE_PLANNING: "outline_planning",
  PAGE_LAYOUT: "page_layout",
  BRIEFING: "briefing",
  DESIGN_PREFERENCES: "design_preferences",  // 新增：色卡/参考选择
  DESIGNER: "designer",
  COMPLETED: "completed",
  EDITING: "editing",
  QUESTIONING: "questioning",
  SCRIPTING: "scripting",
  FAILED: "failed",
});

// 合法转换表
export const WORKFLOW_TRANSITIONS = {
  [WorkflowState.IDLE]: [WorkflowState.READING, WorkflowState.SCANNING, WorkflowState.BRIEFING],
  [WorkflowState.BRIEFING]: [WorkflowState.IDLE],
  [WorkflowState.READING]: [WorkflowState.RESEARCHING, WorkflowState.SCANNING, WorkflowState.SCRIPT_REVIEW, WorkflowState.FAILED, WorkflowState.IDLE],
  [WorkflowState.SCANNING]: [WorkflowState.OUTLINE_PLANNING, WorkflowState.FAILED, WorkflowState.IDLE],
  [WorkflowState.RESEARCHING]: [WorkflowState.DEEPSEARCH_REVIEW, WorkflowState.FAILED],
  [WorkflowState.DEEPSEARCH_REVIEW]: [WorkflowState.SCRIPT_REVIEW, WorkflowState.RESEARCHING],
  [WorkflowState.SCRIPT_REVIEW]: [WorkflowState.PAGE_LAYOUT, WorkflowState.OUTLINE_REVIEW],
  [WorkflowState.QUESTIONING]: [WorkflowState.SCRIPT_REVIEW, WorkflowState.IDLE],
  [WorkflowState.SCRIPTING]: [WorkflowState.OUTLINE_REVIEW, WorkflowState.PAGE_LAYOUT, WorkflowState.FAILED],
  [WorkflowState.OUTLINE_REVIEW]: [WorkflowState.OUTLINE_PLANNING],
  [WorkflowState.OUTLINE_PLANNING]: [WorkflowState.PAGE_LAYOUT, WorkflowState.FAILED],
  [WorkflowState.PAGE_LAYOUT]: [WorkflowState.DESIGN_PREFERENCES],
  [WorkflowState.DESIGN_PREFERENCES]: [WorkflowState.DESIGNER],
  [WorkflowState.DESIGNER]: [WorkflowState.COMPLETED, WorkflowState.FAILED],
  [WorkflowState.COMPLETED]: [WorkflowState.IDLE, WorkflowState.EDITING],
  [WorkflowState.EDITING]: [WorkflowState.COMPLETED, WorkflowState.IDLE],
  [WorkflowState.FAILED]: [WorkflowState.IDLE],
};

/**
 * 验证并执行状态转换
 * @param {object} context - 包含当前状态的对象 (通常是 this)
 * @param {string} to - 目标状态
 * @param {object} [meta] - 转换元数据（用于日志）
 * @returns {boolean} 转换是否成功
 */
export function transitionWorkflow(context, to, meta = {}) {
  const from = context.state;
  const allowed = WORKFLOW_TRANSITIONS[from] || [];
  
  if (!allowed.includes(to)) {
    console.error(`[Workflow] 非法转换: ${from} → ${to}`, meta);
    return false;
  }
  
  console.log(`[Workflow] 状态转换: ${from} → ${to}`, meta);
  context.state = to;
  return true;
}

/**
 * 强制设置状态（跳过验证，仅用于初始化或恢复）
 * @param {object} context - 包含当前状态的对象
 * @param {string} state - 目标状态
 */
export function forceWorkflowState(context, state) {
  console.log(`[Workflow] 强制设置状态: ${context.state} → ${state}`);
  context.state = state;
}

// 可视化层阶段映射（供 deepsearch-flow-visualizer.js 使用）
export const FlowStage = Object.freeze({
  START: "start",
  SCAN: "scan",
  GAPS: "gaps",
  RETRIEVE: "retrieve",
  UNDERSTAND: "understand",
  WRITE: "write",
  CONDENSE: "condense",
  EXTERNAL: "external",
  CHECKPOINT: "checkpoint",
  ITERATION: "iteration",
  // Design Flow
  DESIGN_START: "design_start",
  DESIGN_THEME: "design_theme",
  DESIGN_BATCH: "design_batch",
  DESIGN_SLIDE: "design_slide",
  DESIGN_QA: "design_qa",
  END: "end",
  ERROR: "error",
});

// 全局导出供 IIFE 文件使用
if (typeof window !== 'undefined') {
  window.WorkflowState = WorkflowState;
  window.transitionWorkflow = transitionWorkflow;
  window.forceWorkflowState = forceWorkflowState;
}
