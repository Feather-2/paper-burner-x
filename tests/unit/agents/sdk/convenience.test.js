import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  deepRun: vi.fn(async (input) => ({
    runId: input?.runId,
    report: { markdown: "report" },
    claims: ["c1"],
    todos: ["t1"],
  })),
  designRun: vi.fn(async (input) => ({
    runId: input?.runId,
    deckHtmlDsl: "<section></section>",
    slidesMeta: [{ id: 1 }],
    reviewReport: { ok: true },
    visualReport: { count: 1 },
    refineReport: { done: true },
    pendingImages: [],
  })),
  makeSecureTimestampedId: vi.fn((prefix) => `${prefix}_secure_id`),
}));

vi.mock("../../../../js/agents/core/event-bus.js", () => ({
  EventBus: class EventBus {
    on(_type, _handler) {
      return () => {};
    }
  },
}));

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    makeSecureTimestampedId: hoisted.makeSecureTimestampedId,
  };
});

vi.mock("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js", () => ({
  DeepSearchAgentLoop: class DeepSearchAgentLoop {
    constructor(options = {}) {
      this.options = options;
    }
    run = hoisted.deepRun;
  },
}));

vi.mock("../../../../js/agents/stages/design/agent-loop.js", () => ({
  DesignAgentLoop: class DesignAgentLoop {
    constructor(options = {}) {
      this.options = options;
    }
    run = hoisted.designRun;
  },
}));

import {
  createRunId,
  runDeepSearch,
  runDesign,
} from "../../../../js/agents/sdk/convenience.js";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.makeSecureTimestampedId.mockImplementation((prefix) => `${prefix}_secure_id`);
  hoisted.deepRun.mockImplementation(async (input) => ({
    runId: input?.runId,
    report: { markdown: "report" },
    claims: ["c1"],
    todos: ["t1"],
  }));
  hoisted.designRun.mockImplementation(async (input) => ({
    runId: input?.runId,
    deckHtmlDsl: "<section></section>",
    slidesMeta: [{ id: 1 }],
    reviewReport: { ok: true },
    visualReport: { count: 1 },
    refineReport: { done: true },
    pendingImages: [],
  }));
});

describe("createRunId", () => {
  it("uses secure timestamped ids by default", () => {
    const runId = createRunId("deepsearch");
    expect(runId).toBe("deepsearch_secure_id");
    expect(hoisted.makeSecureTimestampedId).toHaveBeenCalledWith("deepsearch", { allowInsecureFallback: true });
  });

  it("supports custom runIdFactory with fallback", () => {
    const custom = createRunId("design", {
      runIdFactory: () => "custom_run_id",
    });
    expect(custom).toBe("custom_run_id");

    const fallback = createRunId("design", {
      runIdFactory: () => "   ",
    });
    expect(fallback).toBe("design_secure_id");
  });
});

describe("runDeepSearch / runDesign", () => {
  it("passes runIdFactory through runDeepSearch", async () => {
    const result = await runDeepSearch("Analyze", {
      runIdFactory: () => "deep_custom_run",
    });

    expect(result.ok).toBe(true);
    expect(hoisted.deepRun).toHaveBeenCalledTimes(1);
    expect(hoisted.deepRun.mock.calls[0][0]).toMatchObject({ runId: "deep_custom_run" });
  });

  it("passes runIdFactory through runDesign", async () => {
    const result = await runDesign("Deck", {
      runIdFactory: () => "design_custom_run",
    });

    expect(result.ok).toBe(true);
    expect(hoisted.designRun).toHaveBeenCalledTimes(1);
    expect(hoisted.designRun.mock.calls[0][0]).toMatchObject({ runId: "design_custom_run" });
  });
});
