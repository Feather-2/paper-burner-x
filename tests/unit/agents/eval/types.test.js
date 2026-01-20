import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";

const typesModuleUrl = new URL("../../../../js/agents/eval/types.js", import.meta.url);
const typesModulePath = fileURLToPath(typesModuleUrl);

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn((...args) => actual.readFile(...args)),
  };
});

import { readFile } from "node:fs/promises";

const importTypesModule = () => import(typesModuleUrl.href);

const extractTypedefs = (source) => {
  if (typeof source !== "string") {
    throw new TypeError("Expected source to be a string");
  }

  const typedefs = new Map();
  const lines = source.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    const typedefMatch = line.match(/@typedef\s+\{.+\}\s+([A-Za-z0-9_]+)/);
    if (typedefMatch) {
      current = typedefMatch[1];
      if (!typedefs.has(current)) {
        typedefs.set(current, new Set());
      }
      continue;
    }

    const propertyMatch = line.match(/@property\s+\{.+\}\s+(\[[^\]]+\]|\S+)/);
    if (propertyMatch && current) {
      const rawName = propertyMatch[1];
      const name = rawName.replace(/^\[|\]$/g, "");
      typedefs.get(current).add(name);
    }
  }

  return typedefs;
};

const loadTypedefs = async () => {
  const source = await readFile(typesModulePath, "utf8");
  return extractTypedefs(source);
};

const expectPropertySet = async (typedefName, expectedProps) => {
  const typedefs = await loadTypedefs();
  const props = typedefs.get(typedefName);
  if (!props) {
    throw new Error(`Missing typedef: ${typedefName}`);
  }
  const actual = Array.from(props).sort();
  const expected = [...expectedProps].sort();
  expect(actual).toEqual(expected);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("eval/types module", () => {
  it("loads without runtime exports", async () => {
    const moduleNamespace = await importTypesModule();
    expect(Object.keys(moduleNamespace)).toEqual([]);
    expect("default" in moduleNamespace).toBe(false);
  });

  it("supports concurrent imports with consistent namespaces", async () => {
    const modules = await Promise.all(
      Array.from({ length: 8 }, () => importTypesModule())
    );

    for (const mod of modules) {
      expect(Object.keys(mod)).toEqual([]);
    }
  });

  it("supports rapid consecutive imports", async () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await importTypesModule());
    }

    for (const mod of results) {
      expect(Object.keys(mod)).toEqual([]);
    }
  });
});

describe("typedef extraction", () => {
  it("throws for non-string inputs and boundary numbers", () => {
    const invalidInputs = [
      null,
      undefined,
      [],
      {},
      { length: 0 },
      { 0: "a", length: 1 },
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
    ];

    for (const input of invalidInputs) {
      expect(() => extractTypedefs(input)).toThrow(TypeError);
    }
  });

  it("returns empty maps for empty and whitespace strings", () => {
    expect(extractTypedefs("").size).toBe(0);
    expect(extractTypedefs("   ").size).toBe(0);
  });

  it("accepts numeric-looking strings and ignores missing typedefs", () => {
    const result = extractTypedefs("123");
    expect(result.size).toBe(0);
  });

  it("parses deep nested types without dropping property names", () => {
    const deepType = "Record<string, {a:{b:{c:{d:{e:{f:string}}}}}}>";
    const content = [
      "/**",
      " * @typedef {Object} DeepNode",
      ` * @property {${deepType}} value`,
      " */",
    ].join("\n");

    const typedefs = extractTypedefs(content);
    expect(typedefs.get("DeepNode").has("value")).toBe(true);
  });

  it("handles long strings and huge generated docs", () => {
    const longString = "x".repeat(200000);
    expect(extractTypedefs(longString).size).toBe(0);

    const blocks = Array.from({ length: 2000 }, (_, index) =>
      [
        "/**",
        ` * @typedef {Object} Huge${index}`,
        ` * @property {string} id${index}`,
        " */",
        "",
      ].join("\n")
    );

    const hugeSource = blocks.join("\n");
    const typedefs = extractTypedefs(hugeSource);

    expect(typedefs.size).toBe(2000);
    expect(typedefs.get("Huge0").has("id0")).toBe(true);
    expect(typedefs.get("Huge1999").has("id1999")).toBe(true);
  });
});

describe("loadTypedefs", () => {
  it("reads and parses the eval types file", async () => {
    const typedefs = await loadTypedefs();
    expect(typedefs.size).toBeGreaterThan(0);
    expect(typedefs.has("EvalTask")).toBe(true);
  });

  it("propagates read errors from the filesystem", async () => {
    const mockedReadFile = vi.mocked(readFile);
    mockedReadFile.mockRejectedValueOnce(new Error("boom"));

    await expect(loadTypedefs()).rejects.toThrow("boom");
  });
});

const expectedTypedefs = {
  EvalTask: ["id", "description", "input", "expected", "graders", "metadata", "type"],
  Trial: [
    "taskId",
    "trialIndex",
    "transcript",
    "outcome",
    "graderResults",
    "passed",
    "score",
    "latencyMs",
    "metrics",
  ],
  Transcript: ["entries", "startTime", "endTime"],
  TranscriptEntry: ["type", "content", "timestamp", "metadata"],
  GraderConfig: ["type", "weight", "options"],
  GraderResult: ["graderType", "passed", "score", "reason", "issues"],
  EvalIssue: ["type", "severity", "message", "location"],
  TrialMetrics: ["turns", "toolCalls", "totalTokens", "timeToFirstToken"],
  EvalSuiteResult: ["suiteId", "tasks", "aggregated"],
  TaskResult: ["taskId", "trials", "passRate", "passAtK", "passExpK"],
  AggregatedMetrics: [
    "totalTasks",
    "passedTasks",
    "avgPassRate",
    "avgScore",
    "avgLatencyMs",
  ],
  EvalSuite: ["suiteId", "tasks", "metadata"],
  Grader: ["type", "grade"],
};

for (const [typedefName, expectedProps] of Object.entries(expectedTypedefs)) {
  describe(`${typedefName} typedef`, () => {
    it("declares the expected properties", async () => {
      await expectPropertySet(typedefName, expectedProps);
    });
  });
}
