import { describe, expect, it, vi } from "vitest";

const lifecycleMock = vi.hoisted(() => ({
  runWithAgentLifecycleHooks: vi.fn(async ({ runId }) => ({ runId })),
}));

vi.mock("../../../../../js/agents/runtime/core/agent-loop-lifecycle-hooks.js", () => ({
  runWithAgentLifecycleHooks: lifecycleMock.runWithAgentLifecycleHooks,
}));

import { BaseAgentLoop } from "../../../../../js/agents/runtime/core/agent-loop.js";

class DemoLoop extends BaseAgentLoop {
  async run() {
    return { ok: true };
  }
}

describe("BaseAgentLoop runId generation", () => {
  it("prefers runContext.runId when provided", async () => {
    const loop = new DemoLoop({ stageName: "demo", actor: "alice" });
    const out = await loop.execute({ runId: "trace-001" }, { hello: true }, {});
    expect(out).toEqual({ runId: "trace-001" });
  });

  it("generates stable stage/actor-scoped run ids without Math.random", async () => {
    const loop = new DemoLoop({ stageName: "demo-stage", actor: "alice" });
    const a = await loop.execute({}, { i: 1 }, {});
    const b = await loop.execute({}, { i: 2 }, {});

    expect(a.runId).toMatch(/^run_demo-stage_alice_[a-z0-9]+_1_[a-z0-9]+$/i);
    expect(b.runId).toMatch(/^run_demo-stage_alice_[a-z0-9]+_2_[a-z0-9]+$/i);
    expect(a.runId).not.toBe(b.runId);
  });
});

