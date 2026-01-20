import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
const createLoggerMock = vi.hoisted(() => vi.fn(() => loggerMock));
const renderReportTemplateMock = vi.hoisted(() => vi.fn(() => "REPORT_TEMPLATE"));
const generateReportMock = vi.hoisted(() => vi.fn());
const toNonEmptyStringMock = vi.hoisted(() => vi.fn());
const getReportProgressMock = vi.hoisted(() => vi.fn());
const prepareReportForSubmitMock = vi.hoisted(() => vi.fn());
const reviewReportMarkdownMock = vi.hoisted(() => vi.fn());
const handleGetSourceMock = vi.hoisted(() => vi.fn());
const syncReportCitationsMock = vi.hoisted(() => vi.fn());
const buildReportOutlineMock = vi.hoisted(() => vi.fn());
const countContentCharsMock = vi.hoisted(() => vi.fn());
const renderSectionsMarkdownMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../../js/agents/stages/deepsearch/report/report-generator.js", () => ({
  generateReport: generateReportMock,
}));

vi.mock("../../../../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: toNonEmptyStringMock,
  createLogger: createLoggerMock,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/report/report-postprocess.js", () => ({
  getReportProgress: getReportProgressMock,
  prepareReportForSubmit: prepareReportForSubmitMock,
  reviewReportMarkdown: reviewReportMarkdownMock,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-citations.js", () => ({
  handleGetSource: handleGetSourceMock,
  syncReportCitations: syncReportCitationsMock,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-formatting.js", () => ({
  buildReportOutline: buildReportOutlineMock,
  countContentChars: countContentCharsMock,
  renderSectionsMarkdown: renderSectionsMarkdownMock,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/tools/write-report/report-template.js", () => ({
  renderReportTemplate: renderReportTemplateMock,
}));

import { definition, handler } from "../../../../../../../js/agents/stages/deepsearch/tools/write-report/handler.js";

const makeReport = (overrides = {}) => ({
  markdown: "",
  draftMarkdown: "",
  sections: [],
  citations: [],
  history: [],
  version: 0,
  ...overrides,
});

const makeState = (overrides = {}) => {
  const base = {
    iteration: 10,
    L1: {
      readDocIds: ["doc1", "doc2", "doc3"],
      gaps: ["gap1", "gap2"],
      claims: [],
      evidenceLedger: [],
      report: undefined,
    },
    L2: { retrievedChunkIds: [] },
    L0: { sources: [] },
    todos: [{ status: "done" }],
    userConfig: { mode: "wider" },
    taskGoal: "goal",
    globalConfig: {},
  };

  return {
    ...base,
    ...overrides,
    L1: { ...base.L1, ...(overrides.L1 || {}) },
    L2: { ...base.L2, ...(overrides.L2 || {}) },
    L0: { ...base.L0, ...(overrides.L0 || {}) },
    userConfig: { ...base.userConfig, ...(overrides.userConfig || {}) },
    globalConfig: { ...base.globalConfig, ...(overrides.globalConfig || {}) },
  };
};

const makeSharedContext = (overrides = {}) => ({
  search: vi.fn((query) => {
    if (query === "finding_claim") return [{}, {}, {}, {}, {}];
    if (query === "finding_gap") return [];
    if (query === "finding_conflict") return [];
    return [];
  }),
  searchAll: vi.fn(() => []),
  getDetail: vi.fn(() => null),
  buildBlackboardPrompt: vi.fn(() => "blackboard"),
  ...overrides,
});

const makeContext = ({ state, sharedContext, emit, stageApi } = {}) => ({
  state: state === undefined ? makeState() : state,
  sharedContext: sharedContext === undefined ? makeSharedContext() : sharedContext,
  emit: emit === undefined ? vi.fn() : emit,
  stageApi: stageApi === undefined ? {} : stageApi,
});

let dateNowSpy;

