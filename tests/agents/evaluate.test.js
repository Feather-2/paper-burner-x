const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function installDomAndSlideParser() {
  const { parseHTML } = require("linkedom");
  const { document, window } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  globalThis.window = window;

  // slide-parser.js is not an ESM module; it defines a top-level `SlideParser` class.
  // We must only evaluate it once per Node process, otherwise redeclaration throws.
  if (!globalThis.SlideParser) {
    const slideParserSrc = fs.readFileSync("js/ppt/slide-parser.js", "utf8") + "\n;globalThis.SlideParser = SlideParser;";
    vm.runInThisContext(slideParserSrc, { filename: "js/ppt/slide-parser.js" });
  }

  assert.ok(globalThis.SlideParser && typeof globalThis.SlideParser.parse === "function");
}

function uninstallDomAndSlideParser() {
  delete globalThis.document;
  delete globalThis.window;
}

function makeDeckPackage({ runId = "run_test", withImages = true } = {}) {
  const img = withImages ? `<img data-el="image" data-x="80%" data-y="80%" data-w="10%" data-h="10%" data-src="x.png" />` : "";
  const deckHtmlDsl = `
  <section data-type="freeform" id="slide-1" data-bg="#ffffff">
    <div data-el="text" data-x="10%" data-y="10%" data-w="60%" data-h="10%" data-font="16" data-color="#111111">Cover</div>
    <div data-el="shape" data-x="10%" data-y="25%" data-w="60%" data-h="10%" data-fill="#eeeeee"></div>
    ${img}
  </section>
  <section data-type="freeform" id="slide-2" data-bg="#ffffff">
    <div data-el="text" data-x="10%" data-y="10%" data-w="60%" data-h="10%" data-font="16" data-color="#111111">Agenda</div>
    <div data-el="line" data-x="10%" data-y="30%" data-w="60%" data-h="10%" data-stroke="#111111"></div>
    ${img}
  </section>
  `.trim();

  return {
    schemaVersion: "0.1",
    runId,
    deckHtmlDsl,
    slidesMeta: [
      { slideNo: 1, pageType: "cover", title: "Cover", qa: { issues: [] } },
      { slideNo: 2, pageType: "agenda", title: "Agenda", qa: { issues: [] } },
    ],
    editHints: {},
  };
}

function makeContentPackage({ runId = "run_test", withSourceText = true } = {}) {
  const sourceText = "Alpha beta. Gamma delta. Epsilon zeta.";
  const quote1 = sourceText.slice(0, 10);
  const quote2 = sourceText.slice(12, 23);
  return {
    schemaVersion: "0.1",
    runId,
    mode: "textprep",
    constraints: { tone: "business" },
    claims: [
      { claimId: "c1", text: "Claim 1", evidenceIds: ["e1"] },
      { claimId: "c2", text: "Claim 2", evidenceIds: ["e2"] },
    ],
    evidenceLedger: [
      { evidenceId: "e1", sourceId: "user_text", locator: { charStart: 0, charEnd: 10 }, quote: quote1 },
      { evidenceId: "e2", sourceId: "user_text", locator: { charStart: 12, charEnd: 23 }, quote: quote2 },
    ],
    ...(withSourceText ? { __sourceTextById: { user_text: sourceText } } : {}),
  };
}

