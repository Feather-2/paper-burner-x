import { RunStore, RunStoreConstants } from "./run-store.js";
import { createManifest, SUPPORTED_ARTIFACT_TYPES } from "./artifact-manager.js";

import { isPlainObject } from "../shared/index.js";
import { isNodeLike } from "../shared/index.js";

async function getJSZip() {
  if (globalThis.JSZip) return globalThis.JSZip;
  const mod = await import("jszip");
  return mod.default || mod;
}

function normalizeManifest(manifest, runId) {
  if (!manifest || typeof manifest !== "object") return null;
  if (manifest.runId !== runId) return { ...manifest, runId };
  return manifest;
}

function toSafeFileName(value) {
  return String(value || "").replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveZipPathForArtifact(item) {
  const artifactId = typeof item?.artifactId === "string" ? item.artifactId.trim() : "";
  const type = typeof item?.type === "string" ? item.type.trim() : "";
  if (artifactId) return `artifacts/${toSafeFileName(artifactId)}`;
  const seq = typeof item?.seq === "number" && Number.isFinite(item.seq) && item.seq > 0 ? Math.floor(item.seq) : null;
  const suffix = seq ? `_${String(seq).padStart(3, "0")}` : "";
  return `artifacts/${toSafeFileName(type || "artifact")}${suffix}`;
}

function mergeArtifactItem(target, incoming) {
  const out = target && typeof target === "object" ? { ...target } : {};
  const src = incoming && typeof incoming === "object" ? incoming : {};
  for (const key of ["artifactId", "type", "mime", "bytes", "sha256", "storageKey", "createdAt", "seq", "zipPath"]) {
    if (src[key] !== undefined && src[key] !== null && out[key] === undefined) {
      out[key] = src[key];
    }
  }
  return out;
}

async function ensureManifest(runStore, runId) {
  const existing = normalizeManifest(await runStore.getManifest(runId), runId);
  const m = existing && typeof existing === "object" ? { ...existing } : createManifest(runId);
  if (!Array.isArray(m.artifacts)) m.artifacts = [];

  const byId = new Map();
  for (const item of m.artifacts) {
    const id = typeof item?.artifactId === "string" ? item.artifactId : "";
    if (id) byId.set(id, item);
  }

  try {
    const artifacts = await runStore.listArtifacts(runId);
    for (const a of artifacts) {
      if (!a || typeof a !== "object") continue;
      if (!a.artifactId || !a.type || !a.storageKey) continue;
      if (!SUPPORTED_ARTIFACT_TYPES.includes(a.type)) continue;

      const next = {
        artifactId: a.artifactId,
        type: a.type,
        ...(a.mime ? { mime: a.mime } : {}),
        ...(typeof a.bytes === "number" ? { bytes: a.bytes } : {}),
        ...(a.sha256 ? { sha256: a.sha256 } : {}),
        ...(typeof a.createdAt === "string" ? { createdAt: a.createdAt } : {}),
        ...(typeof a.seq === "number" ? { seq: a.seq } : {}),
        storageKey: a.storageKey,
      };

      if (byId.has(a.artifactId)) {
        const merged = mergeArtifactItem(byId.get(a.artifactId), next);
        byId.set(a.artifactId, merged);
      } else {
        byId.set(a.artifactId, next);
      }
    }
  } catch {
    // ignore
  }

  // Rebuild artifacts array (stable by createdAt/seq when possible).
  m.artifacts = Array.from(byId.values())
    .filter((a) => a && typeof a === "object" && typeof a.type === "string")
    .sort((a, b) => {
      const ta = typeof a.createdAt === "string" ? a.createdAt : "";
      const tb = typeof b.createdAt === "string" ? b.createdAt : "";
      if (ta !== tb) return ta.localeCompare(tb);
      const sa = typeof a.seq === "number" ? a.seq : 0;
      const sb = typeof b.seq === "number" ? b.seq : 0;
      if (sa !== sb) return sa - sb;
      return String(a.artifactId || "").localeCompare(String(b.artifactId || ""));
    });

  if (!m.artifacts.some((a) => a?.type === "events.jsonl")) {
    m.artifacts.push({
      artifactId: `art_${runId}_events.jsonl_001`,
      type: "events.jsonl",
      mime: "application/x-ndjson",
      storageKey: `runs/${runId}/events.jsonl`,
      zipPath: "events.jsonl",
      seq: 1,
    });
  }

  const usedZipPaths = new Set();
  for (const item of m.artifacts) {
    if (!item || typeof item !== "object") continue;
    const type = typeof item.type === "string" ? item.type : "";
    let desired =
      type === "events.jsonl"
        ? "events.jsonl"
        : typeof item.zipPath === "string" && item.zipPath
          ? item.zipPath
          : resolveZipPathForArtifact(item);

    desired = String(desired || "").replaceAll("\\", "/").replace(/\/+/g, "/");
    if (!desired || desired.startsWith("/") || desired.includes("..")) {
      desired = resolveZipPathForArtifact(item);
    }

    let candidate = desired;
    let n = 1;
    while (usedZipPaths.has(candidate)) {
      n += 1;
      candidate = `${desired}_${n}`;
    }

    item.zipPath = candidate;
    usedZipPaths.add(candidate);
  }

  try {
    if (typeof runStore?.getRun === "function") {
      const ctx = await runStore.getRun(runId);
      if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
        m.runContext = ctx;
      }
    }
  } catch {
    // ignore
  }

  return m;
}

