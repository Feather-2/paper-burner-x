/**
 * DeepSearch 模块常量配置
 */

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

// 检索策略枚举
export const RetrievalStrategy = Object.freeze({
  GREP: "grep",
  BM25: "bm25",
  TOOL_CHAIN: "tool-chain",
  EXTERNAL: "external",
});

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

// Re-export from states.js
export {
  PhaseStatus,
  PHASE_TRANSITIONS,
  phaseMachine,
  GapStatus,
  GAP_TRANSITIONS,
  gapMachine,
  GapPriority,
  TodoStatus,
  PlanNodeStatus,
  PlanNodeType,
  DecisionOutcome,
  DecisionStage,
  isValidGapPriority,
  isValidGapStatus,
  isValidPlanNodeStatus,
  isValidDecisionOutcome,
} from "./states.js";