test("Evaluate: hard-gates G1-G10 pass on a good package", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");

    const contentPackage = makeContentPackage({ withSourceText: true });
    const deckPackage = makeDeckPackage({ withImages: true });
    const exportResult = { formats: { pptx: { success: true }, pdf: { success: false }, images: { success: true } } };
    const lintResult = { counts: { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0 } };

    const hg = checkHardGates(contentPackage, deckPackage, exportResult, lintResult, { editabilityThreshold: 0.6 });
    assert.equal(hg.pass, true);
    assert.deepEqual(hg.failed, []);
    assert.equal(hg.details.G1.pass, true);
    assert.equal(hg.details.G2.pass, true);
    assert.equal(hg.details.G3.pass, true);
    assert.equal(hg.details.G4.pass, true);
    assert.equal(hg.details.G5.pass, true);
    assert.equal(hg.details.G6.pass, true);
    assert.equal(hg.details.G7.pass, true);
    assert.equal(hg.details.G8.pass, true);
    assert.equal(hg.details.G9.pass, true);
    assert.equal(hg.details.G10.pass, true);
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: hard-gates G1 fails when deckHtmlDsl is missing", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");
    const contentPackage = makeContentPackage();
    const deckPackage = { ...makeDeckPackage(), deckHtmlDsl: null };
    const exportResult = { formats: { pptx: { success: true }, images: { success: true } } };
    const lintResult = { counts: { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0 } };

    const hg = checkHardGates(contentPackage, deckPackage, exportResult, lintResult);
    assert.equal(hg.pass, false);
    assert.ok(hg.failed.includes("G1_parse_failed"));
    assert.equal(hg.details.G10.skipped, true);
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: hard-gates G2/G3 fail based on export report", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");
    const contentPackage = makeContentPackage();
    const deckPackage = makeDeckPackage();
    const lintResult = { counts: { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0 } };

    const hg = checkHardGates(contentPackage, deckPackage, { formats: { pptx: { success: false }, pdf: { success: false }, images: { success: false } } }, lintResult);
    assert.equal(hg.pass, false);
    assert.ok(hg.failed.includes("G2_pptx_export_failed"));
    assert.ok(hg.failed.includes("G3_pdf_or_images_export_failed"));
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: hard-gates G4-G6 fail based on lint counts", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");
    const contentPackage = makeContentPackage();
    const deckPackage = makeDeckPackage();
    const exportResult = { formats: { pptx: { success: true }, images: { success: true } } };

    const hg = checkHardGates(contentPackage, deckPackage, exportResult, { counts: { min_font: 1, overflow_x: 1, overflow_y: 0, contrast: 2 } });
    assert.equal(hg.pass, false);
    assert.ok(hg.failed.includes("G4_min_font_violations"));
    assert.ok(hg.failed.includes("G5_overflow_violations"));
    assert.ok(hg.failed.includes("G6_contrast_violations"));
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: hard-gates G7-G9 catch provenance chain issues", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");
    const deckPackage = makeDeckPackage();
    const exportResult = { formats: { pptx: { success: true }, images: { success: true } } };
    const lintResult = { counts: { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0 } };

    const sourceText = "Hello world. Evidence here.";
    const bad = {
      schemaVersion: "0.1",
      runId: "run_test",
      mode: "textprep",
      claims: [{ claimId: "c1", text: "bad", evidenceIds: [] }], // G7
      evidenceLedger: [{ evidenceId: "e1", sourceId: "user_text", locator: { charStart: 5, charEnd: 1 }, quote: "x" }], // G8
      __sourceTextById: { user_text: sourceText },
    };

    const hg = checkHardGates(bad, deckPackage, exportResult, lintResult);
    assert.equal(hg.pass, false);
    assert.ok(hg.failed.includes("G7_claims_missing_evidence"));
    assert.ok(hg.failed.includes("G8_locator_invalid"));
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: hard-gates G9 fails when quote cannot be read back", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");
    const deckPackage = makeDeckPackage();
    const exportResult = { formats: { pptx: { success: true }, images: { success: true } } };
    const lintResult = { counts: { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0 } };

    const contentPackage = {
      schemaVersion: "0.1",
      runId: "run_test",
      mode: "textprep",
      claims: [{ claimId: "c1", text: "Claim", evidenceIds: ["e1"] }],
      evidenceLedger: [{ evidenceId: "e1", sourceId: "user_text", locator: { charStart: 0, charEnd: 5 }, quote: "WRONG" }],
      __sourceTextById: { user_text: "hello world" },
    };

    const hg = checkHardGates(contentPackage, deckPackage, exportResult, lintResult);
    assert.equal(hg.pass, false);
    assert.ok(hg.failed.includes("G9_quote_mismatch"));
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: hard-gates G10 fails when key-slide editability ratio < 0.6", async () => {
  installDomAndSlideParser();
  try {
    const { checkHardGates } = await import("../../js/agents/eval/hard-gates.js");
    const contentPackage = makeContentPackage();
    const exportResult = { formats: { pptx: { success: true }, images: { success: true } } };
    const lintResult = { counts: { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0 } };

    const deckPackage = makeDeckPackage({ withImages: true });
    // Force low editability: replace slide-2 with only images.
    deckPackage.deckHtmlDsl = `
      <section data-type="freeform" id="slide-1" data-bg="#ffffff">
        <div data-el="text" data-x="10%" data-y="10%" data-w="60%" data-h="10%" data-font="16" data-color="#111111">Cover</div>
        <div data-el="shape" data-x="10%" data-y="25%" data-w="60%" data-h="10%" data-fill="#eeeeee"></div>
        <img data-el="image" data-x="80%" data-y="80%" data-w="10%" data-h="10%" data-src="x.png" />
      </section>
      <section data-type="freeform" id="slide-2" data-bg="#ffffff">
        <img data-el="image" data-x="10%" data-y="10%" data-w="80%" data-h="80%" data-src="x.png" />
        <img data-el="image" data-x="10%" data-y="10%" data-w="80%" data-h="80%" data-src="x.png" />
      </section>
    `.trim();

    const hg = checkHardGates(contentPackage, deckPackage, exportResult, lintResult, { editabilityThreshold: 0.6 });
    assert.equal(hg.pass, false);
    assert.ok(hg.failed.includes("G10_editability_below_threshold"));
  } finally {
    uninstallDomAndSlideParser();
  }
});

