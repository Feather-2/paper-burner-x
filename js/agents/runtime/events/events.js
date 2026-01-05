// js/agents/runtime/events.js
// 运行时事件名枚举 - 单一真源

/**
 * 事件状态常量
 */
export const EventStatus = Object.freeze({
  STARTED: "started",
  PROGRESS: "progress",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
  WARNING: "warning",
  INFO: "info",
});

/**
 * 运行时核心事件
 */
export const RuntimeEvents = Object.freeze({
  // Run 生命周期
  RUN_STARTED: "run.started",
  RUN_COMPLETED: "run.completed",
  RUN_FAILED: "run.failed",
  RUN_CANCELLED: "run.cancelled",

  // Stage 生命周期
  STAGE_STARTED: "stage.started",
  STAGE_PROGRESS: "stage.progress",
  STAGE_COMPLETED: "stage.completed",
  STAGE_FAILED: "stage.failed",
  STAGE_INJECTED: "stage.injected",
});

/**
 * ReviewRules 事件
 */
export const ReviewEvents = Object.freeze({
  REVIEW_STARTED: "review.started",
  REVIEW_COMPLETED: "review.completed",
  REVIEW_FAILED: "review.failed",
});

/**
 * AsyncCompressor 事件
 */
export const CompressionEvents = Object.freeze({
  COMPRESSION_SCHEDULED: "compression.scheduled",
  COMPRESSION_APPLIED: "compression.applied",
  COMPRESSION_FAILED: "compression.failed",
  COMPRESSION_ADVISED: "compression.advised",
  COMPRESSION_FORCED: "compression.forced",
});

/**
 * Archive 事件
 */
export const ArchiveEvents = Object.freeze({
  CHECKPOINT_SAVED: "archive.checkpoint.saved",
  CHECKPOINT_RESTORED: "archive.checkpoint.restored",
  CHECKPOINT_DELETED: "archive.checkpoint.deleted",
});

/**
 * RouterAgent 事件
 */
export const RouterEvents = Object.freeze({
  ROUTER_PLAN_START: "router.plan.start",
  ROUTER_COMPLEXITY_ASSESSED: "router.complexity.assessed",
  ROUTER_PIPELINE_ASSEMBLED: "router.pipeline.assembled",
  ROUTER_BLOCK_SELECTED: "router.block.selected",
});

/**
 * Watchdog 事件
 */
export const WatchdogEvents = Object.freeze({
  WATCHDOG_DELEGATED: "watchdog.delegated",
  WATCHDOG_DECISION: "watchdog.decision",
  WATCHDOG_COMPRESSED: "watchdog.compressed",
  WATCHDOG_INTERVENTION: "watchdog.intervention",
});

/**
 * CicadaCompressor 事件
 */
export const CicadaEvents = Object.freeze({
  LAYER_COMPLETED: "cicada.layer.completed",
  SHED_COMPLETED: "cicada.shed.completed",
});

/**
 * DeepSearch 事件（新 Agent Loop + Skills 架构）
 *
 * 旧 Phase-Based 架构的事件已移除，仅保留：
 * - Agent Loop 生命周期事件
 * - Skills 发出的事件
 */
export const DeepSearchEvents = Object.freeze({
  // Agent Loop 生命周期
  AGENT_STATUS_CHANGED: "deepsearch.agent.status.changed",
  AGENT_STARTED: "deepsearch.agent.started",
  AGENT_COMPLETED: "deepsearch.agent.completed",
  AGENT_FAILED: "deepsearch.agent.failed",
  AGENT_PAUSED: "deepsearch.agent.paused",
  AGENT_ITERATION: "deepsearch.agent.iteration",
  AGENT_ERROR: "deepsearch.agent.error",
  MODEL_RESPONDED: "deepsearch.model.responded",

  // write-report skill
  SECTION_WRITTEN: "deepsearch.section.written",
  REPORT_GENERATED: "deepsearch.report.generated",
  EVIDENCE_SYNTHESIZED: "deepsearch.evidence.synthesized",
  DRAFT_UPDATED: "deepsearch.draft.updated",

  // manage-todos skill
  TODO_CREATED: "deepsearch.todo.created",
  TODO_UPDATED: "deepsearch.todo.updated",
  TODO_COMPLETED: "deepsearch.todo.completed",
  TODO_CANCELLED: "deepsearch.todo.cancelled",

  // search-docs skill
  SEARCH_COMPLETED: "deepsearch.search.completed",

  // Backtrack (from backtrack-manager)
  AGENT_BACKTRACKED: "deepsearch.agent.backtracked",
  AGENT_BACKTRACK_LIMIT: "deepsearch.agent.backtrack_limit",
});

/**
 * Design 事件（合并自 runtime 和 stages/design）
 */
