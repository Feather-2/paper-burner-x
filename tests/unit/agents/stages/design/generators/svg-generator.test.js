import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/design/model.js", () => ({
  getDesignModelCaller: vi.fn(),
}));
vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  robustParseJson: vi.fn(),
  createLogger: vi.fn(),
  classifyDesignError: vi.fn(),
}));
vi.mock("../../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/constants.js", () => ({
  VisualDataStatus: { FILLED: "filled" },
}));
vi.mock("../../../../../../js/agents/runtime/index.js", () => ({
  ResourceGuard: class ResourceGuard {
    constructor(options) {
      this.options = options;
    }
    async run(task) {
      return await task();
    }
  },
}));
vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => ({
  toNonEmptyString: vi.fn(),
  escapeHtml: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/shared/html-parser.js", () => ({
  parseTagAttributes: vi.fn(),
}));
vi.mock("../../../../../../js/agents/stages/design/shared/safe-emit.js", () => ({
  safeEmit: vi.fn(),
}));
vi.mock("../../../../../../js/agents/shared/utils/circuit-breaker.js", () => ({
  getCircuitBreaker: vi.fn(),
}));

const modulePath = "../../../../../../js/agents/stages/design/generators/svg-generator.js";
const modelPath = "../../../../../../js/agents/stages/design/model.js";
const sharedPath = "../../../../../../js/agents/shared/index.js";
const promptPath = "../../../../../../js/agents/prompts/prompt-loader.js";
const designUtilsPath = "../../../../../../js/agents/stages/design/shared/design-utils.js";
const parserPath = "../../../../../../js/agents/stages/design/shared/html-parser.js";
const safeEmitPath = "../../../../../../js/agents/stages/design/shared/safe-emit.js";
const breakerPath = "../../../../../../js/agents/shared/utils/circuit-breaker.js";

const parseAttrs = (tag) => {
  const attrs = {};
  const regex = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(tag))) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
};

const escapeHtml = (value) => {
  const s = String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const toNonEmptyString = (value) => {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return s ? s : "";
};

const buildPromptAwareModelCaller = () =>
  vi.fn(async (messages) => {
    const userContent = messages.find((m) => m.role === "user")?.content || "";
    const start = userContent.indexOf("[");
    const end = userContent.lastIndexOf("]");
    let slots = [];
    if (start >= 0 && end > start) {
      try {
        slots = JSON.parse(userContent.slice(start, end + 1));
      } catch {
        slots = [];
      }
    }
    const payload = slots
      .map((item) => item?.slotId)
      .filter(Boolean)
      .map((slotId) => ({ slotId, svg: `<svg id="${slotId}"></svg>` }));
    return { content: JSON.stringify(payload) };
  });

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  const shared = await import(sharedPath);
  shared.robustParseJson.mockImplementation((value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  });
  shared.createLogger.mockImplementation(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
  }));
  shared.classifyDesignError.mockReturnValue({ kind: "unknown", canRetry: false });

  const prompt = await import(promptPath);
  prompt.loadPrompt.mockResolvedValue("system prompt");

  const model = await import(modelPath);
  model.getDesignModelCaller.mockReturnValue(vi.fn(async () => ({ content: "[]" })));

  const designUtils = await import(designUtilsPath);
  designUtils.toNonEmptyString.mockImplementation(toNonEmptyString);
  designUtils.escapeHtml.mockImplementation(escapeHtml);

  const parser = await import(parserPath);
  parser.parseTagAttributes.mockImplementation(parseAttrs);

  const safeEmit = await import(safeEmitPath);
  safeEmit.safeEmit.mockImplementation((emit, name, status, payload) => {
    if (typeof emit === "function") emit(name, { actor: "svg-generator", status, payload });
  });

  const breaker = await import(breakerPath);
  breaker.getCircuitBreaker.mockImplementation(() => ({
    canExecute: vi.fn(() => true),
    _onSuccess: vi.fn(),
    _onFailure: vi.fn(),
    getState: vi.fn(() => "CLOSED"),
  }));
});

