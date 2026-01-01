import { RunStore } from "./run-store.js";
import { createManifest, SUPPORTED_ARTIFACT_TYPES } from "./artifact-manager.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeLike() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

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
  const base = artifactId || type;
  return `artifacts/${toSafeFileName(base || "artifact")}`;
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

  for (const item of m.artifacts) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "events.jsonl") {
      if (typeof item.zipPath !== "string" || !item.zipPath) item.zipPath = "events.jsonl";
      continue;
    }
    if (typeof item.zipPath !== "string" || !item.zipPath) {
      item.zipPath = resolveZipPathForArtifact(item);
    }
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
  const lines = String(text || "").split("\n");
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object") out.push(obj);
    } catch {
      // ignore bad lines
    }
  }
  return out;
}

export async function importRunFromZip(file, { runStore = new RunStore(), overwrite = true } = {}) {
  const JSZip = await getJSZip();
  let zipInput = file;
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    zipInput = await file.arrayBuffer();
  } else if (file && typeof file.arrayBuffer === "function") {
    zipInput = await file.arrayBuffer();
  }

  const zip = await JSZip.loadAsync(zipInput);

  const manifestText = await zip.file("manifest.json")?.async("string");
  if (!manifestText) throw new Error("importRunFromZip(file): missing manifest.json");

  const manifest = JSON.parse(manifestText);
  const runId = manifest?.runId;
  if (!runId || typeof runId !== "string") throw new Error("importRunFromZip(file): manifest.runId must be a string");

  if (overwrite) {
    const existing = await runStore.getRun(runId);
    if (existing) await runStore.deleteRun(runId);
  }

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

  await runStore.createRun(runContext);

  const eventsText = (await zip.file("events.jsonl")?.async("string")) || "";
  if (eventsText) {
    const events = parseJsonl(eventsText);
    await runStore.appendEvents(runId, events);
  }

  for (const item of manifest.artifacts || []) {
    if (!item || typeof item !== "object") continue;
    if (!item.type || typeof item.type !== "string") continue;
    if (item.type === "events.jsonl") {
      await runStore.saveArtifact(runId, "events.jsonl", eventsText, {
        artifactId: item.artifactId,
        mime: item.mime || "application/x-ndjson",
        ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
        ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
        storageKey: item.storageKey || `runs/${runId}/events.jsonl`,
        seq: 1,
      });
      continue;
    }

    const candidates = [];
    if (typeof item.zipPath === "string" && item.zipPath) candidates.push(item.zipPath);
    if (typeof item.artifactId === "string" && item.artifactId) candidates.push(`artifacts/${toSafeFileName(item.artifactId)}`);
    candidates.push(item.type);

    const shouldLoadAsText =
      item.type.endsWith(".json") ||
      item.type.endsWith(".jsonl") ||
      (typeof item.mime === "string" && item.mime.startsWith("text/")) ||
      (typeof item.mime === "string" && item.mime.includes("json"));

    let content = null;
    for (const path of candidates) {
      const f = zip.file(path);
      if (!f) continue;
      content = shouldLoadAsText ? await f.async("string") : await f.async("uint8array");
      break;
    }
    if (!content) continue;

    let data = content;
    if (shouldLoadAsText) {
      if (item.type.endsWith(".json")) {
        try {
          data = JSON.parse(content);
        } catch {
          data = content;
        }
      }
    }

    await runStore.saveArtifact(runId, item.type, data, {
      artifactId: item.artifactId,
      mime: item.mime || (item.type.endsWith(".json") ? "application/json" : undefined),
      ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
      ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
      storageKey: item.storageKey || `runs/${runId}/${item.type}`,
      createdAt: item.createdAt || manifest.createdAt,
      ...(typeof item.seq === "number" ? { seq: item.seq } : {}),
    });
  }

  await runStore.updateManifest(runId, manifest);
  return runId;
}
