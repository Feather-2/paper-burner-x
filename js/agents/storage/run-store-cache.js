import { isPlainObject } from "../shared/index.js";

import {
  DAY_MS,
  STORE_ARTIFACTS,
  encodeUtf8Bytes,
  isPinnedRunContext,
  logger,
  normalizeRetentionConfig,
  parseIsoMs,
  promisifyTransaction,
} from "./run-store-utils.js";

export async function estimateQuota() {
  try {
    const estimate = globalThis?.navigator?.storage?.estimate;
    if (typeof estimate !== "function") return { supported: false };
    const out = await estimate.call(globalThis.navigator.storage);
    return {
      supported: true,
      quota: typeof out?.quota === "number" ? out.quota : undefined,
      usage: typeof out?.usage === "number" ? out.usage : undefined,
    };
  } catch (err) {
    return { supported: false, error: String(err?.message || err) };
  }
}

export async function _maybeWarnQuota({ upcomingBytes = 0, runId, type } = {}) {
  const ratio = this._quotaWarnRatio;
  if (!(ratio > 0)) return;

  const now = Date.now();
  const minInterval = this._quotaCheckIntervalMs;
  const cachedOk = this._lastQuotaInfo && minInterval > 0 && now - this._lastQuotaCheckMs < minInterval;

  const info = cachedOk ? this._lastQuotaInfo : await this.estimateQuota();
  if (!cachedOk) {
    this._lastQuotaInfo = info;
    this._lastQuotaCheckMs = now;
  }

  if (!info || info.supported !== true) return;
  if (typeof info.quota !== "number" || typeof info.usage !== "number") return;

  const quota = info.quota;
  const usage = info.usage;
  if (!(quota > 0) || !(usage >= 0)) return;

  const upcoming = typeof upcomingBytes === "number" && Number.isFinite(upcomingBytes) ? Math.max(0, upcomingBytes) : 0;
  const remaining = quota - usage - upcoming;
  const remainingRatio = remaining / quota;

  if (remainingRatio >= ratio) return;

  // Throttle warnings (avoid spamming during batch writes).
  const warnInterval = Math.max(10_000, minInterval || 0);
  if (now - this._lastQuotaWarnMs < warnInterval) return;
  this._lastQuotaWarnMs = now;

  const payload = {
    runId: typeof runId === "string" ? runId : undefined,
    type: typeof type === "string" ? type : undefined,
    quota,
    usage,
    upcomingBytes: upcoming,
    remaining,
    remainingRatio,
    warnRatio: ratio,
  };

  if (this._onQuotaWarning) {
    try {
      this._onQuotaWarning(payload);
      return;
    } catch {
      // fall through to console
    }
  }

  try {
    logger.warn("[RunStore] Storage quota low; consider exporting/cleaning old runs", payload);
  } catch {
    // ignore
  }

  // Optional: auto cleanup when quota is low (best-effort, throttled).
  const auto = this._autoCleanup;
  const enabled = auto.enabled === null ? false : auto.enabled;
  if (!enabled) return;

  const nowMs = Date.now();
  const minIntervalMs = Math.max(10_000, this._quotaCheckIntervalMs || 0);
  if (nowMs - this._lastCleanupMs < minIntervalMs) return;
  if (this._cleanupPromise) return;

  this._cleanupPromise = Promise.resolve()
    .then(() =>
      this.cleanupRuns({
        retention: auto,
        keepRunIds: typeof runId === "string" && runId ? [runId] : [],
        reason: "quota_low",
      })
    )
    .catch((err) => logger.warn("Store cleanup error", { error: err.message }))
    .finally(() => {
      this._cleanupPromise = null;
      this._lastCleanupMs = Date.now();
    });
}

/**
 * Update retention policy (housekeeping configuration).
 * @param {object} retention
 */
export function setRetentionPolicy(retention) {
  this._retention = normalizeRetentionConfig(retention);
  return this._retention;
}

