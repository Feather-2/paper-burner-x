import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const warn = vi.fn();
  const createLogger = vi.fn(() => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn,
    error: vi.fn(),
  }));
  const loadPrompt = vi.fn();
  return { warn, createLogger, loadPrompt };
});

vi.mock("../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: mocks.loadPrompt,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: mocks.createLogger,
}));

const importPrompts = async () =>
  await import("../../../../../js/agents/stages/codesearch/prompts.js");

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.resetModules();
  mocks.loadPrompt.mockReset();
  mocks.warn.mockReset();
  mocks.createLogger.mockClear();
});

describe("getCodesearchSystemPrompt", () => {
  it("loads system prompt and caches result", async () => {
    const { getCodesearchSystemPrompt } = await importPrompts();
    mocks.loadPrompt.mockResolvedValueOnce("system-prompt");

    const first = await getCodesearchSystemPrompt();
    const second = await getCodesearchSystemPrompt();

    expect(first).toBe("system-prompt");
    expect(second).toBe("system-prompt");
    expect(mocks.loadPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.loadPrompt).toHaveBeenCalledWith("codesearch/system");
    expect(mocks.createLogger).toHaveBeenCalledWith("stages/codesearch/prompts");
  });

  it("falls back to constant and logs on loader error", async () => {
    const { getCodesearchSystemPrompt, CODESEARCH_SYSTEM_PROMPT } =
      await importPrompts();
    mocks.loadPrompt.mockRejectedValueOnce(new Error("boom"));

    const result = await getCodesearchSystemPrompt();

    expect(result).toBe(CODESEARCH_SYSTEM_PROMPT);
    expect(mocks.loadPrompt).toHaveBeenCalledWith("codesearch/system");
    expect(mocks.warn).toHaveBeenCalledWith(
      "[codesearch-prompts] Failed to load system.md:",
      { error: "boom" }
    );
  });

  it("retries when loader returns empty string", async () => {
    const { getCodesearchSystemPrompt } = await importPrompts();
    mocks.loadPrompt.mockResolvedValue("");

    const first = await getCodesearchSystemPrompt();
    const second = await getCodesearchSystemPrompt();

    expect(first).toBe("");
    expect(second).toBe("");
    expect(mocks.loadPrompt).toHaveBeenCalledTimes(2);
  });
});

describe("getCodesearchStepPrompt", () => {
  it("returns large prompt and caches it", async () => {
    const { getCodesearchStepPrompt } = await importPrompts();
    const hugePrompt = "x".repeat(1_000_000);
    mocks.loadPrompt.mockResolvedValueOnce(hugePrompt);

    const first = await getCodesearchStepPrompt();
    const second = await getCodesearchStepPrompt();

    expect(first).toBe(hugePrompt);
    expect(second).toBe(hugePrompt);
    expect(first.length).toBe(1_000_000);
    expect(mocks.loadPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.loadPrompt).toHaveBeenCalledWith("codesearch/step");
  });

  it("falls back to constant and logs on error", async () => {
    const { getCodesearchStepPrompt, CODESEARCH_STEP_PROMPT } =
      await importPrompts();
    mocks.loadPrompt.mockRejectedValueOnce(new Error("step-fail"));

    const result = await getCodesearchStepPrompt();

    expect(result).toBe(CODESEARCH_STEP_PROMPT);
    expect(mocks.loadPrompt).toHaveBeenCalledWith("codesearch/step");
    expect(mocks.warn).toHaveBeenCalledWith(
      "[codesearch-prompts] Failed to load step.md:",
      { error: "step-fail" }
    );
  });

  it("handles concurrent calls without shared cache", async () => {
    const { getCodesearchStepPrompt } = await importPrompts();
    const d1 = createDeferred();
    const d2 = createDeferred();

    mocks.loadPrompt
      .mockImplementationOnce(() => d1.promise)
      .mockImplementationOnce(() => d2.promise);

    const p1 = getCodesearchStepPrompt();
    const p2 = getCodesearchStepPrompt();

    expect(mocks.loadPrompt).toHaveBeenCalledTimes(2);

    d1.resolve("step-one");
    d2.resolve("step-two");

    await expect(Promise.all([p1, p2])).resolves.toEqual(["step-one", "step-two"]);
  });
});

