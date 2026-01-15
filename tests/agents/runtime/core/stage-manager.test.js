import { describe, it, expect, vi, beforeEach } from "vitest";

// BaseAgentLoop.execute() depends on hook-runner. Mock it so these tests can focus on
// stage management behavior (transitions, pause/resume, cleanup) deterministically.
const hookMocks = vi.hoisted(() => ({
  preAgent: vi.fn(async () => ({})),
  postAgent: vi.fn(async () => ({})),
}));

vi.mock(
  "../../../../js/agents/runtime/hooks/hook-runner.js",
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      createPreAgentHook: () => hookMocks.preAgent,
      createPostAgentHook: () => hookMocks.postAgent,
    };
  }
);

import { BaseAgentLoop } from "../../../../js/agents/runtime/core/agent-loop.js";

function createTestEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  const emitImpl = (eventName, evt) => {
    const handlers = listeners.get(eventName);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(evt);
  };

  return {
    emit: vi.fn(emitImpl),
    subscribe: vi.fn((eventName, handler, _options) => {
      const bucket = listeners.get(eventName) ?? new Set();
      bucket.add(handler);
      listeners.set(eventName, bucket);
      const unsub = vi.fn(() => bucket.delete(handler));
      return unsub;
    }),
  };
}

describe("runtime/core/stage-manager (agent-loop)", () => {
  beforeEach(() => {
    hookMocks.preAgent.mockReset();
    hookMocks.postAgent.mockReset();
    hookMocks.preAgent.mockResolvedValue({});
    hookMocks.postAgent.mockResolvedValue({});
  });

  it("BaseAgentLoop.run() throws when not overridden (error path)", async () => {
    const loop = new BaseAgentLoop({ stageName: "demo", actor: "bob" });
    await expect(loop.run()).rejects.toThrow(/not implemented/i);
  });

  it("_transitionPhase updates state.status and emits transition record", async () => {
    const emit = vi.fn();

    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob", emit });
    const state = { status: "idle" };

    const next = loop._transitionPhase(state, "running", { runId: "r1", payload: { x: 1 } });
    expect(next).toBe("running");
    expect(state.status).toBe("running");

    expect(emit).toHaveBeenCalledWith("demo.phase.transition", {
      actor: "bob",
      status: "progress",
      payload: { runId: "r1", from: "idle", to: "running", x: 1 },
    });
  });

  it("_transitionPhase throws when a stateMachine rejects a transition", async () => {
    const emit = vi.fn();

    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({
      stageName: "demo",
      actor: "bob",
      emit,
      stateMachine: { transition: vi.fn(() => false) },
    });

    expect(() => loop._transitionPhase({ status: "idle" }, "running", { runId: "r1" })).toThrow(
      "demo phase transition rejected: idle -> running"
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it("pause() / resume() toggles paused state and aborts the active step", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const started = loop._beginStep({ name: "work" }, { signal: new AbortController().signal });
    expect(loop.isPaused).toBe(false);
    expect(started.context.signal.aborted).toBe(false);

    loop.pause("user_requested");
    expect(loop.isPaused).toBe(true);
    expect(loop._pauseReason).toBe("user_requested");
    expect(started.context.signal.aborted).toBe(true);

    loop.resume();
    expect(loop.isPaused).toBe(false);
    expect(loop._pauseReason).toBe(null);
  });

  it("waitForUserAction() rejects when no eventBus.subscribe() is available", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop();
    await expect(loop.waitForUserAction("confirm")).rejects.toThrow(/eventBus.*subscribe/i);
  });

  it("waitForUserAction() rejects on abort signal and cleans up subscription", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const bus = createTestEventBus();
    const controller = new AbortController();

    const promise = loop.waitForUserAction("confirm", { eventBus: bus, signal: controller.signal, timeout: 1000 });
    controller.abort("stop");

    await expect(promise).rejects.toThrow(/Run cancelled/);

    const unsub = bus.subscribe.mock.results[0]?.value;
    expect(typeof unsub).toBe("function");
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("execute() aborts superseded runs and clears _executeAbortController", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run(_input, context) {
        if (context?.runContext?.mode === "quick") return { ok: true };
        return new Promise((resolve) => {
          if (context.signal.aborted) {
            resolve({ aborted: true });
            return;
          }
          context.signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
        });
      }
    }

    const bus = createTestEventBus();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });

    const firstRun = loop.execute({ mode: "waitForAbort" }, {}, { eventBus: bus });
    const firstController = loop._executeAbortController;
    expect(firstController).not.toBe(null);

    const secondRun = loop.execute({ mode: "quick" }, {}, { eventBus: bus });

    await expect(secondRun).resolves.toEqual({ ok: true });
    await expect(firstRun).resolves.toEqual({ aborted: true });

    expect(firstController.signal.aborted).toBe(true);
    // `reason` is not universally available (depends on AbortSignal.any support), so guard it.
    if ("reason" in firstController.signal) {
      expect(firstController.signal.reason).toBe("superseded");
    }

    expect(loop._executeAbortController).toBe(null);
  });

  it("execute() tolerates abort() failures from previous controllers", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    // @ts-expect-error: inject a fake controller to cover defensive error handling
    loop._executeAbortController = {
      signal: { aborted: false },
      abort: vi.fn(() => {
        throw new Error("abort blocked");
      }),
    };

    await expect(loop.execute({}, {}, {})).resolves.toBe("ok");
    // Should have attempted to abort the previous run but still continued.
    expect(loop._executeAbortController).toBe(null);
  });

  it("_detachEventBusListeners() ignores unsubscribe errors (resource cleanup)", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    // @ts-expect-error: force internal cleanup branches
    loop._userInputUnsub = () => {
      throw new Error("unsubscribe failed");
    };
    // @ts-expect-error: force internal cleanup branches
    loop._pauseListenerUnsub = () => {
      throw new Error("unsubscribe failed");
    };
    // @ts-expect-error: simulate attached listener state
    loop._userInputBus = {};

    expect(() => loop._detachEventBusListeners()).not.toThrow();
    expect(loop._userInputUnsub).toBe(null);
    expect(loop._pauseListenerUnsub).toBe(null);
    expect(loop._userInputBus).toBe(null);
  });
});
