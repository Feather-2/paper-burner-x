import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const mockLogger = { warn: vi.fn() };
  return {
    mockLogger,
    mockCreateLogger: vi.fn(() => mockLogger),
    mockParseJsonStrict: vi.fn(),
    mockCheckCancelled: vi.fn(),
    mockIsPlainObject: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: mocks.mockCreateLogger,
}));

vi.mock("../../../../../js/agents/shared/utils/robust-json.js", () => ({
  parseJsonStrict: (...args) => mocks.mockParseJsonStrict(...args),
}));

vi.mock("../../../../../js/agents/shared/utils/cancellation.js", () => ({
  checkCancelled: (...args) => mocks.mockCheckCancelled(...args),
}));

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => ({
  isPlainObject: (...args) => mocks.mockIsPlainObject(...args),
}));

const loadStageApi = async () => {
  return await import("../../../../../js/agents/shared/utils/stage-api.js");
};

beforeEach(() => {
  vi.resetModules();
  mocks.mockLogger.warn.mockReset();
  mocks.mockCreateLogger.mockClear();
  mocks.mockParseJsonStrict.mockReset();
  mocks.mockCheckCancelled.mockReset();
  mocks.mockIsPlainObject.mockReset();

  mocks.mockIsPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  mocks.mockCheckCancelled.mockImplementation((signal) => {
    if (signal?.aborted) {
      const err = new Error(signal.reason || "cancelled");
      err.name = "AbortError";
      throw err;
    }
  });

  mocks.mockParseJsonStrict.mockImplementation((text, { maxChars } = {}) => {
    if (typeof text !== "string") {
      return { ok: true, data: text };
    }
    if (typeof maxChars === "number" && text.length > maxChars) {
      return { ok: false, code: "too_long", error: new Error("too long") };
    }
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch (error) {
      return { ok: false, code: "invalid_json", error };
    }
  });
});

describe("StageApiSpec", () => {
  it("defines required and optional fields", async () => {
    const { StageApiSpec } = await loadStageApi();

    expect(StageApiSpec.required).toEqual(["signal"]);
    expect(StageApiSpec.optional).toEqual({
      emit: null,
      eventBus: null,
      modelRouter: null,
      aiApiService: null,
      localRetriever: null,
      externalSearchProvider: null,
      logger: null,
      checkCancelled: null,
      runTool: null,
    });
  });
});

describe("validateStageApi", () => {
  it("rejects null/undefined/empty string/empty array/non-objects", async () => {
    const { validateStageApi } = await loadStageApi();
    const cases = [null, undefined, "", [], 0];

    for (const value of cases) {
      const out = validateStageApi(value);
      expect(out).toEqual({ valid: false, missing: ["stageApi must be an object"], warnings: [] });
    }
  });

  it("flags missing required fields for empty and object-like inputs", async () => {
    const { validateStageApi } = await loadStageApi();

    const emptyOut = validateStageApi({});
    expect(emptyOut.valid).toBe(false);
    expect(emptyOut.missing).toEqual(["signal"]);
    expect(emptyOut.warnings).toEqual([]);

    const objectLikeOut = validateStageApi(new (class Foo {})());
    expect(objectLikeOut.valid).toBe(false);
    expect(objectLikeOut.missing).toEqual(["signal"]);
  });

  it("emits warnings for invalid optional field types with boundary values", async () => {
    const { validateStageApi } = await loadStageApi();
    const controller = new AbortController();

    const out = validateStageApi({
      signal: controller.signal,
      emit: 0,
      modelRouter: { call: Number.MAX_SAFE_INTEGER },
      aiApiService: { chat: -1 },
    });

    expect(out.valid).toBe(true);
    expect(out.warnings).toEqual([
      "modelRouter.call should be a function",
      "aiApiService.chat should be a function",
    ]);
    expect(out.warnings).not.toContain("emit should be a function");
  });

  it("warns when emit is whitespace string and accepts valid api", async () => {
    const { validateStageApi } = await loadStageApi();
    const controller = new AbortController();

    const out = validateStageApi({
      signal: controller.signal,
      emit: "   ",
    });

    expect(out.valid).toBe(true);
    expect(out.warnings).toEqual(["emit should be a function"]);

    const ok = validateStageApi({
      signal: controller.signal,
      emit: () => {},
      modelRouter: { call: () => Promise.resolve() },
      aiApiService: { chat: () => Promise.resolve() },
    });

    expect(ok.valid).toBe(true);
    expect(ok.missing).toEqual([]);
    expect(ok.warnings).toEqual([]);
  });
});

