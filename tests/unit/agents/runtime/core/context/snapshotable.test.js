import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isSnapshotable,
  assertSnapshotable,
} from "../../../../../../js/agents/runtime/core/context/snapshotable.js";

vi.mock(
  "snapshotable-test-dep",
  () => ({
    label: "mocked-label",
  }),
  { virtual: true },
);

function makeDeepObject(depth) {
  let obj = { leaf: true };
  for (let i = 0; i < depth; i++) obj = { child: obj };
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isSnapshotable", () => {
  it("returns true for objects implementing toSnapshot/fromSnapshot functions", () => {
    const component = {
      toSnapshot: vi.fn(() => ({})),
      fromSnapshot: vi.fn(),
    };

    expect(isSnapshotable(component)).toBe(true);
    expect(component.toSnapshot).not.toHaveBeenCalled();
    expect(component.fromSnapshot).not.toHaveBeenCalled();
  });

  it("returns false for nullish/falsy primitives", () => {
    const cases = [null, undefined, "", 0, false, NaN];

    for (const value of cases) {
      expect(isSnapshotable(value)).toBe(false);
    }
  });

  it("returns false for empty containers and boundary values", () => {
    const cases = [
      [],
      {},
      "   ",
      -1,
      Number.MAX_SAFE_INTEGER,
      "123", // string passed where an object is expected
    ];

    for (const value of cases) {
      expect(isSnapshotable(value)).toBe(false);
    }
  });

  it("returns false when methods are missing or not functions", () => {
    const cases = [
      { toSnapshot: () => ({}) }, // missing fromSnapshot
      { fromSnapshot: () => {} }, // missing toSnapshot
      { toSnapshot: "nope", fromSnapshot: () => {} },
      { toSnapshot: () => ({}), fromSnapshot: "nope" },
    ];

    for (const value of cases) {
      expect(isSnapshotable(value)).toBe(false);
    }
  });

  it("handles resource-boundary inputs without throwing", () => {
    const longString = "a".repeat(100_000);
    const deep = makeDeepObject(200);
    const hugeBinary = new Uint8Array(1024 * 1024); // 1 MiB "file"

    expect(() => isSnapshotable(longString)).not.toThrow();
    expect(() => isSnapshotable(deep)).not.toThrow();
    expect(() => isSnapshotable(hugeBinary)).not.toThrow();

    expect(isSnapshotable(longString)).toBe(false);
    expect(isSnapshotable(deep)).toBe(false);
    expect(isSnapshotable(hugeBinary)).toBe(false);
  });

  it("is stable under concurrent/rapid calls", async () => {
    const component = {
      toSnapshot: vi.fn(() => ({})),
      fromSnapshot: vi.fn(),
    };

    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        Promise.resolve().then(() => isSnapshotable(component)),
      ),
    );

    expect(results.every(Boolean)).toBe(true);
    expect(component.toSnapshot).not.toHaveBeenCalled();
    expect(component.fromSnapshot).not.toHaveBeenCalled();
  });
});

describe("assertSnapshotable", () => {
  it("returns the input value when it implements the protocol", () => {
    const component = {
      toSnapshot: vi.fn(() => ({})),
      fromSnapshot: vi.fn(),
      extra: 123,
    };

    const result = assertSnapshotable(component, "component");

    expect(result).toBe(component);
    expect(result.extra).toBe(123);
    expect(component.toSnapshot).not.toHaveBeenCalled();
    expect(component.fromSnapshot).not.toHaveBeenCalled();
  });

  it("uses default label `value` when none is provided", () => {
    expect(() => assertSnapshotable(undefined)).toThrowError(TypeError);
    expect(() => assertSnapshotable(undefined)).toThrowError("value is required");
  });

  it("throws `${label} is required` for null/undefined/empty-string/zero", async () => {
    const dep = await import("snapshotable-test-dep");
    const label = dep.label;

    const cases = [null, undefined, "", 0];

    for (const value of cases) {
      expect(() => assertSnapshotable(value, label)).toThrowError(TypeError);
      expect(() => assertSnapshotable(value, label)).toThrowError(
        `${label} is required`,
      );
    }
  });

  it("throws `${label}.toSnapshot must be a function` when toSnapshot is missing or invalid", () => {
    const label = "value";

    const cases = [
      {}, // empty object
      [], // empty array
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ", // blank string
      "123", // string passed where an object is expected
      { toSnapshot: 123, fromSnapshot: () => {} },
    ];

    for (const value of cases) {
      expect(() => assertSnapshotable(value, label)).toThrowError(TypeError);
      expect(() => assertSnapshotable(value, label)).toThrowError(
        `${label}.toSnapshot must be a function`,
      );
    }
  });

  it("throws `${label}.fromSnapshot must be a function` when fromSnapshot is missing or invalid", () => {
    const label = "component";

    const cases = [
      { toSnapshot: () => ({}) }, // missing fromSnapshot
      { toSnapshot: () => ({}), fromSnapshot: undefined },
      { toSnapshot: () => ({}), fromSnapshot: 123 },
    ];

    for (const value of cases) {
      expect(() => assertSnapshotable(value, label)).toThrowError(TypeError);
      expect(() => assertSnapshotable(value, label)).toThrowError(
        `${label}.fromSnapshot must be a function`,
      );
    }
  });

  it("is stable under concurrent/rapid calls and does not invoke snapshot methods", async () => {
    const component = {
      toSnapshot: vi.fn(() => ({})),
      fromSnapshot: vi.fn(),
    };

    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        Promise.resolve().then(() => assertSnapshotable(component, "component")),
      ),
    );

    for (const result of results) {
      expect(result).toBe(component);
    }
    expect(component.toSnapshot).not.toHaveBeenCalled();
    expect(component.fromSnapshot).not.toHaveBeenCalled();
  });

  it("works with large/deep snapshots (resource boundary)", () => {
    const deep = makeDeepObject(250);
    const hugeText = "x".repeat(100_000);
    const hugeBinary = new Uint8Array(1024 * 1024); // 1 MiB

    const snapshot = { deep, hugeText, hugeBinary };

    const component = {
      toSnapshot: vi.fn(() => snapshot),
      fromSnapshot: vi.fn((s) => {
        expect(s).toBe(snapshot);
        expect(s.deep.child).toBeDefined();
      }),
    };

    const asserted = assertSnapshotable(component, "component");
    const produced = asserted.toSnapshot({
      includeCheckpoints: true,
      incremental: true,
    });
    asserted.fromSnapshot(produced);

    expect(component.toSnapshot).toHaveBeenCalledTimes(1);
    expect(component.fromSnapshot).toHaveBeenCalledTimes(1);
  });
});