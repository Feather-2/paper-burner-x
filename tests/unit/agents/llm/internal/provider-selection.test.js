// Unit tests for provider-selection helpers with mocked dependencies and boundary coverage.
// Focuses on edge cases, error paths, and concurrency to stabilize routing behavior.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAssertChatMessages = vi.hoisted(() => vi.fn());
const mockModelUsage = vi.hoisted(() => ({
  WORKER: "worker",
  VISION: "vision",
  ANALYST: "analyst",
}));
const mockIsValidModelUsage = vi.hoisted(() =>
  vi.fn((value) => Object.values(mockModelUsage).includes(value))
);
const mockToNonEmptyString = vi.hoisted(() =>
  vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  })
);

vi.mock("../../../../../js/agents/llm/provider.js", () => ({
  assertChatMessages: mockAssertChatMessages,
}));

vi.mock("../../../../../js/agents/llm/constants.js", () => ({
  ModelUsage: mockModelUsage,
  isValidModelUsage: mockIsValidModelUsage,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: mockToNonEmptyString,
}));

import {
  rotateFromIndex,
  extractPromptText,
  getRequiredTags,
  supportsTags,
  findNextCandidate,
  prepareCallContext,
} from "../../../../../js/agents/llm/internal/provider-selection.js";

import { ModelUsage } from "../../../../../js/agents/llm/constants.js";
import { assertChatMessages } from "../../../../../js/agents/llm/provider.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsValidModelUsage.mockImplementation((value) => Object.values(mockModelUsage).includes(value));
  mockToNonEmptyString.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });
  mockAssertChatMessages.mockImplementation(() => {});
});

const buildBaseInput = (overrides = {}) => {
  return {
    usage: "worker",
    messages: [{ role: "user", content: "hello" }],
    images: [],
    waitRetryCount: 0,
    usageConfig: {
      worker: ["m1", "m2", "m3"],
      vision: ["v1"],
    },
    usageTags: new Map([
      ["worker", ["alpha"]],
      ["vision", ["beta"]],
    ]),
    logger: { warn: vi.fn() },
    strategy: "priority",
    rrNextIndexByUsage: new Map(),
    usePerformanceRouting: false,
    beforeCandidates: vi.fn(),
    ...overrides,
  };
};

describe("rotateFromIndex", () => {
  it("returns empty array for non-array input and handles empty/singleton arrays", () => {
    expect(rotateFromIndex(null, 0)).toEqual([]);
    expect(rotateFromIndex(undefined, 1)).toEqual([]);
    expect(rotateFromIndex({ length: 2, 0: "a" }, 1)).toEqual([]);

    const empty = [];
    const emptyOut = rotateFromIndex(empty, -1);
    expect(emptyOut).toEqual([]);
    expect(emptyOut).not.toBe(empty);

    const single = ["only"];
    const singleOut = rotateFromIndex(single, 99);
    expect(singleOut).toEqual(["only"]);
    expect(singleOut).not.toBe(single);
  });

  it("rotates with negative, string, and huge indexes", () => {
    const list = ["a", "b", "c", "d"];
    expect(rotateFromIndex(list, -1)).toEqual(["d", "a", "b", "c"]);
    expect(rotateFromIndex(list, "2")).toEqual(["c", "d", "a", "b"]);
    expect(rotateFromIndex(list, Number.MAX_SAFE_INTEGER)).toEqual(["d", "a", "b", "c"]);
  });

  it("handles large arrays and concurrent calls", async () => {
    const big = Array.from({ length: 10000 }, (_, i) => i);
    const results = await Promise.all([
      Promise.resolve().then(() => rotateFromIndex(big, 9999)),
      Promise.resolve().then(() => rotateFromIndex(big, 0)),
    ]);

    expect(results[0]).toHaveLength(10000);
    expect(results[0][0]).toBe(9999);
    expect(results[1]).toHaveLength(10000);
    expect(results[1][0]).toBe(0);
  });
});

