import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import {
  MAX_WAL_LINE_SIZE,
  normalizeCursor,
  sanitizeRunId,
  joinVfsPath,
  readTextFromVfs,
  writeTextToVfs,
  appendTextToVfs,
  buildJournalEntry,
  readWalReplayState,
  applyWalReplayState,
  rollbackEntries,
  resolveRollbackDeps,
  applyRollbackResult,
} from "./side-effect-journal-helpers.js";

/**
 * @typedef {object} SideEffectJournalCheckpointRef
 * @property {string} artifactId
 * @property {string=} op
 * @property {string=} type
 * @property {string=} path
 */

/**
 * @typedef {object} SideEffectJournalEntry
 * @property {number} seq
 * @property {string} kind
 * @property {string} ts
 * @property {boolean} reversible
 * @property {SideEffectJournalCheckpointRef=} checkpoint
 * @property {string=} path
 * @property {string=} op
 * @property {string=} eventId
 * @property {Record<string, unknown>=} meta
 */

/**
 * @typedef {object} SideEffectJournalRecordInput
 * @property {string=} kind
 * @property {string|number=} ts
 * @property {boolean=} reversible
 * @property {SideEffectJournalCheckpointRef=} checkpoint
 * @property {string=} path
 * @property {string=} op
 * @property {string=} eventId
 * @property {Record<string, unknown>=} meta
 */

/**
 * @typedef {object} SideEffectJournalRollbackFailure
 * @property {number} seq
 * @property {string} kind
 * @property {string} error
 */

/**
 * @typedef {object} SideEffectJournalEventPayload
 * @property {string=} op
 * @property {string=} path
 * @property {SideEffectJournalCheckpointRef=} checkpoint
 */

/**
 * Interface for RunStore-like objects (DI contract).
 * @typedef {import("../../vfs/checkpoints.js").RunStoreLike} RunStoreLike
 */

/**
 * Interface for storage adapter (DI contract).
 * @typedef {import("../../vfs/checkpoints.js").StorageAdapterLike} StorageAdapterLike
 */

/**
 * Interface for VFS-like objects (DI contract).
 * @typedef {object} VfsLike
 * @property {(path: string) => Promise<boolean>} [exists] - Check if path exists
 * @property {(path: string, recursive?: boolean) => Promise<void>} [mkdir] - Create directory
 * @property {(path: string) => Promise<string|Uint8Array|null>} [read] - Read file
 * @property {(path: string) => Promise<string|null>} [readText] - Read file as text
 * @property {(path: string, data: Uint8Array) => Promise<void>} [write] - Write file
 * @property {(path: string, text: string) => Promise<void>} [writeText] - Write text file
 * @property {(path: string, content: string|Uint8Array) => Promise<void>} [writeFile] - Write file (string or bytes)
 * @property {(path: string, text: string) => Promise<void>} [appendText] - Append text to file
 * @property {(path: string) => Promise<unknown>} [readFile] - Read file (legacy)
 */

/**
 * Interface for EventBus-like objects (DI contract).
 * @typedef {object} EventBusLike
 * @property {(pattern: string, handler: (evt: unknown) => void) => (() => void)} [subscribe] - Subscribe to events
 * @property {(event: string, payload: unknown) => void} [emit] - Emit an event
 */

/**
 * Interface for Logger-like objects (DI contract).
 * @typedef {object} LoggerLike
 * @property {(msg: string, meta?: unknown) => void} [warn] - Log warning message
 * @property {(msg: string, meta?: unknown) => void} [info] - Log info message
 * @property {(msg: string, meta?: unknown) => void} [debug] - Log debug message
 * @property {(msg: string, meta?: unknown) => void} [error] - Log error message
 */

/**
 * @typedef {object} SideEffectJournalOptions
 * @property {RunStoreLike=} runStore - Run store for artifact/event retrieval
 * @property {StorageAdapterLike=} storageAdapter - Storage adapter for persistence
 * @property {string=} runId - The run identifier
 * @property {VfsLike=} vfs - Virtual file system instance
 * @property {EventBusLike=} eventBus - Event bus for VFS write events
 * @property {LoggerLike=} logger - Logger instance
 * @property {boolean=} autoPersist - Auto-persist entries to WAL
 * @property {string=} walDir - WAL directory path
 */

/**
 * @typedef {object} LoadFromRunStoreOptions
 * @property {string=} runId
 */

/**
 * @typedef {object} RollbackOptions
 * @property {string=} reason
 */

/**
 * @typedef {object} PersistResult
 * @property {boolean} ok
 * @property {number=} cursor
 * @property {number=} persisted
 * @property {string=} reason
 * @property {string=} error
 */

