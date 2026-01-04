import { makeSecureTimestampedId } from "../../../shared/utils/secure-id.js";

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";
function normalizeCategory(category) {
  const c = toNonEmptyString(category).toLowerCase();
  if (c === "uploaded" || c === "upload") return "uploaded";
  if (c === "extracted" || c === "pdf") return "extracted";
  if (c === "video" || c === "videoframes" || c === "frames") return "videoFrames";
  if (c === "generated" || c === "gen") return "generated";
  return "";
}

function inferCategoryFromAsset(asset) {
  const source = toNonEmptyString(asset?.source).toLowerCase();
  if (source === "upload" || source === "uploaded") return "uploaded";
  if (source === "pdf" || source === "extracted") return "extracted";
  if (source === "video" || source === "video_frame" || source === "video-frame") return "videoFrames";
  if (source) return "generated";
  return "generated";
}

function createAssetId() {
  return makeSecureTimestampedId("asset");
}

export class AssetRegistry {
  constructor(initial = {}) {
    this.uploaded = [];
    this.extracted = [];
    this.videoFrames = [];
    this.generated = [];
    this.byId = new Map();
    this.categoryById = new Map();
    this.slideAssetMapping = new Map();

    this._ingestList(initial.uploaded, "uploaded");
    this._ingestList(initial.extracted, "extracted");
    this._ingestList(initial.videoFrames, "videoFrames");
    this._ingestList(initial.generated, "generated");

    if (initial.slideAssetMapping && typeof initial.slideAssetMapping === "object") {
      for (const [slideId, assetIds] of Object.entries(initial.slideAssetMapping)) {
        this.linkToSlide(slideId, assetIds);
      }
    }
  }

  _ingestList(list, category) {
    if (!Array.isArray(list)) return;
    for (const asset of list) {
      this.addAsset(asset, { category });
    }
  }

  addAsset(asset, { category } = {}) {
    if (!asset || typeof asset !== "object") return null;
    const assetId = toNonEmptyString(asset.assetId) || createAssetId();
    const normalizedCategory = normalizeCategory(category) || inferCategoryFromAsset(asset);
    const entry = { ...asset, assetId };

    const prevCategory = this.categoryById.get(assetId);
    if (prevCategory && prevCategory !== normalizedCategory) {
      const prevList = this[prevCategory];
      if (Array.isArray(prevList)) {
        const idx = prevList.findIndex((a) => a?.assetId === assetId);
        if (idx >= 0) prevList.splice(idx, 1);
      }
    }

    const list = this[normalizedCategory] || this.generated;
    const existingIdx = list.findIndex((a) => a?.assetId === assetId);
    if (existingIdx >= 0) list[existingIdx] = entry;
    else list.push(entry);

    this.byId.set(assetId, entry);
    this.categoryById.set(assetId, normalizedCategory || "generated");
    return assetId;
  }

  getAsset(assetId) {
    const id = toNonEmptyString(assetId);
    if (!id) return null;
    return this.byId.get(id) || null;
  }

  linkToSlide(slideId, assetIds) {
    const key = toNonEmptyString(slideId);
    if (!key) return false;
    const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
    const existing = this.slideAssetMapping.get(key) || [];
    const set = new Set(existing);
    for (const id of ids) {
      const normalized = toNonEmptyString(id);
      if (normalized) set.add(normalized);
    }
    this.slideAssetMapping.set(key, [...set]);
    return true;
  }

  getAssetsForSlide(slideId) {
    const key = toNonEmptyString(slideId);
    if (!key) return [];
    const ids = this.slideAssetMapping.get(key) || [];
    return ids.map((id) => this.byId.get(id)).filter(Boolean);
  }

  export() {
    const mapping = {};
    for (const [slideId, assetIds] of this.slideAssetMapping.entries()) {
      mapping[slideId] = assetIds.slice();
    }
    return {
      uploaded: this.uploaded.slice(),
      extracted: this.extracted.slice(),
      videoFrames: this.videoFrames.slice(),
      generated: this.generated.slice(),
      slideAssetMapping: mapping,
    };
  }

  /** JSON.stringify 自动调用 */
  toJSON() {
    return { _v: 1, ...this.export() };
  }

  /** 从 JSON 反序列化 */
  static fromJSON(json) {
    if (!json || typeof json !== "object") return new AssetRegistry();
    return new AssetRegistry(json);
  }
}
