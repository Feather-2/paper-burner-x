/**
 * Shared Layer - Common utilities for agents
 */

// Platform detection
export { Platform, isNodeLike } from "./platform.js";

// Base classes
export { DisposableBase } from "./base/disposable-base.js";

// Utils - Core
export { createBudgetManager, BudgetAction } from "./utils/budget.js";
export { injectSystemHint } from "./utils/message-utils.js";
export { robustParseJson } from "./utils/robust-json.js";
export { createStageApi, StageApiSpec, validateStageApi, extractServices, mergeStageApis, createChildApi, createRunTool } from "./utils/stage-api.js";
export { isPlainObject, toNonEmptyString, normalizeRenderType, toPositiveInt, toNonNegativeInt, deepClone, sanitizeForJson, safeInt, safeNumber } from "./utils/value-utils.js";
export { createLogger, trackToolCall, logEvent } from "./utils/logger.js";
export { safeExec, catchAndLog, makeSafe, isAbortError, isTimeoutError } from "./utils/error-utils.js";
export { wrapError, toErrorMessage } from "./utils/error-utils-extended.js";
export { Deque } from "./utils/deque.js";
export { safeJsonParse } from "./utils/safe-json.js";
export { extractJsonCandidate, stripThinkingTags } from "./utils/json-candidate.js";
export { FileWatcher, isNativeWatchSupported } from "./utils/file-watcher.js";
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

// ============================================
// Re-exports for backward compatibility
// (modules moved to core/ and retrieval/)
// ============================================

// Archive (moved to core/archive)
export { Archive, MapAdapter, FallbackAdapter } from "../core/archive/archive.js";
export { CheckpointType, createCheckpoint, migrateCheckpoint } from "../core/archive/checkpoint-schema.js";

// Contracts (moved to core/contracts)
export {
  validateRpcRequest,
  validateRpcResponse,
  validateLlmResponse,
  validateToolCall,
  validateToolResult,
  normalizeToolResult,
} from "../core/contracts/index.js";

// Embeddings (moved to retrieval/embeddings)
export { EmbeddingService, createEmbeddingService, normalizeEmbeddingConfig } from "../retrieval/embeddings/embedding-service.js";
export { VectorIndex } from "../retrieval/embeddings/vector-index.js";
export { HnswLiteIndex } from "../retrieval/embeddings/hnsw-lite.js";

// Tokenizers
export { createAdaptiveTokenCounter, getGlobalTokenCounter } from "./tokenizers/adaptive-token-counter.js";
