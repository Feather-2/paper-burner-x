import { describe, it, expect, vi, beforeEach } from "vitest";

const toNonEmptyStringMock = vi.hoisted(() => vi.fn((value) => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}));

const sourceManagerState = vi.hoisted(() => {
  const instances = [];
  const normalizeSources = (sources) => {
    if (!Array.isArray(sources)) return [];
    return sources.map((source, index) => {
      if (source && typeof source === "object") {
        const rawId = source.sourceId ?? source.id ?? source.docId;
        const sourceId = rawId === undefined || rawId === null || String(rawId).trim() === ""
          ? `source_${index}`
          : String(rawId).trim();
        const rawName = source.name ?? source.title ?? sourceId;
        const name = rawName === undefined || rawName === null || String(rawName).trim() === ""
          ? sourceId
          : String(rawName).trim();
        const text = typeof source.text === "string"
          ? source.text
          : typeof source.sourceText === "string"
            ? source.sourceText
            : "";
        const size = Number.isFinite(source.size) ? source.size : text.length;
        return { sourceId, name, text, size, raw: source };
      }
      if (typeof source === "string") {
        const trimmed = source.trim();
        const sourceId = trimmed ? trimmed : `source_${index}`;
        return { sourceId, name: sourceId, text: "", size: 0, raw: source };
      }
      return { sourceId: `source_${index}`, name: `source_${index}`, text: "", size: 0, raw: source };
    });
  };

  class SourceManagerMock {
    constructor(sources = []) {
      this._sources = Array.isArray(sources) ? sources : [];
      this.syncSources = vi.fn((nextSources) => {
        if (Array.isArray(nextSources)) {
          this._sources = nextSources;
          return true;
        }
        if (nextSources == null) {
          return false;
        }
        this._sources = [];
        return true;
      });
      this.listSources = vi.fn(() => normalizeSources(this._sources));
      this.getSourceInfo = vi.fn((sourceId) => {
        const normalized = normalizeSources(this._sources);
        const found = normalized.find((item) => item.sourceId === sourceId);
        if (!found) return null;
        return {
          sourceId: found.sourceId,
          name: found.name,
          text: found.text,
        };
      });
      instances.push(this);
    }
  }

  return { instances, SourceManagerMock };
});

vi.mock("../../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: toNonEmptyStringMock,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/source-manager.js", () => ({
  default: sourceManagerState.SourceManagerMock,
}));

let handleGetSource;
let syncReportCitations;
let defaultExport;
let SourceManager;
let toNonEmptyString;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  sourceManagerState.instances.length = 0;

  ({ default: SourceManager } = await import("../../../../../../../js/agents/stages/deepsearch/source-manager.js"));
  ({ toNonEmptyString } = await import("../../../../../../../js/agents/shared/index.js"));
  ({ handleGetSource, syncReportCitations, default: defaultExport } = await import(
    "../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-citations.js"
  ));
});

function makeSource(overrides = {}) {
  return {
    sourceId: "s1",
    name: "Source 1",
    text: "text",
    ...overrides,
  };
}

function makeText(length, char = "x") {
  return char.repeat(length);
}

