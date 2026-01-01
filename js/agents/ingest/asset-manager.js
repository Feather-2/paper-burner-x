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

/**
 * 计算资产内容哈希 (优化版)
 * 对于大型数据，使用采样策略（长度+前缀+后缀）避免全量字符串化
 */
function computeAssetHash(asset) {
  const type = toNonEmptyString(asset?.type);
  const mimeType = toNonEmptyString(asset?.mimeType);
  const rawData = toNonEmptyString(asset?.data);

  // 优化：对于超过 4KB 的数据，使用采样签名而非全量
  const SAMPLE_THRESHOLD = 4096;
  const SLICE = 512;
  let dataSignature;
  if (rawData.length > SAMPLE_THRESHOLD) {
    // 采样策略：长度 + 前/中(1/3)/中(2/3)/后 512 字符
    // 目的：显著降低“首尾相同但中间不同”的误判概率，同时避免全量 stringify。
    const len = rawData.length;
    const prefix = rawData.slice(0, SLICE);
    const mid1Start = Math.max(0, Math.floor(len / 3) - Math.floor(SLICE / 2));
    const mid2Start = Math.max(0, Math.floor((2 * len) / 3) - Math.floor(SLICE / 2));
    const mid1 = rawData.slice(mid1Start, mid1Start + SLICE);
    const mid2 = rawData.slice(mid2Start, mid2Start + SLICE);
    const suffix = rawData.slice(-SLICE);
    dataSignature = `${len}:${prefix}:${mid1}:${mid2}:${suffix}`;
  } else {
    dataSignature = rawData;
  }

  const signature = JSON.stringify({ type, mimeType, data: dataSignature });
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