export const DesignEvents = Object.freeze({
  // 生命周期
  STARTED: "design.started",
  COMPLETED: "design.completed",

  // Deck
  DECK_UPDATED: "design.deck.updated",

  // Tokens
  TOKENS_STARTED: "design.tokens.started",
  TOKENS_COMPLETED: "design.tokens.completed",

  // Brainstorm
  BRAINSTORM_STARTED: "design.brainstorm.started",
  BRAINSTORM_PROGRESS: "design.brainstorm.progress",
  BRAINSTORM_BATCH_STARTED: "design.brainstorm.batch.started",
  BRAINSTORM_BATCH_ERROR: "design.brainstorm.batch.error",
  BRAINSTORM_LLM_GENERATED: "design.brainstorm.llm.generated",
  BRAINSTORM_SLIDE_COMPLETED: "design.brainstorm.slide.completed",
  BRAINSTORM_CANDIDATES: "design.brainstorm.candidates",
  BRAINSTORM_COMPLETED: "design.brainstorm.completed",

  // Generate
  GENERATE_STARTED: "design.generate.started",
  GENERATE_PROGRESS: "design.generate.progress",
  GENERATE_COMPLETED: "design.generate.completed",

  // Batch
  BATCH_STARTED: "design.batch.started",
  BATCH_PROGRESS: "design.batch.progress",
  BATCH_COMPLETED: "design.batch.completed",

  // Image
  IMAGE_STARTED: "design.image.started",
  IMAGE_PROGRESS: "design.image.progress",
  IMAGE_COMPLETED: "design.image.completed",
  IMAGE_PLANNING_COMPLETED: "design.image.planning.completed",
  IMAGE_GENERATE_STARTED: "design.image.generate.started",
  IMAGE_GENERATE_SKIPPED: "design.image.generate.skipped",
  IMAGE_GENERATE_SUCCEEDED: "design.image.generate.succeeded",
  IMAGE_GENERATE_FAILED: "design.image.generate.failed",
  IMAGE_FILL_COMPLETED: "design.image.fill.completed",

  // Visual render
  VISUAL_RENDER_STARTED: "design.visual.render.started",
  VISUAL_RENDER_COMPLETED: "design.visual.render.completed",
  VISUAL_RENDER_FAILED: "design.visual.render.failed",

  // Refine
  REFINE_STARTED: "design.refine.started",
  REFINE_STEP: "design.refine.step",
  REFINE_FINISH_ACCEPTED: "design.refine.finish_accepted",
  REFINE_HARD_LIMIT: "design.refine.hard_limit",
  REFINE_COMPLETED: "design.refine.completed",

  // QA
  QA_STARTED: "design.qa.started",
  QA_COMPLETED: "design.qa.completed",

  // Degraded
  DEGRADED: "design.degraded",
});

/**
 * Ingest 事件
 */
export const IngestEvents = Object.freeze({
  STARTED: "ingest.started",
  COMPLETED: "ingest.completed",
  DOC_STARTED: "ingest.doc.started",
  DOC_COMPLETED: "ingest.doc.completed",
  DOC_FAILED: "ingest.doc.failed",
  ASSETS_UNDERSTANDING_STARTED: "ingest.assets.understanding.started",
  ASSETS_UNDERSTANDING_PROGRESS: "ingest.assets.understanding.progress",
  ASSETS_UNDERSTANDING_COMPLETED: "ingest.assets.understanding.completed",
  ASSETS_UNDERSTANDING_FAILED: "ingest.assets.understanding.failed",
});

/**
 * CodeSearch 事件
 */
export const CodeSearchEvents = Object.freeze({
  // Agent 生命周期
  AGENT_STATUS_CHANGED: "codesearch.agent.status.changed",
  STARTED: "codesearch.started",
  COMPLETED: "codesearch.completed",
  FAILED: "codesearch.failed",

  // Phase 转换
  PHASE_TRANSITION: "codesearch.phase.transition",

  // Step 执行
  STEP_STARTED: "codesearch.step.started",
  STEP_COMPLETED: "codesearch.step.completed",
  STEP_FAILED: "codesearch.step.failed",

  // Todo 管理
  TODO_CREATED: "codesearch.todo.created",
  TODO_UPDATED: "codesearch.todo.updated",
  TODO_COMPLETED: "codesearch.todo.completed",
});

/**
 * 统一的 Agent 生命周期事件协议
 * 所有 Agent 应使用此格式发出事件
 */
export const AgentLifecycleEvents = Object.freeze({
  STATUS_CHANGED: "agent.status.changed",
  STARTED: "agent.started",
  COMPLETED: "agent.completed",
  FAILED: "agent.failed",
  PAUSED: "agent.paused",
  RESUMED: "agent.resumed",
  ITERATION: "agent.iteration",
});

/**
 * 统一的 Phase 转换事件协议
 */
export const PhaseEvents = Object.freeze({
  TRANSITION: "phase.transition",
  STARTED: "phase.started",
  COMPLETED: "phase.completed",
});

/**
 * 根据事件名获取事件类别前缀
 */
export function getEventPrefix(eventName) {
  if (typeof eventName !== "string") return null;
  const parts = eventName.split(".");
  return parts.length > 1 ? parts[0] : null;
}

/**
 * 双指针通配符匹配 - O(m*n) 最坏情况，无指数回溯
 * @param {string} pattern - 通配符模式
 * @param {string} text - 待匹配文本
 */
function wildcardMatch(pattern, text) {
  let pi = 0, ti = 0;
  let starIdx = -1, matchIdx = -1;
  const pLen = pattern.length, tLen = text.length;

  while (ti < tLen) {
    if (pi < pLen && (pattern[pi] === text[ti] || pattern[pi] === "?")) {
      pi++;
      ti++;
    } else if (pi < pLen && pattern[pi] === "*") {
      starIdx = pi;
      matchIdx = ti;
      pi++;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx++;
      ti = matchIdx;
    } else {
      return false;
    }
  }

  while (pi < pLen && pattern[pi] === "*") pi++;
  return pi === pLen;
}

/**
 * 检查事件名是否匹配通配符模式
 * @param {string} pattern - 通配符模式，如 "deepsearch.*"
 * @param {string} eventName - 事件名
 */
export function matchEventPattern(pattern, eventName) {
  if (typeof pattern !== "string" || typeof eventName !== "string") return false;
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === eventName;

  // 快速路径: "prefix.*" 模式
  if (pattern.endsWith(".*") && !pattern.slice(0, -2).includes("*")) {
    const prefix = pattern.slice(0, -2);
    return eventName === prefix || eventName.startsWith(prefix + ".");
  }

  // 通用通配符匹配 - 使用双指针算法避免 ReDoS
  return wildcardMatch(pattern, eventName);
}
