// Adds unit tests for sandbox constants with boundary and concurrency coverage.
// Covers capabilities, presets, resource limits, and default export lookups.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock(
  "virtual-sandbox-config",
  () => ({
    getPresetName: vi.fn(() => "SKILL"),
    getLimitName: vi.fn(() => "STANDARD"),
    getCapabilityName: vi.fn(() => "FETCH"),
    getInvalidName: vi.fn(() => "UNKNOWN"),
  }),
  { virtual: true }
);

import sandboxConstants, {
  SandboxCapability,
  SandboxPreset,
  ResourceLimits,
} from "../../../../../js/agents/core/sandbox/constants.js";

const LONG_STRING = "x".repeat(1024 * 1024);
const DEEP_NESTED = (() => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < 200; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
})();

const INVALID_BOUNDARY_VALUES = [
  null,
  undefined,
  "",
  " ",
  "   ",
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  [],
  {},
  LONG_STRING,
  DEEP_NESTED,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SandboxCapability", () => {
  it("defines expected capability strings", () => {
    expect(SandboxCapability).toEqual({
      CONSOLE: "console",
      STATE: "state",
      EMIT: "emit",
      FETCH: "fetch",
      FS_READ: "fs:read",
      FS_WRITE: "fs:write",
      EXEC: "exec",
    });
  });

  it("exposes unique, non-empty, trimmed values", () => {
    const values = Object.values(SandboxCapability);
    expect(new Set(values).size).toBe(values.length);

    values.forEach((value) => {
      expect(typeof value).toBe("string");
      expect(value).not.toBe("");
      expect(value.trim()).toBe(value);
    });
  });

  it("does not include invalid or boundary values", () => {
    const values = Object.values(SandboxCapability);
    const invalidValues = [
      ...INVALID_BOUNDARY_VALUES,
      "console ",
      "Console",
      "FETCH",
    ];

    invalidValues.forEach((value) => {
      expect(values.includes(value)).toBe(false);
    });
  });

  it("supports concurrent reads without mutation", async () => {
    const reads = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve(SandboxCapability.EXEC))
    );

    reads.forEach((value) => {
      expect(value).toBe(SandboxCapability.EXEC);
    });
  });
});

describe("SandboxPreset", () => {
  it("groups capabilities into expected presets", () => {
    expect(SandboxPreset.MINIMAL).toEqual([SandboxCapability.CONSOLE]);
    expect(SandboxPreset.SKILL).toEqual([
      SandboxCapability.CONSOLE,
      SandboxCapability.STATE,
      SandboxCapability.EMIT,
    ]);
    expect(SandboxPreset.NETWORK).toEqual([
      SandboxCapability.CONSOLE,
      SandboxCapability.STATE,
      SandboxCapability.EMIT,
      SandboxCapability.FETCH,
    ]);
    expect(SandboxPreset.TRUSTED).toEqual(Object.values(SandboxCapability));
  });

  it("excludes high-risk capabilities from minimal/skill/network", () => {
    const restrictedCapabilities = [
      SandboxCapability.FS_WRITE,
      SandboxCapability.EXEC,
    ];

    restrictedCapabilities.forEach((capability) => {
      expect(SandboxPreset.MINIMAL).not.toContain(capability);
      expect(SandboxPreset.SKILL).not.toContain(capability);
      expect(SandboxPreset.NETWORK).not.toContain(capability);
    });
  });

  it("resolves preset names from mocked external config", async () => {
    const { getPresetName, getInvalidName } = await import(
      "virtual-sandbox-config"
    );

    expect(SandboxPreset[getPresetName()]).toEqual(SandboxPreset.SKILL);
    expect(SandboxPreset[getInvalidName()]).toBeUndefined();
  });

  it("returns undefined for invalid or boundary preset keys", () => {
    const invalidKeys = [...INVALID_BOUNDARY_VALUES, "0", "unknown"];

    invalidKeys.forEach((key) => {
      expect(SandboxPreset[key]).toBeUndefined();
    });
  });

  it("ignores oversized or deep inputs when checking membership", () => {
    expect(SandboxPreset.TRUSTED.includes(LONG_STRING)).toBe(false);
    expect(SandboxPreset.TRUSTED.includes(DEEP_NESTED)).toBe(false);
    expect(SandboxPreset.TRUSTED.includes([])).toBe(false);
    expect(SandboxPreset.TRUSTED.includes({})).toBe(false);
  });

  it("returns consistent arrays during concurrent reads", async () => {
    const reads = await Promise.all(
      Array.from({ length: 25 }, () =>
        Promise.resolve([...SandboxPreset.NETWORK])
      )
    );

    reads.forEach((preset) => {
      expect(preset).toEqual(SandboxPreset.NETWORK);
    });
  });
});

