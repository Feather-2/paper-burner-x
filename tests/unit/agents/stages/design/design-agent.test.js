import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  constructorSpy: vi.fn(),
  executeSpy: vi.fn(),
  constructorShouldThrow: { value: false },
}));

vi.mock("../../../../../js/agents/stages/design/agent-loop.js", () => {
  class MockDesignAgentLoop {
    constructor(...args) {
      if (mockState.constructorShouldThrow.value) {
        throw new Error("constructor failure");
      }
      mockState.constructorSpy(...args);
    }

    execute(...args) {
      return mockState.executeSpy(...args);
    }
  }

  return { DesignAgentLoop: MockDesignAgentLoop };
});

import { DesignStage, runDesignStage } from "../../../../../js/agents/stages/design/design-agent.js";

beforeEach(() => {
  mockState.constructorSpy.mockReset();
  mockState.executeSpy.mockReset();
  mockState.constructorShouldThrow.value = false;
});

describe("DesignStage", () => {
  it("defaults to an empty options object when undefined", () => {
    new DesignStage(undefined);

    expect(mockState.constructorSpy).toHaveBeenCalledTimes(1);
    expect(mockState.constructorSpy.mock.calls[0][0]).toEqual({});
  });

  it.each([null, "", "   ", [], {}, 0, -1, Number.MAX_SAFE_INTEGER])(
    "forwards option value %p to the base constructor",
    (options) => {
      new DesignStage(options);

      expect(mockState.constructorSpy).toHaveBeenCalledTimes(1);
      expect(mockState.constructorSpy).toHaveBeenCalledWith(options);
    }
  );

  it("propagates constructor errors from the base class", () => {
    mockState.constructorShouldThrow.value = true;

    expect(() => new DesignStage({})).toThrow("constructor failure");
  });
});

describe("runDesignStage", () => {
  it("returns execute results and forwards arguments", async () => {
    const runContext = { runId: "run-1" };
    const contentPackage = { slides: [] };
    const stageApi = { user: "demo" };
    const expected = { ok: true };

    mockState.executeSpy.mockResolvedValueOnce(expected);

    const result = await runDesignStage(runContext, contentPackage, stageApi);

    expect(result).toBe(expected);
    expect(mockState.executeSpy).toHaveBeenCalledTimes(1);
    expect(mockState.executeSpy).toHaveBeenCalledWith(runContext, contentPackage, stageApi);
  });

  it("uses an empty object when stageApi is undefined", async () => {
    const runContext = { runId: "run-undefined" };
    const contentPackage = { slides: [] };

    mockState.executeSpy.mockResolvedValueOnce("ok");

    await runDesignStage(runContext, contentPackage, undefined);

    expect(mockState.executeSpy).toHaveBeenCalledTimes(1);
    expect(mockState.executeSpy.mock.calls[0][2]).toEqual({});
  });

  it.each([
    {
      label: "null and empty values",
      runContext: null,
      contentPackage: "",
      stageApi: [],
    },
    {
      label: "undefined and zero with empty object",
      runContext: undefined,
      contentPackage: 0,
      stageApi: {},
    },
    {
      label: "negative and max numeric with whitespace",
      runContext: -1,
      contentPackage: Number.MAX_SAFE_INTEGER,
      stageApi: "   ",
    },
    {
      label: "string numeric and object-as-array inputs",
      runContext: "42",
      contentPackage: { 0: "slide", length: 1 },
      stageApi: { 0: "api", length: 2 },
    },
  ])("forwards boundary inputs: $label", async ({ runContext, contentPackage, stageApi }) => {
    mockState.executeSpy.mockResolvedValueOnce("ok");

    await runDesignStage(runContext, contentPackage, stageApi);

    expect(mockState.executeSpy).toHaveBeenCalledTimes(1);
    expect(mockState.executeSpy).toHaveBeenCalledWith(runContext, contentPackage, stageApi);
  });

  it("handles large strings, huge file metadata, and deep nesting", async () => {
    const longString = "x".repeat(100000);
    const hugeFile = { name: "huge.bin", size: Number.MAX_SAFE_INTEGER, content: longString };
    const deepNested = {};
    let cursor = deepNested;
    for (let depth = 0; depth < 10; depth += 1) {
      cursor.level = { depth };
      cursor = cursor.level;
    }
    const runContext = { meta: deepNested };
    const contentPackage = { file: hugeFile };
    const stageApi = { note: longString };

    mockState.executeSpy.mockResolvedValueOnce({ ok: true });

    await runDesignStage(runContext, contentPackage, stageApi);

    expect(mockState.executeSpy).toHaveBeenCalledWith(runContext, contentPackage, stageApi);
  });

  it("supports concurrent calls", async () => {
    mockState.executeSpy.mockImplementation(async (runContext) => ({ runId: runContext.runId }));

    const [first, second] = await Promise.all([
      runDesignStage({ runId: "a" }, { slides: [] }, {}),
      runDesignStage({ runId: "b" }, { slides: [] }, {}),
    ]);

    expect(first).toEqual({ runId: "a" });
    expect(second).toEqual({ runId: "b" });
    expect(mockState.executeSpy).toHaveBeenCalledTimes(2);
    expect(mockState.constructorSpy).toHaveBeenCalledTimes(2);
  });

  it("handles rapid successive calls", async () => {
    mockState.executeSpy.mockImplementation(async (runContext) => runContext.sequence);

    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await runDesignStage({ sequence: i }, { slides: [] }, {}));
    }

    expect(results).toEqual([0, 1, 2]);
    expect(mockState.executeSpy).toHaveBeenCalledTimes(3);
    expect(mockState.constructorSpy).toHaveBeenCalledTimes(3);
  });

  it("propagates execute errors", async () => {
    mockState.executeSpy.mockRejectedValueOnce(new Error("execute failure"));

    await expect(runDesignStage({ runId: "bad" }, {}, {})).rejects.toThrow("execute failure");
  });
});