describe("SVGGenerator", () => {
  it("returns empty report for empty slots and handles type boundaries", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    const generator = new SVGGenerator();
    const result = await generator.generate({}, {}, { concurrency: "0" });

    expect(result.results).toEqual([]);
    expect(result.report.planned).toBe(0);
    expect(result.report.completed).toBe(0);
    expect(result.report.concurrency).toBe(1);
    expect(model.getDesignModelCaller).not.toHaveBeenCalled();
  });

  it("generates SVGs via LLM and respects size defaults", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    const modelCaller = buildPromptAwareModelCaller();
    model.getDesignModelCaller.mockReturnValue(modelCaller);

    const generator = new SVGGenerator({ batchSize: 2 });
    const slots = [
      {
        slotId: "slot-a",
        position: { w: "50%", h: "25%" },
      },
      {
        slotId: "slot-b",
      },
    ];
    const result = await generator.generate(slots, {}, { concurrency: 3 });

    const slotA = result.results.find((r) => r.slotId === "slot-a");
    const slotB = result.results.find((r) => r.slotId === "slot-b");

    expect(slotA.source).toBe("llm");
    expect(slotA.width).toBe(720);
    expect(slotA.height).toBe(360);
    expect(slotB.width).toBe(600);
    expect(slotB.height).toBe(400);
    expect(result.report.batchSize).toBe(2);
    expect(result.report.llmGenerated).toBe(2);
    expect(result.report.fallback).toBe(0);
  });

  it("falls back when model caller is unavailable", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    model.getDesignModelCaller.mockReturnValue(null);

    const generator = new SVGGenerator();
    const result = await generator.generate([{ slotId: "slot-missing" }], {});

    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe("fallback");
    expect(result.results[0].error.code).toBe("GENERATION_FAILED");
    expect(result.report.llmGenerated).toBe(0);
    expect(result.report.fallback).toBe(1);
    expect(result.report.errors).toHaveLength(1);
  });

  it("returns fallback when circuit breaker is open", async () => {
    const { SVGGenerator } = await import(modulePath);
    const breaker = await import(breakerPath);
    const model = await import(modelPath);

    model.getDesignModelCaller.mockReturnValue(buildPromptAwareModelCaller());
    breaker.getCircuitBreaker.mockImplementation(() => ({
      canExecute: vi.fn(() => false),
      _onSuccess: vi.fn(),
      _onFailure: vi.fn(),
      getState: vi.fn(() => "OPEN"),
    }));

    const generator = new SVGGenerator();
    const result = await generator.generate([{ slotId: "slot-open" }], {});

    expect(result.results[0].source).toBe("fallback");
    expect(result.results[0].error.code).toBe("CIRCUIT_OPEN");
    expect(result.report.fallback).toBe(1);
  });

  it("retries once on retryable error then succeeds", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);
    const shared = await import(sharedPath);

    shared.classifyDesignError.mockReturnValue({ canRetry: true });

    const modelCaller = vi.fn();
    modelCaller.mockRejectedValueOnce(new Error("network"));
    modelCaller.mockResolvedValueOnce({
      content: JSON.stringify([{ slotId: "slot-retry", svg: "<svg></svg>" }]),
    });
    model.getDesignModelCaller.mockReturnValue(modelCaller);

    const generator = new SVGGenerator();
    const result = await generator.generate([{ slotId: "slot-retry" }], {});

    expect(modelCaller).toHaveBeenCalledTimes(2);
    expect(result.results[0].source).toBe("llm");
    expect(result.report.errors).toHaveLength(0);
  });

  it("marks results as skipped when signal is aborted", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    model.getDesignModelCaller.mockImplementation(() => {
      throw new Error("should not be called");
    });

    const generator = new SVGGenerator();
    const signal = { aborted: true, reason: "stop" };
    const result = await generator.generate(
      [{ slotId: "slot-abort-1" }, { slotId: "slot-abort-2" }],
      {},
      { signal }
    );

    expect(model.getDesignModelCaller).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(2);
    expect(result.results[0].source).toBe("skipped");
    expect(result.results[0].error.code).toBe("ABORTED");
    expect(result.report.skipped).toBe(2);
  });

  it("handles partial LLM responses with fallback per slot", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([{ slotId: "slot-ok", svg: "<svg></svg>" }]),
    }));
    model.getDesignModelCaller.mockReturnValue(modelCaller);

    const generator = new SVGGenerator();
    const result = await generator.generate([{ slotId: "slot-ok" }, { slotId: "slot-miss" }], {});

    const ok = result.results.find((r) => r.slotId === "slot-ok");
    const miss = result.results.find((r) => r.slotId === "slot-miss");

    expect(ok.source).toBe("llm");
    expect(miss.source).toBe("fallback");
    expect(miss.error.code).toBe("MISSING_SVG");
    expect(result.report.llmGenerated).toBe(1);
    expect(result.report.fallback).toBe(1);
  });

  it("supports concurrent generate calls", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    const modelCaller = buildPromptAwareModelCaller();
    model.getDesignModelCaller.mockReturnValue(modelCaller);

    const generator = new SVGGenerator({ batchSize: 2 });
    const [first, second] = await Promise.all([
      generator.generate([{ slotId: "slot-1" }, { slotId: "slot-2" }], {}),
      generator.generate([{ slotId: "slot-3" }], {}),
    ]);

    expect(first.results).toHaveLength(2);
    expect(first.results.every((r) => r.source === "llm")).toBe(true);
    expect(second.results).toHaveLength(1);
    expect(second.results[0].slotId).toBe("slot-3");
  });

  it("handles rapid consecutive calls and clamps batch size", async () => {
    const { SVGGenerator } = await import(modulePath);
    const model = await import(modelPath);

    model.getDesignModelCaller.mockReturnValue(buildPromptAwareModelCaller());

    const generator = new SVGGenerator({ batchSize: 99 });
    const first = await generator.generate([{ slotId: "slot-first" }], {});
    const second = await generator.generate([{ slotId: "slot-second" }], {});

    expect(first.results[0].slotId).toBe("slot-first");
    expect(second.results[0].slotId).toBe("slot-second");
    expect(first.report.batchSize).toBe(4);
    expect(second.report.batchSize).toBe(4);
  });
});

