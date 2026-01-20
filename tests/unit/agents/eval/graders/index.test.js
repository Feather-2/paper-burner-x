import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGraders = vi.hoisted(() => {
  const makeGrader = (type) => ({ type, grade: vi.fn(() => ({ ok: true })) });
  return {
    regexGrader: makeGrader("regex"),
    stateCheckGrader: makeGrader("stateCheck"),
    toolCallsGrader: makeGrader("toolCalls"),
    transcriptGrader: makeGrader("transcript"),
    contentGrader: makeGrader("content"),
    rubricGrader: makeGrader("rubric"),
    assertionGrader: makeGrader("assertion"),
    pairwiseGrader: makeGrader("pairwise"),
    allPassGrader: makeGrader("allPass"),
    weightedGrader: makeGrader("weighted"),
    thresholdGrader: makeGrader("threshold"),
  };
});

vi.mock("../../../../../js/agents/eval/graders/deterministic.js", () => ({
  regexGrader: mockGraders.regexGrader,
  stateCheckGrader: mockGraders.stateCheckGrader,
  toolCallsGrader: mockGraders.toolCallsGrader,
  transcriptGrader: mockGraders.transcriptGrader,
}));

vi.mock("../../../../../js/agents/eval/graders/content.js", () => ({
  contentGrader: mockGraders.contentGrader,
}));

vi.mock("../../../../../js/agents/eval/graders/llm-judge.js", () => ({
  rubricGrader: mockGraders.rubricGrader,
  assertionGrader: mockGraders.assertionGrader,
  pairwiseGrader: mockGraders.pairwiseGrader,
}));

vi.mock("../../../../../js/agents/eval/graders/composite.js", () => ({
  allPassGrader: mockGraders.allPassGrader,
  weightedGrader: mockGraders.weightedGrader,
  thresholdGrader: mockGraders.thresholdGrader,
}));

import {
  GraderRegistry,
  createDefaultGraderRegistry,
  defaultGraderRegistry,
  regexGrader,
  stateCheckGrader,
  toolCallsGrader,
  transcriptGrader,
  contentGrader,
  rubricGrader,
  assertionGrader,
  pairwiseGrader,
  allPassGrader,
  weightedGrader,
  thresholdGrader,
} from "../../../../../js/agents/eval/graders/index.js";

const defaultGraders = [
  mockGraders.regexGrader,
  mockGraders.stateCheckGrader,
  mockGraders.toolCallsGrader,
  mockGraders.transcriptGrader,
  mockGraders.contentGrader,
  mockGraders.rubricGrader,
  mockGraders.assertionGrader,
  mockGraders.pairwiseGrader,
  mockGraders.allPassGrader,
  mockGraders.weightedGrader,
  mockGraders.thresholdGrader,
];

const makeGrader = (type, extras = {}) => ({
  type,
  grade: vi.fn(() => ({ ok: true })),
  ...extras,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GraderRegistry", () => {
  it("constructs empty by default and with empty array", () => {
    const registryDefault = new GraderRegistry();
    const registryEmpty = new GraderRegistry([]);

    expect(registryDefault.listTypes()).toEqual([]);
    expect(registryEmpty.listTypes()).toEqual([]);
  });

  it("rejects invalid graders and boundary type values", () => {
    const registry = new GraderRegistry();
    const invalidGraders = [
      null,
      undefined,
      {},
      { type: "ok" },
      { grade: () => true },
      { type: "ok", grade: null },
      { type: 0, grade: () => true },
      { type: -1, grade: () => true },
      { type: Number.MAX_SAFE_INTEGER, grade: () => true },
    ];

    for (const candidate of invalidGraders) {
      expect(() => registry.register(candidate)).toThrow(/invalid grader/i);
    }
  });

  it("accepts string boundary types and supports chaining", () => {
    const registry = new GraderRegistry();
    const emptyType = makeGrader("");
    const whitespaceType = makeGrader("   ");
    const stringNumber = makeGrader("123");
    const maxString = makeGrader(String(Number.MAX_SAFE_INTEGER));

    const result = registry
      .register(emptyType)
      .register(whitespaceType)
      .register(stringNumber)
      .register(maxString);

    expect(result).toBe(registry);
    expect(registry.has("")).toBe(true);
    expect(registry.has("   ")).toBe(true);
    expect(registry.get("123")).toBe(stringNumber);
    expect(registry.get(String(Number.MAX_SAFE_INTEGER))).toBe(maxString);
  });

  it("stores graders with long type strings, large payloads, and deep metadata", () => {
    const registry = new GraderRegistry();
    const longType = "t".repeat(10000);
    const hugePayload = "x".repeat(100000);
    const deepMeta = { a: { b: { c: { d: { e: { f: "ok" } } } } } };

    const grader = makeGrader(longType, { payload: hugePayload, meta: deepMeta });

    registry.register(grader);

    const stored = registry.get(longType);
    expect(stored).toBe(grader);
    expect(stored.payload.length).toBe(hugePayload.length);
    expect(stored.meta.a.b.c.d.e.f).toBe("ok");
  });

  it("registerAll ignores non-array inputs and preserves empty state", () => {
    const registry = new GraderRegistry();

    expect(registry.registerAll(null)).toBe(registry);
    expect(registry.registerAll(undefined)).toBe(registry);
    expect(registry.registerAll({})).toBe(registry);
    expect(registry.registerAll("not-array")).toBe(registry);
    expect(registry.registerAll([])).toBe(registry);

    expect(registry.listTypes()).toEqual([]);
  });

  it("registerAll registers graders and surfaces errors from invalid entries", () => {
    const registry = new GraderRegistry();
    const good = makeGrader("good");
    const other = makeGrader("other");

    registry.registerAll([good, other]);

    expect(registry.get("good")).toBe(good);
    expect(registry.has("other")).toBe(true);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.has("missing")).toBe(false);
    expect(registry.listTypes()).toEqual(expect.arrayContaining(["good", "other"]));

    expect(() => registry.registerAll([makeGrader("ok"), null])).toThrow(/invalid grader/i);
  });

  it("supports rapid consecutive and concurrent registrations", async () => {
    const registry = new GraderRegistry();

    for (let i = 0; i < 25; i += 1) {
      registry.register(makeGrader(`fast-${i}`));
    }

    expect(registry.listTypes()).toHaveLength(25);

    const concurrentRegistry = new GraderRegistry();
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        Promise.resolve().then(() => concurrentRegistry.register(makeGrader(`con-${i}`)))
      )
    );

    expect(concurrentRegistry.listTypes()).toHaveLength(25);
  });
});

