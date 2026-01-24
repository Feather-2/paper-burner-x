import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock every plugin implementation referenced by the registry to ensure we never load real code.
vi.mock("../../../../js/agents/plugins/compression/cicada.js", () => ({
  default: { id: "compression/cicada" },
}));
vi.mock("../../../../js/agents/plugins/compression/watchdog.js", () => ({
  default: { id: "compression/watchdog" },
}));

vi.mock("../../../../js/agents/plugins/analysis/fingerprint.js", () => ({
  default: { id: "analysis/fingerprint" },
}));
vi.mock("../../../../js/agents/plugins/analysis/convergence-detector.js", () => ({
  default: { id: "analysis/convergence" },
}));
vi.mock("../../../../js/agents/plugins/analysis/behavior-fingerprint.js", () => ({
  default: { id: "analysis/behavior" },
}));

vi.mock("../../../../js/agents/plugins/telemetry/token-tracker.js", () => ({
  default: { id: "telemetry/token-tracker" },
}));
vi.mock("../../../../js/agents/plugins/telemetry/trace-context.js", () => ({
  default: { id: "telemetry/trace" },
}));
vi.mock("../../../../js/agents/plugins/telemetry/replay-controller.js", () => ({
  default: { id: "telemetry/replay" },
}));

vi.mock("../../../../js/agents/plugins/memory/memory-store.impl.js", () => ({
  default: { id: "memory/store" },
}));
vi.mock("../../../../js/agents/plugins/memory/state-engine.js", () => ({
  default: { id: "memory/state-engine" },
}));
vi.mock("../../../../js/agents/plugins/memory/retrieval-engine.js", () => ({
  default: { id: "memory/retrieval" },
}));

vi.mock("../../../../js/agents/plugins/coordination/tab-coordinator.js", () => ({
  default: { id: "coordination/tab" },
}));
vi.mock("../../../../js/agents/plugins/coordination/process-coordinator.js", () => ({
  default: { id: "coordination/process" },
}));

vi.mock("../../../../js/agents/plugins/checkpoints/agent-checkpoint-store.js", () => ({
  default: { id: "checkpoints/store" },
}));

vi.mock("../../../../js/agents/plugins/deps/index.js", () => ({
  default: { id: "deps/python" },
}));

vi.mock("../../../../js/agents/plugins/plan/plan-store.js", () => ({
  default: { id: "plan/store" },
}));
vi.mock("../../../../js/agents/plugins/plan/structured-plan.js", () => ({
  default: { id: "plan/structured" },
}));

vi.mock("../../../../js/agents/plugins/policy/engine.js", () => ({
  default: { id: "policy/engine" },
}));
vi.mock("../../../../js/agents/plugins/policy/manager.js", () => ({
  default: { id: "policy/manager" },
}));

vi.mock("../../../../js/agents/plugins/routing/performance-router.js", () => ({
  default: { id: "routing/performance" },
}));

vi.mock("../../../../js/agents/plugins/transports/index.js", () => ({
  default: { id: "transports/process" },
}));

vi.mock("../../../../js/agents/plugins/side-effects/side-effect-journal.js", () => ({
  default: { id: "side-effects/journal" },
}));

vi.mock("../../../../js/agents/plugins/resilience/retry.js", () => ({
  default: { id: "resilience/retry" },
}));
vi.mock("../../../../js/agents/plugins/resilience/degradation-matrix.js", () => ({
  default: { id: "resilience/level" },
}));

vi.mock("../../../../js/agents/plugins/stages/deepsearch.js", () => ({
  default: { id: "stage/deepsearch" },
}));

vi.mock("../../../../js/agents/plugins/services/llm.js", () => ({
  default: { id: "service/llm" },
}));
vi.mock("../../../../js/agents/plugins/services/mcp.js", () => ({
  default: { id: "service/mcp" },
}));
vi.mock("../../../../js/agents/plugins/services/scheduler.js", () => ({
  default: { id: "service/scheduler" },
}));
vi.mock("../../../../js/agents/plugins/services/vfs.js", () => ({
  default: { id: "service/vfs" },
}));

vi.mock("../../../../js/agents/core/sandbox/plugin.js", () => ({
  default: { id: "sandbox" },
}));

// One registry entry needs to validate "no default export" behavior.
vi.mock("../../../../js/agents/plugins/debug/logger.js", () => ({
  default: undefined,
  name: "logger",
  LoggerPlugin: { id: "debug/logger" },
}));
vi.mock("../../../../js/agents/plugins/debug/inspector.js", () => ({
  default: { id: "debug/inspector" },
}));

const LONG_NAME = "x".repeat(50_000);
const LARGE_PAYLOAD = "y".repeat(1024 * 1024);

const buildDeepNested = (depth) => {
  let node = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    node = { level: i, child: node };
  }
  return node;
};

