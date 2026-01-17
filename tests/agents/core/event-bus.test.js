/**
 * EventBus 测试 - 使用 node:test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  EventBus,
  LamportClock,
  RunStoreAdapter,
  createEventRecord,
  isValidEventName,
  matchPattern,
} from "../../../js/agents/core/index.js";
import { resetClock } from "../../../js/agents/core/lamport-clock.js";

function nextMicrotask() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("EventBus", () => {
  /** @type {EventBus} */
  let bus;

  beforeEach(() => {
    resetClock();
    bus = new EventBus({ keepHistory: true });
  });

  afterEach(() => {
    bus.dispose();
    resetClock();
  });

  describe("emit and on", () => {
    it("should emit and receive events", async () => {
      const handler = vi.fn();
      bus.on("test.event", handler);

      bus.emit("test.event", { value: 42 });

      expect(handler.mock.calls.length).toBe(1);
      const evt = handler.mock.calls[0][0];
      expect(evt.type).toBe("test.event");
      expect(evt.schemaVersion).toBe("0.1");
      expect(evt.payload).toEqual({ value: 42 });
    });

    it("should support wildcard patterns", () => {
      const handler = vi.fn();
      bus.on("user.*", handler);

      bus.emit("user.login", { id: 1 });
      bus.emit("user.logout", { id: 1 });
      bus.emit("system.error", {}); // should not match

      expect(handler.mock.calls.length).toBe(2);
    });

    it("should support global wildcard *", () => {
      const handler = vi.fn();
      bus.on("*", handler);

      bus.emit("any.event", {});
      bus.emit("another", {});

      expect(handler.mock.calls.length).toBe(2);
    });

    it("should unsubscribe correctly", () => {
      const handler = vi.fn();
      const unsub = bus.on("test", handler);

      bus.emit("test", {});
      expect(handler.mock.calls.length).toBe(1);

      unsub();
      bus.emit("test", {});
      expect(handler.mock.calls.length).toBe(1); // still 1
    });

    it("should accept EventRecord-like payload/meta input", () => {
      const handler = vi.fn();
      bus.on("record.like", handler);

      const evt = bus.emit("record.like", {
        actor: "alice",
        status: "ok",
        level: "info",
        payload: { value: 1 },
        meta: { source: "test" },
      });

      expect(handler.mock.calls.length).toBe(1);
      expect(evt.actor).toBe("alice");
      expect(evt.status).toBe("ok");
      expect(evt.level).toBe("info");
      expect(evt.payload).toEqual({ value: 1 });
      expect(evt.meta).toEqual({ source: "test" });
    });

    it("should throw for invalid event names", () => {
      expect(() => bus.on("Bad Name", () => {})).toThrow(/Invalid event/);
      expect(() => bus.on("a..b", () => {})).toThrow(/Invalid event/);
    });

    it("should throw for invalid handler", () => {
      expect(() => bus.on("test", null)).toThrow(/handler must be a function/i);
      expect(() => bus.on("test", "not-a-fn")).toThrow(/handler must be a function/i);
    });
  });

  describe("emitSync", () => {
    it("should emit synchronously", () => {
      const handler = vi.fn();
      bus.on("sync.event", handler);

      bus.emitSync("sync.event", { sync: true });

      expect(handler.mock.calls.length).toBe(1);
    });

    it("should record history", () => {
      bus.emitSync("sync.hist", { n: 1 });
      const hist = bus.getHistory();
      expect(hist.length).toBe(1);
      expect(hist[0].name).toBe("sync.hist");
    });
  });

  describe("once", () => {
    it("should only fire once", () => {
      const handler = vi.fn();
      bus.once("one.time", handler);

      bus.emit("one.time", {});
      bus.emit("one.time", {});

      expect(handler.mock.calls.length).toBe(1);
    });

    it("off() should accept original handler for once() wrapper", () => {
      const handler = vi.fn();
      bus.once("wrapped.once", handler);

      expect(bus.off("wrapped.once", handler)).toBe(true);
      bus.emit("wrapped.once", {});
      expect(handler.mock.calls.length).toBe(0);
    });
  });

  describe("priority", () => {
    it("should call high priority handlers first", () => {
      const order = [];

      bus.on("priority.test", () => order.push("normal"));
      bus.on("priority.test", () => order.push("high"), { priority: 10 });
      bus.on("priority.test", () => order.push("low"), { priority: -10 });

      bus.emit("priority.test", {});

      expect(order).toEqual(["high", "normal", "low"]);
    });

    it("should support wildcard priority subscriptions", () => {
      const handler = vi.fn();
      bus.subscribe("user.*", handler, { priority: 5 });

      bus.emit("user.login", { id: 1 });
      bus.emit("system.error", {}); // should not match

      expect(handler.mock.calls.length).toBe(1);
      expect(handler.mock.calls[0][0].name).toBe("user.login");
    });

    it("should validate priority is finite number", () => {
      expect(() => bus.subscribe("test", () => {}, { priority: NaN })).toThrow(
        /priority must be a finite number/i
      );
      expect(() => bus.subscribe("test", () => {}, { priority: Infinity })).toThrow(
        /priority must be a finite number/i
      );
    });
  });

  describe("waitFor", () => {
    it("should wait for event", async () => {
      const promise = bus.waitFor("delayed.event");

      setTimeout(() => {
        bus.emitSync("delayed.event", { delayed: true });
      }, 10);

      const event = await promise;
      expect(event.type).toBe("delayed.event");
      expect(event.payload).toEqual({ delayed: true });
    });

    it("should timeout if event not received", async () => {
      await expect(bus.waitFor("never.happens", { timeout: 50 })).rejects.toThrow(
        /timeout/i
      );
      expect(bus._waiters.size).toBe(0);
    });

    it("should support abort signal", async () => {
      const controller = new AbortController();

      const promise = bus.waitFor("aborted.event", { signal: controller.signal });

      setTimeout(() => controller.abort(), 10);

      await expect(promise).rejects.toThrow(/abort/i);
      expect(bus._waiters.size).toBe(0);
    });

    it("should resolve if event occurs before abort", async () => {
      const controller = new AbortController();
      const promise = bus.waitFor("race.event", { signal: controller.signal });

      bus.emitSync("race.event", { ok: true });
      controller.abort(new Error("abort after emit"));

      const evt = await promise;
      expect(evt.type).toBe("race.event");
      expect(evt.payload).toEqual({ ok: true });
    });

    it("should accept numeric timeout argument", async () => {
      const promise = bus.waitFor("numeric.timeout", 1000);
      bus.emitSync("numeric.timeout", { ok: true });

      const evt = await promise;
      expect(evt.type).toBe("numeric.timeout");
      expect(evt.payload).toEqual({ ok: true });
    });

    it("should reject immediately if signal already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("already aborted"));

      await expect(bus.waitFor("never", { signal: controller.signal })).rejects.toThrow(
        /already aborted/i
      );
    });

    it("should support wildcard pattern in waitFor", async () => {
      const promise = bus.waitFor("user.*");

      setTimeout(() => bus.emitSync("user.login", { id: 1 }), 10);

      const evt = await promise;
      expect(evt.type).toBe("user.login");
    });
  });

  describe("history", () => {
    it("should keep event history when enabled", () => {
      bus.emit("event.1", { n: 1 });
      bus.emit("event.2", { n: 2 });

      const history = bus.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].type).toBe("event.1");
      expect(history[1].type).toBe("event.2");
    });

    it("should respect maxHistory", () => {
      const smallBus = new EventBus({ keepHistory: true, maxHistory: 3 });

      for (let i = 0; i < 5; i++) {
        smallBus.emit("event", { i });
      }

      const history = smallBus.getHistory();
      expect(history.length).toBe(3);
      expect(history[0].payload.i).toBe(2); // oldest kept

      smallBus.dispose();
    });

    it("should filter history by wildcard pattern", () => {
      bus.emit("user.login", { id: 1 });
      bus.emit("user.logout", { id: 1 });
      bus.emit("system.ready", {});

      const userEvents = bus.getHistory("user.*");
      expect(userEvents.map((e) => e.name)).toEqual(["user.login", "user.logout"]);
    });

    it("should clear history", () => {
      bus.emit("event.1", { n: 1 });
      expect(bus.getHistory().length).toBe(1);
      bus.clearHistory();
      expect(bus.getHistory()).toEqual([]);
    });

    it("should return empty array when history disabled", () => {
      const noHistBus = new EventBus({ keepHistory: false });
      noHistBus.emit("evt", {});
      expect(noHistBus.getHistory()).toEqual([]);
      noHistBus.dispose();
    });
  });

  describe("Lamport clock", () => {
    it("should increment clock on each event", () => {
      const clock1 = bus.getClock();
      bus.emit("tick", {});
      const clock2 = bus.getClock();

      expect(clock2.seq > clock1.seq).toBeTruthy();
    });

    it("events should have monotonically increasing seq", () => {
      const e1 = bus.emit("a", {});
      const e2 = bus.emit("b", {});
      const e3 = bus.emit("c", {});

      expect(e1.seq < e2.seq).toBeTruthy();
      expect(e2.seq < e3.seq).toBeTruthy();
    });
  });

  describe("persistenceAdapter", () => {
    it("should append events asynchronously via queueMicrotask", async () => {
      const appendEvents = vi.fn(() => Promise.resolve());
      const adapter = { appendEvents, getEvents: vi.fn(async () => []) };
      const persistBus = new EventBus({ runId: "run_persist", persistenceAdapter: adapter });

      persistBus.emit("run.started", { ok: true });
      expect(appendEvents.mock.calls.length).toBe(0);

      await nextMicrotask();

      expect(appendEvents.mock.calls.length).toBe(1);
      const [events] = appendEvents.mock.calls[0];
      expect(Array.isArray(events)).toBeTruthy();
      expect(events[0].runId).toBe("run_persist");
      expect(events[0].name).toBe("run.started");
      persistBus.dispose();
    });

    it("should swallow synchronous errors thrown by appendEvents", async () => {
      const appendEvents = vi.fn(() => {
        throw new Error("append failed");
      });
      const adapter = { appendEvents, getEvents: vi.fn(async () => []) };
      const persistBus = new EventBus({ persistenceAdapter: adapter });

      expect(() => persistBus.emit("run.progress", { pct: 1 })).not.toThrow();
      await nextMicrotask();
      expect(appendEvents.mock.calls.length).toBe(1);
      persistBus.dispose();
    });

    it("should catch rejected appendEvents promises", async () => {
      const appendEvents = vi.fn(() => Promise.reject(new Error("rejected")));
      const adapter = { appendEvents, getEvents: vi.fn(async () => []) };
      const persistBus = new EventBus({ persistenceAdapter: adapter });

      persistBus.emit("run.progress", { pct: 1 });
      await nextMicrotask();
      expect(appendEvents.mock.calls.length).toBe(1);
      persistBus.dispose();
    });

    it("replay() should require a persistenceAdapter", async () => {
      const noPersistBus = new EventBus();
      await expect(noPersistBus.replay("run_x")).rejects.toThrow(/persistenceAdapter.*required/i);
      noPersistBus.dispose();
    });

    it("replay() should dispatch events and mark meta.replay", async () => {
      const adapter = {
        appendEvents: vi.fn(),
        getEvents: vi.fn(async (runId) => [
          { runId, name: "run.started", payload: { ok: true }, meta: { fromStore: true } },
          { name: "run.progress", payload: { pct: 50 } },
        ]),
      };

      const replayBus = new EventBus({ persistenceAdapter: adapter });
      const seen = [];
      replayBus.on("run.*", (e) => seen.push(e));

      const replayed = await replayBus.replay("run_replay");

      expect(replayed.map((e) => e.name)).toEqual(["run.started", "run.progress"]);
      expect(seen.length).toBe(2);
      expect(seen[0].meta).toEqual({ fromStore: true, replay: true });
      expect(seen[1].runId).toBe("run_replay");
      expect(seen[1].meta).toEqual({ replay: true });
      expect(adapter.appendEvents.mock.calls.length).toBe(0);
      replayBus.dispose();
    });

    it("replay() should throw when getEvents() is not an array", async () => {
      const adapter = {
        appendEvents: vi.fn(),
        getEvents: vi.fn(async () => null),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      await expect(replayBus.replay("run_x")).rejects.toThrow(/no events found/i);
      replayBus.dispose();
    });

    it("replay() should validate runId", async () => {
      const adapter = {
        appendEvents: vi.fn(),
        getEvents: vi.fn(async () => []),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      await expect(replayBus.replay("")).rejects.toThrow(/runId must be a string/i);
      await expect(replayBus.replay(null)).rejects.toThrow(/runId must be a string/i);
      replayBus.dispose();
    });

    it("replay() should throw on getEvents failure", async () => {
      const adapter = {
        appendEvents: vi.fn(),
        getEvents: vi.fn(async () => {
          throw new Error("storage error");
        }),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      await expect(() => replayBus.replay("run_x")).rejects.toThrow(/failed to load events/i);
      replayBus.dispose();
    });
  });

  describe("backpressure", () => {
    it("should coalesce *.progress events and only dispatch the latest", async () => {
      const handler = vi.fn();
      bus.on("run.progress", handler);

      bus.enableBackpressure({ batchWindowMs: 20 });
      bus.emit("run.progress", { pct: 1 });
      bus.emit("run.progress", { pct: 2 });

      expect(handler.mock.calls.length).toBe(0);

      await delay(50);

      expect(handler.mock.calls.length).toBe(1);
      expect(handler.mock.calls[0][0].payload).toEqual({ pct: 2 });

      bus.disableBackpressure();
    });

    it("should defer non-coalesced events and dispatch on flush", async () => {
      const handler = vi.fn();
      bus.on("run.started", handler);

      bus.enableBackpressure({ batchWindowMs: 20 });
      bus.emit("run.started", { ok: true });

      expect(handler.mock.calls.length).toBe(0);

      await delay(50);

      expect(handler.mock.calls.length).toBe(1);

      bus.disableBackpressure();
    });

    it("should dispatch non-coalesced events immediately when deferNonCoalesced=false", () => {
      const handler = vi.fn();
      bus.on("run.started", handler);

      bus.enableBackpressure({ deferNonCoalesced: false });
      bus.emit("run.started", { ok: true });

      expect(handler.mock.calls.length).toBe(1);
      bus.disableBackpressure();
    });

    it("should drop oldest items when queue exceeds maxQueueSize", async () => {
      const bpBus = new EventBus();
      const handler = vi.fn();
      bpBus.on("evt", handler);

      bpBus.enableBackpressure({
        batchWindowMs: 20,
        maxQueueSize: 1,
        coalescePattern: /$^/, // never coalesce
      });

      bpBus.emit("evt", { n: 1 });
      bpBus.emit("evt", { n: 2 });

      await delay(50);

      expect(handler.mock.calls.length).toBe(1);
      expect(handler.mock.calls[0][0].payload).toEqual({ n: 2 });

      bpBus.dispose();
    });

    it("should validate enableBackpressure options", () => {
      expect(() => bus.enableBackpressure(null)).toThrow(/options must be an object/i);
      expect(() => bus.enableBackpressure({ batchWindowMs: -1 })).toThrow(/batchWindowMs must be a non-negative finite number/i);
      expect(() => bus.enableBackpressure({ coalescePattern: "not-regex" })).toThrow(/coalescePattern must be a RegExp/i);
      expect(() => bus.enableBackpressure({ maxQueueSize: 0 })).toThrow(/maxQueueSize must be a positive finite number/i);
    });

    it("should disable backpressure idempotently", () => {
      bus.enableBackpressure({});
      bus.disableBackpressure();
      expect(() => bus.disableBackpressure()).not.toThrow();
    });
  });

  describe("error handling", () => {
    it("should isolate handler errors and continue with other handlers", () => {
      const good = vi.fn();
      const bad = vi.fn(() => {
        throw new Error("boom");
      });

      bus.on("err.event", bad);
      bus.on("err.event", good);

      expect(() => bus.emitSync("err.event", {})).not.toThrow();
      expect(good.mock.calls.length).toBe(1);
    });

    it("should delegate sync/async errors to onListenerError", async () => {
      const onListenerError = vi.fn();
      const errBus = new EventBus({ onListenerError });

      const syncErr = new Error("sync");
      const asyncErr = new Error("async");
      const badSync = vi.fn(() => {
        throw syncErr;
      });
      const badAsync = vi.fn(() => Promise.reject(asyncErr));

      errBus.on("err", badSync);
      errBus.on("err", badAsync);

      errBus.emit("err", {});
      await nextMicrotask();

      expect(onListenerError.mock.calls.length).toBe(2);

      const call1 = onListenerError.mock.calls[0];
      expect(call1[0]).toBe(syncErr);
      expect(call1[1].name).toBe("err");
      expect(call1[2]).toBe(badSync);

      const call2 = onListenerError.mock.calls[1];
      expect(call2[0]).toBe(asyncErr);
      expect(call2[1].name).toBe("err");
      expect(call2[2]).toBe(badAsync);

      errBus.dispose();
    });

    it("should swallow errors thrown inside onListenerError", () => {
      const errBus = new EventBus({
        onListenerError: () => {
          throw new Error("onListenerError failed");
        },
      });

      errBus.on("err", () => {
        throw new Error("handler failed");
      });

      expect(() => errBus.emitSync("err", {})).not.toThrow();
      errBus.dispose();
    });
  });

  describe("subscribe AbortSignal", () => {
    it("should auto-unsubscribe when signal aborts", async () => {
      const controller = new AbortController();
      const handler = vi.fn();

      bus.subscribe("abort.test", handler, { signal: controller.signal });

      bus.emit("abort.test", { n: 1 });
      expect(handler.mock.calls.length).toBe(1);

      controller.abort();
      bus.emit("abort.test", { n: 2 });
      expect(handler.mock.calls.length).toBe(1);
    });

    it("should be a noop if signal is already aborted", () => {
      const controller = new AbortController();
      controller.abort();

      const handler = vi.fn();
      const unsub = bus.subscribe("already.aborted", handler, { signal: controller.signal });

      expect(typeof unsub).toBe("function");
      bus.emit("already.aborted", {});
      expect(handler.mock.calls.length).toBe(0);
    });
  });

  describe("misc", () => {
    it("on() should validate handler type", () => {
      expect(() => bus.on("bad.handler", null)).toThrow(/handler must be a function/i);
    });

    it("clear() should remove listeners and reset history", () => {
      const handler = vi.fn();
      bus.on("clear.event", handler);
      bus.emit("clear.event", {});
      expect(bus.getHistory().length).toBe(1);

      bus.clear();
      expect(bus.getHistory()).toEqual([]);
      bus.emitSync("clear.event", {});
      expect(handler.mock.calls.length).toBe(1);
      expect(bus.getHistory().map((e) => e.name)).toEqual(["clear.event"]);
    });

    it("getClock() should return a snapshot object", () => {
      const clock = bus.getClock();
      expect(typeof clock.seq).toBe("number");
      expect(clock.id.startsWith("eventbus_")).toBeTruthy();
      expect(typeof clock.ts).toBe("number");
    });

    it("off() should return false for non-existent handler", () => {
      const handler = vi.fn();
      expect(bus.off("nonexistent", handler)).toBe(false);
    });

    it("should support ? wildcard when combined with *", () => {
      // Note: ? alone doesn't trigger wildcard storage, must combine with *
      const handler = vi.fn();
      bus.on("user.*?", handler);

      bus.emit("user.ab", {});
      bus.emit("user.a", {});

      expect(handler.mock.calls.length).toBe(2);
    });
  });
});

describe("matchPattern / isValidEventName", () => {
  it("isValidEventName should validate event names and global wildcard", () => {
    expect(isValidEventName("*")).toBe(true);
    expect(isValidEventName("user.login")).toBe(true);
    expect(isValidEventName("user_login")).toBe(true);
    expect(isValidEventName("Bad Name")).toBe(false);
    expect(isValidEventName("a..b")).toBe(false);
  });

  it("matchPattern should support fast path prefix.* and exact match", () => {
    expect(matchPattern("user.*", "user")).toBe(true);
    expect(matchPattern("user.*", "user.login")).toBe(true);
    expect(matchPattern("user.login", "user.login")).toBe(true);
    expect(matchPattern("user.login", "user.logout")).toBe(false);
  });

  it("matchPattern should support general * and ? wildcards (no ReDoS regex)", () => {
    expect(matchPattern("run.*.progress", "run.step.progress")).toBe(true);
    expect(matchPattern("a*?d", "abcd")).toBe(true);
    expect(matchPattern("a*?d", "abdd")).toBe(true);
    expect(matchPattern("a*?d", "ad")).toBe(false);
  });

  it("matchPattern should return false for non-string inputs", () => {
    expect(matchPattern(null, "x")).toBe(false);
    expect(matchPattern("x", null)).toBe(false);
  });

  it("matchPattern should handle edge cases", () => {
    expect(matchPattern("*", "anything.here")).toBe(true);
    expect(matchPattern("", "")).toBe(true);
    expect(matchPattern("a", "a")).toBe(true);
    expect(matchPattern("a", "b")).toBe(false);
    expect(matchPattern("***", "abc")).toBe(true);
  });
});

describe("createEventRecord", () => {
  beforeEach(() => {
    resetClock();
  });

  it("should support legacy aliases (id/type/timestamp/clock)", () => {
    const record = createEventRecord({
      id: "evt_legacy_1",
      type: "legacy.event",
      timestamp: 1_700_000_000_000,
      clock: { seq: 7, ts: 0, id: "node" },
    });

    expect(record.eventId).toBe("evt_legacy_1");
    expect(record.name).toBe("legacy.event");
    expect(record.timestamp).toBe(1_700_000_000_000);
    expect(record.seq).toBe(7);
    expect(record._clock.seq).toBe(7);
    expect(record.actor).toBe("system");
  });

  it("should derive timestamp from ts when timestamp is missing", () => {
    const ts = "2020-01-01T00:00:00.000Z";
    const record = createEventRecord({ name: "ts.test", ts });
    expect(record.ts).toBe(ts);
    expect(record.timestamp).toBe(Date.parse(ts));
  });

  it("should fall back to Date.now() when ts is invalid and timestamp missing", () => {
    const now = Date.now();
    const record = createEventRecord({ name: "bad.ts", ts: "not-a-date" });
    expect(record.timestamp >= now - 1000).toBeTruthy();
    expect(record.timestamp <= now + 1000).toBeTruthy();
  });

  it("should generate default values for minimal input", () => {
    const record = createEventRecord({ name: "minimal" });
    expect(record.name).toBe("minimal");
    expect(record.type).toBe("minimal");
    expect(record.schemaVersion).toBe("0.1");
    expect(record.actor).toBe("system");
    expect(typeof record.seq).toBe("number");
    expect(record.eventId.startsWith("evt_")).toBeTruthy();
  });

  it("should default name to 'unknown' when missing", () => {
    const record = createEventRecord({});
    expect(record.name).toBe("unknown");
  });

  it("should include optional fields when provided", () => {
    const record = createEventRecord({
      name: "full",
      level: "warn",
      status: "pending",
      durationMs: 123,
      payload: { data: 1 },
      meta: { key: "val" },
    });

    expect(record.level).toBe("warn");
    expect(record.status).toBe("pending");
    expect(record.durationMs).toBe(123);
    expect(record.payload).toEqual({ data: 1 });
    expect(record.meta).toEqual({ key: "val" });
  });
});

describe("RunStoreAdapter", () => {
  it("should validate constructor args", () => {
    expect(() => new RunStoreAdapter(null)).toThrow(/getEvents must be a function/i);
    expect(() => new RunStoreAdapter({ appendEvents() {} })).toThrow(
      /getEvents must be a function/i
    );
    expect(() => new RunStoreAdapter({ getEvents() {} })).toThrow(
      /appendEvents\/appendEvent must be a function/i
    );
  });

  it("appendEvents should validate input", async () => {
    const adapter = new RunStoreAdapter({
      getEvents: vi.fn(async () => []),
      appendEvents: vi.fn(async () => {}),
    });

    await expect(adapter.appendEvents(null)).rejects.toThrow(/events must be an array/i);
    const result = await adapter.appendEvents([]);
    expect(result).toBe(0);
  });

  it("should batch by runId when runStore.appendEvents exists", async () => {
    const runStore = {
      getEvents: vi.fn(async () => []),
      appendEvents: vi.fn(async () => {}),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: "r1", name: "a" },
      { runId: "r1", name: "b" },
      { runId: "r2", name: "c" },
    ];

    const result = await adapter.appendEvents(events);
    expect(result).toBe(events.length);
    expect(runStore.appendEvents.mock.calls.length).toBe(2);
  });

  it("should fall back to per-event append when appendEvent-only", async () => {
    const runStore = {
      getEvents: vi.fn(async () => []),
      appendEvent: vi.fn(async () => {}),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: "r1", name: "a" },
      { runId: "r2", name: "b" },
    ];

    const result = await adapter.appendEvents(events);
    expect(result).toBe(events.length);
    expect(runStore.appendEvent.mock.calls.length).toBe(2);
  });

  it("getEvents should delegate to runStore", async () => {
    const runStore = {
      getEvents: vi.fn(async (runId) => [{ runId, name: "evt" }]),
      appendEvents: vi.fn(),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = await adapter.getEvents("run_1");
    expect(events).toEqual([{ runId: "run_1", name: "evt" }]);
    expect(runStore.getEvents.mock.calls.length).toBe(1);
  });
});

describe("LamportClock class", () => {
  it("should start at 0", () => {
    const clock = new LamportClock("node1");
    const state = clock.get();
    expect(state.seq).toBe(0);
  });

  it("should increment on tick", () => {
    const clock = new LamportClock("node1");
    clock.tick();
    clock.tick();
    expect(clock.get().seq).toBe(2);
  });

  it("should update from remote clock", () => {
    const clock1 = new LamportClock("node1");
    const clock2 = new LamportClock("node2");

    clock1.tick();
    clock1.tick();
    clock1.tick(); // seq = 3

    clock2.tick(); // seq = 1

    clock2.update(clock1.get()); // should jump to 4

    expect(clock2.get().seq).toBe(4);
  });

  it("should include node id", () => {
    const clock = new LamportClock("my-node");
    const state = clock.tick();
    expect(state.id.includes("my-node")).toBeTruthy();
  });

  it("should generate random nodeId when not provided", () => {
    const clock = new LamportClock();
    const state = clock.tick();
    expect(state.id.match(/^[0-9a-f]+_1$/i)).toBeTruthy();
  });
});