/**
 * Export a stored run (manifest + events + artifacts) as a zip archive.
 *
 * @param {string} runId
 * @param {Object} [options]
 * @param {import("./run-store.js").RunStore} [options.runStore]
 * @returns {Promise<Blob|Uint8Array>}
 */
export async function exportRunAsZip(runId, { runStore = new RunStore() } = {}) {
  const JSZip = await getJSZip();
  const zip = new JSZip();

  const manifest = await ensureManifest(runStore, runId);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // 处理 events.jsonl
  const eventsJsonl = (await runStore.getArtifact(runId, "events.jsonl")) || "";
  zip.file("events.jsonl", eventsJsonl);

  // 顺序处理附件，避免同时持有大量内存
  for (const item of manifest.artifacts || []) {
    if (!item || typeof item !== "object") continue;
    const type = item.type;
    if (!type || typeof type !== "string" || type === "events.jsonl") continue;

    const artifactId = typeof item.artifactId === "string" ? item.artifactId : null;
    const zipPath = typeof item.zipPath === "string" && item.zipPath ? item.zipPath : resolveZipPathForArtifact(item);

    // 每次迭代只加载一个附件（优先按 artifactId，避免同 type 多版本覆盖）
    let data = null;
    if (artifactId && typeof runStore.getArtifactById === "function") {
      data = await runStore.getArtifactById(artifactId);
    }
    if (data === null || data === undefined) {
      data = await runStore.getArtifact(runId, type);
    }
    if (data === null || data === undefined) continue;

    try {
      if (typeof data === "string") {
        zip.file(zipPath, data);
      } else if (typeof Blob !== "undefined" && data instanceof Blob) {
        zip.file(zipPath, data);
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        zip.file(zipPath, data);
      } else if (isPlainObject(data) || Array.isArray(data)) {
        zip.file(zipPath, JSON.stringify(data, null, 2));
      } else {
        zip.file(zipPath, String(data));
      }
    } finally {
      // 显式释放对大型数据的引用，辅助垃圾回收
      data = null;
    }
  }

  if (isNodeLike()) {
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    return typeof Blob !== "undefined" ? new Blob([buf]) : buf;
  }

  return await zip.generateAsync({ type: "blob" });
}

function parseJsonl(text) {
  const out = [];
  forEachJsonl(text, (obj) => out.push(obj));
  return out;
}

function forEachJsonl(text, onItem) {
  const cb = typeof onItem === "function" ? onItem : () => {};
  const s = String(text || "");
  if (!s) return;
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const isEnd = i === s.length;
    const ch = isEnd ? "\n" : s[i];
    if (ch !== "\n") continue;
    const line = s.slice(start, i).trim();
    start = i + 1;
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") cb(obj);
    } catch {
      // ignore bad lines
    }
  }
}

