import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  /**
   * Minimal attribute parser used by batch-generator sanitizer/patcher.
   * Returns lower-cased attribute names.
   */
  function parseAttrs(tag) {
    /** @type {Record<string, string>} */
    const out = {};
    if (typeof tag !== "string") return out;

    const raw = tag.trim();
    const firstSpace = raw.indexOf(" ");
    if (firstSpace === -1) return out;

    let rest = raw.slice(firstSpace + 1).trim();
    if (rest.endsWith("/>")) rest = rest.slice(0, -2).trim();
    if (rest.endsWith(">")) rest = rest.slice(0, -1).trim();

    const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
    let m;
    while ((m = re.exec(rest))) {
      const name = m[1];
      if (!name) continue;
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      out[name.toLowerCase()] = String(value);
    }
    return out;
  }

  const resourceGuardRun = vi.fn(async (fn) => await fn());
  // Must be constructable because the production code uses `new ResourceGuard(...)`.
  const ResourceGuard = vi.fn().mockImplementation(function ResourceGuardMock(opts) {
    this.opts = opts;
    this.run = resourceGuardRun;
  });

  return {
    // js/agents/stages/design/model.js
    getDesignModelCaller: vi.fn(),
    isNonRetryableError: vi.fn(() => false),

    // js/agents/shared/index.js
    robustParseJson: vi.fn((text) => {
      try {
        return JSON.parse(String(text));
      } catch {
        return null;
      }
    }),
    extractJsonCandidate: vi.fn((text) => (typeof text === "string" ? text : "")),
    createLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() })),
    toNonEmptyString: vi.fn((value) => {
      const s = value === undefined || value === null ? "" : String(value);
      const trimmed = s.trim();
      return trimmed ? trimmed : "";
    }),

    // js/agents/stages/design/constants.js
    VisualDataStatus: { PENDING: "pending" },

    // js/agents/stages/design/dsl/dsl-builder.js
    buildSlideHtml: vi.fn(
      () => '<section data-type="freeform"><div data-el="text">Fallback</div></section>'
    ),

    // js/agents/stages/design/generators/layout-protocol.js
    resolveLayoutType: vi.fn((pageType) => `layout-${String(pageType || "default")}`),

    // js/agents/prompts/prompt-loader.js
    loadPrompt: vi.fn(async () => "SYSTEM PROMPT"),

    // js/agents/stages/design/shared/html-parser.js
    parseTagAttributes: vi.fn((tag) => parseAttrs(tag)),

    // js/agents/stages/design/shared/safe-emit.js
    safeEmit: vi.fn((emit, name, status, payload) => {
      if (typeof emit !== "function") return;
      emit(name, { actor: "design", status, payload });
    }),

    // js/agents/runtime/index.js
    ResourceGuard,
    resourceGuardRun,
  };
});

vi.mock("../../../../../js/agents/stages/design/model.js", () => ({
  getDesignModelCaller: mocks.getDesignModelCaller,
  isNonRetryableError: mocks.isNonRetryableError,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  robustParseJson: mocks.robustParseJson,
  extractJsonCandidate: mocks.extractJsonCandidate,
  createLogger: mocks.createLogger,
  toNonEmptyString: mocks.toNonEmptyString,
}));

vi.mock("../../../../../js/agents/stages/design/constants.js", () => ({
  VisualDataStatus: mocks.VisualDataStatus,
}));

vi.mock("../../../../../js/agents/stages/design/dsl/dsl-builder.js", () => ({
  buildSlideHtml: mocks.buildSlideHtml,
}));

vi.mock("../../../../../js/agents/stages/design/generators/layout-protocol.js", () => ({
  resolveLayoutType: mocks.resolveLayoutType,
}));

vi.mock("../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: mocks.loadPrompt,
}));

vi.mock("../../../../../js/agents/stages/design/shared/html-parser.js", () => ({
  parseTagAttributes: mocks.parseTagAttributes,
}));

vi.mock("../../../../../js/agents/stages/design/shared/safe-emit.js", () => ({
  safeEmit: mocks.safeEmit,
  default: { safeEmit: mocks.safeEmit },
}));

