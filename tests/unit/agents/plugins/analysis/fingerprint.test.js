import { describe, it, expect, vi, beforeEach } from "vitest";

const pluginModuleState = vi.hoisted(() => ({
  // Keep the mock close to the real public shape without importing the real module.
  createPluginImpl: (config) => ({
    name: config.name,
    version: config.version || "1.0.0",
    description: config.description || "",
    dependencies: config.dependencies || [],
    defaultConfig: config.defaultConfig || {},
    install: config.install || (() => {}),
    uninstall: config.uninstall || (() => {}),
    onStart: config.onStart || null,
    onStop: config.onStop || null,
    onError: config.onError || null,
    _status: "pending",
    _context: null,
    _config: null,
  }),
}));

const mockedCreatePlugin = vi.hoisted(() =>
  vi.fn((config) => pluginModuleState.createPluginImpl(config))
);

vi.mock("../../../../../js/agents/core/plugin.js", () => ({
  createPlugin: mockedCreatePlugin,
}));

const behaviorFingerprintState = vi.hoisted(() => ({
  instances: [],
  recordActionResponse: { loopDetected: false, loopInfo: null },
  recordActionImpl: null,
  recordActionThrows: false,
  withRecordAction: true,
  withAnalysis: true,
  withSuggestion: true,
  analysisResponse: null,
  suggestionResponse: null,
  stats: null,
  throwOnConstruct: false,
}));

vi.mock("../../../../../js/agents/plugins/analysis/behavior-fingerprint.js", () => {
  class BehaviorFingerprint {
    constructor(config) {
      if (behaviorFingerprintState.throwOnConstruct) {
        throw new Error("BehaviorFingerprint init failed");
      }
      this.config = config;
      behaviorFingerprintState.instances.push(this);

      if (behaviorFingerprintState.withRecordAction) {
        this.recordAction = vi.fn((action) => {
          if (behaviorFingerprintState.recordActionThrows) {
            throw new Error("recordAction failed");
          }
          if (typeof behaviorFingerprintState.recordActionImpl === "function") {
            return behaviorFingerprintState.recordActionImpl(action);
          }
          return behaviorFingerprintState.recordActionResponse;
        });
      }

      if (behaviorFingerprintState.withAnalysis) {
        this.getAnalysis = vi.fn(() => behaviorFingerprintState.analysisResponse);
      }

      if (behaviorFingerprintState.withSuggestion) {
        this.getSuggestion = vi.fn(() => behaviorFingerprintState.suggestionResponse);
      }

      this.reset = vi.fn();
      this.stats = behaviorFingerprintState.stats;
    }
  }

  return { BehaviorFingerprint };
});

import fingerprintPlugin from "../../../../../js/agents/plugins/analysis/fingerprint.js";

const createDefaultAnalysis = () => ({
  totalActions: 1,
  uniqueActions: 1,
  diversityScore: 1,
  actionFrequency: {},
  repeatingPatterns: [],
  consecutiveLoops: [],
  loopCount: 0,
  lastLoopPattern: null,
});

const createDefaultSuggestion = () => ({
  action: "none",
  severity: "low",
  reason: "mock",
  suggestion: null,
});

const createDefaultStats = () => ({
  historySize: 0,
  maxHistorySize: 50,
  loopCount: 0,
  hasActiveLoop: false,
});

const createDeepNested = (depth = 5) => {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
};

