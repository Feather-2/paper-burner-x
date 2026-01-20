import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:events", () => ({
  EventEmitter: class MockEventEmitter {
    emit() {}
  },
}));

import { EventEmitter } from "node:events";
import { RunReplayController } from "../../../../../js/agents/plugins/telemetry/replay-controller.js";

const makeRunStore = (events = []) => ({
  getEvents: vi.fn().mockResolvedValue(events),
});

const makeEventBus = () => ({
  _dispatch: vi.fn(),
});

const makeController = (events = [], options = {}) => {
  const runStore = options.runStore ?? makeRunStore(events);
  const eventBus = options.eventBus ?? makeEventBus();
  const controller = new RunReplayController({
    runStore,
    eventBus,
    speed: options.speed,
    maxDelayMs: options.maxDelayMs,
  });
  return { controller, runStore, eventBus };
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RunReplayController", () => {
  it("validates runStore and eventBus inputs", () => {
    const validRunStore = { getEvents: vi.fn() };
    const validEventBus = { _dispatch: vi.fn() };

    expect(() => new RunReplayController()).toThrow(/runStore/);
    expect(() => new RunReplayController({ runStore: null, eventBus: validEventBus })).toThrow(/runStore/);
    expect(() => new RunReplayController({ runStore: "", eventBus: validEventBus })).toThrow(/runStore/);
    expect(() => new RunReplayController({ runStore: {}, eventBus: validEventBus })).toThrow(/runStore/);
    expect(() => new RunReplayController({ runStore: { getEvents: "nope" }, eventBus: validEventBus })).toThrow(/runStore/);

    expect(() => new RunReplayController({ runStore: validRunStore, eventBus: null })).toThrow(/eventBus/);
    expect(() => new RunReplayController({ runStore: validRunStore, eventBus: "" })).toThrow(/eventBus/);
    expect(() => new RunReplayController({ runStore: validRunStore, eventBus: {} })).toThrow(/eventBus/);
    expect(() => new RunReplayController({ runStore: validRunStore, eventBus: { emit: "nope" } })).toThrow(/eventBus/);

    expect(() => new RunReplayController({ runStore: validRunStore, eventBus: { _dispatch: vi.fn() } })).not.toThrow();
    expect(() => new RunReplayController({ runStore: validRunStore, eventBus: { emit: vi.fn() } })).not.toThrow();
  });

  it("rejects invalid runId values and accepts whitespace strings", async () => {
    const { controller } = makeController();

    await expect(controller.load(null)).rejects.toThrow(/runId/);
    await expect(controller.load(undefined)).rejects.toThrow(/runId/);
    await expect(controller.load("")).rejects.toThrow(/runId/);

    await controller.load(" ");
    expect(controller.state.runId).toBe(" ");
  });

  it("uses provided events array and handles empty arrays", async () => {
    const runStore = { getEvents: vi.fn(() => [{ name: "ignored", ts: 0 }]) };
    const eventBus = { _dispatch: vi.fn() };
    const controller = new RunReplayController({ runStore, eventBus });

    await controller.load("run-empty", { events: [] });

    expect(runStore.getEvents).not.toHaveBeenCalled();
    expect(controller.state.total).toBe(0);
    expect(controller.state.status).toBe("idle");
  });

  it("falls back to runStore when events is not an array", async () => {
    const events = [{ name: "from-store", ts: 0 }];
    const runStore = { getEvents: vi.fn().mockResolvedValue(events) };
    const eventBus = { _dispatch: vi.fn() };
    const controller = new RunReplayController({ runStore, eventBus });

    await controller.load("run-store", { events: {} });

    expect(runStore.getEvents).toHaveBeenCalledWith("run-store");
    controller.step();
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);
  });

  it("orders events by sequence when both have seq (including meta.seq)", async () => {
    const events = [
      { name: "two", seq: 2, ts: 20 },
      { name: "one", seq: 1, ts: 10 },
      { name: "zero", meta: { seq: 0 }, ts: 30 },
    ];
    const { controller, eventBus } = makeController(events);

    await controller.load("run-seq");
    controller.step();
    controller.step();
    controller.step();

    const names = eventBus._dispatch.mock.calls.map((call) => call[0].name);
    expect(names).toEqual(["zero", "one", "two"]);
  });

  it("orders by timestamp, index fallback, and insertion order when seq is missing", async () => {
    const events = [
      { name: "late", ts: "1970-01-01T00:00:00.010Z" },
      { name: "fallback", ts: "" },
      { name: "mid", ts: "1970-01-01T00:00:00.005Z" },
      { name: "tie-a", ts: 5 },
      { name: "tie-b", ts: 5 },
    ];
    const { controller, eventBus } = makeController(events);

    await controller.load("run-ts");
    for (let i = 0; i < events.length; i += 1) {
      controller.step();
    }

    const names = eventBus._dispatch.mock.calls.map((call) => call[0].name);
    expect(names).toEqual(["fallback", "mid", "tie-a", "tie-b", "late"]);
  });

  it("normalizes speed inputs", () => {
    const { controller } = makeController([]);

    controller.setSpeed(0);
    expect(controller.speed).toBe(1);

    controller.setSpeed(-1);
    expect(controller.speed).toBe(1);

    controller.setSpeed("2");
    expect(controller.speed).toBe(2);

    controller.setSpeed(" ");
    expect(controller.speed).toBe(1);

    controller.setSpeed(Number.MAX_SAFE_INTEGER);
    expect(controller.speed).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("clamps fromIndex and ignores non-finite play inputs", async () => {
    vi.useFakeTimers();
    const events = [
      { name: "a", ts: 0 },
      { name: "b", ts: 10 },
      { name: "c", ts: 20 },
    ];
    const { controller } = makeController(events);

    await controller.load("run-play");

    controller.play({ fromIndex: -1 });
    expect(controller.state.cursor).toBe(0);
    controller.pause();

    controller.play({ fromIndex: Number.MAX_SAFE_INTEGER });
    expect(controller.state.cursor).toBe(events.length - 1);
    controller.pause();

    controller.setSpeed(1);
    controller.play({ fromIndex: "1", speed: "2" });
    expect(controller.state.cursor).toBe(events.length - 1);
    expect(controller.speed).toBe(1);
    controller.pause();
  });

  it("pauses playback and stop resets state", async () => {
    vi.useFakeTimers();
    const events = [
      { name: "a", ts: 0 },
      { name: "b", ts: 100 },
    ];
    const { controller, eventBus } = makeController(events);

    await controller.load("run-pause");

    controller.play();
    controller.pause();
    expect(controller.state.status).toBe("paused");

    vi.advanceTimersByTime(1000);
    expect(eventBus._dispatch).not.toHaveBeenCalled();

    controller.play();
    vi.advanceTimersByTime(0);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);

    controller.stop();
    expect(controller.state.status).toBe("idle");
    expect(controller.state.cursor).toBe(0);
    expect(controller.state.elapsedMs).toBe(0);
  });

  it("seeks by index or offset and ignores non-numeric values", async () => {
    const events = [
      { name: "a", ts: 0 },
      { name: "b", ts: 50 },
      { name: "c", ts: 100 },
    ];
    const { controller } = makeController(events);

    await controller.load("run-seek");

    controller.seek({ index: 1 });
    expect(controller.state.cursor).toBe(1);
    expect(controller.state.elapsedMs).toBe(0);

    controller.seek({ index: -1 });
    expect(controller.state.cursor).toBe(0);

    controller.seek({ offsetMs: 60 });
    expect(controller.state.cursor).toBe(2);
    expect(controller.state.elapsedMs).toBe(60);

    controller.seek({ offsetMs: "90" });
    expect(controller.state.cursor).toBe(2);
  });

  it("emits valid records with replay meta and skips invalid entries", async () => {
    const deepMeta = { nested: { level: 3 } };
    const events = [
      { name: "valid", meta: deepMeta },
      { name: "" },
      null,
      { name: " ", meta: { note: "space" } },
      { name: 123 },
    ];
    const { controller, eventBus } = makeController(events);

    await controller.load("run-step");
    for (let i = 0; i < events.length + 1; i += 1) {
      controller.step();
    }

    expect(eventBus._dispatch).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = eventBus._dispatch.mock.calls;
    expect(firstCall[0].name).toBe("valid");
    expect(firstCall[0].meta.replay).toBe(true);
    expect(firstCall[0].meta.nested).toBe(deepMeta.nested);
    expect(deepMeta.replay).toBeUndefined();

    expect(secondCall[0].name).toBe(" ");
    expect(secondCall[0].meta.replay).toBe(true);

    controller.step();
    expect(eventBus._dispatch).toHaveBeenCalledTimes(2);
  });

  it("uses eventBus.emit when _dispatch is unavailable", async () => {
    const events = [{ name: "emit.event", ts: 0 }];
    const runStore = { getEvents: vi.fn().mockResolvedValue(events) };
    const eventBus = new EventEmitter();
    const emitSpy = vi.spyOn(eventBus, "emit");
    const controller = new RunReplayController({ runStore, eventBus });

    await controller.load("run-emit");
    controller.step();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0]).toBe("emit.event");
    expect(emitSpy.mock.calls[0][1].meta.replay).toBe(true);
  });

  it("clamps delay and avoids duplicate scheduling on rapid play calls", async () => {
    vi.useFakeTimers();
    const events = [
      { name: "first", ts: 0 },
      { name: "second", ts: 1000 },
    ];
    const { controller, eventBus } = makeController(events, { maxDelayMs: 100 });

    await controller.load("run-delay");

    controller.play();
    controller.play();

    vi.advanceTimersByTime(0);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(2);
  });

  it("applies speed scaling when maxDelayMs is disabled", async () => {
    vi.useFakeTimers();
    const events = [
      { name: "first", ts: 0 },
      { name: "second", ts: 1000 },
    ];
    const { controller, eventBus } = makeController(events, { speed: 2, maxDelayMs: -1 });

    await controller.load("run-speed");

    controller.play();

    vi.advanceTimersByTime(0);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(499);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(eventBus._dispatch).toHaveBeenCalledTimes(2);
  });

  it("handles large event lists and long identifiers", async () => {
    const longRunId = "x".repeat(10000);
    const longName = `evt-${"y".repeat(10000)}`;
    const events = Array.from({ length: 10000 }, (_, index) => ({
      name: `evt-${index}`,
      ts: index,
    }));
    events[events.length - 1] = { name: longName, ts: events.length - 1 };

    const runStore = { getEvents: vi.fn().mockResolvedValue(events) };
    const eventBus = { _dispatch: vi.fn() };
    const controller = new RunReplayController({ runStore, eventBus });

    await controller.load(longRunId);
    expect(controller.state.runId).toBe(longRunId);
    expect(controller.state.total).toBe(events.length);

    controller.seek({ index: Number.MAX_SAFE_INTEGER });
    controller.step();
    expect(eventBus._dispatch).toHaveBeenCalledTimes(1);
    expect(eventBus._dispatch.mock.calls[0][0].name).toBe(longName);
  });
});
