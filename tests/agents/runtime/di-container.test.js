


import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

    expect(callCount).toBe(1, "Factory should be called once");
    expect(first).toBe(second, "Should return same instance");
    expect(first.value).toBe(1);
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

    expect(callCount).toBe(2, "Factory should be called twice");
    expect(first).not.toBe(second, "Should return different instances");
  });

  it("throws on unregistered service", () => {
    const container = new Container();
    expect(() => container.get("unknown")).toThrow(/not registered/);
  });

  it("tryGet returns undefined for unregistered", () => {
    const container = new Container();
    expect(container.tryGet("unknown")).toBe(undefined);
  });

  it("has() checks registration", () => {
    const container = new Container();
    container.register("foo", () => "bar");

    expect(container.has("foo")).toBe(true);
    expect(container.has("baz")).toBe(false);
  });

  it("registerValue shorthand", () => {
    const container = new Container();
    const obj = { x: 1 };
    container.registerValue("obj", obj);

    expect(container.get("obj")).toBe(obj);
  });

  it("override replaces factory and clears cache", () => {
    const container = new Container();
    container.register("val", () => "first");

    expect(container.get("val")).toBe("first");

    container.override("val", () => "second");
    expect(container.get("val")).toBe("second");
  });

  it("reset clears all singletons", () => {
    const container = new Container();
    let callCount = 0;

    container.register("counter", () => ++callCount);
    container.get("counter");
    expect(callCount).toBe(1);

    container.reset();
    container.get("counter");
    expect(callCount).toBe(2);
  });

  it("child container inherits from parent", () => {
    const parent = new Container();
    parent.register("shared", () => "from-parent");

    const child = parent.createChild();
    expect(child.get("shared")).toBe("from-parent");
  });

  it("child container can override parent", () => {
    const parent = new Container();
    parent.register("val", () => "parent");

    const child = parent.createChild();
    child.override("val", () => "child");

    expect(parent.get("val")).toBe("parent");
    expect(child.get("val")).toBe("child");
  });

  it("factory receives container for dependency resolution", () => {
    const container = new Container();
    container.register("dep", () => ({ name: "dependency" }));
    container.register("main", (c) => ({
      dep: c.get("dep"),
      ownProp: "main",
    }));

    const main = container.get("main");
    expect(main.ownProp).toBe("main");
    expect(main.dep.name).toBe("dependency");
  });

  it("getServiceIds returns all registered ids", () => {
    const parent = new Container();
    parent.register("a", () => 1);

    const child = parent.createChild();
    child.register("b", () => 2);

    const ids = child.getServiceIds();
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("createContainer helper", () => {
    const container = createContainer({
      foo: () => "bar",
      num: () => 42,
    });

    expect(container.get("foo")).toBe("bar");
    expect(container.get("num")).toBe(42);
  });

  it("validates id and factory", () => {
    const container = new Container();

    expect(() => container.register("", () => {}), /non-empty string/);
    expect(() => container.register("valid", "not-a-function")).toThrow(/must be a function/);
  });
});
