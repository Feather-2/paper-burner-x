import { describe, it, expect, vi, beforeEach } from "vitest";

const mockData = vi.hoisted(() => {
  const ERROR = Symbol("error");
  const makeFn = (label) =>
    vi.fn((...args) => {
      if (args[0] === ERROR) {
        throw new Error(`${label} error`);
      }
      return { label, args };
    });

  const makeClass = (label) =>
    class {
      constructor(...args) {
        if (args[0] === ERROR) {
          throw new Error(`${label} error`);
        }
        this.label = label;
        this.args = args;
      }
    };

  const makeValue = (label, type = "object") => {
    if (type === "string") {
      return `${label}-value`;
    }
    return { label };
  };

  const functionNames = [
    "isNodeLike",
    "createBudgetManager",
    "injectSystemHint",
    "robustParseJson",
    "createStageApi",
    "validateStageApi",
    "extractServices",
    "mergeStageApis",
    "createChildApi",
    "createRunTool",
    "isPlainObject",
    "toNonEmptyString",
    "toNumber",
    "toBoolean",
    "normalizeKey",
    "normalizeRenderType",
    "toPositiveInt",
    "toNonNegativeInt",
    "deepClone",
    "sanitizeForJson",
    "safeInt",
    "safeNumber",
    "estimateTokenCount",
    "estimateTokens",
    "estimateTokenCountFast",
    "createLogger",
    "useLogger",
    "trackToolCall",
    "logEvent",
    "safeExec",
    "catchAndLog",
    "makeSafe",
    "isAbortError",
    "isTimeoutError",
    "wrapError",
    "toErrorMessage",
    "safeJsonParse",
    "extractJsonCandidate",
    "stripThinkingTags",
    "isNativeWatchSupported",
    "cryptoRandomHex",
    "cryptoRandomUuid",
    "makeSecureId",
    "makeSecureTimestampedId",
    "checkCancelled",
    "withCancellation",
    "createLinkedSignal",
    "classifyDeepSearchError",
    "classifyDesignError",
    "normalizeMaxBytes",
    "createResponseTooLargeError",
    "readTextWithLimit",
    "readJsonWithLimit",
    "estimateTokensCached",
    "clearTokenCache",
    "getTokenCacheStats",
    "isPotentiallyDangerous",
    "createSafeRegex",
    "safeMatch",
    "globToRegex",
    "createAutoPruningCache",
    "isEncryptedString",
    "canUseStorageEncryption",
    "encryptString",
    "decryptString",
    "validateChunk",
    "validateChunks",
    "validateGlobResult",
    "validateGrepMatch",
    "validateGrepResults",
    "validateSearchQuery",
    "createValidationError",
    "hasLocalStorage",
    "estimateLocalStorageUsage",
    "estimateLocalStorageQuota",
    "getLocalStorageQuotaStatus",
    "safeLocalStorageSet",
    "cleanupLocalStorage",
    "getIndexedDBQuotaStatus",
    "getGlobalCircuitBreakerRegistry",
    "getCircuitBreaker",
    "withCircuitBreaker",
    "createCheckpoint",
    "migrateCheckpoint",
    "validateRpcRequest",
    "validateRpcResponse",
    "validateLlmResponse",
    "validateToolCall",
    "validateToolResult",
    "normalizeToolResult",
    "createEmbeddingService",
    "normalizeEmbeddingConfig",
    "createAdaptiveTokenCounter",
    "getGlobalTokenCounter",
  ];

  const classNames = [
    "DisposableBase",
    "Deque",
    "FileWatcher",
    "EventEmitter",
    "LRUCache",
    "CircuitBreaker",
    "CircuitBreakerRegistry",
    "Archive",
    "MapAdapter",
    "FallbackAdapter",
    "EmbeddingService",
    "VectorIndex",
    "HnswLiteIndex",
  ];

  const valueNames = [
    "Platform",
    "BudgetAction",
    "StageApiSpec",
    "PB_ENCRYPTED_PREFIX",
    "ValidationErrorCode",
    "CircuitState",
    "CheckpointType",
  ];

  const valueTypeOverrides = {
    PB_ENCRYPTED_PREFIX: "string",
  };

  const mockExports = {};
  functionNames.forEach((name) => {
    mockExports[name] = makeFn(name);
  });
  classNames.forEach((name) => {
    mockExports[name] = makeClass(name);
  });
  valueNames.forEach((name) => {
    mockExports[name] = makeValue(name, valueTypeOverrides[name]);
  });

  return { ERROR, exports: mockExports, functionNames, classNames, valueNames };
});

vi.mock("../../../../js/agents/shared/platform.js", () => ({
  Platform: mockData.exports.Platform,
  isNodeLike: mockData.exports.isNodeLike,
}));

