import { vi } from "vitest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const sharedMock = vi.hoisted(() => ({
  isPlainObject: (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  },
  toNonEmptyString: (value) => {
    if (typeof value !== "string") return null;
    return value.trim().length > 0 ? value : null;
  },
}));

const injectionScannerMock = vi.hoisted(() => {
  function InjectionScanner() {
    this.scan = (text) => ({ clean: true, code: "CLEAN", detections: [] });
    this.sanitize = (text) => text;
  }

  const ScanResultCode = { CLEAN: "CLEAN", INJECTION: "INJECTION" };

  return { InjectionScanner, ScanResultCode };
});

vi.mock("../../../../js/agents/shared/index.js", () => sharedMock);
vi.mock("../../../../js/agents/sdk/injection-scanner.js", () => injectionScannerMock);

import SubagentRegistryDefault, {
  SubagentRegistry,
  validateOutput,
  quarantineOutput,
  DEFAULT_OUTPUT_SCHEMA,
  globalSubagentRegistry,
} from "../../../../js/agents/sdk/SubagentRegistry.js";
import { InjectionScanner } from "../../../../js/agents/sdk/injection-scanner.js";

const createDeepObject = (depth) => {
  let root = {};
  let current = root;

  for (let i = 0; i < depth; i++) {
    current.next = {};
    current = current.next;
  }

  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DEFAULT_OUTPUT_SCHEMA", () => {
  it("defines expected fields and limits", () => {
    expect(DEFAULT_OUTPUT_SCHEMA).toMatchObject({
      ok: { type: "boolean", required: true },
      summary: { type: "string", required: false, maxLength: 2000 },
      report: { type: "string", required: false, maxLength: 50000 },
      error: { type: "string", required: false, maxLength: 1000 },
    });
  });
});

describe("validateOutput", () => {
  it("rejects non-plain object outputs", () => {
    const samples = [null, undefined, [], "", 0, () => {}];

    for (const sample of samples) {
      const result = validateOutput(sample);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Subagent output must be a plain object");
      expect(result.sanitized).toEqual({ ok: false, error: "Invalid output format" });
    }
  });

  it("flags missing required fields for empty object", () => {
    const result = validateOutput({});

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: ok");
    expect(result.sanitized).toEqual({});
  });

  it("accepts numeric boundaries and empty values", () => {
    const deepNested = createDeepObject(20);
    const schema = {
      count: { type: "number", required: true },
      delta: { type: "number", required: true },
      big: { type: "number", required: true },
      label: { type: "string", required: true, maxLength: 10 },
      note: { type: "string", required: true, maxLength: 10 },
      items: { type: "array", required: true, maxItems: 3 },
      meta: { type: "object", required: true },
    };
    const output = {
      count: 0,
      delta: -1,
      big: Number.MAX_SAFE_INTEGER,
      label: "",
      note: "   ",
      items: [],
      meta: deepNested,
    };

    const result = validateOutput(output, schema);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.sanitized).toEqual(output);
  });

  it("flags type boundary mismatches", () => {
    const schema = {
      count: { type: "number", required: true },
      items: { type: "array", required: true },
      meta: { type: "object", required: true },
    };
    const output = {
      count: "1",
      items: {},
      meta: [],
    };

    const result = validateOutput(output, schema);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Field count: expected number, got string",
        "Field items: expected array, got object",
        "Field meta: expected object, got array",
      ])
    );
    expect(result.sanitized).toEqual({});
  });

  it("enforces array size limits", () => {
    const schema = {
      items: { type: "array", required: true, maxItems: 2 },
    };
    const output = { items: [1, 2, 3] };

    const result = validateOutput(output, schema);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Field items: exceeds maxItems 2 (got 3)");
    expect(result.sanitized).toEqual({});
  });

  it("rejects suspicious fields while keeping safe extras", () => {
    const output = Object.create(null);
    output.ok = true;
    output.extra = "safe";
    output._secret = "nope";
    output.constructor = "bad";
    output["__proto__"] = "bad";

    const result = validateOutput(output);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Suspicious field rejected: _secret",
        "Suspicious field rejected: constructor",
        "Suspicious field rejected: __proto__",
      ])
    );
    expect(result.sanitized).toMatchObject({ ok: true, extra: "safe" });
    expect(result.sanitized._secret).toBeUndefined();
  });

  it("flags overlong strings at resource limits", () => {
    const output = {
      ok: true,
      summary: "a".repeat(2001),
      report: "b".repeat(50001),
      error: "c".repeat(1001),
    };

    const result = validateOutput(output);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Field summary: exceeds maxLength 2000 (got 2001)",
        "Field report: exceeds maxLength 50000 (got 50001)",
        "Field error: exceeds maxLength 1000 (got 1001)",
      ])
    );
    expect(result.sanitized).toEqual({ ok: true });
  });
});

