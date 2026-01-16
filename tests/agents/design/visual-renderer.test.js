import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("VisualRenderer: dispatches by renderType + emits unified events", async () => {
  const { VisualRenderer } = await import("../../../js/agents/stages/design/image/visual-renderer.js");

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

  expect(calls.svg.slots.map((s) => s.slotId).join(").toBe("), "svg_1");
  expect(calls.asset.slots.map((s) => s.slotId).join(").toBe("), "asset_1");
  expect(calls.image.slots.map((s) => s.slotId).sort()).toEqual(["img_1", "unknown_1"].sort()
  );
  expect(calls.image.opts && calls.image.opts.runId === "run_vr").toBeTruthy();

  const names = events.map((e) => e.name);
  expect(names).toEqual(["design.visual.render.started", "design.visual.render.completed"]);
  expect(events[0].record.actor).toBe("design");
  expect(events[1].record.status).toBe("completed");
  expect(out.report.runId).toBe("run_vr");
  expect(out.report.planned.total).toBe(4);
  expect(out.report.completed.svg).toBe(1);
  expect(out.report.completed.asset).toBe(1);
});

it("SVGGenerator: generates deterministic SVG and fillSvgPlaceholders patches HTML", async () => {
  const { SVGGenerator, fillSvgPlaceholders } = await import("../../../js/agents/stages/design/generators/svg-generator.js");

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

  expect(res.length).toBe(1);
  expect(res[0].slotId).toBe("data_flow");
  expect(res[0].svgContent.includes("<svg")).toBeTruthy();
  expect(Number.isFinite(res[0].width) && res[0].width > 0).toBeTruthy();

  const html = `<section><div data-el="image-placeholder" id="data_flow" data-slot-id="data_flow" data-render-type="svg"></div></section>`;
  const patched = fillSvgPlaceholders(html, res);
  expect(patched.html.includes('data-el="svg"')).toBeTruthy();
  expect(patched.html.includes("<svg")).toBeTruthy();
  expect(!patched.html.includes('data-el="image-placeholder" id="data_flow"')).toBeTruthy();
});

it("AssetResolver: resolves assetId and fillAssetPlaceholders patches HTML", async () => {
  const { AssetResolver, fillAssetPlaceholders } = await import("../../../js/agents/stages/design/image/asset-resolver.js");

  const assets = [{ assetId: "asset_001", type: "image", mimeType: "image/png", data: "QUJD", width: 100, height: 80 }];
  const resolver = new AssetResolver(assets);
  const resolved = resolver.resolve([{ slotId: "fig_1", renderType: "asset", assetSpec: { assetId: "asset_001" } }]);

  expect(resolved.length).toBe(1);
  expect(resolved[0].assetUri.startsWith("data:image/png;base64,")).toBeTruthy();

  const html = `<section><div data-el="image-placeholder" id="fig_1" data-slot-id="fig_1" data-render-type="asset"></div></section>`;
  const patched = fillAssetPlaceholders(html, resolved);
  expect(patched.html.includes('data-el="image"')).toBeTruthy();
  expect(patched.html.includes('data-src="data:image/png;base64,QUJD"')).toBeTruthy();
  expect(!patched.html.includes('data-el="image-placeholder" id="fig_1"')).toBeTruthy();
});

it("AssetResolver: fillAssetPlaceholders handles unquoted attrs + self-closing placeholder", async () => {
  const { fillAssetPlaceholders } = await import("../../../js/agents/stages/design/image/asset-resolver.js");

  const html = `<section><div id=fig_1 data-slot-id=fig_1 data-render-type=asset data-el=image-placeholder/></section>`;
  const patched = fillAssetPlaceholders(html, [{ slotId: "fig_1", assetUri: "data:image/png;base64,QUJD", width: 10, height: 10 }]);

  expect(patched.html.includes('data-el="image"')).toBeTruthy();
  expect(patched.html.includes('data-render-type="asset"')).toBeTruthy();
  expect(patched.html.includes('data-src="data:image/png;base64,QUJD"')).toBeTruthy();
  expect(patched.html.includes("image-placeholder")).toBe(false);
});

it("SVGGenerator: classifySvgError categorizes errors correctly", async () => {
  const { SVGGenerator } = await import("../../../js/agents/stages/design/generators/svg-generator.js");

  const gen = new SVGGenerator();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  // 测试无模型时的 fatal 错误
  const { results, report } = await gen.generate(
    [{ slotId: "test_1", renderType: "svg", svgSpec: { description: "Test" } }],
    { designTokens: { colors: { primary: "#111", textMuted: "#666" } } },
    { emit, modelRouter: null, aiApiService: null }
  );

  expect(results.length).toBe(1);
  expect(results[0].source).toBe("fallback");
  expect(results[0].error).toBeTruthy();
  expect(results[0].error.level).toBe("fatal");
  expect(results[0].error.code).toBe("CONFIG_OR_AUTH");

  // 验证 report 结构
  expect(report).toBeTruthy();
  expect(report.llmGenerated).toBe(0);
  expect(report.fallback).toBe(1);
  expect(report.errors.length > 0).toBeTruthy();
});

it("SVGGenerator: emits design.svg.batch.failed on error", async () => {
  const { SVGGenerator } = await import("../../../js/agents/stages/design/generators/svg-generator.js");

  const gen = new SVGGenerator();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  await gen.generate(
    [{ slotId: "err_1", renderType: "svg", svgSpec: { description: "Fail test" } }],
    { designTokens: { colors: { primary: "#000", textMuted: "#999" } } },
    { emit }
  );

  const failedEvents = events.filter((e) => e.name === "design.svg.batch.failed");
  expect(failedEvents.length > 0, "Should emit batch.failed event").toBeTruthy();
  expect(failedEvents[0].record.payload.error).toBeTruthy();
});

it("SVGGenerator: returns structured report with errors array", async () => {
  const { SVGGenerator } = await import("../../../js/agents/stages/design/generators/svg-generator.js");

  const gen = new SVGGenerator();
  const { report } = await gen.generate(
    [
      { slotId: "s1", renderType: "svg", svgSpec: { description: "Test 1" } },
      { slotId: "s2", renderType: "svg", svgSpec: { description: "Test 2" } },
    ],
    { designTokens: { colors: { primary: "#123", textMuted: "#456" } } },
    { emit: () => {} }
  );

  expect(report).toBeTruthy();
  expect(typeof report.planned).toBe("number");
  expect(typeof report.llmGenerated).toBe("number");
  expect(typeof report.fallback).toBe("number");
  expect(Array.isArray(report.errors)).toBeTruthy();
});