/**
 * @typedef {object} ReplayResult
 * @property {boolean} ok
 * @property {number=} cursor
 * @property {number=} recovered
 * @property {string=} reason
 * @property {string=} error
 */

/**
 * @typedef {object} CompactResult
 * @property {boolean} ok
 * @property {number=} before
 * @property {number=} after
 * @property {number=} saved
 * @property {string=} reason
 * @property {string=} error
 */

/**
 * @typedef {object} SideEffectJournalEvent
 * @property {string=} eventId
 * @property {string|number=} ts
 * @property {SideEffectJournalEventPayload=} payload
 * @property {{ replay?: boolean }=} meta
 */

/**
 * SideEffectJournal (Browser-first)
 *
 * Tracks "physical" side effects (e.g. VFS writes) so Backtrack/undo can revert them.
 * For now we implement reversible VFS effects via `vfs_checkpoint.json` artifacts.
 */
export class SideEffectJournal {
  /** @type {RunStoreLike | null} */ runStore;
  /** @type {StorageAdapterLike | null} */ storageAdapter;
  /** @type {string | null} */ runId;
  /** @type {VfsLike | null} */ vfs;
  /** @type {EventBusLike | null} */ eventBus;
  /** @type {LoggerLike | null} */ logger;
  /** @type {boolean} */ autoPersist;
  /** @type {string} */ walDir;

  /** @type {SideEffectJournalEntry[]} */ _entries;
  /** @type {Set<string>} */ _seenEventIds;
  /** @type {(() => void) | null} */ _unsub;
  /** @type {number} */ _persistedCursor;
  /** @type {Promise<void>} */ _persistQueue;
  /** @type {boolean} */ _appendFallbackWarned;
  /** @type {number} */ _appendFallbackCount;
  /** @type {boolean} */ _oversizedWalEntryWarned;
  /** @type {number} */ _oversizedEntryTrimmedCount;
  /** @type {number} */ _oversizedEntrySkippedCount;

  /**
   * @param {SideEffectJournalOptions | undefined} [input]
   */
  constructor({ runStore, storageAdapter, runId, vfs, eventBus, logger, autoPersist, walDir } = {}) {
    this.runStore = runStore || null;
    this.storageAdapter = storageAdapter || null;
    this.runId = toNonEmptyString(runId) || null;
    this.vfs = vfs || null;
    this.eventBus = eventBus || null;
    this.logger = logger || null;
    this.autoPersist = autoPersist === true;
    this.walDir = toNonEmptyString(walDir) || ".agents/wal";

    /** @type {SideEffectJournalEntry[]} */
    this._entries = [];
    /** @type {Set<string>} */
    this._seenEventIds = new Set();
    /** @type {(() => void) | null} */
    this._unsub = null;
    /** @type {number} */
    this._persistedCursor = 0;
    /** @type {Promise<void>} */
    this._persistQueue = Promise.resolve();
    /** @type {boolean} */
    this._appendFallbackWarned = false;
    /** @type {number} */
    this._appendFallbackCount = 0;
    /** @type {boolean} */
    this._oversizedWalEntryWarned = false;
    /** @type {number} */
    this._oversizedEntryTrimmedCount = 0;
    /** @type {number} */
    this._oversizedEntrySkippedCount = 0;
  }

  /**
   * Initialize journal by recovering persisted cursor from WAL.
   * @returns {Promise<{ ok: boolean, cursor?: number, reason?: string, error?: string }>}
   */
  async init() {
    const runId = this.runId;
    if (!runId) return { ok: false, reason: "missing_runId" };

    const vfs = this.vfs;
    if (!vfs || typeof vfs !== "object") return { ok: false, reason: "missing_vfs" };

    const walPath = this._getWalPath(runId);
    if (!walPath) return { ok: false, reason: "missing_wal_path" };

    try {
      const text = await readTextFromVfs(vfs, walPath);
      if (!text) {
        return { ok: true, cursor: 0 };
      }

      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      let maxSeq = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (typeof entry?.seq === "number" && entry.seq > maxSeq) {
            maxSeq = entry.seq;
          }
        } catch (e) {
          // Skip invalid lines
        }
      }