describe("quarantineOutput", () => {
  it("sanitizes injected text and records detections", () => {
    const scanner = {
      scan: vi.fn((text) =>
        text.includes("bad")
          ? { clean: false, code: "INJECTION", detections: [{ type: "INJECTION" }] }
          : { clean: true, code: "CLEAN", detections: [] }
      ),
      sanitize: vi.fn(() => "[sanitized]"),
    };
    vi.spyOn(Date, "now").mockReturnValue(12345);

    const result = quarantineOutput(
      { ok: true, summary: "bad content", report: "fine" },
      DEFAULT_OUTPUT_SCHEMA,
      "tester",
      scanner
    );

    expect(result.summary).toBe("[sanitized]");
    expect(result.report).toBe("fine");
    expect(result._quarantine).toMatchObject({
      valid: false,
      warnings: [],
      subagentType: "tester",
      timestamp: 12345,
    });
    expect(result._quarantine.injectionDetections).toEqual([
      { field: "summary", code: "INJECTION", detections: [{ type: "INJECTION" }] },
    ]);
    expect(scanner.scan).toHaveBeenCalledTimes(2);
    expect(scanner.scan).toHaveBeenCalledWith("bad content", { subagentType: "tester", field: "summary" });
  });

  it("skips scanning when scanner is missing methods", () => {
    const scanner = { scan: vi.fn() };

    const result = quarantineOutput(
      { ok: true, summary: "bad" },
      DEFAULT_OUTPUT_SCHEMA,
      "tester",
      scanner
    );

    expect(scanner.scan).not.toHaveBeenCalled();
    expect(result._quarantine.valid).toBe(true);
    expect(result._quarantine.injectionDetections).toBeUndefined();
  });

  it("propagates validation errors into warnings", () => {
    const output = { ok: "true", summary: 123, _secret: "hidden" };

    const result = quarantineOutput(output, DEFAULT_OUTPUT_SCHEMA, "tester", null);

    expect(result._quarantine.valid).toBe(false);
    expect(result._quarantine.warnings).toEqual(
      expect.arrayContaining([
        "Field ok: expected boolean, got string",
        "Field summary: expected string, got number",
        "Suspicious field rejected: _secret",
      ])
    );
  });

  it("handles non-plain output", () => {
    vi.spyOn(Date, "now").mockReturnValue(555);

    const result = quarantineOutput(null, DEFAULT_OUTPUT_SCHEMA, "tester", null);

    expect(result).toMatchObject({ ok: false, error: "Invalid output format" });
    expect(result._quarantine).toMatchObject({
      valid: false,
      warnings: ["Subagent output must be a plain object"],
      subagentType: "tester",
      timestamp: 555,
    });
  });

  it("handles rapid sequential calls without leaking detections", () => {
    const scanner = {
      scan: vi.fn((text) =>
        text === "clean" ? { clean: true, code: "CLEAN", detections: [] } : { clean: false, code: "INJECTION", detections: [{ type: "INJECTION" }] }
      ),
      sanitize: vi.fn((text) => `clean:${text}`),
    };

    const first = quarantineOutput({ ok: true, summary: "bad" }, DEFAULT_OUTPUT_SCHEMA, "tester", scanner);
    const second = quarantineOutput({ ok: true, summary: "clean" }, DEFAULT_OUTPUT_SCHEMA, "tester", scanner);

    expect(first._quarantine.valid).toBe(false);
    expect(first.summary).toBe("clean:bad");
    expect(second._quarantine.valid).toBe(true);
    expect(second.summary).toBe("clean");
  });
});

