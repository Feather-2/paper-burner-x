import { describe, it, expect, vi } from "vitest";

import StatusController from "../../../../js/agents/runtime/core/status-controller.js";
import { AgentStatus } from "../../../../js/agents/runtime/core/agent-status.js";
import { setRuntimeState, clearRuntimeState, LoopRuntimeStatuses } from "../../../../js/agents/runtime/telemetry/loop-runtime-state.js";

describe("runtime/core/status-controller", () => {
  it("derives strict transition behavior from PB_STRICT_LOOP_STATUS_TRANSITIONS", () => {
    const prev = process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;
    process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS = "false";
    try {
      const controller = new StatusController({ stageName: "demo", logger: { warn: vi.fn() } });
      // IDLE -> PAUSED is invalid, but env strict=false should record instead of throwing.
      const entry = controller.transition(AgentStatus.PAUSED);
      expect(entry).toMatchObject({ from: AgentStatus.IDLE, to: AgentStatus.PAUSED, invalid: true });
      expect(controller.status).toBe(AgentStatus.PAUSED);
    } finally {
      if (prev === undefined) delete process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;
      else process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS = prev;
    }
  });

  it("falls back to localStorage when env is unset", () => {
    const prevEnv = process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;
    delete process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;

    const prevStorage = globalThis.localStorage;
    globalThis.localStorage = { getItem: vi.fn(() => "0") };

    try {
      const controller = new StatusController({ stageName: "demo", logger: { warn: vi.fn() } });
      const entry = controller.transition(AgentStatus.PAUSED);
      expect(entry?.invalid).toBe(true);
    } finally {
      if (prevEnv === undefined) delete process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;
      else process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS = prevEnv;
      globalThis.localStorage = prevStorage;
    }
  });

  it("treats storage errors as strict=true by default", () => {
    const prevEnv = process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;
    delete process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;

    const prevStorage = globalThis.localStorage;
    globalThis.localStorage = { getItem: vi.fn(() => { throw new Error("blocked"); }) };

    try {
      const controller = new StatusController({ stageName: "demo" });
      expect(() => controller.transition(AgentStatus.PAUSED)).toThrow(/loopStatus transition rejected/i);
    } finally {
      if (prevEnv === undefined) delete process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS;
      else process.env.PB_STRICT_LOOP_STATUS_TRANSITIONS = prevEnv;
      globalThis.localStorage = prevStorage;
    }
  });

  it("supports meta.strict overrides and force/allowReset escape hatches", () => {
    const nonStrict = new StatusController({ strict: false, stageName: "demo", logger: { warn: vi.fn() } });
    expect(() => nonStrict.transition(AgentStatus.PAUSED, { strict: true })).toThrow(/loopStatus transition rejected/i);

    const strict = new StatusController({ strict: true, stageName: "demo", logger: { warn: vi.fn() } });
    // meta.strict=false should keep going even if controller default is strict.
    const entry = strict.transition(AgentStatus.PAUSED, { strict: false });
    expect(entry?.invalid).toBe(true);

    // force=true bypasses the default machine completely.
    const forced = strict.transition(AgentStatus.RUNNING, { force: true });
    expect(forced).toMatchObject({ from: AgentStatus.PAUSED, to: AgentStatus.RUNNING });

    // allowReset allows returning to IDLE from any state.
    const reset = strict.transition(AgentStatus.IDLE, { allowReset: true });
    expect(reset).toMatchObject({ from: AgentStatus.RUNNING, to: AgentStatus.IDLE });

    // Invalid/unknown statuses are tolerated (treated as allowed).
    const weird = strict.transition("mystery-status", { strict: true });
    expect(weird).toMatchObject({ from: AgentStatus.IDLE, to: "mystery-status" });
  });

  it("emits default status-changed event name and supports timestamps + no-op transitions", () => {
    const emit = vi.fn();
    const controller = new StatusController({ stageName: "demo", actor: "alice", emit });

    const first = controller.transition(AgentStatus.RUNNING, { timestamp: 123 });
    expect(first?.timestamp).toBe(123);
    expect(emit).toHaveBeenCalledWith("demo.agent.status.changed", {
      actor: "alice",
      status: "info",
      payload: expect.objectContaining({ from: AgentStatus.IDLE, to: AgentStatus.RUNNING, timestamp: 123 }),
    });

    emit.mockClear();
    // Same status => no transition recorded, no emit.
    expect(controller.transition(AgentStatus.RUNNING)).toBe(null);
    expect(emit).not.toHaveBeenCalled();
  });

  it("init() repairs corrupted history and checkPaused ignores non-paused runtime states", () => {
    const controller = new StatusController({ stageName: "demo", strict: true });
    // @ts-expect-error: simulate corruption
    controller._statusHistory = null;
    controller.init({ status: AgentStatus.RUNNING, eventName: "evt", strict: false });
    expect(controller.status).toBe(AgentStatus.RUNNING);
    expect(controller.statusHistory).toEqual([]);

    const ac = new AbortController();
    setRuntimeState(ac.signal, { status: LoopRuntimeStatuses.RUNNING });
    expect(() => controller.checkPaused(ac.signal)).not.toThrow();
    clearRuntimeState(ac.signal);
  });

  it("tracks pause/resume state (pauseReason + isPaused)", () => {
    const controller = new StatusController();
    expect(controller.isPaused).toBe(false);
    expect(controller.pauseReason).toBe(null);

    controller.pause("manual");
    expect(controller.isPaused).toBe(true);
    expect(controller.pauseReason).toBe("manual");

    controller.resume();
    expect(controller.isPaused).toBe(false);
    expect(controller.pauseReason).toBe(null);
  });

  it("supports machine.canTransition/machine.transition and falls back to default logger", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const canTransitionMachine = { canTransition: vi.fn(() => false) };
      const controller1 = new StatusController({
        strict: false,
        stageName: "demo",
        // No warn() method -> should fall back to module logger.warn()
        // @ts-expect-error: intentional
        logger: {},
        machine: canTransitionMachine,
      });
      const entry1 = controller1.transition(AgentStatus.PAUSED);
      expect(entry1?.invalid).toBe(true);
      expect(canTransitionMachine.canTransition).toHaveBeenCalledTimes(1);

      const transitionMachine = { transition: vi.fn(() => false) };
      const controller2 = new StatusController({
        strict: false,
        stageName: "demo",
        // @ts-expect-error: intentional
        logger: {},
        machine: transitionMachine,
      });
      const entry2 = controller2.transition(AgentStatus.PAUSED);
      expect(entry2?.invalid).toBe(true);
      expect(transitionMachine.transition).toHaveBeenCalledTimes(1);

      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
