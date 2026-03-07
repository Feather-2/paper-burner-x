import { beforeEach, describe, expect, it, vi } from "vitest";

const SHARED_INDEX_PATH = "../../../../js/agents/shared/index.js";

const hoisted = vi.hoisted(() => {
  const THROW = Symbol("THROW");
  const EDGE_ARGS = [undefined, null, "", 0, -1, Number.MAX_SAFE_INTEGER, { a: 1 }, []];

  const ALL_EXPORTS = [
    "Archive",
    "BudgetAction",
    "CheckpointType",
    "CircuitBreaker",
    "CircuitBreakerRegistry",
    "CircuitState",
    "DEFAULT_TREE_SITTER_WASM_BASE_URL",
    "Deque",
    "DisposableBase",
    "EmbeddingService",
    "EventEmitter",
    "FallbackAdapter",
    "FileWatcher",
    "HnswLiteIndex",
    "LRUCache",
    "MapAdapter",
    "PB_ENCRYPTED_PREFIX",
    "Platform",
    "RetryStrategy",
    "StageApiSpec",
    "ValidationErrorCode",
    "VectorIndex",
    "canUseStorageEncryption",
    "catchAndLog",
    "checkCancelled",
    "classifyDeepSearchError",
    "classifyDesignError",
    "cleanupLocalStorage",
    "clearTokenCache",
    "createAdaptiveTokenCounter",
    "createAutoPruningCache",
    "createBudgetManager",
    "createCheckpoint",
    "createChildApi",
    "createEmbeddingService",
    "createLinkedSignal",
    "createLogger",
    "createResponseTooLargeError",
    "createRunTool",
    "createSafeRegex",
    "createStageApi",
    "createValidationError",
    "cryptoRandomHex",
    "cryptoRandomUuid",
    "decryptString",
    "deepClone",
    "encryptString",
    "estimateLocalStorageQuota",
    "estimateLocalStorageUsage",
    "estimateTokenCount",
    "estimateTokenCountFast",
    "estimateTokens",
    "estimateTokensCached",
    "extractJsonCandidate",
    "extractServices",
    "getCircuitBreaker",
    "getGlobalCircuitBreakerRegistry",
    "getGlobalRetryStats",
    "getGlobalTokenCounter",
    "getIndexedDBQuotaStatus",
    "getLocalStorageQuotaStatus",
    "getPlatformCapabilities",
    "getSecureIdCapabilities",
    "getTokenCacheStats",
    "globToRegex",
    "hasLocalStorage",
    "initTreeSitter",
    "injectSystemHint",
    "isAbortError",
    "isEncryptedString",
    "isNativeWatchSupported",
    "isNodeLike",
    "isNonRecoverableDeepSearchError",
    "isNonRetryableError",
    "isPlainObject",
    "isPotentiallyDangerous",
    "isRetryableError",
    "isSecureIdSupported",
    "isTimeoutError",
    "isWasmSupported",
    "isWasmThreadsSupported",
    "loadTreeSitterLanguage",
    "logEvent",
    "makeSafe",
    "makeSecureId",
    "makeSecureTimestampedId",
    "mergeSignals",
    "mergeStageApis",
    "migrateCheckpoint",
    "normalizeEmbeddingConfig",
    "normalizeKey",
    "normalizeMaxBytes",
    "normalizeRenderType",
    "normalizeToolResult",
    "protoSafeReviver",
    "readJsonWithLimit",
    "readTextWithLimit",
    "resetGlobalRetryStats",
    "robustParseJson",
    "safeExec",
    "safeInt",
    "safeJsonParse",
    "safeJsonParseDetailed",
    "safeLocalStorageSet",
    "safeMatch",
    "safeNumber",
    "sanitizeForJson",
    "shouldDegrade",
    "stripThinkingTags",
    "toBoolean",
    "toDeepSearchErrorMessage",
    "toErrorMessage",
    "toNonEmptyString",
    "toNonNegativeInt",
    "toNumber",
    "toPositiveInt",
    "trackToolCall",
    "useLogger",
    "validateChunk",
    "validateChunks",
    "validateGlobResult",
    "validateGrepMatch",
    "validateGrepResults",
    "validateLlmResponse",
    "validateRpcRequest",
    "validateRpcResponse",
    "validateSearchQuery",
    "validateStageApi",
    "validateToolCall",
    "validateToolResult",
    "withCancellation",
    "withCircuitBreaker",
    "withRetry",
    "wrapError",
  ];

  const CLASS_EXPORTS = [
    "Archive",
    "CircuitBreaker",
    "CircuitBreakerRegistry",
    "Deque",
    "DisposableBase",
    "EmbeddingService",
    "EventEmitter",
    "FallbackAdapter",
    "FileWatcher",
    "HnswLiteIndex",
    "LRUCache",
    "MapAdapter",
    "RetryStrategy",
    "VectorIndex",
  ];

  const VALUE_EXPORTS = [
    "Platform",
    "BudgetAction",
    "StageApiSpec",
    "PB_ENCRYPTED_PREFIX",
    "ValidationErrorCode",
    "CircuitState",
    "CheckpointType",
    "DEFAULT_TREE_SITTER_WASM_BASE_URL",
  ];

  const makeFn = (name) =>
    vi.fn((...args) => {
      if (args[0] === THROW) {
        throw new Error(`${name}_boom`);
      }
      return { name, args };
    });

  const makeClass = (name) =>
    class {
      constructor(...args) {
        if (args[0] === THROW) {
          throw new Error(`${name}_boom`);
        }
        this.args = args;
      }
    };

  const classes = Object.fromEntries(CLASS_EXPORTS.map((name) => [name, makeClass(name)]));

  const values = {
    Platform: Object.freeze({ __type: "Platform", node: "node", browser: "browser" }),
    BudgetAction: Object.freeze({ __type: "BudgetAction", ALLOCATE: "ALLOCATE", RELEASE: "RELEASE" }),
    StageApiSpec: Object.freeze({ __type: "StageApiSpec" }),
    PB_ENCRYPTED_PREFIX: "PB_ENCRYPTED:",
    ValidationErrorCode: Object.freeze({ __type: "ValidationErrorCode", INVALID: "INVALID", TOO_LARGE: "TOO_LARGE" }),
    CircuitState: Object.freeze({ __type: "CircuitState", OPEN: "OPEN", CLOSED: "CLOSED", HALF_OPEN: "HALF_OPEN" }),
    CheckpointType: Object.freeze({ __type: "CheckpointType", V1: "V1", V2: "V2" }),
    DEFAULT_TREE_SITTER_WASM_BASE_URL: "wasm/tree-sitter/",
  };

  const functionNames = ALL_EXPORTS.filter((name) => !CLASS_EXPORTS.includes(name) && !VALUE_EXPORTS.includes(name));
  const fns = Object.fromEntries(functionNames.map((name) => [name, makeFn(name)]));

  return {
    ALL_EXPORTS,
    CLASS_EXPORTS,
    VALUE_EXPORTS,
    EDGE_ARGS,
    THROW,
    functionNames,
    ...classes,
    ...values,
    ...fns,
  };
});

