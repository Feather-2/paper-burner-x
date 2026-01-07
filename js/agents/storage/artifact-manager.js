import { isPlainObject } from "../shared/utils/value-utils.js";

/**
 * @typedef {object} ArtifactItem
 * @property {string} artifactId
 * @property {string} type
 * @property {string=} mime
 * @property {number=} bytes
 * @property {string=} sha256
 * @property {string} storageKey
 * @property {string=} summary
 */

/**
 * @typedef {object} ArtifactManifest
 * @property {string} schemaVersion
 * @property {string} runId
 * @property {string} createdAt
 * @property {ArtifactItem[]} artifacts
 */

const SCHEMA_VERSION = "0.1";

export const SUPPORTED_ARTIFACT_TYPES = [
  "ingest_result.json",
  "content_package.json",
  "deck_package.json",
  "lint_report.json",
  "export_report.json",
  "evaluation_report.json",
  "deepsearch_state.json",
  "condensed_memory.json",
  "plan.json",
  "tool_output.json",
  "vfs_checkpoint.json",
  "vfs_payload.bin",
  "events.jsonl",
];

const _seqByKey = new Map(); // `${runId}::${type}` -> number

function normalizeType(type) {
  return String(type || "").trim();
}

export const ARTIFACT_TYPE_ALIASES = {
  deepsearch_state: "deepsearch_state.json",
  condensed_memory: "condensed_memory.json",
};

/**
 * Canonicalize an artifact type, applying aliases when relevant.
 * @param {unknown} type
 * @returns {string}
 */
export function canonicalArtifactType(type) {
  const t = normalizeType(type);
  if (!t) return t;
  return ARTIFACT_TYPE_ALIASES[t] || t;
}

function sanitizeTypeForId(type) {
  return canonicalArtifactType(type).replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function assertSupportedType(type) {
  const t = canonicalArtifactType(type);
  if (!SUPPORTED_ARTIFACT_TYPES.includes(t)) {
    throw new Error(`Unsupported artifact type: ${t || "(empty)"}`);
  }
  return t;
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function isSupportedArtifactType(type) {
  const t = canonicalArtifactType(type);
  return !!t && SUPPORTED_ARTIFACT_TYPES.includes(t);
}

/**
 * Generate a stable artifact id.
 *
 * @param {string} runId
 * @param {string} type
 * @param {number=} seq
 * @returns {string}
 */
export function generateArtifactId(runId, type, seq) {
  if (!runId || typeof runId !== "string") throw new Error("generateArtifactId(runId, type): runId must be a string");
  const t = assertSupportedType(type);

  let n = seq;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    const key = `${runId}::${t}`;
    const next = (_seqByKey.get(key) || 0) + 1;
    _seqByKey.set(key, next);
    n = next;
  }

  const padded = String(Math.floor(n)).padStart(3, "0");
  return `art_${runId}_${sanitizeTypeForId(t)}_${padded}`;
}

/**
 * Create an empty manifest for a run.
 * @param {string} runId
 * @returns {ArtifactManifest}
 */
export function createManifest(runId) {
  if (!runId || typeof runId !== "string") throw new Error("createManifest(runId): runId must be a string");
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    artifacts: [],
  };
}

/**
 * Add an artifact entry to a manifest (idempotent by `artifactId`).
 *
 * @param {ArtifactManifest} manifest
 * @param {Record<string, any>} artifact
 * @returns {ArtifactManifest}
 */
export function addArtifactToManifest(manifest, artifact) {
  if (!isPlainObject(manifest)) throw new Error("addArtifactToManifest(manifest, artifact): manifest must be an object");
  if (!Array.isArray(manifest.artifacts)) manifest.artifacts = [];
  if (!isPlainObject(artifact)) throw new Error("addArtifactToManifest(manifest, artifact): artifact must be an object");

  const artifactId = artifact.artifactId;
  const type = assertSupportedType(artifact.type);
  const storageKey = artifact.storageKey;
  if (!artifactId || typeof artifactId !== "string") throw new Error("ArtifactItem.artifactId must be a string");
  if (!storageKey || typeof storageKey !== "string") throw new Error("ArtifactItem.storageKey must be a string");

  const item = {
    artifactId,
    type,
    ...(artifact.mime ? { mime: String(artifact.mime) } : {}),
    ...(typeof artifact.bytes === "number" ? { bytes: artifact.bytes } : {}),
    ...(artifact.sha256 ? { sha256: String(artifact.sha256) } : {}),
    storageKey,
    ...(artifact.summary ? { summary: String(artifact.summary) } : {}),
  };

  if (manifest.artifacts.some((a) => a && a.artifactId === artifactId)) {
    return manifest;
  }

  manifest.artifacts.push(item);
  return manifest;
}

/**
 * @param {*} data
 * @returns {Promise<ArrayBuffer>}
 */
async function dataToArrayBuffer(data) {
  if (data === null || data === undefined) return new ArrayBuffer(0);

  if (typeof data === "string") {
    return new TextEncoder().encode(data).buffer;
  }
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return /** @type {ArrayBuffer} */ (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.arrayBuffer();
  }

  if (isPlainObject(data) || Array.isArray(data)) {
    return new TextEncoder().encode(JSON.stringify(data)).buffer;
  }

  return new TextEncoder().encode(String(data)).buffer;
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute a SHA-256 hex digest for arbitrary data (best-effort in browser).
 * @param {unknown} data
 * @returns {Promise<string | undefined>}
 */
export async function computeSha256(data) {
  const buf = await dataToArrayBuffer(data);

  const subtle = globalThis?.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const digest = await subtle.digest("SHA-256", buf);
    return toHex(new Uint8Array(digest));
  }

  // Node fallback (older runtimes)
  try {
    /** @ts-ignore */
    const { createHash } = await import(/* @vite-ignore */ "node:crypto");
    const h = createHash("sha256");
    /** @ts-ignore */
    h.update(Buffer.from(buf));
    return h.digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Serialize an artifact payload for storage (JSON/JSONL handling included).
 * @param {string} type
 * @param {unknown} data
 * @param {{ pretty?: boolean }} [options]
 * @returns {string | Uint8Array}
 */
export function serializeArtifactPayload(type, data, { pretty = false } = {}) {
  const t = assertSupportedType(type);

  if (t.endsWith(".json")) {
    return JSON.stringify(data === undefined ? null : data, null, pretty ? 2 : 0);
  }

  if (t.endsWith(".jsonl")) {
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return data.map((row) => JSON.stringify(row)).join("\n") + (data.length ? "\n" : "");
    if (data && typeof data === "object") return JSON.stringify(data) + "\n";
    return String(data || "");
  }

  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return String(data);
}

/**
 * Deserialize an artifact payload when applicable (JSON only).
 * @param {string} type
 * @param {unknown} raw
 * @returns {unknown}
 */
export function deserializeArtifactPayload(type, raw) {
  const t = assertSupportedType(type);
  if (t.endsWith(".json") && typeof raw === "string") return JSON.parse(raw);
  return raw;
}
