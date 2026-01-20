import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
  };
});

const MODULE_IMPORT = "../../../../../js/agents/core/archive/storage-adapter.js";
const MODULE_URL = new URL(MODULE_IMPORT, import.meta.url);
const MODULE_PATH = fileURLToPath(MODULE_URL);
const mockedFs = vi.mocked(fs);

function readStorageAdapterSource() {
  return mockedFs.readFileSync(MODULE_PATH, "utf8");
}

function extractAdapterProperties(source) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }
  if (!/@typedef\s+\{Object\}\s+StorageAdapter/.test(source)) {
    return [];
  }
  const propertyRegex = /@property\s+\{[^}]+\}\s+([A-Za-z_$][\w$]*)\b/g;
  const props = new Set();
  let match = propertyRegex.exec(source);
  while (match) {
    props.add(match[1]);
    match = propertyRegex.exec(source);
  }
  return Array.from(props);
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const actualFs = await vi.importActual("node:fs");
  mockedFs.readFileSync.mockImplementation(actualFs.readFileSync);
});

describe("storage-adapter module exports", () => {
  it("imports as an empty namespace", async () => {
    const mod = await import(MODULE_IMPORT);
    expect(Object.keys(mod)).toEqual([]);
    expect(mod.default).toBeUndefined();
  });

  it("does not expose properties for boundary keys", async () => {
    const mod = await import(MODULE_IMPORT);
    const boundaryKeys = [
      null,
      undefined,
      "",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ",
      "123",
      { 0: "x", length: 1 },
      { nested: { deeper: { deepest: true } } },
    ];

    for (const key of boundaryKeys) {
      expect(mod[key]).toBeUndefined();
    }
  });

  it("remains empty across concurrent imports", async () => {
    const mods = await Promise.all([
      import(MODULE_IMPORT),
      import(MODULE_IMPORT),
      import(MODULE_IMPORT),
      import(MODULE_IMPORT),
    ]);

    for (const mod of mods) {
      expect(Object.keys(mod)).toHaveLength(0);
    }
  });
});

describe("storage-adapter source contract", () => {
  it("declares StorageAdapter typedef with required properties", () => {
    const source = readStorageAdapterSource();
    expect(source).toMatch(/@typedef\s+\{Object\}\s+StorageAdapter/);
    const props = extractAdapterProperties(source).sort();
    expect(props).toEqual(["delete", "get", "keys", "set"]);
  });

  it("extractAdapterProperties handles empty and whitespace sources", () => {
    expect(extractAdapterProperties("")).toEqual([]);
    expect(extractAdapterProperties("\n\t  ")).toEqual([]);
  });

  it("extractAdapterProperties ignores long strings without a typedef", () => {
    const longString = "x".repeat(100_000);
    expect(extractAdapterProperties(longString)).toEqual([]);
  });

  it("extractAdapterProperties handles very large sources", () => {
    const source = readStorageAdapterSource();
    const hugeSource = `${source}\n`.repeat(5000);
    const props = extractAdapterProperties(hugeSource).sort();
    expect(props).toEqual(["delete", "get", "keys", "set"]);
  });

  it("readStorageAdapterSource surfaces fs errors", () => {
    mockedFs.readFileSync.mockImplementationOnce(() => {
      throw new Error("read boom");
    });
    expect(() => readStorageAdapterSource()).toThrow(/read boom/);
  });

  it("extractAdapterProperties throws on non-string inputs", () => {
    const badInputs = [
      null,
      undefined,
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { 0: "x", length: 1 },
      { nested: { deeper: { deepest: true } } },
    ];

    for (const input of badInputs) {
      expect(() => extractAdapterProperties(input)).toThrow(TypeError);
    }
  });
});