// Required mocks: do not import real implementations.
vi.mock("../../../../js/agents/shared/platform.js", () => ({
  Platform: hoisted.Platform,
  isNodeLike: hoisted.isNodeLike,
  getPlatformCapabilities: hoisted.getPlatformCapabilities,
}));
vi.mock("../../../../js/agents/shared/base/disposable-base.js", () => ({
  DisposableBase: hoisted.DisposableBase,
}));
vi.mock("../../../../js/agents/shared/utils/budget.js", () => ({
  createBudgetManager: hoisted.createBudgetManager,
  BudgetAction: hoisted.BudgetAction,
}));
vi.mock("../../../../js/agents/shared/utils/message-utils.js", () => ({
  injectSystemHint: hoisted.injectSystemHint,
}));
vi.mock("../../../../js/agents/shared/utils/robust-json.js", () => ({
  robustParseJson: hoisted.robustParseJson,
}));
vi.mock("../../../../js/agents/shared/utils/stage-api.js", () => ({
  createStageApi: hoisted.createStageApi,
  StageApiSpec: hoisted.StageApiSpec,
  validateStageApi: hoisted.validateStageApi,
  extractServices: hoisted.extractServices,
  mergeStageApis: hoisted.mergeStageApis,
  createChildApi: hoisted.createChildApi,
  createRunTool: hoisted.createRunTool,
}));
vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => ({
  isPlainObject: hoisted.isPlainObject,
  toNonEmptyString: hoisted.toNonEmptyString,
  toNumber: hoisted.toNumber,
  toBoolean: hoisted.toBoolean,
  normalizeKey: hoisted.normalizeKey,
  normalizeRenderType: hoisted.normalizeRenderType,
  toPositiveInt: hoisted.toPositiveInt,
  toNonNegativeInt: hoisted.toNonNegativeInt,
  deepClone: hoisted.deepClone,
  sanitizeForJson: hoisted.sanitizeForJson,
  safeInt: hoisted.safeInt,
  safeNumber: hoisted.safeNumber,
  estimateTokenCount: hoisted.estimateTokenCount,
  estimateTokens: hoisted.estimateTokens,
  estimateTokenCountFast: hoisted.estimateTokenCountFast,
}));
vi.mock("../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: hoisted.createLogger,
  useLogger: hoisted.useLogger,
  trackToolCall: hoisted.trackToolCall,
  logEvent: hoisted.logEvent,
}));
vi.mock("../../../../js/agents/shared/utils/error-utils.js", () => ({
  safeExec: hoisted.safeExec,
  catchAndLog: hoisted.catchAndLog,
  makeSafe: hoisted.makeSafe,
  isAbortError: hoisted.isAbortError,
  isTimeoutError: hoisted.isTimeoutError,
}));
vi.mock("../../../../js/agents/shared/utils/error-utils-extended.js", () => ({
  wrapError: hoisted.wrapError,
  toErrorMessage: hoisted.toErrorMessage,
}));
vi.mock("../../../../js/agents/shared/utils/deque.js", () => ({
  Deque: hoisted.Deque,
}));
vi.mock("../../../../js/agents/shared/utils/safe-json.js", () => ({
  safeJsonParse: hoisted.safeJsonParse,
  safeJsonParseDetailed: hoisted.safeJsonParseDetailed,
  protoSafeReviver: hoisted.protoSafeReviver,
}));
vi.mock("../../../../js/agents/shared/utils/json-candidate.js", () => ({
  extractJsonCandidate: hoisted.extractJsonCandidate,
  stripThinkingTags: hoisted.stripThinkingTags,
}));
vi.mock("../../../../js/agents/shared/utils/file-watcher.js", () => ({
  FileWatcher: hoisted.FileWatcher,
  isNativeWatchSupported: hoisted.isNativeWatchSupported,
}));
vi.mock("../../../../js/agents/shared/utils/secure-id.js", () => ({
  cryptoRandomHex: hoisted.cryptoRandomHex,
  cryptoRandomUuid: hoisted.cryptoRandomUuid,
  makeSecureId: hoisted.makeSecureId,
  makeSecureTimestampedId: hoisted.makeSecureTimestampedId,
  getSecureIdCapabilities: hoisted.getSecureIdCapabilities,
  isSecureIdSupported: hoisted.isSecureIdSupported,
}));
vi.mock("../../../../js/agents/shared/utils/cancellation.js", () => ({
  checkCancelled: hoisted.checkCancelled,
  withCancellation: hoisted.withCancellation,
  createLinkedSignal: hoisted.createLinkedSignal,
  mergeSignals: hoisted.mergeSignals,
}));
vi.mock("../../../../js/agents/shared/utils/error-classifier.js", () => ({
  classifyDeepSearchError: hoisted.classifyDeepSearchError,
  classifyDesignError: hoisted.classifyDesignError,
  isNonRetryableError: hoisted.isNonRetryableError,
  isNonRecoverableDeepSearchError: hoisted.isNonRecoverableDeepSearchError,
  toDeepSearchErrorMessage: hoisted.toDeepSearchErrorMessage,
}));
vi.mock("../../../../js/agents/shared/utils/response-limits.js", () => ({
  normalizeMaxBytes: hoisted.normalizeMaxBytes,
  createResponseTooLargeError: hoisted.createResponseTooLargeError,
  readTextWithLimit: hoisted.readTextWithLimit,
  readJsonWithLimit: hoisted.readJsonWithLimit,
}));
vi.mock("../../../../js/agents/shared/utils/token-cache.js", () => ({
  estimateTokensCached: hoisted.estimateTokensCached,
  clearTokenCache: hoisted.clearTokenCache,
  getTokenCacheStats: hoisted.getTokenCacheStats,
}));
vi.mock("../../../../js/agents/shared/utils/safe-regex.js", () => ({
  isPotentiallyDangerous: hoisted.isPotentiallyDangerous,
  createSafeRegex: hoisted.createSafeRegex,
  safeMatch: hoisted.safeMatch,
  globToRegex: hoisted.globToRegex,
}));
vi.mock("../../../../js/agents/shared/utils/event-emitter.js", () => ({
  EventEmitter: hoisted.EventEmitter,
}));
vi.mock("../../../../js/agents/shared/utils/lru-cache.js", () => ({
  LRUCache: hoisted.LRUCache,
  createAutoPruningCache: hoisted.createAutoPruningCache,
}));
vi.mock("../../../../js/agents/shared/utils/storage-crypto.js", () => ({
  PB_ENCRYPTED_PREFIX: hoisted.PB_ENCRYPTED_PREFIX,
  isEncryptedString: hoisted.isEncryptedString,
  canUseStorageEncryption: hoisted.canUseStorageEncryption,
  encryptString: hoisted.encryptString,
  decryptString: hoisted.decryptString,
}));
vi.mock("../../../../js/agents/shared/utils/schema-validator.js", () => ({
  validateChunk: hoisted.validateChunk,
  validateChunks: hoisted.validateChunks,
  validateGlobResult: hoisted.validateGlobResult,
  validateGrepMatch: hoisted.validateGrepMatch,
  validateGrepResults: hoisted.validateGrepResults,
  validateSearchQuery: hoisted.validateSearchQuery,
  ValidationErrorCode: hoisted.ValidationErrorCode,
  createValidationError: hoisted.createValidationError,
}));
vi.mock("../../../../js/agents/shared/utils/storage-quota.js", () => ({
  hasLocalStorage: hoisted.hasLocalStorage,
  estimateLocalStorageUsage: hoisted.estimateLocalStorageUsage,
  estimateLocalStorageQuota: hoisted.estimateLocalStorageQuota,
  getLocalStorageQuotaStatus: hoisted.getLocalStorageQuotaStatus,
  safeLocalStorageSet: hoisted.safeLocalStorageSet,
  cleanupLocalStorage: hoisted.cleanupLocalStorage,
  getIndexedDBQuotaStatus: hoisted.getIndexedDBQuotaStatus,
}));
vi.mock("../../../../js/agents/shared/utils/circuit-breaker.js", () => ({
  CircuitState: hoisted.CircuitState,
  CircuitBreaker: hoisted.CircuitBreaker,
  CircuitBreakerRegistry: hoisted.CircuitBreakerRegistry,
  getGlobalCircuitBreakerRegistry: hoisted.getGlobalCircuitBreakerRegistry,
  getCircuitBreaker: hoisted.getCircuitBreaker,
  withCircuitBreaker: hoisted.withCircuitBreaker,
}));
vi.mock("../../../../js/agents/shared/retry-strategy.js", () => ({
  RetryStrategy: hoisted.RetryStrategy,
  isRetryableError: hoisted.isRetryableError,
  getGlobalRetryStats: hoisted.getGlobalRetryStats,
  resetGlobalRetryStats: hoisted.resetGlobalRetryStats,
  withRetry: hoisted.withRetry,
}));
vi.mock("../../../../js/agents/shared/utils/wasm-support.js", () => ({
  isWasmSupported: hoisted.isWasmSupported,
  isWasmThreadsSupported: hoisted.isWasmThreadsSupported,
}));
vi.mock("../../../../js/agents/shared/utils/should-degrade.js", () => ({
  shouldDegrade: hoisted.shouldDegrade,
}));