describe("extractPromptText", () => {
  it("returns empty string for non-array or empty messages", () => {
    const inputs = [null, undefined, "", {}, []];
    for (const input of inputs) {
      expect(extractPromptText(input)).toBe("");
    }
  });

  it("collects mixed content types and preserves ordering", () => {
    const messages = [
      { content: "hello" },
      { content: ["", "world", { text: "from" }, { content: "array" }, null] },
      { content: { deep: { nested: { value: "x" } } } },
      { content: 0 },
    ];
    const result = extractPromptText(messages);
    expect(result).toBe(
      'hello\nworld\nfrom\narray\n{"deep":{"nested":{"value":"x"}}}\n0'
    );
  });

  it("falls back to String when JSON serialization fails", () => {
    const circular = {};
    circular.self = circular;
    circular.toString = () => "circular";
    const result = extractPromptText([{ content: circular }]);
    expect(result).toBe("circular");
  });

  it("handles very long strings and concurrent calls", async () => {
    const longText = "x".repeat(50000);
    const messages = [{ content: longText }];
    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => extractPromptText(messages)))
    );
    for (const result of results) {
      expect(result).toBe(longText);
    }
  });
});

describe("getRequiredTags", () => {
  it("defaults to worker/text for empty input and blank usage", () => {
    const tags1 = getRequiredTags();
    expect(tags1.has("text")).toBe(true);
    expect(tags1.has("vision")).toBe(false);

    const usageTags = new Map([["worker", ["fast"]]]);
    const tags2 = getRequiredTags({ usage: "   ", usageTags });
    expect(tags2.has("text")).toBe(true);
    expect(tags2.has("fast")).toBe(true);
  });

  it("uses vision when images are present or usage is vision", () => {
    const tags1 = getRequiredTags({ usage: "worker", images: [{}] });
    expect(tags1.has("vision")).toBe(true);
    expect(tags1.has("text")).toBe(false);

    const tags2 = getRequiredTags({ usage: ModelUsage.VISION, images: [] });
    expect(tags2.has("vision")).toBe(true);
    expect(tags2.has("text")).toBe(false);
  });

  it("merges extra tags and avoids duplicates for custom usage", () => {
    const usageTags = new Map([["custom", ["text", "alpha", "alpha"]]]);
    const tags = getRequiredTags({ usage: "custom", usageTags, images: [] });
    expect(tags.has("text")).toBe(true);
    expect(tags.has("alpha")).toBe(true);
    expect(Array.from(tags).filter((t) => t === "alpha")).toHaveLength(1);
  });
});

describe("supportsTags", () => {
  it("returns true when no required tags are specified", () => {
    expect(supportsTags(null, new Set())).toBe(true);
    expect(supportsTags({ tags: null }, new Set())).toBe(true);
  });

  it("returns false when required tags are missing", () => {
    const required = new Set(["text", "vision"]);
    expect(supportsTags({ tags: ["text"] }, required)).toBe(false);
  });

  it("handles non-array tags and duplicate tags", () => {
    const required = new Set(["text"]);
    expect(supportsTags({ tags: {} }, required)).toBe(false);
    expect(supportsTags({ tags: ["text", "text"] }, required)).toBe(true);
  });
});

describe("findNextCandidate", () => {
  it("returns the first candidate that matches tags and availability", () => {
    const candidates = ["m1", "m2", "m3"];
    const models = new Map([
      ["m1", { tags: ["text"] }],
      ["m2", { tags: ["vision"] }],
      ["m3", { tags: ["vision"] }],
    ]);
    const requiredTags = new Set(["vision"]);
    const isAvailable = vi.fn((id) => id === "m2");

    expect(
      findNextCandidate({
        fromIndex: 0,
        candidates,
        requiredTags,
        models,
        isAvailable,
      })
    ).toBe("m2");
  });

  it("skips missing entries and unavailable models, even with negative start", () => {
    const candidates = ["missing", "down", "ok"];
    const models = new Map([
      ["down", { tags: ["text"] }],
      ["ok", { tags: ["text"] }],
    ]);
    const requiredTags = new Set(["text"]);
    const isAvailable = vi.fn((id) => id === "ok");

    expect(
      findNextCandidate({
        fromIndex: -1,
        candidates,
        requiredTags,
        models,
        isAvailable,
      })
    ).toBe("ok");
  });

  it("returns null when start index is beyond candidates", () => {
    const candidates = ["m1"];
    const models = new Map([["m1", { tags: ["text"] }]]);
    const requiredTags = new Set(["text"]);
    const isAvailable = vi.fn(() => true);

    expect(
      findNextCandidate({
        fromIndex: 2,
        candidates,
        requiredTags,
        models,
        isAvailable,
      })
    ).toBeNull();
  });
});

