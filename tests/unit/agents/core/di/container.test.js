import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock(
  "virtual:service",
  () => ({
    createService: vi.fn(() => ({ name: "mocked" })),
  }),
  { virtual: true }
);

import { createService } from "virtual:service";
import {
  SINGLETON,
  TRANSIENT,
  Container,
  createContainer,
} from "../../../../../js/agents/core/di/container.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const restoreNodeEnv = () => {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
};

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.leaf = "end";
  return root;
};

describe("SINGLETON", () => {
  it("is a unique symbol", () => {
    expect(typeof SINGLETON).toBe("symbol");
    expect(SINGLETON).not.toBe(TRANSIENT);
  });
});

describe("TRANSIENT", () => {
  it("is a unique symbol", () => {
    expect(typeof TRANSIENT).toBe("symbol");
    expect(TRANSIENT).not.toBe(SINGLETON);
  });
});

describe("Container", () => {
  let container;

  beforeEach(() => {
    container = new Container();
    vi.clearAllMocks();
    restoreNodeEnv();
  });

  afterEach(() => {
    restoreNodeEnv();
    vi.restoreAllMocks();
  });

  it("throws for invalid service ids", () => {
    const invalidIds = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const id of invalidIds) {
      expect(() => container.register(id, () => "ok")).toThrow(
        "Service id must be a non-empty string"
      );
    }
  });

  it("throws for non-function factories including empty array/object", () => {
    const invalidFactories = [[], {}, "not-a-fn"];

    for (const factory of invalidFactories) {
      expect(() => container.register("bad", factory)).toThrow(
        'Factory for "bad" must be a function'
      );
    }
  });

  it("register returns container and accepts whitespace and numeric-string ids", () => {
    const whitespaceId = "   ";
    const numericStringId = "123";

    expect(container.register(whitespaceId, () => "space")).toBe(container);
    expect(container.register(numericStringId, () => "num")).toBe(container);

    expect(container.get(whitespaceId)).toBe("space");
    expect(container.get(numericStringId)).toBe("num");
  });

  it("registerValue stores empty values and numeric boundary values", () => {
    const emptyArray = [];
    const emptyObject = {};

    container.registerValue("nullValue", null);
    container.registerValue("undefinedValue", undefined);
    container.registerValue("emptyArray", emptyArray);
    container.registerValue("emptyObject", emptyObject);
    container.registerValue("zero", 0);
    container.registerValue("negative", -1);
    container.registerValue("maxSafe", Number.MAX_SAFE_INTEGER);

    expect(container.has("nullValue")).toBe(true);
    expect(container.get("nullValue")).toBeNull();
    expect(container.has("undefinedValue")).toBe(true);
    expect(container.get("undefinedValue")).toBeUndefined();
    expect(container.get("emptyArray")).toBe(emptyArray);
    expect(container.get("emptyObject")).toBe(emptyObject);
    expect(container.get("zero")).toBe(0);
    expect(container.get("negative")).toBe(-1);
    expect(container.get("maxSafe")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("keeps array-like objects intact", () => {
    const arrayLike = { 0: "x", length: 1 };
    container.registerValue("arrayLike", arrayLike);

    const value = container.get("arrayLike");
    expect(Array.isArray(value)).toBe(false);
    expect(value).toBe(arrayLike);
  });

  it("handles long ids, large payloads, and deep nesting", () => {
    const longId = `id-${"x".repeat(10000)}`;
    const longString = "y".repeat(100000);
    const largeContent = "z".repeat(1024 * 1024);
    const deepObject = buildDeepObject(50);

    container.registerValue(longId, "long-id");
    container.registerValue("longString", longString);
    container.registerValue("largeFile", largeContent);
    container.registerValue("deepObject", deepObject);

    expect(container.get(longId)).toBe("long-id");
    expect(container.get("longString")).toBe(longString);
    expect(container.get("largeFile").length).toBe(1024 * 1024);

    let cursor = container.get("deepObject");
    for (let i = 0; i < 50; i += 1) {
      cursor = cursor.next;
    }
    expect(cursor.leaf).toBe("end");
  });

  it("uses mocked external factory functions", () => {
    container.register("mocked", createService);

    const value = container.get("mocked");
    expect(createService).toHaveBeenCalledTimes(1);
    expect(createService).toHaveBeenCalledWith(container);
    expect(value).toEqual({ name: "mocked" });
  });

  it("caches singleton instances", () => {
    const factory = vi.fn(() => ({ token: Symbol("x") }));
    container.register("singleton", factory, { scope: SINGLETON });

    const first = container.get("singleton");
    const second = container.get("singleton");

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("creates new instances for transient scope", () => {
    const factory = vi.fn(() => ({ token: Symbol("x") }));
    container.register("transient", factory, { scope: TRANSIENT });

    const first = container.get("transient");
    const second = container.get("transient");

    expect(first).not.toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("delegates to parent containers and has checks parent registrations", () => {
    const parent = new Container();
    parent.registerValue("shared", "from-parent");

    const child = new Container(parent);

    expect(child.has("shared")).toBe(true);
    expect(child.get("shared")).toBe("from-parent");
  });

  it("throws when service is missing", () => {
    expect(() => container.get("missing")).toThrow(
      "Service not registered: missing"
    );
  });

  it("tryGet returns undefined for missing id without warning", () => {
    process.env.NODE_ENV = "test";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(container.tryGet("missing")).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("tryGet warns on sync failure in non-production", () => {
    process.env.NODE_ENV = "test";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.register("boom", () => {
      throw new Error("boom");
    });

    expect(container.tryGet("boom")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Container] tryGet("boom") failed',
      expect.any(Error)
    );
  });

  it("tryGet suppresses warnings in production", () => {
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    container.register("boom", () => {
      throw new Error("boom");
    });

    expect(container.tryGet("boom")).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("tryGet resolves undefined on async rejection", async () => {
    process.env.NODE_ENV = "test";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("async-fail");
    container.register("asyncFail", () => Promise.reject(error));

    await expect(container.tryGet("asyncFail")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Container] tryGet("asyncFail") failed',
      error
    );
  });

  it("reuses singleton promise for concurrent async gets", async () => {
    let resolve;
    const factory = vi.fn(
      () =>
        new Promise((res) => {
          resolve = res;
        })
    );
    container.register("asyncSingleton", factory, { scope: SINGLETON });

    const first = container.get("asyncSingleton");
    const second = container.get("asyncSingleton");

    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);

    resolve("value");
    await expect(Promise.all([first, second])).resolves.toEqual(["value", "value"]);
  });

  it("creates distinct promises for transient async gets", async () => {
    let resolveA;
    let resolveB;
    const factory = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveA = res;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveB = res;
          })
      );
    container.register("asyncTransient", factory, { scope: TRANSIENT });

    const first = container.get("asyncTransient");
    const second = container.get("asyncTransient");

    expect(first).not.toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);

    resolveA("a");
    resolveB("b");
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
  });

  it("override clears cached singleton", () => {
    const firstFactory = vi.fn(() => ({ version: 1 }));
    const secondFactory = vi.fn(() => ({ version: 2 }));
    container.register("service", firstFactory);

    const first = container.get("service");
    container.override("service", secondFactory);
    const second = container.get("service");

    expect(first).not.toBe(second);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });

  it("reset clears singleton cache", () => {
    const factory = vi.fn(() => ({ token: Symbol("t") }));
    container.register("cache", factory);

    const first = container.get("cache");
    container.reset();
    const second = container.get("cache");

    expect(first).not.toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("createChild can override without affecting parent", () => {
    const parent = new Container();
    parent.registerValue("service", { owner: "parent" });

    const child = parent.createChild();
    expect(child.get("service").owner).toBe("parent");

    child.override("service", () => ({ owner: "child" }));

    expect(child.get("service").owner).toBe("child");
    expect(parent.get("service").owner).toBe("parent");
  });

  it("getServiceIds returns union without duplicates", () => {
    const parent = new Container();
    parent.registerValue("parentOnly", true);
    parent.registerValue("shared", true);

    const child = parent.createChild();
    child.registerValue("childOnly", true);
    child.registerValue("shared", true);

    const ids = child.getServiceIds();
    expect(ids).toEqual(expect.arrayContaining(["parentOnly", "childOnly", "shared"]));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("createContainer", () => {
  afterEach(() => {
    restoreNodeEnv();
    vi.restoreAllMocks();
  });

  it("creates a container with initial registrations", () => {
    const container = createContainer({
      config: () => ({ value: "ok" }),
    });

    const first = container.get("config");
    const second = container.get("config");

    expect(container).toBeInstanceOf(Container);
    expect(first).toBe(second);
    expect(first.value).toBe("ok");
  });

  it("throws when registrations include invalid factories", () => {
    expect(() =>
      createContainer({
        ok: () => "fine",
        bad: "nope",
      })
    ).toThrow('Factory for "bad" must be a function');
  });

  it("accepts empty registrations and rejects array registrations", () => {
    const empty = createContainer({});
    expect(empty.getServiceIds()).toEqual([]);

    expect(() => createContainer([["id", () => "value"]])).toThrow(
      'Factory for "0" must be a function'
    );
  });
});
