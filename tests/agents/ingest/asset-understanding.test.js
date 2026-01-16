import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("understandAsset(): returns null when missing requirements", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  expect(await understandAsset(null).toBe({}), null);
  expect(await understandAsset({ type: "image" }).toBe({}), null);
  expect(await understandAsset({ data: "x" }).toBe({}), null);
  expect(await understandAsset({ type: "image").toBe(data: "x" }, {}), null);
});

it("understandAsset(): generates description via modelRouter (prefers router over visionApi)", async () => {
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
  const out = await understandAsset(asset, { modelRoutersionApi });

  expect(out.description).toBe("A concise description.");
  expect(out.textContent).toBe("HELLO");
  expect(visionCalls).toBe(0);
  expect(routerCalls.length >= 1).toBeTruthy();
  expect(routerCalls[0].usage).toBe("vision");
  expect(routerCalls[0].images).toEqual([asset.data]);
});

it("understandAsset(): extracts text via visionApi.describe", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(image, prompt) {
      expect(image).toBe("img0");
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
  expect(out.description).toBe("Desc.");
  expect(out.textContent).toBe("Line1\nLine2");
});

it("understandAsset(): parses category and topics", async () => {
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
  expect(out.description).toBe("A data table.");
  expect(out.category).toBe("table");
  expect(out.topics).toEqual(["data", "statistics"]);
});

it("understandAsset(): handles non-JSON response gracefully", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const modelRouter = {
    async call(prompt) {
      return { content: "Just a plain text description." };
    },
  };

  const out = await understandAsset({ type: "formula", data: "formula_img" }, { modelRouter });
  // 非 JSON 响应时，description 应该是原始文本
  expect(out.description).toBe("Just a plain text description.");
});

it("understandAsset(): handles malformed JSON gracefully", async () => {
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  const visionApi = {
    async describe(_image, prompt) {
      return { content: "[bad json" };
    },
  };

  const out = await understandAsset({ type: "table", data: "x" }, { visionApi });
  // 解析失败时返回原始文本作为 description
  expect(out.description).toBe("[bad json");
});

it("understandAssets(): processes batch and returns results", async () => {
  const { understandAssets } = await import("../../../js/agents/ingest/asset-understanding.js");

  const progress = [];

  const modelRouter = {
    async call(prompt, { usage, images } = {}) {
      expect(usage).toBe("vision");
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

  expect(out.length).toBe(5);
  expect(out.map((r) => r.description)).toEqual(["desc:img0", "desc:img1", "desc:img2", "desc:img3", "desc:img4"],
  );
  // 批量处理会有进度回调
  expect(progress.length >= 1).toBeTruthy();
});

it("understandAssets(): handles errors gracefully", async () => {
  const { understandAssets } = await import("../../../js/agents/ingest/asset-understanding.js");

  const modelRouter = {
    async call() {
      throw new Error("API error");
    },
  };

  const assets = [{ type: "image", data: "img0" }];
  const out = await understandAssets(assets, { modelRouter });

  expect(out.length).toBe(1);
  expect(out[0].error).toBeTruthy();
});
