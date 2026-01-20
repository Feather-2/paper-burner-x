import { describe, it, expect, vi, beforeEach } from "vitest";

const handlerPath = "../../../../../../../js/agents/stages/deepsearch/tools/cross-verify/handler.js";

const hoisted = vi.hoisted(() => ({
  taskHandler: vi.fn(),
  getTaskStatus: vi.fn(),
  waitForTask: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/tools/task/handler.js", () => ({
  handler: hoisted.taskHandler,
  getTaskStatus: hoisted.getTaskStatus,
  waitForTask: hoisted.waitForTask,
}));

vi.mock("../../../../../../../js/agents/sdk/DiscoveryManager.js", () => ({
  DiscoveryStatus: {
    OPEN: "open",
    PARTIAL: "partial",
    SATISFIED: "satisfied",
    CONTRADICTED: "contradicted",
    VERIFYING: "verifying",
    BLOCKED: "blocked",
  },
}));

function createScratchpadState(initialMap) {
  const store = new Map();
  if (initialMap) store.set("crossVerify", initialMap);
  return {
    getScratchpad: vi.fn((key) => store.get(key)),
    setScratchpad: vi.fn((key, value) => store.set(key, value)),
    _scratchpad: store,
  };
}

function createDiscoveryManager(overrides = {}) {
  return {
    upsertDiscovery: vi.fn(),
    getEvidences: vi.fn(),
    ...overrides,
  };
}

function createSharedContext(options = {}) {
  const { evidence = [], stored = {}, overrides = {} } = options;
  const store = new Map(Object.entries(stored));
  const index = new Map();

  for (const item of evidence) {
    store.set(item.id, item.detail);
    const key = `evidence:${item.factId}`;
    const list = index.get(key) || [];
    list.push(item.id);
    index.set(key, list);
  }

  const context = {
    store: vi.fn((key, value) => store.set(key, value)),
    addToIndex: vi.fn((key, id) => {
      const list = index.get(key) || [];
      list.push(id);
      index.set(key, list);
    }),
    search: vi.fn((key) => index.get(key) || []),
    getDetail: vi.fn((key) => store.get(key)),
    signal: vi.fn(),
    setSummary: vi.fn(),
    _store: store,
    _index: index,
  };

  return { ...context, ...overrides };
}

