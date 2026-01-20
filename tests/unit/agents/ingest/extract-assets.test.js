import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNormalize = vi.hoisted(() => ({
  normalizeText: vi.fn(),
}));

const mockConstants = vi.hoisted(() => ({
  normalizeAssetMimeType: vi.fn(),
}));

const mockShared = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  toNonEmptyString: vi.fn(),
}));

vi.mock("../../../../js/agents/stages/textprep/normalize.js", () => ({
  normalizeText: mockNormalize.normalizeText,
}));

vi.mock("../../../../js/agents/ingest/constants.js", () => ({
  normalizeAssetMimeType: mockConstants.normalizeAssetMimeType,
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: mockShared.isPlainObject,
  toNonEmptyString: mockShared.toNonEmptyString,
}));

import { extractAssetsFromMarkdown } from "../../../../js/agents/ingest/extract-assets.js";

const hashText = (text) => {
  const s = String(text ?? "");
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `sha256:${hash.toString(16)}`;
};

const makeSignature = (mimeType, data) => JSON.stringify({ type: "image", mimeType, data });

const makeAssetId = (signature) => {
  const hash = hashText(signature);
  const hex = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return `asset_${hex.slice(0, 12) || "unknown"}`;
};

const findByData = (assets, data) => assets.find((asset) => asset.data === data);

beforeEach(() => {
  vi.clearAllMocks();

  mockShared.toNonEmptyString.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });

  mockShared.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  mockConstants.normalizeAssetMimeType.mockImplementation((mime) => {
    const raw = String(mime || "").trim().toLowerCase();
    if (!raw) return "application/octet-stream";
    const base = raw.split(";")[0];
    if (!base) return "application/octet-stream";
    if (base === "image/jpg") return "image/jpeg";
    return base;
  });

  mockNormalize.normalizeText.mockImplementation((text) => ({
    textHash: hashText(text),
  }));
});

