import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  createDMailTool,
  DMAIL_TOOL_DEFINITION,
} from "../../../../../js/agents/runtime/tools/DMailTool.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createDMailTool", () => {
  it("creates a DMail signal and notifies logger and emit", async () => {
    const now = vi.fn(() => 1690000000000);
    const handler = createDMailTool({ now });
    const logger = { info: vi.fn() };
    const emit = vi.fn();

    const result = await handler(
      {
        correction: "Fix the prior assumption.",
        supersede_from: 2,
        supersede_to: 4,
        severity: "major",
      },
      { logger, emit }
    );

    expect(result.ok).toBe(true);
    expect(result.dmail).toEqual({
      correction: "Fix the prior assumption.",
      supersedeRange: { from: 2, to: 4 },
      severity: "major",
      timestamp: 1690000000000,
    });
    expect(logger.info).toHaveBeenCalledWith("DMail sent (soft backtrack)", result.dmail);
    expect(emit).toHaveBeenCalledWith("agent:dmailSent", result.dmail);
    expect(now).toHaveBeenCalledTimes(1);
  });

  it("defaults severity to minor when unset, null, or empty string", async () => {
    const now = vi.fn(() => 1000);
    const handler = createDMailTool({ now });
    const cases = [undefined, null, ""];

    for (const severity of cases) {
      const result = await handler({ correction: "Ok", severity }, {});

      expect(result.ok).toBe(true);
      expect(result.dmail.severity).toBe("minor");
      expect(result.dmail.supersedeRange).toBe(null);
      expect(result.dmail.timestamp).toBe(1000);
    }

    expect(now).toHaveBeenCalledTimes(cases.length);
  });

  it("rejects missing or blank correction values", async () => {
    const handler = createDMailTool({ now: () => 1 });
    const cases = [
      undefined,
      null,
      {},
      { correction: undefined },
      { correction: null },
      { correction: "" },
      { correction: "   " },
      { correction: [] },
      { correction: {} },
    ];

    for (const args of cases) {
      const result = await handler(args, {});
      expect(result).toEqual({
        ok: false,
        error: "correction is required and must be a non-empty string.",
      });
    }
  });

  it("rejects invalid supersede_from values", async () => {
    const handler = createDMailTool({ now: () => 1 });
    const invalidValues = [-1, 1.2, "3", { 0: 1, length: 1 }];

    for (const value of invalidValues) {
      const result = await handler({ correction: "Ok", supersede_from: value }, {});
      expect(result).toEqual({
        ok: false,
        error: "supersede_from must be a non-negative integer.",
      });
    }
  });

  it("rejects invalid supersede_to values", async () => {
    const handler = createDMailTool({ now: () => 1 });
    const invalidValues = [-1, 2.5, "4", { 0: 2, length: 1 }];

    for (const value of invalidValues) {
      const result = await handler({ correction: "Ok", supersede_to: value }, {});
      expect(result).toEqual({
        ok: false,
        error: "supersede_to must be a non-negative integer.",
      });
    }
  });

  it("rejects supersede ranges where from is greater than to", async () => {
    const handler = createDMailTool({ now: () => 1 });

    const result = await handler(
      { correction: "Ok", supersede_from: 5, supersede_to: 4 },
      {}
    );

    expect(result).toEqual({
      ok: false,
      error: "supersede_from must be less than or equal to supersede_to.",
    });
  });

  it("accepts boundary turn values including 0 and MAX_SAFE_INTEGER", async () => {
    const now = vi.fn(() => 42);
    const handler = createDMailTool({ now });

    const result = await handler(
      {
        correction: "Ok",
        supersede_from: 0,
        supersede_to: Number.MAX_SAFE_INTEGER,
      },
      {}
    );

    expect(result.ok).toBe(true);
    expect(result.dmail.supersedeRange).toEqual({
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
    });
    expect(result.dmail.severity).toBe("minor");
  });

  it("creates partial supersede ranges with null bounds", async () => {
    const handler = createDMailTool({ now: () => 7 });

    const fromOnly = await handler({ correction: "Ok", supersede_from: 3 }, {});
    const toOnly = await handler({ correction: "Ok", supersede_to: 8 }, {});

    expect(fromOnly.ok).toBe(true);
    expect(fromOnly.dmail.supersedeRange).toEqual({ from: 3, to: null });
    expect(toOnly.ok).toBe(true);
    expect(toOnly.dmail.supersedeRange).toEqual({ from: null, to: 8 });
  });

  it("rejects invalid severity values", async () => {
    const handler = createDMailTool({ now: () => 1 });
    const cases = [
      { value: "urgent", message: "Invalid severity: urgent. Use minor, major, or critical." },
      { value: {}, message: "Invalid severity: [object Object]. Use minor, major, or critical." },
    ];

    for (const { value, message } of cases) {
      const result = await handler({ correction: "Ok", severity: value }, {});
      expect(result).toEqual({ ok: false, error: message });
    }
  });

  it("falls back to Date.now when now option is not a function", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(555);
    const handler = createDMailTool({ now: "nope" });

    const result = await handler({ correction: "Ok" }, {});

    expect(result.ok).toBe(true);
    expect(result.dmail.timestamp).toBe(555);
    expect(dateSpy).toHaveBeenCalledTimes(1);
    dateSpy.mockRestore();
  });

  it("handles concurrent calls without shared state", async () => {
    let stamp = 2000;
    const now = vi.fn(() => stamp++);
    const handler = createDMailTool({ now });

    const firstCall = handler({ correction: "First", supersede_from: 0 }, {});
    const secondCall = handler({ correction: "Second", supersede_to: 1, severity: "critical" }, {});
    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    expect(firstResult.dmail.correction).toBe("First");
    expect(secondResult.dmail.correction).toBe("Second");
    expect(new Set([firstResult.dmail.timestamp, secondResult.dmail.timestamp]).size).toBe(2);
    expect(now).toHaveBeenCalledTimes(2);
  });

  it("handles rapid consecutive calls independently", async () => {
    let stamp = 3000;
    const now = vi.fn(() => stamp++);
    const handler = createDMailTool({ now });

    const first = await handler({ correction: "Alpha" }, {});
    const second = await handler({ correction: "Beta", severity: "critical" }, {});

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.dmail.correction).toBe("Alpha");
    expect(second.dmail.correction).toBe("Beta");
    expect(first.dmail.timestamp).not.toBe(second.dmail.timestamp);
  });

  it("accepts long correction strings", async () => {
    const longString = "a".repeat(100000);
    const handler = createDMailTool({ now: () => 9 });

    const result = await handler({ correction: longString }, {});

    expect(result.ok).toBe(true);
    expect(result.dmail.correction.length).toBe(longString.length);
  });

  it("handles huge corrections from mocked files with deep nested extras", async () => {
    const hugeString = "b".repeat(1024 * 1024);
    const deepNested = {
      level0: {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deep",
              },
            },
          },
        },
      },
    };

    readFileSync.mockReturnValue(hugeString);
    const handler = createDMailTool({ now: () => 11 });

    const result = await handler(
      {
        correction: readFileSync("/tmp/huge.txt", "utf8"),
        severity: "minor",
        extra: {
          note: "c".repeat(1000),
          deepNested,
        },
      },
      {}
    );

    expect(readFileSync).toHaveBeenCalledWith("/tmp/huge.txt", "utf8");
    expect(result.ok).toBe(true);
    expect(result.dmail.correction).toBe(hugeString);
    expect(result.dmail.supersedeRange).toBe(null);
    expect(result.dmail.extra).toBeUndefined();
  });
});

describe("DMAIL_TOOL_DEFINITION", () => {
  it("exposes the expected schema shape", () => {
    expect(DMAIL_TOOL_DEFINITION).toMatchObject({
      name: "DMail",
      description: expect.any(String),
      parameters: {
        type: "object",
        required: ["correction"],
      },
    });
  });

  it("defines severity enum values with default minor", () => {
    expect(DMAIL_TOOL_DEFINITION.parameters.properties.severity).toEqual({
      type: "string",
      enum: ["minor", "major", "critical"],
      default: "minor",
      description: "Severity of the mistake: minor, major, or critical.",
    });
  });
});
