import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warnMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() =>
  vi.fn(() => ({
    warn: warnMock,
  })),
);
const createSafeRegexMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
  createSafeRegex: createSafeRegexMock,
}));

import ToolQuotaManager, {
  ToolQuotaManager as NamedToolQuotaManager,
  ContractValidator,
  createToolContract,
} from "../../../../../js/agents/runtime/tools/tool-quotas.js";

function makeNowController(start = 0) {
  let now = start;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    set(value) {
      now = value;
    },
    advance(ms) {
      now += ms;
    },
    restore() {
      spy.mockRestore();
    },
  };
}

function makeLargeString(size) {
  return "x".repeat(size);
}

function makeDeepSchema(depth) {
  const root = { type: "object", properties: {} };
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.properties.node = { type: "object", properties: {} };
    cursor = cursor.properties.node;
  }
  cursor.properties.leaf = { type: "string", minLength: 1 };
  return root;
}

function makeDeepValue(depth, leafValue) {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.node = {};
    cursor = cursor.node;
  }
  cursor.leaf = leafValue;
  return root;
}

beforeEach(() => {
  warnMock.mockReset();
  createLoggerMock.mockClear();
  createSafeRegexMock.mockReset();
  createSafeRegexMock.mockImplementation((pattern, flags) => new RegExp(pattern, flags));
});