const countDepth = (node) => {
  let depth = 0;
  let current = node;
  while (current && current.child) {
    depth += 1;
    current = current.child;
  }
  return depth;
};

let plugins;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  plugins = await import("../../../../js/agents/plugins/index.js");
});

describe("loadPlugin", () => {
  it("should_return_default_export_when_module_has_default_export", async () => {
    // Act
    const plugin = await plugins.loadPlugin("analysis/fingerprint");

    // Assert
    expect(plugin).toEqual({ id: "analysis/fingerprint" });
  });

  it("should_return_module_namespace_when_module_has_no_default_export", async () => {
    // Act
    const plugin = await plugins.loadPlugin("debug/logger");

    // Assert
    expect(plugin).toEqual(expect.objectContaining({ LoggerPlugin: { id: "debug/logger" } }));
  });

  it("should_throw_unknown_plugin_error_when_name_is_unregistered", async () => {
    // Act + Assert
    await expect(plugins.loadPlugin("missing/plugin")).rejects.toThrow(/Unknown plugin:/);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty_string", ""],
    ["whitespace", "   "],
    ["zero_number", 0],
    ["negative_number", -1],
    ["max_safe_integer", Number.MAX_SAFE_INTEGER],
    ["zero_string", "0"],
    ["numeric_string", "123"],
    ["empty_array", []],
    ["empty_object", {}],
    ["very_long_string", LONG_NAME],
  ])("should_throw_unknown_plugin_error_when_name_is_%s", async (_label, value) => {
    // Act + Assert
    await expect(plugins.loadPlugin(value)).rejects.toThrow(/Unknown plugin:/);
  });

  it("should_propagate_loader_error_when_loader_throws", async () => {
    // Arrange
    const error = new Error("boom");
    plugins.registerPlugin("custom/error", () => {
      throw error;
    });

    // Act + Assert
    await expect(plugins.loadPlugin("custom/error")).rejects.toThrow("boom");
  });

  it("should_handle_concurrent_calls_when_loader_returns_large_payload", async () => {
    // Arrange
    const loader = async () => ({
      default: {
        payload: LARGE_PAYLOAD,
      },
    });
    plugins.registerPlugin("custom/large", loader);

    // Act
    const [first, second] = await Promise.all([
      plugins.loadPlugin("custom/large"),
      plugins.loadPlugin("custom/large"),
    ]);

    // Assert
    expect([first.payload.length, second.payload.length]).toEqual([LARGE_PAYLOAD.length, LARGE_PAYLOAD.length]);
  });

  it("should_preserve_deep_nesting_when_loader_returns_deep_structure", async () => {
    // Arrange
    const deep = buildDeepNested(32);
    plugins.registerPlugin("custom/deep", async () => ({
      default: { nested: deep },
    }));

    // Act
    const plugin = await plugins.loadPlugin("custom/deep");

    // Assert
    expect(countDepth(plugin.nested)).toBe(32);
  });
});

describe("hasPlugin", () => {
  it("should_return_true_when_name_is_registered", () => {
    // Act
    const result = plugins.hasPlugin("analysis/fingerprint");

    // Assert
    expect(result).toBe(true);
  });

  it("should_return_false_when_name_is_unregistered", () => {
    // Act
    const result = plugins.hasPlugin("missing/plugin");

    // Assert
    expect(result).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty_string", ""],
    ["whitespace", "   "],
    ["zero_number", 0],
    ["negative_number", -1],
    ["max_safe_integer", Number.MAX_SAFE_INTEGER],
    ["zero_string", "0"],
    ["numeric_string", "123"],
    ["empty_array", []],
    ["empty_object", {}],
    ["very_long_string", LONG_NAME],
  ])("should_return_false_when_name_is_%s", (_label, value) => {
    // Act
    const result = plugins.hasPlugin(value);

    // Assert
    expect(result).toBe(false);
  });

  it("should_return_expected_results_when_called_concurrently", async () => {
    // Arrange
    const names = ["analysis/fingerprint", "debug/logger", "missing", null, "   "];

    // Act
    const results = await Promise.all(names.map((name) => Promise.resolve().then(() => plugins.hasPlugin(name))));

    // Assert
    expect(results).toEqual([true, true, false, false, false]);
  });
});

describe("listAvailablePlugins", () => {
  it("should_return_a_non_empty_array_of_plugin_names", () => {
    // Act
    const list = plugins.listAvailablePlugins();

    // Assert
    expect(list.length).toBeGreaterThan(0);
  });

  it("should_include_known_plugin_names_when_listing", () => {
    // Act
    const list = plugins.listAvailablePlugins();

    // Assert
    expect(list).toEqual(expect.arrayContaining(["analysis/fingerprint", "sandbox", "debug/inspector"]));
  });

  it("should_include_registered_plugin_when_registerPlugin_is_called", () => {
    // Arrange
    plugins.registerPlugin("custom/list", async () => ({ default: { ok: true } }));

    // Act
    const list = plugins.listAvailablePlugins();

    // Assert
    expect(list).toContain("custom/list");
  });

  it("should_not_mutate_registry_when_consumer_mutates_returned_list", () => {
    // Arrange
    const list = plugins.listAvailablePlugins();

    // Act
    list.push("fake/plugin");

    // Assert
    expect(plugins.hasPlugin("fake/plugin")).toBe(false);
  });
});