describe("fillSvgPlaceholders", () => {
  it("replaces placeholders with sanitized svg and updates attributes", async () => {
    const { fillSvgPlaceholders } = await import(modulePath);

    const html =
      '<div data-el="image-placeholder" data-slot-id="slot-1" data-render-type="svg" data-fallback="1" data-aspect-ratio="1"><span>keep</span></div>';
    const svg =
      '<svg onload="alert(1)"><script>alert(1)</script><foreignObject>bad</foreignObject><a xlink:href="javascript:alert(2)">link</a></svg>';
    const { html: output, filledSlotIds, skippedSlotIds } = fillSvgPlaceholders(html, [
      { slotId: "slot-1", svgContent: svg, width: 120, height: 80 },
    ]);

    expect(output).toContain('data-el="svg"');
    expect(output).toContain('data-status="filled"');
    expect(output).toContain('data-render-type="svg"');
    expect(output).toContain('data-slot-id="slot-1"');
    expect(output).toContain('data-width="120"');
    expect(output).toContain('data-height="80"');
    expect(output).not.toContain("data-fallback=");
    expect(output).not.toContain("data-aspect-ratio=");
    expect(output).not.toContain("<script");
    expect(output).not.toContain("foreignObject");
    expect(output).not.toContain("onload");
    expect(output).not.toContain("javascript:");
    expect(filledSlotIds).toEqual(["slot-1"]);
    expect(skippedSlotIds).toEqual([]);
  });

  it("returns input unchanged for empty or invalid inputs", async () => {
    const { fillSvgPlaceholders } = await import(modulePath);

    const cases = [
      { html: null, slots: undefined, expectedHtml: "" },
      { html: undefined, slots: null, expectedHtml: "" },
      { html: "", slots: [], expectedHtml: "" },
      { html: "   ", slots: [], expectedHtml: "   " },
      { html: "<div></div>", slots: {}, expectedHtml: "<div></div>" },
      { html: {}, slots: [], expectedHtml: "" },
    ];

    for (const testCase of cases) {
      const result = fillSvgPlaceholders(testCase.html, testCase.slots);
      expect(result.html).toBe(testCase.expectedHtml);
      expect(result.filledSlotIds).toEqual([]);
      expect(result.skippedSlotIds).toEqual([]);
    }
  });

  it("skips slots without svg content and ignores whitespace slot ids", async () => {
    const { fillSvgPlaceholders } = await import(modulePath);

    const html = '<div data-el="image-placeholder" data-slot-id="slot-2" data-render-type="svg"></div>';
    const result = fillSvgPlaceholders(html, [
      { slotId: "slot-2", svgContent: "" },
      { slotId: "slot-2", svgContent: "   " },
      { slotId: "   ", svgContent: "<svg></svg>" },
    ]);

    expect(result.html).toBe(html);
    expect(result.filledSlotIds).toEqual([]);
    expect(result.skippedSlotIds).toEqual(["slot-2"]);
  });

  it("respects non-svg render types and uses id fallback", async () => {
    const { fillSvgPlaceholders } = await import(modulePath);

    const html =
      '<div data-el="image-placeholder" data-slot-id="slot-img" data-render-type="image"></div>' +
      '<div data-el="image-placeholder" id="slot-svg" data-render-type="svg"></div>';
    const result = fillSvgPlaceholders(html, [
      { slotId: "slot-img", svgContent: "<svg></svg>" },
      { slotId: "slot-svg", svgContent: "<svg></svg>" },
    ]);

    expect(result.html).toContain('data-slot-id="slot-img"');
    expect(result.html).toContain('data-el="image-placeholder"');
    expect(result.html).toContain('id="slot-svg"');
    expect(result.html).toContain('data-el="svg"');
    expect(result.filledSlotIds).toEqual(["slot-svg"]);
  });

  it("uses inner html when sanitized svg is empty and handles self-closing placeholders", async () => {
    const { fillSvgPlaceholders } = await import(modulePath);

    const html =
      '<div data-el="image-placeholder" data-slot-id="slot-inner" data-render-type="svg"><span>fallback</span></div>' +
      '<div data-el="image-placeholder" data-slot-id="slot-self" data-render-type="svg" />' +
      '<div data-el="image-placeholder" data-slot-id="slot-string" data-render-type="svg"></div>';
    const result = fillSvgPlaceholders(html, [
      { slotId: "slot-inner", svgContent: "<script>alert(1)</script>", width: 0, height: Number.MAX_SAFE_INTEGER },
      { slotId: "slot-self", svgContent: "<svg></svg>", width: -1, height: 100 },
      { slotId: "slot-string", svgContent: "<svg></svg>", width: "120", height: "60" },
    ]);

    expect(result.html).toContain("<span>fallback</span>");
    expect(result.html).not.toContain("<script");
    expect(result.html).toContain('data-width="0"');
    expect(result.html).toContain(`data-height="${Number.MAX_SAFE_INTEGER}"`);
    expect(result.html).toContain('data-width="-1"');
    expect(result.html).not.toContain('data-width="120"');
    expect(result.html).not.toContain('data-height="60"');
    expect(result.filledSlotIds.sort()).toEqual(["slot-inner", "slot-self", "slot-string"].sort());
  });

  it("handles large nested html and long svg strings", async () => {
    const { fillSvgPlaceholders } = await import(modulePath);

    const prefix = "x".repeat(10000);
    const suffix = "y".repeat(10000);
    const nested =
      '<div><div><div data-el="image-placeholder" data-slot-id="deep" data-render-type="svg"><div><div>inner</div></div></div></div></div>';
    const html = `${prefix}${nested}${suffix}`;
    const longSvg = `<svg>${"a".repeat(10000)}</svg>`;

    const result = fillSvgPlaceholders(html, [{ slotId: "deep", svgContent: longSvg }]);

    expect(result.filledSlotIds).toEqual(["deep"]);
    expect(result.html).toContain("<svg>");
    expect(result.html).toContain(prefix);
    expect(result.html).toContain(suffix);
  });
});