const createFingerprintHarness = async ({ config = {}, servicesCallImpl = null } = {}) => {
  const stateStore = new Map();
  const listeners = new Map();

  const services = {
    registry: new Map(),
    register: vi.fn((name, service) => {
      services.registry.set(name, service);
    }),
    call: vi.fn(async (name, method, args) => {
      if (servicesCallImpl) {
        return servicesCallImpl(name, method, args, services.registry);
      }
      const svc = services.registry.get(name);
      if (!svc || typeof svc[method] !== "function") {
        throw new Error(`service method missing: ${name}.${method}`);
      }
      return svc[method](...args);
    }),
  };

  const ctx = {
    config: {
      windowSize: 5,
      similarityThreshold: 0.85,
      maxHistory: 50,
      ...config,
    },
    state: {
      set: vi.fn((path, value) => {
        stateStore.set(path, value);
      }),
      get: vi.fn((path) => stateStore.get(path)),
    },
    events: { emit: vi.fn() },
    services,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn((name, service) => services.register(name, service)),
    on: vi.fn((pattern, handler) => {
      listeners.set(pattern, handler);
      return vi.fn();
    }),
  };

  await fingerprintPlugin.install(ctx);

  return {
    ctx,
    service: services.registry.get("fingerprint"),
    listeners,
    stateStore,
    services,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  behaviorFingerprintState.instances = [];
  behaviorFingerprintState.recordActionResponse = { loopDetected: false, loopInfo: null };
  behaviorFingerprintState.recordActionImpl = null;
  behaviorFingerprintState.recordActionThrows = false;
  behaviorFingerprintState.withRecordAction = true;
  behaviorFingerprintState.withAnalysis = true;
  behaviorFingerprintState.withSuggestion = true;
  behaviorFingerprintState.analysisResponse = createDefaultAnalysis();
  behaviorFingerprintState.suggestionResponse = createDefaultSuggestion();
  behaviorFingerprintState.stats = createDefaultStats();
  behaviorFingerprintState.throwOnConstruct = false;
});

