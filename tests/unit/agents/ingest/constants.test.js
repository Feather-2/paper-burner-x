import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn((size) => Buffer.alloc(size, "a")),
}));

import {
  SourceKind,
  VALID_SOURCE_KINDS,
  DOCUMENT_SOURCE_KINDS,
  MEDIA_SOURCE_KINDS,
  isValidSourceKind,
  normalizeSourceKind,
  AssetMimeType,
  VALID_ASSET_MIME_TYPES,
  isValidAssetMimeType,
  normalizeAssetMimeType,
  ExportFormat,
} from "../../../../js/agents/ingest/constants.js";

const emptyValues = [null, undefined, "", "   ", [], {}];
const boundaryNumbers = [0, -1, Number.MAX_SAFE_INTEGER];
const arrayLikeObject = { 0: "pdf", length: 1 };

const makeDeepObject = (depth = 40) => {
  let node = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    node = { level: node };
  }
  return node;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SourceKind", () => {
  it("maps expected kinds to lowercase values", () => {
    expect(SourceKind.PDF).toBe("pdf");
    expect(SourceKind.DOCX).toBe("docx");
    expect(SourceKind.PPTX).toBe("pptx");
    expect(SourceKind.MARKDOWN).toBe("markdown");
    expect(SourceKind.USER_TEXT).toBe("user_text");
    expect(SourceKind.DIRECT_MERGED).toBe("direct_merged");
    expect(SourceKind.URL).toBe("url");
    expect(SourceKind.FILE).toBe("file");
  });

  it("is frozen with unique values", () => {
    const values = Object.values(SourceKind);
    expect(Object.isFrozen(SourceKind)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("VALID_SOURCE_KINDS", () => {
  it("contains all SourceKind values", () => {
    const values = Object.values(SourceKind);
    values.forEach((value) => {
      expect(VALID_SOURCE_KINDS.has(value)).toBe(true);
    });
    expect(VALID_SOURCE_KINDS.size).toBe(values.length);
  });

  it("rejects non-members and edge inputs", () => {
    const invalid = [...emptyValues, ...boundaryNumbers, "unknown", "123", arrayLikeObject];
    invalid.forEach((value) => {
      expect(VALID_SOURCE_KINDS.has(value)).toBe(false);
    });
  });
});

describe("DOCUMENT_SOURCE_KINDS", () => {
  it("includes only document-related kinds", () => {
    const expected = [
      SourceKind.PDF,
      SourceKind.DOCX,
      SourceKind.PPTX,
      SourceKind.EPUB,
      SourceKind.HTML,
      SourceKind.MARKDOWN,
    ];
    expected.forEach((value) => {
      expect(DOCUMENT_SOURCE_KINDS.has(value)).toBe(true);
    });
    expect(DOCUMENT_SOURCE_KINDS.has(SourceKind.VIDEO)).toBe(false);
    expect(DOCUMENT_SOURCE_KINDS.has(SourceKind.AUDIO)).toBe(false);
  });
});

describe("MEDIA_SOURCE_KINDS", () => {
  it("includes only media-related kinds", () => {
    expect(MEDIA_SOURCE_KINDS.has(SourceKind.VIDEO)).toBe(true);
    expect(MEDIA_SOURCE_KINDS.has(SourceKind.AUDIO)).toBe(true);
    expect(MEDIA_SOURCE_KINDS.has(SourceKind.PDF)).toBe(false);
  });
});

describe("isValidSourceKind", () => {
  it("returns true for every valid SourceKind value", () => {
    Object.values(SourceKind).forEach((value) => {
      expect(isValidSourceKind(value)).toBe(true);
    });
  });

  it("returns false for invalid, empty, and boundary inputs", () => {
    const invalid = [
      ...emptyValues,
      ...boundaryNumbers,
      "unknown",
      "123",
      " PDF ",
      ["pdf"],
      arrayLikeObject,
    ];
    invalid.forEach((value) => {
      expect(isValidSourceKind(value)).toBe(false);
    });
  });

  it("handles concurrent and rapid calls consistently", async () => {
    const values = [SourceKind.PDF, "unknown", null, SourceKind.AUDIO, " HTML "];
    const results = await Promise.all(
      values.map((value) => Promise.resolve(isValidSourceKind(value)))
    );
    expect(results).toEqual([true, false, false, true, false]);

    const burst = Array.from({ length: 50 }, () => isValidSourceKind(SourceKind.MARKDOWN));
    expect(burst.every(Boolean)).toBe(true);
  });
});

describe("normalizeSourceKind", () => {
  it("normalizes case and whitespace for valid values", () => {
    expect(normalizeSourceKind("PDF")).toBe(SourceKind.PDF);
    expect(normalizeSourceKind("  user_text ")).toBe(SourceKind.USER_TEXT);
    expect(normalizeSourceKind("Html")).toBe(SourceKind.HTML);
    expect(normalizeSourceKind("MARKDOWN")).toBe(SourceKind.MARKDOWN);
  });

  it("falls back for invalid and boundary inputs", () => {
    const invalid = [
      ...emptyValues,
      ...boundaryNumbers,
      "unknown",
      "123",
      arrayLikeObject,
      "   ",
    ];
    invalid.forEach((value) => {
      expect(normalizeSourceKind(value)).toBe(SourceKind.MARKDOWN);
    });
  });

  it("handles long strings, deep objects, and concurrent calls", async () => {
    const { randomBytes } = await import("node:crypto");
    const longString = randomBytes(8192).toString("hex");
    const deepObject = makeDeepObject(60);

    expect(normalizeSourceKind(longString)).toBe(SourceKind.MARKDOWN);
    expect(normalizeSourceKind(deepObject)).toBe(SourceKind.MARKDOWN);
    expect(randomBytes).toHaveBeenCalledOnce();

    const values = [SourceKind.PDF, "  epub ", "unknown", null, "AUDIO"];
    const results = await Promise.all(
      values.map((value) => Promise.resolve(normalizeSourceKind(value)))
    );
    expect(results).toEqual([
      SourceKind.PDF,
      SourceKind.EPUB,
      SourceKind.MARKDOWN,
      SourceKind.MARKDOWN,
      SourceKind.AUDIO,
    ]);

    const burst = Array.from({ length: 75 }, () => normalizeSourceKind("PDF"));
    expect([...new Set(burst)]).toEqual([SourceKind.PDF]);
  });
});

describe("AssetMimeType", () => {
  it("maps expected mime strings", () => {
    expect(AssetMimeType.PNG).toBe("image/png");
    expect(AssetMimeType.JPEG).toBe("image/jpeg");
    expect(AssetMimeType.SVG).toBe("image/svg+xml");
    expect(AssetMimeType.ICO).toBe("image/x-icon");
    expect(AssetMimeType.OCTET_STREAM).toBe("application/octet-stream");
  });

  it("is frozen with unique values", () => {
    const values = Object.values(AssetMimeType);
    expect(Object.isFrozen(AssetMimeType)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("VALID_ASSET_MIME_TYPES", () => {
  it("contains all AssetMimeType values and excludes aliases", () => {
    const values = Object.values(AssetMimeType);
    values.forEach((value) => {
      expect(VALID_ASSET_MIME_TYPES.has(value)).toBe(true);
    });
    expect(VALID_ASSET_MIME_TYPES.has("image/jpg")).toBe(false);
    expect(VALID_ASSET_MIME_TYPES.size).toBe(values.length);
  });

  it("rejects empty and boundary inputs", () => {
    const invalid = [...emptyValues, ...boundaryNumbers, "image/jpg", "image/jpeg; charset=utf-8"];
    invalid.forEach((value) => {
      expect(VALID_ASSET_MIME_TYPES.has(value)).toBe(false);
    });
  });
});

describe("isValidAssetMimeType", () => {
  it("returns true for every valid AssetMimeType value", () => {
    Object.values(AssetMimeType).forEach((value) => {
      expect(isValidAssetMimeType(value)).toBe(true);
    });
  });

  it("returns false for invalid, alias, and boundary inputs", () => {
    const invalid = [
      ...emptyValues,
      ...boundaryNumbers,
      "image/jpg",
      "image/jpeg; charset=utf-8",
      "application/json",
      "123",
      arrayLikeObject,
    ];
    invalid.forEach((value) => {
      expect(isValidAssetMimeType(value)).toBe(false);
    });
  });

  it("handles concurrent and rapid calls consistently", async () => {
    const values = [AssetMimeType.PNG, "image/jpg", null, AssetMimeType.GIF];
    const results = await Promise.all(
      values.map((value) => Promise.resolve(isValidAssetMimeType(value)))
    );
    expect(results).toEqual([true, false, false, true]);

    const burst = Array.from({ length: 50 }, () => isValidAssetMimeType(AssetMimeType.WEBP));
    expect(burst.every(Boolean)).toBe(true);
  });
});

describe("normalizeAssetMimeType", () => {
  it("normalizes aliases, parameters, and casing", () => {
    expect(normalizeAssetMimeType("image/jpg")).toBe(AssetMimeType.JPEG);
    expect(normalizeAssetMimeType("IMAGE/PJPEG; q=0.9")).toBe(AssetMimeType.JPEG);
    expect(normalizeAssetMimeType("image/x-png")).toBe(AssetMimeType.PNG);
    expect(normalizeAssetMimeType("image/svg")).toBe(AssetMimeType.SVG);
    expect(normalizeAssetMimeType(" image/png; charset=utf-8 ")).toBe(AssetMimeType.PNG);
  });

  it("falls back for invalid inputs and honors custom fallback", () => {
    const fallback = AssetMimeType.PNG;
    const invalid = [
      ...emptyValues,
      ...boundaryNumbers,
      "unknown/type",
      "123",
      arrayLikeObject,
    ];
    invalid.forEach((value) => {
      expect(normalizeAssetMimeType(value, fallback)).toBe(fallback);
    });
  });

  it("handles large strings, deep objects, and concurrent calls", async () => {
    const { randomBytes } = await import("node:crypto");
    const hugeParam = randomBytes(16384).toString("base64");
    const mime = `image/jpeg; name=${hugeParam}`;

    expect(normalizeAssetMimeType(mime)).toBe(AssetMimeType.JPEG);
    expect(normalizeAssetMimeType(makeDeepObject(20))).toBe(AssetMimeType.OCTET_STREAM);
    expect(randomBytes).toHaveBeenCalledOnce();

    const values = ["image/jpg", "image/png; charset=utf-8", "unknown/type", null];
    const results = await Promise.all(
      values.map((value) => Promise.resolve(normalizeAssetMimeType(value)))
    );
    expect(results).toEqual([
      AssetMimeType.JPEG,
      AssetMimeType.PNG,
      AssetMimeType.OCTET_STREAM,
      AssetMimeType.OCTET_STREAM,
    ]);

    const burst = Array.from({ length: 50 }, () => normalizeAssetMimeType("image/svg"));
    expect([...new Set(burst)]).toEqual([AssetMimeType.SVG]);
  });
});

describe("ExportFormat", () => {
  it("maps expected export formats", () => {
    expect(ExportFormat.PPTX).toBe("pptx");
    expect(ExportFormat.PDF).toBe("pdf");
    expect(ExportFormat.HTML).toBe("html");
    expect(ExportFormat.MARKDOWN).toBe("markdown");
    expect(ExportFormat.JSON).toBe("json");
  });

  it("is frozen with unique values", () => {
    const values = Object.values(ExportFormat);
    expect(Object.isFrozen(ExportFormat)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});
