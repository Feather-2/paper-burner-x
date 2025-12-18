const test = require("node:test");
const assert = require("node:assert/strict");

test("VisualRenderer: dispatches by renderType + emits unified events", async () => {
  const { VisualRenderer } = await import("../../../js/agents/stages/design/visual-renderer.js");

  const calls = { image: null, svg: null, asset: null };
  const imageGenerator = {
    async generate(slots, _contentPackage, _designSystem, opts) {
      calls.image = { slots, opts };
      return {
        filledSlots: slots.map((s) => ({
          ...s,
          candidates: [{ candidateId: `${s.slotId}_c1`, url: "data:image/png;base64,QUJD" }],
          selectedId: `${s.slotId}_c1`,
        })),
        report: { schemaVersion: "0.1", runId: opts.runId, summary: { planned: slots.length, succeeded: slots.length } },
      };
    },
  };

  const svgGenerator = {
    async generate(slots) {
      calls.svg = { slots };
      return {
        results: slots.map((s) => ({ slotId: s.slotId, svgContent: `<svg id="${s.slotId}"></svg>`, width: 100, height: 50 })),
        report: { schemaVersion: "0.1", planned: slots.length, completed: slots.length, llmGenerated: slots.length, fallback: 0, skipped: 0, errors: [] },
      };
    },
  };

  const assetResolver = {
    resolve(slots) {
      calls.asset = { slots };
      return slots.map((s) => ({ slotId: s.slotId, assetUri: `https://example.com/${s.slotId}.png`, width: 10, height: 10 }));
    },
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const visualSlots = [
    { slotId: "img_1", renderType: "ai-image", imageSpec: { prompt: "P1", style: "flat" }, position: { w: "80%", h: "40%" } },
    { slotId: "svg_1", renderType: "svg", svgSpec: { type: "chart-placeholder", description: "D" } },
    { slotId: "asset_1", renderType: "asset", assetSpec: { assetId: "asset_001" } },
    { slotId: "unknown_1", renderType: "weird", imageSpec: { prompt: "P2" } },
  ];

  const renderer = new VisualRenderer({ imageGenerator, svgGenerator, assetResolver });
  const out = await renderer.render(visualSlots, { runId: "run_vr", constraints: {} }, {}, { emit, runId: "run_vr" });

  assert.equal(calls.svg.slots.map((s) => s.slotId).join(","), "svg_1");
  assert.equal(calls.asset.slots.map((s) => s.slotId).join(","), "asset_1");
  assert.deepEqual(
    calls.image.slots.map((s) => s.slotId).sort(),
    ["img_1", "unknown_1"].sort()
  );
  assert.ok(calls.image.opts && calls.image.opts.runId === "run_vr");

  const names = events.map((e) => e.name);
  assert.deepEqual(names, ["design.visual.render.started", "design.visual.render.completed"]);
  assert.equal(events[0].record.actor, "design");
  assert.equal(events[1].record.status, "completed");
  assert.equal(out.report.runId, "run_vr");
  assert.equal(out.report.planned.total, 4);
  assert.equal(out.report.completed.svg, 1);
  assert.equal(out.report.completed.asset, 1);
});

test("SVGGenerator: generates deterministic SVG and fillSvgPlaceholders patches HTML", async () => {
  const { SVGGenerator, fillSvgPlaceholders } = await import("../../../js/agents/stages/design/svg-generator.js");

  const gen = new SVGGenerator();
  const { results: res } = await gen.generate(
    [
      {
        slotId: "data_flow",
        renderType: "svg",
        position: { w: "80%", h: "10%" },
        svgSpec: {
          type: "flowchart",
          description: "Data flow",
          elements: [{ type: "node", label: "A" }, { type: "node", label: "B" }, { type: "node", label: "C" }],
        },
      },
    ],
    { designTokens: { colors: { primary: "#111111", secondary: "#222222", surface: "#ffffff", text: "#000000", textMuted: "#666666" } } }
  );

  assert.equal(res.length, 1);
  assert.equal(res[0].slotId, "data_flow");
  assert.ok(res[0].svgContent.includes("<svg"));
  assert.ok(Number.isFinite(res[0].width) && res[0].width > 0);

  const html = `<section><div data-el="image-placeholder" id="data_flow" data-slot-id="data_flow" data-render-type="svg"></div></section>`;
  const patched = fillSvgPlaceholders(html, res);
  assert.ok(patched.html.includes('data-el="svg"'));
  assert.ok(patched.html.includes("<svg"));
  assert.ok(!patched.html.includes('data-el="image-placeholder" id="data_flow"'));
});

test("AssetResolver: resolves assetId and fillAssetPlaceholders patches HTML", async () => {
  const { AssetResolver, fillAssetPlaceholders } = await import("../../../js/agents/stages/design/asset-resolver.js");

  const assets = [{ assetId: "asset_001", type: "image", mimeType: "image/png", data: "QUJD", width: 100, height: 80 }];
  const resolver = new AssetResolver(assets);
  const resolved = resolver.resolve([{ slotId: "fig_1", renderType: "asset", assetSpec: { assetId: "asset_001" } }]);

  assert.equal(resolved.length, 1);
  assert.ok(resolved[0].assetUri.startsWith("data:image/png;base64,"));

  const html = `<section><div data-el="image-placeholder" id="fig_1" data-slot-id="fig_1" data-render-type="asset"></div></section>`;
  const patched = fillAssetPlaceholders(html, resolved);
  assert.ok(patched.html.includes('data-el="image"'));
  assert.ok(patched.html.includes('data-src="data:image/png;base64,QUJD"'));
  assert.ok(!patched.html.includes('data-el="image-placeholder" id="fig_1"'));
});

test("SVGGenerator: classifySvgError categorizes errors correctly", async () => {
  const { SVGGenerator } = await import("../../../js/agents/stages/design/svg-generator.js");

  const gen = new SVGGenerator();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  // 测试无模型时的 fatal 错误
  const { results, report } = await gen.generate(
    [{ slotId: "test_1", renderType: "svg", svgSpec: { description: "Test" } }],
    { designTokens: { colors: { primary: "#111", textMuted: "#666" } } },
    { emit, modelRouter: null, aiApiService: null }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].source, "fallback");
  assert.ok(results[0].error);
  assert.equal(results[0].error.level, "fatal");
  assert.equal(results[0].error.code, "CONFIG_OR_AUTH");

  // 验证 report 结构
  assert.ok(report);
  assert.equal(report.llmGenerated, 0);
  assert.equal(report.fallback, 1);
  assert.ok(report.errors.length > 0);
});

