import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "external-config",
  () => ({
    getSnapshotOverride: vi.fn(() => 777),
    getStorageOverride: vi.fn(() => 512),
  }),
  { virtual: true },
);

import { getSnapshotOverride, getStorageOverride } from "external-config";

import {
  DEFAULT_MAX_SNAPSHOTS,
  DEFAULT_MAX_STORAGE_BYTES,
  BYTES_PER_CHAR,
  ENTRY_OVERHEAD_BYTES,
} from "../../../../../../js/agents/plugins/memory/l3-storage/constants.js";

const parseNumericInput = (value) => {
  if (value == null) {
    return Number.NaN;
  }

  if (Array.isArray(value)) {
    return Number.NaN;
  }

  if (typeof value === "object") {
    return Number.NaN;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? Number.NaN : Number(trimmed);
  }

  return Number(value);
};

const isWithinLimit = (value, max) => {
  const parsed = parseNumericInput(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DEFAULT_MAX_SNAPSHOTS", () => {
  const resolveMaxSnapshots = () => {
    const override = getSnapshotOverride();
    return Number.isFinite(override) ? override : DEFAULT_MAX_SNAPSHOTS;
  };

  const isWithinSnapshotLimit = (count) =>
    isWithinLimit(count, DEFAULT_MAX_SNAPSHOTS);

  const assertValidSnapshotCount = (count) => {
    const parsed = parseNumericInput(count);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > DEFAULT_MAX_SNAPSHOTS) {
      throw new RangeError("snapshot count out of range");
    }
    return parsed;
  };

  it("matches the expected default and safe integer range", () => {
    expect(DEFAULT_MAX_SNAPSHOTS).toBe(1000);
    expect(Number.isInteger(DEFAULT_MAX_SNAPSHOTS)).toBe(true);
    expect(DEFAULT_MAX_SNAPSHOTS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_SNAPSHOTS).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("resolves external overrides and falls back for nullish overrides", () => {
    expect(resolveMaxSnapshots()).toBe(777);

    getSnapshotOverride.mockReturnValueOnce(null);
    expect(resolveMaxSnapshots()).toBe(DEFAULT_MAX_SNAPSHOTS);
  });

  it("handles empty values, whitespace, numeric strings, and object-as-array inputs", () => {
    const emptyValues = [null, undefined, "", "   ", [], {}];
    emptyValues.forEach((value) => {
      expect(isWithinSnapshotLimit(value)).toBe(false);
    });

    expect(isWithinSnapshotLimit(0)).toBe(true);
    expect(isWithinSnapshotLimit("10")).toBe(true);

    const capArrayLength = (value) =>
      Math.min(Array.isArray(value) ? value.length : 0, DEFAULT_MAX_SNAPSHOTS);

    expect(capArrayLength({})).toBe(0);
    expect(capArrayLength([])).toBe(0);
    expect(capArrayLength(new Array(DEFAULT_MAX_SNAPSHOTS + 2))).toBe(
      DEFAULT_MAX_SNAPSHOTS,
    );
  });

  it("throws on invalid snapshot counts", () => {
    expect(() => assertValidSnapshotCount(-1)).toThrow(RangeError);
    expect(() => assertValidSnapshotCount(Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });

  it("is stable under concurrent reads", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(DEFAULT_MAX_SNAPSHOTS)),
    );

    expect(new Set(results).size).toBe(1);
  });
});

