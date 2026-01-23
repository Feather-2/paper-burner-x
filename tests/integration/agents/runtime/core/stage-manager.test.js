import { describe, it, expect, vi, beforeEach } from "vitest";

// BaseAgentLoop.execute() depends on hook-runner. Mock it so these tests can focus on
// stage management behavior (transitions, pause/resume, cleanup) deterministically.
const hookMocks = vi.hoisted(() => ({
  preAgent: vi.fn(async () => ({})),
  postAgent: vi.fn(async () => ({})),
}));

vi.mock(
  "../../../../../js/agents/runtime/hooks/hook-runner.js",
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      createPreAgentHook: () => hookMocks.preAgent,
      createPostAgentHook: () => hookMocks.postAgent,
    };
  }
);

import { BaseAgentLoop, BaseStage } from '../../../../../js/agents/runtime/core/agent-loop.js';
import { getLimit } from '../../../../../js/agents/runtime/core/constants/limits.js';

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

  it("constructor defaults actor/stageName and maxUserInputs when options omitted", () => {
    const loop = new BaseAgentLoop();
    expect(loop.actor).toBe("agent");
    expect(loop.stageName).toBe("agent");
    expect(loop.eventBus).toBe(null);
    expect(loop.emit).toBe(null);
    expect(loop.stateMachine).toBe(null);
    expect(loop._maxUserInputs).toBe(getLimit("MAX_USER_INPUTS"));
  });

  it("constructor uses actor when stageName is not provided", () => {
    const loop = new BaseAgentLoop({ actor: "alpha" });
    expect(loop.actor).toBe("alpha");
    expect(loop.stageName).toBe("alpha");
  });

  it("constructor uses stageName when actor is not provided", () => {
    const loop = new BaseAgentLoop({ stageName: "beta" });
    expect(loop.actor).toBe("beta");
    expect(loop.stageName).toBe("beta");
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

  it("waitForUserAction() times out and cleans up subscription with signal listeners", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const bus = createTestEventBus();
    const signal = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    vi.useFakeTimers();
    try {
      const promise = loop.waitForUserAction("confirm", { eventBus: bus, signal, timeout: 20 });
      const expectation = expect(promise).rejects.toThrow(/Timeout waiting for user action: confirm/);
      await vi.advanceTimersByTimeAsync(20);
      await expectation;
    } finally {
      vi.useRealTimers();
    }

    const unsub = bus.subscribe.mock.results[0]?.value;
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(signal.addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    const abortHandler = signal.addEventListener.mock.calls[0][1];
    expect(signal.removeEventListener).toHaveBeenCalledWith("abort", abortHandler);
  });

  it("waitForUserAction() uses loop eventBus and times out", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const bus = createTestEventBus();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob", eventBus: bus });

    vi.useFakeTimers();
    try {
      const promise = loop.waitForUserAction("confirm", { timeout: 10 });
      const expectation = expect(promise).rejects.toThrow(/Timeout waiting for user action: confirm/);
      await vi.advanceTimersByTimeAsync(10);
      await expectation;
    } finally {
      vi.useRealTimers();
    }

    const unsub = bus.subscribe.mock.results[0]?.value;
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

  it("waitForUserAction() times out when no event is received", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const bus = createTestEventBus();

    const promise = loop.waitForUserAction("confirm", { eventBus: bus, timeout: 50 });
    await expect(promise).rejects.toThrow(/Timeout waiting for user action: confirm/);
  });

  it("waitForUserAction() resolves when user action event is emitted", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const bus = createTestEventBus();

    const promise = loop.waitForUserAction("confirm", { eventBus: bus, timeout: 1000 });
    // Emit the action event after a short delay
    setTimeout(() => {
      bus.emit("user.action.confirm", { payload: { confirmed: true } });
    }, 10);

    const result = await promise;
    expect(result).toEqual({ confirmed: true });
  });

  it("recordUserInput() trims queue when exceeding maxUserInputs", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const emit = vi.fn();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob", emit, maxUserInputs: 3 });

    loop.recordUserInput("first");
    loop.recordUserInput("second");
    loop.recordUserInput("third");
    loop.recordUserInput("fourth");
    loop.recordUserInput("fifth");

    const inputs = loop.consumeUserInputs();
    expect(inputs.length).toBe(3);
    expect(inputs.map((i) => i.payload)).toEqual(["third", "fourth", "fifth"]);
  });

  it("formatUserInputs() handles various payload formats", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });

    const items = [
      { payload: "plain string" },
      { payload: { text: "  text property  " } },
      { payload: { message: "message property" } },
      { payload: { custom: "data" } },
      { payload: null },
      { payload: undefined },
      "raw string item",
    ];

    const result = loop.formatUserInputs(items);
    expect(result).toContain("plain string");
    expect(result).toContain("text property");
    expect(result).toContain("message property");
    expect(result).toContain('"custom":"data"');
    expect(result).toContain("raw string item");
  });

  it("_attachUserInputListener() skips re-subscription for same bus and event", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const bus = createTestEventBus();

    loop._attachUserInputListener(bus, {});
    expect(bus.subscribe).toHaveBeenCalledTimes(1);

    // Attach again with same bus - should skip
    loop._attachUserInputListener(bus, {});
    expect(bus.subscribe).toHaveBeenCalledTimes(1);

    // Attach with different event name - should re-subscribe
    loop._attachUserInputListener(bus, { eventName: "custom.input" });
    expect(bus.subscribe).toHaveBeenCalledTimes(2);
  });

  it("_attachPauseListener() triggers pause() when pause event is received", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    const bus = createTestEventBus();

    loop._attachPauseListener(bus, {});
    expect(loop.isPaused).toBe(false);

    bus.emit("user.action.pause", { payload: { reason: "budget_exceeded" } });
    expect(loop.isPaused).toBe(true);
    expect(loop._pauseReason).toBe("budget_exceeded");
  });

  it("applyUserInputsToConfig() merges user inputs into config", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });
    loop.recordUserInput("note one");
    loop.recordUserInput({ text: "note two" });

    const config = { existing: "value", userNotes: ["old note"] };
    const result = loop.applyUserInputsToConfig(config, { key: "userNotes" });

    expect(result.existing).toBe("value");
    expect(result.userNotes).toContain("old note");
    expect(result._lastUserNote).toContain("note one");
    expect(result._lastUserNote).toContain("note two");
    expect(result._rawUserInputs.length).toBe(2);
  });

  it("_transitionPhase() updates state.state when status is absent", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const emit = vi.fn();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob", emit });
    const state = { state: "init" };

    loop._transitionPhase(state, "active", {});
    expect(state.state).toBe("active");
  });

  it("_endStep() is a no-op when there is no active step", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const emit = vi.fn();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob", emit });

    expect(loop._activeStep).toBe(null);
    loop._endStep();

    expect(emit).not.toHaveBeenCalled();
    expect(loop._activeStep).toBe(null);
  });

  it("_endStep() emits step event with error and result payload", () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "ok";
      }
    }

    const emit = vi.fn();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob", emit });
    const { step } = loop._beginStep({ name: "testStep" }, {});

    loop._endStep({ step }, { status: "failed", error: "something went wrong", result: { partial: true } });

    expect(emit).toHaveBeenCalledWith(
      "demo.step.failed",
      expect.objectContaining({
        status: "failed",
        payload: expect.objectContaining({
          name: "testStep",
          error: "something went wrong",
          result: { partial: true },
        }),
      })
    );
    expect(loop._activeStep).toBe(null);
  });

  it("execute() rethrows run errors and forwards them to postAgent hook", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        throw new Error("boom");
      }
    }

    const loop = new DemoLoop({ stageName: "demo", actor: "bob" });

    await expect(loop.execute({}, {}, {})).rejects.toThrow("boom");

    expect(hookMocks.postAgent).toHaveBeenCalledTimes(1);
    const postArgs = hookMocks.postAgent.mock.calls[0]?.[0];
    expect(postArgs?.error).toBeInstanceOf(Error);
    expect(postArgs?.error?.message).toBe("boom");
    expect(postArgs?.result).toBe(null);
  });

  it("BaseStage.execute() emits failed record and rethrows run errors", async () => {
    class DemoStage extends BaseStage {
      async run() {
        throw new Error("stage boom");
      }
    }

    const emit = vi.fn();
    const stage = new DemoStage({ name: "demo" });

    await expect(stage.execute({}, {}, { emit })).rejects.toThrow("stage boom");

    expect(emit).toHaveBeenCalledWith(
      "demo.failed",
      expect.objectContaining({
        actor: "demo",
        status: "failed",
        payload: { error: "stage boom" },
      })
    );
  });

  it("execute() emits skipped event when preAgent hook returns skip", async () => {
    class DemoLoop extends BaseAgentLoop {
      async run() {
        return "should not reach";
      }
    }

    hookMocks.preAgent.mockResolvedValueOnce({ skip: true, reason: "rate_limited", value: { blocked: true } });

    const emit = vi.fn();
    const loop = new DemoLoop({ stageName: "demo", actor: "bob", emit });

    const result = await loop.execute({}, {}, {});
    expect(result).toEqual({ blocked: true });
    expect(emit).toHaveBeenCalledWith(
      "demo.agent.skipped",
      expect.objectContaining({
        status: "skipped",
        payload: expect.objectContaining({ reason: "rate_limited" }),
      })
    );
  });
});
