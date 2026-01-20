import { describe, it, expect, vi, beforeEach } from "vitest";

const boundaryMock = vi.hoisted(() => ({
  buildBoundaryValues: vi.fn(),
  buildResourceValues: vi.fn(),
}));

vi.mock("virtual:skill-model-boundaries", () => boundaryMock, { virtual: true });

import { buildBoundaryValues, buildResourceValues } from "virtual:skill-model-boundaries";
import skillModel, { SkillScope, SkillRuntime } from "../../../../js/agents/skills/model.js";

const LONG_STRING = "x".repeat(100000);
const HUGE_FILE = "f".repeat(1024 * 1024);
const LARGE_ARRAY = new Array(20000).fill("x");
const LARGE_BINARY = new Uint8Array(1024 * 1024);

function makeDeepObject(depth) {
  let node = { leaf: "value" };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
}

const DEEP_OBJECT = makeDeepObject(64);

const BASIC_BOUNDARY_VALUES = [
  null,
  undefined,
  "",
  "   ",
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "0",
  "123",
  [],
  {},
  { length: 0 },
  { 0: "x", length: 1 },
];

const RESOURCE_BOUNDARY_VALUES = [
  LONG_STRING,
  HUGE_FILE,
  LARGE_ARRAY,
  LARGE_BINARY,
  DEEP_OBJECT,
];

const KEY_BOUNDARY_VALUES = [
  null,
  undefined,
  "",
  "   ",
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "0",
  "123",
];

beforeEach(() => {
  vi.clearAllMocks();
  boundaryMock.buildBoundaryValues.mockImplementation(() => [...BASIC_BOUNDARY_VALUES]);
  boundaryMock.buildResourceValues.mockImplementation(() => [...RESOURCE_BOUNDARY_VALUES]);
});

function isEnumValue(enumObj, value) {
  return Object.values(enumObj).includes(value);
}

function getBoundaryValues() {
  return [...buildBoundaryValues(), ...buildResourceValues()];
}

function expectEnumMapping(enumObj, expected) {
  expect(enumObj).toEqual(expected);
  const expectedValues = Object.values(expected);
  expectedValues.forEach((value) => {
    expect(isEnumValue(enumObj, value)).toBe(true);
  });
}

function expectRejectsBoundaryValues(enumObj) {
  getBoundaryValues().forEach((value) => {
    expect(isEnumValue(enumObj, value)).toBe(false);
  });
}

function expectFrozenAndImmutable(enumObj) {
  expect(Object.isFrozen(enumObj)).toBe(true);
  expect(() =>
    Object.defineProperty(enumObj, "__TEST__", { value: "nope" })
  ).toThrow(TypeError);
  const [firstKey] = Object.keys(enumObj);
  expect(() =>
    Object.defineProperty(enumObj, firstKey, { value: "__mutated__" })
  ).toThrow(TypeError);
}

async function readValuesConcurrently(enumObj, count = 24) {
  const tasks = Array.from({ length: count }, () =>
    Promise.resolve().then(() => Object.values(enumObj))
  );
  return Promise.all(tasks);
}

async function expectStableReads(enumObj) {
  const expected = Object.values(enumObj);
  for (let i = 0; i < 20; i += 1) {
    expect(Object.values(enumObj)).toEqual(expected);
  }
  const concurrentReads = await readValuesConcurrently(enumObj, 20);
  concurrentReads.forEach((values) => {
    expect(values).toEqual(expected);
  });
}

function defineEnumTests(name, enumObj, expected) {
  describe(name, () => {
    it("exposes the expected mapping (normal path)", () => {
      expectEnumMapping(enumObj, expected);
    });

    it("rejects invalid inputs and boundary values", () => {
      expectRejectsBoundaryValues(enumObj);
      expect(buildBoundaryValues).toHaveBeenCalledTimes(1);
      expect(buildResourceValues).toHaveBeenCalledTimes(1);
    });

    it("throws on mutation attempts (error handling)", () => {
      expectFrozenAndImmutable(enumObj);
    });

    it("returns consistent values under rapid/concurrent reads", async () => {
      await expectStableReads(enumObj);
    });
  });
}

defineEnumTests("SkillScope", SkillScope, {
  SYSTEM: "system",
  USER: "user",
  REPO: "repo",
  REMOTE: "remote",
});

defineEnumTests("SkillRuntime", SkillRuntime, {
  JS: "js",
  PYTHON: "python",
});

describe("default export", () => {
  it("exposes named exports (normal path)", () => {
    expect(skillModel.SkillScope).toBe(SkillScope);
    expect(skillModel.SkillRuntime).toBe(SkillRuntime);
  });

  it("returns undefined for boundary keys", () => {
    KEY_BOUNDARY_VALUES.forEach((value) => {
      expect(skillModel[value]).toBeUndefined();
    });
  });

  it("keeps nested enums frozen when accessed via default (error handling)", () => {
    expect(() =>
      Object.defineProperty(skillModel.SkillScope, "SYSTEM", { value: "mutated" })
    ).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(skillModel.SkillRuntime, "JS", { value: "mutated" })
    ).toThrow(TypeError);
  });

  it("supports rapid and concurrent reads", async () => {
    const expectedKeys = Object.keys(skillModel);
    for (let i = 0; i < 20; i += 1) {
      expect(Object.keys(skillModel)).toEqual(expectedKeys);
    }
    const concurrentReads = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve().then(() => Object.keys(skillModel)))
    );
    concurrentReads.forEach((keys) => {
      expect(keys).toEqual(expectedKeys);
    });
  });
});