afterEach(() => {
  // Ensure Date.now spies (and any future spies) don't leak across tests.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ToolQuotaManager", () => {
  it("exports default as the named class", () => {
    expect(ToolQuotaManager).toBe(NamedToolQuotaManager);
  });

  it("returns itself from setQuota for chaining and getAllStats returns a plain object snapshot", () => {
    const manager = new ToolQuotaManager({ defaultMaxCalls: 2, defaultWindowMs: 1000 });

    const returned = manager.setQuota("a", { maxCalls: 1, windowMs: 100 });
    expect(returned).toBe(manager);

    manager.setQuota("b", { maxCalls: 2, windowMs: 200 });
    manager.tryCall("a");
    manager.tryCall("b");

    const all = manager.getAllStats();
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);
    expect(all.a).toMatchObject({ toolName: "a", maxCalls: 1, windowMs: 100, current: 1 });
    expect(all.b).toMatchObject({ toolName: "b", maxCalls: 2, windowMs: 200, current: 1 });
  });

  it("initializes quotas and uses defaults for missing config", () => {
    const manager = new ToolQuotaManager({
      defaultMaxCalls: 5,
      defaultWindowMs: 1000,
      quotas: {
        alpha: { maxCalls: 2 },
        beta: { windowMs: 250 },
      },
    });

    const alpha = manager.getToolStats("alpha");
    expect(alpha).toMatchObject({
      toolName: "alpha",
      maxCalls: 2,
      windowMs: 1000,
      current: 0,
      remaining: 2,
    });

    const beta = manager.getToolStats("beta");
    expect(beta).toMatchObject({
      toolName: "beta",
      maxCalls: 5,
      windowMs: 250,
      current: 0,
      remaining: 5,
    });

    expect(manager.canCall("missing")).toBe(true);
  });

  it("tryCall enforces quotas and triggers warning/exceeded callbacks", () => {
    const clock = makeNowController(1000);
    const onQuotaWarning = vi.fn();
    const onQuotaExceeded = vi.fn();
    const manager = new ToolQuotaManager({
      defaultMaxCalls: 2,
      defaultWindowMs: 1000,
      onQuotaWarning,
      onQuotaExceeded,
    });

    const first = manager.tryCall("tool");
    expect(first).toEqual({ allowed: true, remaining: 1 });
    expect(onQuotaWarning).not.toHaveBeenCalled();

    clock.advance(1);
    const second = manager.tryCall("tool");
    expect(second).toEqual({ allowed: true, remaining: 0 });
    expect(onQuotaWarning).toHaveBeenCalledTimes(1);
    expect(onQuotaWarning.mock.calls[0][0]).toMatchObject({ toolName: "tool", usageRatio: 1 });

    clock.advance(1);
    const third = manager.tryCall("tool");
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.reason).toContain("Quota exceeded for tool: 2/2");

    expect(warnMock).toHaveBeenCalledWith(
      "Tool quota exceeded",
      expect.objectContaining({ toolName: "tool" }),
    );
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);

    const stats = manager.getToolStats("tool");
    expect(stats.totalCalls).toBe(2);
    expect(stats.blockedCount).toBe(1);
    expect(stats.lastBlocked).toBe(1002);

    clock.restore();
  });

  it("triggers warning callback at exactly 80% usage but getHighUsageTools requires > 80%", () => {
    const clock = makeNowController(0);
    const onQuotaWarning = vi.fn();
    const manager = new ToolQuotaManager({
      defaultMaxCalls: 5,
      defaultWindowMs: 1000,
      onQuotaWarning,
    });

    // 4/5 == 0.8
    for (let i = 0; i < 4; i += 1) manager.tryCall("edge");

    expect(onQuotaWarning).toHaveBeenCalledTimes(1);
    expect(onQuotaWarning.mock.calls[0][0]).toMatchObject({ toolName: "edge", usageRatio: 0.8 });
    expect(manager.getHighUsageTools().map((t) => t.toolName)).toEqual([]);

    manager.tryCall("edge"); // 5/5 == 1.0
    expect(onQuotaWarning).toHaveBeenCalledTimes(2);
    expect(manager.getHighUsageTools().map((t) => t.toolName)).toEqual(["edge"]);

    clock.restore();
  });

  it("cleans sliding window records once the window passes", () => {
    const clock = makeNowController(0);
    const manager = new ToolQuotaManager({ defaultMaxCalls: 1, defaultWindowMs: 1000 });

    expect(manager.tryCall("tool").allowed).toBe(true);

    clock.advance(500);
    expect(manager.tryCall("tool").allowed).toBe(false);

    clock.advance(600);
    expect(manager.tryCall("tool").allowed).toBe(true);

    clock.restore();
  });

  it("recordCall tracks counts even past the quota", () => {
    const clock = makeNowController(0);
    const manager = new ToolQuotaManager({ defaultMaxCalls: 1, defaultWindowMs: 1000 });

    manager.recordCall("tool");
    clock.advance(1);
    manager.recordCall("tool");

    const stats = manager.getToolStats("tool");
    expect(stats.current).toBe(2);
    expect(stats.totalCalls).toBe(2);
    expect(stats.blockedCount).toBe(0);
    expect(stats.lastBlocked).toBe(null);

    clock.restore();
  });

  it("recordCall returns updated stats and does not trigger warn/exceeded callbacks", () => {
    const clock = makeNowController(0);
    const onQuotaExceeded = vi.fn();
    const manager = new ToolQuotaManager({
      defaultMaxCalls: 1,
      defaultWindowMs: 1000,
      onQuotaExceeded,
    });

    const stats1 = manager.recordCall("tool");
    expect(stats1).toMatchObject({ toolName: "tool", current: 1, totalCalls: 1, blockedCount: 0 });

    clock.advance(1);
    const stats2 = manager.recordCall("tool");
    expect(stats2).toMatchObject({ toolName: "tool", current: 2, totalCalls: 2, blockedCount: 0 });

    expect(warnMock).not.toHaveBeenCalled();
    expect(onQuotaExceeded).not.toHaveBeenCalled();

    clock.restore();
  });

  it("reports blocked/high-usage tools and summary totals", () => {
    const clock = makeNowController(0);
    const manager = new ToolQuotaManager({ defaultMaxCalls: 10, defaultWindowMs: 1000 });
    manager.setQuota("blocked", { maxCalls: 1, windowMs: 1000 });

    for (let i = 0; i < 9; i += 1) {
      manager.tryCall("hot");
    }

    manager.tryCall("blocked");
    manager.tryCall("blocked");

    const blockedTools = manager.getBlockedTools();
    expect(blockedTools).toHaveLength(1);
    expect(blockedTools[0].toolName).toBe("blocked");

    const highUsageTools = manager.getHighUsageTools();
    const names = highUsageTools.map((tool) => tool.toolName).sort();
    expect(names).toEqual(["blocked", "hot"]);

    expect(manager.summary).toEqual({
      totalTools: 2,
      blockedTools: 1,
      highUsageTools: 2,
      totalCalls: 10,
      totalBlocked: 1,
    });

    clock.restore();
  });

  it("supports windowMs=0 edge case (records expire as soon as time advances)", () => {
    const clock = makeNowController(100);
    const manager = new ToolQuotaManager({ defaultMaxCalls: 1, defaultWindowMs: 0 });

    expect(manager.tryCall("tool")).toEqual({ allowed: true, remaining: 0 });
    expect(manager.tryCall("tool").allowed).toBe(false);

    clock.advance(1);
    expect(manager.tryCall("tool")).toEqual({ allowed: true, remaining: 0 });

    clock.restore();
  });

  it("resets and removes quotas", () => {
    const manager = new ToolQuotaManager({ defaultMaxCalls: 2, defaultWindowMs: 1000 });

    manager.tryCall("alpha");
    manager.tryCall("alpha");
    manager.tryCall("beta");

    manager.resetTool("alpha");
    expect(manager.getToolStats("alpha")).toMatchObject({
      current: 0,
      totalCalls: 0,
      blockedCount: 0,
    });

    manager.resetAll();
    expect(manager.getToolStats("beta")).toMatchObject({
      current: 0,
      totalCalls: 0,
      blockedCount: 0,
    });

    manager.removeQuota("beta");
    expect(manager.getToolStats("beta")).toBeNull();
    expect(manager.canCall("beta")).toBe(true);
  });

  it("summary is zeroed for an empty manager", () => {
    const manager = new ToolQuotaManager();
    expect(manager.summary).toEqual({
      totalTools: 0,
      blockedTools: 0,
      highUsageTools: 0,
      totalCalls: 0,
      totalBlocked: 0,
    });
  });

  it.each([
    { label: "empty string", toolName: "" },
    { label: "whitespace string", toolName: "   " },
    { label: "null", toolName: null },
    { label: "undefined", toolName: undefined },
    { label: "zero", toolName: 0 },
    { label: "negative", toolName: -1 },
    { label: "max safe integer", toolName: Number.MAX_SAFE_INTEGER },
    { label: "empty array", toolName: [] },
    { label: "empty object", toolName: {} },
  ])("accepts boundary tool names: $label", ({ toolName }) => {
    const manager = new ToolQuotaManager({ defaultMaxCalls: 1, defaultWindowMs: 1000 });

    const result = manager.tryCall(toolName);
    expect(result.allowed).toBe(true);

    const stats = manager.getToolStats(toolName);
    expect(stats).not.toBeNull();
    expect(stats.toolName).toBe(toolName);
  });

  it.each([
    { label: "zero", maxCalls: 0 },
    { label: "negative", maxCalls: -1 },
  ])("blocks immediately when maxCalls is $label", ({ maxCalls }) => {
    const clock = makeNowController(0);
    const manager = new ToolQuotaManager({ defaultMaxCalls: maxCalls, defaultWindowMs: 1000 });

    const result = manager.tryCall("tool");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(manager.getToolStats("tool").blockedCount).toBe(1);

    clock.restore();
  });

  it("handles fast consecutive calls with concurrent promises", async () => {
    const clock = makeNowController(0);
    const manager = new ToolQuotaManager({ defaultMaxCalls: 3, defaultWindowMs: 1000 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => manager.tryCall("fast"))),
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const blockedCount = results.filter((r) => !r.allowed).length;
    expect(allowedCount).toBe(3);
    expect(blockedCount).toBe(2);
    expect(manager.getToolStats("fast")).toMatchObject({ totalCalls: 3, blockedCount: 2 });

    clock.restore();
  });
});