vi.mock("../../../../js/agents/shared/parser/tree-sitter-wasm.js", () => ({
  DEFAULT_TREE_SITTER_WASM_BASE_URL: hoisted.DEFAULT_TREE_SITTER_WASM_BASE_URL,
  initTreeSitter: hoisted.initTreeSitter,
  loadTreeSitterLanguage: hoisted.loadTreeSitterLanguage,
}));

vi.mock("../../../../js/agents/core/archive/archive.js", () => ({
  Archive: hoisted.Archive,
  MapAdapter: hoisted.MapAdapter,
  FallbackAdapter: hoisted.FallbackAdapter,
}));
vi.mock("../../../../js/agents/core/archive/checkpoint-schema.js", () => ({
  CheckpointType: hoisted.CheckpointType,
  createCheckpoint: hoisted.createCheckpoint,
  migrateCheckpoint: hoisted.migrateCheckpoint,
}));
vi.mock("../../../../js/agents/core/contracts/index.js", () => ({
  validateRpcRequest: hoisted.validateRpcRequest,
  validateRpcResponse: hoisted.validateRpcResponse,
  validateLlmResponse: hoisted.validateLlmResponse,
  validateToolCall: hoisted.validateToolCall,
  validateToolResult: hoisted.validateToolResult,
  normalizeToolResult: hoisted.normalizeToolResult,
}));
vi.mock("../../../../js/agents/retrieval/embeddings/embedding-service.js", () => ({
  EmbeddingService: hoisted.EmbeddingService,
  createEmbeddingService: hoisted.createEmbeddingService,
  normalizeEmbeddingConfig: hoisted.normalizeEmbeddingConfig,
}));
vi.mock("../../../../js/agents/retrieval/embeddings/vector-index.js", () => ({
  VectorIndex: hoisted.VectorIndex,
}));
vi.mock("../../../../js/agents/retrieval/embeddings/hnsw-lite.js", () => ({
  HnswLiteIndex: hoisted.HnswLiteIndex,
}));
vi.mock("../../../../js/agents/shared/tokenizers/adaptive-token-counter.js", () => ({
  createAdaptiveTokenCounter: hoisted.createAdaptiveTokenCounter,
  getGlobalTokenCounter: hoisted.getGlobalTokenCounter,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shared/index exports", () => {
  it("should_export_all_expected_symbols_when_importing_shared_index", async () => {
    const shared = await import(SHARED_INDEX_PATH);
    expect(Object.keys(shared).sort()).toEqual(hoisted.ALL_EXPORTS.slice().sort());
  });

  it.each(hoisted.VALUE_EXPORTS)(
    "should_reexport_constant_%s_when_importing_shared_index",
    async (exportName) => {
      const shared = await import(SHARED_INDEX_PATH);
      expect(shared[exportName]).toBe(hoisted[exportName]);
    }
  );

  it.each(hoisted.CLASS_EXPORTS)(
    "should_construct_%s_when_instantiated_with_arguments",
    async (exportName) => {
      const shared = await import(SHARED_INDEX_PATH);
      const instance = new shared[exportName]("arg");
      expect(instance).toBeInstanceOf(hoisted[exportName]);
    }
  );

  it.each(hoisted.CLASS_EXPORTS)(
    "should_throw_%s_boom_when_constructor_receives_throw_sentinel",
    async (exportName) => {
      const shared = await import(SHARED_INDEX_PATH);
      expect(() => new shared[exportName](hoisted.THROW)).toThrow(`${exportName}_boom`);
    }
  );

  it.each(hoisted.functionNames)(
    "should_forward_arguments_to_%s_when_called_with_edge_values",
    async (exportName) => {
      const shared = await import(SHARED_INDEX_PATH);
      shared[exportName](...hoisted.EDGE_ARGS);
      expect(hoisted[exportName]).toHaveBeenCalledWith(...hoisted.EDGE_ARGS);
    }
  );

  it.each(hoisted.functionNames)("should_throw_%s_boom_when_dependency_throws", async (exportName) => {
    const shared = await import(SHARED_INDEX_PATH);
    expect(() => shared[exportName](hoisted.THROW)).toThrow(`${exportName}_boom`);
  });
});