describe("createStageApi", () => {
  it("fills defaults for null/undefined and wires checkCancelled", async () => {
    const { createStageApi } = await loadStageApi();

    const api = createStageApi(null);
    expect(api.signal).toBeInstanceOf(AbortSignal);
    expect(typeof api.emit).toBe("function");
    expect(typeof api.checkCancelled).toBe("function");
    expect(api.aiApiService).toBe(null);
    expect(api.externalSearchProvider).toBe(null);

    api.checkCancelled();
    expect(mocks.mockCheckCancelled).toHaveBeenCalledWith(api.signal);
  });

  it("resolves emit from direct emit or eventBus", async () => {
    const { createStageApi } = await loadStageApi();

    const calls = [];
    const partial = {
      emit(name, record) {
        calls.push({ name, record, thisValue: this });
      },
    };

    const api = createStageApi(partial);
    api.emit("evt", { ok: true });
    expect(calls[0]).toEqual({ name: "evt", record: { ok: true }, thisValue: api });

    const busCalls = [];
    const eventBus = {
      emit(name, record) {
        busCalls.push({ name, record, thisValue: this });
      },
    };

    const apiFromBus = createStageApi({ emit: "", eventBus });
    apiFromBus.emit("bus", { ok: false });
    expect(busCalls[0]).toEqual({ name: "bus", record: { ok: false }, thisValue: eventBus });
  });

  it("preserves null optional values and respects provided checkCancelled", async () => {
    const { createStageApi } = await loadStageApi();
    const customCheck = vi.fn();

    const api = createStageApi({
      localRetriever: undefined,
      externalSearchProvider: null,
      checkCancelled: customCheck,
    });

    expect(api.localRetriever).toBe(null);
    expect(api.externalSearchProvider).toBe(null);
    expect(api.checkCancelled).toBe(customCheck);
  });

  it("uses cancellation checks and logs warnings in strict mode", async () => {
    const { createStageApi } = await loadStageApi();
    const controller = new AbortController();
    controller.abort("stop");

    const api = createStageApi({ signal: controller.signal });
    expect(() => api.checkCancelled()).toThrow(/stop|cancelled/i);

    const strictApi = createStageApi(
      { signal: controller.signal, modelRouter: { call: "bad" }, aiApiService: { chat: -1 } },
      { strict: true }
    );

    expect(strictApi.signal).toBe(controller.signal);
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith("stageApi warnings:", {
      warnings: ["modelRouter.call should be a function", "aiApiService.chat should be a function"],
    });
  });
});

describe("extractServices", () => {
  it("returns safe fallbacks for null/empty inputs", async () => {
    const { extractServices } = await loadStageApi();

    const empty = extractServices(null);
    expect(empty.signal).toBe(null);
    expect(empty.eventBus).toBe(null);
    expect(empty.runTool).toBe(null);
    expect(typeof empty.emit).toBe("function");

    empty.checkCancelled();
    expect(mocks.mockCheckCancelled).toHaveBeenCalledWith(null);
  });

  it("binds emit to stageApi emit or eventBus", async () => {
    const { extractServices } = await loadStageApi();

    const calls = [];
    const stageApi = {
      emit(name, record) {
        calls.push({ name, record, thisValue: this });
      },
    };

    const direct = extractServices(stageApi);
    direct.emit("evt", { ok: true });
    expect(calls[0]).toEqual({ name: "evt", record: { ok: true }, thisValue: stageApi });

    const busCalls = [];
    const eventBus = {
      emit(name, record) {
        busCalls.push({ name, record, thisValue: this });
      },
    };

    const fromBus = extractServices({ eventBus });
    fromBus.emit("bus", { ok: false });
    expect(busCalls[0]).toEqual({ name: "bus", record: { ok: false }, thisValue: eventBus });
  });

  it("passes through runTool and checkCancelled when provided", async () => {
    const { extractServices } = await loadStageApi();
    const runTool = vi.fn();
    const checkCancelled = vi.fn();

    const services = extractServices({ runTool, checkCancelled, emit: null });
    expect(services.runTool).toBe(runTool);
    expect(services.checkCancelled).toBe(checkCancelled);
  });
});

