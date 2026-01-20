import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  get: vi.fn(),
}));

const mockMetrics = vi.hoisted(() => ({
  aggregateResults: vi.fn(() => ({ passRate: 0 })),
  passAtK: vi.fn(() => 0),
  passExpK: vi.fn(() => 0),
}));

vi.mock("../../../../js/agents/eval/graders/index.js", () => ({
  defaultGraderRegistry: mockRegistry,
}));

vi.mock("../../../../js/agents/eval/metrics.js", () => ({
  aggregateResults: mockMetrics.aggregateResults,
  passAtK: mockMetrics.passAtK,
  passExpK: mockMetrics.passExpK,
}));

import { EvalHarness } from "../../../../js/agents/eval/harness.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockMetrics.aggregateResults.mockReturnValue({ passRate: 0 });
  mockMetrics.passAtK.mockReturnValue(0);
  mockMetrics.passExpK.mockReturnValue(0);
});

describe("EvalHarness", () => {
  it("constructs with defaults and clamps numeric options", () => {
    const harnessDefault = new EvalHarness();

    expect(harnessDefault.graderRegistry).toBe(mockRegistry);
    expect(harnessDefault.concurrency).toBe(4);
    expect(harnessDefault.trialsPerTask).toBe(3);
    expect(harnessDefault.recordEvents).toBe(false);
    expect(harnessDefault.llmClient).toBe(null);

    const customRegistry = { get: vi.fn() };
    const harness = new EvalHarness({
      concurrency: -1,
      trialsPerTask: 0,
      recordEvents: true,
      llmClient: { id: "llm" },
      graderRegistry: customRegistry,
    });

    expect(harness.concurrency).toBe(1);
    expect(harness.trialsPerTask).toBe(1);
    expect(harness.recordEvents).toBe(true);
    expect(harness.llmClient).toEqual({ id: "llm" });
    expect(harness.graderRegistry).toBe(customRegistry);

    const stringOptions = new EvalHarness({ concurrency: "2", trialsPerTask: "2" });
    expect(stringOptions.concurrency).toBe(4);
    expect(stringOptions.trialsPerTask).toBe(3);
  });

  it("runTask validates task and id boundaries", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });

    const invalidTasks = [null, undefined, "", {}, { id: "" }];
    for (const task of invalidTasks) {
      await expect(harness.runTask(task)).rejects.toThrow(/task/i);
    }

    const whitespaceTask = { id: "   ", input: "" };
    harness._runTrial = vi.fn(async () => ({ taskId: whitespaceTask.id, trialIndex: 0, passed: true }));

    const result = await harness.runTask(whitespaceTask, { trialsPerTask: 1 });
    expect(result.taskId).toBe("   ");
  });

  it("runTask filters trials and clamps passK", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    const results = [
      { taskId: "t1", trialIndex: 0, passed: true },
      null,
      { taskId: "t1", trialIndex: 2, passed: false },
    ];
    harness._runTrial = vi.fn(async (_task, idx) => results[idx]);

    const task = { id: "t1", input: {} };
    const result = await harness.runTask(task, { trialsPerTask: 3, passK: 0, concurrency: "2" });

    expect(result.trials).toHaveLength(2);
    expect(result.passRate).toBe(0.5);
    expect(mockMetrics.passAtK).toHaveBeenCalledWith(result.trials, 1);
    expect(mockMetrics.passExpK).toHaveBeenCalledWith(result.trials, 1);
    expect(harness._runTrial).toHaveBeenCalledTimes(3);
  });

  it("runTask respects concurrency limits under rapid scheduling", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    let active = 0;
    let maxActive = 0;
    const started = [];
    const gates = Array.from({ length: 4 }, () => {
      let resolve;
      const promise = new Promise((res) => {
        resolve = res;
      });
      return { promise, resolve };
    });

    harness._runTrial = vi.fn(async (task, idx) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      started.push(idx);
      await gates[idx].promise;
      active -= 1;
      return { taskId: task.id, trialIndex: idx, passed: true };
    });

    const runPromise = harness.runTask({ id: "t1", input: "x" }, { trialsPerTask: 4, concurrency: 2 });
    await Promise.resolve();

    expect(started).toHaveLength(2);
    expect(maxActive).toBe(2);

    for (const gate of gates) gate.resolve();

    const result = await runPromise;
    expect(started).toHaveLength(4);
    expect(result.trials).toHaveLength(4);
  });

  it("runTask supports simultaneous and rapid consecutive calls", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    harness._runTrial = vi.fn(async (task, idx) => ({ taskId: task.id, trialIndex: idx, passed: true }));

    const taskA = { id: "a", input: null };
    const taskB = { id: "b", input: undefined };

    const [resA, resB] = await Promise.all([
      harness.runTask(taskA, { trialsPerTask: 2 }),
      harness.runTask(taskB, { trialsPerTask: 1 }),
    ]);

    expect(resA.trials).toHaveLength(2);
    expect(resB.trials).toHaveLength(1);
    expect(harness._runTrial).toHaveBeenCalledTimes(3);

    const resC = await harness.runTask({ id: "c", input: {} }, { trialsPerTask: 1 });
    expect(resC.trials).toHaveLength(1);
    expect(harness._runTrial).toHaveBeenCalledTimes(4);
  });

  it("runSuite validates suite input and handles empty task lists", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });

    await expect(harness.runSuite(null)).rejects.toThrow(/suite/i);
    await expect(harness.runSuite(undefined)).rejects.toThrow(/suite/i);

    const suite = { suiteId: "", tasks: {} };
    const result = await harness.runSuite(suite);

    expect(result.suiteId).toBe("suite");
    expect(result.tasks).toEqual([]);
    expect(mockMetrics.aggregateResults).toHaveBeenCalledWith([]);
  });

  it("runSuite runs trials per task and aggregates results", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    harness._runTrial = vi.fn(async (task, trialIndex) => ({
      taskId: task.id,
      trialIndex,
      passed: trialIndex % 2 === 0,
    }));

    mockMetrics.aggregateResults.mockReturnValue({ passRate: 0.25 });

    const suite = {
      suiteId: "s1",
      tasks: [
        { id: "t1", input: "" },
        { id: "t2", input: "" },
      ],
    };

    const result = await harness.runSuite(suite, { trialsPerTask: 2, passK: -1, concurrency: "2" });

    expect(result.suiteId).toBe("s1");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].trials).toHaveLength(2);
    expect(mockMetrics.passAtK).toHaveBeenCalledWith(result.tasks[0].trials, 1);
    expect(mockMetrics.passExpK).toHaveBeenCalledWith(result.tasks[1].trials, 1);
    expect(mockMetrics.aggregateResults).toHaveBeenCalledWith(result.tasks);
    expect(result.aggregated).toEqual({ passRate: 0.25 });
  });

  it("_createAgent supports positional and object factory signatures", async () => {
    const task = { id: "t1" };
    const factoryTwoArgs = vi.fn(async (_task, ctx) => ({ kind: "two", ctx }));
    const harnessTwo = new EvalHarness({ agentFactory: factoryTwoArgs });

    const agentTwo = await harnessTwo._createAgent(task, 3, { context: {} });
    expect(factoryTwoArgs).toHaveBeenCalledWith(task, { trialIndex: 3, options: { context: {} } });
    expect(agentTwo.kind).toBe("two");

    const factoryOneArg = vi.fn(async (ctx) => ({ kind: "one", ctx }));
    const harnessOne = new EvalHarness({ agentFactory: factoryOneArg });

    const agentOne = await harnessOne._createAgent(task, 1, { llmClient: "x" });
    expect(factoryOneArg).toHaveBeenCalledWith({ task, trialIndex: 1, options: { llmClient: "x" } });
    expect(agentOne.kind).toBe("one");
  });

  it("_createAgent wraps factory errors with task context", async () => {
    const factory = vi.fn(() => {
      throw new Error("boom");
    });
    const harness = new EvalHarness({ agentFactory: factory });

    await expect(harness._createAgent({ id: "t1" }, 0, {})).rejects.toThrow(/agentFactory failed/);
  });

  it("_runGraders handles base grader inputs, missing baseline, and normalization", async () => {
    const outcome = { value: 1 };
    const transcript = { entries: [] };
    const task = {
      id: "t1",
      expected: { a: { b: { c: { d: { e: "ok" } } } } },
      graders: [
        { type: "state_check" },
        { type: "tool_calls" },
        { type: "transcript" },
        { type: "llm_rubric" },
        { type: "llm_pairwise", options: {} },
        { type: "llm_pairwise", options: { compareTo: "baseline-output" } },
        { type: "custom" },
      ],
    };

    const stateCheckGrader = { grade: vi.fn(() => ({ passed: true, score: 2 })) };
    const toolCallsGrader = { grade: vi.fn(() => ({ passed: false, score: -1 })) };
    const transcriptGrader = { grade: vi.fn(() => ({ score: 0.5 })) };
    const rubricGrader = { grade: vi.fn(() => ({ passed: true, score: 0.7 })) };
    const pairwiseGrader = { grade: vi.fn(() => ({ passed: true, score: 0.9 })) };
    const customGrader = { grade: vi.fn(() => ({ passed: true, score: 0.3 })) };

    const registry = {
      get: vi.fn((type) => ({
        state_check: stateCheckGrader,
        tool_calls: toolCallsGrader,
        transcript: transcriptGrader,
        llm_rubric: rubricGrader,
        llm_pairwise: pairwiseGrader,
        custom: customGrader,
      })[type]),
    };

    const harness = new EvalHarness({ agentFactory: vi.fn(), graderRegistry: registry });
    const results = await harness._runGraders(task, 0, outcome, transcript, { llmClient: "client" });

    expect(stateCheckGrader.grade).toHaveBeenCalledWith(outcome, task.graders[0]);
    expect(toolCallsGrader.grade).toHaveBeenCalledWith(transcript, task.graders[1]);
    expect(transcriptGrader.grade).toHaveBeenCalledWith(transcript, task.graders[2]);
    expect(rubricGrader.grade).toHaveBeenCalledWith(
      { output: outcome, expected: task.expected, task, transcript, trialIndex: 0 },
      task.graders[3],
      "client"
    );
    expect(pairwiseGrader.grade).toHaveBeenCalledWith(outcome, "baseline-output", task.graders[5], "client");
    expect(pairwiseGrader.grade).toHaveBeenCalledTimes(1);
    expect(customGrader.grade).toHaveBeenCalledWith(outcome, task.graders[6], "client");

    expect(results).toHaveLength(task.graders.length);
    expect(results[0].passed).toBe(true);
    expect(results[0].score).toBe(1);
    expect(results[1].passed).toBe(false);
    expect(results[1].score).toBe(0);
    expect(results[2].passed).toBe(false);
    expect(results[2].score).toBe(0.5);
    expect(results[4].reason).toMatch(/llm_pairwise requires/);
    expect(results[6].score).toBe(0.3);
  });

  it("_runGraders runs composite graders and fills invalid configs", async () => {
    const task = {
      id: "t1",
      graders: [
        { type: "state_check" },
        { type: "weighted" },
        { type: "threshold" },
        null,
        {},
      ],
    };

    const baseGrader = { grade: vi.fn(() => ({ passed: true, score: 0.6 })) };
    const compositeGrader = { grade: vi.fn(() => ({ passed: true, score: 0.4 })) };

    const registry = {
      get: vi.fn((type) => ({
        state_check: baseGrader,
        weighted: compositeGrader,
      })[type]),
    };

    const harness = new EvalHarness({ agentFactory: vi.fn(), graderRegistry: registry });
    const results = await harness._runGraders(task, 0, { ok: true }, { entries: [] }, {});

    expect(compositeGrader.grade).toHaveBeenCalled();
    expect(compositeGrader.grade.mock.calls[0][0]).toHaveLength(1);
    expect(compositeGrader.grade.mock.calls[0][0][0].graderType).toBe("state_check");
    expect(results[1].passed).toBe(true);
    expect(results[2].reason).toMatch(/Unknown grader type/);
    expect(results[3].graderType).toBe("invalid");
    expect(results[4].graderType).toBe("invalid");
  });

  it("_runGraders returns an empty array for empty configs", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn(), graderRegistry: { get: vi.fn() } });
    const results = await harness._runGraders({ id: "t1", graders: [] }, 0, null, { entries: [] }, {});

    expect(results).toEqual([]);
  });

  it("_computeOverallResult honors explicit final aggregator", () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    const task = { graders: [{ type: "custom", options: { final: true } }, { type: "other" }] };
    const results = [{ passed: true, score: 2 }, { passed: false, score: 0 }];

    const overall = harness._computeOverallResult(task, results);

    expect(overall).toEqual({ passed: true, score: 1 });
  });

  it("_computeOverallResult uses composite grader when present", () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    const task = { graders: [{ type: "regex" }, { type: "weighted" }] };
    const results = [{ passed: false, score: 0.1 }, { passed: true, score: 0.8 }];

    const overall = harness._computeOverallResult(task, results);

    expect(overall).toEqual({ passed: true, score: 0.8 });
  });

  it("_computeOverallResult defaults to weighted average across base graders", () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    const task = {
      graders: [
        { type: "regex", weight: 1 },
        { type: "content", weight: Number.MAX_SAFE_INTEGER },
      ],
    };

    const results = [
      { passed: true, score: 0.2 },
      { passed: false, score: 0.8 },
    ];

    const overall = harness._computeOverallResult(task, results);
    const expected = (0.2 * 1 + 0.8 * Number.MAX_SAFE_INTEGER) / (1 + Number.MAX_SAFE_INTEGER);

    expect(overall.passed).toBe(false);
    expect(overall.score).toBeCloseTo(expected, 6);
  });

  it("_recordTranscript records tool calls, events, and restores instrumentation", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    const originalToolExecutor = vi.fn(async () => "ok");
    const unsubscribe = vi.fn();
    let capturedHandler;

    const eventBus = {
      subscribe: vi.fn((_pattern, handler) => {
        capturedHandler = handler;
        return unsubscribe;
      }),
    };

    const agent = { toolExecutor: originalToolExecutor, eventBus };
    const { transcript, restore } = harness._recordTranscript(agent, { id: "t1" }, 0, { recordEvents: true });

    await agent.toolExecutor("tool", { a: 1 }, {});
    capturedHandler({ name: "evt", payload: { deep: { nested: true } } });

    restore();

    const types = transcript.entries.map((entry) => entry.type);
    expect(types).toEqual(expect.arrayContaining(["tool_call", "tool_result", "event"]));
    expect(agent.toolExecutor).toBe(originalToolExecutor);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("_recordTranscript captures tool errors", async () => {
    const harness = new EvalHarness({ agentFactory: vi.fn() });
    const error = new Error("boom");
    const originalToolExecutor = vi.fn(async () => {
      throw error;
    });

    const agent = { toolExecutor: originalToolExecutor };
    const { transcript, restore } = harness._recordTranscript(agent, { id: "t1" }, 1);

    await expect(agent.toolExecutor("bad", { a: 1 }, {})).rejects.toThrow("boom");
    restore();

    const toolResult = transcript.entries.find((entry) => entry.type === "tool_result");
    expect(toolResult.content.error.message).toBe("boom");
  });

  it("_runTrial records outputs, metrics, and forwards context", async () => {
    const largeInput = "x".repeat(500000);
    const largeOutput = "y".repeat(250000);
    const task = {
      id: "t1",
      input: largeInput,
      expected: { a: { b: { c: { d: { e: "ok" } } } } },
      description: "desc",
      graders: [],
    };

    let receivedCtx;
    const agent = {
      toolExecutor: vi.fn(async () => "ok"),
      run: vi.fn(async (_input, ctx) => {
        receivedCtx = ctx;
        await agent.toolExecutor("tool", { q: "x" }, ctx);
        return { output: largeOutput, deep: { nested: { value: 42 } } };
      }),
    };

    const harness = new EvalHarness({ agentFactory: vi.fn(async () => agent) });
    const originalRecordTranscript = harness._recordTranscript.bind(harness);
    harness._recordTranscript = (instrumentedAgent, taskInfo, trialIndex, options) => {
      const recorder = originalRecordTranscript(instrumentedAgent, taskInfo, trialIndex, options);
      const originalRecord = recorder.record;
      recorder.record = (type, content, metadata) => {
        let enhanced = metadata;
        if (type === "input") enhanced = { ...metadata, tokens: 3 };
        if (type === "output") enhanced = { ...metadata, usage: { total_tokens: 4 } };
        return originalRecord(type, content, enhanced);
      };
      return recorder;
    };

    harness._runGraders = vi.fn(async () => [{ graderType: "ok", passed: true, score: 1 }]);
    harness._computeOverallResult = vi.fn(() => ({ passed: true, score: 0.75 }));

    const times = [100, 100, 105, 110, 115, 120, 130];
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => times.shift());

    const context = { extra: "ctx" };
    const result = await harness._runTrial(task, 0, { context });

    nowSpy.mockRestore();

    expect(receivedCtx).toEqual({ task, trialIndex: 0, extra: "ctx" });
    expect(result.outcome.output.length).toBe(250000);
    expect(result.transcript.entries.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["input", "output", "tool_call", "tool_result"])
    );
    expect(result.metrics.turns).toBe(1);
    expect(result.metrics.toolCalls).toBe(1);
    expect(result.metrics.totalTokens).toBe(7);
    expect(result.metrics.timeToFirstToken).toBe(20);
    expect(result.latencyMs).toBe(30);
    expect(harness._runGraders).toHaveBeenCalledWith(task, 0, result.outcome, result.transcript, { context });
  });

  it("_runTrial captures runner errors and disposes agent", async () => {
    const error = new Error("fail");
    const agent = {
      run: vi.fn(async () => {
        throw error;
      }),
      dispose: vi.fn(),
    };

    const harness = new EvalHarness({ agentFactory: vi.fn(async () => agent) });
    harness._runGraders = vi.fn(async () => []);
    harness._computeOverallResult = vi.fn(() => ({ passed: false, score: 0 }));

    const result = await harness._runTrial({ id: "t1", input: {} }, 0, {});

    expect(result.outcome.error.message).toBe("fail");
    expect(agent.dispose).toHaveBeenCalledTimes(1);

    const types = result.transcript.entries.map((entry) => entry.type);
    expect(types).toEqual(expect.arrayContaining(["input", "error"]));
    expect(result.metrics.turns).toBe(0);
  });

  it("_runTrial handles missing agentFactory errors", async () => {
    const harness = new EvalHarness();
    harness._runGraders = vi.fn(async () => []);
    harness._computeOverallResult = vi.fn(() => ({ passed: false, score: 0 }));

    const result = await harness._runTrial({ id: "t-missing", input: null }, 1, {});

    expect(result.outcome.error.message).toMatch(/agentFactory is required/);
    expect(result.transcript.entries.map((entry) => entry.type)).toEqual(expect.arrayContaining(["input", "error"]));
  });
});