describe("SubagentRegistry", () => {
  it("wraps factory run output with quarantine", async () => {
    const scanner = new InjectionScanner();
    scanner.scan = vi.fn(() => ({ clean: true, code: "CLEAN", detections: [] }));
    scanner.sanitize = vi.fn((text) => text);

    const registry = new SubagentRegistry({ injectionScanner: scanner });
    const factory = vi.fn(async () => ({
      run: vi.fn(async () => ({ ok: true, summary: "hello" })),
    }));

    registry.register("Coder", factory, "writes code");

    const wrappedFactory = registry.getFactory("coder");
    const instance = await wrappedFactory();
    const result = await instance.run();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, summary: "hello" });
    expect(result._quarantine).toMatchObject({
      valid: true,
      warnings: [],
      subagentType: "coder",
    });
    expect(scanner.scan).toHaveBeenCalledWith("hello", { subagentType: "coder", field: "summary" });
  });

  it("respects quarantine toggle for new instances", async () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });
    const factory = vi.fn(async () => ({
      run: vi.fn(async () => ({ ok: true, summary: "raw" })),
    }));

    registry.register("Tester", factory, "desc");

    registry.setQuarantineEnabled(false);
    const factoryFn = registry.getFactory("tester");
    const instanceNoQuarantine = await factoryFn();
    const raw = await instanceNoQuarantine.run();

    expect(raw._quarantine).toBeUndefined();

    registry.setQuarantineEnabled(true);
    const instanceQuarantined = await factoryFn();
    const quarantined = await instanceQuarantined.run();

    expect(quarantined._quarantine).toBeDefined();
    expect(quarantined._quarantine.subagentType).toBe("tester");
  });

  it("returns instances without run unchanged", async () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });
    const factory = vi.fn(async () => ({ value: 42 }));

    registry.register("Plain", factory, "desc");

    const wrappedFactory = registry.getFactory("plain");
    const instance = await wrappedFactory();

    expect(instance).toEqual({ value: 42 });
  });

  it("returns null for unknown factory type", () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });

    expect(registry.getFactory("missing")).toBeNull();
  });

  it("lists available types with normalized names", () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });

    registry.register("Explore", async () => ({ run: async () => ({ ok: true }) }), "searches");
    registry.register("Coder", async () => ({ run: async () => ({ ok: true }) }), "writes code");

    expect(registry.getAvailableTypes()).toEqual([
      { type: "explore", description: "searches" },
      { type: "coder", description: "writes code" },
    ]);
  });

  it("builds catalog prompt when subagents exist", () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });

    expect(registry.getSubagentCatalogPrompt()).toBe("");

    registry.register("Coder", async () => ({ run: async () => ({ ok: true }) }), "writes code");
    const prompt = registry.getSubagentCatalogPrompt();

    expect(prompt).toContain("Subagents");
    expect(prompt).toContain("- **coder**: writes code");
  });

  it("uses custom schema during quarantine", async () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });
    const schema = {
      ok: { type: "boolean", required: true },
      count: { type: "number", required: true },
    };

    registry.register(
      "Counter",
      async () => ({
        run: async () => ({ ok: true, count: "1" }),
      }),
      "counts",
      schema
    );

    const wrappedFactory = registry.getFactory("counter");
    const instance = await wrappedFactory();
    const result = await instance.run();

    expect(result._quarantine.valid).toBe(false);
    expect(result._quarantine.warnings).toContain("Field count: expected number, got string");
  });

  it("handles concurrent runs without cross-contamination", async () => {
    const scanner = new InjectionScanner();
    scanner.scan = vi.fn((text) =>
      text === "bad"
        ? { clean: false, code: "INJECTION", detections: [{ type: "INJECTION" }] }
        : { clean: true, code: "CLEAN", detections: [] }
    );
    scanner.sanitize = vi.fn((text) => `clean:${text}`);

    const registry = new SubagentRegistry({ injectionScanner: scanner });
    registry.register("Worker", async () => ({
      run: async (summary) => ({ ok: true, summary }),
    }), "works");

    const wrappedFactory = registry.getFactory("worker");
    const instance = await wrappedFactory();

    const [badResult, goodResult] = await Promise.all([
      instance.run("bad"),
      instance.run("good"),
    ]);

    expect(badResult._quarantine.valid).toBe(false);
    expect(badResult.summary).toBe("clean:bad");
    expect(goodResult._quarantine.valid).toBe(true);
    expect(goodResult.summary).toBe("good");
  });

  it("throws when registering with non-string type", () => {
    const registry = new SubagentRegistry({ injectionScanner: new InjectionScanner() });

    expect(() => registry.register(null, () => ({}))).toThrow();
  });
});

describe("globalSubagentRegistry", () => {
  beforeEach(() => {
    globalSubagentRegistry._subagents.clear();
  });

  it("is a SubagentRegistry singleton", () => {
    expect(globalSubagentRegistry).toBeInstanceOf(SubagentRegistry);
    expect(globalSubagentRegistry.getAvailableTypes()).toEqual([]);
  });
});

describe("default export (SubagentRegistry)", () => {
  it("exports SubagentRegistry as default", () => {
    expect(SubagentRegistryDefault).toBe(SubagentRegistry);
  });
});