describe("handleGetSource", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace", "   "],
  ])("lists available sources when sourceId is %s", (_label, sourceId) => {
    const sources = [
      makeSource({ sourceId: "s1", name: "Doc 1", text: "abc" }),
      makeSource({ sourceId: "s2", name: "Doc 2", text: "longer" }),
    ];
    const state = { L0: { sources } };

    const result = handleGetSource({ sourceId }, {}, state);

    expect(result).toEqual({
      success: true,
      action: "get-source",
      available: [
        { sourceId: "s1", name: "Doc 1", length: 3 },
        { sourceId: "s2", name: "Doc 2", length: 6 },
      ],
      hint: "请指定 sourceId 查看原文",
    });
    expect(sourceManagerState.instances).toHaveLength(1);
    const manager = sourceManagerState.instances[0];
    expect(manager.syncSources).toHaveBeenCalledWith(sources);
    expect(manager.listSources).toHaveBeenCalledTimes(1);
    expect(toNonEmptyString).toHaveBeenCalledTimes(1);
    expect(toNonEmptyString).toHaveBeenCalledWith(sourceId);
  });

  it("uses context sourceManager and syncs updated sources across calls", () => {
    const manager = new SourceManager([makeSource({ sourceId: "s0", text: "init" })]);
    const stateA = { L0: { sources: [makeSource({ sourceId: "s2", name: "State A", text: "bbb" })] } };
    const deepSource = makeSource({
      sourceId: "deep",
      name: "Deep",
      text: "ccc",
      meta: { nested: { level: { arr: [{ value: "x" }] } } },
    });
    const stateB = { L0: { sources: [deepSource] } };

    const resultA = handleGetSource({ sourceId: "" }, { sourceManager: manager }, stateA);
    const resultB = handleGetSource({ sourceId: "" }, { sourceManager: manager }, stateB);

    expect(resultA.available).toEqual([{ sourceId: "s2", name: "State A", length: 3 }]);
    expect(resultB.available).toEqual([{ sourceId: "deep", name: "Deep", length: 3 }]);
    expect(sourceManagerState.instances).toHaveLength(1);
    expect(manager.syncSources).toHaveBeenCalledTimes(2);
  });

  it("returns error when source is not found", () => {
    const sources = [makeSource({ sourceId: "s1", name: "Doc 1", text: "abc" })];
    const state = { L0: { sources } };

    const result = handleGetSource({ sourceId: "missing" }, {}, state);

    expect(result).toEqual({ success: false, error: "Source not found: missing" });
    const manager = sourceManagerState.instances[0];
    expect(manager.getSourceInfo).toHaveBeenCalledWith("missing");
    expect(toNonEmptyString).toHaveBeenCalledTimes(1);
  });

  it("slices content using numeric string start/maxLength", () => {
    const sources = [makeSource({ sourceId: "s1", name: "Doc", text: "0123456789" })];
    const state = { L0: { sources } };

    const result = handleGetSource({ sourceId: "s1", start: "2", maxLength: "4" }, {}, state);

    expect(result).toMatchObject({
      success: true,
      action: "get-source",
      sourceId: "s1",
      name: "Doc",
      content: "2345",
      totalLength: 10,
      truncated: true,
    });
  });

  it("clamps maxLength to 10000 for huge text", () => {
    const hugeText = makeText(20050);
    const sources = [makeSource({ sourceId: "big", name: "Big", text: hugeText })];
    const state = { L0: { sources } };

    const result = handleGetSource({ sourceId: "big", maxLength: Number.MAX_SAFE_INTEGER }, {}, state);

    expect(result.content).toBe(hugeText.slice(0, 10000));
    expect(result.totalLength).toBe(20050);
    expect(result.truncated).toBe(true);
  });

  it("defaults start/maxLength when values are invalid", () => {
    const sources = [makeSource({ sourceId: "s1", name: "Doc", text: "hello" })];
    const state = { L0: { sources } };

    const result = handleGetSource({ sourceId: "s1", start: -1, maxLength: 0 }, {}, state);

    expect(result.content).toBe("hello");
    expect(result.totalLength).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it("handles start beyond content length", () => {
    const sources = [makeSource({ sourceId: "s1", name: "Doc", text: "abc" })];
    const state = { L0: { sources } };

    const result = handleGetSource({ sourceId: "s1", start: Number.MAX_SAFE_INTEGER }, {}, state);

    expect(result.content).toBe("");
    expect(result.totalLength).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it.each([
    ["empty array", []],
    ["empty object", {}],
    ["null", null],
    ["undefined", undefined],
  ])("returns empty available list when sources are %s", (_label, sources) => {
    const state = sources === undefined ? {} : { L0: { sources } };

    const result = handleGetSource({ sourceId: "" }, {}, state);

    expect(result.available).toEqual([]);
  });

  it("handles concurrent calls with a shared manager", async () => {
    const sources = [makeSource({ sourceId: "s1", name: "Doc", text: "abcdef" })];
    const manager = new SourceManager(sources);
    const state = { L0: { sources } };

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => handleGetSource({ sourceId: "s1", start: 0, maxLength: 2 }, { sourceManager: manager }, state)),
      Promise.resolve().then(() => handleGetSource({ sourceId: "s1", start: 2, maxLength: 3 }, { sourceManager: manager }, state)),
    ]);

    expect(first.content).toBe("ab");
    expect(second.content).toBe("cde");
    expect(manager.syncSources).toHaveBeenCalledTimes(2);
  });
});

describe("syncReportCitations", () => {
  it("assigns citations array and returns the same reference", () => {
    const report = {};
    const citations = [{ id: 1 }];

    const result = syncReportCitations(report, citations);

    expect(result).toBe(citations);
    expect(report.citations).toBe(citations);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["empty object", {}],
    ["number", 0],
  ])("returns empty array when citations is %s", (_label, citations) => {
    const report = {};

    const result = syncReportCitations(report, citations);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    expect(report.citations).toBe(result);
  });

  it("preserves empty array reference", () => {
    const report = {};
    const citations = [];

    const result = syncReportCitations(report, citations);

    expect(result).toBe(citations);
    expect(report.citations).toBe(citations);
  });

  it("keeps deep nested citations intact", () => {
    const report = {};
    const nested = { depth: { value: "x" } };
    const citations = [{ id: "c1", meta: nested }];

    const result = syncReportCitations(report, citations);

    expect(result).toBe(citations);
    expect(report.citations[0].meta).toBe(nested);
  });

  it("supports concurrent updates for different reports", async () => {
    const reportA = {};
    const reportB = {};
    const citationsA = [{ id: "a" }];
    const citationsB = [{ id: "b" }];

    const [resA, resB] = await Promise.all([
      Promise.resolve().then(() => syncReportCitations(reportA, citationsA)),
      Promise.resolve().then(() => syncReportCitations(reportB, citationsB)),
    ]);

    expect(resA).toBe(citationsA);
    expect(resB).toBe(citationsB);
    expect(reportA.citations).toBe(citationsA);
    expect(reportB.citations).toBe(citationsB);
  });

  it("uses the latest citations on rapid consecutive calls", () => {
    const report = {};
    const first = [{ id: "first" }];
    const second = [{ id: "second" }];

    const resultA = syncReportCitations(report, first);
    const resultB = syncReportCitations(report, second);

    expect(resultA).toBe(first);
    expect(resultB).toBe(second);
    expect(report.citations).toBe(second);
  });
});

describe("default export", () => {
  it("exposes handleGetSource and syncReportCitations", () => {
    expect(defaultExport.handleGetSource).toBe(handleGetSource);
    expect(defaultExport.syncReportCitations).toBe(syncReportCitations);
  });
});