describe("getCodesearchSummarizePrompt", () => {
  it("loads summarize prompt from loader", async () => {
    const { getCodesearchSummarizePrompt } = await importPrompts();
    mocks.loadPrompt.mockResolvedValueOnce("summarize-prompt");

    const result = await getCodesearchSummarizePrompt();

    expect(result).toBe("summarize-prompt");
    expect(mocks.loadPrompt).toHaveBeenCalledWith("codesearch/summarize");
  });

  it("falls back and logs when loader rejects with null", async () => {
    const { getCodesearchSummarizePrompt, CODESEARCH_SUMMARIZE_PROMPT } =
      await importPrompts();
    mocks.loadPrompt.mockRejectedValueOnce(null);

    const result = await getCodesearchSummarizePrompt();

    expect(result).toBe(CODESEARCH_SUMMARIZE_PROMPT);
    expect(mocks.warn).toHaveBeenCalledWith(
      "[codesearch-prompts] Failed to load summarize.md:",
      { error: undefined }
    );
  });

  const deepNested = (() => {
    const root = {};
    let cursor = root;
    for (let i = 0; i < 12; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    return root;
  })();

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: "   " },
    { label: "zero", value: 0 },
    { label: "negative one", value: -1 },
    { label: "max safe integer", value: Number.MAX_SAFE_INTEGER },
    { label: "numeric string", value: "123" },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "deep nested object", value: deepNested },
  ])("returns loader value for $label", async ({ value }) => {
    const { getCodesearchSummarizePrompt } = await importPrompts();
    mocks.loadPrompt.mockResolvedValueOnce(value);

    const result = await getCodesearchSummarizePrompt();

    expect(result).toBe(value);
  });
});

describe("CODESEARCH_SYSTEM_PROMPT", () => {
  it("includes tools placeholder and JSON guidance", async () => {
    const { CODESEARCH_SYSTEM_PROMPT } = await importPrompts();

    expect(typeof CODESEARCH_SYSTEM_PROMPT).toBe("string");
    expect(CODESEARCH_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(CODESEARCH_SYSTEM_PROMPT).toContain("{TOOLS}");
    expect(CODESEARCH_SYSTEM_PROMPT).toContain("\"action\": \"done\"");
    expect(CODESEARCH_SYSTEM_PROMPT).toContain("JSON");
  });
});

describe("CODESEARCH_TODO_PLANNER_PROMPT", () => {
  it("includes required fields and query placeholder", async () => {
    const { CODESEARCH_TODO_PLANNER_PROMPT } = await importPrompts();

    expect(typeof CODESEARCH_TODO_PLANNER_PROMPT).toBe("string");
    expect(CODESEARCH_TODO_PLANNER_PROMPT).toContain("{QUERY}");
    expect(CODESEARCH_TODO_PLANNER_PROMPT).toContain("JSON");
    expect(CODESEARCH_TODO_PLANNER_PROMPT).toContain("priority: high | medium | low");
  });
});

describe("CODESEARCH_STEP_PROMPT", () => {
  it("includes step placeholders and output schema", async () => {
    const { CODESEARCH_STEP_PROMPT } = await importPrompts();

    expect(typeof CODESEARCH_STEP_PROMPT).toBe("string");
    expect(CODESEARCH_STEP_PROMPT).toContain("{QUERY}");
    expect(CODESEARCH_STEP_PROMPT).toContain("{STEP}");
    expect(CODESEARCH_STEP_PROMPT).toContain("{MAX_STEPS}");
    expect(CODESEARCH_STEP_PROMPT).toContain("{OPEN_TODOS}");
    expect(CODESEARCH_STEP_PROMPT).toContain("{OBSERVATIONS}");
    expect(CODESEARCH_STEP_PROMPT).toContain("todoStatus");
    expect(CODESEARCH_STEP_PROMPT).toContain("\"action\": \"done\"");
  });
});
