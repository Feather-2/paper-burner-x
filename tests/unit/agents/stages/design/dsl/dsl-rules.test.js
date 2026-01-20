import { describe, it, expect, vi, beforeEach } from "vitest";

const promptLoaderMocks = vi.hoisted(() => ({
  loadPrompt: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger,
    createLogger: vi.fn(() => logger),
  };
});

vi.mock("../../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: promptLoaderMocks.loadPrompt,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: loggerMocks.createLogger,
}));

const modulePath = "../../../../../../js/agents/stages/design/dsl/dsl-rules.js";

async function importDslRules() {
  return await import(modulePath);
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  promptLoaderMocks.loadPrompt.mockReset();
  loggerMocks.createLogger.mockReset();
  loggerMocks.logger.warn.mockReset();
  loggerMocks.logger.info.mockReset();
  loggerMocks.logger.error.mockReset();
  loggerMocks.logger.debug.mockReset();
  loggerMocks.createLogger.mockReturnValue(loggerMocks.logger);
});

describe("getDslRules", () => {
  it("loads prompt once and caches the result", async () => {
    promptLoaderMocks.loadPrompt.mockResolvedValue("RULES");
    const { getDslRules } = await importDslRules();

    const first = await getDslRules();
    const second = await getDslRules();

    expect(first).toBe("RULES");
    expect(second).toBe("RULES");
    expect(promptLoaderMocks.loadPrompt).toHaveBeenCalledTimes(1);
    expect(promptLoaderMocks.loadPrompt).toHaveBeenCalledWith("dsl/ppt-html-dsl");
  });

  it("shares the same in-flight promise for concurrent calls", async () => {
    const deferred = createDeferred();
    promptLoaderMocks.loadPrompt.mockReturnValue(deferred.promise);
    const { getDslRules } = await importDslRules();

    const firstPromise = getDslRules();
    const secondPromise = getDslRules();

    expect(promptLoaderMocks.loadPrompt).toHaveBeenCalledTimes(1);

    deferred.resolve("CONCURRENT");
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBe("CONCURRENT");
    expect(second).toBe("CONCURRENT");
  });

  it("falls back and logs a warning when loading fails", async () => {
    promptLoaderMocks.loadPrompt.mockRejectedValue(new Error("boom"));
    const { getDslRules } = await importDslRules();

    const result = await getDslRules();

    expect(result).toContain("PPT HTML DSL");
    expect(loggerMocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load from file"),
      { error: "boom" },
    );
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: "   " },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "zero", value: 0 },
    { label: "negative", value: -1 },
    { label: "max safe integer", value: Number.MAX_SAFE_INTEGER },
    { label: "string number", value: "123" },
    { label: "array-like object", value: { 0: "a", length: 1 } },
  ])("returns boundary value: $label", async ({ value }) => {
    promptLoaderMocks.loadPrompt.mockResolvedValue(value);
    const { getDslRules } = await importDslRules();

    const result = await getDslRules();

    expect(result).toBe(value);
  });

  it("handles large string payloads", async () => {
    const hugeString = "x".repeat(200000);
    promptLoaderMocks.loadPrompt.mockResolvedValue(hugeString);
    const { getDslRules } = await importDslRules();

    const result = await getDslRules();

    expect(result).toBe(hugeString);
    expect(result.length).toBe(200000);
  });

  it("handles deeply nested payloads", async () => {
    const deepNested = { a: { b: { c: { d: { e: ["deep", { f: 1 }] } } } } };
    promptLoaderMocks.loadPrompt.mockResolvedValue(deepNested);
    const { getDslRules } = await importDslRules();

    const result = await getDslRules();

    expect(result).toBe(deepNested);
    expect(result.a.b.c.d.e[0]).toBe("deep");
  });
});

describe("getDslRulesSync", () => {
  it("returns null before initialization without triggering load", async () => {
    const { getDslRulesSync } = await importDslRules();

    expect(getDslRulesSync()).toBeNull();
    expect(promptLoaderMocks.loadPrompt).not.toHaveBeenCalled();
  });

  it("returns cached rules after initialization", async () => {
    promptLoaderMocks.loadPrompt.mockResolvedValue("SYNCED");
    const { getDslRules, getDslRulesSync } = await importDslRules();

    await getDslRules();

    expect(getDslRulesSync()).toBe("SYNCED");
  });
});

describe("initDslRules", () => {
  it("initializes and returns the loaded rules", async () => {
    promptLoaderMocks.loadPrompt.mockResolvedValue("INIT");
    const { initDslRules, getDslRulesSync } = await importDslRules();

    const result = await initDslRules();

    expect(result).toBe("INIT");
    expect(getDslRulesSync()).toBe("INIT");
    expect(promptLoaderMocks.loadPrompt).toHaveBeenCalledTimes(1);
  });

  it("initializes fallback when loading fails", async () => {
    promptLoaderMocks.loadPrompt.mockRejectedValue(new Error("fail"));
    const { initDslRules, DSL_RULES } = await importDslRules();

    const result = await initDslRules();

    expect(result).toContain("PPT HTML DSL");
    expect(String(DSL_RULES)).toContain("PPT HTML DSL");
    expect(loggerMocks.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load from file"),
      { error: "fail" },
    );
  });
});

describe("clearDslRulesCache", () => {
  it("clears cached values and allows reloading", async () => {
    promptLoaderMocks.loadPrompt.mockResolvedValue("FIRST");
    const { getDslRules, getDslRulesSync, clearDslRulesCache } = await importDslRules();

    await getDslRules();
    expect(getDslRulesSync()).toBe("FIRST");

    clearDslRulesCache();
    expect(getDslRulesSync()).toBeNull();

    promptLoaderMocks.loadPrompt.mockResolvedValue("SECOND");
    const result = await getDslRules();

    expect(result).toBe("SECOND");
    expect(promptLoaderMocks.loadPrompt).toHaveBeenCalledTimes(2);
  });
});

describe("DSL_RULES", () => {
  it("returns fallback content when cache is empty", async () => {
    const { DSL_RULES } = await importDslRules();

    expect(String(DSL_RULES)).toContain("PPT HTML DSL");
    expect(DSL_RULES.length).toBe(String(DSL_RULES).length);
    expect(DSL_RULES[0]).toBe("#");
  });

  it("uses cached content after initialization", async () => {
    promptLoaderMocks.loadPrompt.mockResolvedValue("Custom Rules");
    const { getDslRules, DSL_RULES } = await importDslRules();

    await getDslRules();

    expect(String(DSL_RULES)).toBe("Custom Rules");
    expect(DSL_RULES.length).toBe("Custom Rules".length);
    expect(DSL_RULES[0]).toBe("C");
  });

  it("falls back when cached content is empty string", async () => {
    promptLoaderMocks.loadPrompt.mockResolvedValue("");
    const { getDslRules, DSL_RULES } = await importDslRules();

    await getDslRules();

    expect(String(DSL_RULES)).toContain("PPT HTML DSL");
    expect(String(DSL_RULES)).not.toBe("");
  });

  it("hides enumerable keys and returns generic descriptors", async () => {
    const { DSL_RULES } = await importDslRules();

    expect(Object.keys(DSL_RULES)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(DSL_RULES, "anything")).toMatchObject({
      configurable: true,
      enumerable: true,
    });
  });
});