export async function _estimateRunBytes(runId, { estimateObjectBytes = false } = {}) {
  if (this.storage) return null;
  const id = typeof runId === "string" ? runId.trim() : "";
  if (!id) return null;

  const db = await this.open();
  const tx = db.transaction([STORE_ARTIFACTS], "readonly");
  const store = tx.objectStore(STORE_ARTIFACTS);
  const index = store.index("byRunId");
  const req = index.openCursor(IDBKeyRange.only(id));

  let total = 0;
  await new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      const rec = cursor.value;

      let bytes = typeof rec?.bytes === "number" && Number.isFinite(rec.bytes) ? rec.bytes : null;
      if (bytes === null) {
        const data = rec?.data;
        if (typeof Blob !== "undefined" && data instanceof Blob) bytes = data.size;
        else if (typeof data === "string") bytes = encodeUtf8Bytes(data) ?? data.length;
        else if (data && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) bytes = data.byteLength;
        else if (estimateObjectBytes && (isPlainObject(data) || Array.isArray(data))) {
          try {
            bytes = encodeUtf8Bytes(JSON.stringify(data)) ?? null;
          } catch {
            bytes = null;
          }
        }
      }

      if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) total += bytes;
      cursor.continue();
    };
  });

  await promisifyTransaction(tx);
  return total;
}

export function _estimateRunBytesFromManifest(manifest) {
  const m = manifest && typeof manifest === "object" ? manifest : null;
  if (!m || !Array.isArray(m.artifacts)) return null;
  let total = 0;
  let hasAny = false;
  for (const a of m.artifacts) {
    const bytes = typeof a?.bytes === "number" && Number.isFinite(a.bytes) ? a.bytes : null;
    if (bytes === null) continue;
    hasAny = true;
    total += Math.max(0, bytes);
  }
  return hasAny ? total : null;
}

/**
 * Housekeeping: delete old runs by retention policy.
 *
 * Safe defaults:
 * - Does nothing unless at least one retention knob is set (maxRuns/maxAgeDays/maxTotalBytes)
 * - Keeps "pinned" runs when `keepPinned` is true (default)
 *
 * @param {object} [options]
 * @param {object} [options.retention] Override the store retention policy for this call
 * @param {string[]} [options.keepRunIds] Run IDs that must not be deleted (e.g. current run)
 * @param {boolean} [options.dryRun=false]
 * @param {boolean} [options.estimateObjectBytes=false] Whether to JSON.stringify object payloads when estimating size
 * @param {string} [options.reason]
 * @returns {Promise<{deletedRunIds:string[],keptRunIds:string[],plannedDeleteRunIds:string[],bytesBefore?:number,bytesAfter?:number,reason?:string}>}
 */
