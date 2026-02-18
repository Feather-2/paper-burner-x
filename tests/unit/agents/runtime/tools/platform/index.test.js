import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockIsNodeLike: vi.fn(),
  mockPlatform: { runtime: "node" },
  mockCreateNodeTools: vi.fn(),
  mockCreateBrowserTools: vi.fn(),
}));

let mockIsNodeLike;
let mockPlatform;
let mockCreateNodeTools;
let mockCreateBrowserTools;

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  Platform: mocks.mockPlatform,
  isNodeLike: mocks.mockIsNodeLike,
}));

vi.mock("../../../../../../js/agents/runtime/tools/platform/node.js", () => ({
  createNodeTools: mocks.mockCreateNodeTools,
}));

vi.mock("../../../../../../js/agents/runtime/tools/platform/browser.js", () => ({
  createBrowserTools: mocks.mockCreateBrowserTools,
}));

import {
  Platform,
  createPlatformTools,
  getPlatformType,
  hasCapability,
  isNodeLike,
} from "../../../../../../js/agents/runtime/tools/platform/index.js";

beforeEach(() => {
  mockIsNodeLike = mocks.mockIsNodeLike;
  mockPlatform = mocks.mockPlatform;
  mockCreateNodeTools = mocks.mockCreateNodeTools;
  mockCreateBrowserTools = mocks.mockCreateBrowserTools;

  mockIsNodeLike.mockReset();
  mockCreateNodeTools.mockReset();
  mockCreateBrowserTools.mockReset();
  mockPlatform.runtime = "node";
  delete globalThis.__AGENT_RUNTIME_CAPABILITIES__;
  delete globalThis.pyodide;
  delete globalThis.Pyodide;
  delete globalThis.loadPyodide;
  delete globalThis.quickjs;
  delete globalThis.QuickJS;
  delete globalThis.__AGENT_JS_SANDBOX_READY__;
});

describe("createPlatformTools", () => {
  it("uses node tools when node-like", async () => {
    mockIsNodeLike.mockReturnValue(true);
    const options = { basePath: "/tmp", allowedCommands: ["ls"] };
    const nodeTools = { platform: "node" };
    mockCreateNodeTools.mockResolvedValue(nodeTools);

    const result = await createPlatformTools(options);

    expect(result).toBe(nodeTools);
    expect(mockCreateNodeTools).toHaveBeenCalledWith(options);
    expect(mockCreateBrowserTools).not.toHaveBeenCalled();
  });

  it("uses browser tools when not node-like", async () => {
    mockIsNodeLike.mockReturnValue(false);
    const options = { vfs: {} };
    const browserTools = { platform: "browser" };
    mockCreateBrowserTools.mockResolvedValue(browserTools);

    const result = await createPlatformTools(options);

    expect(result).toBe(browserTools);
    expect(mockCreateBrowserTools).toHaveBeenCalledWith(options);
    expect(mockCreateNodeTools).not.toHaveBeenCalled();
  });

  it("defaults options to empty object when undefined", async () => {
    mockIsNodeLike.mockReturnValue(true);
    mockCreateNodeTools.mockResolvedValue({ ok: true });

    await createPlatformTools();

    expect(mockCreateNodeTools).toHaveBeenCalledWith({});
  });

  it("passes through null options without mutation", async () => {
    mockIsNodeLike.mockReturnValue(true);
    mockCreateNodeTools.mockResolvedValue({ ok: true });

    await createPlatformTools(null);

    expect(mockCreateNodeTools).toHaveBeenCalledWith(null);
  });

  it("propagates errors from node tools", async () => {
    mockIsNodeLike.mockReturnValue(true);
    mockCreateNodeTools.mockRejectedValue(new Error("node failure"));

    await expect(createPlatformTools({})).rejects.toThrow("node failure");
  });

  it("propagates errors from browser tools", async () => {
    mockIsNodeLike.mockReturnValue(false);
    mockCreateBrowserTools.mockRejectedValue(new Error("browser failure"));

    await expect(createPlatformTools({})).rejects.toThrow("browser failure");
  });

  it("handles rapid consecutive calls independently", async () => {
    mockIsNodeLike.mockReturnValue(true);
    mockCreateNodeTools.mockResolvedValue({ ok: true });

    await createPlatformTools({ basePath: "first" });
    await createPlatformTools({ basePath: "second" });

    expect(mockCreateNodeTools).toHaveBeenCalledTimes(2);
    expect(mockCreateNodeTools.mock.calls[0][0]).toEqual({ basePath: "first" });
    expect(mockCreateNodeTools.mock.calls[1][0]).toEqual({ basePath: "second" });
  });

  it("handles concurrent calls without shared state", async () => {
    mockIsNodeLike
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mockCreateNodeTools.mockResolvedValue({ platform: "node" });
    mockCreateBrowserTools.mockResolvedValue({ platform: "browser" });

    const firstCall = createPlatformTools({ basePath: "node-call" });
    const secondCall = createPlatformTools({ basePath: "browser-call" });
    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);

    expect(firstResult.platform).toBe("node");
    expect(secondResult.platform).toBe("browser");
    expect(mockCreateNodeTools).toHaveBeenCalledTimes(1);
    expect(mockCreateBrowserTools).toHaveBeenCalledTimes(1);
  });

  it("accepts boundary values and large payloads in options", async () => {
    mockIsNodeLike.mockReturnValue(true);
    mockCreateNodeTools.mockResolvedValue({ ok: true });

    const longString = "a".repeat(100000);
    const hugeBuffer = new Uint8Array(1024 * 1024);
    const deepNested = {
      level0: {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deep",
              },
            },
          },
        },
      },
    };

    const options = {
      basePath: "   ",
      allowedCommands: { 0: "ls", length: 1 },
      maxTimeoutMs: "0",
      vfs: {},
      extra: {
        emptyArray: [],
        emptyObject: {},
        zero: 0,
        negative: -1,
        maxSafe: Number.MAX_SAFE_INTEGER,
        numericString: "123",
        longString,
        hugeBuffer,
        deepNested,
      },
    };

    await createPlatformTools(options);

    expect(mockCreateNodeTools).toHaveBeenCalledWith(options);
  });
});

