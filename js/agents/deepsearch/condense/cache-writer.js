import { DeepSearchState } from "../../stages/deepsearch/state.js";
import {
  addArtifactToManifest,
  canonicalArtifactType,
  computeSha256,
  createManifest,
  generateArtifactId,
  serializeArtifactPayload,
} from "../../storage/artifact-manager.js";

export const DEEPSEARCH_STATE_ARTIFACT_TYPE = "deepsearch_state.json";
export const CONDENSED_MEMORY_ARTIFACT_TYPE = "condensed_memory.json";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function ensureRunStore(runStore) {
  if (!runStore || typeof runStore.saveArtifact !== "function" || typeof runStore.getArtifact !== "function") {
    throw new TypeError("cache-writer: runStore must implement saveArtifact/getArtifact");
  }
  return runStore;
}

function ensureRunId(runId) {
  const id = toNonEmptyString(runId);
  if (!id) throw new Error("cache-writer: runId is required");
  return id;
}

function ensureState(state) {
  if (state instanceof DeepSearchState) return state;
  if (isPlainObject(state)) return DeepSearchState.fromJSON(state);
  throw new TypeError("cache-writer: state must be a DeepSearchState or plain object");
}

async function upsertManifest(runStore, runId, items) {
  if (typeof runStore.getManifest !== "function" || typeof runStore.updateManifest !== "function") return;

  const existing = await runStore.getManifest(runId);
  const manifest = existing && typeof existing === "object" ? existing : createManifest(runId);

  for (const it of items) {
    addArtifactToManifest(manifest, it);
  }

  await runStore.updateManifest(runId, manifest);
}

export async function writeDeepSearchArtifacts({ runStore, runId, state, condensedMemory, pretty = true, updateManifest = true } = {}) {
  const store = ensureRunStore(runStore);
  const rid = ensureRunId(runId);
  const ds = ensureState(state);

  const stateType = canonicalArtifactType(DEEPSEARCH_STATE_ARTIFACT_TYPE);
  const memoryType = canonicalArtifactType(CONDENSED_MEMORY_ARTIFACT_TYPE);

  const statePayload = ds.toJSON();
  const memoryPayload = condensedMemory ?? ds?.L1?.condensedMemory ?? null;

  const stateArtifactId = generateArtifactId(rid, stateType, 1);
  const memoryArtifactId = generateArtifactId(rid, memoryType, 1);

  const stateSha = await computeSha256(statePayload);
  const memorySha = await computeSha256(memoryPayload);

  await store.saveArtifact(rid, stateType, statePayload, {
    artifactId: stateArtifactId,
    storageKey: `runs/${rid}/${stateType}`,
    seq: 1,
    mime: "application/json",
    ...(stateSha ? { sha256: stateSha } : {}),
    bytes: typeof serializeArtifactPayload === "function" ? serializeArtifactPayload(stateType, statePayload, { pretty }).length : undefined,
  });

  await store.saveArtifact(rid, memoryType, memoryPayload, {
    artifactId: memoryArtifactId,
    storageKey: `runs/${rid}/${memoryType}`,
    seq: 1,
    mime: "application/json",
    ...(memorySha ? { sha256: memorySha } : {}),
    bytes: typeof serializeArtifactPayload === "function" ? serializeArtifactPayload(memoryType, memoryPayload, { pretty }).length : undefined,
  });

  if (updateManifest) {
    await upsertManifest(store, rid, [
      {
        artifactId: stateArtifactId,
        type: stateType,
        mime: "application/json",
        storageKey: `runs/${rid}/${stateType}`,
        ...(stateSha ? { sha256: stateSha } : {}),
        summary: "DeepSearch serialized state",
      },
      {
        artifactId: memoryArtifactId,
        type: memoryType,
        mime: "application/json",
        storageKey: `runs/${rid}/${memoryType}`,
        ...(memorySha ? { sha256: memorySha } : {}),
        summary: "DeepSearch condensed memory",
      },
    ]);
  }

  return { stateArtifactId, memoryArtifactId };
}

export async function rebuildDeepSearchStateFromArtifacts({ runStore, runId } = {}) {
  const store = ensureRunStore(runStore);
  const rid = ensureRunId(runId);

  const stateType = canonicalArtifactType(DEEPSEARCH_STATE_ARTIFACT_TYPE);
  const memoryType = canonicalArtifactType(CONDENSED_MEMORY_ARTIFACT_TYPE);

  const rawState = await store.getArtifact(rid, stateType);
  if (rawState === null || rawState === undefined) return null;

  const ds = rawState instanceof DeepSearchState ? rawState : typeof rawState === "string" ? DeepSearchState.deserialize(rawState) : DeepSearchState.fromJSON(rawState);

  const rawMem = await store.getArtifact(rid, memoryType);
  if (rawMem !== null && rawMem !== undefined) {
    ds.L1 = isPlainObject(ds.L1) ? ds.L1 : {};
    ds.L1.condensedMemory = typeof rawMem === "string" ? JSON.parse(rawMem) : rawMem;
  }

  return ds;
}

