import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedShared = vi.hoisted(() => ({
  toNonEmptyString: vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  }),
}));

vi.mock("../../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: mockedShared.toNonEmptyString,
}));

const modulePath =
  "../../../../../../../js/agents/stages/deepsearch/tools/get-artifact/handler.js";

async function loadModule() {
  return await import(modulePath);
}

function makeContext(runStore) {
  return { stageApi: { runStore } };
}

function makeDeepObject(depth) {
  let node = { leaf: "end" };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
}

beforeEach(() => {
  vi.resetModules();
  mockedShared.toNonEmptyString.mockReset();
  mockedShared.toNonEmptyString.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });
});

describe("definition", () => {
  it("exposes expected metadata", async () => {
    const { definition } = await loadModule();

    expect(definition).toMatchObject({
      name: "get-artifact",
      layer: 0,
    });
    expect(definition.description).toContain("artifactId");
    expect(definition.activation.keywords).toEqual(
      expect.arrayContaining(["artifact", "persisted", "retrieve", "读取", "取回"])
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
    ["args undefined", undefined],
    ["args null", null],
    ["empty args object", {}],
    ["artifactId undefined", { artifactId: undefined }],
    ["artifactId null", { artifactId: null }],
    ["artifactId empty string", { artifactId: "" }],
    ["artifactId whitespace", { artifactId: "   " }],
    ["artifactId empty array", { artifactId: [] }],
  ])("returns error when artifactId is missing (%s)", async (_label, args) => {
    const { handler } = await loadModule();

    const runStore = { getArtifactRecord: vi.fn() };
    const result = await handler(args, makeContext(runStore));

    expect(result).toEqual({ success: false, error: "artifactId is required" });
    expect(runStore.getArtifactRecord).not.toHaveBeenCalled();
    expect(mockedShared.toNonEmptyString).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["context undefined", undefined],
    ["empty context", {}],
    ["stageApi missing runStore", { stageApi: {} }],
    ["stageApi null", { stageApi: null }],
    ["runStore null", { stageApi: { runStore: null } }],
    ["runStore missing getArtifactRecord", { stageApi: { runStore: {} } }],
    [
      "runStore getArtifactRecord not function",
      { stageApi: { runStore: { getArtifactRecord: "nope" } } },
    ],
  ])("returns error when runStore is unavailable (%s)", async (_label, context) => {
    const { handler } = await loadModule();

    const result = await handler({ artifactId: "art" }, context);

    expect(result).toEqual({
      success: false,
      error: "runStore.getArtifactRecord is not available in this environment",
    });
    expect(mockedShared.toNonEmptyString).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["zero", 0, "0"],
    ["negative", -1, "-1"],
    [
      "max safe integer",
      Number.MAX_SAFE_INTEGER,
      String(Number.MAX_SAFE_INTEGER),
    ],
  ])("accepts numeric artifactId (%s)", async (_label, artifactId, expectedId) => {
    const { handler } = await loadModule();

    const runStore = {
      getArtifactRecord: vi.fn(async (id) =>
        id === expectedId ? { artifactId: expectedId, data: "ok" } : null
      ),
    };

    const result = await handler(
      { artifactId, maxChars: 10 },
      makeContext(runStore)
    );

    expect(runStore.getArtifactRecord).toHaveBeenCalledWith(expectedId);
    expect(result).toMatchObject({
      success: true,
      artifactId: expectedId,
      truncated: false,
      totalChars: 2,
      data: "ok",
    });
  });

  it("treats empty-object artifactId as a string and returns not found", async () => {
    const { handler } = await loadModule();

    const runStore = { getArtifactRecord: vi.fn(async () => null) };
    const result = await handler(
      { artifactId: {}, maxChars: 10 },
      makeContext(runStore)
    );

    expect(mockedShared.toNonEmptyString).toHaveBeenCalledTimes(1);
    expect(runStore.getArtifactRecord).toHaveBeenCalledWith("[object Object]");
    expect(result).toEqual({
      success: false,
      error: "artifact not found: [object Object]",
    });
  });

  it("trims artifactId before querying RunStore", async () => {
    const { handler } = await loadModule();

    const record = { artifactId: "stored", data: "hello" };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "  input-id  ", maxChars: 100 },
      makeContext(runStore)
    );

    expect(runStore.getArtifactRecord).toHaveBeenCalledWith("input-id");
    expect(result.success).toBe(true);
    expect(result.artifactId).toBe("stored");
  });

  it("returns error when artifact is not found", async () => {
    const { handler } = await loadModule();

    const runStore = { getArtifactRecord: vi.fn(async () => null) };
    const result = await handler({ artifactId: "missing" }, makeContext(runStore));

    expect(result).toEqual({ success: false, error: "artifact not found: missing" });
    expect(runStore.getArtifactRecord).toHaveBeenCalledWith("missing");
  });

  it.each([
    ["Error instance", new Error("boom"), "boom"],
    ["string throw", "bad", "bad"],
  ])("returns error when getArtifactRecord throws (%s)", async (_label, thrown, msg) => {
    const { handler } = await loadModule();

    const runStore = {
      getArtifactRecord: vi.fn(async () => {
        throw thrown;
      }),
    };

    const result = await handler({ artifactId: "art" }, makeContext(runStore));

    expect(result).toEqual({ success: false, error: msg });
  });

  it("returns persisted metadata and raw string data (happy path)", async () => {
    const { handler } = await loadModule();

    const record = {
      artifactId: "a1",
      runId: "r1",
      type: "tool",
      mime: "text/plain",
      bytes: 123,
      sha256: "hash",
      data: "ok",
    };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "a1", maxChars: 50 },
      makeContext(runStore)
    );

    expect(result).toEqual({
      success: true,
      artifactId: "a1",
      runId: "r1",
      type: "tool",
      mime: "text/plain",
      bytes: 123,
      sha256: "hash",
      truncated: false,
      totalChars: 2,
      data: "ok",
    });
  });

  it.each([
    ["null", null, "", 0],
    ["undefined", undefined, "", 0],
    ["empty string", "", "", 0],
    ["empty array", [], "[]", 2],
    ["empty object", {}, "{}", 2],
  ])("converts %s data to text", async (_label, data, expectedText, expectedChars) => {
    const { handler } = await loadModule();

    const record = { artifactId: "d", data };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "d", maxChars: 50 },
      makeContext(runStore)
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(expectedChars);
    expect(result.data).toBe(expectedText);
  });

  it("serializes deep nested data without truncation (resource boundary)", async () => {
    const { handler } = await loadModule();

    const record = { artifactId: "deep", data: makeDeepObject(50) };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "deep", maxChars: 20_000 },
      makeContext(runStore)
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.data).toContain('"leaf": "end"');
  });

  it("falls back to String() when data is not JSON-serializable", async () => {
    const { handler } = await loadModule();

    const data = { toString: () => "circular" };
    data.self = data;

    const record = { artifactId: "circ", data };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "circ", maxChars: 50 },
      makeContext(runStore)
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe("circular".length);
    expect(result.data).toBe("circular");
  });

  it("handles function data (JSON.stringify returns undefined)", async () => {
    const { handler } = await loadModule();

    const record = { artifactId: "fn", data: () => "ignored" };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "fn", maxChars: 50 },
      makeContext(runStore)
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(0);
    expect(result.data).toBe("");
  });

  it("truncates large data with default maxChars (4000)", async () => {
    const { handler } = await loadModule();

    const large = "a".repeat(5000);
    const record = { artifactId: "big", data: large };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler({ artifactId: "big" }, makeContext(runStore));

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(large.length);
    expect(result.data).toBe(large.slice(0, 4000) + "\n...(truncated)");
  });

  it.each([
    ["maxChars numeric string", "10", 10, true],
    ["maxChars zero", 0, 0, false],
    ["maxChars empty string", "", 0, false],
    ["maxChars empty array", [], 0, false],
    ["maxChars negative", -1, -1, true],
    [
      "maxChars MAX_SAFE_INTEGER",
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      false,
    ],
  ])(
    "handles truncation boundaries (%s)",
    async (_label, maxChars, numericMaxChars, shouldTruncate) => {
      const { handler } = await loadModule();

      const large = "x".repeat(5000);
      const record = { artifactId: "t", data: large };
      const runStore = { getArtifactRecord: vi.fn(async () => record) };

      const result = await handler(
        { artifactId: "t", maxChars },
        makeContext(runStore)
      );

      expect(result.success).toBe(true);
      expect(result.truncated).toBe(shouldTruncate);
      expect(result.totalChars).toBe(large.length);

      if (!shouldTruncate) {
        expect(result.data).toBe(large);
        return;
      }

      const expectedSlice = large.slice(0, numericMaxChars);
      expect(result.data).toBe(expectedSlice + "\n...(truncated)");
    }
  );

  it.each([
    ["not-a-number", "not-a-number"],
    ["Infinity", Infinity],
    ["NaN", NaN],
    ["empty object", {}],
    ["object-like array", { length: 1 }],
  ])("falls back to default maxChars when maxChars is invalid (%s)", async (_label, maxChars) => {
    const { handler } = await loadModule();

    const large = "z".repeat(4500);
    const record = { artifactId: "badmax", data: large };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler(
      { artifactId: "badmax", maxChars },
      makeContext(runStore)
    );

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(large.length);
    expect(result.data).toBe(large.slice(0, 4000) + "\n...(truncated)");
  });

  it("handles very large data (resource boundary: very long string)", async () => {
    const { handler } = await loadModule();

    const large = "q".repeat(200_000);
    const record = { artifactId: "huge", data: large };
    const runStore = { getArtifactRecord: vi.fn(async () => record) };

    const result = await handler({ artifactId: "huge" }, makeContext(runStore));

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(large.length);
    expect(result.data).toBe(large.slice(0, 4000) + "\n...(truncated)");
  });

  it("supports concurrent calls (concurrency boundary)", async () => {
    const { handler } = await loadModule();

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
    const context = makeContext(runStore);

    const [resA, resB] = await Promise.all([
      handler({ artifactId: "a", maxChars: 10 }, context),
      handler({ artifactId: "b", maxChars: 10 }, context),
    ]);

    expect(resA).toMatchObject({ success: true, artifactId: "a", data: "alpha" });
    expect(resB).toMatchObject({ success: true, artifactId: "b", data: "beta" });
    expect(runStore.getArtifactRecord).toHaveBeenCalledTimes(2);
  });

  it("supports rapid sequential calls (concurrency boundary)", async () => {
    const { handler } = await loadModule();

    const runStore = {
      getArtifactRecord: vi
        .fn()
        .mockResolvedValueOnce({ artifactId: "seq", data: "first" })
        .mockResolvedValueOnce({ artifactId: "seq", data: "second" }),
    };
    const context = makeContext(runStore);

    const first = await handler({ artifactId: "seq", maxChars: 50 }, context);
    const second = await handler({ artifactId: "seq", maxChars: 50 }, context);

    expect(first).toMatchObject({ success: true, artifactId: "seq", data: "first" });
    expect(second).toMatchObject({
      success: true,
      artifactId: "seq",
      data: "second",
    });
    expect(runStore.getArtifactRecord).toHaveBeenCalledTimes(2);
  });
});

describe("default export", () => {
  it("exposes definition and handler", async () => {
    const mod = await loadModule();

    expect(mod.default).toEqual({ definition: mod.definition, handler: mod.handler });
  });
});