describe("registerPlugin", () => {
  it("should_register_plugin_name_when_loader_is_provided", () => {
    // Arrange
    plugins.registerPlugin("custom/plugin", async () => ({ default: { id: "custom/plugin" } }));

    // Act
    const result = plugins.hasPlugin("custom/plugin");

    // Assert
    expect(result).toBe(true);
  });

  it("should_load_registered_plugin_when_loader_returns_default_export", async () => {
    // Arrange
    plugins.registerPlugin("custom/plugin", async () => ({ default: { id: "custom/plugin" } }));

    // Act
    const plugin = await plugins.loadPlugin("custom/plugin");

    // Assert
    expect(plugin).toEqual({ id: "custom/plugin" });
  });

  it("should_override_existing_loader_when_name_is_re_registered", async () => {
    // Arrange
    plugins.registerPlugin("analysis/fingerprint", async () => ({ default: { id: "override" } }));

    // Act
    const plugin = await plugins.loadPlugin("analysis/fingerprint");

    // Assert
    expect(plugin).toEqual({ id: "override" });
  });

  it("should_throw_typeerror_when_loader_is_not_a_function_and_loaded", async () => {
    // Arrange
    plugins.registerPlugin("custom/bad", "not-a-function");

    // Act + Assert
    await expect(plugins.loadPlugin("custom/bad")).rejects.toThrow(TypeError);
  });

  it("should_support_very_long_names_when_registering", () => {
    // Arrange
    plugins.registerPlugin(LONG_NAME, async () => ({ default: { id: LONG_NAME } }));

    // Act
    const result = plugins.hasPlugin(LONG_NAME);

    // Assert
    expect(result).toBe(true);
  });
});

describe("createPluginLoader", () => {
  it("should_return_a_function_when_called", () => {
    // Act
    const loader = plugins.createPluginLoader();

    // Assert
    expect(typeof loader).toBe("function");
  });

  it("should_load_same_plugin_as_loadPlugin_when_called", async () => {
    // Arrange
    const loader = plugins.createPluginLoader();

    // Act
    const viaLoader = await loader("analysis/fingerprint");
    const viaDirect = await plugins.loadPlugin("analysis/fingerprint");

    // Assert
    expect([viaLoader, viaDirect]).toEqual([{ id: "analysis/fingerprint" }, { id: "analysis/fingerprint" }]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty_string", ""],
    ["whitespace", "   "],
    ["zero_number", 0],
    ["negative_number", -1],
    ["max_safe_integer", Number.MAX_SAFE_INTEGER],
    ["missing", "missing"],
  ])("should_throw_unknown_plugin_error_when_loader_is_called_with_%s", async (_label, value) => {
    // Arrange
    const loader = plugins.createPluginLoader();

    // Act + Assert
    await expect(loader(value)).rejects.toThrow(/Unknown plugin:/);
  });

  it("should_support_concurrent_calls_to_different_plugins", async () => {
    // Arrange
    plugins.registerPlugin("custom/a", async () => ({ default: { id: "a" } }));
    plugins.registerPlugin("custom/b", async () => ({ default: { id: "b" } }));
    const loader = plugins.createPluginLoader();

    // Act
    const [first, second] = await Promise.all([loader("custom/a"), loader("custom/b")]);

    // Assert
    expect([first.id, second.id]).toEqual(["a", "b"]);
  });
});

describe("default", () => {
  it("should_expose_expected_api_surface_when_accessing_default_export", () => {
    // Act
    const api = plugins.default;

    // Assert
    expect(api).toEqual(
      expect.objectContaining({
        load: plugins.loadPlugin,
        has: plugins.hasPlugin,
        list: plugins.listAvailablePlugins,
        register: plugins.registerPlugin,
        createLoader: plugins.createPluginLoader,
      }),
    );
  });

  it("should_load_plugin_when_using_default_api_load", async () => {
    // Act
    const plugin = await plugins.default.load("analysis/fingerprint");

    // Assert
    expect(plugin).toEqual({ id: "analysis/fingerprint" });
  });

  it("should_throw_unknown_plugin_error_when_default_api_loads_unregistered_name", async () => {
    // Act + Assert
    await expect(plugins.default.load("missing/plugin")).rejects.toThrow(/Unknown plugin:/);
  });
});