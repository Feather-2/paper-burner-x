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

async function ensureManifest(runStore, runId) {
  const existing = await runStore.getManifest(runId);
  if (existing) return normalizeManifest(existing, runId);

  const m = createManifest(runId);
  try {
    const artifacts = await runStore.listArtifacts(runId);
    for (const a of artifacts) {
      if (!a || typeof a !== "object") continue;
      if (!a.artifactId || !a.type || !a.storageKey) continue;
      if (!SUPPORTED_ARTIFACT_TYPES.includes(a.type)) continue;
      if (!m.artifacts.some((x) => x?.artifactId === a.artifactId)) {
        m.artifacts.push({
          artifactId: a.artifactId,
          type: a.type,
          ...(a.mime ? { mime: a.mime } : {}),
          ...(typeof a.bytes === "number" ? { bytes: a.bytes } : {}),
          ...(a.sha256 ? { sha256: a.sha256 } : {}),
          storageKey: a.storageKey,
        });
      }
    }
  } catch {
    // ignore
  }

  if (!m.artifacts.some((a) => a?.type === "events.jsonl")) {
    m.artifacts.push({
      artifactId: `art_${runId}_events.jsonl_001`,
      type: "events.jsonl",
      mime: "application/x-ndjson",
      storageKey: `runs/${runId}/events.jsonl`,
    });
  }

  return m;
}

export async function exportRunAsZip(runId, { runStore = new RunStore() } = {}) {
  const JSZip = await getJSZip();
  const zip = new JSZip();

  const manifest = await ensureManifest(runStore, runId);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const eventsJsonl = (await runStore.getArtifact(runId, "events.jsonl")) || "";
  zip.file("events.jsonl", eventsJsonl);

  for (const item of manifest.artifacts || []) {
    if (!item || typeof item !== "object") continue;
    const type = item.type;
    if (!type || typeof type !== "string") continue;
    if (type === "events.jsonl") continue;

    const data = await runStore.getArtifact(runId, type);
    if (data === null || data === undefined) continue;

    if (typeof data === "string") {
      zip.file(type, data);
    } else if (isPlainObject(data) || Array.isArray(data)) {
      zip.file(type, JSON.stringify(data, null, 2));
    } else if (typeof Blob !== "undefined" && data instanceof Blob) {
      zip.file(type, data);
    } else if (data instanceof ArrayBuffer) {
      zip.file(type, data);
    } else if (ArrayBuffer.isView(data)) {
      zip.file(type, data);
    } else {
      zip.file(type, String(data));
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

  const runContext = {
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

    const content = await zip.file(item.type)?.async("string");
    if (!content) continue;

    let data = content;
    if (item.type.endsWith(".json")) {
      try {
        data = JSON.parse(content);
      } catch {
        data = content;
      }
    }

    await runStore.saveArtifact(runId, item.type, data, {
      artifactId: item.artifactId,
      mime: item.mime || (item.type.endsWith(".json") ? "application/json" : undefined),
      ...(typeof item.bytes === "number" ? { bytes: item.bytes } : {}),
      ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
      storageKey: item.storageKey || `runs/${runId}/${item.type}`,
      createdAt: manifest.createdAt,
    });
  }

  await runStore.updateManifest(runId, manifest);
  return runId;
}
