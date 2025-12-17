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
});

// 并发配置
export const CONCURRENCY_CONFIG = Object.freeze({
  DEFAULT_PARALLEL: 5,
  MAX_TRAJECTORY_PARALLEL: 3,
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