describe("mergeStageApis", () => {
  it("merges non-null values and returns a complete api", async () => {
    const { mergeStageApis } = await loadStageApi();

    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const busA = { emit: () => {} };
    const busB = { emit: () => {} };

    const merged = mergeStageApis(
      { signal: controllerA.signal, eventBus: busA, logger: null },
      { signal: controllerB.signal, eventBus: null, modelRouter: { call: vi.fn() } },
      { eventBus: busB }
    );

    expect(merged.signal).toBe(controllerB.signal);
    expect(merged.eventBus).toBe(busB);
    expect(merged.modelRouter).toEqual({ call: expect.any(Function) });
    expect(merged.logger).toBe(null);
    expect(typeof merged.emit).toBe("function");
    expect(typeof merged.checkCancelled).toBe("function");
  });

  it("handles empty input by returning defaults", async () => {
    const { mergeStageApis } = await loadStageApi();
    const merged = mergeStageApis();

    expect(merged.signal).toBeInstanceOf(AbortSignal);
    expect(typeof merged.emit).toBe("function");
  });
});

describe("createChildApi", () => {
  it("inherits parent values and allows overrides", async () => {
    const { createChildApi } = await loadStageApi();

    const controller = new AbortController();
    const parent = {
      signal: controller.signal,
      logger: { info: vi.fn() },
      eventBus: { emit: vi.fn() },
    };

    const child = createChildApi(parent, {
      externalSearchProvider: { search: vi.fn() },
      eventBus: { emit: vi.fn() },
    });

    expect(child.signal).toBe(controller.signal);
    expect(child.logger).toBe(parent.logger);
    expect(child.eventBus).not.toBe(parent.eventBus);
    expect(child.externalSearchProvider).toEqual({ search: expect.any(Function) });
  });

  it("handles null parent by still creating defaults", async () => {
    const { createChildApi } = await loadStageApi();

    const child = createChildApi(null, { logger: { warn: vi.fn() } });
    expect(child.signal).toBeInstanceOf(AbortSignal);
    expect(child.logger).toEqual({ warn: expect.any(Function) });
  });
});

