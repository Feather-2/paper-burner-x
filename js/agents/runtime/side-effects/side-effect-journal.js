import { restoreVfsCheckpoint } from "../../vfs/checkpoints.js";

import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";
function toIso(ts) {
  if (typeof ts === "string" && ts.trim()) return ts;
  const ms = typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now();
  return new Date(ms).toISOString();
}

function normalizeCursor(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/**
 * SideEffectJournal (Browser-first)
 *
 * Tracks "physical" side effects (e.g. VFS writes) so Backtrack/undo can revert them.
 * For now we implement reversible VFS effects via `vfs_checkpoint.json` artifacts.
 */
export class SideEffectJournal {
  constructor({ runStore, runId, vfs, eventBus, logger } = {}) {
    this.runStore = runStore || null;
    this.runId = toNonEmptyString(runId) || null;
    this.vfs = vfs || null;
    this.eventBus = eventBus || null;
    this.logger = logger || null;

    this._entries = [];
    this._seenEventIds = new Set();
    this._unsub = null;
  }

  attachEventBus(eventBus) {
    if (this._unsub) {
      try {
        this._unsub();
      } catch {
        // ignore
      }
      this._unsub = null;
    }

    this.eventBus = eventBus || null;
    if (!this.eventBus || typeof this.eventBus.subscribe !== "function") return;

    this._unsub = this.eventBus.subscribe("vfs.write.*", (evt) => {
      try {
        this._onVfsWriteEvent(evt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`[SideEffectJournal] vfs.write.* handler failed: ${msg}`);
      }
    });
  }

  dispose() {
    if (this._unsub) {
      try {
        this._unsub();
      } catch {
        // ignore
      }
      this._unsub = null;
    }
  }

  getCursor() {
    return this._entries.length;
  }

  listEntries() {
    return this._entries.map((e) => ({ ...e }));
  }

  record(entry) {
    const e = isPlainObject(entry) ? entry : {};
    const kind = toNonEmptyString(e.kind) || "unknown";
    const ts = toIso(e.ts);
    const reversible = e.reversible === true;

    const out = {
      seq: this._entries.length + 1,
      kind,
      ts,
      reversible,
      ...(isPlainObject(e.checkpoint) ? { checkpoint: { ...e.checkpoint } } : {}),
      ...(toNonEmptyString(e.path) ? { path: toNonEmptyString(e.path) } : {}),
      ...(toNonEmptyString(e.op) ? { op: toNonEmptyString(e.op) } : {}),
      ...(toNonEmptyString(e.eventId) ? { eventId: toNonEmptyString(e.eventId) } : {}),
      ...(isPlainObject(e.meta) ? { meta: { ...e.meta } } : {}),
    };

    this._entries.push(out);
    return out;
  }

  async loadFromRunStore({ runId } = {}) {
    const id = toNonEmptyString(runId) || this.runId;
    if (!id) return { ok: false, reason: "missing_runId" };
    if (!this.runStore || typeof this.runStore.getEvents !== "function") return { ok: false, reason: "missing_runStore" };

    let events = [];
    try {
      events = await this.runStore.getEvents(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "load_events_failed", error: msg };
    }

    for (const evt of Array.isArray(events) ? events : []) {
      if (!evt || typeof evt !== "object") continue;
      if (evt.meta?.replay) continue;
      this._onVfsWriteEvent(evt, { allowDuplicates: false });
    }

    return { ok: true, cursor: this.getCursor() };
  }

  async rollbackToCursor(cursor, { reason } = {}) {
    const target = normalizeCursor(cursor);
    if (target === null) return { ok: false, reason: "invalid_cursor" };

    const current = this.getCursor();
    if (target >= current) return { ok: true, rolledBack: 0, cursor: current };

    const vfs = this.vfs;
    const runStore = this.runStore;
    if (!vfs || typeof vfs.writeFile !== "function") {
      return { ok: false, reason: "missing_vfs" };
    }
    if (!runStore || typeof runStore.getArtifactById !== "function") {
      return { ok: false, reason: "missing_runStore" };
    }

    const failures = [];
    let rolledBack = 0;

    for (let i = current - 1; i >= target; i--) {
      const entry = this._entries[i];
      if (!entry) continue;

      if (entry.kind === "vfs_checkpoint" && entry.checkpoint?.artifactId) {
        try {
          await restoreVfsCheckpoint({
            vfs,
            runStore,
            artifactId: entry.checkpoint.artifactId,
          });
          rolledBack += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push({ seq: entry.seq, kind: entry.kind, error: msg });
          this.logger?.warn?.(`[SideEffectJournal] rollback failed for checkpoint ${entry.checkpoint.artifactId}: ${msg}`);
        }
        continue;
      }

      // Unknown/irreversible effect: keep it but note inability to rollback.
      if (entry.reversible) {
        failures.push({ seq: entry.seq, kind: entry.kind, error: "unknown_reversible_effect" });
      }
    }

    // Trim journal to target cursor.
    this._entries = this._entries.slice(0, target);

    try {
      this.eventBus?.emit?.("side_effects.rolled_back", {
        cursorBefore: current,
        cursorAfter: target,
        rolledBack,
        failures,
        reason: toNonEmptyString(reason) || null,
      });
    } catch {
      // ignore
    }

    return { ok: failures.length === 0, rolledBack, failures, cursor: this.getCursor() };
  }

  _onVfsWriteEvent(evt, { allowDuplicates = false } = {}) {
    if (!evt || typeof evt !== "object") return;
    if (evt.meta?.replay) return;

    const eventId = toNonEmptyString(evt.eventId);
    if (eventId) {
      if (!allowDuplicates && this._seenEventIds.has(eventId)) return;
      this._seenEventIds.add(eventId);
    }

    const payload = isPlainObject(evt.payload) ? evt.payload : {};
    const checkpoint = isPlainObject(payload.checkpoint) ? payload.checkpoint : null;
    const artifactId = toNonEmptyString(checkpoint?.artifactId);
    if (!artifactId) return;

    this.record({
      kind: "vfs_checkpoint",
      reversible: true,
      ts: evt.ts,
      eventId,
      op: toNonEmptyString(payload.op) || toNonEmptyString(checkpoint?.op) || "write",
      path: toNonEmptyString(payload.path) || "",
      checkpoint: {
        artifactId,
        type: toNonEmptyString(checkpoint?.type) || "vfs_checkpoint.json",
        ...(toNonEmptyString(payload.path) ? { path: toNonEmptyString(payload.path) } : {}),
      },
    });
  }
}

export default SideEffectJournal;

