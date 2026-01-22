import { describe, it, expect, vi, beforeEach } from "vitest";

const fingerprintMock = vi.hoisted(() => ({
  default: { id: "fingerprint-plugin" },
}));

const loggerMock = vi.hoisted(() => ({
  default: undefined,
  name: "logger",
  LoggerPlugin: { id: "logger-plugin" },
}));

vi.mock("../../../../js/agents/plugins/analysis/fingerprint.js", () => fingerprintMock);
vi.mock("../../../../js/agents/plugins/debug/logger.js", () => loggerMock);

const LONG_NAME = "x".repeat(50000);
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
  it("loads plugins that expose a default export", async () => {
    const plugin = await plugins.loadPlugin("analysis/fingerprint");

    expect(plugin).toBe(fingerprintMock.default);
  });

  it("returns the module object when no default export exists", async () => {
    const plugin = await plugins.loadPlugin("debug/logger");

    expect(plugin).toEqual(loggerMock);
  });

  it("propagates loader errors", async () => {
    const error = new Error("boom");
    plugins.registerPlugin("custom/error", () => {
      throw error;
    });

    await expect(plugins.loadPlugin("custom/error")).rejects.toThrow("boom");
  });

  it("rejects unknown plugin names and boundary inputs", async () => {
    const values = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      "123",
      [],
      {},
      LONG_NAME,
      "missing/plugin",
    ];

    for (const value of values) {
      await expect(plugins.loadPlugin(value)).rejects.toThrow(/Unknown plugin/);
    }
  });

  it("handles concurrent and rapid calls with large payloads", async () => {
    const deep = buildDeepNested(32);
    const loader = vi.fn(async () => ({
      default: {
        payload: LARGE_PAYLOAD,
        nested: deep,
      },
    }));

    plugins.registerPlugin("custom/large", loader);

    const [first, second] = await Promise.all([
      plugins.loadPlugin("custom/large"),
      plugins.loadPlugin("custom/large"),
    ]);

    expect(first.payload.length).toBe(LARGE_PAYLOAD.length);
    expect(countDepth(first.nested)).toBe(32);
    expect(second.payload.length).toBe(LARGE_PAYLOAD.length);

    const third = await plugins.loadPlugin("custom/large");
    expect(third.nested).toEqual(deep);
    expect(loader).toHaveBeenCalledTimes(3);
  });
});

describe("hasPlugin", () => {
  it("returns true for known plugins and false for unknown ones", () => {
    expect(plugins.hasPlugin("analysis/fingerprint")).toBe(true);
    expect(plugins.hasPlugin("missing/plugin")).toBe(false);
  });

  it("returns false for empty, boundary, and type-mismatched inputs", () => {
    const values = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      "123",
      [],
      {},
      LONG_NAME,
    ];

    const results = values.map((value) => plugins.hasPlugin(value));
    expect(results).toEqual(Array(values.length).fill(false));
  });

  it("handles concurrent checks", async () => {
    const names = ["analysis/fingerprint", "debug/logger", "missing", null, "   "];

    const results = await Promise.all(names.map((name) => Promise.resolve().then(() => plugins.hasPlugin(name))));

    expect(results).toEqual([true, true, false, false, false]);
  });
});

describe("listAvailablePlugins", () => {
  it("returns a list of known plugin names", () => {
    const list = plugins.listAvailablePlugins();

    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain("analysis/fingerprint");
    expect(list).toContain("debug/logger");
    expect(list).toContain("sandbox");
  });

  it("reflects registered plugins and protects registry from list mutations", () => {
    const customName = "custom/list";
    plugins.registerPlugin(customName, () => ({ default: { ok: true } }));
    plugins.registerPlugin(LONG_NAME, () => ({ default: { ok: true } }));

    const list = plugins.listAvailablePlugins();
    list.push("fake/plugin");

    expect(list).toContain(customName);
    expect(list).toContain(LONG_NAME);
    expect(plugins.hasPlugin("fake/plugin")).toBe(false);
  });
});

describe("registerPlugin", () => {
  it("registers a loader that can be loaded", async () => {
    const loader = vi.fn(async () => ({ default: { name: "custom" } }));

    plugins.registerPlugin("custom/plugin", loader);
    const plugin = await plugins.loadPlugin("custom/plugin");

    expect(loader).toHaveBeenCalledTimes(1);
    expect(plugin).toEqual({ name: "custom/plugin" });
    expect(plugins.hasPlugin("custom/plugin")).toBe(true);
    expect(plugins.listAvailablePlugins()).toContain("custom/plugin");
  });

  it("overrides existing plugin loaders", async () => {
    const loader = vi.fn(() => ({ default: { id: "override" } }));

    plugins.registerPlugin("analysis/fingerprint", loader);
    const plugin = await plugins.loadPlugin("analysis/fingerprint");

    expect(plugin).toEqual({ id: "override" });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("supports boundary names and surfaces loader type errors", async () => {
    const arrayLoader = vi.fn(() => ({ default: { ok: "array" } }));
    const objectLoader = vi.fn(() => ({ default: { ok: "object" } }));

    plugins.registerPlugin([], arrayLoader);
    plugins.registerPlugin({}, objectLoader);

    const arrayPlugin = await plugins.loadPlugin([]);
    const objectPlugin = await plugins.loadPlugin({});

    expect(arrayPlugin.ok).toBe("array");
    expect(objectPlugin.ok).toBe("object");

    plugins.registerPlugin("custom/bad", "not-a-function");
    await expect(plugins.loadPlugin("custom/bad")).rejects.toThrow(TypeError);
  });
});

describe("createPluginLoader", () => {
  it("returns a loader that behaves like loadPlugin", async () => {
    const loader = plugins.createPluginLoader();

    const plugin = await loader("analysis/fingerprint");
    const direct = await plugins.loadPlugin("analysis/fingerprint");

    expect(plugin).toBe(direct);
  });

  it("propagates errors for unknown or invalid plugin names", async () => {
    const loader = plugins.createPluginLoader();
    const values = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, "missing"];

    await expect(Promise.all(values.map((value) => loader(value)))).rejects.toThrow(/Unknown plugin/);
  });

  it("handles concurrent calls to different plugins", async () => {
    const loader = plugins.createPluginLoader();

    const [fingerprint, logger] = await Promise.all([
      loader("analysis/fingerprint"),
      loader("debug/logger"),
    ]);

    expect(fingerprint).toBe(fingerprintMock.default);
    expect(logger).toEqual(loggerMock);
  });
});

describe("default", () => {
  it("exposes the expected API surface", () => {
    expect(plugins.default).toEqual(
      expect.objectContaining({
        load: plugins.loadPlugin,
        has: plugins.hasPlugin,
        list: plugins.listAvailablePlugins,
        register: plugins.registerPlugin,
        createLoader: plugins.createPluginLoader,
      }),
    );
  });

  it("provides functional helpers and preserves error handling", async () => {
    const api = plugins.default;
    const plugin = await api.load("analysis/fingerprint");

    expect(api.has("analysis/fingerprint")).toBe(true);
    expect(api.list()).toContain("analysis/fingerprint");
    expect(plugin).toBe(fingerprintMock.default);

    await expect(api.load("missing/plugin")).rejects.toThrow(/Unknown plugin/);
  });
});
