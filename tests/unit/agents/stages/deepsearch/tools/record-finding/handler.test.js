import { describe, it, expect, vi, beforeEach } from "vitest";

const makeSecureTimestampedIdMock = vi.hoisted(() => vi.fn());
const toNonNegativeIntMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../../js/agents/shared/index.js", () => ({
  makeSecureTimestampedId: makeSecureTimestampedIdMock,
  toNonNegativeInt: toNonNegativeIntMock,
}));

import { definition, handler } from "../../../../../../../js/agents/stages/deepsearch/tools/record-finding/handler.js";

function toNonNegativeIntImpl(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const v = Math.floor(value);
    return v >= 0 ? v : fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
  return fallback;
}

function makeSharedContext(overrides = {}) {
  return {
    hasSeen: vi.fn(() => false),
    markSeen: vi.fn(),
    commit: vi.fn(),
    search: vi.fn(() => []),
    ...overrides,
  };
}

function makeContext({ sharedContext, state } = {}) {
  return {
    state: state || {},
    emit: vi.fn(),
    sharedContext: sharedContext || makeSharedContext(),
  };
}

let idCounter = 1;

beforeEach(() => {
  idCounter = 1;
  makeSecureTimestampedIdMock.mockReset();
  toNonNegativeIntMock.mockReset();
  makeSecureTimestampedIdMock.mockImplementation((prefix = "id") => `${prefix}_${idCounter++}`);
  toNonNegativeIntMock.mockImplementation(toNonNegativeIntImpl);
});

describe("definition", () => {
  it("exposes tool metadata", () => {
    expect(definition).toEqual(expect.objectContaining({
      name: "record-finding",
      layer: 0,
      activation: expect.objectContaining({
        keywords: expect.arrayContaining(["claim", "gap", "conflict"]),
      }),
      parameters: expect.objectContaining({
        type: expect.any(String),
        content: expect.any(String),
        findings: expect.any(String),
      }),
    }));
  });
});

