import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedCompressor = vi.hoisted(() => {
  const buildHandoff = vi.fn();
  const instances = [];

  class CicadaCompressor {
    constructor(options) {
      this.options = options;
      this.buildHandoff = buildHandoff;
      instances.push(this);
    }
  }

  return { CicadaCompressor, buildHandoff, instances };
});

const mockedTodoUtils = vi.hoisted(() => ({
  createTodo: vi.fn(),
  validateTodo: vi.fn(),
}));

const mockedStates = vi.hoisted(() => ({
  TodoStatus: {
    OPEN: "open",
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  },
}));

vi.mock("../../../../../../../js/agents/plugins/compression/index.js", () => ({
  CicadaCompressor: mockedCompressor.CicadaCompressor,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", () => ({
  createTodo: mockedTodoUtils.createTodo,
  validateTodo: mockedTodoUtils.validateTodo,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/states.js", () => ({
  TodoStatus: mockedStates.TodoStatus,
}));

let definition;
let handler;
let defaultExport;

const LONG_TEXT = "x".repeat(10000);

function makeDeepTodo(depth) {
  const root = { text: "deep-task", status: mockedStates.TodoStatus.OPEN };
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = { level: i };
    cursor = cursor.child;
  }
  return root;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  mockedCompressor.instances.length = 0;
  mockedCompressor.buildHandoff.mockReset();
  mockedCompressor.buildHandoff.mockImplementation(() => "handoff-doc");

  mockedTodoUtils.createTodo.mockReset();
  mockedTodoUtils.validateTodo.mockReset();

  mockedTodoUtils.createTodo.mockImplementation((todo) => {
    const text = typeof todo?.text === "string" ? todo.text : "";
    const status = todo?.status ?? mockedStates.TodoStatus.OPEN;
    return { text, status };
  });

  mockedTodoUtils.validateTodo.mockImplementation((todo) => ({
    valid: Boolean(todo && typeof todo.text === "string" && todo.text.trim()),
  }));

  ({ definition, handler, default: defaultExport } = await import(
    "../../../../../../../js/agents/stages/deepsearch/tools/watchdog/handler.js"
  ));
});

describe("definition", () => {
  it("exposes watchdog metadata and activation", () => {
    expect(definition).toMatchObject({
      name: "watchdog",
      layer: 0,
    });
    expect(definition.activation).toEqual(
      expect.objectContaining({
        keywords: expect.any(Array),
        phases: expect.any(Array),
      })
    );
    expect(definition.activation.keywords).toContain("stuck");
    expect(definition.activation.phases).toContain("writing");
  });
});

