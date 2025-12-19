const test = require("node:test");
const assert = require("node:assert/strict");

test("Ingest Constants: SourceKind + AssetMimeType validation/normalization", async () => {
  const {
    SourceKind,
    AssetMimeType,
    isValidSourceKind,
    normalizeSourceKind,
    isValidAssetMimeType,
    normalizeAssetMimeType,
  } = await import("../../../js/agents/ingest/constants.js");

  assert.equal(isValidSourceKind(SourceKind.PDF), true);
  assert.equal(isValidSourceKind(SourceKind.USER_TEXT), true);
  assert.equal(isValidSourceKind(SourceKind.DIRECT_MERGED), true);
  assert.equal(isValidSourceKind(SourceKind.URL), true);
  assert.equal(isValidSourceKind(SourceKind.FILE), true);
  assert.equal(isValidSourceKind("unknown"), false);

  assert.equal(normalizeSourceKind("PDF"), SourceKind.PDF);
  assert.equal(normalizeSourceKind("  user_text "), SourceKind.USER_TEXT);
  assert.equal(normalizeSourceKind("unknown"), SourceKind.MARKDOWN);

  assert.equal(isValidAssetMimeType(AssetMimeType.PNG), true);
  assert.equal(isValidAssetMimeType(AssetMimeType.JPEG), true);
  assert.equal(isValidAssetMimeType("image/jpg"), false);

  assert.equal(normalizeAssetMimeType("image/jpg"), AssetMimeType.JPEG);
  assert.equal(normalizeAssetMimeType("image/png; charset=utf-8"), AssetMimeType.PNG);
  assert.equal(normalizeAssetMimeType("unknown/type"), AssetMimeType.OCTET_STREAM);
});