describe("createDefaultGraderRegistry", () => {
  it("creates a registry with all default graders registered", () => {
    const registry = createDefaultGraderRegistry();

    expect(registry).toBeInstanceOf(GraderRegistry);
    for (const grader of defaultGraders) {
      expect(registry.has(grader.type)).toBe(true);
      expect(registry.get(grader.type)).toBe(grader);
    }
  });

  it("returns independent registries on each call", () => {
    const first = createDefaultGraderRegistry();
    const second = createDefaultGraderRegistry();
    const extra = makeGrader("extra");

    first.register(extra);

    expect(first.has("extra")).toBe(true);
    expect(second.has("extra")).toBe(false);
  });
});

describe("defaultGraderRegistry", () => {
  it("exposes a default registry with expected graders", () => {
    expect(defaultGraderRegistry).toBeInstanceOf(GraderRegistry);
    for (const grader of defaultGraders) {
      expect(defaultGraderRegistry.has(grader.type)).toBe(true);
    }
  });

  it("does not share identity with a freshly created registry", () => {
    const fresh = createDefaultGraderRegistry();

    expect(defaultGraderRegistry).not.toBe(fresh);
    expect(defaultGraderRegistry.listTypes()).toEqual(expect.arrayContaining(fresh.listTypes()));
  });
});

describe("regexGrader", () => {
  it("re-exports the deterministic regex grader", () => {
    expect(regexGrader).toBe(mockGraders.regexGrader);
  });
});

describe("stateCheckGrader", () => {
  it("re-exports the deterministic state check grader", () => {
    expect(stateCheckGrader).toBe(mockGraders.stateCheckGrader);
  });
});

describe("toolCallsGrader", () => {
  it("re-exports the deterministic tool calls grader", () => {
    expect(toolCallsGrader).toBe(mockGraders.toolCallsGrader);
  });
});

describe("transcriptGrader", () => {
  it("re-exports the deterministic transcript grader", () => {
    expect(transcriptGrader).toBe(mockGraders.transcriptGrader);
  });
});

describe("contentGrader", () => {
  it("re-exports the content grader", () => {
    expect(contentGrader).toBe(mockGraders.contentGrader);
  });
});

describe("rubricGrader", () => {
  it("re-exports the rubric grader", () => {
    expect(rubricGrader).toBe(mockGraders.rubricGrader);
  });
});

describe("assertionGrader", () => {
  it("re-exports the assertion grader", () => {
    expect(assertionGrader).toBe(mockGraders.assertionGrader);
  });
});

describe("pairwiseGrader", () => {
  it("re-exports the pairwise grader", () => {
    expect(pairwiseGrader).toBe(mockGraders.pairwiseGrader);
  });
});

describe("allPassGrader", () => {
  it("re-exports the all-pass grader", () => {
    expect(allPassGrader).toBe(mockGraders.allPassGrader);
  });
});

describe("weightedGrader", () => {
  it("re-exports the weighted grader", () => {
    expect(weightedGrader).toBe(mockGraders.weightedGrader);
  });
});

describe("thresholdGrader", () => {
  it("re-exports the threshold grader", () => {
    expect(thresholdGrader).toBe(mockGraders.thresholdGrader);
  });
});
