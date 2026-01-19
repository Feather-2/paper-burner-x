import { restoreVfsCheckpoint } from "../../vfs/checkpoints.js";

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";

/** Maximum WAL file size in bytes (10 MB) to prevent DoS. */
const MAX_WAL_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum single WAL line size in bytes (100 KB) to prevent memory issues. */
const MAX_WAL_LINE_SIZE = 100 * 1024;

/** Valid entry kinds for WAL structure validation. */
const VALID_ENTRY_KINDS = new Set(["vfs_checkpoint", "unknown"]);

/**
 * @typedef {object} SideEffectJournalCheckpointRef
 * @property {string} artifactId
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
 * Interface for RunStore-like objects (DI contract).
 * @typedef {object} RunStoreLike
 * @property {(runId: string) => Promise<unknown[]>} [getEvents] - Get events for a run
 * @property {(artifactId: string) => Promise<unknown>} [getArtifactById] - Get artifact by ID
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
 * @property {(msg: string) => void} [warn] - Log warning message
 * @property {(msg: string) => void} [info] - Log info message
 * @property {(msg: string) => void} [debug] - Log debug message
 * @property {(msg: string) => void} [error] - Log error message
 */

/**
 * Interface for StorageAdapter-like objects (DI contract).
 * @typedef {object} StorageAdapterLike
 * @property {(key: string) => Promise<unknown>} [get] - Get value by key
 * @property {(key: string, value: unknown) => Promise<void>} [set] - Set value
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
 * @property {any=} payload
 * @property {{ replay?: boolean }=} meta
 */

/**
 * Convert a timestamp value to ISO 8601 string format.
 * @param {unknown} ts - Timestamp value (string, number, or other)
 * @returns {string} ISO 8601 formatted timestamp string
 */
function toIso(ts) {
  if (typeof ts === "string" && ts.trim()) return ts;
  const ms = typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now();
  return new Date(ms).toISOString();
}

/**
 * Normalize a cursor value to a non-negative integer.
 * @param {unknown} value - The cursor value to normalize
 * @returns {number|null} Normalized cursor or null if invalid
 */
function normalizeCursor(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/**
 * Sanitize runId to prevent path traversal attacks.
 * Rejects ../, absolute paths, and path separators.
 * @param {string} id - The runId to sanitize
 * @returns {string|null} Sanitized id or null if invalid
 */
function sanitizeRunId(id) {
  if (typeof id !== "string" || !id.trim()) return null;
  const trimmed = id.trim();
  // Reject path traversal patterns
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  // Reject absolute paths (Windows drive letters or Unix root)
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("/")) return null;
  // Only allow safe characters: alphanumeric, dash, underscore, dot (but not leading dot)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Join VFS directory and file name into a path.
 * @param {string} dir - The directory path
 * @param {string} name - The file name
 * @returns {string} The joined path
 */
function joinVfsPath(dir, name) {
  const left = typeof dir === "string" ? dir.trim() : "";
  const right = typeof name === "string" ? name.trim() : "";
  if (!left && !right) return "";
  if (!left) return right.replace(/^\/+/, "");
  if (!right) return left.replace(/\/+$/, "");
  return `${left.replace(/\/+$/, "")}/${right.replace(/^\/+/, "")}`;
}

/**
 * Convert a binary or buffer value to a text string.
 * @param {unknown} value - The value to convert (string, Uint8Array, ArrayBuffer, etc.)
 * @returns {string} The text representation
 */
function bytesToText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    const view = /** @type {ArrayBufferView} */ (value);
    const bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    return new TextDecoder().decode(bytes);
  }
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
  return String(value);
}

/**
 * Convert a text value to UTF-8 encoded bytes.
 * @param {unknown} value - The value to encode
 * @returns {Uint8Array} UTF-8 encoded bytes
 */
function textToBytes(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : String(value ?? ""));
}

/**
 * Read text content from a VFS path.
 * @param {VfsLike} vfs - The VFS instance
 * @param {string} path - The file path to read
 * @returns {Promise<string|null>} The file content or null if unavailable
 */
async function readTextFromVfs(vfs, path) {
  if (!vfs || typeof vfs !== "object") return null;
  if (typeof vfs.readText === "function") return await vfs.readText(path);
  if (typeof vfs.read === "function") {
    const data = await vfs.read(path);
    if (data === null || data === undefined) return null;
    return bytesToText(data);
  }
  if (typeof vfs.readFile === "function") {
    const data = await vfs.readFile(path);
    return bytesToText(data);
  }
  return null;
}