export async function cleanupRuns(options = {}) {
  const opts = isPlainObject(options) ? options : {};
  const retention = normalizeRetentionConfig(opts.retention ?? this._retention);
  const { enabled, maxRuns, maxAgeDays, maxTotalBytes, keepPinned, pinnedKey } = retention;
  const dryRun = !!opts.dryRun;
  const estimateObjectBytes = opts.estimateObjectBytes === true;

  if (enabled === false) {
    const records = await this.listRunRecords({ order: "desc", includeContext: false });
    return {
      deletedRunIds: [],
      keptRunIds: records.map((r) => String(r.runId)).filter(Boolean),
      plannedDeleteRunIds: [],
      ...(opts.reason ? { reason: String(opts.reason) } : {}),
    };
  }

  if (!maxRuns && !maxAgeDays && !maxTotalBytes) {
    return { deletedRunIds: [], keptRunIds: [], plannedDeleteRunIds: [], ...(opts.reason ? { reason: String(opts.reason) } : {}) };
  }

  const keepRunIds = new Set(Array.isArray(opts.keepRunIds) ? opts.keepRunIds.map(String).filter(Boolean) : []);

  const records = await this.listRunRecords({ order: "desc", includeContext: keepPinned });

  const pinned = new Set();
  if (keepPinned) {
    for (const r of records) {
      if (!r || typeof r !== "object") continue;
      if (keepRunIds.has(r.runId)) continue;
      if (isPinnedRunContext(r.runContext, pinnedKey)) pinned.add(r.runId);
    }
  }

  const nowMs = Date.now();
  const cutoffMs = maxAgeDays ? nowMs - maxAgeDays * DAY_MS : null;

  const candidates = records
    .map((r) => ({
      runId: r.runId,
      createdAt: r.createdAt,
      createdAtMs: parseIsoMs(r.createdAt) ?? 0,
      manifest: r.manifest ?? null,
    }))
    .filter((r) => r.runId && !keepRunIds.has(r.runId) && !pinned.has(r.runId));

  const deleteSet = new Set();

  if (cutoffMs !== null) {
    for (const r of candidates) {
      const ms = r.createdAtMs || 0;
      if (ms > 0 && ms < cutoffMs) deleteSet.add(r.runId);
    }
  }

  if (maxRuns) {
    const keep = candidates
      .filter((r) => !deleteSet.has(r.runId))
      .slice(0, maxRuns)
      .map((r) => r.runId);
    const keepSet = new Set(keep);
    for (const r of candidates) {
      if (deleteSet.has(r.runId)) continue;
      if (!keepSet.has(r.runId)) deleteSet.add(r.runId);
    }
  }

  let bytesBefore = undefined;
  let bytesAfter = undefined;

  if (maxTotalBytes) {
    const byRunId = new Map();
    for (const r of candidates) byRunId.set(r.runId, r);

    const estimateBytes = async (runId) => {
      const rec = byRunId.get(runId);
      const fromManifest = rec ? this._estimateRunBytesFromManifest(rec.manifest) : null;
      if (typeof fromManifest === "number") return fromManifest;
      const fromStore = await this._estimateRunBytes(runId, { estimateObjectBytes });
      return typeof fromStore === "number" ? fromStore : 0;
    };

    // Compute sizes for kept (including pinned + protected) and for deletable candidates, oldest-first pruning.
    const allKeepIds = new Set([...pinned, ...keepRunIds]);
    const keepCandidates = records.map((r) => String(r.runId)).filter(Boolean);

    const sizes = new Map();
    for (const runId of keepCandidates) {
      if (!runId) continue;
      if (deleteSet.has(runId)) continue;
      sizes.set(runId, await estimateBytes(runId));
    }

    bytesBefore = 0;
    for (const v of sizes.values()) bytesBefore += typeof v === "number" && Number.isFinite(v) ? v : 0;

    // Remove oldest runs until total <= maxTotalBytes.
    let total = bytesBefore;
    if (total > maxTotalBytes) {
      // Order deletable candidates from oldest to newest.
      const deletableOrdered = candidates
        .filter((r) => !deleteSet.has(r.runId))
        .slice()
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
        .map((r) => r.runId);

      for (const runId of deletableOrdered) {
        if (total <= maxTotalBytes) break;
        if (allKeepIds.has(runId)) continue;
        deleteSet.add(runId);
        total -= sizes.get(runId) || 0;
      }
    }

    bytesAfter = bytesBefore;
    for (const runId of deleteSet.values()) {
      if (sizes.has(runId)) bytesAfter -= sizes.get(runId) || 0;
    }
  }

  const createdMsByRunId = new Map(candidates.map((r) => [String(r.runId), r.createdAtMs || 0]));
  const plannedDeleteRunIds = Array.from(deleteSet.values());
  plannedDeleteRunIds.sort((a, b) => {
    const rawAms = createdMsByRunId.get(String(a)) || 0;
    const rawBms = createdMsByRunId.get(String(b)) || 0;
    const ams = rawAms > 0 ? rawAms : Number.POSITIVE_INFINITY;
    const bms = rawBms > 0 ? rawBms : Number.POSITIVE_INFINITY;
    if (ams !== bms) return ams - bms;
    return String(a).localeCompare(String(b));
  });

  const keptRunIds = records.map((r) => String(r.runId)).filter(Boolean).filter((id) => !deleteSet.has(id));

  if (dryRun) {
    return {
      deletedRunIds: [],
      keptRunIds,
      plannedDeleteRunIds,
      ...(bytesBefore !== undefined ? { bytesBefore } : {}),
      ...(bytesAfter !== undefined ? { bytesAfter } : {}),
      ...(opts.reason ? { reason: String(opts.reason) } : {}),
    };
  }

  const deletedRunIds = [];
  for (const runId of plannedDeleteRunIds) {
    try {
      await this.deleteRun(runId);
      deletedRunIds.push(runId);
    } catch {
      // ignore individual delete errors
    }
  }

  const deletedSet = new Set(deletedRunIds);
  return {
    deletedRunIds,
    keptRunIds: records.map((r) => String(r.runId)).filter(Boolean).filter((id) => !deletedSet.has(id)),
    plannedDeleteRunIds,
    ...(bytesBefore !== undefined ? { bytesBefore } : {}),
    ...(bytesAfter !== undefined ? { bytesAfter } : {}),
    ...(opts.reason ? { reason: String(opts.reason) } : {}),
  };
}

export default {
  estimateQuota,
  _maybeWarnQuota,
  setRetentionPolicy,
  _estimateRunBytes,
  _estimateRunBytesFromManifest,
  cleanupRuns,
};
