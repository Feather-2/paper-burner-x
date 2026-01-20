import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../../js/agents/shared/index.js", () => {
  return {
    toNonEmptyString: vi.fn((value) => {
      if (value === undefined || value === null) return undefined;
      const s = String(value).trim();
      return s ? s : undefined;
    }),
  };
});

let handler;
let definition;
let defaultExport;
let toNonEmptyString;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  ({ toNonEmptyString } = await import("../../../../../../../js/agents/shared/index.js"));
  ({ handler, definition, default: defaultExport } = await import(
    "../../../../../../../js/agents/stages/deepsearch/tools/get-artifact/handler.js"
  ));
});

function makeDeepObject(depth) {
  let node = { leaf: "end" };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
}

describe("definition", () => {
  it("provides expected metadata", () => {
    expect(definition).toMatchObject({
      name: "get-artifact",
      layer: 0,
    });
    expect(definition.description).toContain("artifactId");
    expect(definition.activation.keywords).toEqual(
      expect.arrayContaining(["artifact", "retrieve"])
    );
    expect(definition.activation.phases).toEqual(["researching", "writing"]);
    expect(definition.parameters).toEqual({
      artifactId: expect.any(String),
      maxChars: expect.any(String),
    });
  });
});

describe("handler", () => {
  it.each([
    ["undefined args", undefined],
    ["null args", null],
    ["empty string", { artifactId: "" }],
    ["whitespace", { artifactId: "   " }],
    ["empty array", { artifactId: [] }],
  ])("returns error when artifactId is missing (%s)", async (_label, args) => {
    const runStore = { getArtifactRecord: vi.fn() };
    const result = await handler(args, { stageApi: { runStore } });

    expect(result).toEqual({ success: false, error: "artifactId is required" });
    expect(runStore.getArtifactRecord).not.toHaveBeenCalled();
    expect(toNonEmptyString).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no context", undefined],
    ["empty context", {}],
    ["stageApi without runStore", { stageApi: {} }],
    ["runStore without getArtifactRecord", { stageApi: { runStore: {} } }],
    [
      "runStore getArtifactRecord not function",
      { stageApi: { runStore: { getArtifactRecord: "nope" } } },
    ],
  ])("returns error when runStore is unavailable (%s)", async (_label, context) => {
    const result = await handler({ artifactId: "art" }, context);

    expect(result).toEqual({
      success: false,
      error: "runStore.getArtifactRecord is not available in this environment",
    });
    expect(toNonEmptyString).toHaveBeenCalledTimes(1);
  });

  it("returns error when artifact is not found", async () => {
    const runStore = { getArtifactRecord: vi.fn(async () => null) };
    const result = await handler(
      { artifactId: "missing" },
      { stageApi: { runStore } }
    );

    expect(result).toEqual({
      success: false,
      error: "artifact not found: missing",
    });
    expect(runStore.getArtifactRecord).toHaveBeenCalledWith("missing");
  });

  it.each([
    ["Error instance", new Error("boom"), "boom"],
    ["string error", "bad", "bad"],
  ])("returns error when getArtifactRecord throws (%s)", async (_label, thrown, msg) => {
    const runStore = {
      getArtifactRecord: vi.fn(async () => {
        throw thrown;
      }),
    };

    const result = await handler(
      { artifactId: "art" },
      { stageApi: { runStore } }
    );

    expect(result).toEqual({ success: false, error: msg });
  });

  it("returns artifact data and metadata without truncation", async () => {
    const record = {
      artifactId: "a1",
      runId: "run1",
      type: "result",
      mime: "text/plain",
      bytes: 42,
      sha256: "hash",
      data: "hello",
    };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "a1" },
      { stageApi: { runStore } }
    );

    expect(result).toEqual({
      success: true,
      artifactId: "a1",
      runId: "run1",
      type: "result",
      mime: "text/plain",
      bytes: 42,
      sha256: "hash",
      truncated: false,
      totalChars: 5,
      data: "hello",
    });
  });

  it("truncates when maxChars is a numeric string", async () => {
    const record = { artifactId: "a2", data: "0123456789" };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "a2", maxChars: "5" },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(10);
    expect(result.data).toBe("01234\n...(truncated)");
  });

  it("treats maxChars 0 as no truncation", async () => {
    const record = { artifactId: "zero", data: "abc" };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "zero", maxChars: 0 },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(3);
    expect(result.data).toBe("abc");
  });

  it("handles negative maxChars by slicing", async () => {
    const record = { artifactId: "neg", data: "abcd" };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "neg", maxChars: -1 },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(4);
    expect(result.data).toBe("abc\n...(truncated)");
  });

  it("normalizes nullish and empty collection data", async () => {
    const cases = [
      { data: null, expected: "" },
      { data: undefined, expected: "" },
      { data: [], expected: "[]" },
      { data: {}, expected: "{}" },
    ];

    for (const { data, expected } of cases) {
      const record = { artifactId: "empty", data };
      const runStore = { getArtifactRecord: vi.fn(async () => record) };

      const result = await handler(
        { artifactId: "empty", maxChars: 20 },
        { stageApi: { runStore } }
      );

      expect(result.success).toBe(true);
      expect(result.truncated).toBe(false);
      expect(result.data).toBe(expected);
      expect(result.totalChars).toBe(expected.length);
    }
  });

  it("stringifies array-like object data", async () => {
    const record = { artifactId: "arraylike", data: { 0: "x", length: 1 } };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "arraylike", maxChars: 100 },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.data).toContain('"0": "x"');
    expect(result.data).toContain('"length": 1');
  });

  it("stringifies deep nested object data", async () => {
    const record = { artifactId: "deep", data: makeDeepObject(20) };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "deep", maxChars: 20000 },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.data).toContain('"leaf": "end"');
  });

  it("falls back to String() when data is not JSON-serializable", async () => {
    const data = { toString: () => "circular" };
    data.self = data;

    const record = { artifactId: "circ", data };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "circ", maxChars: 50 },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.data).toBe("circular");
  });

  it("truncates large data with default maxChars", async () => {
    const large = "a".repeat(5000);
    const record = { artifactId: "big", data: large };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "big" },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(large.length);
    expect(result.data).toBe(large.slice(0, 4000) + "\n...(truncated)");
  });

  it("does not truncate when maxChars is MAX_SAFE_INTEGER", async () => {
    const large = "b".repeat(10000);
    const record = { artifactId: "max", data: large };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "max", maxChars: Number.MAX_SAFE_INTEGER },
      { stageApi: { runStore } }
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(large.length);
    expect(result.data).toBe(large);
  });

  it("supports concurrent calls", async () => {
    const records = {
      a: { artifactId: "a", data: "alpha" },
      b: { artifactId: "b", data: "beta" },
    };
    const runStore = {
      getArtifactRecord: vi.fn(async (artifactId) => {
        await Promise.resolve();
        return records[artifactId];
      }),
    };
    const context = { stageApi: { runStore } };

    const [resA, resB] = await Promise.all([
      handler({ artifactId: "a", maxChars: 10 }, context),
      handler({ artifactId: "b", maxChars: 10 }, context),
    ]);

    expect(resA.data).toBe("alpha");
    expect(resB.data).toBe("beta");
    expect(runStore.getArtifactRecord).toHaveBeenCalledTimes(2);
  });

  it("supports rapid sequential calls", async () => {
    const runStore = {
      getArtifactRecord: vi
        .fn()
        .mockResolvedValueOnce({ artifactId: "seq", data: "first" })
        .mockResolvedValueOnce({ artifactId: "seq", data: "second" }),
    };
    const context = { stageApi: { runStore } };

    const first = await handler({ artifactId: "seq", maxChars: 50 }, context);
    const second = await handler({ artifactId: "seq", maxChars: 50 }, context);

    expect(first.data).toBe("first");
    expect(second.data).toBe("second");
    expect(runStore.getArtifactRecord).toHaveBeenCalledTimes(2);
  });
});

describe("default export", () => {
  it("exposes definition and handler", () => {
    expect(defaultExport).toEqual({ definition, handler });
  });
});