describe("ContractValidator", () => {
  it("validates deep nested objects and reports deep errors", () => {
    const schema = makeDeepSchema(64);
    const validator = new ContractValidator(schema);

    const ok = validator.validate(makeDeepValue(64, "ok"));
    expect(ok.valid).toBe(true);
    expect(ok.errors).toEqual([]);

    const bad = validator.validate(makeDeepValue(64, ""));
    expect(bad.valid).toBe(false);
    expect(bad.errors[0]).toContain("length must be >=");
    expect(bad.errors[0]).toContain("leaf");
  });

  it("treats null/undefined as missing unless required=true", () => {
    const optionalString = new ContractValidator({ type: "string" });
    expect(optionalString.validate(null)).toEqual({ valid: true, errors: [] });
    expect(optionalString.validate(undefined)).toEqual({ valid: true, errors: [] });

    const requiredString = new ContractValidator({ type: "string", required: true });
    expect(requiredString.validate(null).valid).toBe(false);
    expect(requiredString.validate(undefined).valid).toBe(false);
  });

  it("handles null/undefined/empty strings with required rules", () => {
    const validator = new ContractValidator({ type: "string", required: true, minLength: 1 });

    const nullResult = validator.validate(null);
    expect(nullResult.valid).toBe(false);
    expect(nullResult.errors[0]).toContain("required but missing");

    const undefinedResult = validator.validate(undefined);
    expect(undefinedResult.valid).toBe(false);
    expect(undefinedResult.errors[0]).toContain("required but missing");

    const emptyResult = validator.validate("");
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors[0]).toContain("length must be >=");

    const whitespaceResult = validator.validate("   ");
    expect(whitespaceResult.valid).toBe(true);
  });

  it("validates required object properties (schema.required as array) and reports missing/invalid fields", () => {
    const validator = new ContractValidator({
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", minLength: 1 } },
    });

    const missing = validator.validate({});
    expect(missing.valid).toBe(false);
    expect(missing.errors).toContain(".name: required property missing");

    const empty = validator.validate({ name: "" });
    expect(empty.valid).toBe(false);
    expect(empty.errors[0]).toContain(".name: length must be >=");

    const ok = validator.validate({ name: "x" });
    expect(ok).toEqual({ valid: true, errors: [] });
  });

  it("accepts empty arrays/objects and large arrays", () => {
    const arrayValidator = new ContractValidator({ type: "array", items: { type: "number" } });
    expect(arrayValidator.validate([]).valid).toBe(true);

    // Resource boundary: simulate "large file" sized payload.
    const largeArray = Array.from({ length: 50_000 }, (_, i) => i);
    const largeResult = arrayValidator.validate(largeArray);
    expect(largeResult).toEqual({ valid: true, errors: [] });

    const objectValidator = new ContractValidator({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(objectValidator.validate({}).valid).toBe(true);
  });

  it("reports type mismatches for string-as-number and object-as-array", () => {
    const numberValidator = new ContractValidator({ type: "number" });
    const numberResult = numberValidator.validate("5");
    expect(numberResult.valid).toBe(false);
    expect(numberResult.errors[0]).toContain("expected number, got string");

    const arrayValidator = new ContractValidator({ type: "array", items: { type: "number" } });
    const objectResult = arrayValidator.validate({});
    expect(objectResult.valid).toBe(false);
    expect(objectResult.errors[0]).toContain("expected array, got object");

    const itemResult = arrayValidator.validate([1, "x"]);
    expect(itemResult.valid).toBe(false);
    expect(itemResult.errors[0]).toContain("[1]");
  });

  it("validates enums and numeric bounds including MAX_SAFE_INTEGER", () => {
    const validator = new ContractValidator({
      type: "number",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      enum: [0, 1, Number.MAX_SAFE_INTEGER],
    });

    const ok = validator.validate(Number.MAX_SAFE_INTEGER);
    expect(ok.valid).toBe(true);

    const bad = validator.validate(-1);
    expect(bad.valid).toBe(false);
    expect(bad.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must be one of"),
        expect.stringContaining("must be >= 0"),
      ]),
    );
  });

  it("validates string length and pattern with createSafeRegex", () => {
    const validator = new ContractValidator({
      type: "string",
      minLength: 2,
      maxLength: 5,
      pattern: "^a+$",
    });

    const ok = validator.validate("aa");
    expect(ok.valid).toBe(true);

    const patternFail = validator.validate("bbb");
    expect(patternFail.valid).toBe(false);
    expect(patternFail.errors).toContain("root: must match pattern ^a+$");

    const longValue = makeLargeString(10);
    const longResult = validator.validate(longValue);
    expect(longResult.valid).toBe(false);
    expect(longResult.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("length must be <=")]),
    );

    expect(createSafeRegexMock).toHaveBeenCalledWith("^a+$", "u");
  });

  it("handles very long strings (resource boundary) without throwing", () => {
    const validator = new ContractValidator({ type: "string", maxLength: 10 });

    // "super large file" analog: 1MB string
    const huge = makeLargeString(1_000_000);
    const result = validator.validate(huge);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([expect.stringContaining("length must be <=")]);
  });

  it("reports invalid regex patterns as errors", () => {
    createSafeRegexMock.mockImplementationOnce(() => {
      throw new Error("bad pattern");
    });
    const validator = new ContractValidator({ type: "string", pattern: "(" });

    const result = validator.validate("value");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("invalid pattern");
    expect(result.errors[0]).toContain("bad pattern");
  });
});