test("Evaluate: scenario scorer uses correct weights and computes weighted score", async () => {
  const { computeScenarioScore } = await import("../../js/agents/eval/scenario-scorer.js");

  const metrics = {
    dimensions: { Faithfulness: 100, Provenance: 100, Narrative: 100, Visual: 100, Editability: 100, Efficiency: 100 },
  };
  const out = computeScenarioScore("business", metrics);
  assert.equal(out.score, 100);
  assert.equal(out.breakdown.scenario, "business");
  assert.equal(out.breakdown.weights.Faithfulness, 25);

  const metrics2 = {
    dimensions: { Faithfulness: 100, Provenance: 0, Narrative: 0, Visual: 0, Editability: 0, Efficiency: 0 },
  };
  const out2 = computeScenarioScore("academic", metrics2);
  assert.equal(out2.breakdown.weights.Provenance, 30);
  assert.ok(out2.score > 0 && out2.score < 100);
});

test("Evaluate: export integration supports mock results for export_report.json", async () => {
  const { runExport } = await import("../../js/agents/export/export-integration.js");
  const deckPackage = makeDeckPackage();

  const report = await runExport(deckPackage, {
    runId: "run_test",
    mock: {
      slidesCount: 2,
      formats: { pptx: { success: true, bytes: 123 }, images: { success: true, count: 2 } },
    },
  });

  assert.equal(report.schemaVersion, "0.1");
  assert.equal(report.runId, "run_test");
  assert.equal(report.slidesCount, 2);
  assert.equal(report.formats.pptx.success, true);
  assert.equal(report.formats.pptx.bytes, 123);
});

test("Evaluate: end-to-end EvaluateStage emits events and returns evaluation_report.json", async () => {
  installDomAndSlideParser();
  try {
    const { TextPrepStage } = await import("../../js/agents/stages/textprep/index.js");
    const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");
    const { EvaluateStage } = await import("../../js/agents/eval/index.js");

    const events = [];
    const emit = (name, record) => events.push({ name, record });

    const runContext = { runId: "run_test", scenario: "business", constraints: { tone: "business" } };
    const textprep = new TextPrepStage();
    const contentPackage = await textprep.execute(runContext, "Hello world.\n".repeat(200), { emit });

    const design = new DesignStage();
    const deckPackage = await design.execute(runContext, contentPackage, { emit });

    const evalStage = new EvaluateStage({ editabilityThreshold: 0.6 });
    const report = await evalStage.execute(runContext, contentPackage, deckPackage, {
      emit,
      exportOptions: {
        mock: { slidesCount: deckPackage.slidesMeta.length, formats: { pptx: { success: true }, images: { success: true, count: 1 } } },
      },
    });

    assert.equal(report.schemaVersion, "0.1");
    assert.equal(report.runId, "run_test");
    assert.equal(typeof report.hardGates.pass, "boolean");
    assert.ok(report.scenarioScore && typeof report.scenarioScore.score === "number");

    assert.ok(events.some((e) => e.name === "evaluate.hardgates.completed"));
    assert.ok(events.some((e) => e.name === "evaluate.scenario_score.completed"));
  } finally {
    uninstallDomAndSlideParser();
  }
});
