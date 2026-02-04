import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    logger,
    createLogger: vi.fn(() => logger),
    getRuntimeState: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: mocks.createLogger,
  };
});

vi.mock("../../../../../js/agents/runtime/core/loop-runtime-state.js", () => ({
  getRuntimeState: mocks.getRuntimeState,
}));

import StatusController, {
  StatusController as NamedStatusController,
} from "../../../../../js/agents/runtime/core/status-controller.js";
import { AgentStatus } from "../../../../../js/agents/runtime/core/agent-status.js";
import { StagePausedError } from "../../../../../js/agents/runtime/core/stage-errors.js";

const ENV_KEY = "PB_STRICT_LOOP_STATUS_TRANSITIONS";
const ORIGINAL_ENV_VALUE = process.env[ENV_KEY];
const ORIGINAL_LOCAL_STORAGE = globalThis.localStorage;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeState.mockReturnValue(null);

  if (ORIGINAL_ENV_VALUE === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV_VALUE;
  }

  globalThis.localStorage = ORIGINAL_LOCAL_STORAGE;
});

describe("StatusController", () => {
  it("exposes named and default exports consistently", () => {
    expect(StatusController).toBe(NamedStatusController);
  });

  it("constructs with defaults and returns a copy of history", () => {
    const controller = new StatusController();

    expect(controller.status).toBe(AgentStatus.IDLE);
    expect(controller.isPaused).toBe(false);
    expect(controller.pauseReason).toBe(null);
    expect(controller.statusHistory).toEqual([]);

    const entry = controller.transition(AgentStatus.RUNNING, { timestamp: 0 });
    const history = controller.statusHistory;
    history.push({ from: "x", to: "y", timestamp: 1 });

    expect(entry.timestamp).toBe(0);
    expect(controller.statusHistory).toHaveLength(1);
    expect(controller.statusHistory[0]).toMatchObject({
      from: AgentStatus.IDLE,
      to: AgentStatus.RUNNING,
      timestamp: 0,
    });
  });

  it("init handles nullish inputs, arrays, and repairs non-array history", () => {
    const emit = vi.fn();
    const controller = new StatusController({ emit, stageName: "demo" });

    // @ts-expect-error: simulate corruption
    controller._statusHistory = {};

    expect(() => controller.init(null)).toThrow(TypeError);
    expect(() => controller.init(undefined)).not.toThrow();

    controller.init({ status: AgentStatus.RUNNING, eventName: "custom", strict: false });
    expect(controller.status).toBe(AgentStatus.RUNNING);
    expect(controller.statusHistory).toEqual([]);

    controller.transition(AgentStatus.PAUSED);
    expect(emit).toHaveBeenCalledWith("custom", expect.any(Object));

    emit.mockClear();
    controller.init({ eventName: "", status: "" });
    controller.transition(AgentStatus.RUNNING);
    expect(emit).toHaveBeenCalledWith("custom", expect.any(Object));

    expect(() => controller.init([])).not.toThrow();
  });

  it("uses env strict flags when provided", () => {
    process.env[ENV_KEY] = "false";

    const controller = new StatusController({ stageName: "demo", logger: { warn: vi.fn() } });
    const entry = controller.transition(AgentStatus.PAUSED);

    expect(entry).toMatchObject({
      from: AgentStatus.IDLE,
      to: AgentStatus.PAUSED,
      invalid: true,
    });
  });

  it("falls back to localStorage when env is blank or missing", () => {
    process.env[ENV_KEY] = "   ";
    globalThis.localStorage = { getItem: vi.fn(() => "0") };

    const controller = new StatusController({ stageName: "demo", logger: { warn: vi.fn() } });
    const entry = controller.transition(AgentStatus.PAUSED);

    expect(entry.invalid).toBe(true);
    expect(globalThis.localStorage.getItem).toHaveBeenCalledWith("pb_strictLoopStatusTransitions");
  });

  it("treats storage errors as strict=true by default", () => {
    delete process.env[ENV_KEY];
    globalThis.localStorage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    const controller = new StatusController({ stageName: "demo" });
    expect(() => controller.transition(AgentStatus.PAUSED)).toThrow(/loopStatus transition rejected/i);
  });

  it("supports meta.strict overrides and force/allowReset escape hatches", () => {
    const controller = new StatusController({ strict: true, stageName: "demo", logger: { warn: vi.fn() } });

    expect(() => controller.transition(AgentStatus.PAUSED, { strict: true })).toThrow(/loopStatus transition rejected/i);

    const entry = controller.transition(AgentStatus.PAUSED, { strict: false, reason: "manual" });
    expect(entry.invalid).toBe(true);
    expect(controller.status).toBe(AgentStatus.PAUSED);

    const forced = controller.transition(AgentStatus.RUNNING, { force: true });
    expect(forced).toMatchObject({ from: AgentStatus.PAUSED, to: AgentStatus.RUNNING });

    const reset = controller.transition(AgentStatus.IDLE, { allowReset: true });
    expect(reset).toMatchObject({ from: AgentStatus.RUNNING, to: AgentStatus.IDLE });

    const emptyStatus = controller.transition("", { strict: true });
    expect(emptyStatus).toMatchObject({ from: AgentStatus.IDLE, to: "" });

    const nullStatus = controller.transition(null);
    expect(nullStatus).toMatchObject({ from: "", to: null });

    const undefinedStatus = controller.transition(undefined);
    expect(undefinedStatus).toMatchObject({ from: null, to: undefined });
  });

  it("records timestamps with boundary numbers and falls back for string inputs", () => {
    const controller = new StatusController({ strict: true });

    const first = controller.transition(AgentStatus.RUNNING, { timestamp: 0 });
    const second = controller.transition(AgentStatus.PAUSED, { timestamp: -1 });
    const third = controller.transition(AgentStatus.RUNNING, { timestamp: Number.MAX_SAFE_INTEGER });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(456);
    const fourth = controller.transition(AgentStatus.COMPLETED, { timestamp: "123" });
    nowSpy.mockRestore();

    expect(first.timestamp).toBe(0);
    expect(second.timestamp).toBe(-1);
    expect(third.timestamp).toBe(Number.MAX_SAFE_INTEGER);
    expect(fourth.timestamp).toBe(456);
  });

  it("emits status-changed events and ignores no-op transitions", () => {
    const emit = vi.fn();
    const controller = new StatusController({ stageName: "demo", actor: "alice", emit });

    const entry = controller.transition(AgentStatus.RUNNING, { timestamp: 123 });
    expect(entry.timestamp).toBe(123);
    expect(emit).toHaveBeenCalledWith("demo.agent.status.changed", {
      actor: "alice",
      status: "info",
      payload: expect.objectContaining({
        from: AgentStatus.IDLE,
        to: AgentStatus.RUNNING,
        timestamp: 123,
      }),
    });

    emit.mockClear();
    controller.init({ eventName: "custom.event" });
    controller.transition(AgentStatus.PAUSED);
    expect(emit).toHaveBeenCalledWith("custom.event", expect.any(Object));

    emit.mockClear();
    expect(controller.transition(AgentStatus.PAUSED)).toBe(null);
    expect(emit).not.toHaveBeenCalled();
  });

  it("handles metadata edge types and resource-heavy payloads", () => {
    const controller = new StatusController({ strict: true });
    const hugePayload = "x".repeat(100000);
    const deepNested = { level1: { level2: { level3: { level4: { value: 42 } } } } };

    const entry = controller.transition(AgentStatus.RUNNING, { payload: hugePayload, details: deepNested });
    expect(entry.payload.length).toBe(hugePayload.length);
    expect(entry.details.level1.level2.level3.level4.value).toBe(42);

    const arrayMeta = controller.transition(AgentStatus.PAUSED, []);
    expect(arrayMeta).toMatchObject({ from: AgentStatus.RUNNING, to: AgentStatus.PAUSED });

    const emptyObjectMeta = controller.transition(AgentStatus.RUNNING, {});
    expect(emptyObjectMeta).toMatchObject({ from: AgentStatus.PAUSED, to: AgentStatus.RUNNING });
  });

  it("uses machine predicates and falls back to module logger when warn is missing", () => {
    const canTransitionMachine = { canTransition: vi.fn(() => false) };
    const controller = new StatusController({
      strict: false,
      machine: canTransitionMachine,
      // @ts-expect-error: intentional to trigger fallback logger
      logger: {},
    });

    const entry = controller.transition(AgentStatus.PAUSED);
    expect(entry.invalid).toBe(true);
    expect(canTransitionMachine.canTransition).toHaveBeenCalledWith(
      AgentStatus.IDLE,
      AgentStatus.PAUSED,
      expect.any(Object),
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining("loopStatus transition rejected"));

    const transitionMachine = { transition: vi.fn(() => false) };
    const controller2 = new StatusController({
      strict: false,
      machine: transitionMachine,
      // @ts-expect-error: intentional to trigger fallback logger
      logger: {},
    });

    const entry2 = controller2.transition(AgentStatus.PAUSED);
    expect(entry2.invalid).toBe(true);
    expect(transitionMachine.transition).toHaveBeenCalled();
  });

  it("handles machine functions and logs when machines throw", () => {
    const warn1 = vi.fn();
    const machineFn = vi.fn(() => false);
    const controller = new StatusController({ strict: false, machine: machineFn, logger: { warn: warn1 } });

    const entry = controller.transition(AgentStatus.PAUSED);
    expect(entry.invalid).toBe(true);
    expect(machineFn).toHaveBeenCalledWith(AgentStatus.IDLE, AgentStatus.PAUSED, expect.any(Object));

    const warn2 = vi.fn();
    const throwingMachine = () => {
      throw new Error("boom");
    };

    const controller2 = new StatusController({ strict: true, machine: throwingMachine, logger: { warn: warn2 } });
    expect(() => controller2.transition(AgentStatus.PAUSED)).toThrow(/loopStatus transition rejected/i);
    expect(warn2).toHaveBeenCalledWith(expect.stringContaining("loopStatus machine threw: boom"));
  });

  it("tracks pause/resume state and creates pause errors from runtime or local reasons", () => {
    const controller = new StatusController();
    const signal = new AbortController().signal;

    expect(controller.isPaused).toBe(false);
    expect(controller.pauseReason).toBe(null);

    controller.pause();
    expect(controller.isPaused).toBe(true);
    expect(controller.pauseReason).toBe("user_requested");

    const longReason = "y".repeat(50000);
    controller.pause(longReason);

    mocks.getRuntimeState.mockReturnValue({ pausedReason: "runtime", lastCheckpointId: "cp-1" });
    const err = controller.createPauseError({ signal, runId: "run-1" });
    expect(err).toBeInstanceOf(StagePausedError);
    expect(err.reason).toBe("runtime");
    expect(err.checkpointId).toBe("cp-1");
    expect(err.runId).toBe("run-1");
    expect(err.timestamp).toEqual(expect.any(String));

    mocks.getRuntimeState.mockReturnValue({ pausedReason: "", lastCheckpointId: "cp-2" });
    const err2 = controller.createPauseError({ signal, runId: "run-2" });
    expect(err2.reason).toBe(longReason);
    expect(err2.checkpointId).toBe("cp-2");

    controller.pause(null);
    const err3 = controller.createPauseError({ signal });
    expect(err3.reason).toBe(null);

    controller.resume();
    expect(controller.isPaused).toBe(false);
    expect(controller.pauseReason).toBe(null);
  });

  it("checkPaused throws StagePausedError only when runtime is paused", () => {
    const controller = new StatusController();
    const signal = new AbortController().signal;

    mocks.getRuntimeState.mockReturnValueOnce(null);
    expect(() => controller.checkPaused(signal)).not.toThrow();

    mocks.getRuntimeState.mockReturnValueOnce({ status: "running" });
    expect(() => controller.checkPaused(signal)).not.toThrow();

    mocks.getRuntimeState.mockReturnValueOnce({
      status: "paused",
      lastCheckpointId: "cp-3",
      pausedReason: "manual",
    });

    let thrown;
    try {
      controller.checkPaused(signal);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(StagePausedError);
    expect(thrown.checkpointId).toBe("cp-3");
    expect(thrown.reason).toBe("manual");
  });

  it("shouldPauseFromError and _isAbortError handle abort-like errors", () => {
    const controller = new StatusController();
    const signal = new AbortController().signal;

    expect(controller.shouldPauseFromError(new Error("aborted"), signal)).toBe(false);

    controller.pause("manual");
    expect(controller.shouldPauseFromError({ name: "AbortError" }, signal)).toBe(true);
    expect(controller.shouldPauseFromError({ code: "CanceledError" }, signal)).toBe(true);
    expect(controller.shouldPauseFromError("cancelled by user", signal)).toBe(true);
    expect(controller.shouldPauseFromError(new Error("boom"), signal)).toBe(false);

    controller.resume();
    mocks.getRuntimeState.mockReturnValue({ status: "paused" });
    expect(controller.shouldPauseFromError("aborted", signal)).toBe(true);

    const abortController = new AbortController();
    abortController.abort("done");
    expect(controller._isAbortError(new Error("other"), abortController.signal)).toBe(true);
    expect(controller._isAbortError(null, signal)).toBe(false);
  });

  it("handles concurrent and rapid transition calls", async () => {
    const controller = new StatusController({ strict: true });

    await Promise.all([
      Promise.resolve().then(() => controller.transition(AgentStatus.RUNNING)),
      Promise.resolve().then(() => controller.transition(AgentStatus.PAUSED)),
      Promise.resolve().then(() => controller.transition(AgentStatus.RUNNING)),
    ]);

    controller.transition(AgentStatus.COMPLETED);

    expect(controller.statusHistory).toHaveLength(4);
    expect(controller.status).toBe(AgentStatus.COMPLETED);
  });
});
