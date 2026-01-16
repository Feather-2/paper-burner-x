import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("Ingest Constants: SourceKind + AssetMimeType validation/normalization", async () => {
  const {
    SourceKind,
    AssetMimeType,
    isValidSourceKind,
    normalizeSourceKind,
    isValidAssetMimeType,
    normalizeAssetMimeType,
  } = await import("../../../js/agents/ingest/constants.js");

  expect(isValidSourceKind(SourceKind.PDF)).toBe(true);
  expect(isValidSourceKind(SourceKind.USER_TEXT)).toBe(true);
  expect(isValidSourceKind(SourceKind.DIRECT_MERGED)).toBe(true);
  expect(isValidSourceKind(SourceKind.URL)).toBe(true);
  expect(isValidSourceKind(SourceKind.FILE)).toBe(true);
  expect(isValidSourceKind("unknown")).toBe(false);

  expect(normalizeSourceKind("PDF")).toBe(SourceKind.PDF);
  expect(normalizeSourceKind("  user_text ")).toBe(SourceKind.USER_TEXT);
  expect(normalizeSourceKind("unknown")).toBe(SourceKind.MARKDOWN);

  expect(isValidAssetMimeType(AssetMimeType.PNG)).toBe(true);
  expect(isValidAssetMimeType(AssetMimeType.JPEG)).toBe(true);
  expect(isValidAssetMimeType("image/jpg")).toBe(false);

  expect(normalizeAssetMimeType("image/jpg")).toBe(AssetMimeType.JPEG);
  expect(normalizeAssetMimeType("image/png; charset=utf-8")).toBe(AssetMimeType.PNG);
  expect(normalizeAssetMimeType("unknown/type")).toBe(AssetMimeType.OCTET_STREAM);
});
