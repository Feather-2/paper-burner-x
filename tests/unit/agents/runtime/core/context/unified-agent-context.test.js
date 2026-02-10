import { describe, it, expect, vi, beforeEach } from "vitest";

const { warnSpy, toNonEmptyStringMock, deepCloneMock } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  toNonEmptyStringMock: vi.fn(),
  deepCloneMock: vi.fn(),
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: (value) => toNonEmptyStringMock(value),
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnSpy,
    error: vi.fn(),
  })),
}));

vi.mock("../../../../../../js/agents/shared/utils/value-utils.js", () => ({
  deepClone: (value) => deepCloneMock(value),
}));

import UnifiedAgentContextDefault, {
  UnifiedAgentContext,
} from "../../../../../../js/agents/runtime/core/context/unified-agent-context.js";

const buildLegacyMemory = (overrides = {}) => {
  const memory = {
    L0: { taskGoal: "", todos: [] },
    L1: {
      messages: [],
      decisions: [],
      signals: [],
      syncTable: { discoveries: new Map(), subagents: new Map() },
      scratchpad: {},
      flags: { awaitUserFeedback: false, taskImpossible: false },
    },
    L2: { historySummary: "", claims: [], stageSummaries: new Map() },
  };

  if (overrides.L0) Object.assign(memory.L0, overrides.L0);
  if (overrides.L1) Object.assign(memory.L1, overrides.L1);
  if (overrides.L2) Object.assign(memory.L2, overrides.L2);

  return { ...memory, ...overrides, L0: memory.L0, L1: memory.L1, L2: memory.L2 };
};

beforeEach(() => {
  warnSpy.mockReset();
  toNonEmptyStringMock.mockReset();
  deepCloneMock.mockReset();

  toNonEmptyStringMock.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });

  deepCloneMock.mockImplementation((value) => JSON.parse(JSON.stringify(value)));
});