vi.mock("../../../../js/agents/shared/base/disposable-base.js", () => ({
  DisposableBase: mockData.exports.DisposableBase,
}));

vi.mock("../../../../js/agents/shared/utils/budget.js", () => ({
  createBudgetManager: mockData.exports.createBudgetManager,
  BudgetAction: mockData.exports.BudgetAction,
}));

vi.mock("../../../../js/agents/shared/utils/message-utils.js", () => ({
  injectSystemHint: mockData.exports.injectSystemHint,
}));

vi.mock("../../../../js/agents/shared/utils/robust-json.js", () => ({
  robustParseJson: mockData.exports.robustParseJson,
}));

vi.mock("../../../../js/agents/shared/utils/stage-api.js", () => ({
  createStageApi: mockData.exports.createStageApi,
  StageApiSpec: mockData.exports.StageApiSpec,
  validateStageApi: mockData.exports.validateStageApi,
  extractServices: mockData.exports.extractServices,
  mergeStageApis: mockData.exports.mergeStageApis,
  createChildApi: mockData.exports.createChildApi,
  createRunTool: mockData.exports.createRunTool,
}));

vi.mock("../../../../js/agents/shared/utils/value-utils.js", () => ({
  isPlainObject: mockData.exports.isPlainObject,
  toNonEmptyString: mockData.exports.toNonEmptyString,
  toNumber: mockData.exports.toNumber,
  toBoolean: mockData.exports.toBoolean,
  normalizeKey: mockData.exports.normalizeKey,
  normalizeRenderType: mockData.exports.normalizeRenderType,
  toPositiveInt: mockData.exports.toPositiveInt,
  toNonNegativeInt: mockData.exports.toNonNegativeInt,
  deepClone: mockData.exports.deepClone,
  sanitizeForJson: mockData.exports.sanitizeForJson,
  safeInt: mockData.exports.safeInt,
  safeNumber: mockData.exports.safeNumber,
  estimateTokenCount: mockData.exports.estimateTokenCount,
  estimateTokens: mockData.exports.estimateTokens,
  estimateTokenCountFast: mockData.exports.estimateTokenCountFast,
}));

vi.mock("../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: mockData.exports.createLogger,
  useLogger: mockData.exports.useLogger,
  trackToolCall: mockData.exports.trackToolCall,
  logEvent: mockData.exports.logEvent,
}));

vi.mock("../../../../js/agents/shared/utils/error-utils.js", () => ({
  safeExec: mockData.exports.safeExec,
  catchAndLog: mockData.exports.catchAndLog,
  makeSafe: mockData.exports.makeSafe,
  isAbortError: mockData.exports.isAbortError,
  isTimeoutError: mockData.exports.isTimeoutError,
}));

vi.mock("../../../../js/agents/shared/utils/error-utils-extended.js", () => ({
  wrapError: mockData.exports.wrapError,
  toErrorMessage: mockData.exports.toErrorMessage,
}));

vi.mock("../../../../js/agents/shared/utils/deque.js", () => ({
  Deque: mockData.exports.Deque,
}));

vi.mock("../../../../js/agents/shared/utils/safe-json.js", () => ({
  safeJsonParse: mockData.exports.safeJsonParse,
}));

vi.mock("../../../../js/agents/shared/utils/json-candidate.js", () => ({
  extractJsonCandidate: mockData.exports.extractJsonCandidate,
  stripThinkingTags: mockData.exports.stripThinkingTags,
}));

vi.mock("../../../../js/agents/shared/utils/file-watcher.js", () => ({
  FileWatcher: mockData.exports.FileWatcher,
  isNativeWatchSupported: mockData.exports.isNativeWatchSupported,
}));

vi.mock("../../../../js/agents/shared/utils/secure-id.js", () => ({
  cryptoRandomHex: mockData.exports.cryptoRandomHex,
  cryptoRandomUuid: mockData.exports.cryptoRandomUuid,
  makeSecureId: mockData.exports.makeSecureId,
  makeSecureTimestampedId: mockData.exports.makeSecureTimestampedId,
}));

vi.mock("../../../../js/agents/shared/utils/cancellation.js", () => ({
  checkCancelled: mockData.exports.checkCancelled,
  withCancellation: mockData.exports.withCancellation,
  createLinkedSignal: mockData.exports.createLinkedSignal,
}));

vi.mock("../../../../js/agents/shared/utils/error-classifier.js", () => ({
  classifyDeepSearchError: mockData.exports.classifyDeepSearchError,
  classifyDesignError: mockData.exports.classifyDesignError,
}));

