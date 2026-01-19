/**
 * Shared Layer - Common utilities for agents
 */

// Archive
export { Archive, MapAdapter } from "./archive/archive.js";
export { CheckpointType, createCheckpoint, migrateCheckpoint } from "./archive/checkpoint-schema.js";

// Platform detection
export { Platform, isNodeLike } from "./platform.js";

// Base classes
export { DisposableBase } from "./base/disposable-base.js";

// Utils - Core
export { createBudgetManager, BudgetAction } from "./utils/budget.js";
export { injectSystemHint } from "./utils/message-utils.js";
export { robustParseJson } from "./utils/robust-json.js";
export { createStageApi } from "./utils/stage-api.js";
export { isPlainObject, toNonEmptyString, normalizeRenderType, toPositiveInt, deepClone, sanitizeForJson } from "./utils/value-utils.js";
export { createLogger, trackToolCall, logEvent } from "./utils/logger.js";
export { safeExec, catchAndLog, makeSafe, isAbortError, isTimeoutError, wrapError } from "./utils/error-utils.js";
export { Deque } from "./utils/deque.js";
export { safeJsonParse } from "./utils/safe-json.js";
export { extractJsonCandidate, stripThinkingTags } from "./utils/json-candidate.js";
export { FileWatcher } from "./utils/file-watcher.js";
export { cryptoRandomHex, cryptoRandomUuid, makeSecureId, makeSecureTimestampedId } from "./utils/secure-id.js";
export { checkCancelled, withCancellation, createLinkedSignal } from "./utils/cancellation.js";
export { classifyDeepSearchError, classifyDesignError } from "./utils/error-classifier.js";
export { normalizeMaxBytes, createResponseTooLargeError, readTextWithLimit, readJsonWithLimit } from "./utils/response-limits.js";
export { estimateTokensCached, clearTokenCache, getTokenCacheStats } from "./utils/token-cache.js";
export { isPotentiallyDangerous, createSafeRegex, safeMatch, globToRegex } from "./utils/safe-regex.js";
export { EventEmitter } from "./utils/event-emitter.js";
export { LRUCache, createAutoPruningCache } from "./utils/lru-cache.js";
export { PB_ENCRYPTED_PREFIX, isEncryptedString, canUseStorageEncryption, encryptString, decryptString } from "./utils/storage-crypto.js";
export {
  validateChunk,
  validateChunks,
  validateGlobResult,
  validateGrepMatch,
  validateGrepResults,
  validateSearchQuery,
  ValidationErrorCode,
  createValidationError,
} from "./utils/schema-validator.js";

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

// Contracts (Runtime Boundary Validation)
export {
  validateRpcRequest,
  validateRpcResponse,
  validateLlmResponse,
  validateToolCall,
  validateToolResult,
  normalizeToolResult,
} from "./contracts/index.js";

// Embeddings
export { EmbeddingService, createEmbeddingService, normalizeEmbeddingConfig } from "./embeddings/embedding-service.js";
export { VectorIndex } from "./embeddings/vector-index.js";
export { HnswLiteIndex } from "./embeddings/hnsw-lite.js";