beforeEach(() => {
  dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);

  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  createLoggerMock.mockClear();

  generateReportMock.mockReset();
  toNonEmptyStringMock.mockReset();
  getReportProgressMock.mockReset();
  prepareReportForSubmitMock.mockReset();
  reviewReportMarkdownMock.mockReset();
  handleGetSourceMock.mockReset();
  syncReportCitationsMock.mockReset();
  buildReportOutlineMock.mockReset();
  countContentCharsMock.mockReset();
  renderSectionsMarkdownMock.mockReset();

  toNonEmptyStringMock.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });

  getReportProgressMock.mockImplementation((report) => ({
    wordCount: report?.markdown ? report.markdown.length : 0,
    hint: "progress-hint",
    isReady: (report?.markdown || "").length >= 10,
  }));

  prepareReportForSubmitMock.mockImplementation((markdown) => ({
    markdown,
    validation: { valid: true, issues: [], wordCount: markdown.length },
    review: { ok: true },
  }));

  reviewReportMarkdownMock.mockImplementation((markdown) => ({
    markdown,
    fixed: false,
    issues: [],
    originalLength: markdown.length,
    fixedLength: markdown.length,
  }));

  handleGetSourceMock.mockImplementation(() => ({ success: true, source: "mock-source" }));
  syncReportCitationsMock.mockImplementation(() => {});

  buildReportOutlineMock.mockImplementation((sections) => ({
    outline: Array.isArray(sections) ? sections.map((section) => section.title) : [],
    totalSections: Array.isArray(sections) ? sections.length : 0,
    filledSections: Array.isArray(sections) ? sections.filter((section) => section.content).length : 0,
    emptySections: Array.isArray(sections) ? sections.filter((section) => !section.content).length : 0,
  }));

  countContentCharsMock.mockImplementation((content) => (typeof content === "string" ? content.length : 0));

  renderSectionsMarkdownMock.mockImplementation((sections, options = {}) => {
    if (!Array.isArray(sections)) return "";
    const placeholder = options.emptyPlaceholder || "";
    return sections.map((section) => `# ${section.title}\n${section.content || placeholder}`).join("\n\n");
  });

  generateReportMock.mockImplementation(() => ({
    markdown: "generated report",
    sections: [{ title: "Summary", content: "ok", sectionId: "sec1" }],
    citations: [{ id: "c1" }],
  }));
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

describe("definition", () => {
  it("exposes stable metadata and template", () => {
    expect(definition).toEqual(expect.objectContaining({
      name: "write-report",
      layer: 0,
      activation: expect.objectContaining({
        keywords: expect.arrayContaining(["报告", "report"]),
      }),
      parameters: expect.objectContaining({
        action: expect.any(String),
        content: expect.any(String),
        mode: expect.any(String),
      }),
      reportTemplate: "REPORT_TEMPLATE",
    }));
  });
});