describe("extractAssetsFromMarkdown", () => {
  it("extracts assets with resolved lookup keys, normalized mime types, and locators", () => {
    const tag1 = "![alpha](images/img-001.png)";
    const tag2 = "![beta](photo-02.jpg)";
    const tag3 = "![gamma](<images/report.gif?x=1#hash>)";
    const markdown = ["Intro", tag1, "Middle", tag2, "End", tag3].join("\n");

    const images = [
      { id: "img-001.png", data: "data:image/png;base64,AAA" },
      { name: "photo-02", data: "data:image/webp;base64,BBB" },
      { filename: "report.gif", data: "data:image/gif;base64,CCC", page: 0 },
    ];

    const assets = extractAssetsFromMarkdown(markdown, images);

    expect(assets).toHaveLength(3);
    expect(mockConstants.normalizeAssetMimeType.mock.calls.map(([arg]) => arg)).toEqual([
      "image/png",
      "image/webp",
      "image/gif",
    ]);

    const asset1 = findByData(assets, "data:image/png;base64,AAA");
    const asset2 = findByData(assets, "data:image/webp;base64,BBB");
    const asset3 = findByData(assets, "data:image/gif;base64,CCC");

    const signature1 = makeSignature("image/png", "data:image/png;base64,AAA");
    const signature2 = makeSignature("image/webp", "data:image/webp;base64,BBB");
    const signature3 = makeSignature("image/gif", "data:image/gif;base64,CCC");

    expect(mockNormalize.normalizeText.mock.calls.map(([arg]) => arg)).toEqual([
      signature1,
      signature2,
      signature3,
    ]);

    expect(asset1?.assetId).toBe(makeAssetId(signature1));
    expect(asset2?.assetId).toBe(makeAssetId(signature2));
    expect(asset3?.assetId).toBe(makeAssetId(signature3));

    expect(asset1?.type).toBe("image");
    expect(asset2?.type).toBe("image");
    expect(asset3?.type).toBe("image");

    expect(asset1?.mimeType).toBe("image/png");
    expect(asset2?.mimeType).toBe("image/webp");
    expect(asset3?.mimeType).toBe("image/gif");

    expect(asset1?.docId).toBe("");
    expect(asset2?.docId).toBe("");
    expect(asset3?.docId).toBe("");

    expect(asset1?.source).toBe("ocr");
    expect(asset2?.source).toBe("ocr");
    expect(asset3?.source).toBe("ocr");

    expect(asset1?.reusable).toBe(true);
    expect(asset2?.reusable).toBe(true);
    expect(asset3?.reusable).toBe(true);

    const tag1Start = markdown.indexOf(tag1);
    const tag2Start = markdown.indexOf(tag2);
    const tag3Start = markdown.indexOf(tag3);

    expect(asset1?.locator).toEqual({
      charStart: tag1Start,
      charEnd: tag1Start + tag1.length,
    });

    expect(asset2?.locator).toEqual({
      charStart: tag2Start,
      charEnd: tag2Start + tag2.length,
    });

    expect(asset3?.locator).toEqual({
      charStart: tag3Start,
      charEnd: tag3Start + tag3.length,
      page: 0,
    });
  });

  it("returns empty for empty/invalid markdown or non-array images and skips invalid entries", () => {
    const baseMarkdown = "![img](img.png)";
    const cases = [
      { markdown: null, images: [] },
      { markdown: undefined, images: [] },
      { markdown: "", images: [] },
      { markdown: "   ", images: [] },
      { markdown: 0, images: [] },
      { markdown: baseMarkdown, images: null },
      { markdown: baseMarkdown, images: undefined },
      { markdown: baseMarkdown, images: {} },
      { markdown: baseMarkdown, images: "123" },
      { markdown: baseMarkdown, images: 0 },
      { markdown: baseMarkdown, images: -1 },
      { markdown: baseMarkdown, images: Number.MAX_SAFE_INTEGER },
    ];

    for (const { markdown, images } of cases) {
      const result = extractAssetsFromMarkdown(markdown, images);
      expect(result).toEqual([]);
    }

    const invalidImages = [
      {},
      { id: "img.png" },
      { data: "data:image/png;base64,AAA" },
      { id: "   ", data: "   " },
      { id: "img.png", data: "" },
      { id: "img.png", data: null },
      null,
      undefined,
    ];

    const result = extractAssetsFromMarkdown(baseMarkdown, invalidImages);
    expect(result).toEqual([]);

    expect(mockConstants.normalizeAssetMimeType).not.toHaveBeenCalled();
    expect(mockNormalize.normalizeText).not.toHaveBeenCalled();
  });

  it("prefers data URL mime and falls back to octet-stream when missing", () => {
    const markdown = "![logo](images/logo.svg)";
    const images = [{ id: "logo", data: "data:;base64,AAA" }];

    const assets = extractAssetsFromMarkdown(markdown, images);

    expect(assets).toHaveLength(1);
    expect(mockConstants.normalizeAssetMimeType).toHaveBeenCalledTimes(1);
    expect(assets[0]?.mimeType).toBe("application/octet-stream");

    const signature = makeSignature("application/octet-stream", "data:;base64,AAA");
    expect(assets[0]?.assetId).toBe(makeAssetId(signature));
  });

  it("includes page locator for finite numeric pages and omits non-numeric ones", () => {
    const tags = [
      "![p0](p0.png)",
      "![pneg](pneg.png)",
      "![pmax](pmax.png)",
      "![pstr](pstr.png)",
      "![pinf](pinf.png)",
    ];
    const markdown = tags.join(" ");

    const images = [
      { id: "p0.png", data: "data:image/png;base64,p0", page: 0 },
      { id: "pneg.png", data: "data:image/png;base64,pn", page: -1 },
      { id: "pmax.png", data: "data:image/png;base64,pm", page: Number.MAX_SAFE_INTEGER },
      { id: "pstr.png", data: "data:image/png;base64,ps", page: "1" },
      { id: "pinf.png", data: "data:image/png;base64,pi", page: Infinity },
    ];

    const assets = extractAssetsFromMarkdown(markdown, images);

    const assetP0 = findByData(assets, "data:image/png;base64,p0");
    const assetPneg = findByData(assets, "data:image/png;base64,pn");
    const assetPmax = findByData(assets, "data:image/png;base64,pm");
    const assetPstr = findByData(assets, "data:image/png;base64,ps");
    const assetPinf = findByData(assets, "data:image/png;base64,pi");

    expect(assetP0?.locator.page).toBe(0);
    expect(assetPneg?.locator.page).toBe(-1);
    expect(assetPmax?.locator.page).toBe(Number.MAX_SAFE_INTEGER);
    expect(assetPstr?.locator.page).toBeUndefined();
    expect(assetPinf?.locator.page).toBeUndefined();

    assets.forEach((asset) => {
      expect(Number.isFinite(asset.locator.charStart)).toBe(true);
      expect(Number.isFinite(asset.locator.charEnd)).toBe(true);
    });
  });

  it("does not invoke normalization when no assets match even if dependencies throw", () => {
    mockNormalize.normalizeText.mockImplementation(() => {
      throw new Error("boom");
    });
    mockConstants.normalizeAssetMimeType.mockImplementation(() => {
      throw new Error("boom");
    });

    const assets = extractAssetsFromMarkdown("no images here", [
      { id: "img.png", data: "data:image/png;base64,AAA" },
    ]);

    expect(assets).toEqual([]);
    expect(mockNormalize.normalizeText).not.toHaveBeenCalled();
    expect(mockConstants.normalizeAssetMimeType).not.toHaveBeenCalled();
  });

  it("supports concurrent and rapid sequential calls without shared state", async () => {
    const markdown = "![a](images/a.png)";
    const images = [{ id: "a.png", data: "data:image/png;base64,AAA" }];

    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(extractAssetsFromMarkdown(markdown, images)))
    );

    results.forEach((result) => {
      expect(result).toHaveLength(1);
      expect(result[0]?.data).toBe("data:image/png;base64,AAA");
    });

    const sequential = [];
    for (let i = 0; i < 3; i += 1) {
      sequential.push(extractAssetsFromMarkdown(markdown, images));
    }

    sequential.forEach((result) => {
      expect(result).toHaveLength(1);
      expect(result[0]?.data).toBe("data:image/png;base64,AAA");
    });

    expect(mockNormalize.normalizeText).toHaveBeenCalledTimes(8);
  });

  it("handles large markdown/data inputs with deep nested metadata", () => {
    const hugeData = "data:image/png;base64," + "a".repeat(100000);
    const tag = "![huge](images/huge.png)";
    const padding = "x".repeat(50000);
    const markdown = `${padding}${tag}${padding}`;

    const deepNested = { level1: { level2: { level3: { level4: { level5: { value: "x" } } } } } };

    const assets = extractAssetsFromMarkdown(markdown, [
      { id: "huge.png", data: hugeData, meta: deepNested },
    ]);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.data).toBe(hugeData);
    const start = markdown.indexOf(tag);
    expect(assets[0]?.locator.charStart).toBe(start);
    expect(assets[0]?.locator.charEnd).toBe(start + tag.length);
  });
});