/**
 * Write text content to a VFS path.
 * @param {VfsLike} vfs - The VFS instance
 * @param {string} path - The file path to write
 * @param {string} text - The text content to write
 * @returns {Promise<boolean>} True if write succeeded
 */
async function writeTextToVfs(vfs, path, text) {
  if (!vfs || typeof vfs !== "object") return false;
  if (typeof vfs.write === "function") {
    await vfs.write(path, textToBytes(text));
    return true;
  }
  if (typeof vfs.writeText === "function") {
    await vfs.writeText(path, text);
    return true;
  }
  if (typeof vfs.writeFile === "function") {
    await vfs.writeFile(path, text);
    return true;
  }
  return false;
}

/**
 * Append text content to a VFS path.
 * @param {VfsLike} vfs - The VFS instance
 * @param {string} path - The file path to append to
 * @param {string} text - The text content to append
 * @returns {Promise<{ ok: boolean, appended: boolean }>} Result with ok status and whether native append was used
 */
async function appendTextToVfs(vfs, path, text) {
  if (!vfs || typeof vfs !== "object") return { ok: false, appended: false };
  if (typeof vfs.appendText === "function") {
    await vfs.appendText(path, text);
    return { ok: true, appended: true };
  }
  const before = await readTextFromVfs(vfs, path);
  const ok = await writeTextToVfs(vfs, path, `${before ?? ""}${text}`);
  return { ok, appended: false };
}

/**
 * Check whether a VFS path exists.
 * @param {VfsLike} vfs - The VFS instance
 * @param {string} path - The path to check
 * @returns {Promise<boolean>} True if the path exists
 */
async function vfsExists(vfs, path) {
  if (!vfs || typeof vfs !== "object") return false;
  if (typeof vfs.exists === "function") return await vfs.exists(path);
  try {
    const content = await readTextFromVfs(vfs, path);
    return content !== null;
  } catch (e) {
    // Log suppressed error for observability
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[SideEffectJournal] vfsExists check failed:", e);
    }
    return false;
  }
}

/**
 * Validate parsed WAL entry structure.
 * Ensures required fields exist and have valid types.
 * @param {unknown} parsed - The parsed JSON object
 * @returns {{ valid: boolean, reason?: string }} Validation result
 */
function validateWalEntry(parsed) {
  if (!isPlainObject(parsed)) {
    return { valid: false, reason: "not_plain_object" };
  }
  const entry = /** @type {Record<string, unknown>} */ (parsed);
  // kind must be a non-empty string
  const kind = entry.kind;
  if (typeof kind !== "string" || !kind.trim()) {
    return { valid: false, reason: "missing_kind" };
  }
  // ts must exist (string or number)
  const ts = entry.ts;
  if (ts === undefined || ts === null) {
    return { valid: false, reason: "missing_ts" };
  }
  // reversible must be boolean if present
  if (entry.reversible !== undefined && typeof entry.reversible !== "boolean") {
    return { valid: false, reason: "invalid_reversible" };
  }
  return { valid: true };
}

/**
 * Build a normalized journal entry from raw input.
 * @param {unknown} entry - The raw entry data
 * @param {number} seq - The sequence number for this entry
 * @returns {SideEffectJournalEntry} The normalized journal entry
 */
function buildJournalEntry(entry, seq) {
  const e = isPlainObject(entry) ? entry : {};
  const kind = toNonEmptyString(e.kind) || "unknown";
  const ts = toIso(e.ts);
  const reversible = e.reversible === true;

  return {
    seq,
    kind,
    ts,
    reversible,
    ...(isPlainObject(e.checkpoint) ? { checkpoint: { ...e.checkpoint } } : {}),
    ...(toNonEmptyString(e.path) ? { path: toNonEmptyString(e.path) } : {}),
    ...(toNonEmptyString(e.op) ? { op: toNonEmptyString(e.op) } : {}),
    ...(toNonEmptyString(e.eventId) ? { eventId: toNonEmptyString(e.eventId) } : {}),
    ...(isPlainObject(e.meta) ? { meta: { ...e.meta } } : {}),
  };
}

/**
 * SideEffectJournal (Browser-first)
 *
 * Tracks "physical" side effects (e.g. VFS writes) so Backtrack/undo can revert them.
 * For now we implement reversible VFS effects via `vfs_checkpoint.json` artifacts.
 */