test("SVGGenerator: emits design.svg.batch.failed on error", async () => {
  const { SVGGenerator } = await import("../../../js/agents/stages/design/svg-generator.js");

  const gen = new SVGGenerator();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  await gen.generate(
    [{ slotId: "err_1", renderType: "svg", svgSpec: { description: "Fail test" } }],
    { designTokens: { colors: { primary: "#000", textMuted: "#999" } } },
    { emit }
  );

  const failedEvents = events.filter((e) => e.name === "design.svg.batch.failed");
  assert.ok(failedEvents.length > 0, "Should emit batch.failed event");
  assert.ok(failedEvents[0].record.payload.error);
});

test("SVGGenerator: returns structured report with errors array", async () => {
  const { SVGGenerator } = await import("../../../js/agents/stages/design/svg-generator.js");

  const gen = new SVGGenerator();
  const { report } = await gen.generate(
    [
      { slotId: "s1", renderType: "svg", svgSpec: { description: "Test 1" } },
      { slotId: "s2", renderType: "svg", svgSpec: { description: "Test 2" } },
    ],
    { designTokens: { colors: { primary: "#123", textMuted: "#456" } } },
    { emit: () => {} }
  );

  assert.ok(report);
  assert.equal(typeof report.planned, "number");
  assert.equal(typeof report.llmGenerated, "number");
  assert.equal(typeof report.fallback, "number");
  assert.ok(Array.isArray(report.errors));
});