vi.mock("../../../../../js/agents/runtime/index.js", () => ({
  ResourceGuard: mocks.ResourceGuard,
}));

const SUBJECT_PATH = "../../../../../js/agents/stages/design/generators/batch-generator.js";

async function importSubject() {
  // Ensure module-level caches (e.g. system prompt) reset per test.
  vi.resetModules();
  return await import(SUBJECT_PATH);
}

function makeSlideIntent(id, title = "Test Slide", pageType = "overview") {
  return {
    slideIntentId: id,
    pageType,
    title,
    objective: `Objective for ${title}`,
    keyPoints: ["Key point 1", "Key point 2"],
    claimIds: ["c1", "c2"],
    dataTableIds: ["t1"],
  };
}

function makeDesignSystem() {
  return {
    theme: "light",
    designTokens: {
      colors: { bg: "#ffffff", text: "#111111", primary: "#0ea5e9" },
      typography: { fontFamily: "Inter", baseFontSize: 16 },
    },
  };
}

function makeContentPackage(slideIntents) {
  return {
    schemaVersion: "0.1",
    runId: "run_test",
    constraints: { pageCount: slideIntents.length, tone: "professional", audience: "executives" },
    summary: "Test deck summary",
    slideIntents,
    claims: [
      { claimId: "c1", text: "Claim 1 text", evidenceIds: ["e1"] },
      { claimId: "c2", text: "Claim 2 text", evidenceIds: ["e2"] },
    ],
    evidenceLedger: [
      { evidenceId: "e1", sourceId: "src1", locator: { charStart: 0, charEnd: 10 }, quote: "Evidence 1" },
      { evidenceId: "e2", sourceId: "src2", locator: { charStart: 0, charEnd: 10 }, quote: "Evidence 2" },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isNonRetryableError.mockReturnValue(false);
  mocks.getDesignModelCaller.mockReturnValue(undefined);
  mocks.loadPrompt.mockResolvedValue("SYSTEM PROMPT");
  mocks.buildSlideHtml.mockReturnValue(
    '<section data-type="freeform"><div data-el="text">Fallback</div></section>'
  );
  mocks.resolveLayoutType.mockImplementation((pageType) => `layout-${String(pageType || "default")}`);
});

describe("batch-generator exports", () => {
  it("should_export_generateBatch_and_generateSingleSlide", async () => {
    const mod = await importSubject();
    expect(mod).toEqual(
      expect.objectContaining({
        generateBatch: expect.any(Function),
        generateSingleSlide: expect.any(Function),
      })
    );
  });
});

describe("generateSingleSlide", () => {
  it("should_return_llm_source_when_model_returns_valid_slideHtml", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Intro", "overview");
    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
        ]),
      })),
    });

    expect(result.source).toBe("llm");
  });

  it("should_add_data_layout_when_missing_from_model_slideHtml", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Intro", "overview");
    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
        ]),
      })),
    });

    expect(result.slideHtml.includes('data-layout="layout-overview"')).toBe(true);
  });

  it("should_strip_script_tags_from_llm_slideHtml", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Intro", "overview");
    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          {
            slideIntentId: "s1",
            slideHtml:
              '<section data-type="freeform"><script>alert(1)</script><div data-el="text">OK</div></section>',
          },
        ]),
      })),
    });

    expect(result.slideHtml.toLowerCase().includes("<script")).toBe(false);
  });

  it("should_strip_inline_event_handlers_from_llm_slideHtml", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Intro", "overview");
    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          {
            slideIntentId: "s1",
            slideHtml:
              '<section data-type="freeform"><div data-el="text" onclick="alert(1)">OK</div></section>',
          },
        ]),
      })),
    });

    expect(result.slideHtml.toLowerCase().includes("onclick=")).toBe(false);
  });

  it("should_drop_javascript_urls_from_img_src", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Intro", "overview");
    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          {
            slideIntentId: "s1",
            slideHtml:
              '<section data-type="freeform"><img data-el="image" src="javascript:alert(1)" /><div data-el="text">OK</div></section>',
          },
        ]),
      })),
    });

    expect(result.slideHtml.toLowerCase().includes("javascript:")).toBe(false);
  });

  it("should_apply_visual_slot_hints_to_existing_placeholders", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Images", "overview");
    const slotHintsBySlotId = new Map([
      [
        "img_s1_hero",
        {
          slotId: "img_s1_hero",
          renderType: "ai-image",
          position: { x: "5%", y: "10%", w: "90%", h: "50%" },
          effects: { opacity: 0.9 },
        },
      ],
    ]);
    const imageSlotsForSlide = [{ slotId: "img_s1_hero", slideIndex: 0, aspectRatio: "16:9" }];

    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      imageSlotsForSlide,
      slotHintsBySlotId,
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          {
            slideIntentId: "s1",
            slideHtml:
              '<section data-type="freeform"><div data-el="image-placeholder" id="img_s1_hero" data-slot-id="img_s1_hero"></div><div data-el="text">OK</div></section>',
          },
        ]),
      })),
    });

    expect(result.slideHtml.includes('data-render-type="ai-image"')).toBe(true);
  });

  it("should_insert_missing_image_placeholders_when_slot_hint_exists", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Images", "overview");
    const slotHintsBySlotId = new Map([
      ["img_s1_hero", { slotId: "img_s1_hero", renderType: "ai-image", position: { x: "5%" } }],
    ]);
    const imageSlotsForSlide = [{ slotId: "img_s1_hero", slideIndex: 0, aspectRatio: "16:9" }];

    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      imageSlotsForSlide,
      slotHintsBySlotId,
      modelCaller: vi.fn(async () => ({
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
        ]),
      })),
    });

    expect(result.slideHtml.includes('data-status="pending"')).toBe(true);
  });

  it("should_repair_invalid_slideHtml_once_when_model_returns_fixable_output", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Needs Repair", "overview");
    const modelCaller = vi.fn(async (messages) => {
      const system = String(messages?.[0]?.content || "");
      if (system.includes("[DSL Repair]")) {
        return { content: '<section data-type="freeform"><div data-el="text">Repaired</div></section>' };
      }
      return {
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div>NO DATA EL</div></section>' },
        ]),
      };
    });

    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller,
    });

    expect(result.slideHtml.includes("Repaired")).toBe(true);
  });

  it("should_return_fallback_source_when_model_output_is_unrepairable", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Unrepairable", "overview");
    const modelCaller = vi.fn(async (messages) => {
      const system = String(messages?.[0]?.content || "");
      if (system.includes("[DSL Repair]")) return { content: "no section here" };
      return {
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div>NO DATA EL</div></section>' },
        ]),
      };
    });

    const result = await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller,
    });

    expect(result.source).toBe("fallback");
  });

  it("should_emit_design_slide_retrying_when_first_attempt_fails_then_succeeds", async () => {
    const mod = await importSubject();

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const slideIntent = makeSlideIntent("s1", "Retry", "overview");
    const modelCaller = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
        ]),
      });

    await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller,
      emit,
      slideIndex: 0,
    });

    expect(events.some((e) => e.name === "design:slide.retrying")).toBe(true);
  });

  it("should_not_retry_when_isNonRetryableError_returns_true", async () => {
    const mod = await importSubject();

    mocks.isNonRetryableError.mockReturnValue(true);
    const slideIntent = makeSlideIntent("s1", "No Retry", "overview");
    const modelCaller = vi.fn(async () => {
      throw new Error("auth failed");
    });

    await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller,
      slideIndex: 0,
    });

    expect(modelCaller).toHaveBeenCalledTimes(1);
  });

  it("should_throw_when_signal_is_aborted_before_start", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Cancelled", "overview");
    const controller = new AbortController();
    controller.abort("stop");

    await expect(
      mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
        contentPackage: makeContentPackage([slideIntent]),
        modelCaller: vi.fn(),
        signal: controller.signal,
      })
    ).rejects.toThrow("stop");
  });

  it("should_call_getDesignModelCaller_when_options_modelCaller_is_missing", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Uses Router", "overview");
    const modelCaller = vi.fn(async () => ({
      content: JSON.stringify([
        { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
      ]),
    }));
    mocks.getDesignModelCaller.mockReturnValue(modelCaller);

    await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
    });

    expect(mocks.getDesignModelCaller).toHaveBeenCalledTimes(1);
  });

  it("should_use_fallback_system_prompt_when_loadPrompt_rejects", async () => {
    const mod = await importSubject();

    mocks.loadPrompt.mockRejectedValueOnce(new Error("missing prompt"));
    const slideIntent = makeSlideIntent("s1", "Fallback Prompt", "overview");
    const seen = { system: "" };
    const modelCaller = vi.fn(async (messages) => {
      seen.system = String(messages?.[0]?.content || "");
      return {
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
        ]),
      };
    });

    await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller,
    });

    expect(seen.system.includes("You are a PPT slide generator.")).toBe(true);
  });

  it("should_append_style_lock_suffix_when_dslExamples_are_provided", async () => {
    const mod = await importSubject();

    const slideIntent = makeSlideIntent("s1", "Style Lock", "overview");
    const seen = { system: "" };
    const modelCaller = vi.fn(async (messages) => {
      seen.system = String(messages?.[0]?.content || "");
      return {
        content: JSON.stringify([
          { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">OK</div></section>' },
        ]),
      };
    });

    await mod.generateSingleSlide(slideIntent, makeDesignSystem(), "", {
      contentPackage: makeContentPackage([slideIntent]),
      modelCaller,
      dslExamples: [{ slideIntentId: "ex1", slideHtml: '<section data-type="freeform"><div data-el="text">EX</div></section>' }],
    });

    expect(seen.system.includes("CRITICAL: Match the exact visual style")).toBe(true);
  });
});

