import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMetrics = vi.hoisted(() => ({
  passAtK: vi.fn(() => 0.42),
  passExpK: vi.fn(() => 0.24),
  aggregateResults: vi.fn(() => ({
    totalTasks: 0,
    passedTasks: 0,
    avgPassRate: 0,
    avgScore: 0,
    avgLatencyMs: 0,
  })),
}));

vi.mock("../../../../js/agents/eval/metrics.js", () => ({
  passAtK: mockMetrics.passAtK,
  passExpK: mockMetrics.passExpK,
  aggregateResults: mockMetrics.aggregateResults,
}));

import DefaultEvaluateStage, { EvalHarness, EvaluateStage } from "../../../../js/agents/eval/index.js";

const makeDeepObject = (depth) => {
  let root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.child = {};
    node = node.child;
  }
  return root;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMetrics.passAtK.mockReturnValue(0.42);
  mockMetrics.passExpK.mockReturnValue(0.24);
  mockMetrics.aggregateResults.mockImplementation(() => ({
    totalTasks: 0,
    passedTasks: 0,
    avgPassRate: 0,
    avgScore: 0,
    avgLatencyMs: 0,
  }));
});

describe("EvalHarness", () => {
  it("runs a task, records transcript entries, and clamps numeric boundaries", async () => {
    const grader = { type: "state_check", grade: vi.fn(() => ({ passed: true, score: 0.8 })) };
    const graderRegistry = { get: vi.fn(() => grader) };
    const agentFactory = vi.fn(() => (input) => `output:${input}`);
    const harness = new EvalHarness({ agentFactory, graderRegistry, trialsPerTask: 3, concurrency: 2 });

    const task = { id: "task-1", input: "hello", graders: [{ type: "state_check" }] };
    const result = await harness.runTask(task, { trialsPerTask: 0, passK: 0 });

    expect(result.taskId).toBe("task-1");
    expect(result.trials).toHaveLength(1);
    expect(result.passRate).toBe(1);
    expect(result.trials[0].score).toBe(0.8);

    const types = result.trials[0].transcript.entries.map((e) => e.type);
    expect(types).toContain("input");
    expect(types).toContain("output");

    expect(mockMetrics.passAtK).toHaveBeenCalledWith(result.trials, 1);
    expect(mockMetrics.passExpK).toHaveBeenCalledWith(result.trials, 1);
    expect(result.passAtK).toBe(0.42);
    expect(result.passExpK).toBe(0.24);
  });

  it("rejects invalid task inputs and empty ids", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });

    const nonObjects = [null, undefined, "", 0];
    for (const task of nonObjects) {
      await expect(harness.runTask(task)).rejects.toThrow(/task must be an object/i);
    }

    const missingIds = [[], {}, { id: "" }];
    for (const task of missingIds) {
      await expect(harness.runTask(task)).rejects.toThrow(/task\.id must be a non-empty string/i);
    }
  });

  it("limits concurrency for simultaneous trials and ignores string options", async () => {
    const resolvers = [];
    let active = 0;
    let maxActive = 0;

    const runner = vi.fn(() => new Promise((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      resolvers.push((value) => {
        active -= 1;
        resolve(value);
      });
    }));

    const grader = { type: "state_check", grade: vi.fn(() => ({ passed: true, score: 1 })) };
    const graderRegistry = { get: vi.fn(() => grader) };
    const harness = new EvalHarness({
      agentFactory: vi.fn(() => runner),
      graderRegistry,
      trialsPerTask: 3,
      concurrency: 2,
    });

    const task = { id: "concurrency", input: "payload", graders: [{ type: "state_check" }] };
    const runPromise = harness.runTask(task, {
      concurrency: "4",
      passK: Number.MAX_SAFE_INTEGER,
    });

    const waitForResolvers = async (count) => {
      for (let i = 0; i < 10 && resolvers.length < count; i += 1) {
        await Promise.resolve();
      }
      expect(resolvers.length).toBe(count);
    };

    await waitForResolvers(2);

    resolvers.splice(0, 2).forEach((resolve) => resolve("ok"));
    await waitForResolvers(1);

    resolvers.splice(0, 1).forEach((resolve) => resolve("ok"));
    const result = await runPromise;

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(mockMetrics.passAtK).toHaveBeenCalledWith(result.trials, Number.MAX_SAFE_INTEGER);
  });

  it("records errors when agentFactory is missing and clamps negative trials", async () => {
    const harness = new EvalHarness({ agentFactory: null, graderRegistry: { get: () => undefined } });
    const task = { id: "err-task", input: "data", graders: [{ type: "unknown" }] };

    const result = await harness.runTask(task, { trialsPerTask: -1 });

    expect(result.trials).toHaveLength(1);
    expect(result.trials[0].passed).toBe(false);
    expect(result.trials[0].outcome).toEqual(expect.objectContaining({
      error: expect.objectContaining({ message: expect.stringContaining("agentFactory") }),
    }));
    expect(result.trials[0].transcript.entries.some((e) => e.type === "error")).toBe(true);
  });

  it("handles suites with empty or non-array tasks", async () => {
    const harness = new EvalHarness({
      agentFactory: vi.fn(() => () => "ok"),
      graderRegistry: { get: () => undefined },
      trialsPerTask: 1,
    });

    const emptySuite = { suiteId: "empty", tasks: [] };
    const emptyResult = await harness.runSuite(emptySuite);
    expect(emptyResult.tasks).toEqual([]);

    const objectSuite = { suiteId: "object", tasks: {} };
    const objectResult = await harness.runSuite(objectSuite);
    expect(objectResult.tasks).toEqual([]);

    expect(mockMetrics.aggregateResults).toHaveBeenCalledTimes(2);
    expect(mockMetrics.aggregateResults).toHaveBeenCalledWith([]);
  });

  it("handles rapid sequential runTask calls independently", async () => {
    const grader = { type: "state_check", grade: vi.fn(() => ({ passed: true, score: 1 })) };
    const graderRegistry = { get: vi.fn(() => grader) };
    const agentFactory = vi.fn(({ task }) => (input) => `${task.id}:${input}`);

    const harness = new EvalHarness({ agentFactory, graderRegistry, trialsPerTask: 1 });

    const taskA = { id: "a", input: "foo", graders: [{ type: "state_check" }] };
    const taskB = { id: "b", input: "bar", graders: [{ type: "state_check" }] };

    const resultA = await harness.runTask(taskA);
    const resultB = await harness.runTask(taskB);

    expect(resultA.trials[0].outcome).toBe("a:foo");
    expect(resultB.trials[0].outcome).toBe("b:bar");
    expect(resultA.trials[0].transcript.entries[0].content).toBe("foo");
    expect(resultB.trials[0].transcript.entries[0].content).toBe("bar");
  });
});