async function appendEventsFromJsonl(runStore, runId, text, { batchSize = 200 } = {}) {
  const size = typeof batchSize === "number" && Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 200;
  const batch = [];

  const s = String(text || "");
  if (!s) return 0;

  let appended = 0;
  let start = 0;

  for (let i = 0; i <= s.length; i++) {
    const isEnd = i === s.length;
    const ch = isEnd ? "\n" : s[i];
    if (ch !== "\n") continue;
    const line = s.slice(start, i).trim();
    start = i + 1;
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") batch.push(obj);
    } catch {
      // ignore bad lines
    }
    if (batch.length >= size) {
      const n = batch.length;
      await runStore.appendEvents(runId, batch.splice(0, batch.length));
      appended += n;
    }
  }

  if (batch.length) {
    const n = batch.length;
    await runStore.appendEvents(runId, batch.splice(0, batch.length));
    appended += n;
  }

  return appended;
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteByIndexKey(store, indexName, key) {
  const index = store.index(indexName);
  const req = index.openCursor(key);
  await new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      cursor.delete();
      cursor.continue();
    };
  });
}

function parseSeqFromArtifactId(artifactId) {
  const id = typeof artifactId === "string" ? artifactId : "";
  if (!id) return null;
  const m = id.match(/_(\d{1,})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function bytesForPayload(payload) {
  if (payload === null || payload === undefined) return undefined;
  if (typeof payload === "string") {
    try {
      return new TextEncoder().encode(payload).byteLength;
    } catch {
      return payload.length;
    }
  }
  if (typeof Blob !== "undefined" && payload instanceof Blob) return payload.size;
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  if (ArrayBuffer.isView(payload)) return payload.byteLength;
  return undefined;
}

function isSafeZipPath(path) {
  const p = typeof path === "string" ? path.replaceAll("\\", "/").trim() : "";
  if (!p) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\0")) return false;
  if (p.includes("..")) return false;
  return true;
}

function ensureNonEmptyString(value, name) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new Error(`${name} must be a non-empty string`);
  return s;
}

function normalizeImportOptions(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  return {
    runStore: o.runStore instanceof RunStore ? o.runStore : o.runStore || new RunStore(),
    overwrite: o.overwrite !== false,
    atomic: o.atomic !== false,
    backupOnOverwrite: o.backupOnOverwrite !== false,
    validate: o.validate !== false,
  };
}

function normalizeArtifactItem(item) {
  if (!item || typeof item !== "object") return null;
  const type = typeof item.type === "string" ? item.type.trim() : "";
  if (!type) return null;
  const artifactId = typeof item.artifactId === "string" ? item.artifactId.trim() : "";
  const zipPath = typeof item.zipPath === "string" ? item.zipPath.trim() : "";
  const storageKey = typeof item.storageKey === "string" ? item.storageKey.trim() : "";
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : undefined;
  const mime = typeof item.mime === "string" ? item.mime : undefined;
  const bytes = typeof item.bytes === "number" && Number.isFinite(item.bytes) && item.bytes >= 0 ? item.bytes : undefined;
  const sha256 = typeof item.sha256 === "string" ? item.sha256 : undefined;
  const seq = typeof item.seq === "number" && Number.isFinite(item.seq) && item.seq > 0 ? Math.floor(item.seq) : undefined;
  return {
    artifactId: artifactId || undefined,
    type,
    zipPath: zipPath || undefined,
    storageKey: storageKey || undefined,
    ...(createdAt ? { createdAt } : {}),
    ...(mime ? { mime } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(seq ? { seq } : {}),
  };
}

function resolveZipFile(zip, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const c of list) {
    const p = typeof c === "string" ? c.trim() : "";
    if (!p) continue;
    if (!isSafeZipPath(p)) continue;
    const f = zip.file(p);
    if (f) return { file: f, path: p };
  }
  return null;
}

/**
 * Import a run (manifest + events + artifacts) from a zip archive.
 *
 * @param {Blob|ArrayBuffer|Uint8Array|{ arrayBuffer: () => Promise<ArrayBuffer> }} file
 * @param {Object} [options]
 * @param {import("./run-store.js").RunStore} [options.runStore]
 * @param {boolean} [options.overwrite=true]
 * @param {boolean} [options.atomic=true]
 * @param {boolean} [options.backupOnOverwrite=true]
 * @param {boolean} [options.validate=true]
 * @returns {Promise<string>} runId
 */
export async function importRunFromZip(file, options = {}) {
  const JSZip = await getJSZip();
  const { runStore, overwrite, atomic, backupOnOverwrite, validate } = normalizeImportOptions(options);

  // Default max size: 256 MB to prevent zip bomb / resource exhaustion
  const MAX_ZIP_SIZE = 256 * 1024 * 1024;

  let zipInput = file;
  let inputSize = 0;

  if (typeof Blob !== "undefined" && file instanceof Blob) {
    inputSize = file.size;
    if (inputSize > MAX_ZIP_SIZE) {
      throw new Error(`importRunFromZip: zip file too large (${inputSize} bytes, max ${MAX_ZIP_SIZE})`);
    }
    zipInput = await file.arrayBuffer();
  } else if (file instanceof ArrayBuffer) {
    inputSize = file.byteLength;
    if (inputSize > MAX_ZIP_SIZE) {
      throw new Error(`importRunFromZip: zip file too large (${inputSize} bytes, max ${MAX_ZIP_SIZE})`);
    }
  } else if (ArrayBuffer.isView(file)) {
    inputSize = file.byteLength;
    if (inputSize > MAX_ZIP_SIZE) {
      throw new Error(`importRunFromZip: zip file too large (${inputSize} bytes, max ${MAX_ZIP_SIZE})`);
    }
    zipInput = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  } else if (file && typeof file.arrayBuffer === "function") {
    zipInput = await file.arrayBuffer();
    inputSize = zipInput.byteLength;
    if (inputSize > MAX_ZIP_SIZE) {
      throw new Error(`importRunFromZip: zip file too large (${inputSize} bytes, max ${MAX_ZIP_SIZE})`);
    }
  }

  const zip = await JSZip.loadAsync(zipInput);

  const manifestText = await zip.file("manifest.json")?.async("string");
  if (!manifestText) throw new Error("importRunFromZip(file): missing manifest.json");

  const manifest = JSON.parse(manifestText);
  const runId = ensureNonEmptyString(manifest?.runId, "manifest.runId");

  const baseRunContext = manifest?.runContext && typeof manifest.runContext === "object" && !Array.isArray(manifest.runContext)
    ? manifest.runContext
    : null;

  const runContext = baseRunContext
    ? {
      ...baseRunContext,
      schemaVersion: typeof baseRunContext.schemaVersion === "string" ? baseRunContext.schemaVersion : "0.1",
      runId,
      mode: typeof baseRunContext.mode === "string" && baseRunContext.mode ? baseRunContext.mode : "imported",
      constraints: baseRunContext.constraints && typeof baseRunContext.constraints === "object" ? baseRunContext.constraints : {},
      startedAt: typeof baseRunContext.startedAt === "string" && baseRunContext.startedAt ? baseRunContext.startedAt : (manifest.createdAt || new Date().toISOString()),
    }
    : {
      schemaVersion: "0.1",
      runId,
      mode: "imported",
      constraints: {},
      startedAt: manifest.createdAt || new Date().toISOString(),
    };

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const normalizedArtifacts = artifacts.map(normalizeArtifactItem).filter(Boolean);

  if (validate) {
    if (!manifest || typeof manifest !== "object") throw new Error("importRunFromZip(file): manifest must be an object");
    const seenIds = new Set();
    for (const a of normalizedArtifacts) {
      const t = String(a.type || "");
      if (t === "events.jsonl") continue;
      if (a.artifactId) {
        if (seenIds.has(a.artifactId)) throw new Error(`importRunFromZip(file): duplicate artifactId: ${a.artifactId}`);
        seenIds.add(a.artifactId);
      }
      const candidates = [];
      if (a.zipPath) candidates.push(a.zipPath);
      if (a.artifactId) candidates.push(`artifacts/${toSafeFileName(a.artifactId)}`);
      candidates.push(a.type);
      const hit = resolveZipFile(zip, candidates);
      if (!hit) throw new Error(`importRunFromZip(file): missing artifact payload in zip for type=${a.type}${a.artifactId ? ` artifactId=${a.artifactId}` : ""}`);
    }
  }

  const eventsText = (await zip.file("events.jsonl")?.async("string")) || "";

  // Prefer an atomic multi-store transaction in IndexedDB mode to avoid destructive overwrite failures.
  const canAtomic = atomic !== false && !runStore?.storage;
  if (!canAtomic) {
    let backup = null;
    const existing = await runStore.getRun(runId);
    if (overwrite && existing && backupOnOverwrite) {
      try {
        backup = await exportRunAsZip(runId, { runStore });
      } catch {
        backup = null;
      }
    }

    try {
      if (overwrite && existing) await runStore.deleteRun(runId);
      if (!overwrite) {
        if (existing) throw new Error(`importRunFromZip: run already exists: ${runId}`);
      }

      await runStore.createRun(runContext);
      if (eventsText) await appendEventsFromJsonl(runStore, runId, eventsText, { batchSize: 200 });

      for (const item of normalizedArtifacts) {
        const type = item.type;
        if (!type || type === "events.jsonl") continue;

        const candidates = [];
        if (item.zipPath) candidates.push(item.zipPath);
        if (item.artifactId) candidates.push(`artifacts/${toSafeFileName(item.artifactId)}`);
        candidates.push(type);

        const shouldLoadAsText =
          type.endsWith(".json") ||
          type.endsWith(".jsonl") ||
          (typeof item.mime === "string" && item.mime.startsWith("text/")) ||
          (typeof item.mime === "string" && item.mime.includes("json"));

        const hit = resolveZipFile(zip, candidates);
        if (!hit) throw new Error(`importRunFromZip(file): missing artifact payload for ${type}`);

        const content = shouldLoadAsText ? await hit.file.async("string") : await hit.file.async("uint8array");
        let data = content;
        if (shouldLoadAsText && typeof content === "string" && type.endsWith(".json")) {
          try {
            data = JSON.parse(content);
          } catch {
            data = content;
          }
        }

        const seq = item.seq || parseSeqFromArtifactId(item.artifactId) || 1;
        const artifactId = item.artifactId || `art_${runId}_${toSafeFileName(type)}_${String(seq).padStart(3, "0")}`;

        await runStore.saveArtifact(runId, type, data, {
          artifactId,
          ...(item.mime ? { mime: item.mime } : {}),
          ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
          ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
          storageKey: item.storageKey || `runs/${runId}/${type}`,
          createdAt: item.createdAt || manifest.createdAt,
          seq,
        });
      }

      await runStore.updateManifest(runId, manifest);
      return runId;
    } catch (err) {
      // Best-effort rollback when running without IndexedDB atomic transactions.
      if (backup) {
        try {
          await importRunFromZip(backup, { runStore, overwrite: true, atomic: false, backupOnOverwrite: false, validate: false });
        } catch {
          // ignore rollback failures
        }
      }
      throw err;
    }
  }

  // IndexedDB transactions can't survive async gaps; preload payloads first.
  const artifactsToSave = [];
  for (const item of normalizedArtifacts) {
    const type = typeof item?.type === "string" ? item.type.trim() : "";
    if (!type || type === "events.jsonl") continue;

    const candidates = [];
    if (item.zipPath) candidates.push(item.zipPath);
    if (item.artifactId) candidates.push(`artifacts/${toSafeFileName(item.artifactId)}`);
    candidates.push(type);

    const shouldLoadAsText =
      type.endsWith(".json") ||
      type.endsWith(".jsonl") ||
      (typeof item.mime === "string" && item.mime.startsWith("text/")) ||
      (typeof item.mime === "string" && item.mime.includes("json"));

    const hit = resolveZipFile(zip, candidates);
    if (!hit) continue;

    const content = shouldLoadAsText ? await hit.file.async("string") : await hit.file.async("uint8array");
    const rawBytes = bytesForPayload(content);

    let data = content;
    if (shouldLoadAsText && typeof content === "string" && type.endsWith(".json")) {
      try {
        data = JSON.parse(content);
      } catch {
        data = content;
      }
    }

    const seq = item.seq || parseSeqFromArtifactId(item.artifactId) || 1;
    const artifactId = item.artifactId || `art_${runId}_${toSafeFileName(type)}_${String(seq).padStart(3, "0")}`;

    artifactsToSave.push({
      artifactId,
      type,
      data,
      seq,
      createdAt: item.createdAt || manifest.createdAt,
      mime: item.mime,
      bytes: typeof item.bytes === "number" ? item.bytes : rawBytes,
      sha256: typeof item.sha256 === "string" ? item.sha256 : undefined,
      storageKey: item.storageKey || `runs/${runId}/${type}`,
    });
  }

  const db = await runStore.open();
  if (!db) throw new Error("importRunFromZip: IndexedDB unavailable");

  const { STORE_RUNS, STORE_ARTIFACTS, STORE_EVENTS, STORE_COUNTERS } = RunStoreConstants;
  const tx = db.transaction([STORE_RUNS, STORE_ARTIFACTS, STORE_EVENTS, STORE_COUNTERS], "readwrite");
  const runsStore = tx.objectStore(STORE_RUNS);
  const artifactsStore = tx.objectStore(STORE_ARTIFACTS);
  const eventsStore = tx.objectStore(STORE_EVENTS);
  const countersStore = tx.objectStore(STORE_COUNTERS);

  const nowIso = new Date().toISOString();

  if (overwrite) {
    runsStore.delete(runId);
    await deleteByIndexKey(artifactsStore, "byRunId", IDBKeyRange.only(runId));
    await deleteByIndexKey(eventsStore, "byRunId", IDBKeyRange.only(runId));
    await deleteByIndexKey(countersStore, "byRunId", IDBKeyRange.only(runId));
  } else {
    const existing = await promisifyRequest(runsStore.get(runId));
    if (existing) {
      try {
        tx.abort();
      } catch {
        // ignore
      }
      throw new Error(`importRunFromZip: run already exists: ${runId}`);
    }
  }

  runsStore.put({
    runId,
    runContext,
    createdAt: typeof manifest?.createdAt === "string" ? manifest.createdAt : nowIso,
    updatedAt: nowIso,
    manifest,
  });

  // Chunked JSONL parse to avoid building a large in-memory events array.
  forEachJsonl(eventsText, (evt) => {
    if (!evt || typeof evt !== "object") return;
    if (typeof evt.eventId !== "string" || !evt.eventId) return;
    eventsStore.put(evt.runId === runId ? evt : { ...evt, runId });
  });

  const lastSeqByType = new Map();
  for (const a of artifactsToSave) {
    if (!a || typeof a !== "object") continue;
    const t = typeof a.type === "string" ? a.type : "";
    if (!t) continue;
    const seq = typeof a.seq === "number" && Number.isFinite(a.seq) ? a.seq : 1;
    lastSeqByType.set(t, Math.max(lastSeqByType.get(t) || 0, seq));

    artifactsStore.put({
      artifactId: a.artifactId,
      runId,
      type: t,
      seq,
      createdAt: a.createdAt || nowIso,
      mime: a.mime || (t.endsWith(".json") ? "application/json" : "application/octet-stream"),
      ...(typeof a.bytes === "number" ? { bytes: a.bytes } : {}),
      ...(typeof a.sha256 === "string" ? { sha256: a.sha256 } : {}),
      storageKey: a.storageKey || `runs/${runId}/${t}`,
      data: a.data,
    });
  }

  for (const [t, lastSeq] of lastSeqByType.entries()) {
    if (!t) continue;
    const n = typeof lastSeq === "number" && Number.isFinite(lastSeq) && lastSeq > 0 ? Math.floor(lastSeq) : 1;
    countersStore.put({ runId, type: t, lastSeq: n, updatedAt: nowIso });
  }

  await promisifyTransaction(tx);
  return runId;
}