      this._persistedCursor = maxSeq;
      return { ok: true, cursor: maxSeq };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[SideEffectJournal] init failed: ${msg}`);
      return { ok: false, reason: "init_failed", error: msg };
    }
  }

  /**
   * Attach an EventBus to listen for VFS write events.
   * @param {EventBusLike | null | undefined} eventBus - The EventBus instance
   * @returns {void}
   */
  attachEventBus(eventBus) {
    if (this._unsub) {
      try {
        this._unsub();
      } catch (e) {
        this.logger?.warn?.(`[SideEffectJournal] Failed to unsubscribe previous listener: ${e instanceof Error ? e.message : String(e)}`);
      }
      this._unsub = null;
    }

    this.eventBus = eventBus || null;
    if (!this.eventBus || typeof this.eventBus.subscribe !== "function") return;

    this._unsub = this.eventBus.subscribe("vfs:write:*", (evt) => {
      try {
        this._onVfsWriteEvent(evt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`[SideEffectJournal] vfs:write:* handler failed: ${msg}`);
      }
    });
  }

  /**
   * Dispose the journal and unsubscribe from events.
   * @returns {void}
   */
  dispose() {
    if (this._unsub) {
      try {
        this._unsub();
      } catch (e) {
        this.logger?.warn?.(`[SideEffectJournal] dispose unsubscribe failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      this._unsub = null;
    }
  }

  /**
   * Get the current journal cursor (entry count).
   * @returns {number} The current cursor position
   */
  getCursor() {
    return this._entries.length;
  }

  /**
   * List all journal entries (shallow copies).
   * @returns {SideEffectJournalEntry[]} Array of journal entries
   */
  listEntries() {
    return this._entries.map((e) => ({ ...e }));
  }

  /**
   * @param {SideEffectJournalRecordInput} entry
   * @param {{ persist?: boolean } | undefined} [options]
   * @returns {SideEffectJournalEntry}
   */
  record(entry, options) {
    const persist =
      options && typeof options === "object" && Object.prototype.hasOwnProperty.call(options, "persist")
        ? options.persist === true
        : this.autoPersist;
    const out = buildJournalEntry(entry, this._entries.length + 1);

    this._entries.push(out);
    if (persist) {
      this._appendToStorage(out).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`[SideEffectJournal] append WAL failed: ${msg}`);
      });
    }
    return out;
  }

  /**
   * @param {LoadFromRunStoreOptions | undefined} [input]
   * @returns {Promise<{ ok: boolean, reason?: string, error?: string, cursor?: number }>}
   */
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
      if (!isPlainObject(evt)) continue;
      const event = /** @type {SideEffectJournalEvent} */ (evt);
      if (event.meta?.replay) continue;
      this._onVfsWriteEvent(event, { allowDuplicates: false });
    }

    return { ok: true, cursor: this.getCursor() };
  }

  /**
   * Append all new entries to WAL storage.
   * @returns {Promise<PersistResult>}
   */
  async persist() {
    const runId = this.runId;
    if (!runId) return { ok: false, reason: "missing_runId" };

    const vfs = this.vfs;
    if (!vfs || typeof vfs !== "object") return { ok: false, reason: "missing_vfs" };

    const cursor = this.getCursor();
    if (this._persistedCursor >= cursor) return { ok: true, cursor, persisted: 0 };

    let persisted = 0;
    let ok = true;
    for (let i = this._persistedCursor; i < this._entries.length; i++) {
      const entry = this._entries[i];
      if (!entry) continue;
      const res = await this._appendToStorage(entry);
      if (res?.ok) {
        if (!res?.skipped) persisted += 1;
      } else {
        ok = false;
      }
    }

    return { ok, cursor: this.getCursor(), persisted };
  }

  /**
   * Replay WAL storage into memory (crash recovery).
   * Validates file size and entry structure to prevent DoS.
   * @param {string=} runId - The run identifier
   * @returns {Promise<ReplayResult>} The replay result
   */
  async replayFromStorage(runId) {
    const id = toNonEmptyString(runId) || this.runId;
    if (!id) return { ok: false, reason: "missing_runId" };

    const vfs = this.vfs;
    if (!vfs || typeof vfs !== "object") return { ok: false, reason: "missing_vfs" };

    const walPath = this._getWalPath(id);
    if (!walPath) return { ok: false, reason: "missing_wal_path" };

    const cursor = this.getCursor();
    try {
      const replay = await readWalReplayState({ vfs, walPath, logger: this.logger, cursor });
      if (replay.ok === false) return replay.result;

      if (replay.skippedLines) {
        this.logger?.warn?.(`[SideEffectJournal] Skipped ${replay.skippedLines} invalid WAL lines`);
      }

      applyWalReplayState(this, replay.entries, replay.seen);
      return { ok: true, cursor: this.getCursor(), recovered: replay.entries.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[SideEffectJournal] WAL replay failed: ${msg}`);
      return { ok: false, reason: "replay_failed", error: msg };
    }
  }

  /**
   * Compact WAL by removing rolled-back entries.
   * @returns {Promise<CompactResult>}
   */
  async compact() {
    const runId = this.runId;
    if (!runId) return { ok: false, reason: "missing_runId" };

    const vfs = this.vfs;
    if (!vfs || typeof vfs !== "object") return { ok: false, reason: "missing_vfs" };

    const walPath = this._getWalPath(runId);
    if (!walPath) return { ok: false, reason: "missing_wal_path" };

    try {
      const ensured = await this._ensureWalDir();
      if (!ensured) return { ok: false, reason: "wal_dir_unavailable" };

      let before = 0;
      try {
        const text = await readTextFromVfs(vfs, walPath);
        if (typeof text === "string") {
          before = text.split(/\r?\n/).filter((line) => line.trim()).length;
        }
      } catch (e) {
        this.logger?.warn?.(`[SideEffectJournal] compact read existing WAL failed: ${e instanceof Error ? e.message : String(e)}`);
        before = 0;
      }

      const lines = this._entries.map((entry) => JSON.stringify(entry)).filter(Boolean);
      const payload = lines.length ? `${lines.join("\n")}\n` : "";
      const okWrite = await writeTextToVfs(vfs, walPath, payload);
      if (!okWrite) return { ok: false, reason: "wal_write_unsupported" };

      const after = this._entries.length;
      this._persistedCursor = after;
      return { ok: true, before, after, saved: Math.max(0, before - after) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[SideEffectJournal] WAL compact failed: ${msg}`);
      return { ok: false, reason: "compact_failed", error: msg };
    }
  }

  /**
   * @param {unknown} cursor
   * @param {RollbackOptions | undefined} [options]
   * @returns {Promise<{ ok: boolean, reason?: string, rolledBack?: number, failures?: SideEffectJournalRollbackFailure[], cursor?: number, error?: string }>}
   */
  async rollbackToCursor(cursor, { reason } = {}) {
    const target = normalizeCursor(cursor);
    if (target === null) return { ok: false, reason: "invalid_cursor" };

    const current = this.getCursor();
    if (target >= current) return { ok: true, rolledBack: 0, cursor: current };

    const deps = resolveRollbackDeps(this);
    if (deps.ok === false) return { ok: false, reason: deps.reason };

    const { rolledBack, failures } = await rollbackEntries(this._entries, target, {
      vfs: deps.vfs,
      runStore: deps.runStore,
      storageAdapter: deps.storageAdapter,
      logger: this.logger,
    });

    applyRollbackResult(this, { target, current, rolledBack, failures, reason });

    return { ok: failures.length === 0, rolledBack, failures, cursor: this.getCursor() };
  }

  /**
   * Append a journal entry to WAL storage (queued).
   * @private
   * @param {SideEffectJournalEntry} entry - The entry to append
   * @returns {Promise<{ ok: boolean, reason?: string, error?: string, skipped?: boolean }>} Append result
   */
  async _appendToStorage(entry) {
    const task = this._persistQueue.then(() => this._appendToStorageNow(entry));
    this._persistQueue = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  /**
   * Append a journal entry to WAL storage immediately.
   * @private
   * @param {SideEffectJournalEntry} entry - The entry to append
   * @returns {Promise<{ ok: boolean, reason?: string, error?: string, skipped?: boolean }>} Append result
   */
  async _appendToStorageNow(entry) {
    const runId = this.runId;
    if (!runId) return { ok: false, reason: "missing_runId" };

    const vfs = this.vfs;
    if (!vfs || typeof vfs !== "object") return { ok: false, reason: "missing_vfs" };

    const walPath = this._getWalPath(runId);
    if (!walPath) return { ok: false, reason: "missing_wal_path" };

    if (typeof entry?.seq === "number" && entry.seq <= this._persistedCursor) {
      return { ok: true, skipped: true };
    }

    const ensureOk = await this._ensureWalDir();
    if (!ensureOk) return { ok: false, reason: "wal_dir_unavailable" };

    let json = "";
    try {
      json = JSON.stringify(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[SideEffectJournal] WAL stringify failed: ${msg}`);
      return { ok: false, reason: "stringify_failed", error: msg };
    }

    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(json).length;
    if (jsonBytes > MAX_WAL_LINE_SIZE) {
      // Best-effort: drop optional fields (e.g. large meta payloads) to keep WAL bounded.
      const slim = isPlainObject(entry) ? { ...entry } : { seq: entry?.seq, kind: entry?.kind, ts: entry?.ts, reversible: entry?.reversible };
      if (slim && typeof slim === "object" && "meta" in slim) delete slim.meta;

      try {
        const slimJson = JSON.stringify(slim);
        const slimBytes = encoder.encode(slimJson).length;
        if (slimBytes <= MAX_WAL_LINE_SIZE) {
          this._oversizedEntryTrimmedCount += 1;
          if (!this._oversizedWalEntryWarned) {
            this._oversizedWalEntryWarned = true;
            this.logger?.warn?.("[SideEffectJournal] WAL entry exceeded MAX_WAL_LINE_SIZE; meta was dropped", {
              seq: entry?.seq,
              originalBytes: jsonBytes,
              trimmedBytes: slimBytes,
              limitBytes: MAX_WAL_LINE_SIZE,
            });
          }
          json = slimJson;
        } else {
          this._oversizedEntrySkippedCount += 1;
          this.logger?.warn?.(
            `[SideEffectJournal] WAL entry too large (${jsonBytes} bytes; max ${MAX_WAL_LINE_SIZE}); skipping seq ${entry?.seq ?? "?"}`,
          );
          return { ok: true, skipped: true };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`[SideEffectJournal] WAL stringify failed after trimming: ${msg}`);
        return { ok: false, reason: "stringify_failed", error: msg };
      }
    }

    const line = `${json}\n`;

    try {
      const { ok, appended } = await appendTextToVfs(vfs, walPath, line);
      if (!ok) return { ok: false, reason: "wal_write_failed" };

      if (!appended) {
        this._appendFallbackCount += 1;
        if (!this._appendFallbackWarned) {
          this._appendFallbackWarned = true;
          this.logger?.warn?.("[SideEffectJournal] WAL append fallback used; file was rewritten", {
            seq: entry?.seq,
            fallbackCount: this._appendFallbackCount,
          });
        } else {
          this.logger?.debug?.("[SideEffectJournal] WAL append fallback reused", {
            seq: entry?.seq,
            fallbackCount: this._appendFallbackCount,
          });
        }
      }

      if (typeof entry?.seq === "number") {
        this._persistedCursor = Math.max(this._persistedCursor, entry.seq);
      }

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[SideEffectJournal] WAL write failed: ${msg}`);
      return { ok: false, reason: "wal_write_failed", error: msg };
    }
  }

  /**
   * Get WAL persistence metrics for observability.
   * @returns {{
   *   appendFallbackCount: number,
   *   oversizedEntryTrimmedCount: number,
   *   oversizedEntrySkippedCount: number,
   *   persistedCursor: number,
   *   entryCount: number,
   * }}
   */
  getPersistenceStats() {
    return {
      appendFallbackCount: this._appendFallbackCount,
      oversizedEntryTrimmedCount: this._oversizedEntryTrimmedCount,
      oversizedEntrySkippedCount: this._oversizedEntrySkippedCount,
      persistedCursor: this._persistedCursor,
      entryCount: this._entries.length,
    };
  }

  /**
   * Get WAL file path for a given runId with path traversal protection.
   * @private
   * @param {string} runId - The run identifier
   * @returns {string|null} The WAL path or null if invalid
   */
  _getWalPath(runId) {
    const rawId = toNonEmptyString(runId) || this.runId;
    const id = sanitizeRunId(rawId);
    if (!id) {
      this.logger?.warn?.(`[SideEffectJournal] Invalid runId rejected: ${rawId}`);
      return null;
    }
    const dir = toNonEmptyString(this.walDir) || ".agents/wal";
    if (!dir) return null;
    return joinVfsPath(dir, `${id}.jsonl`);
  }

  /**
   * Ensure the WAL directory exists, creating it if necessary.
   * @private
   * @returns {Promise<boolean>} True if the directory is available
   */
  async _ensureWalDir() {
    const vfs = this.vfs;
    if (!vfs || typeof vfs !== "object") return false;

    const dir = toNonEmptyString(this.walDir) || ".agents/wal";
    if (!dir) return false;

    if (typeof vfs.mkdir !== "function") return false;

    try {
      if (typeof vfs.exists === "function") {
        const exists = await vfs.exists(dir);
        if (exists) return true;
      }
      await vfs.mkdir(dir);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[SideEffectJournal] WAL mkdir failed: ${msg}`);
      return false;
    }
  }

  /**
   * Handle a VFS write event and record it as a journal entry.
   * @private
   * @param {SideEffectJournalEvent} evt - The VFS write event
   * @param {{ allowDuplicates?: boolean }} [options] - Options for handling duplicates
   * @returns {void}
   */
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
