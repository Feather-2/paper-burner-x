import { normalizeText } from "../stages/textprep/normalize.js";
import { AssetMimeType, normalizeAssetMimeType } from "./constants.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function computeAssetHash(asset) {
    const signature = JSON.stringify({
      type: toNonEmptyString(asset?.type),
      mimeType: toNonEmptyString(asset?.mimeType),
      data: toNonEmptyString(asset?.data),
    });
    return normalizeText(signature).textHash;
}

function defaultAssetIdFromHash(hash) {
  const hex = String(hash || "").startsWith("sha256:") ? String(hash).slice("sha256:".length) : String(hash || "");
  return `asset_${hex.slice(0, 12) || "unknown"}`;
}

export class AssetManager {
  constructor() {
    this.assetsById = new Map(); // assetId -> Asset
    this.assetIdByHash = new Map(); // sha256:* -> assetId
    this.assetIdsByDocId = new Map(); // docId -> Set(assetId)
  }

  /**
   * Add an asset, deduplicating by content hash.
   * Returns the canonical assetId stored in the manager.
   * @param {object} asset
   * @returns {string}
   */
  addAsset(asset) {
    if (!isPlainObject(asset)) throw new TypeError("AssetManager.addAsset(asset): asset must be an object");
    const docId = toNonEmptyString(asset.docId);
    if (!docId) throw new Error("AssetManager.addAsset(asset): asset.docId is required");

    const normalized = { ...asset, mimeType: normalizeAssetMimeType(asset?.mimeType, AssetMimeType.OCTET_STREAM) };
    const hash = computeAssetHash(normalized);
    const existingId = this.assetIdByHash.get(hash);
    const canonicalId = existingId || toNonEmptyString(normalized.assetId) || defaultAssetIdFromHash(hash);

    if (!existingId) {
      const stored = { ...normalized, assetId: canonicalId };
      this.assetsById.set(canonicalId, stored);
      this.assetIdByHash.set(hash, canonicalId);
    }

    if (!this.assetIdsByDocId.has(docId)) this.assetIdsByDocId.set(docId, new Set());
    this.assetIdsByDocId.get(docId).add(canonicalId);

    return canonicalId;
  }

  /**
   * @param {object[]} assets
   * @returns {string[]}
   */
  addAssets(assets) {
    if (!Array.isArray(assets)) throw new TypeError("AssetManager.addAssets(assets): assets must be an array");
    const ids = [];
    for (const a of assets) ids.push(this.addAsset(a));
    return ids;
  }

  /**
   * @param {string} assetId
   * @returns {object|null}
   */
  getAsset(assetId) {
    const id = toNonEmptyString(assetId);
    if (!id) return null;
    return this.assetsById.get(id) || null;
  }

  /**
   * @param {string} docId
   * @returns {string[]}
   */
  getAssetIdsForDoc(docId) {
    const id = toNonEmptyString(docId);
    if (!id) return [];
    return Array.from(this.assetIdsByDocId.get(id) || []);
  }

  /**
   * @returns {object[]}
   */
  listAssets() {
    return Array.from(this.assetsById.values());
  }

  /**
   * @returns {number}
   */
  count() {
    return this.assetsById.size;
  }
}
