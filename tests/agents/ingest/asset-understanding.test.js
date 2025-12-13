const test = require("node:test");
const assert = require("node:assert/strict");

test("understandAsset(): returns null when missing requirements", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  assert.equal(await understandAsset(null, {}), null);
  assert.equal(await understandAsset({ type: "image" }, {}), null);
  assert.equal(await understandAsset({ data: "x" }, {}), null);
  assert.equal(await understandAsset({ type: "image", data: "x" }, {}), null);
});

test("understandAsset(): generates description via modelRouter (prefers router over visionApi)", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const routerCalls = [];
  let visionCalls = 0;

  const modelRouter = {
    async call(prompt, { usage, images } = {}) {
      routerCalls.push({ prompt, usage, images });
      if (String(prompt).startsWith("Describe")) return { content: "A concise description." };
      if (String(prompt).startsWith("Extract all")) return { content: "HELLO" };
      return { content: "" };
    },
  };
  const visionApi = {
    async describe() {
      visionCalls++;
      return { content: "should-not-be-used" };
    },
  };

  const asset = { type: "image", data: "data:image/png;base64,AAAA" };
  const out = await understandAsset(asset, { modelRouter, visionApi });

  assert.equal(out.description, "A concise description.");
  assert.equal(out.ocrText, "HELLO");
  assert.equal(visionCalls, 0);
  assert.ok(routerCalls.length >= 2);
  assert.equal(routerCalls[0].usage, "vision");
  assert.deepEqual(routerCalls[0].images, [asset.data]);
});

test("understandAsset(): extracts OCR text via visionApi.describe", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const prompts = [];
  const visionApi = {
    async describe(image, prompt) {
      assert.equal(image, "img0");
      prompts.push(String(prompt));
      if (String(prompt).startsWith("Describe")) return { content: "Desc." };
      if (String(prompt).startsWith("Extract all")) return { content: "Line1\nLine2" };
      throw new Error("unexpected prompt");
    },
  };

  const out = await understandAsset({ type: "diagram", data: "img0" }, { visionApi });
  assert.equal(out.description, "Desc.");
  assert.equal(out.ocrText, "Line1\nLine2");
  assert.ok(prompts.some((p) => p.startsWith("Describe")));
  assert.ok(prompts.some((p) => p.startsWith("Extract all")));
});

test("understandAsset(): parses table structure JSON array", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(image, prompt) {
      assert.equal(image, "table_img");
      const p = String(prompt);
      if (p.startsWith("Describe")) return { content: "A small table." };
      if (p.startsWith("Extract all")) return { content: "Header A  Header B" };
      if (p.startsWith("This is a table")) return { content: "JSON:\n[{\"a\":1,\"b\":2}]\n(end)" };
      throw new Error(`unexpected prompt: ${p}`);
    },
  };

  const out = await understandAsset({ type: "table", data: "table_img" }, { visionApi });
  assert.equal(out.description, "A small table.");
  assert.equal(out.ocrText.includes("Header"), true);
  assert.deepEqual(out.dataTable, [{ a: 1, b: 2 }]);
});

test("understandAsset(): converts formula to LaTeX (no OCR branch)", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const prompts = [];
  const modelRouter = {
    async call(prompt) {
      prompts.push(String(prompt));
      if (String(prompt).startsWith("Describe")) return { content: "Formula image." };
      if (String(prompt).startsWith("Convert this mathematical formula")) return { content: "\\\\frac{a}{b}" };
      return { content: "" };
    },
  };

  const out = await understandAsset({ type: "formula", data: "formula_img" }, { modelRouter });
  assert.equal(out.description, "Formula image.");
  assert.equal(out.formulaLatex, "\\\\frac{a}{b}");
  assert.equal(prompts.some((p) => p.startsWith("Extract all")), false);
});

test("understandAsset(): records tableError on malformed JSON", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(_image, prompt) {
      const p = String(prompt);
      if (p.startsWith("Describe")) return { content: "Bad table." };
      if (p.startsWith("Extract all")) return { content: "" };
      if (p.startsWith("This is a table")) return { content: "[bad]" };
      return { content: "" };
    },
  };

  const out = await understandAsset({ type: "table", data: "x" }, { visionApi });
  assert.equal(out.description, "Bad table.");
  assert.ok(String(out.tableError || "").length > 0);
  assert.equal("dataTable" in out, false);
});

test("understandAssets(): respects concurrency and emits progress", async () => {
  const { understandAssets } = await import("../../../js/agents/ingest/asset-understanding.js");

  let inFlightDesc = 0;
  let maxInFlightDesc = 0;
  const progress = [];

  const modelRouter = {
    async call(prompt, { usage, images } = {}) {
      assert.equal(usage, "vision");
      const p = String(prompt);
      if (p.startsWith("Describe")) {
        inFlightDesc++;
        maxInFlightDesc = Math.max(maxInFlightDesc, inFlightDesc);
        await new Promise((r) => setTimeout(r, 20));
        inFlightDesc--;
        return { content: `desc:${images[0]}` };
      }
      if (p.startsWith("Extract all")) return { content: `ocr:${images[0]}` };
      return { content: "" };
    },
  };

  const assets = Array.from({ length: 5 }, (_, i) => ({ type: "image", data: `img${i}` }));
  const out = await understandAssets(assets, { modelRouter, concurrency: 2, onProgress: (p) => progress.push(p) });

  assert.equal(out.length, 5);
  assert.equal(maxInFlightDesc, 2);
  assert.deepEqual(
    out.map((r) => r.description),
    ["desc:img0", "desc:img1", "desc:img2", "desc:img3", "desc:img4"],
  );
  assert.deepEqual(progress, [
    { processed: 2, total: 5 },
    { processed: 4, total: 5 },
    { processed: 5, total: 5 },
  ]);
});

test("understandAssets(): converts thrown understandAsset errors into {error}", async () => {
  const { understandAssets } = await import("../../../js/agents/ingest/asset-understanding.js");

  const modelRouter = {
    async call() {
      return { content: "unused" };
    },
  };

  const badAsset = {
    type: "image",
    get data() {
      throw new Error("boom");
    },
  };

  const out = await understandAssets([badAsset], { modelRouter, concurrency: 1 });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { error: "boom" });
});