describe("generateBatch", () => {
  function makeModelCaller() {
    return vi.fn(async (messages) => {
      const user = String(messages?.[1]?.content || "");
      const match = user.match(/"slideIntentId":"([^"]+)"/);
      const slideIntentId = match ? match[1] : "unknown";
      return {
        content: JSON.stringify([
          {
            slideIntentId,
            slideHtml: `<section data-type="freeform"><div data-el="text">${slideIntentId}</div></section>`,
          },
        ]),
      };
    });
  }

  it("should_return_empty_array_when_slideIntents_is_not_an_array", async () => {
    const mod = await importSubject();

    const out = await mod.generateBatch(null, {}, makeDesignSystem(), { modelCaller: makeModelCaller() });

    expect(out).toEqual([]);
  });

  it("should_support_three_arg_form_when_designSystem_is_in_options", async () => {
    const mod = await importSubject();

    const slideIntents = [makeSlideIntent("s1", "Slide 1", "overview")];
    const out = await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), {
      designSystem: makeDesignSystem(),
      modelCaller: makeModelCaller(),
      batchSize: 1,
    });

    expect(out.length).toBe(1);
  });

  it("should_return_results_in_original_slide_order", async () => {
    const mod = await importSubject();

    const slideIntents = [
      makeSlideIntent("s1", "Slide 1", "overview"),
      makeSlideIntent("s2", "Slide 2", "overview"),
      makeSlideIntent("s3", "Slide 3", "overview"),
    ];
    const out = await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      modelCaller: makeModelCaller(),
      batchSize: 2,
    });

    expect(out.map((r) => r.slideIntentId)).toEqual(["s1", "s2", "s3"]);
  });

  it("should_emit_design_batch_started_event_when_processing", async () => {
    const mod = await importSubject();

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const slideIntents = [makeSlideIntent("s1", "Slide 1", "overview")];
    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      emit,
      modelCaller: makeModelCaller(),
      batchSize: 1,
    });

    expect(events.some((e) => e.name === "design:batch.started")).toBe(true);
  });

  it("should_emit_design_slide_started_with_expected_payload", async () => {
    const mod = await importSubject();

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const slideIntents = [makeSlideIntent("s1", "Slide 1", "overview")];
    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      emit,
      modelCaller: makeModelCaller(),
      batchSize: 1,
    });

    const started = events.find((e) => e.name === "design:slide.started");
    expect(started?.record?.payload?.slideIntent?.id).toBe("s1");
  });

  it("should_emit_design_slide_completed_with_llm_source_on_success", async () => {
    const mod = await importSubject();

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const slideIntents = [makeSlideIntent("s1", "Slide 1", "overview")];
    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      emit,
      modelCaller: makeModelCaller(),
      batchSize: 1,
    });

    const completed = events.find((e) => e.name === "design:slide.completed");
    expect(completed?.record?.payload?.source).toBe("llm");
  });

  it("should_emit_styleLock_established_when_first_batch_has_llm_examples", async () => {
    const mod = await importSubject();

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const slideIntents = [
      makeSlideIntent("s1", "Slide 1", "overview"),
      makeSlideIntent("s2", "Slide 2", "overview"),
      makeSlideIntent("s3", "Slide 3", "overview"),
    ];

    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      emit,
      modelCaller: makeModelCaller(),
      batchSize: 2,
      batchConcurrency: 2,
    });

    expect(events.some((e) => e.name === "design:styleLock.established")).toBe(true);
  });

  it("should_append_style_lock_suffix_in_later_batches_after_examples_exist", async () => {
    const mod = await importSubject();

    const systemPrompts = [];
    const modelCaller = vi.fn(async (messages) => {
      systemPrompts.push(String(messages?.[0]?.content || ""));
      const user = String(messages?.[1]?.content || "");
      const match = user.match(/"slideIntentId":"([^"]+)"/);
      const slideIntentId = match ? match[1] : "unknown";
      return {
        content: JSON.stringify([
          {
            slideIntentId,
            slideHtml: `<section data-type="freeform"><div data-el="text">${slideIntentId}</div></section>`,
          },
        ]),
      };
    });

    const slideIntents = [
      makeSlideIntent("s1", "Slide 1", "overview"),
      makeSlideIntent("s2", "Slide 2", "overview"),
      makeSlideIntent("s3", "Slide 3", "overview"),
    ];

    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      modelCaller,
      batchSize: 2,
      batchConcurrency: 2,
    });

    expect(systemPrompts.some((p) => p.includes("CRITICAL: Match the exact visual style"))).toBe(true);
  });

  it("should_mark_batches_after_first_with_styleLock_true", async () => {
    const mod = await importSubject();

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const slideIntents = [
      makeSlideIntent("s1", "Slide 1", "overview"),
      makeSlideIntent("s2", "Slide 2", "overview"),
      makeSlideIntent("s3", "Slide 3", "overview"),
    ];

    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      emit,
      modelCaller: makeModelCaller(),
      batchSize: 2,
      batchConcurrency: 2,
    });

    const startedBatches = events.filter((e) => e.name === "design:batch.started");
    expect(startedBatches.some((e) => e.record?.payload?.styleLock === true)).toBe(true);
  });

  it("should_use_ResourceGuard_when_processing_batches_after_first", async () => {
    const mod = await importSubject();

    const slideIntents = [
      makeSlideIntent("s1", "Slide 1", "overview"),
      makeSlideIntent("s2", "Slide 2", "overview"),
      makeSlideIntent("s3", "Slide 3", "overview"),
    ];

    await mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
      modelCaller: makeModelCaller(),
      batchSize: 2,
      batchConcurrency: 2,
    });

    expect(mocks.ResourceGuard).toHaveBeenCalledTimes(1);
  });

  it("should_reject_when_signal_is_aborted_before_processing", async () => {
    const mod = await importSubject();

    const controller = new AbortController();
    controller.abort("stop");
    const slideIntents = [makeSlideIntent("s1", "Slide 1", "overview")];

    await expect(
      mod.generateBatch(slideIntents, makeContentPackage(slideIntents), makeDesignSystem(), {
        modelCaller: makeModelCaller(),
        signal: controller.signal,
      })
    ).rejects.toThrow("stop");
  });
});