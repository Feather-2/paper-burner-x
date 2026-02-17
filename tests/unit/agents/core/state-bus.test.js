import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => mockedLogger),
}));

import { StateBus } from "../../../../js/agents/core/state-bus.js";

describe("StateBus", () => {
  /** @type {StateBus} */
  let state;
  let events;

  beforeEach(() => {
    vi.clearAllMocks();
    events = { emitSync: vi.fn() };
    state = new StateBus({ events, keepLog: true, maxSnapshots: 3, maxLog: 5 });
  });

  describe("get", () => {
    it("returns root state for empty path", () => {
      const root = state.get();
      expect(root.meta).toBeDefined();
      expect(root.runtime).toBeDefined();
      expect(state.get("")).toBe(root);
    });

    it("returns undefined for missing or unsafe paths", () => {
      expect(state.get("missing.path")).toBeUndefined();

      const value = state.get("safe.__proto__.polluted");
      expect(value).toBeUndefined();
      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        "StateBus blocked unsafe path segment",
        expect.objectContaining({ path: "safe.__proto__.polluted", segment: "__proto__" })
      );
    });

    it("returns undefined when traversing non-object values", () => {
      state.set("primitive", 42);
      expect(state.get("primitive.child")).toBeUndefined();
    });

    it("reads nested values from deep paths", () => {
      state.set("deep.nested.value", 42);
      expect(state.get("deep.nested.value")).toBe(42);
      expect(state.get("deep.nested")).toEqual({ value: 42 });
    });
  });

  describe("set", () => {
    it("stores boundary values without coercion", () => {
      const cases = [
        ["values.zero", 0],
        ["values.negative", -1],
        ["values.max", Number.MAX_SAFE_INTEGER],
        ["values.emptyString", ""],
        ["values.whitespace", "   "],
        ["values.null", null],
        ["values.emptyArray", []],
        ["values.emptyObject", {}],
        ["values.numericString", "123"],
      ];

      for (const [path, value] of cases) {
        state.set(path, value);
        expect(state.get(path)).toEqual(value);
      }

      state.set("values.numericString", 123);
      expect(state.get("values.numericString")).toBe(123);
    });

    it("allows setting undefined when value changes", () => {
      state.set("maybe.value", "temp");
      state.set("maybe.value", undefined);

      const parent = state.get("maybe");
      expect(Object.prototype.hasOwnProperty.call(parent, "value")).toBe(true);
      expect(state.get("maybe.value")).toBeUndefined();
    });

    it("does not update timestamp or notify when value unchanged", () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
      const subscriber = vi.fn();

      state.subscribe("same", subscriber);

      state.set("same", 1);
      const updatedAt = state.get("meta.updatedAt");

      expect(nowSpy).toHaveBeenCalledTimes(2);

      state.set("same", 1);

      expect(nowSpy).toHaveBeenCalledTimes(2);
      expect(state.get("meta.updatedAt")).toBe(updatedAt);
      expect(subscriber).toHaveBeenCalledTimes(1);
      expect(events.emitSync).toHaveBeenCalledTimes(2);

      nowSpy.mockRestore();
    });

    it("ignores empty or unsafe paths", () => {
      state.set("", 123);
      expect(state.get("meta.updatedAt")).toBeNull();
      expect(events.emitSync).not.toHaveBeenCalled();

      state.set("unsafe.__proto__.polluted", "yes");
      expect(state.get("unsafe")).toBeUndefined();
      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect({}.polluted).toBeUndefined();
      expect(events.emitSync).not.toHaveBeenCalled();
    });

    it("emits change events with meta", () => {
      state.set("meta.status", "running", { source: "unit" });

      expect(events.emitSync).toHaveBeenCalledWith(
        "state.changed",
        expect.objectContaining({
          path: "meta.status",
          oldValue: "idle",
          newValue: "running",
          meta: { source: "unit" },
        })
      );
      expect(events.emitSync).toHaveBeenCalledWith(
        "state.change",
        expect.objectContaining({
          path: "meta.status",
          oldValue: "idle",
          newValue: "running",
          source: "unit",
        })
      );
    });
  });

  describe("merge", () => {
    it("merges objects and preserves existing keys", () => {
      state.set("config", { a: 1, b: 2 });
      state.merge("config", { b: 3, c: 4 });
      expect(state.get("config")).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("creates path when missing and handles empty updates", () => {
      state.merge("new.path", {});
      expect(state.get("new.path")).toEqual({});
    });

    it("replaces when current or updates are non-objects", () => {
      state.set("config", 123);
      state.merge("config", { ok: true });
      expect(state.get("config")).toEqual({ ok: true });

      state.set("config", { ok: true });
      state.merge("config", null);
      expect(state.get("config")).toBeNull();

      state.merge("config", "text");
      expect(state.get("config")).toBe("text");
    });

    it("forwards meta to change record", () => {
      const cb = vi.fn();
      state.subscribe("merged", cb);
      state.merge("merged", { a: 1 }, { source: "merge" });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].meta).toEqual({ source: "merge" });
    });
  });

  describe("delete", () => {
    it("deletes existing values and reports op meta", () => {
      state.set("toDelete", "value");
      const cb = vi.fn();
      state.subscribe("toDelete", cb);

      expect(state.delete("toDelete")).toBe(true);
      expect(state.get("toDelete")).toBeUndefined();

      expect(cb).toHaveBeenCalledTimes(1);
      const change = cb.mock.calls[0][0];
      expect(change.meta.op).toBe("delete");
      expect(change.oldValue).toBe("value");
      expect(change.newValue).toBeUndefined();
    });

    it("returns false for missing, empty, or unsafe paths", () => {
      expect(state.delete("missing.path")).toBe(false);
      expect(state.delete("")).toBe(false);
      expect(state.delete("safe.__proto__.x")).toBe(false);
      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    });

    it("returns false when parent path is non-object", () => {
      state.set("primitive", 42);
      expect(state.delete("primitive.child")).toBe(false);
    });

    it("does not delete inherited properties", () => {
      state._state.inherited = Object.create({ value: 123 });
      expect(state.get("inherited.value")).toBe(123);
      expect(state.delete("inherited.value")).toBe(false);
    });
  });

  describe("push", () => {
    it("creates array when missing or when current value is non-array", () => {
      state.push("items", "a");
      expect(state.get("items")).toEqual(["a"]);

      state.set("items", { not: "array" });
      state.push("items", "b");
      expect(state.get("items")).toEqual(["b"]);
    });

    it("appends to existing array", () => {
      state.set("items", ["a"]);
      state.push("items", "b");
      expect(state.get("items")).toEqual(["a", "b"]);
    });

    it("forwards meta to change record", () => {
      const cb = vi.fn();
      state.subscribe("pushed", cb);
      state.push("pushed", "item", { source: "push" });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].meta).toEqual({ source: "push" });
    });
  });

  describe("subscribe", () => {
    it("notifies exact path changes with change record", () => {
      const cb = vi.fn();
      state.subscribe("user.name", cb);

      state.set("user.name", "Alice");

      expect(cb).toHaveBeenCalledTimes(1);
      const change = cb.mock.calls[0][0];
      expect(change.path).toBe("user.name");
      expect(change.newValue).toBe("Alice");
      expect(change.oldValue).toBeUndefined();
      expect(typeof change.timestamp).toBe("number");
    });

    it("supports legacy subscriber signatures", () => {
      const legacy = vi.fn((newValue, oldValue, path) => ({ newValue, oldValue, path }));
      state.subscribe("legacy.path", legacy);

      state.set("legacy.path", "value");

      expect(legacy).toHaveBeenCalledWith("value", undefined, "legacy.path");
    });

    it("matches prefix wildcards for parent and descendant paths", () => {
      const cb = vi.fn();
      state.subscribe("custom.*", cb);

      state.set("custom", { level: 1 });
      state.set("custom.deep.value", 2);

      expect(cb).toHaveBeenCalledTimes(2);
      const paths = cb.mock.calls.map(([change]) => change.path);
      expect(paths).toEqual(expect.arrayContaining(["custom", "custom.deep.value"]));
    });

    it("matches segment wildcards with *", () => {
      const cb = vi.fn();
      state.subscribe("stages.*.status", cb);

      state.set("stages.alpha.status", "ok");

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("matches segment wildcards with ?", () => {
      const cb = vi.fn();
      state.subscribe("stages.?eta.status", cb);

      state.set("stages.beta.status", "ok");

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("matches wildcard prefixes that include segment wildcards", () => {
      const cb = vi.fn();
      state.subscribe("a.*.*", cb);

      state.set("a.b.c.d", "value");

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("does not match when segment count differs for non-prefix patterns", () => {
      const cb = vi.fn();
      state.subscribe("runtime.*.input", cb);

      state.set("runtime.input", 1);

      expect(cb).not.toHaveBeenCalled();
    });

    it("unsubscribe stops notifications", () => {
      const cb = vi.fn();
      const unsubscribe = state.subscribe("temp", cb);

      unsubscribe();
      state.set("temp", 1);

      expect(cb).not.toHaveBeenCalled();
    });

    it("logs subscriber errors without blocking others", () => {
      const bad = vi.fn(() => {
        throw new Error("boom");
      });
      const good = vi.fn();

      state.subscribe("boom.path", bad);
      state.subscribe("boom.path", good);

      expect(() => state.set("boom.path", 1)).not.toThrow();

      expect(good).toHaveBeenCalledTimes(1);
      expect(mockedLogger.error).toHaveBeenCalledTimes(1);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Subscriber error for "boom.path":'),
        expect.any(Error)
      );
    });
  });

  describe("snapshot/rollback", () => {
    it("creates snapshots, emits events, and restores on rollback", async () => {
      state.set("snapshot.value", { deep: { n: 1 } });
      const snapshotId = await state.snapshot("snap1");
      state.set("snapshot.value.deep.n", 2);

      const cb = vi.fn();
      state.subscribe("*", cb);

      expect(state.rollback(snapshotId)).toBe(true);
      expect(state.get("snapshot.value.deep.n")).toBe(1);

      expect(cb).toHaveBeenCalledTimes(1);
      const change = cb.mock.calls[0][0];
      expect(change.path).toBe("*");
      expect(change.meta.rollback).toBe(true);

      expect(events.emitSync).toHaveBeenCalledWith("state.snapshot", { id: "snap1" });
      expect(events.emitSync).toHaveBeenCalledWith(
        "state.rollback",
        expect.objectContaining({ id: "snap1" })
      );
      expect(state.listSnapshots()).toContain("snap1");
    });

    it("evicts oldest snapshots using LRU semantics", async () => {
      const bus = new StateBus({ maxSnapshots: 2 });

      await bus.snapshot("one");
      await bus.snapshot("two");
      await bus.snapshot("three");

      expect(bus.listSnapshots()).toEqual(["two", "three"]);

      await bus.snapshot("two");
      expect(bus.listSnapshots()).toEqual(["three", "two"]);
    });

    it("throws when rollback snapshot does not exist", () => {
      const bus = new StateBus();
      expect(() => bus.rollback("missing")).toThrow("Snapshot not found");
    });

    it("deletes snapshots by id", async () => {
      const bus = new StateBus();
      await bus.snapshot("toDelete");
      expect(await bus.deleteSnapshot("toDelete")).toBe(true);
      expect(await bus.deleteSnapshot("toDelete")).toBe(false);
    });
  });

  describe("serialization", () => {
    it("returns deep clones from toJSON", () => {
      state.set("context.data", { items: [1, 2, 3] });

      const data = state.toJSON();
      data.context.data.items.push(4);

      expect(state.get("context.data.items")).toEqual([1, 2, 3]);
    });

    it("imports state via fromJSON and emits events", () => {
      const data = {
        meta: { status: "imported", updatedAt: 123 },
        input: { value: "x" },
      };

      state.fromJSON(data);

      expect(state.get("meta.status")).toBe("imported");
      expect(state.get("input.value")).toBe("x");

      data.input.value = "mutated";
      expect(state.get("input.value")).toBe("x");

      expect(events.emitSync).toHaveBeenCalledWith(
        "state.imported",
        expect.objectContaining({ state: expect.any(Object) })
      );
    });

    it("ignores invalid data in fromJSON", () => {
      state.set("flag", true);

      const invalids = [null, undefined, 0, -1, "text"];
      for (const value of invalids) {
        state.fromJSON(value);
      }

      expect(state.get("flag")).toBe(true);
    });

    it("resets to defaults and emits reset events", () => {
      state.set("meta.status", "running");
      state.set("runtime.iteration", 5);

      state.reset();

      expect(state.get("meta.status")).toBe("idle");
      expect(state.get("runtime.iteration")).toBe(0);
      expect(state.get("meta.updatedAt")).toBeNull();
      expect(events.emitSync).toHaveBeenCalledWith(
        "state.reset",
        expect.objectContaining({ oldState: expect.any(Object) })
      );
    });
  });

  describe("change log", () => {
    it("records changes and enforces maxLog", () => {
      const bus = new StateBus({ keepLog: true, maxLog: 2 });
      bus.set("a", 1);
      bus.set("b", 2);
      bus.set("c", 3);

      const log = bus.getChangeLog();
      expect(log).toHaveLength(2);
      expect(log[0].path).toBe("b");
      expect(log[1].path).toBe("c");
    });

    it("returns empty log when keepLog is false", () => {
      const bus = new StateBus();
      bus.set("a", 1);
      expect(bus.getChangeLog()).toEqual([]);
    });

    it("includes meta only when provided", () => {
      const bus = new StateBus({ keepLog: true });
      bus.set("a", 1);
      bus.set("b", 2, { source: "test" });

      const log = bus.getChangeLog(2);
      expect(log[0].meta).toBeUndefined();
      expect(log[1].meta).toEqual({ source: "test" });
    });
  });

  describe("boundaries", () => {
    it("handles rapid consecutive updates on the same path", () => {
      const bus = new StateBus({ keepLog: true, maxLog: 3 });

      for (let i = 0; i < 10; i += 1) {
        bus.set("counter", i);
      }

      expect(bus.get("counter")).toBe(9);
      expect(bus.getChangeLog()).toHaveLength(3);
    });

    it("handles concurrent updates to multiple paths", async () => {
      const bus = new StateBus();

      const updates = Array.from({ length: 25 }, (_, i) =>
        Promise.resolve().then(() => bus.set(`bulk.${i}`, i))
      );

      await Promise.all(updates);

      for (let i = 0; i < 25; i += 1) {
        expect(bus.get(`bulk.${i}`)).toBe(i);
      }
    });

    it("handles large data, long strings, and deep nesting", () => {
      const bus = new StateBus();
      const hugeString = "x".repeat(1_000_000);
      const longString = "y".repeat(10_000);
      const deepPath = Array.from({ length: 60 }, (_, i) => `lvl${i}`).join(".");

      bus.set("files.large", hugeString);
      bus.set("text.long", longString);
      bus.set(deepPath, "deep");

      expect(bus.get("files.large").length).toBe(1_000_000);
      expect(bus.get("text.long")).toBe(longString);
      expect(bus.get(deepPath)).toBe("deep");
    });
  });

  describe("events integration", () => {
    it("works without an EventBus", async () => {
      const bus = new StateBus();

      bus.set("value", 1);
      await bus.snapshot("no-events");
      bus.reset();
    });
  });
});