describe("getPlatformType", () => {
  it("returns the current runtime value", () => {
    mockPlatform.runtime = "browser";

    const result = getPlatformType();

    expect(result).toBe("browser");
  });

  it("returns boundary runtime values without coercion", () => {
    const values = [
      "unknown",
      "",
      "   ",
      null,
      undefined,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "a".repeat(4096),
    ];

    values.forEach((value) => {
      mockPlatform.runtime = value;
      expect(getPlatformType()).toBe(value);
    });
  });
});

describe("hasCapability", () => {
  it("probes python/js_sandbox capabilities from runtime state", () => {
    mockIsNodeLike.mockReturnValue(false);

    delete globalThis.__AGENT_RUNTIME_CAPABILITIES__;
    delete globalThis.pyodide;
    delete globalThis.Pyodide;
    delete globalThis.loadPyodide;
    delete globalThis.quickjs;
    delete globalThis.QuickJS;
    delete globalThis.__AGENT_JS_SANDBOX_READY__;

    expect(hasCapability("python")).toBe(false);
    expect(hasCapability("js_sandbox")).toBe(false);

    globalThis.loadPyodide = () => Promise.resolve();
    globalThis.__AGENT_JS_SANDBOX_READY__ = true;
    expect(hasCapability("python")).toBe(true);
    expect(hasCapability("js_sandbox")).toBe(true);
  });

  it("returns true for bash only on node-like platforms", () => {
    mockIsNodeLike.mockReturnValue(true);
    expect(hasCapability("bash")).toBe(true);

    mockIsNodeLike.mockReturnValue(false);
    expect(hasCapability("bash")).toBe(false);
  });

  it("returns false for unknown or invalid capability values", () => {
    mockIsNodeLike.mockReturnValue(true);
    const invalidValues = [
      "docker",
      "",
      "   ",
      null,
      undefined,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "0",
      "123",
      [],
      {},
      { 0: "bash", length: 1 },
    ];

    invalidValues.forEach((value) => {
      expect(hasCapability(value)).toBe(false);
    });
  });

  it("allows explicit capability overrides", () => {
    mockIsNodeLike.mockReturnValue(true);
    globalThis.__AGENT_RUNTIME_CAPABILITIES__ = { python: true, js_sandbox: false };

    expect(hasCapability("python")).toBe(true);
    expect(hasCapability("js_sandbox")).toBe(false);
  });

  it("uses the latest node-like status for rapid calls", () => {
    mockIsNodeLike
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(hasCapability("bash")).toBe(true);
    expect(hasCapability("bash")).toBe(false);
    expect(mockIsNodeLike).toHaveBeenCalledTimes(2);
  });
});

describe("Platform", () => {
  it("re-exports Platform from shared module", () => {
    expect(Platform).toBe(mockPlatform);
  });

  it("reflects runtime changes on the shared object", () => {
    mockPlatform.runtime = "deno";
    expect(Platform.runtime).toBe("deno");
  });
});

describe("isNodeLike", () => {
  it("re-exports isNodeLike from shared module", () => {
    expect(isNodeLike).toBe(mockIsNodeLike);
  });

  it("delegates to the shared implementation", () => {
    mockIsNodeLike.mockReturnValue(true);

    expect(isNodeLike()).toBe(true);
    expect(mockIsNodeLike).toHaveBeenCalledTimes(1);
  });
});
