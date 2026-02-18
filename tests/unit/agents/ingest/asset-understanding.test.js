import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: vi.fn(),
}));

const modulePath = "../../../../js/agents/ingest/asset-understanding.js";
const promptLoaderPath = "../../../../js/agents/prompts/prompt-loader.js";

function createDeferred() {
  /** @type {(value: string) => void} */
  let resolve;
  /** @type {(reason?: Error) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function getLoadPromptMock() {
  const mod = await import(promptLoaderPath);
  return vi.mocked(mod.loadPrompt);
}

async function importModule() {
  return await import(modulePath);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("getBatchAnalysisPrompt", () => {
  it("returns cached prompt on rapid successive calls", async () => {
    const loadPrompt = await getLoadPromptMock();
    loadPrompt.mockResolvedValue("PROMPT-A");

    const { getBatchAnalysisPrompt } = await importModule();

    const first = await getBatchAnalysisPrompt();
    const second = await getBatchAnalysisPrompt();

    expect(first).toBe("PROMPT-A");
    expect(second).toBe("PROMPT-A");
    expect(loadPrompt).toHaveBeenCalledTimes(1);
  });

  it("falls back to default prompt when loadPrompt throws", async () => {
    const loadPrompt = await getLoadPromptMock();
    loadPrompt.mockRejectedValue(new Error("boom"));

    const { getBatchAnalysisPrompt } = await importModule();
    const result = await getBatchAnalysisPrompt();

    expect(result).toContain("Analyze these images for reuse in presentation slides.");
    expect(loadPrompt).toHaveBeenCalledTimes(1);
  });

  it("does not cache empty prompt values", async () => {
    const loadPrompt = await getLoadPromptMock();
    loadPrompt.mockResolvedValueOnce("").mockResolvedValueOnce("PROMPT-B");

    const { getBatchAnalysisPrompt } = await importModule();

    const first = await getBatchAnalysisPrompt();
    const second = await getBatchAnalysisPrompt();

    expect(first).toBe("");
    expect(second).toBe("PROMPT-B");
    expect(loadPrompt).toHaveBeenCalledTimes(2);
  });

  it("resolves concurrent calls consistently while prompt is pending", async () => {
    const loadPrompt = await getLoadPromptMock();
    const deferred = createDeferred();
    loadPrompt.mockImplementation(() => deferred.promise);

    const { getBatchAnalysisPrompt } = await importModule();

    const p1 = getBatchAnalysisPrompt();
    const p2 = getBatchAnalysisPrompt();

    deferred.resolve("PROMPT-C");

    const [first, second] = await Promise.all([p1, p2]);

    expect(first).toBe("PROMPT-C");
    expect(second).toBe("PROMPT-C");
    expect(loadPrompt).toHaveBeenCalledTimes(2);
  });
});

describe("understandAsset", () => {
  it("returns null for invalid assets and missing requirements", async () => {
    const { understandAsset } = await importModule();

    const cases = [
      null,
      undefined,
      {},
      [],
      { type: "image", data: "" },
      { type: "", data: "x" },
      { type: "image", data: 0 },
    ];

    for (const asset of cases) {
      const result = await understandAsset(asset, {});
      expect(result).toBe(null);
    }

    const result = await understandAsset({ type: "image", data: "img" }, {});
    expect(result).toBe(null);
  });

  it("prefers modelRouter and normalizes response fields", async () => {
    const { understandAsset } = await importModule();

    const modelRouter = {
      call: vi.fn(async (prompt, { usage, images } = {}) => ({
        content: JSON.stringify([
          {
            description: "Desc",
            topics: "topic",
            suggestedUse: ["cover"],
            dominantColors: "blue",
            hasText: 1,
            textContent: "TXT",
          },
        ]),
      })),
    };
    const visionApi = {
      describe: vi.fn(async () => ({ content: "ignored" })),
    };

    const asset = { type: "image", data: "   " };
    const result = await understandAsset(asset, { modelRouter, visionApi });

    expect(result).toEqual({
      description: "Desc",
      category: "other",
      topics: [],
      suggestedUse: ["cover"],
      visualStyle: "",
      dominantColors: [],
      hasText: true,
      textContent: "TXT",
    });

    expect(modelRouter.call).toHaveBeenCalledTimes(1);
    const [prompt, options] = modelRouter.call.mock.calls[0];
    expect(prompt).toContain("Analyze these images");
    expect(options).toEqual({ usage: "vision", images: [asset.data] });
    expect(visionApi.describe).not.toHaveBeenCalled();
  });

  it("accepts numeric string data and returns deep nested objects", async () => {
    const { understandAsset } = await importModule();

    const nested = {
      description: "Nested",
      meta: { level: { deep: { value: Number.MAX_SAFE_INTEGER } } },
    };
    const visionApi = {
      describe: vi.fn(async (image, prompt) => {
        expect(image).toBe("0");
        expect(prompt).toContain("Analyze these images");
        return { content: JSON.stringify(nested) };
      }),
    };

    const asset = { type: "image", data: "0", size: "1024" };
    const result = await understandAsset(asset, { visionApi });

    expect(result.description).toBe("Nested");
    expect(result.meta.level.deep.value).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("handles oversized non-JSON responses and huge asset data", async () => {
    const { understandAsset, getAssetUnderstandingMetrics } = await importModule();

    const longText = "x".repeat(50000);
    const hugeData = "a".repeat(700000);

    const modelRouter = {
      call: vi.fn(async (_prompt, { images } = {}) => {
        expect(images[0].length).toBe(hugeData.length);
        return { content: longText };
      }),
    };

    const asset = { type: "image", data: hugeData, size: Number.MAX_SAFE_INTEGER };
    const result = await understandAsset(asset, { modelRouter });
    const metrics = getAssetUnderstandingMetrics();

    expect(result.description.length).toBe(longText.length);
    expect(result.description.slice(0, 3)).toBe("xxx");
    expect(metrics.oversizedJsonResponses).toBeGreaterThanOrEqual(1);
    expect(metrics.compressionAttempts).toBeGreaterThanOrEqual(1);
  });

  it("returns sanitized error messages when vision calls fail", async () => {
    const { understandAsset } = await importModule();

    const noisyMessage = `  boom\n${"x".repeat(300)}  `;
    const modelRouter = {
      call: vi.fn(async () => {
        throw new Error(noisyMessage);
      }),
    };

    const asset = { type: "image", data: "img" };
    const result = await understandAsset(asset, { modelRouter });

    expect(result.error).toContain("boom");
    expect(result.error).not.toContain("\n");
    expect(result.error.length).toBeLessThanOrEqual(200);
    expect(result.error.endsWith("...")).toBe(true);
  });
});

describe("understandAssets", () => {
  it("resets metrics between runs when requested", async () => {
    const { understandAsset, getAssetUnderstandingMetrics, resetAssetUnderstandingMetrics } = await importModule();
    const modelRouter = { call: vi.fn(async () => ({ content: "x".repeat(50000) })) };

    await understandAsset({ type: "image", data: "img" }, { modelRouter });
    expect(getAssetUnderstandingMetrics().oversizedJsonResponses).toBeGreaterThanOrEqual(1);

    resetAssetUnderstandingMetrics();
    expect(getAssetUnderstandingMetrics().oversizedJsonResponses).toBe(0);
  });

  it("returns empty array for null/undefined/empty/object assets", async () => {
    const { understandAssets } = await importModule();

    expect(await understandAssets(null)).toEqual([]);
    expect(await understandAssets(undefined)).toEqual([]);
    expect(await understandAssets({})).toEqual([]);
    expect(await understandAssets([])).toEqual([]);
  });

  it("filters invalid assets and returns nulls without a vision client", async () => {
    const { understandAssets } = await importModule();

    const assets = [
      { type: "image", data: "img0" },
      { type: "image", data: "" },
      { type: "", data: "img1" },
      { type: "image", data: 0 },
      { type: "image", data: -1, size: "1024" },
      { type: "image", data: Number.MAX_SAFE_INTEGER },
    ];

    const result = await understandAssets(assets, {});

    expect(result.length).toBe(3);
    expect(result).toEqual([null, null, null]);
  });

  it("batches calls and reports progress", async () => {
    const { understandAssets } = await importModule();

    const progress = [];
    const modelRouter = {
      call: vi.fn(async (_prompt, { usage, images } = {}) => {
        expect(usage).toBe("vision");
        return {
          content: JSON.stringify(
            images.map((img) => ({
              description: `desc:${img}`,
              category: "photo",
              topics: [],
              hasText: false,
              textContent: "",
            })),
          ),
        };
      }),
    };

    const assets = Array.from({ length: 6 }, (_, i) => ({
      type: "image",
      data: `img${i}`,
    }));

    const result = await understandAssets(assets, {
      modelRouter,
      onProgress: (update) => progress.push(update),
    });

    expect(result.map((item) => item.description)).toEqual([
      "desc:img0",
      "desc:img1",
      "desc:img2",
      "desc:img3",
      "desc:img4",
      "desc:img5",
    ]);
    expect(modelRouter.call).toHaveBeenCalledTimes(2);
    expect(modelRouter.call.mock.calls[0][1].images.length).toBe(5);
    expect(modelRouter.call.mock.calls[1][1].images.length).toBe(1);
    expect(progress).toEqual([
      { processed: 5, total: 6 },
      { processed: 6, total: 6 },
    ]);
  });

  it("returns sanitized errors when a batch fails", async () => {
    const { understandAssets } = await importModule();

    const modelRouter = {
      call: vi.fn(async () => {
        throw new Error("API error");
      }),
    };

    const assets = [
      { type: "image", data: "img0" },
      { type: "image", data: "img1" },
    ];

    const result = await understandAssets(assets, { modelRouter });

    expect(result).toHaveLength(2);
    expect(result[0].error).toBe("API error");
    expect(result[1].error).toBe("API error");
  });

  it("supports concurrent calls without cross-talk", async () => {
    const { understandAssets } = await importModule();

    const modelRouter = {
      call: vi.fn(async (_prompt, { images } = {}) => ({
        content: JSON.stringify(
          images.map((img) => ({
            description: `desc:${img}`,
          })),
        ),
      })),
    };

    const assetsA = [{ type: "image", data: "a1" }];
    const assetsB = [
      { type: "image", data: "b1" },
      { type: "image", data: "b2" },
    ];

    const [resultA, resultB] = await Promise.all([
      understandAssets(assetsA, { modelRouter }),
      understandAssets(assetsB, { modelRouter }),
    ]);

    expect(resultA.map((item) => item.description)).toEqual(["desc:a1"]);
    expect(resultB.map((item) => item.description)).toEqual(["desc:b1", "desc:b2"]);
    expect(modelRouter.call).toHaveBeenCalledTimes(2);
  });
});