describe("createRunTool", () => {
  it("returns null when modelRouter is missing or invalid", async () => {
    const { createRunTool } = await loadStageApi();

    expect(createRunTool()).toBe(null);
    expect(createRunTool({ modelRouter: {} })).toBe(null);
    expect(createRunTool({ modelRouter: { call: "nope" } })).toBe(null);
  });

  it("throws for unknown tool names", async () => {
    const { createRunTool } = await loadStageApi();
    const runTool = createRunTool({ modelRouter: { call: vi.fn() } });

    await expect(runTool("nope", {})).rejects.toThrow("Unknown tool: nope");
  });

  it("calls modelRouter with expected payload and returns parsed output for deep nested args", async () => {
    const { createRunTool } = await loadStageApi();

    const output = {
      mergedClaims: [
        {
          id: "m1",
          text: "",
          importance: "core",
          sourceIds: [],
        },
      ],
    };

    const modelRouter = {
      call: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    };

    const signal = new AbortController().signal;
    const runTool = createRunTool({ modelRouter, signal });

    const args = {
      claims: [
        {
          id: "c1",
          text: "claim",
          importance: "core",
          meta: { nested: { level: { value: 0, alt: -1, big: Number.MAX_SAFE_INTEGER } } },
        },
      ],
      note: "   ",
    };

    const result = await runTool("synthesize_claims", args);
    expect(result).toEqual(output);

    const callArgs = modelRouter.call.mock.calls[0][0];
    expect(callArgs.taskType).toBe("tool_call");
    expect(callArgs.responseFormat).toEqual({ type: "json_object" });
    expect(callArgs.signal).toBe(signal);
    expect(callArgs.messages[1]).toEqual({ role: "user", content: JSON.stringify(args) });

    expect(mocks.mockParseJsonStrict).toHaveBeenCalledWith(JSON.stringify(output), { maxChars: 100000 });
  });

  it("accepts non-string content without parsing", async () => {
    const { createRunTool } = await loadStageApi();

    const output = {
      conflicts: [
        {
          claimId1: "a",
          claimId2: "b",
          reason: "conflict",
          resolutionTask: "resolve",
        },
      ],
    };

    const modelRouter = {
      call: vi.fn().mockResolvedValue({ content: output }),
    };

    const runTool = createRunTool({ modelRouter });
    const result = await runTool("analyze_conflicts", { pairs: [] });

    expect(result).toEqual(output);
    expect(mocks.mockParseJsonStrict).not.toHaveBeenCalled();
  });

  it("throws on oversized/long-string output and logs warning", async () => {
    const { createRunTool } = await loadStageApi();

    const longContent = "x".repeat(100_001);
    const warn = vi.fn();
    const modelRouter = {
      call: vi.fn().mockResolvedValue({
        choices: [{ message: { content: longContent } }],
      }),
    };

    const runTool = createRunTool({ modelRouter, logger: { warn } });

    await expect(runTool("synthesize_claims", { claims: [] })).rejects.toThrow("invalid JSON: too_long");
    expect(mocks.mockParseJsonStrict).toHaveBeenCalledWith(longContent, { maxChars: 100000 });
    expect(warn).toHaveBeenCalledWith("runTool(synthesize_claims) failed:", expect.any(String));
  });

  it("rejects invalid output types (object vs array, number vs string)", async () => {
    const { createRunTool } = await loadStageApi();

    const invalidOutput = {
      mergedClaims: [
        {
          id: 0,
          text: "ok",
          importance: "core",
          sourceIds: {},
        },
      ],
    };

    const modelRouter = {
      call: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(invalidOutput) } }],
      }),
    };

    const runTool = createRunTool({ modelRouter, logger: { warn: vi.fn() } });

    const err = await runTool("synthesize_claims", { claims: [] }).catch((error) => error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("invalid output");
    expect(err.cause).toEqual(
      expect.arrayContaining([
        "output.mergedClaims[0].id: expected string",
        "output.mergedClaims[0].sourceIds: expected array",
      ])
    );
  });

  it("caps validation errors for large invalid outputs", async () => {
    const { createRunTool } = await loadStageApi();

    const invalidOutput = {
      mergedClaims: Array.from({ length: 6 }, () => ({})),
    };

    const modelRouter = {
      call: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(invalidOutput) } }],
      }),
    };

    const runTool = createRunTool({ modelRouter, logger: { warn: vi.fn() } });

    const err = await runTool("synthesize_claims", { claims: [] }).catch((error) => error);
    expect(err.message).toContain("invalid output");
    expect(Array.isArray(err.cause)).toBe(true);
    expect(err.cause).toHaveLength(8);
  });

  it("supports concurrent calls with independent results", async () => {
    const { createRunTool } = await loadStageApi();

    const resolvers = [];
    const modelRouter = {
      call: vi.fn(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          })
      ),
    };

    const runTool = createRunTool({ modelRouter });

    const first = runTool("synthesize_claims", { claims: [] });
    const second = runTool("synthesize_claims", { claims: [] });

    resolvers[1]({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mergedClaims: [
                { id: "b", text: "", importance: "support", sourceIds: [] },
              ],
            }),
          },
        },
      ],
    });

    resolvers[0]({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mergedClaims: [
                { id: "a", text: "", importance: "core", sourceIds: [] },
              ],
            }),
          },
        },
      ],
    });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.mergedClaims[0].id).toBe("a");
    expect(r2.mergedClaims[0].id).toBe("b");
  });

  it("handles rapid consecutive calls", async () => {
    const { createRunTool } = await loadStageApi();

    const output = {
      mergedClaims: [
        {
          id: "m1",
          text: "",
          importance: "core",
          sourceIds: [],
        },
      ],
    };

    const modelRouter = {
      call: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
    };

    const runTool = createRunTool({ modelRouter });

    await runTool("synthesize_claims", { claims: [] });
    await runTool("synthesize_claims", { claims: [] });
    await runTool("synthesize_claims", { claims: [] });

    expect(modelRouter.call).toHaveBeenCalledTimes(3);
    expect(mocks.mockParseJsonStrict).toHaveBeenCalledTimes(3);
  });
});
