import { describe, it, expect, vi, beforeEach } from "vitest";

const { isPlainObjectMock, createLoggerMock, checkCancelledMock, parseJsonStrictMock, loggerInstance } = vi.hoisted(
  () => {
    const loggerInstance = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    return {
      isPlainObjectMock: vi.fn(),
      createLoggerMock: vi.fn(() => loggerInstance),
      checkCancelledMock: vi.fn(),
      parseJsonStrictMock: vi.fn(),
      loggerInstance,
    };
  },
);

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => ({
  isPlainObject: isPlainObjectMock,
}));

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: createLoggerMock,
}));

vi.mock("../../../../../js/agents/shared/utils/cancellation.js", () => ({
  checkCancelled: checkCancelledMock,
}));

vi.mock("../../../../../js/agents/shared/utils/robust-json.js", () => ({
  parseJsonStrict: parseJsonStrictMock,
}));

import { StageApiSpec, validateStageApi } from "../../../../../js/agents/shared/utils/stage-api.js";

function isPlainObjectShim(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function makeDeepObject(depth) {
  let root = {};
  let node = root;
  for (let i = 0; i < depth; i++) {
    node.next = {};
    node = node.next;
  }
  return root;
}

beforeEach(() => {
  isPlainObjectMock.mockReset();
  checkCancelledMock.mockReset();
  parseJsonStrictMock.mockReset();
  createLoggerMock.mockClear();

  loggerInstance.debug.mockClear();
  loggerInstance.info.mockClear();
  loggerInstance.warn.mockClear();
  loggerInstance.error.mockClear();

  isPlainObjectMock.mockImplementation(isPlainObjectShim);
});

describe("StageApiSpec", () => {
  it("defines required fields and optional defaults", () => {
    expect(StageApiSpec).toBeTruthy();
    expect(StageApiSpec).toHaveProperty("required");
    expect(Array.isArray(StageApiSpec.required)).toBe(true);
    expect(StageApiSpec.required).toEqual(expect.arrayContaining(["signal"]));

    expect(StageApiSpec).toHaveProperty("optional");
    expect(StageApiSpec.optional).toBeTruthy();
    expect(typeof StageApiSpec.optional).toBe("object");
    expect(Array.isArray(StageApiSpec.optional)).toBe(false);

    const optionalKeys = [
      "emit",
      "eventBus",
      "modelRouter",
      "aiApiService",
      "localRetriever",
      "externalSearchProvider",
      "logger",
      "checkCancelled",
      "runTool",
    ];

    for (const key of optionalKeys) {
      expect(StageApiSpec.optional).toHaveProperty(key, null);
    }
  });
});

describe("validateStageApi", () => {
  it("rejects non-object inputs (null/undefined/primitives/arrays/functions)", () => {
    const cases = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      [],
      ["x"],
      () => {},
    ];

    for (const api of cases) {
      expect(validateStageApi(api)).toEqual({
        valid: false,
        missing: ["stageApi must be an object"],
        warnings: [],
      });
    }
  });

  it("marks missing required fields on empty objects", () => {
    expect(validateStageApi({})).toEqual({
      valid: false,
      missing: ["signal"],
      warnings: [],
    });

    expect(validateStageApi({ signal: undefined })).toEqual({
      valid: false,
      missing: ["signal"],
      warnings: [],
    });
  });

  it("treats boundary signal values as present (null/0/-1/MAX_SAFE_INTEGER/whitespace)", () => {
    const cases = [null, 0, -1, Number.MAX_SAFE_INTEGER, "0", "   "];

    for (const signal of cases) {
      expect(validateStageApi({ signal })).toEqual({
        valid: true,
        missing: [],
        warnings: [],
      });
    }
  });

  it("accepts object-like inputs even when not plain objects", () => {
    isPlainObjectMock.mockReturnValueOnce(false);

    const result = validateStageApi({ signal: "ok" });
    expect(result).toEqual({ valid: true, missing: [], warnings: [] });
  });

  it("adds warnings for invalid optional contracts (type boundaries included)", () => {
    const result = validateStageApi({
      signal: 1,
      emit: "not-a-function",
      modelRouter: [],
      aiApiService: { chat: "nope" },
    });

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "emit should be a function",
        "modelRouter.call should be a function",
        "aiApiService.chat should be a function",
      ]),
    );
    expect(result.warnings).toHaveLength(3);
  });

  it("skips warnings for falsey placeholders (empty string / 0)", () => {
    const result = validateStageApi({
      signal: 1,
      emit: "",
      modelRouter: 0,
      aiApiService: "",
    });

    expect(result).toEqual({ valid: true, missing: [], warnings: [] });
  });

  it("handles long strings, large arrays, and deep nesting without throwing", () => {
    const veryLongString = "x".repeat(100_001);
    const deep = makeDeepObject(200);
    const bigArray = Array.from({ length: 20_000 }, (_, i) => i);

    const api = {
      signal: deep,
      emit: veryLongString,
      modelRouter: bigArray,
      aiApiService: { chat: async () => ({ ok: true }) },
      extra: { deep },
    };

    expect(() => validateStageApi(api)).not.toThrow();

    const result = validateStageApi(api);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining(["emit should be a function", "modelRouter.call should be a function"]),
    );
    expect(result.warnings).toHaveLength(2);
  });

  it("is deterministic under concurrent and rapid consecutive calls", async () => {
    const inputs = [
      { signal: 1 },
      { signal: 1, emit: 123 },
      {},
      null,
      { signal: "123" },
    ];

    const concurrent = await Promise.all(inputs.map((api) => Promise.resolve(validateStageApi(api))));

    expect(concurrent[0]).toEqual({ valid: true, missing: [], warnings: [] });
    expect(concurrent[1].valid).toBe(true);
    expect(concurrent[1].warnings).toEqual(expect.arrayContaining(["emit should be a function"]));
    expect(concurrent[2]).toEqual({ valid: false, missing: ["signal"], warnings: [] });
    expect(concurrent[3]).toEqual({ valid: false, missing: ["stageApi must be an object"], warnings: [] });
    expect(concurrent[4]).toEqual({ valid: true, missing: [], warnings: [] });

    const a = validateStageApi({ signal: 0 });
    const b = validateStageApi({ signal: 0 });
    expect(a).toEqual(b);
    expect(a.missing).not.toBe(b.missing);
    expect(a.warnings).not.toBe(b.warnings);

    for (let i = 0; i < 100; i++) {
      const r = validateStageApi({ signal: i });
      expect(r).toEqual({ valid: true, missing: [], warnings: [] });
    }
  });
});