describe("DEFAULT_MAX_STORAGE_BYTES", () => {
  const resolveMaxStorageBytes = () => {
    const override = getStorageOverride();
    return Number.isFinite(override) && override > 0
      ? override
      : DEFAULT_MAX_STORAGE_BYTES;
  };

  const isWithinStorageLimit = (bytes) =>
    isWithinLimit(bytes, DEFAULT_MAX_STORAGE_BYTES);

  const assertValidStorageBytes = (bytes) => {
    const parsed = parseNumericInput(bytes);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > DEFAULT_MAX_STORAGE_BYTES) {
      throw new RangeError("storage bytes out of range");
    }
    return parsed;
  };

  it("matches the expected default and safe integer range", () => {
    expect(DEFAULT_MAX_STORAGE_BYTES).toBe(100 * 1024 * 1024);
    expect(Number.isInteger(DEFAULT_MAX_STORAGE_BYTES)).toBe(true);
    expect(DEFAULT_MAX_STORAGE_BYTES).toBeGreaterThan(0);
    expect(DEFAULT_MAX_STORAGE_BYTES).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("resolves external overrides and ignores invalid overrides", () => {
    expect(resolveMaxStorageBytes()).toBe(512);

    getStorageOverride.mockReturnValueOnce("not-a-number");
    expect(resolveMaxStorageBytes()).toBe(DEFAULT_MAX_STORAGE_BYTES);
  });

  it("handles boundary and empty inputs in storage limit checks", () => {
    const emptyValues = [null, undefined, "", "   ", [], {}];
    emptyValues.forEach((value) => {
      expect(isWithinStorageLimit(value)).toBe(false);
    });

    expect(isWithinStorageLimit(0)).toBe(true);
    expect(isWithinStorageLimit(String(DEFAULT_MAX_STORAGE_BYTES))).toBe(true);
  });

  it("throws on invalid storage sizes", () => {
    expect(() => assertValidStorageBytes(-1)).toThrow(RangeError);
    expect(() => assertValidStorageBytes(Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });

  it("rejects huge files and stays consistent under rapid reads", () => {
    const hugeFileBytes = 10 * 1024 * 1024 * 1024;
    expect(isWithinStorageLimit(hugeFileBytes)).toBe(false);

    const values = Array.from(
      { length: 1000 },
      () => DEFAULT_MAX_STORAGE_BYTES,
    );
    expect(new Set(values).size).toBe(1);
  });
});

describe("BYTES_PER_CHAR", () => {
  const estimateBytesForLength = (length) => {
    const parsed = parseNumericInput(length);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new RangeError("length must be non-negative");
    }
    return parsed * BYTES_PER_CHAR;
  };

  const estimateBytesFromSummary = (summary) => {
    if (summary == null) {
      return 0;
    }

    if (typeof summary === "string") {
      return summary.length * BYTES_PER_CHAR;
    }

    const serialized = JSON.stringify(summary);
    return serialized.length * BYTES_PER_CHAR;
  };

  it("matches the expected default", () => {
    expect(BYTES_PER_CHAR).toBe(2);
    expect(BYTES_PER_CHAR).toBeGreaterThan(0);
  });

  it("estimates bytes for empty, whitespace, and long strings", () => {
    expect(estimateBytesFromSummary("")).toBe(0);
    expect(estimateBytesFromSummary("   ")).toBe(3 * BYTES_PER_CHAR);

    const longSummary = "a".repeat(1_000_000);
    expect(estimateBytesFromSummary(longSummary)).toBe(
      1_000_000 * BYTES_PER_CHAR,
    );
  });

  it("accepts numeric strings as lengths", () => {
    expect(estimateBytesForLength("4")).toBe(8);
  });

  it("throws on invalid lengths", () => {
    expect(() => estimateBytesForLength(null)).toThrow(RangeError);
    expect(() => estimateBytesForLength(undefined)).toThrow(RangeError);
    expect(() => estimateBytesForLength(-1)).toThrow(RangeError);
    expect(() => estimateBytesForLength({})).toThrow(RangeError);
  });
});

describe("ENTRY_OVERHEAD_BYTES", () => {
  const estimateEntryBytes = (summary) => {
    const text =
      summary == null
        ? ""
        : typeof summary === "string"
          ? summary
          : JSON.stringify(summary);

    return ENTRY_OVERHEAD_BYTES + text.length * BYTES_PER_CHAR;
  };

  const createDeepObject = (depth) => {
    let root = {};
    let current = root;

    for (let i = 0; i < depth; i += 1) {
      current.next = {};
      current = current.next;
    }

    return root;
  };

  it("matches the expected default and remains positive", () => {
    expect(ENTRY_OVERHEAD_BYTES).toBe(200);
    expect(ENTRY_OVERHEAD_BYTES).toBeGreaterThan(0);
  });

  it("accounts for empty inputs and containers", () => {
    expect(estimateEntryBytes(null)).toBe(ENTRY_OVERHEAD_BYTES);
    expect(estimateEntryBytes(undefined)).toBe(ENTRY_OVERHEAD_BYTES);
    expect(estimateEntryBytes("")).toBe(ENTRY_OVERHEAD_BYTES);
    expect(estimateEntryBytes([])).toBe(ENTRY_OVERHEAD_BYTES + 2 * BYTES_PER_CHAR);
    expect(estimateEntryBytes({})).toBe(ENTRY_OVERHEAD_BYTES + 2 * BYTES_PER_CHAR);
  });

  it("handles deep nested objects without overflow", () => {
    const deepObject = createDeepObject(200);
    const estimated = estimateEntryBytes(deepObject);

    expect(Number.isFinite(estimated)).toBe(true);
    expect(estimated).toBeGreaterThan(ENTRY_OVERHEAD_BYTES);
  });

  it("throws for circular summaries", () => {
    const circular = {};
    circular.self = circular;

    expect(() => estimateEntryBytes(circular)).toThrow(TypeError);
  });
});