function createContext(overrides = {}) {
  return {
    state: createScratchpadState(),
    emit: vi.fn(),
    discoveryManager: createDiscoveryManager(),
    stageApi: {},
    sharedContext: createSharedContext(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.taskHandler.mockResolvedValue({ success: true, taskId: "task_1" });
  hoisted.getTaskStatus.mockReturnValue({ status: "running" });
  hoisted.waitForTask.mockResolvedValue({
    status: "completed",
    result: { report: "```json\n{\"status\":\"partial\"}\n```" },
  });
});

describe("definition", () => {
  it("exposes metadata and parameters", async () => {
    const { definition } = await import(handlerPath);

    expect(definition).toEqual(
      expect.objectContaining({
        name: "cross-verify",
        priority: "important",
      })
    );
    expect(definition.parameters).toEqual(
      expect.objectContaining({
        factId: expect.any(String),
        contradiction: expect.any(String),
      })
    );
    expect(definition.activation?.keywords).toContain("cross-verify");
  });
});

describe("handler", () => {
  it("rejects missing factId/contradiction", async () => {
    const { handler } = await import(handlerPath);
    const context = createContext();

    const cases = [
      null,
      undefined,
      {},
      { factId: "", contradiction: "x" },
      { factId: " ", contradiction: "x" },
      { factId: "x", contradiction: "" },
      { factId: "x", contradiction: " " },
      { factId: null, contradiction: "x" },
      { factId: "x", contradiction: null },
    ];

    for (const args of cases) {
      const result = await handler(args, context);
      expect(result).toEqual({ success: false, error: "factId and contradiction are required" });
    }

    expect(hoisted.taskHandler).not.toHaveBeenCalled();
  });

  it("rejects forbidden factId values", async () => {
    const { handler } = await import(handlerPath);
    const context = createContext();

    const result = await handler({ factId: "__proto__", contradiction: "x" }, context);
    expect(result).toEqual({ success: false, error: "Invalid factId: reserved key" });
    expect(hoisted.taskHandler).not.toHaveBeenCalled();
  });

  it("starts async verification and stores running entry with filtered evidences", async () => {
    const { handler } = await import(handlerPath);
    const sharedContext = createSharedContext({
      evidence: [
        {
          id: "ev1",
          factId: "fact-1",
          detail: { sourceId: "source-a", snippet: "alpha", confidence: 0.7 },
        },
        {
          id: "ev2",
          factId: "fact-1",
          detail: { sourceId: "source-b", snippet: "beta" },
        },
      ],
    });
    const state = createScratchpadState();
    const discoveryManager = createDiscoveryManager();
    const emit = vi.fn();

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-123" });

    const result = await handler(
      {
        factId: "fact-1",
        contradiction: "A vs B",
        sourceIds: ["source-a"],
        subagent_type: "analyzer",
      },
      { state, emit, discoveryManager, stageApi: {}, sharedContext }
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        factId: "fact-1",
        taskId: "task-123",
        status: "running",
      })
    );

    const taskArgs = hoisted.taskHandler.mock.calls[0][0];
    expect(taskArgs.sourceIds).toEqual(["source-a"]);
    expect(taskArgs.subagent_type).toBe("analyzer");
    expect(taskArgs.prompt).toContain("factId: fact-1");
    expect(taskArgs.prompt).toContain("evidenceId=ev1");
    expect(taskArgs.prompt).not.toContain("ev2");

    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "fact-1",
      expect.objectContaining({ status: "verifying", reason: "A vs B" })
    );
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.verify.started",
      expect.objectContaining({ factId: "fact-1" })
    );

    const map = state._scratchpad.get("crossVerify");
    expect(map["fact-1"]).toEqual(expect.objectContaining({ status: "running", taskId: "task-123" }));
    expect(sharedContext.store).toHaveBeenCalledWith(
      "cross_verify:fact-1",
      expect.objectContaining({ status: "running" })
    );
  });

  it("infers sourceIds and limits evidence lines/snippet size", async () => {
    const { handler } = await import(handlerPath);
    const snippet = "a".repeat(500);
    const evidence = Array.from({ length: 15 }, (_, i) => ({
      id: `ev${i}`,
      factId: "fact-2",
      detail: { sourceId: i % 2 === 0 ? "s1" : "s2", snippet },
    }));
    const sharedContext = createSharedContext({ evidence });
    const context = createContext({ sharedContext, state: {} });

    const result = await handler(
      { factId: "fact-2", contradiction: "conflict", sourceIds: [] },
      context
    );

    expect(result.success).toBe(true);
    const taskArgs = hoisted.taskHandler.mock.calls[0][0];
    expect(taskArgs.sourceIds).toEqual(["s1", "s2"]);

    const lines = taskArgs.prompt.split("\n").filter((line) => line.startsWith("- ("));
    expect(lines).toHaveLength(12);
    const snippetText = lines[0].split(": ").slice(1).join(": ");
    expect(snippetText.length).toBeLessThanOrEqual(400);

    const map = context.state.L2.scratchpad.crossVerify;
    expect(map["fact-2"]).toEqual(expect.objectContaining({ status: "running" }));
  });

  it("truncates long inputs and sourceIds to safe limits", async () => {
    const { handler } = await import(handlerPath);
    const longFactId = "f".repeat(256) + "TAIL";
    const longContradiction = "c".repeat(2000) + "TAIL";
    const longSource = "s".repeat(260);
    const sourceIds = Array.from({ length: 55 }, (_, i) => `${String(i).padStart(4, "0")}${longSource}`);
    const context = createContext();

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-long" });

    const result = await handler(
      { factId: longFactId, contradiction: longContradiction, sourceIds },
      context
    );

    expect(result.success).toBe(true);
    const map = context.state._scratchpad.get("crossVerify");
    const truncatedFactId = longFactId.slice(0, 256);
    expect(map[truncatedFactId]).toBeDefined();
    expect(map[longFactId]).toBeUndefined();

    const taskArgs = hoisted.taskHandler.mock.calls[0][0];
    expect(taskArgs.sourceIds).toHaveLength(50);
    for (const id of taskArgs.sourceIds) {
      expect(id.length).toBeLessThanOrEqual(256);
    }
    expect(taskArgs.prompt).toContain(`factId: ${truncatedFactId}`);
    expect(taskArgs.prompt).not.toContain("TAIL");
  });

  it("normalizes non-array and deep nested sourceIds", async () => {
    const { handler } = await import(handlerPath);

    await handler(
      { factId: "fact-obj", contradiction: "c", sourceIds: { a: 1 } },
      createContext()
    );
    const firstCall = hoisted.taskHandler.mock.calls[0][0];
    expect(firstCall.sourceIds).toEqual(["[object Object]"]);

    hoisted.taskHandler.mockClear();

    await handler(
      { factId: "fact-nested", contradiction: "c", sourceIds: [[[["deep"]]]] },
      createContext()
    );
    const secondCall = hoisted.taskHandler.mock.calls[0][0];
    expect(secondCall.sourceIds).toEqual(["deep"]);
  });

  it("waits in sync mode and maps verdict to discovery status", async () => {
    const { handler } = await import(handlerPath);
    const report = `prefix
\`\`\`json
${JSON.stringify({
      status: "satisfied",
      conclusion: "Verified",
      confidence: 0.88,
      rationale: "ok",
      keyEvidence: [{ sourceId: "s1", evidenceId: "ev1" }],
      remainingUncertainty: "",
    })}
\`\`\`
`;
    const sharedContext = createSharedContext();
    const discoveryManager = createDiscoveryManager();

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-sync" });
    hoisted.waitForTask.mockResolvedValueOnce({ status: "completed", result: { report } });

    const result = await handler(
      { factId: "fact-sync", contradiction: "c", async: "false", timeout: "1234" },
      createContext({ sharedContext, discoveryManager })
    );

    expect(hoisted.waitForTask).toHaveBeenCalledWith("task-sync", 1234);
    expect(result.success).toBe(true);
    expect(result.discoveryStatus).toBe("satisfied");
    expect(result.verification.verdict.status).toBe("satisfied");
    expect(sharedContext.setSummary).toHaveBeenCalledWith(
      "verification",
      expect.stringContaining("Verified")
    );
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "fact-sync",
      expect.objectContaining({ status: "satisfied" })
    );
  });

  it("normalizes timeout boundaries", async () => {
    const { handler } = await import(handlerPath);
    const report = "```json\n{\"status\":\"partial\"}\n```";

    hoisted.waitForTask.mockResolvedValue({ status: "completed", result: { report } });

    const cases = [
      { timeout: 0, expected: 600000, factId: "fact-t0" },
      { timeout: -1, expected: 600000, factId: "fact-tneg" },
      { timeout: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER, factId: "fact-tmax" },
    ];

    for (const { timeout, expected, factId } of cases) {
      await handler(
        { factId, contradiction: "c", async: false, timeout },
        createContext()
      );
      const callIndex = hoisted.waitForTask.mock.calls.length - 1;
      expect(hoisted.waitForTask.mock.calls[callIndex][1]).toBe(expected);
    }
  });

  it("handles task start failure", async () => {
    const { handler } = await import(handlerPath);
    const discoveryManager = createDiscoveryManager();
    const emit = vi.fn();

    hoisted.taskHandler.mockResolvedValueOnce({ success: false, error: "boom" });

    const result = await handler(
      { factId: "fact-fail", contradiction: "c" },
      createContext({ discoveryManager, emit })
    );

    expect(result).toEqual({ success: false, error: "boom" });
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "fact-fail",
      expect.objectContaining({ status: "blocked", reason: "boom" })
    );
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.verify.failed",
      expect.objectContaining({ factId: "fact-fail", error: "boom" })
    );
  });

  it("returns running response for rapid consecutive calls", async () => {
    const { handler } = await import(handlerPath);
    const state = createScratchpadState({
      "fact-run": { status: "running", taskId: "task-running" },
    });
    const context = createContext({ state });
    const args = { factId: "fact-run", contradiction: "c" };

    const first = await handler(args, context);
    const second = await handler(args, context);

    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
    expect(hoisted.taskHandler).not.toHaveBeenCalled();
  });

  it("force bypasses existing running entry", async () => {
    const { handler } = await import(handlerPath);
    const state = createScratchpadState({
      "fact-force": { status: "running", taskId: "task-old" },
    });

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-new" });

    const result = await handler(
      { factId: "fact-force", contradiction: "c", force: true },
      createContext({ state })
    );

    expect(result.taskId).toBe("task-new");
    expect(hoisted.taskHandler).toHaveBeenCalledTimes(1);
  });

  it("marks failure when async task promise rejects", async () => {
    const { handler } = await import(handlerPath);
    const state = createScratchpadState();
    const discoveryManager = createDiscoveryManager();
    const emit = vi.fn();

    hoisted.getTaskStatus.mockReturnValue({
      status: "running",
      promise: Promise.reject(new Error("async fail")),
    });

    const result = await handler(
      { factId: "fact-err", contradiction: "c" },
      createContext({ state, discoveryManager, emit })
    );

    expect(result.success).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    const map = state._scratchpad.get("crossVerify");
    expect(map["fact-err"]).toEqual(expect.objectContaining({ status: "failed", error: "async fail" }));
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "fact-err",
      expect.objectContaining({ status: "blocked", reason: "async fail" })
    );
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.verify.failed",
      expect.objectContaining({ factId: "fact-err", error: "async fail" })
    );
  });

  it("falls back to discoveryManager evidences when sharedContext is empty", async () => {
    const { handler } = await import(handlerPath);
    const discoveryManager = createDiscoveryManager({
      getEvidences: vi.fn(() => [{ sourceId: "dm1", snippet: "dm-snippet" }]),
    });

    await handler(
      { factId: "fact-dm", contradiction: "c" },
      createContext({ discoveryManager })
    );

    const taskArgs = hoisted.taskHandler.mock.calls[0][0];
    expect(taskArgs.prompt).toContain("[dm1]");
    expect(taskArgs.prompt).toContain("dm-snippet");
  });

  it("returns running response for simultaneous calls when already running", async () => {
    const { handler } = await import(handlerPath);
    const state = createScratchpadState({
      "fact-concurrent": { status: "running", taskId: "task-running" },
    });
    const context = createContext({ state });
    const args = { factId: "fact-concurrent", contradiction: "c" };

    const [first, second] = await Promise.all([handler(args, context), handler(args, context)]);

    expect(first.taskId).toBe("task-running");
    expect(second.taskId).toBe("task-running");
    expect(hoisted.taskHandler).not.toHaveBeenCalled();
  });
});
