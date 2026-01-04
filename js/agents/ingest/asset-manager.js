import { normalizeText } from "../stages/textprep/normalize.js";
import { AssetMimeType, normalizeAssetMimeType } from "./constants.js";

import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
function hasNodeBuffer() {
  return typeof Buffer !== "undefined" && typeof Buffer.from === "function";
}

function base64ToBytes(base64) {
  const b64 = toNonEmptyString(base64);
  if (!b64) return null;
  if (hasNodeBuffer()) {
    try {
      return new Uint8Array(Buffer.from(b64, "base64"));
    } catch {
      return null;
    }
  }
  if (typeof globalThis.atob !== "function") return null;
  try {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : null;
  if (!arr || arr.length === 0) return "";
  if (hasNodeBuffer()) {
    try {
      return Buffer.from(arr).toString("base64");
    } catch {
      return "";
    }
  }
  if (typeof globalThis.btoa !== "function") return "";
  let bin = "";
  // Chunk to avoid call stack / argument limits.
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    const slice = arr.subarray(i, i + chunk);
    bin += String.fromCharCode(...slice);
  }
  try {
    return globalThis.btoa(bin);
  } catch {
    return "";
  }
}

function parseAssetDataPayload(data) {
  const s = toNonEmptyString(data);
  if (!s) return null;
  if (s.startsWith("data:")) {
    const comma = s.indexOf(",");
    if (comma === -1) return null;
    return { format: "data_uri", base64: s.slice(comma + 1) };
  }
  return { format: "base64", base64: s };
}

function materializeAssetData(asset) {
  if (!asset || typeof asset !== "object") return asset;
  const out = { ...asset };
  delete out._hash;
  delete out._collisionSig;

  if (typeof asset.data === "string" && asset.data) {
    delete out.dataBytes;
    delete out.dataFormat;
    return out;
  }

  const bytes = asset.dataBytes instanceof Uint8Array ? asset.dataBytes : null;
  if (!bytes) {
    delete out.dataBytes;
    delete out.dataFormat;
    return out;
  }

  const base64 = bytesToBase64(bytes);
  const data = asset.dataFormat === "data_uri" ? `data:${toNonEmptyString(asset.mimeType) || "application/octet-stream"};base64,${base64}` : base64;
  out.data = data;
  delete out.dataBytes;
  delete out.dataFormat;
  return out;
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

/**
 * Secondary signature for collision detection.
 *
 * NOTE:
 * - computeAssetHash() uses sampling for large payloads to avoid hashing multi-MB strings.
 * - Sampling can theoretically produce false "dedup" collisions (different payloads mapping to the same sample).
 * - We keep a second, *different* sampling pattern so we can detect (most) collisions and store both assets.
 */
function computeAssetCollisionSignature(asset) {
  const type = toNonEmptyString(asset?.type);
  const mimeType = toNonEmptyString(asset?.mimeType);
  const rawData = toNonEmptyString(asset?.data);

  const SAMPLE_THRESHOLD = 4096;
  const SLICE = 256;
  let dataSignature;
  if (rawData.length > SAMPLE_THRESHOLD) {
    const len = rawData.length;
    const prefix = rawData.slice(0, SLICE);
    const q1Start = Math.max(0, Math.floor(len / 4) - Math.floor(SLICE / 2));
    const midStart = Math.max(0, Math.floor(len / 2) - Math.floor(SLICE / 2));
    const q3Start = Math.max(0, Math.floor((3 * len) / 4) - Math.floor(SLICE / 2));
    const q1 = rawData.slice(q1Start, q1Start + SLICE);
    const mid = rawData.slice(midStart, midStart + SLICE);
    const q3 = rawData.slice(q3Start, q3Start + SLICE);
    const suffix = rawData.slice(-SLICE);
    dataSignature = `${len}:${prefix}:${q1}:${mid}:${q3}:${suffix}`;
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
    this.assetIdsByHash = new Map(); // sha256:* -> string[]
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
    const collisionSig = computeAssetCollisionSignature(normalized);

    const existingIds = this.assetIdsByHash.get(hash) || [];
    let canonicalId = null;

    for (const id of existingIds) {
      const existing = this.assetsById.get(id);
      if (!existing) continue;
      if (toNonEmptyString(existing._collisionSig) === collisionSig) {
        canonicalId = id;
        break;
      }
    }

    if (!canonicalId) {
      // New asset (or hash collision). Ensure we don't overwrite an existing assetId.
      const baseId = toNonEmptyString(normalized.assetId) || defaultAssetIdFromHash(hash);
      let nextId = baseId;
      if (this.assetsById.has(nextId) || existingIds.includes(nextId)) {
        const root = defaultAssetIdFromHash(hash);
        let i = Math.max(2, existingIds.length + 1);
        while (this.assetsById.has(`${root}_c${i}`) || existingIds.includes(`${root}_c${i}`)) i++;
        nextId = `${root}_c${i}`;
      }
      canonicalId = nextId;

      const stored = { ...normalized, assetId: canonicalId, _hash: hash, _collisionSig: collisionSig };

      // Memory: avoid keeping very large base64 strings in RAM; store bytes and reconstruct on demand.
      const rawData = toNonEmptyString(stored.data);
      if (stored.type === "image" && rawData.length > 4096) {
        const parsed = parseAssetDataPayload(rawData);
        const bytes = parsed?.base64 ? base64ToBytes(parsed.base64) : null;
        if (bytes && bytes.length > 0) {
          stored.dataBytes = bytes;
          stored.dataFormat = parsed.format;
          delete stored.data;
        }
      }
      this.assetsById.set(canonicalId, stored);

      const nextList = existingIds.length ? existingIds.slice() : [];
      nextList.push(canonicalId);
      this.assetIdsByHash.set(hash, nextList);
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
    const stored = this.assetsById.get(id) || null;
    return stored ? materializeAssetData(stored) : null;
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
    return Array.from(this.assetsById.values()).map(materializeAssetData);
  }

  /**
   * @returns {number}
   */
  count() {
    return this.assetsById.size;
  }
}