describe("EvaluateStage", () => {
  it("evaluates content on the normal path and returns dimension scores", async () => {
    const stage = new EvaluateStage({ passThreshold: 0.7 });
    const sentences = [
      "The evaluation harness processes tasks and records transcripts with careful metrics.",
      "Each trial returns structured results including scores and latency details.",
      "This report includes headings and detailed explanations for reviewers.",
      "It avoids placeholders and incomplete sentences to keep quality high.",
    ];
    const content = `# Report\n\n${sentences.join(" ")}\n\nFinal note with additional insights.`;

    const result = await stage.run(null, {
      content,
      original: "evaluation harness transcripts metrics",
      context: { type: "report" },
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(Object.keys(result.dimensions)).toEqual(
      expect.arrayContaining(["completeness", "accuracy", "clarity", "relevance"])
    );
  });

  it("returns missing_content errors for empty or invalid inputs", async () => {
    const stage = new EvaluateStage();
    const inputs = [
      null,
      undefined,
      {},
      { content: "" },
      { content: null },
      { content: undefined },
      { content: [] },
      { content: {} },
    ];

    for (const input of inputs) {
      const result = await stage.run(null, input);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
      expect(result.issues.some((issue) => issue.type === "missing_content")).toBe(true);
    }
  });

  it("filters dimensions and captures evaluator errors", async () => {
    const errorEvaluator = vi.fn(() => {
      throw new Error("boom");
    });

    const stage = new EvaluateStage({
      dimensions: ["completeness", "boom", 0, null, {}, ""],
      dimensionConfig: { boom: { weight: Number.MAX_SAFE_INTEGER } },
    });

    stage.registerEvaluator("boom", errorEvaluator);

    const result = await stage.run(null, {
      content: "This is valid content with sufficient length to pass baseline checks.",
    });

    expect(errorEvaluator).toHaveBeenCalled();
    expect(Object.keys(result.dimensions)).toEqual(
      expect.arrayContaining(["completeness", "boom"])
    );
    expect(result.issues.some((issue) => issue.type === "evaluator_error")).toBe(true);
  });

  it("handles whitespace content and resource-scale inputs", async () => {
    const stage = new EvaluateStage({ passThreshold: 0.5 });

    const whitespaceResult = await stage.run(null, { content: "   " });
    expect(whitespaceResult.issues.some((issue) => issue.type === "missing_content")).toBe(false);

    const longContent = "word ".repeat(50000);
    const deepContext = { type: "text", metadata: makeDeepObject(30) };
    const longResult = await stage.run(null, {
      content: longContent,
      original: "word",
      context: deepContext,
    });

    expect(longResult.passed).toBe(true);
    expect(longResult.score).toBeGreaterThan(0.5);
    expect(Object.keys(longResult.dimensions).length).toBeGreaterThan(0);
  });
});

describe("default", () => {
  it("re-exports EvaluateStage", () => {
    expect(DefaultEvaluateStage).toBe(EvaluateStage);
  });

  it("honors strict mode even when passThreshold is negative", async () => {
    const forcedError = vi.fn(() => ({
      score: 1,
      issues: [{ type: "forced_error", severity: "error", message: "boom" }],
    }));

    const stage = new DefaultEvaluateStage({
      passThreshold: -1,
      strict: true,
      dimensions: ["forced"],
    });

    stage.registerEvaluator("forced", forcedError);

    const result = await stage.run(null, { content: "Valid content" });

    expect(forcedError).toHaveBeenCalled();
    expect(result.passed).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(true);
  });
});