export class SideEffectJournal {
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
  }

  /**
   * Attach an EventBus to listen for VFS write events.
   * @param {any} eventBus - The EventBus instance
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

    this._unsub = this.eventBus.subscribe("vfs.write.*", (evt) => {
      try {
        this._onVfsWriteEvent(evt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.warn?.(`[SideEffectJournal] vfs.write.* handler failed: ${msg}`);
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
   * @param {any} entry
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
      if (!evt || typeof evt !== "object") continue;
      if (evt.meta?.replay) continue;
      this._onVfsWriteEvent(evt, { allowDuplicates: false });
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

    try {
      const exists = await vfsExists(vfs, walPath);
      if (!exists) return { ok: false, reason: "missing_wal", cursor: this.getCursor(), recovered: 0 };

      const text = await readTextFromVfs(vfs, walPath);
      if (text === null) return { ok: false, reason: "missing_wal", cursor: this.getCursor(), recovered: 0 };

      // Check WAL file size limit to prevent DoS
      const textSize = new TextEncoder().encode(text).length;
      if (textSize > MAX_WAL_FILE_SIZE) {
        this.logger?.warn?.(`[SideEffectJournal] WAL file too large: ${textSize} bytes (max ${MAX_WAL_FILE_SIZE})`);
        return { ok: false, reason: "wal_too_large", cursor: this.getCursor(), recovered: 0 };
      }

      const nextEntries = [];
      const nextSeen = new Set();
      const lines = String(text).split(/\r?\n/);
      let skippedLines = 0;

      for (const rawLine of lines) {
        const line = typeof rawLine === "string" ? rawLine.trim() : "";
        if (!line) continue;

        // Check single line size limit
        if (line.length > MAX_WAL_LINE_SIZE) {
          this.logger?.warn?.(`[SideEffectJournal] WAL line too large: ${line.length} chars (max ${MAX_WAL_LINE_SIZE})`);
          skippedLines += 1;
          continue;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger?.warn?.(`[SideEffectJournal] WAL parse error: ${msg}`);
          skippedLines += 1;
          continue;
        }

        // Validate entry structure
        const validation = validateWalEntry(parsed);
        if (!validation.valid) {
          this.logger?.warn?.(`[SideEffectJournal] WAL entry validation failed: ${validation.reason}`);
          skippedLines += 1;
          continue;
        }

        const entry = buildJournalEntry(parsed, nextEntries.length + 1);
        nextEntries.push(entry);

        const eventId = toNonEmptyString(entry.eventId);
        if (eventId) nextSeen.add(eventId);
      }

      if (skippedLines > 0) {
        this.logger?.warn?.(`[SideEffectJournal] Skipped ${skippedLines} invalid WAL lines`);
      }

      this._entries = nextEntries;
      this._seenEventIds = nextSeen;
      this._persistedCursor = this._entries.length;

      return { ok: true, cursor: this.getCursor(), recovered: nextEntries.length };
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
   * @returns {Promise<{ ok: boolean, reason?: string, rolledBack?: number, failures?: any[], cursor?: number, error?: string }>}
   */
  async rollbackToCursor(cursor, { reason } = {}) {
    const target = normalizeCursor(cursor);
    if (target === null) return { ok: false, reason: "invalid_cursor" };

    const current = this.getCursor();
    if (target >= current) return { ok: true, rolledBack: 0, cursor: current };

    const vfs = this.vfs;
    const runStore = this.runStore && typeof this.runStore.getArtifactById === "function" ? this.runStore : null;
    const storageAdapter = this.storageAdapter;
    if (!vfs || typeof vfs.writeFile !== "function") {
      return { ok: false, reason: "missing_vfs" };
    }
    if (!runStore && !storageAdapter) {
      // Backward-compat: previous versions required RunStore to rollback checkpoints.
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
            storageAdapter,
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
    this._persistedCursor = Math.min(this._persistedCursor, this._entries.length);

    try {
      this.eventBus?.emit?.("side_effects.rolled_back", {
        cursorBefore: current,
        cursorAfter: target,
        rolledBack,
        failures,
        reason: toNonEmptyString(reason) || null,
      });
    } catch (e) {
      this.logger?.warn?.(`[SideEffectJournal] Failed to emit rolled_back event: ${e instanceof Error ? e.message : String(e)}`);
    }

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

    let line = "";
    try {
      line = `${JSON.stringify(entry)}\n`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "stringify_failed", error: msg };
    }

    try {
      const { ok, appended } = await appendTextToVfs(vfs, walPath, line);
      if (!ok) return { ok: false, reason: "wal_write_failed" };

      if (!appended && !this._appendFallbackWarned) {
        this._appendFallbackWarned = true;
        this.logger?.warn?.("[SideEffectJournal] WAL append fallback used; file was rewritten");
      }

      if (typeof entry?.seq === "number") {
        this._persistedCursor = Math.max(this._persistedCursor, entry.seq);
      }

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "wal_write_failed", error: msg };
    }
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