vi.mock("../../../../js/agents/shared/utils/response-limits.js", () => ({
  normalizeMaxBytes: mockData.exports.normalizeMaxBytes,
  createResponseTooLargeError: mockData.exports.createResponseTooLargeError,
  readTextWithLimit: mockData.exports.readTextWithLimit,
  readJsonWithLimit: mockData.exports.readJsonWithLimit,
}));

vi.mock("../../../../js/agents/shared/utils/token-cache.js", () => ({
  estimateTokensCached: mockData.exports.estimateTokensCached,
  clearTokenCache: mockData.exports.clearTokenCache,
  getTokenCacheStats: mockData.exports.getTokenCacheStats,
}));

vi.mock("../../../../js/agents/shared/utils/safe-regex.js", () => ({
  isPotentiallyDangerous: mockData.exports.isPotentiallyDangerous,
  createSafeRegex: mockData.exports.createSafeRegex,
  safeMatch: mockData.exports.safeMatch,
  globToRegex: mockData.exports.globToRegex,
}));

vi.mock("../../../../js/agents/shared/utils/event-emitter.js", () => ({
  EventEmitter: mockData.exports.EventEmitter,
}));

vi.mock("../../../../js/agents/shared/utils/lru-cache.js", () => ({
  LRUCache: mockData.exports.LRUCache,
  createAutoPruningCache: mockData.exports.createAutoPruningCache,
}));

vi.mock("../../../../js/agents/shared/utils/storage-crypto.js", () => ({
  PB_ENCRYPTED_PREFIX: mockData.exports.PB_ENCRYPTED_PREFIX,
  isEncryptedString: mockData.exports.isEncryptedString,
  canUseStorageEncryption: mockData.exports.canUseStorageEncryption,
  encryptString: mockData.exports.encryptString,
  decryptString: mockData.exports.decryptString,
}));

vi.mock("../../../../js/agents/shared/utils/schema-validator.js", () => ({
  validateChunk: mockData.exports.validateChunk,
  validateChunks: mockData.exports.validateChunks,
  validateGlobResult: mockData.exports.validateGlobResult,
  validateGrepMatch: mockData.exports.validateGrepMatch,
  validateGrepResults: mockData.exports.validateGrepResults,
  validateSearchQuery: mockData.exports.validateSearchQuery,
  ValidationErrorCode: mockData.exports.ValidationErrorCode,
  createValidationError: mockData.exports.createValidationError,
}));

vi.mock("../../../../js/agents/shared/utils/storage-quota.js", () => ({
  hasLocalStorage: mockData.exports.hasLocalStorage,
  estimateLocalStorageUsage: mockData.exports.estimateLocalStorageUsage,
  estimateLocalStorageQuota: mockData.exports.estimateLocalStorageQuota,
  getLocalStorageQuotaStatus: mockData.exports.getLocalStorageQuotaStatus,
  safeLocalStorageSet: mockData.exports.safeLocalStorageSet,
  cleanupLocalStorage: mockData.exports.cleanupLocalStorage,
  getIndexedDBQuotaStatus: mockData.exports.getIndexedDBQuotaStatus,
}));

vi.mock("../../../../js/agents/shared/utils/circuit-breaker.js", () => ({
  CircuitState: mockData.exports.CircuitState,
  CircuitBreaker: mockData.exports.CircuitBreaker,
  CircuitBreakerRegistry: mockData.exports.CircuitBreakerRegistry,
  getGlobalCircuitBreakerRegistry: mockData.exports.getGlobalCircuitBreakerRegistry,
  getCircuitBreaker: mockData.exports.getCircuitBreaker,
  withCircuitBreaker: mockData.exports.withCircuitBreaker,
}));

vi.mock("../../../../js/agents/core/archive/archive.js", () => ({
  Archive: mockData.exports.Archive,
  MapAdapter: mockData.exports.MapAdapter,
  FallbackAdapter: mockData.exports.FallbackAdapter,
}));

vi.mock("../../../../js/agents/core/archive/checkpoint-schema.js", () => ({
  CheckpointType: mockData.exports.CheckpointType,
  createCheckpoint: mockData.exports.createCheckpoint,
  migrateCheckpoint: mockData.exports.migrateCheckpoint,
}));

vi.mock("../../../../js/agents/core/contracts/index.js", () => ({
  validateRpcRequest: mockData.exports.validateRpcRequest,
  validateRpcResponse: mockData.exports.validateRpcResponse,
  validateLlmResponse: mockData.exports.validateLlmResponse,
  validateToolCall: mockData.exports.validateToolCall,
  validateToolResult: mockData.exports.validateToolResult,
  normalizeToolResult: mockData.exports.normalizeToolResult,
}));