describe("handler", () => {
  it("returns handoff response and emits event", async () => {
    const emit = vi.fn();
    const recordDecision = vi.fn();
    const sharedContext = { recordDecision };
    const state = { iteration: 1 };

    const res = await handler(
      { mode: "handoff", reason: "need help" },
      { state, emit, sharedContext, stageApi: {} }
    );

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("watchdog.invoked", { mode: "handoff", reason: "need help" });
    expect(mockedCompressor.instances.length).toBe(1);
    expect(mockedCompressor.instances[0].options).toEqual({});
    expect(mockedCompressor.buildHandoff).toHaveBeenCalledWith(state, sharedContext);
    expect(recordDecision).not.toHaveBeenCalled();

    expect(res).toEqual({
      success: true,
      mode: "handoff",
      handoff: "handoff-doc",
      reason: "need help",
      message: "已生成交接文档，可以清空上下文重新开始",
    });
  });

  it("uses default reason and preserves large handoff payload", async () => {
    const largePayload = "H".repeat(20000);
    mockedCompressor.buildHandoff.mockImplementation(() => largePayload);

    const res = await handler(
      { mode: "handoff", reason: "" },
      { state: {}, emit: vi.fn(), sharedContext: {} }
    );

    expect(res.reason).toBe("stuck_or_wrong");
    expect(res.handoff).toBe(largePayload);
    expect(res.handoff.length).toBe(largePayload.length);
  });

  it("builds think prompt with summary, decisions, and filtered todos", async () => {
    const decisions = [
      { action: "a1", reason: "r1" },
      { action: "a2" },
      { action: "a3", reason: "r3" },
      { action: "a4", reason: "r4" },
    ];
    const sharedContext = {
      buildSummaryText: vi.fn(() => "summary-text"),
      getDecisions: vi.fn(() => decisions),
      recordDecision: vi.fn(),
    };
    const state = {
      iteration: 7,
      todos: [
        { text: "todo1", status: mockedStates.TodoStatus.OPEN },
        { text: "todo2", status: mockedStates.TodoStatus.COMPLETED },
        { text: "todo3", status: mockedStates.TodoStatus.CANCELLED },
        { text: "todo4", status: mockedStates.TodoStatus.IN_PROGRESS },
        { text: "todo5", status: mockedStates.TodoStatus.PENDING },
        { text: "   ", status: mockedStates.TodoStatus.OPEN },
        { text: "todo6", status: mockedStates.TodoStatus.OPEN },
        { text: "todo7", status: mockedStates.TodoStatus.OPEN },
        { text: "todo8", status: mockedStates.TodoStatus.OPEN },
        { text: "todo9", status: mockedStates.TodoStatus.OPEN },
      ],
    };

    const res = await handler(
      { mode: "think", reason: "uncertain", question: "Next step?" },
      { state, emit: vi.fn(), sharedContext, stageApi: {} }
    );

    expect(res.success).toBe(true);
    expect(res.mode).toBe("think");
    expect(res.message).toBe("请基于以下提示进行深度思考");
    expect(sharedContext.recordDecision).toHaveBeenCalledWith({
      action: "watchdog_think",
      reason: "uncertain",
      question: "Next step?",
      iteration: 7,
    });

    const prompt = res.thinkPrompt;
    expect(prompt).toContain("## 深度思考");
    expect(prompt).toContain("触发原因: uncertain");
    expect(prompt).toContain("核心问题: Next step?");
    expect(prompt).toContain("### 已知信息\nsummary-text");
    expect(prompt).toContain("### 最近决策");
    expect(prompt).toContain("- a2: ");
    expect(prompt).toContain("- a3: r3");
    expect(prompt).toContain("- a4: r4");
    expect(prompt).not.toContain("- a1: r1");

    expect(prompt).toContain("### 待完成");
    expect(prompt).toContain("- todo1");
    expect(prompt).toContain("- todo4");
    expect(prompt).toContain("- todo5");
    expect(prompt).toContain("- todo6");
    expect(prompt).toContain("- todo7");
    expect(prompt).not.toContain("- todo2");
    expect(prompt).not.toContain("- todo3");
    expect(prompt).not.toContain("- todo8");
    expect(prompt).not.toContain("- todo9");
    expect(prompt).toContain("### 请思考");

    expect(mockedTodoUtils.createTodo).toHaveBeenCalledTimes(state.todos.length);
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledTimes(state.todos.length);
  });

  it("handles nullish inputs and non-array/empty todos gracefully", async () => {
    const res = await handler(
      { mode: "unknown", reason: null, question: undefined },
      { state: { todos: { 0: { text: "x" } } }, sharedContext: {}, emit: null }
    );

    expect(res.mode).toBe("think");
    expect(res.thinkPrompt).toContain("## 深度思考");
    expect(res.thinkPrompt).toContain("### 请思考");
    expect(res.thinkPrompt).not.toContain("触发原因");
    expect(res.thinkPrompt).not.toContain("核心问题");
    expect(res.thinkPrompt).not.toContain("### 已知信息");
    expect(res.thinkPrompt).not.toContain("### 最近决策");
    expect(res.thinkPrompt).not.toContain("### 待完成");
    expect(mockedTodoUtils.createTodo).not.toHaveBeenCalled();
    expect(mockedTodoUtils.validateTodo).not.toHaveBeenCalled();

    mockedTodoUtils.createTodo.mockClear();
    mockedTodoUtils.validateTodo.mockClear();

    const res2 = await handler({}, { state: { todos: [] }, sharedContext: {}, emit: undefined });

    expect(res2.mode).toBe("think");
    expect(res2.thinkPrompt).not.toContain("### 待完成");
    expect(mockedTodoUtils.createTodo).not.toHaveBeenCalled();
    expect(mockedTodoUtils.validateTodo).not.toHaveBeenCalled();
  });

  it("records boundary iteration values including string values", async () => {
    const recordDecision = vi.fn();
    const sharedContext = { recordDecision };
    const iterations = [0, -1, Number.MAX_SAFE_INTEGER, "5"];

    for (const iteration of iterations) {
      await handler({}, { state: { iteration, todos: [] }, sharedContext, emit: undefined });
    }

    expect(recordDecision).toHaveBeenCalledTimes(iterations.length);
    expect(recordDecision.mock.calls.map((call) => call[0].iteration)).toEqual(iterations);
  });

  it("includes whitespace reason and question when provided", async () => {
    const recordDecision = vi.fn();

    const res = await handler(
      { reason: "   ", question: "  " },
      { state: { iteration: 1, todos: [] }, sharedContext: { recordDecision }, emit: undefined }
    );

    expect(res.thinkPrompt).toContain("触发原因:    ");
    expect(res.thinkPrompt).toContain("核心问题:   ");
    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "   ", question: "  ", iteration: 1 })
    );
  });

  it("handles long strings and deep nested todos", async () => {
    const deepTodo = makeDeepTodo(200);
    const sharedContext = {
      buildSummaryText: vi.fn(() => LONG_TEXT),
      getDecisions: vi.fn(() => []),
      recordDecision: vi.fn(),
    };
    const state = { iteration: 2, todos: [deepTodo] };

    const res = await handler(
      { reason: LONG_TEXT, question: LONG_TEXT },
      { state, sharedContext, emit: vi.fn() }
    );

    expect(res.thinkPrompt).toContain(LONG_TEXT);
    expect(res.thinkPrompt).toContain("- deep-task");
    expect(mockedTodoUtils.createTodo).toHaveBeenCalledWith(deepTodo);
  });

  it("supports concurrent invocations without cross-talk", async () => {
    mockedCompressor.buildHandoff.mockImplementation((state) => `handoff-${state?.id}`);

    const emitA = vi.fn();
    const emitB = vi.fn();
    const emitC = vi.fn();
    const recordDecision = vi.fn();

    const [resA, resB, resC] = await Promise.all([
      handler({ mode: "handoff", reason: "a" }, { state: { id: 1 }, sharedContext: {}, emit: emitA }),
      handler({ mode: "handoff", reason: "b" }, { state: { id: 2 }, sharedContext: {}, emit: emitB }),
      handler(
        { mode: "think", reason: "c" },
        { state: { iteration: 3, todos: [] }, sharedContext: { recordDecision }, emit: emitC }
      ),
    ]);

    expect(resA.handoff).toBe("handoff-1");
    expect(resB.handoff).toBe("handoff-2");
    expect(resC.mode).toBe("think");
    expect(recordDecision).toHaveBeenCalledTimes(1);

    expect(emitA).toHaveBeenCalledWith("watchdog.invoked", { mode: "handoff", reason: "a" });
    expect(emitB).toHaveBeenCalledWith("watchdog.invoked", { mode: "handoff", reason: "b" });
    expect(emitC).toHaveBeenCalledWith("watchdog.invoked", { mode: "think", reason: "c" });
  });

  it("supports rapid sequential invocations", async () => {
    const emit = vi.fn();
    const recordDecision = vi.fn();
    const context = { state: { iteration: 1, todos: [] }, sharedContext: { recordDecision }, emit };

    await handler({ mode: "think" }, context);
    await handler({ mode: "think", reason: "second" }, context);

    expect(emit).toHaveBeenCalledTimes(2);
    expect(recordDecision).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1]).toEqual({ mode: "think", reason: "second" });
  });

  it("propagates compressor errors in handoff mode", async () => {
    mockedCompressor.buildHandoff.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(
      handler({ mode: "handoff" }, { state: {}, sharedContext: {}, emit: vi.fn() })
    ).rejects.toThrow("boom");
  });
});

describe("default export", () => {
  it("exposes definition and handler", () => {
    expect(defaultExport.definition).toBe(definition);
    expect(defaultExport.handler).toBe(handler);
    expect(defaultExport).toEqual({ definition, handler });
  });
});
