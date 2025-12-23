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
 * DeepSearch 事件（合并自 runtime 和 stages/deepsearch）
 */
export const DeepSearchEvents = Object.freeze({
  // 生命周期
  STARTED: "deepsearch.started",
  COMPLETED: "deepsearch.completed",
  ABORTED: "deepsearch.aborted",

  // Phase
  PHASE_STARTED: "deepsearch.phase.started",
  PHASE_COMPLETED: "deepsearch.phase.completed",
  PHASE_TRANSITION: "deepsearch.phase.transition",

  // Scan
  SCAN_STARTED: "deepsearch.scan.started",
  SCAN_PROGRESS: "deepsearch.scan.progress",
  SCAN_COMPLETED: "deepsearch.scan.completed",

  // Gaps
  GAPS_STARTED: "deepsearch.gaps.started",
  GAPS_PROGRESS: "deepsearch.gaps.progress",
  GAPS_COMPLETED: "deepsearch.gaps.completed",
  GAP_UPSERTED: "deepsearch.gap.upserted",
  GAP_STATUS_CHANGED: "deepsearch.gap.status.changed",

  // Retrieve
  RETRIEVE_STARTED: "deepsearch.retrieve.started",
  RETRIEVE_PROGRESS: "deepsearch.retrieve.progress",
  RETRIEVE_COMPLETED: "deepsearch.retrieve.completed",
  RETRIEVE_DEDUPED: "deepsearch.retrieve.deduped",
  RETRIEVE_REFINE: "deepsearch.retrieve.refine",
  RETRIEVE_STRATEGY: "deepsearch.retrieve.strategy",
  RETRIEVE_TOOLCHAIN: "deepsearch.retrieve.toolchain",
  RETRIEVE_TOOLCHAIN_ERROR: "deepsearch.retrieve.toolchain_error",
  CHUNKS_ADDED: "deepsearch.chunks.added",
  RERANK_COMPLETED: "deepsearch.rerank.completed",
  RERANK_FAILED: "deepsearch.rerank.failed",

  // Understand
  UNDERSTAND_STARTED: "deepsearch.understand.started",
  UNDERSTAND_PROGRESS: "deepsearch.understand.progress",
  UNDERSTAND_COMPLETED: "deepsearch.understand.completed",
  CLAIM_SNAPSHOT: "deepsearch.claim.snapshot",
  CLAIM_ORPHANED: "deepsearch.claim.orphaned",
  EVIDENCE_SNAPSHOT: "deepsearch.evidence.snapshot",
  EVIDENCE_INVALID: "deepsearch.evidence.invalid",
  REFLECT_NEEDSMORE: "deepsearch.reflect.needsmore",
  HARDGATE_DEGRADED: "deepsearch.hardgate.degraded",
  SHADOW_COMPLETED: "deepsearch.shadow.completed",

  // Write
  WRITE_STARTED: "deepsearch.write.started",
  WRITE_PROGRESS: "deepsearch.write.progress",
  WRITE_COMPLETED: "deepsearch.write.completed",
  WRITE_MODE: "deepsearch.write.mode",
  WRITE_TOC_PLANNED: "deepsearch.write.toc.planned",
  WRITE_SECTION_STARTED: "deepsearch.write.section.started",
  WRITE_SECTION_COMPLETED: "deepsearch.write.section.completed",
  WRITE_REVIEW_STARTED: "deepsearch.write.review.started",
  WRITE_REVIEW_COMPLETED: "deepsearch.write.review.completed",
  WRITE_PATCH_APPLIED: "deepsearch.write.patch.applied",
  WRITE_BACKTRACK_REQUESTED: "deepsearch.write.backtrack.requested",
  WRITE_PARTIAL_RECOVERED: "deepsearch.write.partial.recovered",
  // ReAct 系列
  WRITE_REACT_STEP: "deepsearch.write.react.step",
  WRITE_REACT_FAILED: "deepsearch.write.react.failed",
  WRITE_REACT_ERROR: "deepsearch.write.react.error",
  WRITE_REACT_PARSE_RETRY: "deepsearch.write.react.parse_retry",
  WRITE_REACT_PARSE_ERROR: "deepsearch.write.react.parse_error",
  WRITE_REACT_VALIDATION_ERROR: "deepsearch.write.react.validation_error",
  WRITE_REACT_LEVEL_UPGRADE: "deepsearch.write.react.level_upgrade",
  WRITE_REACT_FINISH_REJECTED: "deepsearch.write.react.finish_rejected",
  WRITE_REACT_FINISH_ACCEPTED: "deepsearch.write.react.finish_accepted",
  WRITE_REACT_HARD_LIMIT: "deepsearch.write.react.hard_limit",
  WRITE_REACT_FALLBACK: "deepsearch.write.react.fallback",

  // Condense
  CONDENSE_STARTED: "deepsearch.condense.started",
  CONDENSE_PROGRESS: "deepsearch.condense.progress",
  CONDENSE_COMPLETED: "deepsearch.condense.completed",

  // Review
  REVIEW_STARTED: "deepsearch.review.started",
  REVIEW_PROGRESS: "deepsearch.review.progress",
  REVIEW_COMPLETED: "deepsearch.review.completed",

  // External
  EXTERNAL_STARTED: "deepsearch.external.started",
  EXTERNAL_PROGRESS: "deepsearch.external.progress",
  EXTERNAL_COMPLETED: "deepsearch.external.completed",
  EXTERNAL_SKIPPED: "deepsearch.external.skipped",
  EXTERNAL_ERROR: "deepsearch.external.error",
  EXTERNAL_TRIGGERED: "deepsearch.external.triggered",
  EXTERNAL_REFLECT_TRIGGERED: "deepsearch.external.reflecttriggered",

  // Trajectory
  TRAJECTORY_STARTED: "deepsearch.trajectory.started",
  TRAJECTORY_COMPLETED: "deepsearch.trajectory.completed",
  TRAJECTORY_FORKED: "deepsearch.trajectory.forked",
  TRAJECTORY_MERGED: "deepsearch.trajectory.merged",
  TRAJECTORY_MERGE_STARTED: "deepsearch.trajectory.merge.started",
  TRAJECTORY_MERGE_COMPLETED: "deepsearch.trajectory.merge.completed",

  // Node
  NODE_STARTED: "deepsearch.node.started",
  NODE_COMPLETED: "deepsearch.node.completed",
  NODE_FAILED: "deepsearch.node.failed",

  // Iteration
  ITERATION_STARTED: "deepsearch.iteration.started",
  ITERATION_COMPLETED: "deepsearch.iteration.completed",

  // Checkpoint
  CHECKPOINT_SAVED: "deepsearch.checkpoint.saved",
  CHECKPOINT_RESTORED: "deepsearch.checkpoint.restored",

  // Budget
  BUDGET_ESTIMATED: "deepsearch.budget.estimated",
  BUDGET_WARNING: "deepsearch.budget.warning",
  BUDGET_EXCEEDED: "deepsearch.budget.exceeded",
  BUDGET_DEGRADED: "deepsearch.budget.degraded",
  BUDGET_STOP: "deepsearch.budget.stop",

  // Direct
  DIRECT_STARTED: "deepsearch.direct.started",
  DIRECT_COMPLETED: "deepsearch.direct.completed",
  DIRECT_TRIGGERED: "deepsearch.direct.triggered",

  // Todo
  TODO_CREATED: "deepsearch.todo.created",
  TODO_STATUS_CHANGED: "deepsearch.todo.status.changed",

  // Config
  CONFIG_VALIDATION: "deepsearch.config.validation",

  // Token
  TOKEN_USAGE: "deepsearch.token.usage",
});

/**
 * Design 事件（合并自 runtime 和 stages/design）
 */
export const DesignEvents = Object.freeze({
  // 生命周期
  STARTED: "design.started",
  COMPLETED: "design.completed",

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
 * 根据事件名获取事件类别前缀
 */
export function getEventPrefix(eventName) {
  if (typeof eventName !== "string") return null;
  const parts = eventName.split(".");
  return parts.length > 1 ? parts[0] : null;
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

  // 支持 "prefix.*" 模式
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return eventName === prefix || eventName.startsWith(prefix + ".");
  }

  // 转为正则
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$").test(eventName);
}
