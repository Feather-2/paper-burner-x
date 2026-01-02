/**
 * Shared Layer - Common utilities for agents
 */

// Archive
export { Archive, MapAdapter } from "./archive/archive.js";
export { CheckpointType, createCheckpoint, migrateCheckpoint } from "./archive/checkpoint-schema.js";

// Utils
export { createBudgetManager, BudgetAction } from "./utils/budget.js";
export { injectSystemHint } from "./utils/message-utils.js";
export { robustParseJson } from "./utils/robust-json.js";
export { createStageApi } from "./utils/stage-api.js";
export { isPlainObject, toNonEmptyString } from "./utils/value-utils.js";
export { createLogger, trackToolCall } from "./utils/logger.js";
export { Deque } from "./utils/deque.js";
export { safeJsonParse } from "./utils/safe-json.js";
export { extractJsonCandidate, stripThinkingTags } from "./utils/json-candidate.js";

// Storage & Resilience
export {
  hasLocalStorage,
  estimateLocalStorageUsage,
  estimateLocalStorageQuota,
  getLocalStorageQuotaStatus,
  safeLocalStorageSet,
  cleanupLocalStorage,
  getIndexedDBQuotaStatus,
} from "./utils/storage-quota.js";

export {
  CircuitState,
  CircuitBreaker,
  CircuitBreakerRegistry,
  getGlobalCircuitBreakerRegistry,
  getCircuitBreaker,
  withCircuitBreaker,
} from "./utils/circuit-breaker.js";

// Embeddings
export { EmbeddingService, createEmbeddingService, normalizeEmbeddingConfig } from "./embeddings/embedding-service.js";
export { VectorIndex } from "./embeddings/vector-index.js";
export { HnswLiteIndex } from "./embeddings/hnsw-lite.js";
