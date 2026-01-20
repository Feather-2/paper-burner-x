import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedRegistry = vi.hoisted(() => {
  const instances = [];

  class HookRegistry {
    constructor() {
      this.register = vi.fn();
      this.list = vi.fn(() => []);
      this.clear = vi.fn();
      instances.push(this);
    }
  }

  return { HookRegistry, instances };
});

vi.mock("../../../../../js/agents/runtime/hooks/hook-registry.js", () => ({
  HookRegistry: mockedRegistry.HookRegistry,
}));

import {
  enhanceEventBusWithHooks,
  getHookRegistry,
  default as eventBusHooksDefault,
} from "../../../../../js/agents/runtime/hooks/event-bus-hooks.js";

const REGISTRY_SYMBOL = Symbol.for("paperburner.hookRegistry.v1");

function makeDeepObject(depth) {
  const root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.next = {};
    current = current.next;
  }
  return root;
}

describe("enhanceEventBusWithHooks", () => {
  beforeEach(() => {
    mockedRegistry.instances.length = 0;
    vi.clearAllMocks();
  });

  it("returns input unchanged for non-object values", () => {
    const inputs = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "42",
      true,
      false,
    ];

    for (const value of inputs) {
      expect(enhanceEventBusWithHooks(value)).toBe(value);
    }

    expect(mockedRegistry.instances.length).toBe(0);
  });

  it("attaches registry and hook methods for plain objects", () => {
    const bus = {};

    const result = enhanceEventBusWithHooks(bus);

    expect(result).toBe(bus);
    expect(mockedRegistry.instances.length).toBe(1);

    const registry = mockedRegistry.instances[0];
    const descriptor = Object.getOwnPropertyDescriptor(bus, REGISTRY_SYMBOL);

    expect(bus[REGISTRY_SYMBOL]).toBe(registry);
    expect(descriptor).toBeTruthy();
    expect(descriptor.enumerable).toBe(false);

    expect(typeof bus.registerHook).toBe("function");
    expect(typeof bus.getHooks).toBe("function");
    expect(typeof bus.clearHooks).toBe("function");

    const hookDef = { type: "command" };
    bus.registerHook("PreToolUse", hookDef);
    expect(registry.register).toHaveBeenCalledWith("PreToolUse", hookDef);

    registry.list.mockReturnValueOnce(["hook"]);
    expect(bus.getHooks("PreToolUse")).toEqual(["hook"]);
    expect(registry.list).toHaveBeenCalledWith("PreToolUse");

    bus.clearHooks("PreToolUse");
    expect(registry.clear).toHaveBeenCalledWith("PreToolUse");
  });

  it("preserves existing hook methods", () => {
    const registerHook = vi.fn();
    const getHooks = vi.fn();
    const clearHooks = vi.fn();
    const bus = { registerHook, getHooks, clearHooks };

    enhanceEventBusWithHooks(bus);

    expect(bus.registerHook).toBe(registerHook);
    expect(bus.getHooks).toBe(getHooks);
    expect(bus.clearHooks).toBe(clearHooks);
    expect(mockedRegistry.instances.length).toBe(1);
  });

  it("replaces non-function hook properties", () => {
    const bus = { registerHook: "bad", getHooks: 123, clearHooks: null };

    enhanceEventBusWithHooks(bus);

    expect(typeof bus.registerHook).toBe("function");
    expect(typeof bus.getHooks).toBe("function");
    expect(typeof bus.clearHooks).toBe("function");
    expect(mockedRegistry.instances.length).toBe(1);
  });

  it("is idempotent for repeated calls", () => {
    const bus = {};

    enhanceEventBusWithHooks(bus);
    const registry = bus[REGISTRY_SYMBOL];
    const registerHook = bus.registerHook;

    const result = enhanceEventBusWithHooks(bus);

    expect(result).toBe(bus);
    expect(bus[REGISTRY_SYMBOL]).toBe(registry);
    expect(bus.registerHook).toBe(registerHook);
    expect(mockedRegistry.instances.length).toBe(1);
  });

  it("skips enhancement when registry symbol already exists", () => {
    const bus = {};
    bus[REGISTRY_SYMBOL] = { existing: true };

    const result = enhanceEventBusWithHooks(bus);

    expect(result).toBe(bus);
    expect(bus.registerHook).toBeUndefined();
    expect(bus.getHooks).toBeUndefined();
    expect(bus.clearHooks).toBeUndefined();
    expect(mockedRegistry.instances.length).toBe(0);
  });

  it("supports arrays and array-like objects", () => {
    const arrayBus = [];
    const arrayLikeBus = { length: 0, 0: "value" };

    enhanceEventBusWithHooks(arrayBus);
    enhanceEventBusWithHooks(arrayLikeBus);

    expect(typeof arrayBus.registerHook).toBe("function");
    expect(typeof arrayBus.getHooks).toBe("function");
    expect(typeof arrayBus.clearHooks).toBe("function");

    expect(typeof arrayLikeBus.registerHook).toBe("function");
    expect(typeof arrayLikeBus.getHooks).toBe("function");
    expect(typeof arrayLikeBus.clearHooks).toBe("function");

    expect(mockedRegistry.instances.length).toBe(2);
  });

  it("handles concurrent enhancement calls", async () => {
    const bus = {};

    await Promise.all(
      Array.from({ length: 10 }, () => Promise.resolve().then(() => enhanceEventBusWithHooks(bus)))
    );

    expect(mockedRegistry.instances.length).toBe(1);
  });

  it("handles rapid sequential enhancement calls", () => {
    const bus = {};

    for (let i = 0; i < 50; i += 1) {
      enhanceEventBusWithHooks(bus);
    }

    expect(mockedRegistry.instances.length).toBe(1);
  });

  it("forwards long event names and deep hook definitions", () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);

    const registry = mockedRegistry.instances[0];
    const longName = "E".repeat(10000);
    const largePayload = "x".repeat(1024 * 1024);
    const deepDef = makeDeepObject(64);
    const hookDef = { type: "command", payload: largePayload, nested: deepDef };

    bus.registerHook(longName, hookDef);

    expect(registry.register).toHaveBeenCalledWith(longName, hookDef);
  });
});

describe("getHookRegistry", () => {
  beforeEach(() => {
    mockedRegistry.instances.length = 0;
    vi.clearAllMocks();
  });

  it("returns null for non-object values", () => {
    const inputs = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "42",
      true,
      false,
    ];

    for (const value of inputs) {
      expect(getHookRegistry(value)).toBeNull();
    }
  });

  it("returns null when registry is missing", () => {
    expect(getHookRegistry({})).toBeNull();
    expect(getHookRegistry([])).toBeNull();
  });

  it("returns null when registry symbol is not a HookRegistry instance", () => {
    const bus = {};
    bus[REGISTRY_SYMBOL] = { register: vi.fn() };

    expect(getHookRegistry(bus)).toBeNull();
  });

  it("returns registry for enhanced bus", () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);

    expect(getHookRegistry(bus)).toBe(mockedRegistry.instances[0]);
  });

  it("returns consistent registry across concurrent access", async () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(getHookRegistry(bus)))
    );

    for (const result of results) {
      expect(result).toBe(mockedRegistry.instances[0]);
    }
  });
});

describe("default", () => {
  it("exposes enhanceEventBusWithHooks and getHookRegistry", () => {
    expect(eventBusHooksDefault.enhanceEventBusWithHooks).toBe(enhanceEventBusWithHooks);
    expect(eventBusHooksDefault.getHookRegistry).toBe(getHookRegistry);
  });
});
