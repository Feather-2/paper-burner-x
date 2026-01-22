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
  vi.resetModules();
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

describe("default export", () => {
  it("exports { definition, handler }", async () => {
    const mod = await import(handlerPath);
    expect(mod.default).toEqual({ definition: mod.definition, handler: mod.handler });
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
    // Resource boundary: many evidences should still render <= MAX_EVIDENCE_LINES in prompt.
    const evidence = Array.from({ length: 200 }, (_, i) => ({
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

  it("supports compatible source fields and deduplicates/filters blanks", async () => {
    const { handler } = await import(handlerPath);

    await handler(
      {
        factId: "fact-sources",
        contradiction: "c",
        sources: [" s1 ", "", "s1", null, "s2"],
      },
      createContext()
    );
    const firstCall = hoisted.taskHandler.mock.calls[0][0];
    expect(firstCall.sourceIds).toEqual(["s1", "s2"]);

    hoisted.taskHandler.mockClear();

    await handler(
      { factId: "fact-sourceId", contradiction: "c", sourceId: " single " },
      createContext()
    );
    const secondCall = hoisted.taskHandler.mock.calls[0][0];
    expect(secondCall.sourceIds).toEqual(["single"]);

    hoisted.taskHandler.mockClear();

    // sourceIds takes precedence over sources/sourceId (type boundary: mixed inputs)
    await handler(
      {
        factId: "fact-precedence",
        contradiction: "c",
        sourceIds: ["p1"],
        sources: ["ignored"],
        sourceId: "ignored2",
      },
      createContext()
    );
    const thirdCall = hoisted.taskHandler.mock.calls[0][0];
    expect(thirdCall.sourceIds).toEqual(["p1"]);
  });

  it("defaults to researcher subagent type and accepts subagentType alias", async () => {
    const { handler } = await import(handlerPath);

    await handler({ factId: "fact-default-type", contradiction: "c" }, createContext());
    expect(hoisted.taskHandler.mock.calls[0][0].subagent_type).toBe("researcher");

    hoisted.taskHandler.mockClear();

    await handler(
      { factId: "fact-alias-type", contradiction: "c", subagentType: "analyzer" },
      createContext()
    );
    expect(hoisted.taskHandler.mock.calls[0][0].subagent_type).toBe("analyzer");
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

  it("treats null async as sync and defaults invalid timeout types", async () => {
    const { handler } = await import(handlerPath);
    const report = "```json\n{\"status\":\"partial\"}\n```";

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-sync-null-async" });
    hoisted.waitForTask.mockResolvedValueOnce({ status: "completed", result: { report } });

    const result = await handler(
      { factId: "fact-null-async", contradiction: "c", async: null, timeout: { ms: 1 } },
      createContext()
    );

    expect(result.taskId).toBe("task-sync-null-async");
    expect(hoisted.waitForTask).toHaveBeenCalledWith("task-sync-null-async", 600000);
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

  it("returns blocked in sync mode when task status is timeout/failed regardless of verdict", async () => {
    const { handler } = await import(handlerPath);

    const report = "```json\n{\"status\":\"satisfied\",\"conclusion\":\"ok\",\"confidence\":1}\n```";
    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-timeout" });
    hoisted.waitForTask.mockResolvedValueOnce({ status: "timeout", result: { report } });

    const discoveryManager = createDiscoveryManager();
    const result = await handler(
      { factId: "fact-timeout", contradiction: "c", async: false },
      createContext({ discoveryManager })
    );

    expect(result.success).toBe(false);
    expect(result.discoveryStatus).toBe("blocked");
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "fact-timeout",
      expect.objectContaining({ status: "blocked" })
    );
  });

  it("falls back to partial when verdict JSON is missing/invalid (type boundary: findings array)", async () => {
    const { handler } = await import(handlerPath);

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-invalid-json" });
    hoisted.waitForTask.mockResolvedValueOnce({
      status: "completed",
      // findings as array should not throw; verdict should remain null.
      result: { findings: [{ a: 1 }, { b: 2 }] },
    });

    const result = await handler(
      { factId: "fact-invalid-json", contradiction: "c", async: false },
      createContext()
    );

    expect(result.success).toBe(true);
    expect(result.discoveryStatus).toBe("partial");
    expect(result.verification.verdict).toBeNull();
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

  it("floors numeric-string timeout values in sync mode", async () => {
    const { handler } = await import(handlerPath);

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-timeout-floor" });
    hoisted.waitForTask.mockResolvedValueOnce({
      status: "completed",
      result: { report: "```json\n{\"status\":\"partial\"}\n```" },
    });

    await handler(
      { factId: "fact-timeout-floor", contradiction: "c", async: false, timeout: "123.9" },
      createContext()
    );

    expect(hoisted.waitForTask).toHaveBeenCalledWith("task-timeout-floor", 123);
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

  it("treats missing taskId as start failure", async () => {
    const { handler } = await import(handlerPath);
    const discoveryManager = createDiscoveryManager();
    const emit = vi.fn();

    hoisted.taskHandler.mockResolvedValueOnce({ success: true });

    const result = await handler(
      { factId: "fact-no-taskid", contradiction: "c" },
      createContext({ discoveryManager, emit })
    );

    expect(result).toEqual({ success: false, error: "Failed to start verification task" });
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "fact-no-taskid",
      expect.objectContaining({ status: "blocked", reason: "Failed to start verification task" })
    );
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.verify.failed",
      expect.objectContaining({ factId: "fact-no-taskid" })
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

  it("can start multiple tasks for simultaneous calls when not yet marked running (concurrency boundary)", async () => {
    const { handler } = await import(handlerPath);
    const state = createScratchpadState();
    const context = createContext({ state });

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    let seq = 0;
    hoisted.taskHandler.mockImplementation(() =>
      gate.then(() => ({ success: true, taskId: `task-${++seq}` }))
    );

    const args = { factId: "fact-race", contradiction: "c" };
    const p1 = handler(args, context);
    const p2 = handler(args, context);

    // Both calls should proceed to start a task before state is marked running.
    expect(hoisted.taskHandler).toHaveBeenCalledTimes(2);

    release();

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r1.taskId).not.toBe(r2.taskId);

    const map = state._scratchpad.get("crossVerify");
    // Last writer wins (implementation detail), but entry must remain valid.
    expect(map["fact-race"]).toEqual(expect.objectContaining({ status: "running", taskId: r2.taskId }));
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

  it("finalizes immediately in async mode when task status is already completed (race fallback)", async () => {
    const { handler } = await import(handlerPath);
    const state = createScratchpadState();
    const discoveryManager = createDiscoveryManager();
    const emit = vi.fn();
    const sharedContext = createSharedContext({
      stored: {
        "task-fast": {
          status: "completed",
          result: {
            report: "```json\n{\"status\":\"contradicted\",\"conclusion\":\"Nope\",\"confidence\":0.6}\n```",
          },
        },
      },
    });

    hoisted.taskHandler.mockResolvedValueOnce({ success: true, taskId: "task-fast" });
    hoisted.getTaskStatus.mockReturnValue({ status: "completed" });

    const result = await handler(
      { factId: "fact-fast", contradiction: "c", async: true },
      createContext({ state, discoveryManager, emit, sharedContext })
    );

    expect(result.status).toBe("running");

    // Wait for microtask finalization.
    await Promise.resolve();
    await Promise.resolve();

    const map = state._scratchpad.get("crossVerify");
    expect(map["fact-fast"]).toEqual(expect.objectContaining({ status: "completed", discoveryStatus: "contradicted" }));
    expect(sharedContext.setSummary).toHaveBeenCalledWith("verification", expect.stringContaining("Nope"));
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.verify.completed",
      expect.objectContaining({ factId: "fact-fast", discoveryStatus: "contradicted", taskStatus: "completed" })
    );
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

  it("does not pollute Object.prototype for reserved factId (security boundary)", async () => {
    const { handler } = await import(handlerPath);

    await handler({ factId: "__proto__", contradiction: "c" }, createContext());

    // Ensure prototype is not polluted by defensive checks.
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
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

  it("uses discoveryManager evidences when sharedContext evidence is filtered out by requested sources", async () => {
    const { handler } = await import(handlerPath);
    const sharedContext = createSharedContext({
      evidence: [
        {
          id: "ev-ignore",
          factId: "fact-filter-fallback",
          detail: { sourceId: "other", snippet: "ignored" },
        },
      ],
    });
    const discoveryManager = createDiscoveryManager({
      getEvidences: vi.fn(() => [{ sourceId: "wanted", snippet: "used" }]),
    });

    await handler(
      { factId: "fact-filter-fallback", contradiction: "c", sourceIds: ["wanted"] },
      createContext({ sharedContext, discoveryManager })
    );

    const taskArgs = hoisted.taskHandler.mock.calls[0][0];
    expect(taskArgs.prompt).toContain("[wanted]");
    expect(taskArgs.prompt).toContain("used");
    expect(taskArgs.prompt).not.toContain("ignored");
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