describe("default", () => {
  it("should_return_analysis_fingerprint_when_accessing_name", () => {
    expect(fingerprintPlugin.name).toBe("analysis/fingerprint");
  });

  it("should_return_1_0_0_when_accessing_version", () => {
    expect(fingerprintPlugin.version).toBe("1.0.0");
  });

  it("should_return_default_config_when_accessing_defaultConfig", () => {
    expect(fingerprintPlugin.defaultConfig).toEqual({
      windowSize: 5,
      similarityThreshold: 0.85,
      maxHistory: 50,
    });
  });

  it("should_return_function_when_accessing_install", () => {
    expect(typeof fingerprintPlugin.install).toBe("function");
  });

  it("should_register_fingerprint_service_when_install_called", async () => {
    const { ctx } = await createFingerprintHarness();
    expect(ctx.registerService).toHaveBeenCalledWith("fingerprint", expect.any(Object));
  });

  it("should_register_tool_call_listener_when_install_called", async () => {
    const { ctx } = await createFingerprintHarness();
    expect(ctx.on).toHaveBeenCalledWith("tool.call.*", expect.any(Function));
  });

  it("should_log_install_message_when_install_called", async () => {
    const { ctx } = await createFingerprintHarness();
    expect(ctx.log.info).toHaveBeenCalledWith("Fingerprint analysis plugin installed");
  });

  it("should_return_registered_service_when_install_called", async () => {
    const { service } = await createFingerprintHarness();
    expect(Boolean(service)).toBe(true);
  });

  it("should_expose_analyze_when_service_registered", async () => {
    const { service } = await createFingerprintHarness();
    expect(typeof service.analyze).toBe("function");
  });

  it("should_expose_getHistory_when_service_registered", async () => {
    const { service } = await createFingerprintHarness();
    expect(typeof service.getHistory).toBe("function");
  });

  it("should_expose_reset_when_service_registered", async () => {
    const { service } = await createFingerprintHarness();
    expect(typeof service.reset).toBe("function");
  });

  it("should_not_construct_BehaviorFingerprint_until_analyze_called", async () => {
    await createFingerprintHarness();
    expect(behaviorFingerprintState.instances).toHaveLength(0);
  });

  it("should_construct_BehaviorFingerprint_with_ctx_config_when_analyze_called", async () => {
    const { service } = await createFingerprintHarness({ config: { windowSize: 7, maxHistory: 12 } });
    await service.analyze({ type: "init" });
    expect(behaviorFingerprintState.instances[0].config).toEqual({ historySize: 12, maxPatternLength: 7 });
  });

  it("should_return_expected_fingerprint_when_action_has_name_and_params", async () => {
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ name: "search", params: { b: 2, a: 1 } });
    expect(result.fingerprint).toBe("tool_call:search:a,b");
  });

  it("should_prefer_params_over_args_when_both_present", async () => {
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "tool", params: { a: 1 }, args: { b: 1 } });
    expect(result.fingerprint).toBe("tool:a");
  });

  it.each([
    ["null action", null, "unknown:"],
    ["undefined action", undefined, "unknown:"],
    ["empty string action", "", "unknown:"],
    ["empty array action", [], "unknown:"],
    ["empty object action", {}, "unknown:"],
    ["type zero", { type: 0 }, "unknown:"],
    ["type negative", { type: -1 }, "-1:"],
    ["max safe integer type", { type: Number.MAX_SAFE_INTEGER }, `${Number.MAX_SAFE_INTEGER}:`],
    ["whitespace type", { type: "   " }, "   :"],
    ["whitespace name", { name: "   " }, "tool_call:   :"],
    ["string numeric type", { type: "1", params: {} }, "1:"],
    ["array params fallback", { type: "tool", params: [] }, "tool:"],
    ["array-like params", { type: "tool", params: { 0: "x", length: 1 } }, "tool:0,length"],
  ])("should_return_%s_fingerprint_when_action_is_boundary_value", async (_label, action, expectedFingerprint) => {
    const { service } = await createFingerprintHarness();
    const result = await service.analyze(action);
    expect(result.fingerprint).toBe(expectedFingerprint);
  });

  it("should_return_similarity_0_when_analyzing_first_action", async () => {
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "first", params: { a: 1 } });
    expect(result.similarity).toBe(0);
  });

  it("should_return_similarity_1_when_all_recent_fingerprints_match", async () => {
    const { service } = await createFingerprintHarness({ config: { windowSize: 2 } });
    await service.analyze({ type: "repeat", params: { a: 1 } });
    const result = await service.analyze({ type: "repeat", params: { a: 2 } });
    expect(result.similarity).toBe(1);
  });

  it("should_return_similarity_0_5_when_half_recent_fingerprints_match", async () => {
    const { service } = await createFingerprintHarness({ config: { windowSize: 2 } });
    await service.analyze({ type: "a", params: { k: 1 } });
    await service.analyze({ type: "b", params: { k: 1 } });
    const result = await service.analyze({ type: "a", params: { k: 2 } });
    expect(result.similarity).toBe(0.5);
  });

  it("should_use_recent_window_min_1_when_windowSize_is_0", async () => {
    const { service } = await createFingerprintHarness({ config: { windowSize: 0 } });
    await service.analyze({ type: "repeat", params: { a: 1 } });
    const result = await service.analyze({ type: "repeat", params: { a: 2 } });
    expect(result.similarity).toBe(1);
  });

  it("should_return_loopLength_matching_loopInfo_pattern_length_when_loopInfo_present", async () => {
    const loopInfo = { pattern: ["a", "b"], count: 2, startPosition: 0, totalLoopsDetected: 1 };
    behaviorFingerprintState.recordActionResponse = { loopDetected: false, loopInfo };
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.loopLength).toBe(2);
  });

  it("should_return_loopInfo_when_behavior_returns_loopInfo", async () => {
    const loopInfo = { pattern: ["a"], count: 2, startPosition: 0, totalLoopsDetected: 1 };
    behaviorFingerprintState.recordActionResponse = { loopDetected: false, loopInfo };
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.loopInfo).toEqual(loopInfo);
  });

  it("should_return_isLoop_true_when_behavior_loopDetected_true", async () => {
    behaviorFingerprintState.recordActionResponse = { loopDetected: true, loopInfo: null };
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "loop" });
    expect(result.isLoop).toBe(true);
  });

  it("should_return_analysis_when_BehaviorFingerprint_getAnalysis_defined", async () => {
    const analysis = createDefaultAnalysis();
    behaviorFingerprintState.analysisResponse = analysis;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.analysis).toEqual(analysis);
  });

  it("should_return_null_analysis_when_BehaviorFingerprint_getAnalysis_missing", async () => {
    behaviorFingerprintState.withAnalysis = false;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.analysis).toBeNull();
  });

  it("should_return_suggestion_when_BehaviorFingerprint_getSuggestion_defined", async () => {
    const suggestion = createDefaultSuggestion();
    behaviorFingerprintState.suggestionResponse = suggestion;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.suggestion).toEqual(suggestion);
  });

  it("should_return_null_suggestion_when_BehaviorFingerprint_getSuggestion_missing", async () => {
    behaviorFingerprintState.withSuggestion = false;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.suggestion).toBeNull();
  });

  it("should_return_stats_when_BehaviorFingerprint_stats_present", async () => {
    const stats = createDefaultStats();
    behaviorFingerprintState.stats = stats;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.stats).toEqual(stats);
  });

  it("should_return_null_stats_when_BehaviorFingerprint_stats_is_null", async () => {
    behaviorFingerprintState.stats = null;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.stats).toBeNull();
  });

  it("should_return_isLoop_false_when_recordAction_missing", async () => {
    behaviorFingerprintState.withRecordAction = false;
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(result.isLoop).toBe(false);
  });

  it("should_set_lastAnalysis_state_when_analyze_called", async () => {
    const { service, stateStore } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(stateStore.get("lastAnalysis")).toEqual(result);
  });

  it("should_append_history_entry_when_analyze_called", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ type: "x" });
    expect(service.getHistory()).toHaveLength(1);
  });

  it("should_store_action_name_in_history_when_action_has_name", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ name: "search" });
    expect(service.getHistory()[0].action).toBe("search");
  });

  it("should_store_unknown_action_in_history_when_action_missing_type_and_name", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({});
    expect(service.getHistory()[0].action).toBe("unknown");
  });

  it("should_trim_history_to_maxHistory_when_maxHistory_exceeded", async () => {
    const { service } = await createFingerprintHarness({ config: { maxHistory: 2 } });
    await service.analyze({ type: "a" });
    await service.analyze({ type: "b" });
    await service.analyze({ type: "c" });
    expect(service.getHistory().map((entry) => entry.action)).toEqual(["b", "c"]);
  });

  it("should_return_history_copy_when_getHistory_called", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ type: "x" });
    const history = service.getHistory();
    history.push({ action: "mutate", fingerprint: "x:", timestamp: 0 });
    expect(service.getHistory()).toHaveLength(1);
  });

  it("should_return_empty_history_when_maxHistory_is_0", async () => {
    const { service } = await createFingerprintHarness({ config: { maxHistory: 0 } });
    await service.analyze({ type: "x" });
    expect(service.getHistory()).toEqual([]);
  });

  it("should_not_emit_loopDetected_when_similarity_below_threshold", async () => {
    const { service, ctx } = await createFingerprintHarness({
      config: { windowSize: 2, similarityThreshold: 0.5 },
    });
    await service.analyze({ type: "repeat", params: { x: 1 } });
    expect(ctx.events.emit).not.toHaveBeenCalled();
  });

  it("should_emit_loopDetected_when_similarity_above_threshold", async () => {
    const { service, ctx } = await createFingerprintHarness({
      config: { windowSize: 2, similarityThreshold: 0.5 },
    });
    const action = { type: "repeat", params: { x: 1 } };
    await service.analyze(action);
    await service.analyze(action);
    expect(ctx.events.emit).toHaveBeenCalledWith("fingerprint:loopDetected", {
      action,
      similarity: 1,
      loopLength: 0,
    });
  });

  it("should_not_emit_loopDetected_when_similarity_equals_threshold", async () => {
    const { service, ctx } = await createFingerprintHarness({
      config: { windowSize: 1, similarityThreshold: 1 },
    });
    await service.analyze({ type: "repeat", params: { x: 1 } });
    await service.analyze({ type: "repeat", params: { x: 2 } });
    expect(ctx.events.emit).not.toHaveBeenCalled();
  });

  it("should_emit_loopDetected_when_behavior_loopDetected_true", async () => {
    const loopInfo = { pattern: ["x", "y", "z"], count: 3, startPosition: 1, totalLoopsDetected: 2 };
    behaviorFingerprintState.recordActionResponse = { loopDetected: true, loopInfo };
    const { service, ctx } = await createFingerprintHarness({ config: { similarityThreshold: 0.99 } });
    const action = { type: "loop", params: { a: 1 } };
    await service.analyze(action);
    expect(ctx.events.emit).toHaveBeenCalledWith("fingerprint:loopDetected", {
      action,
      similarity: 0,
      loopLength: 3,
    });
  });

  it("should_reject_when_BehaviorFingerprint_constructor_throws", async () => {
    behaviorFingerprintState.throwOnConstruct = true;
    const { service } = await createFingerprintHarness();
    await expect(service.analyze({ type: "fail" })).rejects.toThrow("BehaviorFingerprint init failed");
  });

  it("should_reject_when_recordAction_throws", async () => {
    behaviorFingerprintState.recordActionThrows = true;
    const { service } = await createFingerprintHarness();
    await expect(service.analyze({ type: "fail" })).rejects.toThrow("recordAction failed");
  });

  it("should_support_concurrent_analyze_calls_when_initialized", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ type: "init", params: { a: 1 } });
    await Promise.all([
      service.analyze({ type: "fast", params: { b: 2 } }),
      service.analyze({ type: "fast", params: { b: 3 } }),
    ]);
    expect(service.getHistory()).toHaveLength(3);
  });

  it("should_support_string_windowSize_when_analyzing_actions", async () => {
    const { service } = await createFingerprintHarness({ config: { windowSize: "2" } });
    await service.analyze({ type: "seq", params: { a: 1 } });
    const result = await service.analyze({ type: "seq", params: { a: 2 } });
    expect(result.similarity).toBe(1);
  });

  it("should_handle_resource_heavy_payloads_when_action_has_long_strings_and_deep_objects", async () => {
    const longString = "x".repeat(100000);
    const deep = createDeepNested(10);
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({
      type: "tool",
      name: longString,
      params: { deep, huge: longString, z: 1 },
    });
    expect(result.fingerprint.endsWith("deep,huge,z")).toBe(true);
  });

  it("should_return_number_timestamp_when_analyze_called", async () => {
    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "x" });
    expect(typeof result.timestamp).toBe("number");
  });

  it("should_call_fingerprint_analyze_when_tool_call_event_payload_is_object", async () => {
    const callSpy = vi.fn().mockResolvedValue({ ok: true });
    const { listeners } = await createFingerprintHarness({
      servicesCallImpl: (name, method, args) => callSpy(name, method, args),
    });
    const handler = listeners.get("tool.call.*");
    await handler({ payload: { name: "fetch", args: { q: "test" } } });
    expect(callSpy).toHaveBeenCalledWith("fingerprint", "analyze", [
      { type: "tool_call", name: "fetch", args: { q: "test" } },
    ]);
  });

  it("should_call_fingerprint_analyze_with_undefined_fields_when_tool_call_event_payload_is_not_plain_object", async () => {
    const callSpy = vi.fn().mockResolvedValue({ ok: true });
    const { listeners } = await createFingerprintHarness({
      servicesCallImpl: (name, method, args) => callSpy(name, method, args),
    });
    const handler = listeners.get("tool.call.*");
    await handler({ payload: [] });
    expect(callSpy).toHaveBeenCalledWith("fingerprint", "analyze", [
      { type: "tool_call", name: undefined, args: undefined },
    ]);
  });

  it("should_clear_history_when_reset_called", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ type: "one" });
    service.reset();
    expect(service.getHistory()).toEqual([]);
  });

  it("should_call_fingerprinter_reset_when_reset_called", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ type: "one" });
    service.reset();
    expect(behaviorFingerprintState.instances[0].reset).toHaveBeenCalledTimes(1);
  });

  it("should_recreate_fingerprinter_when_analyze_called_after_reset", async () => {
    const { service } = await createFingerprintHarness();
    await service.analyze({ type: "one" });
    service.reset();
    await service.analyze({ type: "two" });
    expect(behaviorFingerprintState.instances).toHaveLength(2);
  });
});