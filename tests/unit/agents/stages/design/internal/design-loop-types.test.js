import { describe, it, expect, vi, beforeEach } from "vitest";

const modulePath = "../../../../../../js/agents/stages/design/internal/design-loop-types.js";

const sharedModuleFactory = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("shared index should not be loaded at runtime");
  })
);

vi.mock("../../../../../../js/agents/shared/index.js", sharedModuleFactory);

const importModule = () => import(modulePath);

const buildDeepObject = (depth) => {
  let root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  return root;
};

describe("design-loop-types module", () => {
  beforeEach(() => {
    vi.resetModules();
    sharedModuleFactory.mockClear();
  });

  it("imports without loading shared index and exports no runtime members", async () => {
    const mod = await importModule();

    expect(sharedModuleFactory).not.toHaveBeenCalled();
    expect(Object.keys(mod)).toEqual([]);
    expect(mod.default).toBeUndefined();
    expect(mod.DesignLoopConstructorOptions).toBeUndefined();
  });

  it("returns undefined for empty or nullish export keys", async () => {
    const mod = await importModule();

    const keys = [null, undefined, "", " ", "\t", [], {}];

    keys.forEach((key) => {
      expect(mod[key]).toBeUndefined();
    });
  });

  it("returns undefined for numeric boundary keys", async () => {
    const mod = await importModule();

    expect(mod[0]).toBeUndefined();
    expect(mod[-1]).toBeUndefined();
    expect(mod[Number.MAX_SAFE_INTEGER]).toBeUndefined();
  });

  it("returns undefined for type boundary keys", async () => {
    const mod = await importModule();

    const arrayLike = { 0: "x", length: 1 };

    expect(mod["1"]).toBeUndefined();
    expect(mod[1]).toBeUndefined();
    expect(Array.isArray(arrayLike)).toBe(false);
    expect(mod[arrayLike]).toBeUndefined();
  });

  it("throws when calling a missing export", async () => {
    const mod = await importModule();

    expect(() => {
      mod.missingExport();
    }).toThrow(TypeError);
  });

  it("supports concurrent imports without changing the namespace", async () => {
    const [first, second, third] = await Promise.all([
      importModule(),
      importModule(),
      importModule(),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(Object.keys(first)).toEqual([]);
  });

  it("handles rapid consecutive imports without exposing members", async () => {
    const modules = [];
    for (let i = 0; i < 5; i += 1) {
      modules.push(await importModule());
    }

    modules.forEach((mod) => {
      expect(Object.keys(mod)).toEqual([]);
      expect(mod.default).toBeUndefined();
    });
  });

  it("returns undefined for long, huge, and deep-nested keys", async () => {
    const mod = await importModule();

    const longKey = "x".repeat(100_000);
    const hugeKey = "y".repeat(1_000_000);
    const deepObject = buildDeepObject(200);
    const deepKey = JSON.stringify(deepObject);

    expect(mod[longKey]).toBeUndefined();
    expect(mod[hugeKey]).toBeUndefined();
    expect(mod[deepObject]).toBeUndefined();
    expect(mod[deepKey]).toBeUndefined();
  });
});
