import { describe, it } from "node:test";
import assert from "node:assert";

import { Container, SINGLETON, TRANSIENT, createContainer } from "../../../js/agents/runtime/di/container.js";

describe("DI Container", () => {
  it("registers and resolves singleton", () => {
    const container = new Container();
    let callCount = 0;

    container.register("counter", () => {
      callCount++;
      return { value: callCount };
    });

    const first = container.get("counter");
    const second = container.get("counter");

    assert.strictEqual(callCount, 1, "Factory should be called once");
    assert.strictEqual(first, second, "Should return same instance");
    assert.strictEqual(first.value, 1);
  });

  it("registers and resolves transient", () => {
    const container = new Container();
    let callCount = 0;

    container.register("counter", () => {
      callCount++;
      return { value: callCount };
    }, { scope: TRANSIENT });

    const first = container.get("counter");
    const second = container.get("counter");

    assert.strictEqual(callCount, 2, "Factory should be called twice");
    assert.notStrictEqual(first, second, "Should return different instances");
  });

  it("throws on unregistered service", () => {
    const container = new Container();
    assert.throws(() => container.get("unknown"), /not registered/);
  });

  it("tryGet returns undefined for unregistered", () => {
    const container = new Container();
    assert.strictEqual(container.tryGet("unknown"), undefined);
  });

  it("has() checks registration", () => {
    const container = new Container();
    container.register("foo", () => "bar");

    assert.strictEqual(container.has("foo"), true);
    assert.strictEqual(container.has("baz"), false);
  });

  it("registerValue shorthand", () => {
    const container = new Container();
    const obj = { x: 1 };
    container.registerValue("obj", obj);

    assert.strictEqual(container.get("obj"), obj);
  });

  it("override replaces factory and clears cache", () => {
    const container = new Container();
    container.register("val", () => "first");

    assert.strictEqual(container.get("val"), "first");

    container.override("val", () => "second");
    assert.strictEqual(container.get("val"), "second");
  });

  it("reset clears all singletons", () => {
    const container = new Container();
    let callCount = 0;

    container.register("counter", () => ++callCount);
    container.get("counter");
    assert.strictEqual(callCount, 1);

    container.reset();
    container.get("counter");
    assert.strictEqual(callCount, 2);
  });

  it("child container inherits from parent", () => {
    const parent = new Container();
    parent.register("shared", () => "from-parent");

    const child = parent.createChild();
    assert.strictEqual(child.get("shared"), "from-parent");
  });

  it("child container can override parent", () => {
    const parent = new Container();
    parent.register("val", () => "parent");

    const child = parent.createChild();
    child.override("val", () => "child");

    assert.strictEqual(parent.get("val"), "parent");
    assert.strictEqual(child.get("val"), "child");
  });

  it("factory receives container for dependency resolution", () => {
    const container = new Container();
    container.register("dep", () => ({ name: "dependency" }));
    container.register("main", (c) => ({
      dep: c.get("dep"),
      ownProp: "main",
    }));

    const main = container.get("main");
    assert.strictEqual(main.ownProp, "main");
    assert.strictEqual(main.dep.name, "dependency");
  });

  it("getServiceIds returns all registered ids", () => {
    const parent = new Container();
    parent.register("a", () => 1);

    const child = parent.createChild();
    child.register("b", () => 2);

    const ids = child.getServiceIds();
    assert.ok(ids.includes("a"));
    assert.ok(ids.includes("b"));
  });

  it("createContainer helper", () => {
    const container = createContainer({
      foo: () => "bar",
      num: () => 42,
    });

    assert.strictEqual(container.get("foo"), "bar");
    assert.strictEqual(container.get("num"), 42);
  });

  it("validates id and factory", () => {
    const container = new Container();

    assert.throws(() => container.register("", () => {}), /non-empty string/);
    assert.throws(() => container.register("valid", "not-a-function"), /must be a function/);
  });
});
