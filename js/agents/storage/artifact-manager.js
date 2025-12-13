const SCHEMA_VERSION = "0.1";

export const SUPPORTED_ARTIFACT_TYPES = [
  "content_package.json",
  "deck_package.json",
  "lint_report.json",
  "export_report.json",
  "evaluation_report.json",
  "events.jsonl",
];

const _seqByKey = new Map(); // `${runId}::${type}` -> number

function normalizeType(type) {
  return String(type || "").trim();
}

function sanitizeTypeForId(type) {
  return normalizeType(type).replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function assertSupportedType(type) {
  const t = normalizeType(type);
  if (!SUPPORTED_ARTIFACT_TYPES.includes(t)) {
    throw new Error(`Unsupported artifact type: ${t}`);
  }
  return t;
}

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

export function createManifest(runId) {
  if (!runId || typeof runId !== "string") throw new Error("createManifest(runId): runId must be a string");
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    artifacts: [],
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

async function dataToArrayBuffer(data) {
  if (data === null || data === undefined) return new ArrayBuffer(0);

  if (typeof data === "string") {
    return new TextEncoder().encode(data).buffer;
  }
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
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

export async function computeSha256(data) {
  const buf = await dataToArrayBuffer(data);

  const subtle = globalThis?.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const digest = await subtle.digest("SHA-256", buf);
    return toHex(new Uint8Array(digest));
  }

  // Node fallback (older runtimes)
  try {
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256");
    h.update(Buffer.from(buf));
    return h.digest("hex");
  } catch {
    return undefined;
  }
}

