/**
 * DeepSearch 模块常量配置
 */

import { GapStatus } from "./gap-utils.js";

// Chunk 配置
export const CHUNK_CONFIG = Object.freeze({
  DEFAULT_SIZE: 1600,
  DEFAULT_OVERLAP: 180,
  DEFAULT_TOP_K: 6,
  DEFAULT_WINDOW_SIZE: 3,
  MAX_CHUNKS_LRU: 5000,
});

// Gap 配置
export const GAP_CONFIG = Object.freeze({
  BLOCK_AFTER_MISSES: 3,
  MIN_EVIDENCE_TO_FILL: 2,
  QUALITY_THRESHOLD: 0.5,
  NO_NEW_HITS_ROUNDS: 2,
});

// 并发配置
export const CONCURRENCY_CONFIG = Object.freeze({
  DEFAULT_PARALLEL: 5,
  MAX_TRAJECTORY_PARALLEL: 3,
  GLOBAL_LLM_POOL_SIZE: 10,
});

// Gap 类型
export const GAP_TYPES = Object.freeze([
  "definition",
  "data",
  "mechanism",
  "application",
  "comparison",
  "trend",
  "solution",
  "benefit",
  "implementation",
  "cost",
  "background",
  "challenge",
  "question",
]);

// 小文档阈值
export const SMALL_DOC_THRESHOLD = 20000;

// DeepSearch Phase 状态枚举
export const PhaseStatus = Object.freeze({
  SCAN: "scan",
  GAPS: "gaps",
  ROUND: "round", // retrieve + understand
  WRITE: "write",
  CONDENSE: "condense",
  COMPLETED: "completed",
});

// Phase 状态转换表
export const PHASE_TRANSITIONS = Object.freeze({
  [PhaseStatus.SCAN]: [PhaseStatus.GAPS, PhaseStatus.COMPLETED],
  [PhaseStatus.GAPS]: [PhaseStatus.ROUND, PhaseStatus.WRITE],
  [PhaseStatus.ROUND]: [PhaseStatus.GAPS, PhaseStatus.WRITE],
  [PhaseStatus.WRITE]: [PhaseStatus.CONDENSE, PhaseStatus.ROUND],
  [PhaseStatus.CONDENSE]: [PhaseStatus.COMPLETED],
  [PhaseStatus.COMPLETED]: [],
});

// Gap 优先级枚举
export const GapPriority = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

// Todo 状态枚举
export const TodoStatus = Object.freeze({
  OPEN: "open",
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

// PlanNode 状态枚举
export const PlanNodeStatus = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  BLOCKED: "blocked",
});

// PlanNode 类型枚举
export const PlanNodeType = Object.freeze({
  GOAL: "goal",
  SUBGOAL: "subgoal",
  QUERY: "query",
});

// Decision 结果枚举
export const DecisionOutcome = Object.freeze({
  SUCCESS: "success",
  FAIL: "fail",
  PARTIAL: "partial",
  UNKNOWN: "unknown",
});

// Decision 阶段枚举
export const DecisionStage = Object.freeze({
  SCAN: "scan",
  GAPS: "gaps",
  RETRIEVE: "retrieve",
  UNDERSTAND: "understand",
  WRITE: "write",
  CONDENSE: "condense",
  UNKNOWN: "unknown",
});

// 检索策略枚举
export const RetrievalStrategy = Object.freeze({
  GREP: "grep",
  BM25: "bm25",
  TOOL_CHAIN: "tool-chain",
  EXTERNAL: "external",
});

// 验证函数
export function isValidGapPriority(value) {
  return Object.values(GapPriority).includes(value);
}

export function isValidGapStatus(value) {
  return Object.values(GapStatus).includes(value);
}

export function isValidPlanNodeStatus(value) {
  return Object.values(PlanNodeStatus).includes(value);
}

export function isValidDecisionOutcome(value) {
  return Object.values(DecisionOutcome).includes(value);
}

// Re-export GapStatus from gap-utils.js
export { GapStatus } from "./gap-utils.js";

// Re-export from trajectory.js for convenience
export { MergeStrategy, CachePolicy, DivergeAt, TrajectoryStatus } from "./trajectory.js";

// Checkpoint 模式枚举
export const CheckpointMode = Object.freeze({
  FULL: "full",
  LITE: "lite",
  MINIMAL: "minimal",
});

// Writer 模式枚举
export const WriterMode = Object.freeze({
  STRUCTURED: "structured",
  FREEFORM: "freeform",
  HYBRID: "hybrid",
});

// Reviewer 模式枚举
export const ReviewerMode = Object.freeze({
  STRICT: "strict",
  LENIENT: "lenient",
  AUTO: "auto",
});

// Claim 重要性枚举
export const ClaimImportance = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

// Evidence 强度枚举
export const EvidenceStrength = Object.freeze({
  STRONG: "strong",
  MODERATE: "moderate",
  WEAK: "weak",
  UNVERIFIED: "unverified",
});

