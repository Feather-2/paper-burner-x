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
      // 新实现使用批量分析 prompt，返回 JSON 数组
      return {
        content: JSON.stringify([{
          description: "A concise description.",
          category: "photo",
          topics: ["test"],
          hasText: true,
          textContent: "HELLO"
        }])
      };
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
  assert.equal(out.textContent, "HELLO");
  assert.equal(visionCalls, 0);
  assert.ok(routerCalls.length >= 1);
  assert.equal(routerCalls[0].usage, "vision");
  assert.deepEqual(routerCalls[0].images, [asset.data]);
});

test("understandAsset(): extracts text via visionApi.describe", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(image, prompt) {
      assert.equal(image, "img0");
      return {
        content: JSON.stringify([{
          description: "Desc.",
          hasText: true,
          textContent: "Line1\nLine2"
        }])
      };
    },
  };

  const out = await understandAsset({ type: "diagram", data: "img0" }, { visionApi });
  assert.equal(out.description, "Desc.");
  assert.equal(out.textContent, "Line1\nLine2");
});

test("understandAsset(): parses category and topics", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(image, prompt) {
      return {
        content: JSON.stringify([{
          description: "A data table.",
          category: "table",
          topics: ["data", "statistics"],
          hasText: true,
          textContent: "Header A  Header B"
        }])
      };
    },
  };

  const out = await understandAsset({ type: "table", data: "table_img" }, { visionApi });
  assert.equal(out.description, "A data table.");
  assert.equal(out.category, "table");
  assert.deepEqual(out.topics, ["data", "statistics"]);
});

test("understandAsset(): handles non-JSON response gracefully", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const modelRouter = {
    async call(prompt) {
      return { content: "Just a plain text description." };
    },
  };

  const out = await understandAsset({ type: "formula", data: "formula_img" }, { modelRouter });
  // 非 JSON 响应时，description 应该是原始文本
  assert.equal(out.description, "Just a plain text description.");
});

test("understandAsset(): handles malformed JSON gracefully", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(_image, prompt) {
      return { content: "[bad json" };
    },
  };

  const out = await understandAsset({ type: "table", data: "x" }, { visionApi });
  // 解析失败时返回原始文本作为 description
  assert.equal(out.description, "[bad json");
});

test("understandAssets(): processes batch and returns results", async () => {
  const { understandAssets } = await import("../../../js/agents/ingest/asset-understanding.js");

  const progress = [];

  const modelRouter = {
    async call(prompt, { usage, images } = {}) {
      assert.equal(usage, "vision");
      // 返回与图片数量匹配的结果数组
      return {
        content: JSON.stringify(images.map((img, i) => ({
          description: `desc:${img}`,
          category: "photo",
          topics: [],
          hasText: false,
          textContent: ""
        })))
      };
    },
  };

  const assets = Array.from({ length: 5 }, (_, i) => ({ type: "image", data: `img${i}` }));
  const out = await understandAssets(assets, { modelRouter, onProgress: (p) => progress.push(p) });

  assert.equal(out.length, 5);
  assert.deepEqual(
    out.map((r) => r.description),
    ["desc:img0", "desc:img1", "desc:img2", "desc:img3", "desc:img4"],
  );
  // 批量处理会有进度回调
  assert.ok(progress.length >= 1);
});

test("understandAssets(): handles errors gracefully", async () => {
  const { understandAssets } = await import("../../../js/agents/ingest/asset-understanding.js");

  const modelRouter = {
    async call() {
      throw new Error("API error");
    },
  };

  const assets = [{ type: "image", data: "img0" }];
  const out = await understandAssets(assets, { modelRouter });

  assert.equal(out.length, 1);
  assert.ok(out[0].error);
});
