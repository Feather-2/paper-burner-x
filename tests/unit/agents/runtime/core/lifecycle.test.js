import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/core/agent-status.js", () => {
  const AgentStatus = {
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
    COMPLETED: "completed",
    FAILED: "failed",
  };
  return { AgentStatus, default: AgentStatus };
});

import {
  createEventPayload,
  createPhaseTransitionPayload,
  createStatusChangePayload,
  createStepPayload,
  lifecycleEvent,
  LifecycleEventNames,
  createLifecycleEmitter,
} from "../../../../../js/agents/runtime/core/lifecycle.js";

const FIXED_TIMESTAMP = 1_700_000_000_000;

describe("agents/runtime/core/lifecycle.js", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createEventPayload", () => {
    it("returns timestamp and merges data", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const payload = createEventPayload("agent", "info", { foo: "bar" });

      expect(payload).toEqual({ timestamp: FIXED_TIMESTAMP, foo: "bar" });
      expect(payload).not.toHaveProperty("actor");
      expect(payload).not.toHaveProperty("status");
    });

    it("handles null/undefined/empty inputs", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const cases = [
        createEventPayload("", "", undefined),
        createEventPayload("", "", null),
        createEventPayload("", "", {}),
        createEventPayload("", "", []),
      ];

      for (const payload of cases) {
        expect(payload).toEqual({ timestamp: FIXED_TIMESTAMP });
      }
    });

    it("preserves boundary values and deep/large data", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const longString = "x".repeat(10_000);
      const nested = { a: { b: { c: { d: 1 } } } };
      const arrayLike = { 0: "zero", length: 1 };

      const payload = createEventPayload("agent", "info", {
        zero: 0,
        negative: -1,
        max: Number.MAX_SAFE_INTEGER,
        blank: "",
        space: " ",
        longString,
        nested,
        arrayLike,
      });

      expect(payload.timestamp).toBe(FIXED_TIMESTAMP);
      expect(payload.zero).toBe(0);
      expect(payload.negative).toBe(-1);
      expect(payload.max).toBe(Number.MAX_SAFE_INTEGER);
      expect(payload.blank).toBe("");
      expect(payload.space).toBe(" ");
      expect(payload.longString.length).toBe(longString.length);
      expect(payload.nested).toBe(nested);
      expect(payload.arrayLike).toEqual(arrayLike);
    });

    it("supports rapid concurrent calls without shared state", async () => {
      let counter = 100;
      vi.spyOn(Date, "now").mockImplementation(() => counter++);

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          Promise.resolve().then(() => createEventPayload("agent", "info", { index: i })),
        ),
      );

      expect(results).toHaveLength(5);
      expect(new Set(results.map((item) => item.timestamp)).size).toBe(5);
      expect(results.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
      expect(results[0]).not.toBe(results[1]);
    });
  });

  describe("createPhaseTransitionPayload", () => {
    it("creates payload with transition info and extra data", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const payload = createPhaseTransitionPayload("agent", "init", "run", "run-1", { detail: "x" });

      expect(payload).toEqual({
        timestamp: FIXED_TIMESTAMP,
        runId: "run-1",
        from: "init",
        to: "run",
        detail: "x",
      });
    });

    it("handles null/undefined/edge values and array extras", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const payload = createPhaseTransitionPayload(null, "", " ", undefined, ["x"]);

      expect(payload.timestamp).toBe(FIXED_TIMESTAMP);
      expect(payload.from).toBe("");
      expect(payload.to).toBe(" ");
      expect(payload.runId).toBeUndefined();
      expect(payload["0"]).toBe("x");
    });
  });

  describe("createStatusChangePayload", () => {
    it("creates payload with status change info and extra data", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const payload = createStatusChangePayload("agent", "idle", "running", "run-1", { reason: "start" });

      expect(payload).toEqual({
        timestamp: FIXED_TIMESTAMP,
        runId: "run-1",
        from: "idle",
        to: "running",
        reason: "start",
      });
    });

    it("accepts non-string values and empty inputs without throwing", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const from = { state: "idle" };
      const to = ["running"];
      const payload = createStatusChangePayload("agent", from, to, null, { note: "" });

      expect(payload.timestamp).toBe(FIXED_TIMESTAMP);
      expect(payload.from).toBe(from);
      expect(payload.to).toEqual(to);
      expect(payload.runId).toBeNull();
      expect(payload.note).toBe("");
    });
  });

  describe("createStepPayload", () => {
    it("creates payload with step info and extra data", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const payload = createStepPayload("agent", 1, 3, "progress", { runId: "run-1", note: "x" });

      expect(payload).toEqual({
        timestamp: FIXED_TIMESTAMP,
        step: 1,
        total: 3,
        runId: "run-1",
        note: "x",
      });
    });

    it("handles boundary numeric values and whitespace status", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const payload = createStepPayload("agent", -1, Number.MAX_SAFE_INTEGER, " ", { runId: "run-2" });

      expect(payload.timestamp).toBe(FIXED_TIMESTAMP);
      expect(payload.step).toBe(-1);
      expect(payload.total).toBe(Number.MAX_SAFE_INTEGER);
      expect(payload.runId).toBe("run-2");
    });

    it("accepts type mismatches and array-like values", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const arrayLike = { 0: "zero", length: 1 };
      const payload = createStepPayload("agent", "2", arrayLike, "progress", ["extra"]);

      expect(payload.timestamp).toBe(FIXED_TIMESTAMP);
      expect(payload.step).toBe("2");
      expect(payload.total).toEqual(arrayLike);
      expect(payload["0"]).toBe("extra");
    });
  });

  describe("lifecycleEvent", () => {
    it("formats event names", () => {
      expect(lifecycleEvent("agent", "started")).toBe("agent:started");
    });

    it("handles empty, whitespace, and nullish values", () => {
      expect(lifecycleEvent("", "")).toBe(":");
      expect(lifecycleEvent(" ", " \t")).toBe(" : \t");
      expect(lifecycleEvent(null, undefined)).toBe("null:undefined");
    });
  });

  describe("LifecycleEventNames", () => {
    it("generates standard event names for an actor", () => {
      const actor = "agent";
      const expected = {
        started: "agent:started",
        completed: "agent:completed",
        failed: "agent:failed",
        paused: "agent:paused",
        resumed: "agent:resumed",
        statusChanged: "agent:agent:status:changed",
        phaseTransition: "agent:phase:transition",
        stepStarted: "agent:step:started",
        stepCompleted: "agent:step:completed",
        stepFailed: "agent:step:failed",
      };

      for (const [key, value] of Object.entries(expected)) {
        expect(LifecycleEventNames[key]).toBeInstanceOf(Function);
        expect(LifecycleEventNames[key](actor)).toBe(value);
      }
    });

    it("handles empty and long actor names", () => {
      const emptyActor = "";
      const longActor = "a".repeat(2_000);

      expect(LifecycleEventNames.started(emptyActor)).toBe(":started");
      expect(LifecycleEventNames.failed(longActor)).toBe(`${longActor}:failed`);
    });
  });

  describe("createLifecycleEmitter", () => {
    it("returns lifecycle API methods", () => {
      const emitter = createLifecycleEmitter({ actor: "agent", emit: vi.fn() });

      expect(emitter).toEqual(
        expect.objectContaining({
          started: expect.any(Function),
          completed: expect.any(Function),
          failed: expect.any(Function),
          paused: expect.any(Function),
          resumed: expect.any(Function),
          statusChanged: expect.any(Function),
          phaseTransition: expect.any(Function),
          stepStarted: expect.any(Function),
          stepCompleted: expect.any(Function),
          stepFailed: expect.any(Function),
          emit: expect.any(Function),
        }),
      );
    });

    it("started emits both started events with status and payload", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });

      emitter.started("run-1", { extra: "x" });

      expect(emit).toHaveBeenCalledTimes(2);
      const eventNames = emit.mock.calls.map(([name]) => name);
      expect(eventNames).toEqual(expect.arrayContaining(["agent:started", "agent:agent:started"]));

      for (const [, record] of emit.mock.calls) {
        expect(record).toMatchObject({
          actor: "agent",
          status: "started",
          runId: "run-1",
          payload: { timestamp: FIXED_TIMESTAMP, runId: "run-1", extra: "x" },
        });
      }
    });

    it("completed emits legacy design ended event without runId", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "design", emit });

      emitter.completed("run-2", { detail: "y" });

      const eventNames = emit.mock.calls.map(([name]) => name);
      expect(eventNames).toEqual(
        expect.arrayContaining(["design:completed", "design:agent:completed", "design:ended"]),
      );

      const endedCall = emit.mock.calls.find(([name]) => name === "design:ended");
      expect(endedCall).toBeTruthy();
      const endedRecord = endedCall[1];
      expect(endedRecord.status).toBe("ended");
      expect(endedRecord.payload).toEqual({ timestamp: FIXED_TIMESTAMP, detail: "y" });
      expect(endedRecord.payload).not.toHaveProperty("runId");
    });

    it("failed formats error messages for Error and null values", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });

      emitter.failed("run-3", new Error("boom"));
      emitter.failed("run-4", null);

      const run3Calls = emit.mock.calls.filter(([, record]) => record.runId === "run-3");
      expect(run3Calls).toHaveLength(2);
      for (const [, record] of run3Calls) {
        expect(record.status).toBe("failed");
        expect(record.payload.error).toBe("boom");
      }

      const run4Calls = emit.mock.calls.filter(([, record]) => record.runId === "run-4");
      expect(run4Calls).toHaveLength(2);
      for (const [, record] of run4Calls) {
        expect(record.status).toBe("failed");
        expect(record.payload.error).toBe("null");
      }
    });

    it("paused/resumed use info status and include reason", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });

      emitter.paused("run-5", "", { note: [] });
      emitter.resumed("run-6");

      const pausedCalls = emit.mock.calls.filter(([, record]) => record.runId === "run-5");
      for (const [, record] of pausedCalls) {
        expect(record.status).toBe("info");
        expect(record.payload.reason).toBe("");
        expect(record.payload.note).toEqual([]);
      }

      const resumedCalls = emit.mock.calls.filter(([, record]) => record.runId === "run-6");
      for (const [, record] of resumedCalls) {
        expect(record.status).toBe("info");
        expect(record.payload.reason).toBeUndefined();
      }
    });

    it("statusChanged and phaseTransition emit correct event names and statuses", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });

      emitter.statusChanged("idle", "running", "run-7", { note: {} });
      emitter.phaseTransition("phase-1", "phase-2", "run-7", { step: 1 });

      const statusCall = emit.mock.calls.find(([name]) => name === "agent:agent:status:changed");
      expect(statusCall).toBeTruthy();
      const statusRecord = statusCall[1];
      expect(statusRecord.status).toBe("info");
      expect(statusRecord.payload).toMatchObject({
        runId: "run-7",
        from: "idle",
        to: "running",
      });

      const phaseCall = emit.mock.calls.find(([name]) => name === "agent:phase:transition");
      expect(phaseCall).toBeTruthy();
      const phaseRecord = phaseCall[1];
      expect(phaseRecord.status).toBe("progress");
      expect(phaseRecord.payload).toMatchObject({
        runId: "run-7",
        from: "phase-1",
        to: "phase-2",
      });
    });

    it("step events include step info and error formatting", () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });
      const arrayLike = { length: 3 };

      emitter.stepStarted("2", arrayLike, "run-8", { note: "x" });
      emitter.stepCompleted(0, 0, "run-8");
      emitter.stepFailed(-1, Number.MAX_SAFE_INTEGER, "run-9", "bad", { detail: {} });

      const startedCall = emit.mock.calls.find(([name]) => name === "agent:step:started");
      expect(startedCall).toBeTruthy();
      expect(startedCall[1].status).toBe("progress");
      expect(startedCall[1].payload.step).toBe("2");
      expect(startedCall[1].payload.total).toEqual(arrayLike);

      const completedCall = emit.mock.calls.find(([name]) => name === "agent:step:completed");
      expect(completedCall).toBeTruthy();
      expect(completedCall[1].status).toBe("completed");
      expect(completedCall[1].payload.step).toBe(0);
      expect(completedCall[1].payload.total).toBe(0);

      const failedCall = emit.mock.calls.find(([name]) => name === "agent:step:failed");
      expect(failedCall).toBeTruthy();
      expect(failedCall[1].status).toBe("failed");
      expect(failedCall[1].payload.step).toBe(-1);
      expect(failedCall[1].payload.total).toBe(Number.MAX_SAFE_INTEGER);
      expect(failedCall[1].payload.error).toBe("bad");
    });

    it("emit filters empty fields and keeps whitespace/overrides", () => {
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });

      emitter.emit("custom:event", undefined, { status: "", runId: "", level: "", meta: undefined });
      const emptyRecord = emit.mock.calls[0][1];
      expect(emptyRecord).toEqual({ actor: "agent" });

      emitter.emit("custom:event", null, {
        status: " ",
        actor: " ",
        runId: " ",
        level: " ",
        meta: {},
      });
      const whitespaceRecord = emit.mock.calls[1][1];
      expect(whitespaceRecord).toEqual({
        actor: " ",
        status: " ",
        payload: null,
        runId: " ",
        level: " ",
        meta: {},
      });
    });

    it("avoids double-emitting when direct emit forwards to event bus", () => {
      const eventBus = { _seq: 0, emit: vi.fn() };
      const directEmit = vi.fn(() => {
        eventBus._seq += 1;
      });
      const emitter = createLifecycleEmitter({ actor: "agent", emit: directEmit, eventBus });

      emitter.started("run-10");

      expect(directEmit).toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it("falls back to event bus and swallows emitter errors", () => {
      const eventBus = { _seq: 0, emit: vi.fn() };
      const directEmit = vi.fn(() => {
        throw new Error("boom");
      });
      const emitter = createLifecycleEmitter({ actor: "agent", emit: directEmit, eventBus });

      expect(() => emitter.completed("run-11")).not.toThrow();
      expect(eventBus.emit).toHaveBeenCalledTimes(2);

      const throwingBus = { emit: vi.fn(() => { throw new Error("bus"); }) };
      const emitter2 = createLifecycleEmitter({ actor: "agent", eventBus: throwingBus });
      expect(() => emitter2.failed("run-12", new Error("x"))).not.toThrow();
    });

    it("handles rapid concurrent calls", async () => {
      vi.spyOn(Date, "now").mockReturnValue(FIXED_TIMESTAMP);
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          Promise.resolve().then(() => emitter.started(`run-${i}`)),
        ),
      );

      expect(emit).toHaveBeenCalledTimes(10);
      const runIds = emit.mock.calls.map(([, record]) => record.runId);
      expect(new Set(runIds)).toEqual(new Set(["run-0", "run-1", "run-2", "run-3", "run-4"]));
    });

    it("passes through large payloads and deep meta structures", () => {
      const emit = vi.fn();
      const emitter = createLifecycleEmitter({ actor: "agent", emit });
      const largeFile = "x".repeat(50_000);
      const deepMeta = { a: { b: { c: { d: "e" } } } };
      const payload = { file: largeFile, nested: deepMeta };

      emitter.emit("custom:payload", payload, { meta: { info: deepMeta } });

      const record = emit.mock.calls[0][1];
      expect(record.payload).toBe(payload);
      expect(record.payload.file.length).toBe(largeFile.length);
      expect(record.meta).toEqual({ info: deepMeta });
      expect(record.meta.info).toBe(deepMeta);
    });
  });
});
