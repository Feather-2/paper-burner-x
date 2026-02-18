import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  logMock: vi.fn(),
  debugMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      log: mockState.logMock,
      debug: mockState.debugMock,
      info: mockState.infoMock,
      warn: mockState.warnMock,
      error: mockState.errorMock,
    })),
  };
});

import { subscribeTelemetry } from "../../../../../js/agents/plugins/telemetry/runstore-telemetry.js";

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createEventBus = (runId = "run-1") => {
  let handler;
  const unsubscribe = vi.fn();
  return {
    runId,
    on: vi.fn((name, cb) => {
      handler = cb;
      return unsubscribe;
    }),
    emit: (evt) => {
      if (handler) handler(evt);
    },
    getHandler: () => handler,
    unsubscribe,
  };
};

describe("subscribeTelemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when eventBus or runStore is invalid", () => {
    const runStore = { appendEvent: vi.fn() };

    expect(() => subscribeTelemetry(null, runStore)).toThrow(
      "subscribeTelemetry(eventBus, runStore): eventBus must implement on(name, handler)"
    );
    expect(() => subscribeTelemetry(undefined, runStore)).toThrow(
      "subscribeTelemetry(eventBus, runStore): eventBus must implement on(name, handler)"
    );
    expect(() => subscribeTelemetry({}, runStore)).toThrow(
      "subscribeTelemetry(eventBus, runStore): eventBus must implement on(name, handler)"
    );
    expect(() => subscribeTelemetry([], runStore)).toThrow(
      "subscribeTelemetry(eventBus, runStore): eventBus must implement on(name, handler)"
    );

    const eventBus = { on: vi.fn() };
    expect(() => subscribeTelemetry(eventBus, null)).toThrow(
      "subscribeTelemetry(eventBus, runStore): runStore must implement appendEvent(runId, event)"
    );
    expect(() => subscribeTelemetry(eventBus, undefined)).toThrow(
      "subscribeTelemetry(eventBus, runStore): runStore must implement appendEvent(runId, event)"
    );
    expect(() => subscribeTelemetry(eventBus, {})).toThrow(
      "subscribeTelemetry(eventBus, runStore): runStore must implement appendEvent(runId, event)"
    );
  });

  it("records timeline entries and trims to maxTimelineEntries", async () => {
    const bus = createEventBus("run-main");
    const appendEvent = vi.fn().mockResolvedValue();
    const sub = subscribeTelemetry(bus, { appendEvent }, { maxTimelineEntries: 2.9 });

    expect(bus.on).toHaveBeenCalledWith("*", expect.any(Function));
    expect(sub.unsubscribe).toBe(bus.unsubscribe);

    bus.emit({
      ts: 1,
      actor: "alpha",
      status: "ok",
      payload: { i: 1 },
      name: "run.progress",
      runId: "evt-1",
      extra: "ignore",
    });
    bus.emit({
      ts: 2,
      actor: "beta",
      status: "ok",
      payload: { i: 2 },
      name: "run.progress",
      runId: "evt-1",
    });
    bus.emit({
      ts: 3,
      actor: "gamma",
      status: "ok",
      payload: { i: 3 },
      name: "run.progress",
      runId: "evt-1",
    });

    await sub.flush();

    expect(appendEvent).toHaveBeenCalledTimes(3);
    expect(sub.timeline).toHaveLength(2);
    expect(sub.timeline.map((row) => row.payload?.i)).toEqual([2, 3]);
    expect(sub.timeline[0]).toEqual({
      ts: 2,
      actor: "beta",
      status: "ok",
      payload: { i: 2 },
      name: "run.progress",
    });
    expect(sub.timeline[0].extra).toBeUndefined();

    const snapshot = sub.snapshot();
    snapshot.timeline.push({ name: "extra" });
    snapshot.todos.push({ todoId: "shadow" });
    expect(sub.timeline).toHaveLength(2);
    expect(sub.todos).toHaveLength(0);
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER])(
    "keeps full timeline when maxTimelineEntries is %s",
    async (limit) => {
      const bus = createEventBus("run-limit");
      const appendEvent = vi.fn().mockResolvedValue();
      const sub = subscribeTelemetry(bus, { appendEvent }, { maxTimelineEntries: limit });

      bus.emit({ name: "run.progress", runId: "run-limit", payload: { i: 1 } });
      bus.emit({ name: "run.progress", runId: "run-limit", payload: { i: 2 } });
      bus.emit({ name: "run.progress", runId: "run-limit", payload: { i: 3 } });

      await sub.flush();

      expect(sub.timeline.map((row) => row.payload?.i)).toEqual([1, 2, 3]);
    }
  );

  it("supports explicit unlimited timeline when allowUnlimitedTimeline=true", async () => {
    const bus = createEventBus("run-unlimited");
    const appendEvent = vi.fn().mockResolvedValue();
    const sub = subscribeTelemetry(bus, { appendEvent }, { maxTimelineEntries: 0, allowUnlimitedTimeline: true });

    bus.emit({ name: "run.progress", runId: "run-unlimited", payload: { i: 1 } });
    bus.emit({ name: "run.progress", runId: "run-unlimited", payload: { i: 2 } });
    bus.emit({ name: "run.progress", runId: "run-unlimited", payload: { i: 3 } });
    await sub.flush();

    expect(sub.timeline.map((row) => row.payload?.i)).toEqual([1, 2, 3]);
    expect(mockState.warnMock).not.toHaveBeenCalledWith(
      "maxTimelineEntries<=0 is unsafe; fallback to default",
      expect.anything(),
    );
  });

  it.each(["2", "   ", { length: 2 }])(
    "ignores non-number maxTimelineEntries values: %s",
    async (limit) => {
      const bus = createEventBus("run-non-number");
      const appendEvent = vi.fn().mockResolvedValue();
      const sub = subscribeTelemetry(bus, { appendEvent }, { maxTimelineEntries: limit });

      bus.emit({ name: "run.progress", runId: "run-non-number", payload: { i: 1 } });
      bus.emit({ name: "run.progress", runId: "run-non-number", payload: { i: 2 } });
      bus.emit({ name: "run.progress", runId: "run-non-number", payload: { i: 3 } });

      await sub.flush();

      expect(sub.timeline).toHaveLength(3);
    }
  );

  it("uses runId from event or bus and skips blank runId", async () => {
    const bus = createEventBus("bus-run");
    const appendEvent = vi.fn().mockResolvedValue();
    const sub = subscribeTelemetry(bus, { appendEvent });

    bus.emit({ name: "run.progress", runId: "evt-run", payload: { i: 1 } });
    bus.emit({ name: "run.progress", runId: 0, payload: { i: 2 } });
    bus.emit({ name: "run.progress", runId: "", payload: { i: 3 } });
    bus.emit({ name: "run.progress", runId: "   ", payload: { i: 4 } });

    bus.runId = "   ";
    bus.emit({ name: "run.progress", payload: { i: 5 } });

    await sub.flush();

    expect(appendEvent).toHaveBeenCalledTimes(4);
    expect(appendEvent.mock.calls.map((call) => call[0])).toEqual([
      "evt-run",
      "0",
      "bus-run",
      "bus-run",
    ]);
  });

  it("aggregates todos with createdAt/updatedAt and preserves nested payload", async () => {
    const bus = createEventBus("run-todo");
    const appendEvent = vi.fn().mockResolvedValue();
    const sub = subscribeTelemetry(bus, { appendEvent });

    const longText = "x".repeat(10000);
    const arrayLike = { 0: "a", 1: "b", length: 2 };
    const deepPayload = {
      todoId: "t1",
      text: longText,
      status: "open",
      relatedGapId: "gap-1",
      nested: { level1: { level2: { items: arrayLike } } },
    };

    bus.emit({
      ts: 10,
      name: "app.todo.created",
      payload: deepPayload,
      runId: "run-todo",
    });
    bus.emit({
      ts: 20,
      name: "app.todo.updated",
      payload: { todoId: "t1", status: "done" },
      runId: "run-todo",
    });
    bus.emit({
      ts: 15,
      name: "todo:created",
      payload: { todoId: "t2", text: "short" },
      runId: "run-todo",
    });

    await sub.flush();

    const todos = sub.todos;
    expect(todos).toHaveLength(2);

    const t1 = todos.find((todo) => todo.todoId === "t1");
    expect(t1).toMatchObject({
      todoId: "t1",
      text: longText,
      status: "done",
      relatedGapId: "gap-1",
      createdAt: 10,
      updatedAt: 20,
    });

    const t2 = todos.find((todo) => todo.todoId === "t2");
    expect(t2).toMatchObject({
      todoId: "t2",
      text: "short",
      createdAt: 15,
      updatedAt: 15,
    });

    expect(sub.timeline[0].payload.nested.level1.level2.items).toEqual(arrayLike);
  });

  it("ignores todo upserts for empty or invalid payloads", async () => {
    const bus = createEventBus("run-empty");
    const appendEvent = vi.fn().mockResolvedValue();
    const sub = subscribeTelemetry(bus, { appendEvent });

    bus.emit({ ts: 1, name: "todo.created", payload: {}, runId: "run-empty" });
    bus.emit({ ts: 2, name: "todo.updated", payload: [], runId: "run-empty" });
    bus.emit({ ts: 3, name: "todo.updated", payload: { todoId: "", text: "x" }, runId: "run-empty" });
    bus.emit({ ts: 4, name: "todo.updated", payload: { todoId: "   ", text: "x" }, runId: "run-empty" });

    await sub.flush();

    expect(sub.todos).toEqual([]);
    expect(sub.timeline).toHaveLength(4);
  });

  it("skips replay events", async () => {
    const bus = createEventBus("run-replay");
    const appendEvent = vi.fn().mockResolvedValue();
    const sub = subscribeTelemetry(bus, { appendEvent });

    bus.emit({
      name: "run.progress",
      payload: { i: 1 },
      meta: { replay: true },
      runId: "run-replay",
    });

    await sub.flush();

    expect(appendEvent).not.toHaveBeenCalled();
    expect(sub.timeline).toHaveLength(0);
  });

  it("flush surfaces append errors and clears lastError", async () => {
    const bus = createEventBus("run-error");
    const appendEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("append failed"))
      .mockResolvedValueOnce();
    const sub = subscribeTelemetry(bus, { appendEvent });

    bus.emit({ name: "run.progress", runId: "run-error", payload: { i: 1 } });
    bus.emit({ name: "run.progress", runId: "run-error", payload: { i: 2 } });

    await expect(sub.flush()).rejects.toThrow("append failed");
    expect(mockState.warnMock).toHaveBeenCalledWith(
      "Telemetry append error",
      expect.objectContaining({ error: "append failed", appendFailureCount: 1 }),
    );

    await expect(sub.flush()).resolves.toBeUndefined();
  });

  it("tracks append diagnostics across failures", async () => {
    const bus = createEventBus("run-diagnostics");
    const appendEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("broken-1"))
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("broken-2"));
    const sub = subscribeTelemetry(bus, { appendEvent });

    bus.emit({ name: "run.progress", runId: "run-diagnostics", payload: { i: 1 } });
    bus.emit({ name: "run.progress", runId: "run-diagnostics", payload: { i: 2 } });
    bus.emit({ name: "run.progress", runId: "run-diagnostics", payload: { i: 3 } });

    await expect(sub.flush()).rejects.toThrow(/broken-2|broken-1/);

    const diagnostics = sub.diagnostics;
    expect(diagnostics.appendFailureCount).toBe(2);
    expect(diagnostics.appendSuccessCount).toBe(1);
    expect(Array.isArray(diagnostics.recentAppendErrors)).toBe(true);
    expect(diagnostics.recentAppendErrors.length).toBeGreaterThan(0);
  });

  it("serializes appendEvent for rapid consecutive events", async () => {
    const bus = createEventBus("run-serial");
    const deferreds = [];
    const appendEvent = vi.fn(() => {
      const deferred = createDeferred();
      deferreds.push(deferred);
      return deferred.promise;
    });
    const sub = subscribeTelemetry(bus, { appendEvent });

    bus.emit({ name: "run.progress", runId: "run-serial", payload: { i: 1 } });
    bus.emit({ name: "run.progress", runId: "run-serial", payload: { i: 2 } });

    await Promise.resolve();
    expect(appendEvent).toHaveBeenCalledTimes(1);

    deferreds[0].resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(appendEvent).toHaveBeenCalledTimes(2);

    deferreds[1].resolve();
    await sub.flush();
  });
});