describe("ResourceLimits", () => {
  it("defines numeric limit presets", () => {
    expect(ResourceLimits).toEqual({
      LIGHT: {
        memoryLimit: 1 * 1024 * 1024,
        timeoutMs: 1000,
        maxStackDepth: 100,
      },
      STANDARD: {
        memoryLimit: 8 * 1024 * 1024,
        timeoutMs: 30000,
        maxStackDepth: 500,
      },
      HEAVY: {
        memoryLimit: 64 * 1024 * 1024,
        timeoutMs: 300000,
        maxStackDepth: 1000,
      },
    });
  });

  it("uses positive numeric values within safe bounds", () => {
    Object.values(ResourceLimits).forEach((limit) => {
      expect(limit.memoryLimit).toBeGreaterThan(0);
      expect(limit.timeoutMs).toBeGreaterThan(0);
      expect(limit.maxStackDepth).toBeGreaterThan(0);

      expect(limit.memoryLimit).toBeLessThan(Number.MAX_SAFE_INTEGER);
      expect(limit.timeoutMs).toBeLessThan(Number.MAX_SAFE_INTEGER);
      expect(limit.maxStackDepth).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
  });

  it("keeps numeric values as numbers, not strings", () => {
    Object.values(ResourceLimits).forEach((limit) => {
      expect(typeof limit.memoryLimit).toBe("number");
      expect(typeof limit.timeoutMs).toBe("number");
      expect(typeof limit.maxStackDepth).toBe("number");

      expect(limit.memoryLimit).not.toBe(String(limit.memoryLimit));
      expect(limit.timeoutMs).not.toBe(String(limit.timeoutMs));
      expect(limit.maxStackDepth).not.toBe(String(limit.maxStackDepth));
    });
  });

  it("returns undefined for invalid or boundary limit keys", () => {
    const invalidKeys = [
      ...INVALID_BOUNDARY_VALUES,
      "0",
      "unknown",
      "STANDARD ",
    ];

    invalidKeys.forEach((key) => {
      expect(ResourceLimits[key]).toBeUndefined();
    });
  });

  it("supports concurrent reads without mutation", async () => {
    const reads = await Promise.all(
      Array.from({ length: 40 }, () =>
        Promise.resolve(ResourceLimits.HEAVY.timeoutMs)
      )
    );

    reads.forEach((value) => {
      expect(value).toBe(ResourceLimits.HEAVY.timeoutMs);
    });
  });

  it("resolves limit names from mocked external config", async () => {
    const { getLimitName, getInvalidName } = await import(
      "virtual-sandbox-config"
    );

    expect(ResourceLimits[getLimitName()]).toEqual(ResourceLimits.STANDARD);
    expect(ResourceLimits[getInvalidName()]).toBeUndefined();
  });
});

describe("default export", () => {
  it("exposes named exports", () => {
    expect(sandboxConstants.SandboxCapability).toBe(SandboxCapability);
    expect(sandboxConstants.SandboxPreset).toBe(SandboxPreset);
    expect(sandboxConstants.ResourceLimits).toBe(ResourceLimits);
  });

  it("does not include unexpected keys", () => {
    expect(Object.keys(sandboxConstants).sort()).toEqual(
      ["ResourceLimits", "SandboxCapability", "SandboxPreset"].sort()
    );
  });
});