describe("UnifiedAgentContext", () => {
  it("constructs with runId and eventBus, defaults runId when empty", () => {
    const eventBus = { emit: vi.fn() };
    const ctx = new UnifiedAgentContext({ runId: "run-1", eventBus });
    expect(ctx.runId).toBe("run-1");
    expect(ctx.eventBus).toBe(eventBus);

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
    const ctxEmpty = new UnifiedAgentContext({ runId: "   " });
    expect(ctxEmpty.runId).toBe("ctx_12345");
    expect(ctxEmpty.eventBus).toBeNull();

    const ctxNull = new UnifiedAgentContext({ runId: null });
    expect(ctxNull.runId).toBe("ctx_12345");

    const ctxUndefined = new UnifiedAgentContext({ runId: undefined });
    expect(ctxUndefined.runId).toBe("ctx_12345");

    const ctxZero = new UnifiedAgentContext({ runId: 0 });
    expect(ctxZero.runId).toBe("0");
    dateSpy.mockRestore();
  });

  it("binds dependencies and returns success", () => {
    const state = { bindMemoryStore: vi.fn() };
    const memory = { bind: vi.fn() };
    const sharedContext = { name: "shared" };
    const ctx = new UnifiedAgentContext();

    const result = ctx.bind({ state, memory, sharedContext });

    expect(result).toEqual({ success: true, errors: [] });
    expect(state.bindMemoryStore).toHaveBeenCalledWith(memory);
    expect(memory.bind).toHaveBeenCalledWith({ sharedContext });
    expect(ctx._state).toBe(state);
    expect(ctx._memory).toBe(memory);
    expect(ctx._sharedContext).toBe(sharedContext);
  });

  it("bind skips state.bindMemoryStore when memory is absent", () => {
    const state = { bindMemoryStore: vi.fn() };
    const ctx = new UnifiedAgentContext({ state });

    const result = ctx.bind({});

    expect(result).toEqual({ success: true, errors: [] });
    expect(state.bindMemoryStore).not.toHaveBeenCalled();
  });

  it("bind skips memory.bind when sharedContext is absent", () => {
    const state = { bindMemoryStore: vi.fn() };
    const memory = { bind: vi.fn() };
    const ctx = new UnifiedAgentContext({ state, memory });

    const result = ctx.bind({});

    expect(result).toEqual({ success: true, errors: [] });
    expect(state.bindMemoryStore).toHaveBeenCalledWith(memory);
    expect(memory.bind).not.toHaveBeenCalled();
  });

  it("bind captures errors and logs warnings", () => {
    const state = {
      bindMemoryStore: vi.fn(() => {
        throw new Error("state boom");
      }),
    };
    const memory = {
      bind: vi.fn(() => {
        throw new Error("memory boom");
      }),
    };
    const ctx = new UnifiedAgentContext();

    const result = ctx.bind({ state, memory, sharedContext: {} });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("state.bindMemoryStore failed");
    expect(result.errors[1]).toContain("memory.bind failed");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("taskGoal prefers memory and falls back to state for empty inputs", () => {
    const state = { taskGoal: "state-goal" };
    const memory = { L0: { taskGoal: "  mem  " } };
    const ctx = new UnifiedAgentContext({ state, memory });

    expect(ctx.taskGoal).toBe("mem");

    memory.L0.taskGoal = "   ";
    expect(ctx.taskGoal).toBe("state-goal");

    memory.L0.taskGoal = "";
    expect(ctx.taskGoal).toBe("state-goal");
  });

  it("taskGoal returns empty string when memory/state are nullish or whitespace, and does not write", () => {
    const state = { taskGoal: "   " };
    const memory = { L0: { taskGoal: null }, setTaskGoal: vi.fn() };
    const ctx = new UnifiedAgentContext({ state, memory });

    expect(ctx.taskGoal).toBe("");
    expect(memory.setTaskGoal).not.toHaveBeenCalled();
  });

  it("setTaskGoal normalizes input and writes to state and memory", () => {
    const state = {};
    const memory = { setTaskGoal: vi.fn() };
    const ctx = new UnifiedAgentContext({ state, memory });

    ctx.setTaskGoal("  goal ");
    expect(state.taskGoal).toBe("goal");
    expect(memory.setTaskGoal).toHaveBeenCalledWith("goal");

    ctx.setTaskGoal(0);
    expect(state.taskGoal).toBe("0");
    expect(memory.setTaskGoal).toHaveBeenLastCalledWith("0");

    ctx.setTaskGoal("   ");
    expect(state.taskGoal).toBe("");
    expect(memory.setTaskGoal).toHaveBeenLastCalledWith("");
  });

  it("todos returns memory array when present, even empty", () => {
    const memory = { L0: { todos: [] } };
    const state = { todos: [{ id: 1 }] };
    const ctx = new UnifiedAgentContext({ state, memory });

    expect(ctx.todos).toBe(memory.L0.todos);
    expect(ctx.todos).toEqual([]);
  });

  it("todos falls back to state when memory todos is not an array", () => {
    const memory = { L0: { todos: { not: "array" } } };
    const state = { todos: ["a"] };
    const ctx = new UnifiedAgentContext({ state, memory });

    expect(ctx.todos).toBe(state.todos);
  });

  it("todos returns empty array when both memory and state todos are invalid", () => {
    const memory = { L0: { todos: null } };
    const state = { todos: { not: "array" } };
    const ctx = new UnifiedAgentContext({ state, memory });

    expect(ctx.todos).toEqual([]);
  });

  it("addTodo prefers state implementation", () => {
    const state = { addTodo: vi.fn().mockReturnValue({ from: "state" }) };
    const memory = { addTodo: vi.fn().mockReturnValue({ from: "memory" }) };
    const ctx = new UnifiedAgentContext({ state, memory });

    const result = ctx.addTodo({ id: "t1" });

    expect(result).toEqual({ from: "state" });
    expect(state.addTodo).toHaveBeenCalledTimes(1);
    expect(memory.addTodo).not.toHaveBeenCalled();
  });

  it("addTodo falls back to memory and returns null when unavailable", () => {
    const memory = { addTodo: vi.fn().mockReturnValue({ from: "memory" }) };
    const ctxWithMemory = new UnifiedAgentContext({ memory });

    expect(ctxWithMemory.addTodo({ id: "t2" })).toEqual({ from: "memory" });
    expect(memory.addTodo).toHaveBeenCalledWith({ id: "t2" });

    const ctxNoStores = new UnifiedAgentContext();
    expect(ctxNoStores.addTodo({ id: "t3" })).toBeNull();
  });

  it("updateTodo avoids double updates when todos are shared", () => {
    const sharedTodos = [];
    const state = {
      todos: sharedTodos,
      updateTodo: vi.fn().mockReturnValue({ from: "state" }),
    };
    const memory = {
      L0: { todos: sharedTodos },
      updateTodo: vi.fn().mockReturnValue({ from: "memory" }),
    };
    const ctx = new UnifiedAgentContext({ state, memory });

    const result = ctx.updateTodo("id-1", { done: true });

    expect(result).toEqual({ from: "state" });
    expect(state.updateTodo).toHaveBeenCalledWith("id-1", { done: true });
    expect(memory.updateTodo).not.toHaveBeenCalled();
  });

  it("updateTodo returns state result when memory is missing", () => {
    const state = {
      todos: [],
      updateTodo: vi.fn().mockReturnValue({ from: "state" }),
    };
    const ctx = new UnifiedAgentContext({ state });

    const result = ctx.updateTodo("id-only-state", { done: true });

    expect(result).toEqual({ from: "state" });
    expect(state.updateTodo).toHaveBeenCalledWith("id-only-state", { done: true });
  });

  it("updateTodo uses memory when state lacks implementation even if todos are shared", () => {
    const sharedTodos = [];
    const state = { todos: sharedTodos };
    const memory = {
      L0: { todos: sharedTodos },
      updateTodo: vi.fn().mockReturnValue({ from: "memory" }),
    };
    const ctx = new UnifiedAgentContext({ state, memory });

    const result = ctx.updateTodo(0, "updates");

    expect(result).toEqual({ from: "memory" });
    expect(memory.updateTodo).toHaveBeenCalledWith(0, "updates");
  });

  it("updateTodo calls both when not shared and returns memory result", () => {
    const state = {
      todos: [],
      updateTodo: vi.fn().mockReturnValue({ from: "state" }),
    };
    const memory = {
      L0: { todos: [] },
      updateTodo: vi.fn().mockReturnValue({ from: "memory" }),
    };
    const ctx = new UnifiedAgentContext({ state, memory });

    const result = ctx.updateTodo("id-2", { done: false });

    expect(state.updateTodo).toHaveBeenCalledWith("id-2", { done: false });
    expect(memory.updateTodo).toHaveBeenCalledWith("id-2", { done: false });
    expect(result).toEqual({ from: "memory" });
  });

  it("updateTodo uses memory when state is missing", () => {
    const memory = {
      L0: { todos: [] },
      updateTodo: vi.fn().mockReturnValue({ from: "memory" }),
    };
    const ctx = new UnifiedAgentContext({ memory });

    const result = ctx.updateTodo("id-3", { done: true });

    expect(result).toEqual({ from: "memory" });
    expect(memory.updateTodo).toHaveBeenCalledTimes(1);
  });

  it("messages returns memory L1 messages or empty array", () => {
    const memory = { L1: { messages: [{ role: "user" }] } };
    const ctxWithMemory = new UnifiedAgentContext({ memory });
    const ctxNoMemory = new UnifiedAgentContext();

    expect(ctxWithMemory.messages).toEqual([{ role: "user" }]);
    expect(ctxNoMemory.messages).toEqual([]);
  });

  it("addMessage forwards nullish messages and is a no-op without memory", () => {
    const memory = { addMessage: vi.fn() };
    const ctx = new UnifiedAgentContext({ memory });

    ctx.addMessage(null);
    ctx.addMessage(undefined);

    expect(memory.addMessage).toHaveBeenCalledTimes(2);
    expect(memory.addMessage).toHaveBeenNthCalledWith(1, null);
    expect(memory.addMessage).toHaveBeenNthCalledWith(2, undefined);

    expect(() => new UnifiedAgentContext().addMessage({ id: 1 })).not.toThrow();
  });

  it("addMessage handles rapid consecutive calls", async () => {
    const memory = { addMessage: vi.fn() };
    const ctx = new UnifiedAgentContext({ memory });
    const messages = Array.from({ length: 10 }, (_, i) => ({ id: i }));

    await Promise.all(
      messages.map((msg) => Promise.resolve().then(() => ctx.addMessage(msg)))
    );

    expect(memory.addMessage).toHaveBeenCalledTimes(10);
  });

  it("claims prefers memory claims and falls back to state", () => {
    const state = { L1: { claims: ["state-claim"] } };
    const memory = { L2: { claims: [] } };
    const ctxMemory = new UnifiedAgentContext({ state, memory });
    expect(ctxMemory.claims).toBe(memory.L2.claims);

    const ctxStateOnly = new UnifiedAgentContext({ state });
    expect(ctxStateOnly.claims).toBe(state.L1.claims);
  });

  it("claims returns empty array when both sources are missing", () => {
    const ctx = new UnifiedAgentContext();
    expect(ctx.claims).toEqual([]);
  });

  it("addClaim warns on invalid input", () => {
    const ctx = new UnifiedAgentContext();

    ctx.addClaim(null);
    ctx.addClaim(123);

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("addClaim maps claim.content when text is missing", async () => {
    const memory = { addClaim: vi.fn() };
    const sharedContext = { addFinding: vi.fn() };
    const ctx = new UnifiedAgentContext({ memory, sharedContext });

    await ctx.addClaim({ content: "content-only", source: "source-b" });

    expect(memory.addClaim).toHaveBeenCalledWith({
      content: "content-only",
      source: "source-b",
      confidence: undefined,
      verified: undefined,
    });
    expect(sharedContext.addFinding).toHaveBeenCalledWith({
      type: "claim",
      content: "content-only",
      source: "source-b",
      confidence: undefined,
    });
  });

  it("addClaim records to state, memory, and sharedContext", async () => {
    const state = { addClaim: vi.fn() };
    const memory = { addClaim: vi.fn() };
    const sharedContext = { addFinding: vi.fn() };
    const ctx = new UnifiedAgentContext({ state, memory, sharedContext });

    const claim = {
      text: "hello",
      source: "source-a",
      confidence: 0.9,
      verified: true,
    };

    await ctx.addClaim(claim);

    expect(state.addClaim).toHaveBeenCalledWith(claim);
    expect(memory.addClaim).toHaveBeenCalledWith({
      content: "hello",
      source: "source-a",
      confidence: 0.9,
      verified: true,
    });
    expect(sharedContext.addFinding).toHaveBeenCalledWith({
      type: "claim",
      content: "hello",
      source: "source-a",
      confidence: 0.9,
    });
  });

  it("addClaim handles empty object and logs memory failures", async () => {
    const memory = {
      addClaim: vi.fn(() => {
        throw new Error("memory fail");
      }),
    };
    const sharedContext = { addFinding: vi.fn() };
    const ctx = new UnifiedAgentContext({ memory, sharedContext });

    await ctx.addClaim({});

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(sharedContext.addFinding).toHaveBeenCalledWith({
      type: "claim",
      content: "",
      source: undefined,
      confidence: undefined,
    });
  });

  it("signal and getSignals delegate to sharedContext", async () => {
    const sharedContext = {
      signal: vi.fn(),
      getSignals: vi.fn().mockReturnValue([{ id: "s1" }]),
    };
    const ctx = new UnifiedAgentContext({ sharedContext });

    await ctx.signal("phase", { ok: true });
    expect(sharedContext.signal).toHaveBeenCalledWith("phase", { ok: true });
    expect(ctx.getSignals({ type: "phase" })).toEqual([{ id: "s1" }]);
  });

  it("getSignals returns empty array when sharedContext is missing", () => {
    const ctx = new UnifiedAgentContext();
    expect(ctx.getSignals({ type: "none" })).toEqual([]);
  });

  it("recordDecision writes to memory and sharedContext", async () => {
    const memory = { recordDecision: vi.fn() };
    const sharedContext = { recordDecision: vi.fn() };
    const ctx = new UnifiedAgentContext({ memory, sharedContext });

    const decision = { id: "d1" };
    await ctx.recordDecision(decision);

    expect(memory.recordDecision).toHaveBeenCalledWith(decision);
    expect(sharedContext.recordDecision).toHaveBeenCalledWith(decision);
  });

  it("scratchpad accessors use memory and default to empty object", () => {
    const memory = {
      getScratchpad: vi.fn().mockReturnValue({ key: "value" }),
      setScratchpad: vi.fn(),
      clearScratchpad: vi.fn(),
    };
    const ctxWithMemory = new UnifiedAgentContext({ memory });
    const ctxNoMemory = new UnifiedAgentContext();

    expect(ctxWithMemory.scratchpad).toEqual({ key: "value" });
    expect(ctxNoMemory.scratchpad).toEqual({});

    ctxWithMemory.setScratchpad("k", "v");
    ctxWithMemory.clearScratchpad();
    expect(memory.setScratchpad).toHaveBeenCalledWith("k", "v");
    expect(memory.clearScratchpad).toHaveBeenCalledTimes(1);

    memory.getScratchpad.mockReturnValueOnce(null);
    expect(ctxWithMemory.scratchpad).toEqual({});
  });

  it("feedbackFlags uses memory getFlags or defaults", () => {
    const memory = { getFlags: vi.fn().mockReturnValue({ a: true }) };
    const ctxWithMemory = new UnifiedAgentContext({ memory });
    const ctxNoMemory = new UnifiedAgentContext();

    expect(ctxWithMemory.feedbackFlags).toEqual({ a: true });
    expect(ctxNoMemory.feedbackFlags).toEqual({
      awaitUserFeedback: false,
      taskImpossible: false,
    });

    const ctxNullFlags = new UnifiedAgentContext({ memory: { getFlags: vi.fn().mockReturnValue(null) } });
    expect(ctxNullFlags.feedbackFlags).toEqual({
      awaitUserFeedback: false,
      taskImpossible: false,
    });
  });

  it("setFeedbackFlag delegates to memory", () => {
    const memory = { setFlag: vi.fn() };
    const ctx = new UnifiedAgentContext({ memory });

    ctx.setFeedbackFlag("awaitUserFeedback", true);

    expect(memory.setFlag).toHaveBeenCalledWith("awaitUserFeedback", true);
  });

  it("awaitUserFeedback and taskImpossible getters/setters handle boundary values", () => {
    const memory = { awaitUserFeedback: false, taskImpossible: true };
    const ctx = new UnifiedAgentContext({ memory });

    expect(ctx.awaitUserFeedback).toBe(false);
    expect(ctx.taskImpossible).toBe(true);

    ctx.awaitUserFeedback = true;
    ctx.taskImpossible = 0;

    expect(memory.awaitUserFeedback).toBe(true);
    expect(memory.taskImpossible).toBe(0);
  });

  it("report getter/setter handles missing L1", () => {
    const state = {};
    const ctx = new UnifiedAgentContext({ state });

    expect(ctx.report).toBeNull();

    ctx.setReport({ summary: "ok" });

    expect(state.L1).toBeTruthy();
    expect(state.L1.report).toEqual({ summary: "ok" });
    expect(ctx.report).toEqual({ summary: "ok" });
  });

  it("iteration getter/setter supports boundary values", () => {
    const ctxNoState = new UnifiedAgentContext();
    expect(ctxNoState.iteration).toBe(0);

    const state = { iteration: 1 };
    const ctx = new UnifiedAgentContext({ state });

    expect(ctx.iteration).toBe(1);

    ctx.iteration = 0;
    expect(state.iteration).toBe(0);

    ctx.iteration = -1;
    expect(state.iteration).toBe(-1);

    ctx.iteration = Number.MAX_SAFE_INTEGER;
    expect(state.iteration).toBe(Number.MAX_SAFE_INTEGER);

    ctx.iteration = "3";
    expect(state.iteration).toBe("3");
  });

  it("saveCheckpoint uses raw state checkpoint when saveCheckpoint returns state directly", async () => {
    let savedArgs;
    const state = {
      saveCheckpoint: vi.fn((args) => {
        savedArgs = args;
        return { ok: true };
      }),
    };
    const ctx = new UnifiedAgentContext({ runId: "run-raw", state });

    const checkpoint = await ctx.saveCheckpoint({ strategy: "raw" });

    expect(state.saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(Number.isNaN(Date.parse(savedArgs.timestamp))).toBe(false);
    expect(savedArgs.strategy).toBe("raw");
    expect(savedArgs.record).toBe(false);
    expect(checkpoint.runId).toBe("run-raw");
    expect(checkpoint.state).toEqual({ ok: true });
    expect(checkpoint.memory).toBeNull();
  });

  it("saveCheckpoint falls back to state.toSnapshot when stateSnapshot is null", async () => {
    const state = {
      saveCheckpoint: vi.fn(() => ({ stateSnapshot: null })),
      toSnapshot: vi.fn().mockReturnValue({ snap: true }),
    };
    const ctx = new UnifiedAgentContext({ state });

    const checkpoint = await ctx.saveCheckpoint();

    expect(state.saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(state.toSnapshot).toHaveBeenCalledWith({ includeCheckpoints: false });
    expect(checkpoint.state).toEqual({ snap: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("saveCheckpoint uses state.saveCheckpoint and memory.toSnapshot", async () => {
    let savedArgs;
    const state = {
      saveCheckpoint: vi.fn((args) => {
        savedArgs = args;
        return { stateSnapshot: { ok: true } };
      }),
    };
    const memory = {
      toSnapshot: vi.fn().mockReturnValue({ mem: true }),
      archiveAdapter: { save: vi.fn() },
    };
    const sharedContext = { serialize: vi.fn().mockReturnValue({ shared: true }) };
    const ctx = new UnifiedAgentContext({ runId: "run-ctx", state, memory, sharedContext });

    const checkpoint = await ctx.saveCheckpoint({
      includeMemoryL3: true,
      incremental: true,
      stateStrategy: "fast",
    });

    expect(state.saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(Number.isNaN(Date.parse(savedArgs.timestamp))).toBe(false);
    expect(savedArgs.strategy).toBe("fast");
    expect(savedArgs.record).toBe(false);
    expect(checkpoint.state).toEqual({ ok: true });
    expect(memory.toSnapshot).toHaveBeenCalledWith({
      includeL3: true,
      incremental: true,
    });
    expect(checkpoint.memory).toEqual({ mem: true });
    expect(checkpoint.sharedContext).toEqual({ shared: true });
    expect(memory.archiveAdapter.save).toHaveBeenCalledWith("run-ctx", checkpoint);
  });

  it("saveCheckpoint falls back to state and legacy memory snapshot on errors", async () => {
    const largeText = "x".repeat(1024 * 1024);
    const deepNested = {};
    let cursor = deepNested;
    for (let i = 0; i < 32; i += 1) {
      cursor.child = { index: i };
      cursor = cursor.child;
    }
    const scratchpadNested = { layer1: { layer2: { layer3: { layer4: "deep" } } } };

    const state = {
      name: "state",
      saveCheckpoint: vi.fn(() => {
        throw new Error("save fail");
      }),
      toSnapshot: vi.fn(() => {
        throw new Error("snapshot fail");
      }),
    };

    const memory = buildLegacyMemory({
      L0: { fileContent: largeText, nested: deepNested, todos: [] },
      L1: {
        messages: [{ id: 1 }],
        decisions: [{ id: "d" }],
        signals: [{ id: "s" }],
        scratchpad: scratchpadNested,
      },
      L2: { claims: [{ id: "c" }] },
    });
    memory.L1.syncTable.discoveries.set("disc-1", { id: 1 });
    memory.L1.syncTable.subagents.set("sub-1", { id: 2 });
    memory.L2.stageSummaries.set("stage-1", { summary: "ok" });

    const ctx = new UnifiedAgentContext({ runId: "run-legacy", state, memory });
    const checkpoint = await ctx.saveCheckpoint();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(checkpoint.state).toBe(state);
    expect(deepCloneMock).toHaveBeenCalledWith(memory.L0);
    expect(deepCloneMock).toHaveBeenCalledWith(memory.L1.scratchpad);
    expect(checkpoint.memory.L0.fileContent).toBe(largeText);
    expect(checkpoint.memory.L0.nested).toEqual(deepNested);
    expect(checkpoint.memory.L0).not.toBe(memory.L0);
    expect(checkpoint.memory.L1.messages).not.toBe(memory.L1.messages);
    expect(checkpoint.memory.L1.decisions).not.toBe(memory.L1.decisions);
    expect(checkpoint.memory.L1.signals).not.toBe(memory.L1.signals);
    expect(checkpoint.memory.L1.syncTable).toEqual({
      discoveries: [["disc-1", { id: 1 }]],
      subagents: [["sub-1", { id: 2 }]],
    });
    expect(checkpoint.memory.L1.scratchpad).toEqual(scratchpadNested);
    expect(checkpoint.memory.L1.scratchpad).not.toBe(memory.L1.scratchpad);
    expect(checkpoint.memory.L2.stageSummaries).toEqual([["stage-1", { summary: "ok" }]]);
  });

  it("restoreCheckpoint returns false on nullish input", async () => {
    const ctx = new UnifiedAgentContext();
    expect(await ctx.restoreCheckpoint(null)).toBe(false);
    expect(await ctx.restoreCheckpoint(undefined)).toBe(false);
  });

  it("restoreCheckpoint delegates to state, memory, and sharedContext", async () => {
    const state = { fromSnapshot: vi.fn() };
    const memory = { fromSnapshot: vi.fn() };
    const sharedContext = { deserialize: vi.fn() };
    const ctx = new UnifiedAgentContext({ state, memory, sharedContext });

    const checkpoint = {
      state: { s: 1 },
      memory: { m: 1 },
      sharedContext: { sc: 1 },
    };

    const result = await ctx.restoreCheckpoint(checkpoint);

    expect(result).toBe(true);
    expect(state.fromSnapshot).toHaveBeenCalledWith({ s: 1 });
    expect(memory.fromSnapshot).toHaveBeenCalledWith({ m: 1 });
    expect(sharedContext.deserialize).toHaveBeenCalledWith({ sc: 1 });
  });

  it("restoreCheckpoint tolerates missing memory.fromSnapshot", async () => {
    const state = { fromSnapshot: vi.fn() };
    const memory = {};
    const sharedContext = { deserialize: vi.fn() };
    const ctx = new UnifiedAgentContext({ state, memory, sharedContext });

    const checkpoint = {
      state: { s: 1 },
      memory: { m: 1 },
      sharedContext: { sc: 1 },
    };

    const result = await ctx.restoreCheckpoint(checkpoint);

    expect(result).toBe(true);
    expect(state.fromSnapshot).toHaveBeenCalledWith({ s: 1 });
    expect(sharedContext.deserialize).toHaveBeenCalledWith({ sc: 1 });
  });

  it("getContextStatus returns counts and merges memory status", () => {
    const state = { iteration: 7 };
    const memory = buildLegacyMemory({
      L0: { todos: [{ id: 1 }, { id: 2 }] },
      L1: { messages: [{ id: 1 }] },
      L2: { claims: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] },
    });
    memory.getContextStatus = vi.fn().mockReturnValue({ extra: "ok" });

    const ctx = new UnifiedAgentContext({ runId: "run-ctx", state, memory });
    const status = ctx.getContextStatus();

    expect(status).toEqual({
      runId: "run-ctx",
      iteration: 7,
      todoCount: 2,
      claimCount: 3,
      messageCount: 1,
      extra: "ok",
    });
  });

  it("serialize returns a stable snapshot of key fields", () => {
    const state = { iteration: 2, L1: { report: { summary: "done" } } };
    const memory = buildLegacyMemory({
      L0: { taskGoal: "goal", todos: [{ id: "t" }] },
      L2: { claims: [{ id: "c" }] },
    });
    const ctx = new UnifiedAgentContext({ runId: "run-serialize", state, memory });

    expect(ctx.serialize()).toEqual({
      runId: "run-serialize",
      taskGoal: "goal",
      iteration: 2,
      todos: [{ id: "t" }],
      claims: [{ id: "c" }],
      report: { summary: "done" },
    });
  });
});

describe("default export", () => {
  it("matches the named export", () => {
    expect(UnifiedAgentContextDefault).toBe(UnifiedAgentContext);
  });
});