vi.mock("../../../../js/agents/retrieval/embeddings/embedding-service.js", () => ({
  EmbeddingService: mockData.exports.EmbeddingService,
  createEmbeddingService: mockData.exports.createEmbeddingService,
  normalizeEmbeddingConfig: mockData.exports.normalizeEmbeddingConfig,
}));

vi.mock("../../../../js/agents/retrieval/embeddings/vector-index.js", () => ({
  VectorIndex: mockData.exports.VectorIndex,
}));

vi.mock("../../../../js/agents/retrieval/embeddings/hnsw-lite.js", () => ({
  HnswLiteIndex: mockData.exports.HnswLiteIndex,
}));

vi.mock("../../../../js/agents/shared/tokenizers/adaptive-token-counter.js", () => ({
  createAdaptiveTokenCounter: mockData.exports.createAdaptiveTokenCounter,
  getGlobalTokenCounter: mockData.exports.getGlobalTokenCounter,
}));

import * as shared from "../../../../js/agents/shared/index.js";

const createDeepNested = (depth) => {
  const root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.next = {};
    current = current.next;
  }
  return root;
};

const longString = "y".repeat(20000);
const hugeString = "x".repeat(100000);
const deepNested = createDeepNested(25);
const hugeArray = Array.from({ length: 10000 }, (_, index) => index);

const boundaryValues = [
  null,
  undefined,
  "",
  "   ",
  [],
  {},
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "123",
  { 0: "a", length: 1 },
  longString,
  hugeString,
  deepNested,
  hugeArray,
];

beforeEach(() => {
  vi.clearAllMocks();
});

const runFunctionTests = (name) => {
  describe(name, () => {
    it("forwards normal inputs", () => {
      expect(shared[name]).toBe(mockData.exports[name]);
      const result = shared[name]("ok", 123);
      expect(result.label).toBe(name);
      expect(result.args).toEqual(["ok", 123]);
      expect(mockData.exports[name]).toHaveBeenCalledTimes(1);
    });

    it("handles boundary values", async () => {
      boundaryValues.forEach((value) => {
        const result = shared[name](value, "edge");
        expect(result.label).toBe(name);
        expect(result.args[0]).toBe(value);
        expect(result.args[1]).toBe("edge");
      });

      const concurrentInputs = ["c1", "c2", "c3"];
      const results = await Promise.all(
        concurrentInputs.map((input) => Promise.resolve(shared[name](input)))
      );

      results.forEach((result, index) => {
        expect(result.args[0]).toBe(concurrentInputs[index]);
      });

      expect(mockData.exports[name]).toHaveBeenCalledTimes(
        boundaryValues.length + concurrentInputs.length
      );
    });

    it("propagates errors", () => {
      expect(() => shared[name](mockData.ERROR)).toThrow(`${name} error`);
    });
  });
};

const runClassTests = (name) => {
  describe(name, () => {
    it("constructs with normal args", () => {
      expect(shared[name]).toBe(mockData.exports[name]);
      const instance = new shared[name]("ok", 123);
      expect(instance.label).toBe(name);
      expect(instance.args).toEqual(["ok", 123]);
    });

    it("handles boundary values", async () => {
      const instances = boundaryValues.map((value) => new shared[name](value, "edge"));
      instances.forEach((instance, index) => {
        expect(instance.label).toBe(name);
        expect(instance.args[0]).toBe(boundaryValues[index]);
      });

      const concurrentInputs = ["c1", "c2", "c3"];
      const concurrentInstances = await Promise.all(
        concurrentInputs.map((value) => Promise.resolve(new shared[name](value)))
      );

      concurrentInstances.forEach((instance, index) => {
        expect(instance.args[0]).toBe(concurrentInputs[index]);
      });
    });

    it("throws on error sentinel", () => {
      expect(() => new shared[name](mockData.ERROR)).toThrow(`${name} error`);
    });
  });
};

const runValueTests = (name) => {
  describe(name, () => {
    it("exposes mocked value", () => {
      expect(shared[name]).toBe(mockData.exports[name]);
    });

    it("handles boundary usage", () => {
      const value = shared[name];
      boundaryValues.forEach((boundary) => {
        const map = new Map();
        map.set(value, boundary);
        expect(map.get(value)).toBe(boundary);
      });
    });

    it("throws when used as a function", () => {
      expect(() => shared[name]()).toThrow();
    });
  });
};

describe("shared/index", () => {
  mockData.valueNames.forEach((name) => {
    runValueTests(name);
  });

  mockData.classNames.forEach((name) => {
    runClassTests(name);
  });

  mockData.functionNames.forEach((name) => {
    runFunctionTests(name);
  });
});