describe("handler", () => {
  it("returns error for unknown action", async () => {
    const result = await handler({ action: "mystery" }, makeContext());

    expect(result).toEqual({ success: false, error: "Unknown action: mystery" });
  });

  it("returns content with progress for get-content", async () => {
    const report = makeReport({ markdown: "abc", version: 2 });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({ action: "get-content", mode: "quick" }, context);

    expect(result).toMatchObject({
      success: true,
      action: "get-content",
      markdown: "abc",
      wordCount: 3,
      version: 2,
      hint: "progress-hint",
    });
    expect(getReportProgressMock).toHaveBeenCalledWith(report, "quick", state);
  });

  it("returns error when sharedContext is missing for get-findings", async () => {
    const context = makeContext({ sharedContext: null });

    const result = await handler({ action: "get-findings" }, context);

    expect(result).toEqual({ success: false, error: "SharedContext not available" });
  });

  it("filters findings with keyword, minConfidence, and string limit", async () => {
    const details = {
      c1: { id: "c1", content: "low", source: "s1", confidence: 0.4 },
      c2: { id: "c2", content: "high", source: "s2", confidence: 0.9 },
    };
    const sharedContext = makeSharedContext({
      searchAll: vi.fn(() => ["c1", "c2"]),
      getDetail: vi.fn((id) => details[id]),
    });
    const context = makeContext({ sharedContext });

    const result = await handler({
      action: "get-findings",
      type: "claim",
      keyword: "alpha",
      minConfidence: "0.6",
      limit: "2",
    }, context);

    expect(sharedContext.searchAll).toHaveBeenCalledWith(["finding_claim", "alpha"]);
    expect(sharedContext.search).not.toHaveBeenCalled();
    expect(result.findings.claims).toHaveLength(1);
    expect(result.findings.claims[0]).toMatchObject({
      id: "c2",
      content: "high",
      source: "s2",
      confidence: 0.9,
    });
    expect(result.stats).toEqual({ claimCount: 1, gapCount: 0, conflictCount: 0, total: 1 });
    expect(result.blackboard).toBe("blackboard");
  });

  it("aggregates claims, gaps, and conflicts when no filter is provided", async () => {
    const details = {
      c1: { id: "c1", content: "claim", source: "s1", confidence: 0.7 },
      g1: { id: "g1", content: "gap", source: "s2", priority: "high" },
      g2: { id: "g2", content: "gap2", source: "s3", priority: "low" },
      x1: { id: "x1", content: "conflict", source: "s4", sources: ["s4", "s5"] },
    };
    const sharedContext = makeSharedContext({
      search: vi.fn((query) => {
        if (query === "finding_claim") return ["c1"];
        if (query === "finding_gap") return ["g1", "g2"];
        if (query === "finding_conflict") return ["x1"];
        return [];
      }),
      getDetail: vi.fn((id) => details[id]),
      buildBlackboardPrompt: vi.fn(() => "signals"),
    });
    const context = makeContext({ sharedContext });

    const result = await handler({ action: "get-findings" }, context);

    expect(result.findings.claims).toHaveLength(1);
    expect(result.findings.gaps).toHaveLength(2);
    expect(result.findings.conflicts).toHaveLength(1);
    expect(result.stats).toEqual({ claimCount: 1, gapCount: 2, conflictCount: 1, total: 4 });
    expect(result.hint).toContain("已收集 1 条论点");
    expect(result.blackboard).toBe("signals");
  });

  it("delegates get-source to handleGetSource", async () => {
    const state = makeState();
    const context = makeContext({ state });

    const result = await handler({ action: "get-source", sourceId: "s1" }, context);

    expect(handleGetSourceMock).toHaveBeenCalledWith({ action: "get-source", sourceId: "s1" }, context, state);
    expect(result).toEqual({ success: true, source: "mock-source" });
  });

  it("blocks submit when analysis gates are not met", async () => {
    const state = makeState({
      iteration: 0,
      L1: { readDocIds: [], gaps: [] },
      userConfig: { mode: "quick" },
    });
    const context = makeContext({ state });

    const result = await handler({ action: "submit" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("分析门槛未满足，无法提交");
    expect(result.gateCheck.required.minIterations).toBe(3);
    expect(prepareReportForSubmitMock).not.toHaveBeenCalled();
  });

  it("blocks submit when todo/finding warnings exist", async () => {
    const state = makeState({
      todos: [{ status: "todo" }, { status: "done" }, { status: "todo" }],
      L1: {
        report: makeReport({ markdown: "report" }),
      },
    });
    const sharedContext = makeSharedContext({
      search: vi.fn(() => []),
    });
    const context = makeContext({ state, sharedContext });

    const result = await handler({ action: "submit" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("前置条件未满足，无法提交");
    expect(result.warnings).toHaveLength(2);
    expect(prepareReportForSubmitMock).not.toHaveBeenCalled();
  });

  it("returns error when submitting an empty report", async () => {
    const state = makeState();
    const context = makeContext({ state });

    const result = await handler({ action: "submit" }, context);

    expect(result).toMatchObject({ success: false, error: "报告为空，无法提交" });
  });

  it("returns validation errors when submit fails checks", async () => {
    const report = makeReport({ markdown: "abc" });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    prepareReportForSubmitMock.mockImplementation((markdown) => ({
      markdown,
      validation: { valid: false, issues: ["too short"], wordCount: markdown.length },
      review: { issues: ["dup"] },
    }));

    const result = await handler({ action: "submit" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("报告质量不达标，无法提交");
    expect(result.validation.valid).toBe(false);
    expect(result.progress).toMatchObject({ wordCount: 3 });
  });

  it("submits successfully after postprocess updates", async () => {
    const report = makeReport({ markdown: "raw" });
    const state = makeState({ L1: { report }, runId: "run-1" });
    const emit = vi.fn();

    prepareReportForSubmitMock.mockImplementation(() => ({
      markdown: "fixed",
      validation: { valid: true, issues: [], wordCount: 5 },
      review: { ok: true },
    }));

    const result = await handler({ action: "submit" }, makeContext({ state, emit }));

    expect(result.success).toBe(true);
    expect(result.action).toBe("submit");
    expect(state.L1.report.markdown).toBe("fixed");
    expect(state.L1.report.submitted).toBe(true);
    expect(state.L1.report.submittedAt).toBe(1700000000000);
    expect(state.L1.report.version).toBe(1);
    expect(emit).toHaveBeenCalledWith("deepsearch.report.submitted", {
      runId: "run-1",
      wordCount: 5,
      version: 1,
    });
  });

  it("returns outline info for get-outline", async () => {
    const report = makeReport({ sections: [{ title: "Intro", content: "x" }] });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({ action: "get-outline" }, context);

    expect(result).toEqual({
      success: true,
      action: "get-outline",
      outline: ["Intro"],
      totalSections: 1,
      filledSections: 1,
      emptySections: 0,
    });
  });

  it("returns error when reviewing an empty report", async () => {
    const report = makeReport({ markdown: "" });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({ action: "review" }, context);

    expect(result).toEqual({ success: false, error: "报告为空，无需审查" });
  });

  it("updates report when review fixes content", async () => {
    const report = makeReport({ markdown: "dup" });
    const state = makeState({ L1: { report } });

    reviewReportMarkdownMock.mockImplementation(() => ({
      markdown: "fixed",
      issues: ["repeat"],
      fixed: true,
      originalLength: 3,
      fixedLength: 5,
    }));

    const result = await handler({ action: "review" }, makeContext({ state }));

    expect(result.success).toBe(true);
    expect(state.L1.report.markdown).toBe("fixed");
    expect(state.L1.report.version).toBe(1);
    expect(result.fixed).toBe(true);
  });

  it("requires sectionId or title for fill-section", async () => {
    const state = makeState({ L1: { report: makeReport() } });
    const context = makeContext({ state });

    const result = await handler({ action: "fill-section" }, context);

    expect(result).toEqual({ success: false, error: "fill-section requires sectionId or title" });
  });

  it("returns error when fill-section cannot find the section", async () => {
    const report = makeReport({ sections: [{ sectionId: "s1", title: "Intro" }] });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({ action: "fill-section", sectionId: "missing" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Section not found");
    expect(result.availableSections).toEqual(["Intro"]);
  });

  it.each([0, -1])("falls back to config minWords when minWords is %s", async (minWords) => {
    const report = makeReport({ sections: [{ sectionId: "s1", title: "Intro" }] });
    const state = makeState({
      L1: { report },
      reportConfig: { sectionWordLimits: { Intro: 5 } },
    });
    const context = makeContext({ state });

    countContentCharsMock.mockReturnValue(4);

    const result = await handler({
      action: "fill-section",
      sectionId: "s1",
      title: "Intro",
      content: "abcd",
      minWords,
    }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain("当前 4 字");
    expect(result.error).toContain("至少 5 字");
  });

  it.each([
    { minWords: "200", contentLength: 250 },
    { minWords: Number.MAX_SAFE_INTEGER, contentLength: 12000 },
  ])("fills section with minWords %s", async ({ minWords, contentLength }) => {
    const content = "a".repeat(contentLength);
    const report = makeReport({ sections: [{ sectionId: "s1", title: "Intro" }] });
    const state = makeState({ L1: { report } });
    const emit = vi.fn();

    const result = await handler({
      action: "fill-section",
      sectionId: "s1",
      title: "Intro",
      content,
      minWords,
    }, makeContext({ state, emit }));

    expect(result.success).toBe(true);
    expect(state.L1.report.sections[0].wordCount).toBe(contentLength);
    expect(state.L1.report.markdown).toContain("Intro");
    expect(emit).toHaveBeenCalledWith("deepsearch.section.filled", expect.objectContaining({
      sectionId: "s1",
      title: "Intro",
    }));
  });

  it.each([
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "empty string", value: "" },
    { label: "whitespace", value: "   " },
  ])("rejects %s content for append", async ({ value }) => {
    const state = makeState();
    const context = makeContext({ state });

    const result = await handler({ action: "append", content: value }, context);

    expect(result).toEqual({ success: false, error: "append action requires content" });
  });

  it("prevents duplicate content append", async () => {
    const report = makeReport({ markdown: "hello" });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({ action: "append", content: "hello" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("内容已存在，跳过重复追加");
    expect(state.L1.report.version).toBe(0);
  });

  it("appends large content and updates progress", async () => {
    const largeContent = "x".repeat(50000);
    const state = makeState();
    const context = makeContext({ state });

    const result = await handler({ action: "append", content: largeContent }, context);

    expect(result.success).toBe(true);
    expect(result.wordCount).toBe(50000);
    expect(state.L1.report.markdown).toBe(largeContent);
    expect(state.L1.report.version).toBe(1);
  });

  it("logs warning when analysis gates are not met but still writes", async () => {
    const state = makeState({
      iteration: 0,
      L1: { readDocIds: [], gaps: [] },
    });
    const context = makeContext({ state });

    const result = await handler({ action: "append", content: "content" }, context);

    expect(result.success).toBe(true);
    expect(loggerMock.warn.mock.calls.some((call) => String(call[0]).includes("分析门槛未满足"))).toBe(true);
  });

  it("logs warning when todo/finding checks fail but still writes", async () => {
    const state = makeState({
      todos: [{ status: "todo" }, { status: "done" }, { status: "todo" }],
    });
    const sharedContext = makeSharedContext({ search: vi.fn(() => []) });
    const context = makeContext({ state, sharedContext });

    const result = await handler({ action: "append", content: "content" }, context);

    expect(result.success).toBe(true);
    expect(loggerMock.warn.mock.calls.some((call) => String(call[0]).includes("前置条件警告"))).toBe(true);
  });

  it("requires sectionId or title for update", async () => {
    const state = makeState({ L1: { report: makeReport() } });
    const context = makeContext({ state });

    const result = await handler({ action: "update" }, context);

    expect(result).toEqual({ success: false, error: "update action requires sectionId or title" });
  });

  it("updates existing section content", async () => {
    const report = makeReport({
      sections: [{ sectionId: "s1", title: "Intro", content: "old" }],
    });
    const state = makeState({ L1: { report } });
    const emit = vi.fn();

    const result = await handler({
      action: "update",
      sectionId: "s1",
      content: "new",
    }, makeContext({ state, emit }));

    expect(result.success).toBe(true);
    expect(state.L1.report.sections[0].content).toBe("new");
    expect(state.L1.report.version).toBe(1);
    expect(emit).toHaveBeenCalledWith("deepsearch.section.updated", {
      sectionId: "s1",
      title: undefined,
      version: 1,
    });
  });

  it("adds a new section when update target is missing", async () => {
    const report = makeReport();
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({
      action: "update",
      title: "New Section",
      content: "body",
    }, context);

    expect(result.success).toBe(true);
    expect(state.L1.report.sections).toHaveLength(1);
    expect(state.L1.report.sections[0].title).toBe("New Section");
  });

  it.each([
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "whitespace", value: "   " },
  ])("rejects %s search text for patch", async ({ value }) => {
    const report = makeReport({ markdown: "hello" });
    const state = makeState({ L1: { report } });

    const result = await handler({ action: "patch", search: value }, makeContext({ state }));

    expect(result).toEqual({ success: false, error: "patch action requires search/oldText" });
  });

  it("returns error when patch search text is not found", async () => {
    const report = makeReport({ markdown: "hello" });
    const state = makeState({ L1: { report } });

    const result = await handler({ action: "patch", search: "missing" }, makeContext({ state }));

    expect(result).toEqual({ success: false, error: "search text not found in report" });
  });

  it("patches report content", async () => {
    const report = makeReport({ markdown: "hello world" });
    const state = makeState({ L1: { report } });

    const result = await handler({
      action: "patch",
      search: "world",
      replace: "there",
    }, makeContext({ state }));

    expect(result.success).toBe(true);
    expect(state.L1.report.markdown).toBe("hello there");
    expect(state.L1.report.version).toBe(1);
  });

  it("requires content for direct/create", async () => {
    const state = makeState({ L1: { report: makeReport() } });
    const context = makeContext({ state });

    const result = await handler({ action: "direct", content: "" }, context);

    expect(result).toEqual({ success: false, error: "direct/create action requires content or report" });
  });

  it("uses report field to infer direct action", async () => {
    const state = makeState();
    const context = makeContext({ state });

    const result = await handler({ report: "Full report" }, context);

    expect(result.success).toBe(true);
    expect(result.action).toBe("direct");
    expect(state.L1.report.markdown).toBe("Full report");
    expect(state.L1.report.sections).toEqual([]);
  });

  it.each([
    { label: "empty array", sections: [] },
    { label: "object", sections: {} },
  ])("handles %s input for sections", async ({ sections }) => {
    const state = makeState({ L1: { report: makeReport() } });
    const context = makeContext({ state });

    const result = await handler({ action: "sections", sections }, context);

    expect(result.success).toBe(true);
    expect(state.L1.report.sections).toEqual([]);
    expect(state.L1.report.markdown).toBe("");
  });

  it("updates sections and handles deep nested content", async () => {
    const deepContent = { a: { b: { c: { d: { e: "x" } } } } };
    const report = makeReport({
      sections: [{ sectionId: "s1", title: "Intro", content: "old" }],
    });
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({
      action: "sections",
      sections: [
        { title: "Intro", content: "new" },
        { title: "Deep", content: deepContent },
      ],
    }, context);

    expect(result.success).toBe(true);
    expect(state.L1.report.sections).toHaveLength(2);
    expect(state.L1.report.sections[0].content).toBe("new");
    expect(state.L1.report.sections[1].content).toBe("[object Object]");
  });

  it("adds a single section with default title for whitespace", async () => {
    const report = makeReport();
    const state = makeState({ L1: { report } });
    const context = makeContext({ state });

    const result = await handler({ action: "section", title: "   ", content: "body" }, context);

    expect(result.success).toBe(true);
    expect(result.section.title).toBe("章节");
    expect(state.L1.report.sections).toHaveLength(1);
  });

  it("generates full report when action is inferred", async () => {
    const state = makeState({
      L1: { claims: ["c1"], evidenceLedger: ["e1"] },
      L0: { sources: ["s1"] },
      todos: [{ status: "done" }],
      taskGoal: "goal",
    });
    const context = makeContext({ state });

    const result = await handler({}, context);

    expect(result.success).toBe(true);
    expect(result.action).toBe("full");
    expect(generateReportMock).toHaveBeenCalledWith(
      ["c1"],
      ["e1"],
      [{ status: "done" }],
      ["s1"],
      "goal",
    );
    expect(syncReportCitationsMock).toHaveBeenCalledWith(state.L1.report, [{ id: "c1" }]);
  });

  it("returns error when report generation throws", async () => {
    generateReportMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const state = makeState();
    const context = makeContext({ state });

    const result = await handler({ action: "full" }, context);

    expect(result).toEqual({ success: false, error: "boom", errorCode: "REPORT_GENERATION_FAILED" });
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("handles concurrent appends without losing content", async () => {
    const state = makeState();
    const context = makeContext({ state });

    const [first, second] = await Promise.all([
      handler({ action: "append", content: "first" }, context),
      handler({ action: "append", content: "second" }, context),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(state.L1.report.markdown).toContain("first");
    expect(state.L1.report.markdown).toContain("second");
    expect(state.L1.report.version).toBe(2);
  });
});
