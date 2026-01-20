import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const modulePath = "../../../../../../../js/agents/stages/deepsearch/tools/ask-user/handler.js";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "uuid-1"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const makeStageApi = (overrides = {}) => ({
  waitForUserInput: vi.fn().mockResolvedValue("ok"),
  ...overrides,
});

const buildNestedContext = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  node.leaf = "done";
  return root;
};

describe("definition", () => {
  it("exposes expected metadata", async () => {
    const { definition } = await import(modulePath);

    expect(definition.name).toBe("ask-user");
    expect(definition.layer).toBe(0);
    expect(definition.description).toEqual(expect.any(String));
    expect(definition.activation.keywords).toEqual(
      expect.arrayContaining(["ask", "clarify", "confirm"])
    );
    expect(definition.activation.phases).toEqual([
      "researching",
      "analyzing",
      "planning",
    ]);
  });
});

describe("handler", () => {
  it("returns error when question is missing or invalid", async () => {
    const { handler } = await import(modulePath);

    const cases = [
      { args: {}, label: "empty args object" },
      { args: { question: null }, label: "null question" },
      { args: { question: undefined }, label: "undefined question" },
      { args: { question: "" }, label: "empty string question" },
      { args: { question: 0 }, label: "zero question" },
      { args: { question: -1 }, label: "negative question" },
      { args: { question: Number.MAX_SAFE_INTEGER }, label: "max safe integer" },
    ];

    for (const { args } of cases) {
      const emit = vi.fn();
      const waitForUserInput = vi.fn();
      const result = await handler(args, {
        emit,
        stageApi: { waitForUserInput },
      });

      expect(result).toEqual({ success: false, error: "question is required" });
      expect(waitForUserInput).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    }
  });

  it("returns error when interactive mode is unavailable", async () => {
    const { handler } = await import(modulePath);

    const cases = [
      { stageApi: undefined, label: "missing stageApi" },
      { stageApi: null, label: "null stageApi" },
      { stageApi: {}, label: "missing method" },
      { stageApi: { waitForUserInput: "nope" }, label: "non-function" },
    ];

    for (const { stageApi } of cases) {
      const emit = vi.fn();
      const result = await handler({ question: "ready" }, { emit, stageApi });

      expect(result).toEqual({
        success: false,
        error: "Interactive mode not available. Running in batch mode.",
        question: "ready",
      });
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith("deepsearch.user.input.skipped", {
        question: "ready",
        reason: "no interactive mode",
      });
    }
  });

  it("emits required and received events on success", async () => {
    const { handler } = await import(modulePath);

    const question = "123";
    const options = ["yes", "no"];
    const questionContext = "context";
    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockResolvedValue("yes"),
    });

    const result = await handler(
      { question, options, context: questionContext },
      { emit, stageApi }
    );

    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options });
    expect(emit.mock.calls[0]).toEqual([
      "deepsearch.user.input.required",
      { question, options, context: questionContext },
    ]);
    expect(emit.mock.calls[1]).toEqual([
      "deepsearch.user.input.received",
      { question, answer: "yes" },
    ]);
    expect(result).toEqual({
      success: true,
      question,
      answer: "yes",
      hasOptions: true,
    });
  });

  it("handles empty options array and empty context object", async () => {
    const { handler } = await import(modulePath);

    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockResolvedValue("ok"),
    });
    const options = [];
    const questionContext = {};

    const result = await handler(
      { question: "ready", options, context: questionContext },
      { emit, stageApi }
    );

    expect(result).toEqual({
      success: true,
      question: "ready",
      answer: "ok",
      hasOptions: false,
    });
    expect(emit.mock.calls[0]).toEqual([
      "deepsearch.user.input.required",
      { question: "ready", options, context: questionContext },
    ]);
    expect(emit.mock.calls[1]).toEqual([
      "deepsearch.user.input.received",
      { question: "ready", answer: "ok" },
    ]);
  });

  it("accepts whitespace question and object options", async () => {
    const { handler } = await import(modulePath);

    const question = "   ";
    const options = { length: 1, 0: "choice" };
    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockResolvedValue("choice"),
    });

    const result = await handler({ question, options }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options });
    expect(emit.mock.calls[0]).toEqual([
      "deepsearch.user.input.required",
      { question, options, context: null },
    ]);
    expect(result).toEqual({
      success: true,
      question,
      answer: "choice",
      hasOptions: true,
    });
  });

  it("returns error when waitForUserInput rejects with Error", async () => {
    const { handler } = await import(modulePath);

    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const result = await handler({ question: "fail" }, { emit, stageApi });

    expect(result).toEqual({ success: false, error: "boom", question: "fail" });
    expect(emit.mock.calls[0]).toEqual([
      "deepsearch.user.input.required",
      { question: "fail", options: null, context: null },
    ]);
    expect(emit.mock.calls[1]).toEqual([
      "deepsearch.user.input.failed",
      { question: "fail", error: "boom" },
    ]);
  });

  it("returns error when waitForUserInput rejects with non-Error", async () => {
    const { handler } = await import(modulePath);

    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockRejectedValue("fail"),
    });

    const result = await handler({ question: "fail" }, { emit, stageApi });

    expect(result).toEqual({ success: false, error: "fail", question: "fail" });
    expect(emit.mock.calls[1]).toEqual([
      "deepsearch.user.input.failed",
      { question: "fail", error: "fail" },
    ]);
  });

  it("supports concurrent calls", async () => {
    const { handler } = await import(modulePath);

    randomUUID.mockReturnValueOnce("uuid-a").mockReturnValueOnce("uuid-b");
    const questionA = randomUUID();
    const questionB = randomUUID();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockImplementation(({ question }) =>
        Promise.resolve(`answer:${question}`)
      ),
    });

    const emitA = vi.fn();
    const emitB = vi.fn();

    const [resultA, resultB] = await Promise.all([
      handler({ question: questionA }, { emit: emitA, stageApi }),
      handler({ question: questionB }, { emit: emitB, stageApi }),
    ]);

    expect(stageApi.waitForUserInput).toHaveBeenCalledTimes(2);
    expect(resultA).toEqual({
      success: true,
      question: questionA,
      answer: `answer:${questionA}`,
      hasOptions: false,
    });
    expect(resultB).toEqual({
      success: true,
      question: questionB,
      answer: `answer:${questionB}`,
      hasOptions: false,
    });
    expect(emitA.mock.calls[0]).toEqual([
      "deepsearch.user.input.required",
      { question: questionA, options: null, context: null },
    ]);
    expect(emitB.mock.calls[0]).toEqual([
      "deepsearch.user.input.required",
      { question: questionB, options: null, context: null },
    ]);
  });

  it("supports rapid consecutive calls", async () => {
    const { handler } = await import(modulePath);

    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi
        .fn()
        .mockResolvedValueOnce("first")
        .mockResolvedValueOnce("second"),
    });

    const first = await handler({ question: "q1" }, { emit, stageApi });
    const second = await handler({ question: "q2" }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledTimes(2);
    expect(first.answer).toBe("first");
    expect(second.answer).toBe("second");
    const events = emit.mock.calls.map(([event]) => event);
    expect(events.filter((event) => event === "deepsearch.user.input.required").length).toBe(2);
    expect(events.filter((event) => event === "deepsearch.user.input.received").length).toBe(2);
  });

  it("handles long strings and deep context payloads", async () => {
    const { handler } = await import(modulePath);

    const longQuestion = "q".repeat(100000);
    const largeFileContent = "x".repeat(1000000);
    const deepContext = buildNestedContext(40);
    const questionContext = {
      fileContent: largeFileContent,
      nested: deepContext,
    };

    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockResolvedValue("ok"),
    });

    const result = await handler(
      { question: longQuestion, context: questionContext },
      { emit, stageApi }
    );

    expect(result).toEqual({
      success: true,
      question: longQuestion,
      answer: "ok",
      hasOptions: false,
    });

    const requiredCall = emit.mock.calls.find(
      ([event]) => event === "deepsearch.user.input.required"
    );
    expect(requiredCall).toBeTruthy();
    const payload = requiredCall[1];
    expect(payload.question.length).toBe(longQuestion.length);
    expect(payload.context.fileContent.length).toBe(largeFileContent.length);
    let node = payload.context.nested;
    for (let i = 0; i < 40; i += 1) {
      node = node.next;
    }
    expect(node.leaf).toBe("done");
  });
});

describe("default export", () => {
  it("exposes definition and handler", async () => {
    const mod = await import(modulePath);

    expect(mod.default.definition).toBe(mod.definition);
    expect(mod.default.handler).toBe(mod.handler);
  });
});