describe("handler", () => {
  it("records a claim and updates shared context/state", async () => {
    const sharedContext = makeSharedContext({
      search: vi.fn((query) => {
        if (query === "finding_claim") return [{}, {}];
        if (query === "finding_gap") return [{}];
        if (query === "finding_conflict") return [];
        return [];
      }),
    });
    const context = makeContext({ sharedContext });
    const result = await handler({
      type: "claim",
      content: "  Example claim  ",
      source: "doc-1",
      lineStart: 3,
      lineEnd: 5,
      confidence: 0.9,
      tags: ["tag1", 123],
    }, context);

    expect(result.success).toBe(true);
    expect(result.stats).toEqual({ claims: 2, gaps: 1, conflicts: 0 });
    expect(result.finding).toMatchObject({
      id: "claim_1",
      type: "claim",
      content: "Example claim",
      source: "doc-1",
      lineStart: 3,
      lineEnd: 5,
      ref: "[doc-1:L3-L5]",
      sources: ["doc-1"],
      confidence: 0.9,
      priority: null,
      tags: ["tag1"],
    });
    expect(typeof result.finding.createdAt).toBe("number");
    expect(makeSecureTimestampedIdMock).toHaveBeenCalledWith("claim");
    expect(sharedContext.markSeen).toHaveBeenCalledWith("Example claim");
    expect(sharedContext.commit).toHaveBeenCalledTimes(1);

    const [eventName, payload] = sharedContext.commit.mock.calls[0];
    expect(eventName).toBe("finding_claim");
    expect(payload.summary).toContain("[claim:90%]");
    expect(payload.full).toMatchObject({ id: "claim_1" });
    expect(payload.keywords).toEqual(expect.arrayContaining(["claim", "finding_claim", "tag1", "doc-1"]));
    expect(context.state.L1.findingIds.claim).toEqual(["claim_1"]);
    expect(context.emit).toHaveBeenCalledWith("deepsearch.finding.claim", expect.objectContaining({ id: "claim_1" }));
  });

  it("normalizes reversed line numbers and clamps confidence", async () => {
    const context = makeContext();
    const result = await handler({
      type: "claim",
      content: "Swap lines",
      source: "doc",
      lineStart: 10,
      lineEnd: 5,
      confidence: 2,
    }, context);

    expect(result.success).toBe(true);
    expect(result.finding.lineStart).toBe(5);
    expect(result.finding.lineEnd).toBe(10);
    expect(result.finding.ref).toBe("[doc:L5-L10]");
    expect(result.finding.confidence).toBe(1);
  });

  it("accepts MAX_SAFE_INTEGER line numbers", async () => {
    const context = makeContext();
    const max = Number.MAX_SAFE_INTEGER;
    const result = await handler({
      type: "claim",
      content: "Large lines",
      source: "doc",
      lineStart: max,
      lineEnd: max,
    }, context);

    expect(result.success).toBe(true);
    expect(result.finding.lineStart).toBe(max);
    expect(result.finding.lineEnd).toBe(max);
    expect(result.finding.ref).toBe(`[doc:L${max}]`);
  });

  it("returns error for empty args object", async () => {
    const context = makeContext();
    const result = await handler({}, context);

    expect(result).toMatchObject({
      success: false,
      error: "type must be one of: claim, gap, conflict",
    });
  });

  it("returns error for blank content", async () => {
    const context = makeContext();
    const result = await handler({ type: "claim", content: "   " }, context);

    expect(result).toMatchObject({ success: false, error: "content is required" });
  });

  it("rejects null or undefined args", async () => {
    const context = makeContext();
    await expect(handler(null, context)).rejects.toThrow(TypeError);
    await expect(handler(undefined, context)).rejects.toThrow(TypeError);
  });

  it("skips duplicate content", async () => {
    const sharedContext = makeSharedContext({ hasSeen: vi.fn(() => true) });
    const context = makeContext({ sharedContext });
    const result = await handler({ type: "claim", content: "dup" }, context);

    expect(result).toMatchObject({ success: false, error: "duplicate" });
    expect(sharedContext.commit).not.toHaveBeenCalled();
    expect(sharedContext.markSeen).not.toHaveBeenCalled();
  });

  it("filters invalid numbers and object tags/sources", async () => {
    const context = makeContext();
    const result = await handler({
      type: "gap",
      content: "Gap record",
      source: " doc ",
      lineStart: 0,
      lineEnd: -1,
      priority: "urgent",
      tags: { bad: true },
      sources: { bad: true },
    }, context);

    expect(result.success).toBe(true);
    expect(result.finding.lineStart).toBe(null);
    expect(result.finding.lineEnd).toBe(null);
    expect(result.finding.ref).toBe("[doc]");
    expect(result.finding.priority).toBe("medium");
    expect(result.finding.tags).toEqual([]);
    expect(result.finding.sources).toEqual(["doc"]);
    expect(result.finding.confidence).toBe(null);
  });

  it("treats string line numbers as invalid and prefers sources array", async () => {
    const context = makeContext();
    const result = await handler({
      type: "conflict",
      content: "Conflict entry",
      source: "doc2",
      sources: ["doc1", "  ", 12],
      lineStart: "3",
      lineEnd: "4",
    }, context);

    expect(result.success).toBe(true);
    expect(result.finding.lineStart).toBe(null);
    expect(result.finding.lineEnd).toBe(null);
    expect(result.finding.sources).toEqual(["doc1"]);
    expect(result.finding.ref).toBe("[doc2]");
  });

  it("returns empty batch stats for empty array", async () => {
    const context = makeContext();
    const result = await handler({ findings: [] }, context);

    expect(result).toEqual({
      success: true,
      recorded: 0,
      skipped: 0,
      findings: [],
      errors: [],
      stats: { claims: 0, gaps: 0, conflicts: 0 },
    });
  });

  it("enforces gap budget in batch mode", async () => {
    const sharedContext = makeSharedContext();
    const context = makeContext({
      sharedContext,
      state: { userConfig: { gaps: { maxFindingGaps: 1, maxNewGapFindingsPerCall: 1 } } },
    });
    const result = await handler({
      findings: [
        { type: "gap", content: "Gap 1" },
        { type: "gap", content: "Gap 2" },
      ],
    }, context);

    expect(result.success).toBe(true);
    expect(result.recorded).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatchObject({ error: "gap_budget_exceeded", index: 1 });
    expect(sharedContext.commit).toHaveBeenCalledTimes(1);
  });

  it("blocks single gap when max total budget is exceeded", async () => {
    const sharedContext = makeSharedContext({
      search: vi.fn((query) => (query === "finding_gap" ? [{}] : [])),
    });
    const context = makeContext({
      sharedContext,
      state: { userConfig: { gaps: { maxFindingGaps: 1 } } },
    });
    const result = await handler({ type: "gap", content: "Gap over limit" }, context);

    expect(result).toMatchObject({
      success: false,
      error: "gap_budget_exceeded",
      reason: "max_total",
    });
    expect(result.hint).toContain("Too many gaps");
    expect(sharedContext.commit).not.toHaveBeenCalled();
  });

  it("disables gap caps when maxTotal/maxPerCall are zero", async () => {
    const sharedContext = makeSharedContext({
      search: vi.fn((query) => (query === "finding_gap" ? new Array(100).fill({}) : [])),
    });
    const context = makeContext({
      sharedContext,
      state: { userConfig: { gaps: { maxFindingGaps: 0, maxNewGapFindingsPerCall: 0 } } },
    });
    const result = await handler({ type: "gap", content: "Unlimited gap" }, context);

    expect(result.success).toBe(true);
    expect(result.finding.priority).toBe("medium");
  });

  it("handles simultaneous calls without shared-state leakage", async () => {
    const sharedContext = makeSharedContext();
    const context = makeContext({ sharedContext });
    const [first, second] = await Promise.all([
      handler({ type: "claim", content: "One" }, context),
      handler({ type: "claim", content: "Two" }, context),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(context.state.L1.findingIds.claim.length).toBe(2);
    expect(sharedContext.commit).toHaveBeenCalledTimes(2);
  });

  it("detects duplicates on rapid consecutive calls", async () => {
    const seen = new Set();
    const sharedContext = makeSharedContext({
      hasSeen: vi.fn((content) => seen.has(content)),
      markSeen: vi.fn((content) => seen.add(content)),
    });
    const context = makeContext({ sharedContext });

    const first = await handler({ type: "claim", content: "Rapid" }, context);
    const second = await handler({ type: "claim", content: "Rapid" }, context);

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: false, error: "duplicate" });
    expect(sharedContext.commit).toHaveBeenCalledTimes(1);
  });

  it("handles long content and deep nested tags", async () => {
    const longContent = "alpha ".repeat(5000).trim();
    const context = makeContext();
    const result = await handler({
      type: "claim",
      content: longContent,
      tags: ["t1", ["nested", ["deep"]], { extra: true }, "t2"],
    }, context);

    expect(result.success).toBe(true);
    expect(result.finding.content.length).toBe(longContent.length);
    expect(result.finding.tags).toEqual(["t1", "t2"]);
  });
});
