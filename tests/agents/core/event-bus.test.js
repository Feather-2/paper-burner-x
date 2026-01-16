/**
 * EventBus 测试 - 使用 node:test
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

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
      const handler = mock.fn();
      bus.on("test.event", handler);

      bus.emit("test.event", { value: 42 });

      assert.equal(handler.mock.callCount(), 1);
      const evt = handler.mock.calls[0].arguments[0];
      assert.equal(evt.type, "test.event");
      assert.equal(evt.schemaVersion, "0.1");
      assert.deepEqual(evt.payload, { value: 42 });
    });

    it("should support wildcard patterns", () => {
      const handler = mock.fn();
      bus.on("user.*", handler);

      bus.emit("user.login", { id: 1 });
      bus.emit("user.logout", { id: 1 });
      bus.emit("system.error", {}); // should not match

      assert.equal(handler.mock.callCount(), 2);
    });

    it("should support global wildcard *", () => {
      const handler = mock.fn();
      bus.on("*", handler);

      bus.emit("any.event", {});
      bus.emit("another", {});

      assert.equal(handler.mock.callCount(), 2);
    });

    it("should unsubscribe correctly", () => {
      const handler = mock.fn();
      const unsub = bus.on("test", handler);

      bus.emit("test", {});
      assert.equal(handler.mock.callCount(), 1);

      unsub();
      bus.emit("test", {});
      assert.equal(handler.mock.callCount(), 1); // still 1
    });

    it("should accept EventRecord-like payload/meta input", () => {
      const handler = mock.fn();
      bus.on("record.like", handler);

      const evt = bus.emit("record.like", {
        actor: "alice",
        status: "ok",
        level: "info",
        payload: { value: 1 },
        meta: { source: "test" },
      });

      assert.equal(handler.mock.callCount(), 1);
      assert.equal(evt.actor, "alice");
      assert.equal(evt.status, "ok");
      assert.equal(evt.level, "info");
      assert.deepEqual(evt.payload, { value: 1 });
      assert.deepEqual(evt.meta, { source: "test" });
    });

    it("should throw for invalid event names", () => {
      assert.throws(() => bus.on("Bad Name", () => {}), /Invalid event/);
      assert.throws(() => bus.on("a..b", () => {}), /Invalid event/);
    });

    it("should throw for invalid handler", () => {
      assert.throws(() => bus.on("test", null), /handler must be a function/i);
      assert.throws(() => bus.on("test", "not-a-fn"), /handler must be a function/i);
    });
  });

  describe("emitSync", () => {
    it("should emit synchronously", () => {
      const handler = mock.fn();
      bus.on("sync.event", handler);

      bus.emitSync("sync.event", { sync: true });

      assert.equal(handler.mock.callCount(), 1);
    });

    it("should record history", () => {
      bus.emitSync("sync.hist", { n: 1 });
      const hist = bus.getHistory();
      assert.equal(hist.length, 1);
      assert.equal(hist[0].name, "sync.hist");
    });
  });

  describe("once", () => {
    it("should only fire once", () => {
      const handler = mock.fn();
      bus.once("one.time", handler);

      bus.emit("one.time", {});
      bus.emit("one.time", {});

      assert.equal(handler.mock.callCount(), 1);
    });

    it("off() should accept original handler for once() wrapper", () => {
      const handler = mock.fn();
      bus.once("wrapped.once", handler);

      assert.equal(bus.off("wrapped.once", handler), true);
      bus.emit("wrapped.once", {});
      assert.equal(handler.mock.callCount(), 0);
    });
  });

  describe("priority", () => {
    it("should call high priority handlers first", () => {
      const order = [];

      bus.on("priority.test", () => order.push("normal"));
      bus.on("priority.test", () => order.push("high"), { priority: 10 });
      bus.on("priority.test", () => order.push("low"), { priority: -10 });

      bus.emit("priority.test", {});

      assert.deepEqual(order, ["high", "normal", "low"]);
    });

    it("should support wildcard priority subscriptions", () => {
      const handler = mock.fn();
      bus.subscribe("user.*", handler, { priority: 5 });

      bus.emit("user.login", { id: 1 });
      bus.emit("system.error", {}); // should not match

      assert.equal(handler.mock.callCount(), 1);
      assert.equal(handler.mock.calls[0].arguments[0].name, "user.login");
    });

    it("should validate priority is finite number", () => {
      assert.throws(
        () => bus.subscribe("test", () => {}, { priority: NaN }),
        /priority must be a finite number/i
      );
      assert.throws(
        () => bus.subscribe("test", () => {}, { priority: Infinity }),
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
      assert.equal(event.type, "delayed.event");
      assert.deepEqual(event.payload, { delayed: true });
    });

    it("should timeout if event not received", async () => {
      await assert.rejects(
        () => bus.waitFor("never.happens", { timeout: 50 }),
        /timeout/i
      );
      assert.equal(bus._waiters.size, 0);
    });

    it("should support abort signal", async () => {
      const controller = new AbortController();

      const promise = bus.waitFor("aborted.event", { signal: controller.signal });

      setTimeout(() => controller.abort(), 10);

      await assert.rejects(promise, /abort/i);
      assert.equal(bus._waiters.size, 0);
    });

    it("should resolve if event occurs before abort", async () => {
      const controller = new AbortController();
      const promise = bus.waitFor("race.event", { signal: controller.signal });

      bus.emitSync("race.event", { ok: true });
      controller.abort(new Error("abort after emit"));

      const evt = await promise;
      assert.equal(evt.type, "race.event");
      assert.deepEqual(evt.payload, { ok: true });
    });

    it("should accept numeric timeout argument", async () => {
      const promise = bus.waitFor("numeric.timeout", 1000);
      bus.emitSync("numeric.timeout", { ok: true });

      const evt = await promise;
      assert.equal(evt.type, "numeric.timeout");
      assert.deepEqual(evt.payload, { ok: true });
    });

    it("should reject immediately if signal already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("already aborted"));

      await assert.rejects(
        () => bus.waitFor("never", { signal: controller.signal }),
        /already aborted/i
      );
    });

    it("should support wildcard pattern in waitFor", async () => {
      const promise = bus.waitFor("user.*");

      setTimeout(() => bus.emitSync("user.login", { id: 1 }), 10);

      const evt = await promise;
      assert.equal(evt.type, "user.login");
    });
  });

  describe("history", () => {
    it("should keep event history when enabled", () => {
      bus.emit("event.1", { n: 1 });
      bus.emit("event.2", { n: 2 });

      const history = bus.getHistory();
      assert.equal(history.length, 2);
      assert.equal(history[0].type, "event.1");
      assert.equal(history[1].type, "event.2");
    });

    it("should respect maxHistory", () => {
      const smallBus = new EventBus({ keepHistory: true, maxHistory: 3 });

      for (let i = 0; i < 5; i++) {
        smallBus.emit("event", { i });
      }

      const history = smallBus.getHistory();
      assert.equal(history.length, 3);
      assert.equal(history[0].payload.i, 2); // oldest kept

      smallBus.dispose();
    });

    it("should filter history by wildcard pattern", () => {
      bus.emit("user.login", { id: 1 });
      bus.emit("user.logout", { id: 1 });
      bus.emit("system.ready", {});

      const userEvents = bus.getHistory("user.*");
      assert.deepEqual(userEvents.map((e) => e.name), ["user.login", "user.logout"]);
    });

    it("should clear history", () => {
      bus.emit("event.1", { n: 1 });
      assert.equal(bus.getHistory().length, 1);
      bus.clearHistory();
      assert.deepEqual(bus.getHistory(), []);
    });

    it("should return empty array when history disabled", () => {
      const noHistBus = new EventBus({ keepHistory: false });
      noHistBus.emit("evt", {});
      assert.deepEqual(noHistBus.getHistory(), []);
      noHistBus.dispose();
    });
  });

  describe("Lamport clock", () => {
    it("should increment clock on each event", () => {
      const clock1 = bus.getClock();
      bus.emit("tick", {});
      const clock2 = bus.getClock();

      assert.ok(clock2.seq > clock1.seq);
    });

    it("events should have monotonically increasing seq", () => {
      const e1 = bus.emit("a", {});
      const e2 = bus.emit("b", {});
      const e3 = bus.emit("c", {});

      assert.ok(e1.seq < e2.seq);
      assert.ok(e2.seq < e3.seq);
    });
  });

  describe("persistenceAdapter", () => {
    it("should append events asynchronously via queueMicrotask", async () => {
      const appendEvents = mock.fn(() => Promise.resolve());
      const adapter = { appendEvents, getEvents: mock.fn(async () => []) };
      const persistBus = new EventBus({ runId: "run_persist", persistenceAdapter: adapter });

      persistBus.emit("run.started", { ok: true });
      assert.equal(appendEvents.mock.callCount(), 0);

      await nextMicrotask();

      assert.equal(appendEvents.mock.callCount(), 1);
      const [events] = appendEvents.mock.calls[0].arguments;
      assert.ok(Array.isArray(events));
      assert.equal(events[0].runId, "run_persist");
      assert.equal(events[0].name, "run.started");
      persistBus.dispose();
    });

    it("should swallow synchronous errors thrown by appendEvents", async () => {
      const appendEvents = mock.fn(() => {
        throw new Error("append failed");
      });
      const adapter = { appendEvents, getEvents: mock.fn(async () => []) };
      const persistBus = new EventBus({ persistenceAdapter: adapter });

      assert.doesNotThrow(() => persistBus.emit("run.progress", { pct: 1 }));
      await nextMicrotask();
      assert.equal(appendEvents.mock.callCount(), 1);
      persistBus.dispose();
    });

    it("should catch rejected appendEvents promises", async () => {
      const appendEvents = mock.fn(() => Promise.reject(new Error("rejected")));
      const adapter = { appendEvents, getEvents: mock.fn(async () => []) };
      const persistBus = new EventBus({ persistenceAdapter: adapter });

      persistBus.emit("run.progress", { pct: 1 });
      await nextMicrotask();
      assert.equal(appendEvents.mock.callCount(), 1);
      persistBus.dispose();
    });

    it("replay() should require a persistenceAdapter", async () => {
      const noPersistBus = new EventBus();
      await assert.rejects(
        () => noPersistBus.replay("run_x"),
        /persistenceAdapter.*required/i
      );
      noPersistBus.dispose();
    });

    it("replay() should dispatch events and mark meta.replay", async () => {
      const adapter = {
        appendEvents: mock.fn(),
        getEvents: mock.fn(async (runId) => [
          { runId, name: "run.started", payload: { ok: true }, meta: { fromStore: true } },
          { name: "run.progress", payload: { pct: 50 } },
        ]),
      };

      const replayBus = new EventBus({ persistenceAdapter: adapter });
      const seen = [];
      replayBus.on("run.*", (e) => seen.push(e));

      const replayed = await replayBus.replay("run_replay");

      assert.deepEqual(replayed.map((e) => e.name), ["run.started", "run.progress"]);
      assert.equal(seen.length, 2);
      assert.deepEqual(seen[0].meta, { fromStore: true, replay: true });
      assert.equal(seen[1].runId, "run_replay");
      assert.deepEqual(seen[1].meta, { replay: true });
      assert.equal(adapter.appendEvents.mock.callCount(), 0);
      replayBus.dispose();
    });

    it("replay() should return empty array when getEvents() is not an array", async () => {
      const adapter = {
        appendEvents: mock.fn(),
        getEvents: mock.fn(async () => null),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      const result = await replayBus.replay("run_x");
      assert.deepEqual(result, []);
      replayBus.dispose();
    });

    it("replay() should validate runId", async () => {
      const adapter = {
        appendEvents: mock.fn(),
        getEvents: mock.fn(async () => []),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      await assert.rejects(
        () => replayBus.replay(""),
        /runId must be a string/i
      );
      await assert.rejects(
        () => replayBus.replay(null),
        /runId must be a string/i
      );
      replayBus.dispose();
    });

    it("replay() should throw on getEvents failure", async () => {
      const adapter = {
        appendEvents: mock.fn(),
        getEvents: mock.fn(async () => {
          throw new Error("storage error");
        }),
      };
      const replayBus = new EventBus({ persistenceAdapter: adapter });

      await assert.rejects(() => replayBus.replay("run_x"), /failed to load events/i);
      replayBus.dispose();
    });
  });

  describe("backpressure", () => {
    it("should coalesce *.progress events and only dispatch the latest", async () => {
      const handler = mock.fn();
      bus.on("run.progress", handler);

      bus.enableBackpressure({ batchWindowMs: 20 });
      bus.emit("run.progress", { pct: 1 });
      bus.emit("run.progress", { pct: 2 });

      assert.equal(handler.mock.callCount(), 0);

      await delay(50);

      assert.equal(handler.mock.callCount(), 1);
      assert.deepEqual(handler.mock.calls[0].arguments[0].payload, { pct: 2 });

      bus.disableBackpressure();
    });

    it("should defer non-coalesced events and dispatch on flush", async () => {
      const handler = mock.fn();
      bus.on("run.started", handler);

      bus.enableBackpressure({ batchWindowMs: 20 });
      bus.emit("run.started", { ok: true });

      assert.equal(handler.mock.callCount(), 0);

      await delay(50);

      assert.equal(handler.mock.callCount(), 1);

      bus.disableBackpressure();
    });

    it("should dispatch non-coalesced events immediately when deferNonCoalesced=false", () => {
      const handler = mock.fn();
      bus.on("run.started", handler);

      bus.enableBackpressure({ deferNonCoalesced: false });
      bus.emit("run.started", { ok: true });

      assert.equal(handler.mock.callCount(), 1);
      bus.disableBackpressure();
    });

    it("should drop oldest items when queue exceeds maxQueueSize", async () => {
      const bpBus = new EventBus();
      const handler = mock.fn();
      bpBus.on("evt", handler);

      bpBus.enableBackpressure({
        batchWindowMs: 20,
        maxQueueSize: 1,
        coalescePattern: /$^/, // never coalesce
      });

      bpBus.emit("evt", { n: 1 });
      bpBus.emit("evt", { n: 2 });

      await delay(50);

      assert.equal(handler.mock.callCount(), 1);
      assert.deepEqual(handler.mock.calls[0].arguments[0].payload, { n: 2 });

      bpBus.dispose();
    });

    it("should validate enableBackpressure options", () => {
      assert.throws(
        () => bus.enableBackpressure(null),
        /options must be an object/i
      );
      assert.throws(
        () => bus.enableBackpressure({ batchWindowMs: -1 }),
        /batchWindowMs must be a non-negative finite number/i
      );
      assert.throws(
        () => bus.enableBackpressure({ coalescePattern: "not-regex" }),
        /coalescePattern must be a RegExp/i
      );
      assert.throws(
        () => bus.enableBackpressure({ maxQueueSize: 0 }),
        /maxQueueSize must be a positive finite number/i
      );
    });

    it("should disable backpressure idempotently", () => {
      bus.enableBackpressure({});
      bus.disableBackpressure();
      assert.doesNotThrow(() => bus.disableBackpressure());
    });
  });

  describe("error handling", () => {
    it("should isolate handler errors and continue with other handlers", () => {
      const good = mock.fn();
      const bad = mock.fn(() => {
        throw new Error("boom");
      });

      bus.on("err.event", bad);
      bus.on("err.event", good);

      assert.doesNotThrow(() => bus.emitSync("err.event", {}));
      assert.equal(good.mock.callCount(), 1);
    });

    it("should delegate sync/async errors to onListenerError", async () => {
      const onListenerError = mock.fn();
      const errBus = new EventBus({ onListenerError });

      const syncErr = new Error("sync");
      const asyncErr = new Error("async");
      const badSync = mock.fn(() => {
        throw syncErr;
      });
      const badAsync = mock.fn(() => Promise.reject(asyncErr));

      errBus.on("err", badSync);
      errBus.on("err", badAsync);

      errBus.emit("err", {});
      await nextMicrotask();

      assert.equal(onListenerError.mock.callCount(), 2);

      const call1 = onListenerError.mock.calls[0].arguments;
      assert.equal(call1[0], syncErr);
      assert.equal(call1[1].name, "err");
      assert.equal(call1[2], badSync);

      const call2 = onListenerError.mock.calls[1].arguments;
      assert.equal(call2[0], asyncErr);
      assert.equal(call2[1].name, "err");
      assert.equal(call2[2], badAsync);

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

      assert.doesNotThrow(() => errBus.emitSync("err", {}));
      errBus.dispose();
    });
  });

  describe("subscribe AbortSignal", () => {
    it("should auto-unsubscribe when signal aborts", async () => {
      const controller = new AbortController();
      const handler = mock.fn();

      bus.subscribe("abort.test", handler, { signal: controller.signal });

      bus.emit("abort.test", { n: 1 });
      assert.equal(handler.mock.callCount(), 1);

      controller.abort();
      bus.emit("abort.test", { n: 2 });
      assert.equal(handler.mock.callCount(), 1);
    });

    it("should be a noop if signal is already aborted", () => {
      const controller = new AbortController();
      controller.abort();

      const handler = mock.fn();
      const unsub = bus.subscribe("already.aborted", handler, { signal: controller.signal });

      assert.equal(typeof unsub, "function");
      bus.emit("already.aborted", {});
      assert.equal(handler.mock.callCount(), 0);
    });
  });

  describe("misc", () => {
    it("on() should validate handler type", () => {
      assert.throws(() => bus.on("bad.handler", null), /handler must be a function/i);
    });

    it("clear() should remove listeners and reset history", () => {
      const handler = mock.fn();
      bus.on("clear.event", handler);
      bus.emit("clear.event", {});
      assert.equal(bus.getHistory().length, 1);

      bus.clear();
      assert.deepEqual(bus.getHistory(), []);
      bus.emitSync("clear.event", {});
      assert.equal(handler.mock.callCount(), 1);
      assert.deepEqual(bus.getHistory().map((e) => e.name), ["clear.event"]);
    });

    it("getClock() should return a snapshot object", () => {
      const clock = bus.getClock();
      assert.equal(typeof clock.seq, "number");
      assert.ok(clock.id.startsWith("eventbus_"));
      assert.equal(typeof clock.ts, "number");
    });

    it("off() should return false for non-existent handler", () => {
      const handler = mock.fn();
      assert.equal(bus.off("nonexistent", handler), false);
    });

    it("should support ? wildcard when combined with *", () => {
      // Note: ? alone doesn't trigger wildcard storage, must combine with *
      const handler = mock.fn();
      bus.on("user.*?", handler);

      bus.emit("user.ab", {});
      bus.emit("user.a", {});

      assert.equal(handler.mock.callCount(), 2);
    });
  });
});

describe("matchPattern / isValidEventName", () => {
  it("isValidEventName should validate event names and global wildcard", () => {
    assert.equal(isValidEventName("*"), true);
    assert.equal(isValidEventName("user.login"), true);
    assert.equal(isValidEventName("user_login"), true);
    assert.equal(isValidEventName("Bad Name"), false);
    assert.equal(isValidEventName("a..b"), false);
  });

  it("matchPattern should support fast path prefix.* and exact match", () => {
    assert.equal(matchPattern("user.*", "user"), true);
    assert.equal(matchPattern("user.*", "user.login"), true);
    assert.equal(matchPattern("user.login", "user.login"), true);
    assert.equal(matchPattern("user.login", "user.logout"), false);
  });

  it("matchPattern should support general * and ? wildcards (no ReDoS regex)", () => {
    assert.equal(matchPattern("run.*.progress", "run.step.progress"), true);
    assert.equal(matchPattern("a*?d", "abcd"), true);
    assert.equal(matchPattern("a*?d", "abdd"), true);
    assert.equal(matchPattern("a*?d", "ad"), false);
  });

  it("matchPattern should return false for non-string inputs", () => {
    assert.equal(matchPattern(null, "x"), false);
    assert.equal(matchPattern("x", null), false);
  });

  it("matchPattern should handle edge cases", () => {
    assert.equal(matchPattern("*", "anything.here"), true);
    assert.equal(matchPattern("", ""), true);
    assert.equal(matchPattern("a", "a"), true);
    assert.equal(matchPattern("a", "b"), false);
    assert.equal(matchPattern("***", "abc"), true);
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

    assert.equal(record.eventId, "evt_legacy_1");
    assert.equal(record.name, "legacy.event");
    assert.equal(record.timestamp, 1_700_000_000_000);
    assert.equal(record.seq, 7);
    assert.equal(record._clock.seq, 7);
    assert.equal(record.actor, "system");
  });

  it("should derive timestamp from ts when timestamp is missing", () => {
    const ts = "2020-01-01T00:00:00.000Z";
    const record = createEventRecord({ name: "ts.test", ts });
    assert.equal(record.ts, ts);
    assert.equal(record.timestamp, Date.parse(ts));
  });

  it("should fall back to Date.now() when ts is invalid and timestamp missing", () => {
    const now = Date.now();
    const record = createEventRecord({ name: "bad.ts", ts: "not-a-date" });
    assert.ok(record.timestamp >= now - 1000);
    assert.ok(record.timestamp <= now + 1000);
  });

  it("should generate default values for minimal input", () => {
    const record = createEventRecord({ name: "minimal" });
    assert.equal(record.name, "minimal");
    assert.equal(record.type, "minimal");
    assert.equal(record.schemaVersion, "0.1");
    assert.equal(record.actor, "system");
    assert.equal(typeof record.seq, "number");
    assert.ok(record.eventId.startsWith("evt_"));
  });

  it("should default name to 'unknown' when missing", () => {
    const record = createEventRecord({});
    assert.equal(record.name, "unknown");
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

    assert.equal(record.level, "warn");
    assert.equal(record.status, "pending");
    assert.equal(record.durationMs, 123);
    assert.deepEqual(record.payload, { data: 1 });
    assert.deepEqual(record.meta, { key: "val" });
  });
});

describe("RunStoreAdapter", () => {
  it("should validate constructor args", () => {
    assert.throws(() => new RunStoreAdapter(null), /getEvents must be a function/i);
    assert.throws(
      () => new RunStoreAdapter({ appendEvents() {} }),
      /getEvents must be a function/i
    );
    assert.throws(
      () => new RunStoreAdapter({ getEvents() {} }),
      /appendEvents\/appendEvent must be a function/i
    );
  });

  it("appendEvents should validate input", async () => {
    const adapter = new RunStoreAdapter({
      getEvents: mock.fn(async () => []),
      appendEvents: mock.fn(async () => {}),
    });

    await assert.rejects(() => adapter.appendEvents(null), /events must be an array/i);
    const result = await adapter.appendEvents([]);
    assert.equal(result, 0);
  });

  it("should batch by runId when runStore.appendEvents exists", async () => {
    const runStore = {
      getEvents: mock.fn(async () => []),
      appendEvents: mock.fn(async () => {}),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: "r1", name: "a" },
      { runId: "r1", name: "b" },
      { runId: "r2", name: "c" },
      { runId: null, name: "ignored" },
      "not-an-object",
    ];

    const result = await adapter.appendEvents(events);
    assert.equal(result, events.length);
    assert.equal(runStore.appendEvents.mock.callCount(), 2);
  });

  it("should fall back to per-event append when appendEvent-only", async () => {
    const runStore = {
      getEvents: mock.fn(async () => []),
      appendEvent: mock.fn(async () => {}),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = [
      { runId: "r1", name: "a" },
      { runId: "r2", name: "b" },
      { runId: null, name: "ignored" },
    ];

    const result = await adapter.appendEvents(events);
    assert.equal(result, events.length);
    assert.equal(runStore.appendEvent.mock.callCount(), 2);
  });

  it("getEvents should delegate to runStore", async () => {
    const runStore = {
      getEvents: mock.fn(async (runId) => [{ runId, name: "evt" }]),
      appendEvents: mock.fn(),
    };
    const adapter = new RunStoreAdapter(runStore);

    const events = await adapter.getEvents("run_1");
    assert.deepEqual(events, [{ runId: "run_1", name: "evt" }]);
    assert.equal(runStore.getEvents.mock.callCount(), 1);
  });
});

describe("LamportClock class", () => {
  it("should start at 0", () => {
    const clock = new LamportClock("node1");
    const state = clock.get();
    assert.equal(state.seq, 0);
  });

  it("should increment on tick", () => {
    const clock = new LamportClock("node1");
    clock.tick();
    clock.tick();
    assert.equal(clock.get().seq, 2);
  });

  it("should update from remote clock", () => {
    const clock1 = new LamportClock("node1");
    const clock2 = new LamportClock("node2");

    clock1.tick();
    clock1.tick();
    clock1.tick(); // seq = 3

    clock2.tick(); // seq = 1

    clock2.update(clock1.get()); // should jump to 4

    assert.equal(clock2.get().seq, 4);
  });

  it("should include node id", () => {
    const clock = new LamportClock("my-node");
    const state = clock.tick();
    assert.ok(state.id.includes("my-node"));
  });

  it("should generate random nodeId when not provided", () => {
    const clock = new LamportClock();
    const state = clock.tick();
    assert.ok(state.id.match(/^[0-9a-f]+_1$/i));
  });
});