describe("createToolContract", () => {
  it("validates input/output separately and together", () => {
    const inputSchema = { type: "string", minLength: 1 };
    const outputSchema = { type: "number", minimum: 0 };
    const contract = createToolContract(inputSchema, outputSchema);

    expect(contract.validateInput("ok")).toEqual({ valid: true, errors: [] });
    expect(contract.validateOutput(1)).toEqual({ valid: true, errors: [] });

    const badInput = contract.validateInput("");
    expect(badInput.valid).toBe(false);
    expect(badInput.errors[0]).toContain("length must be >=");

    const combined = contract.validate("", -1);
    expect(combined.valid).toBe(false);
    expect(combined.inputErrors[0]).toContain("length must be >=");
    expect(combined.outputErrors[0]).toContain("must be >= 0");
  });

  it("propagates required errors through validateOutput", () => {
    const contract = createToolContract(null, { type: "number", required: true });

    const result = contract.validateOutput(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["root: required but missing"]);
  });

  it("treats missing schemas as permissive for empty values", () => {
    const contract = createToolContract(null, undefined);

    expect(contract.validate(null, undefined)).toEqual({
      valid: true,
      inputErrors: [],
      outputErrors: [],
    });

    expect(contract.validateInput("")).toEqual({ valid: true, errors: [] });
    expect(contract.validateOutput({})).toEqual({ valid: true, errors: [] });
  });
});
