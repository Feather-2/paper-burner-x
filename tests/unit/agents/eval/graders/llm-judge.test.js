import { beforeEach, describe, expect, it, vi } from "vitest";

const robustParseJsonMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  robustParseJson: robustParseJsonMock,
}));

import { rubricGrader } from "../../../../../js/agents/eval/graders/llm-judge.js";

function makeConfig(overrides = {}) {
  return { options: { rubric: "Use rubric", ...overrides } };
}

function makeDeepContext(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

describe("rubricGrader", () => {
  beforeEach(() => {
    robustParseJsonMock.mockReset();
  });

  it("grades successfully with valid judge JSON and forwards options", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "judge-ok" });
    robustParseJsonMock.mockReturnValue({
      passed: true,
      score: 0.75,
      reason: "clear win",
      issues: [{ type: "style", severity: "info", message: "fine" }],
    });

    const config = makeConfig({
      context: { foo: "bar" },
      system: "extra instructions",
      model: "test-model",
      temperature: 0.2,
      usage: "unit-test",
    });

    const result = await rubricGrader.grade("output text", config, { chat });

    expect(result).toEqual({
      graderType: "llm_rubric",
      passed: true,
      score: 0.75,
      reason: "clear win",
      issues: [{ type: "style", severity: "info", message: "fine" }],
    });

    expect(chat).toHaveBeenCalledTimes(1);
    const call = chat.mock.calls[0][0];
    expect(call).toMatchObject({
      model: "test-model",
      temperature: 0.2,
      usage: "unit-test",
    });
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0].content).toContain("Return VALID JSON ONLY");
    expect(call.messages[0].content).toContain("extra instructions");
    const payload = call.messages[1].content;
    expect(payload).toContain("## Rubric");
    expect(payload).toContain("Use rubric");
    expect(payload).toContain("## Output");
    expect(payload).toContain("output text");
    expect(payload).toContain("## Context");
    expect(payload).toContain(JSON.stringify({ foo: "bar" }));
    expect(robustParseJsonMock).toHaveBeenCalledWith("judge-ok");
  });

  it.each([
    { label: "undefined config", config: undefined },
    { label: "null config", config: null },
    { label: "empty options", config: { options: {} } },
    { label: "empty rubric", config: { options: { rubric: "" } } },
    { label: "whitespace rubric", config: { options: { rubric: "   " } } },
  ])("returns missing rubric for $label", async ({ config }) => {
    const chat = vi.fn();

    const result = await rubricGrader.grade("output", config, { chat });

    expect(result).toEqual({
      graderType: "llm_rubric",
      passed: false,
      score: 0,
      reason: "Missing rubric",
      issues: [
        {
          type: "missing_rubric",
          severity: "error",
          message: "llm_rubric grader requires options.rubric",
        },
      ],
    });
    expect(chat).not.toHaveBeenCalled();
    expect(robustParseJsonMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null output", output: null },
    { label: "undefined output", output: undefined },
    { label: "empty string output", output: "" },
  ])("handles $label without literal null/undefined", async ({ output }) => {
    const chat = vi.fn().mockResolvedValue({ content: "judge-empty" });
    robustParseJsonMock.mockReturnValue({ passed: true, score: 0, reason: "", issues: [] });

    const result = await rubricGrader.grade(output, makeConfig(), { chat });

    expect(result.score).toBe(0);
    const payload = chat.mock.calls[0][0].messages[1].content;
    expect(payload).toContain("## Output");
    expect(payload).not.toContain("null");
    expect(payload).not.toContain("undefined");
    expect(payload).not.toContain("## Context");
  });

  it("handles empty array/object output and non-array issues", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "judge-empty-io" });
    robustParseJsonMock.mockReturnValue({
      passed: true,
      score: -1,
      reason: "negative score",
      issues: { not: "array" },
    });

    const result = await rubricGrader.grade([], makeConfig({ context: {} }), { chat });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
    expect(result.issues).toEqual([]);
    const payload = chat.mock.calls[0][0].messages[1].content;
    expect(payload).toContain("## Output");
    expect(payload).toContain("[]");
    expect(payload).toContain("## Context");
    expect(payload).toContain("{}");
    expect(chat.mock.calls[0][0].usage).toBe("worker");
  });

  it("clamps MAX_SAFE_INTEGER score to 1", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "judge-big" });
    robustParseJsonMock.mockReturnValue({
      passed: true,
      score: Number.MAX_SAFE_INTEGER,
      reason: "big score",
      issues: [],
    });

    const result = await rubricGrader.grade("output", makeConfig(), { chat });

    expect(result.score).toBe(1);
    expect(result.reason).toBe("big score");
  });

  it("returns invalid JSON when score is a string", async () => {
    const chat = vi.fn().mockResolvedValue({ content: "raw-response" });
    robustParseJsonMock.mockReturnValue({
      passed: true,
      score: "0.5",
      reason: "string score",
      issues: [],
    });

    const result = await rubricGrader.grade("output", makeConfig(), { chat });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("Judge returned invalid JSON");
    expect(result.issues[0].type).toBe("invalid_judge_response");
    expect(result.issues[0].message).toContain("raw-response");
  });

  it("returns judge_error when no compatible llmClient is provided", async () => {
    const result = await rubricGrader.grade("output", makeConfig(), null);

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("Judge call failed");
    expect(result.issues[0].type).toBe("judge_error");
    expect(result.issues[0].message).toContain("No compatible llmClient");
  });

  it("handles concurrent calls independently", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: "resp-a" })
      .mockResolvedValueOnce({ content: "resp-b" });

    robustParseJsonMock.mockImplementation((raw) => {
      if (raw === "resp-a") return { passed: true, score: 0.2, reason: "A", issues: [] };
      if (raw === "resp-b") return { passed: false, score: 0.4, reason: "B", issues: [] };
      return null;
    });

    const config = makeConfig();
    const [resA, resB] = await Promise.all([
      rubricGrader.grade("out-a", config, { chat }),
      rubricGrader.grade("out-b", config, { chat }),
    ]);

    expect(resA.reason).toBe("A");
    expect(resB.reason).toBe("B");
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("handles rapid sequential calls without leaking state", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ content: "resp-1" })
      .mockResolvedValueOnce({ content: "resp-2" });

    robustParseJsonMock.mockImplementation((raw) => {
      if (raw === "resp-1") return { passed: true, score: 1, reason: "one", issues: [] };
      if (raw === "resp-2") return { passed: true, score: 0.5, reason: "two", issues: [] };
      return null;
    });

    const config = makeConfig();
    const res1 = await rubricGrader.grade("out-1", config, { chat });
    const res2 = await rubricGrader.grade("out-2", config, { chat });

    expect(res1.reason).toBe("one");
    expect(res2.reason).toBe("two");
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("handles large output and deep context with call() clients", async () => {
    const longOutput = "x".repeat(50000);
    const deepContext = makeDeepContext(40);
    const call = vi.fn().mockResolvedValue({ content: "judge-long" });
    robustParseJsonMock.mockReturnValue({
      passed: true,
      score: 0.6,
      reason: "ok",
      issues: [],
    });

    const config = makeConfig({ context: deepContext, temperature: "0.9" });
    await rubricGrader.grade(longOutput, config, { call });

    expect(call).toHaveBeenCalledTimes(1);
    const [messages, opts] = call.mock.calls[0];
    expect(Array.isArray(messages)).toBe(true);
    expect(opts.temperature).toBe(0);
    const payload = messages[1].content;
    expect(payload.length).toBeGreaterThan(longOutput.length);
    expect(payload).toContain(longOutput.slice(0, 100));
    expect(payload).toContain('"level":0');
  });
});