describe("prepareCallContext", () => {
  it("throws for missing or blank usage", () => {
    const base = buildBaseInput();
    const cases = [undefined, "", "   "];
    for (const usage of cases) {
      expect(() => prepareCallContext(buildBaseInput({ ...base, usage }))).toThrow(TypeError);
    }
  });

  it("warns on unknown usage and still prepares context", () => {
    mockIsValidModelUsage.mockReturnValue(false);
    const input = buildBaseInput({
      usage: "custom",
      usageConfig: { custom: ["m9"] },
    });
    const result = prepareCallContext(input);

    expect(result.usage).toBe("custom");
    expect(input.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown usage type: custom")
    );
    expect(assertChatMessages).toHaveBeenCalledWith(input.messages);
    expect(input.beforeCandidates).toHaveBeenCalledTimes(1);
  });

  it("throws when no candidates configured or when candidates are not an array", () => {
    const inputEmpty = buildBaseInput({
      usageConfig: { worker: [] },
    });
    expect(() => prepareCallContext(inputEmpty)).toThrowError(
      "No models configured for usage: worker"
    );

    const inputWrongType = buildBaseInput({
      usageConfig: { worker: {} },
    });
    expect(() => prepareCallContext(inputWrongType)).toThrowError(
      "No models configured for usage: worker"
    );
  });

  it("uses round-robin cursor string to rotate candidates", () => {
    const input = buildBaseInput({
      strategy: "round_robin",
      rrNextIndexByUsage: new Map([["worker", "m2"]]),
    });
    const result = prepareCallContext(input);
    expect(result.startIndex).toBe(1);
    expect(result.orderedCandidates).toEqual(["m2", "m3", "m1"]);
    expect(result.baseCandidates).toEqual(["m1", "m2", "m3"]);
  });

  it("uses numeric cursor for round-robin and preserves waitRetryCount", () => {
    const input = buildBaseInput({
      strategy: "round_robin",
      rrNextIndexByUsage: new Map([["worker", -1]]),
      waitRetryCount: -1,
      usePerformanceRouting: true,
    });
    const result = prepareCallContext(input);
    expect(result.startIndex).toBe(2);
    expect(result.orderedCandidates).toEqual(["m3", "m1", "m2"]);
    expect(result.waitRetryCount).toBe(-1);
    expect(result.usePerformanceRouting).toBe(true);
  });

  it("preserves order for non-round-robin and coerces invalid waitRetryCount", () => {
    const usageConfig = { worker: ["m1", "m2"] };
    const input = buildBaseInput({
      usageConfig,
      strategy: "priority",
      rrNextIndexByUsage: new Map([["worker", 1]]),
      waitRetryCount: "3",
    });
    const result = prepareCallContext(input);
    expect(result.startIndex).toBe(0);
    expect(result.baseCandidates).toBe(usageConfig.worker);
    expect(result.orderedCandidates).toBe(usageConfig.worker);
    expect(result.waitRetryCount).toBe(0);
  });

  it("handles images, usage tags, and concurrent calls without mutating rr state", async () => {
    const rrNextIndexByUsage = new Map([["worker", "m2"]]);
    const input = buildBaseInput({
      images: [{}],
      usageTags: new Map([["worker", ["extra"]]]),
      rrNextIndexByUsage,
    });

    const results = await Promise.all([
      Promise.resolve().then(() => prepareCallContext(input)),
      Promise.resolve().then(() => prepareCallContext(input)),
    ]);

    for (const result of results) {
      expect(result.requiredTags.has("vision")).toBe(true);
      expect(result.requiredTags.has("text")).toBe(false);
      expect(result.requiredTags.has("extra")).toBe(true);
    }
    expect(rrNextIndexByUsage.get("worker")).toBe("m2");
  });

  it("propagates errors from assertChatMessages", () => {
    mockAssertChatMessages.mockImplementation(() => {
      throw new Error("bad messages");
    });
    const input = buildBaseInput();
    expect(() => prepareCallContext(input)).toThrowError("bad messages");
  });
});
