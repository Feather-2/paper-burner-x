/**
 * Side-Effect Journal — helper functions (extracted from side-effect-journal.js)
 */

import { restoreVfsCheckpoint } from "../../vfs/checkpoints.js";
import { isPlainObject, toNonEmptyString, protoSafeReviver } from "../../shared/index.js";

/** Maximum WAL file size in bytes (10 MB) to prevent DoS. */
export const MAX_WAL_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum single WAL line size in bytes (100 KB) to prevent memory issues. */
export const MAX_WAL_LINE_SIZE = 100 * 1024;

/**
 * Convert a timestamp value to ISO 8601 string format.
 * @param {unknown} ts
 * @returns {string}
 */
export function toIso(ts) {
  if (typeof ts === "string" && ts.trim()) return ts;
  const ms = typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now();
  const dt = new Date(ms);
  if (!Number.isFinite(dt.getTime())) {
    return new Date(Date.now()).toISOString();
  }
  return dt.toISOString();
}

/**
 * Normalize a cursor value to a non-negative integer.
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeCursor(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/**
 * Sanitize runId to prevent path traversal attacks.
 * @param {string} id
 * @returns {string|null}
 */
export function sanitizeRunId(id) {
  if (typeof id !== "string" || !id.trim()) return null;
  const trimmed = id.trim();
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("/")) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Join VFS directory and file name into a path.
 * @param {string} dir
 * @param {string} name
 * @returns {string}
 */
export function joinVfsPath(dir, name) {
  const left = typeof dir === "string" ? dir.trim() : "";
  const right = typeof name === "string" ? name.trim() : "";
  if (!left && !right) return "";
  if (!left) return right.replace(/^\/+/, "");
  if (!right) return left.replace(/\/+$/, "");
  return `${left.replace(/\/+$/, "")}/${right.replace(/^\/+/, "")}`;
}

/**
 * Convert a binary or buffer value to a text string.
 * @param {unknown} value
 * @returns {string}
 */
export function bytesToText(value) {
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
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function textToBytes(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : String(value ?? ""));
}

/**
 * Read text content from a VFS path.
 * @param {object} vfs
 * @param {string} path
 * @returns {Promise<string|null>}
 */
export async function readTextFromVfs(vfs, path) {
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
 * @param {object} vfs
 * @param {string} path
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function writeTextToVfs(vfs, path, text) {
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
 * @param {object} vfs
 * @param {string} path
 * @param {string} text
 * @returns {Promise<{ ok: boolean, appended: boolean }>}
 */
export async function appendTextToVfs(vfs, path, text) {
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
 * Create an in-memory VFS adapter for tests.
 * @returns {object}
 */
export function createMemoryVfs() {
  const files = new Map();
  return {
    exists: async (path) => files.has(path),
    readText: async (path) => (files.has(path) ? files.get(path) : null),
    read: async (path) => (files.has(path) ? textToBytes(files.get(path)) : null),
    write: async (path, data) => {
      files.set(path, bytesToText(data));
    },
    writeText: async (path, text) => {
      files.set(path, String(text ?? ""));
    },
    writeFile: async (path, data) => {
      files.set(path, typeof data === "string" ? data : bytesToText(data));
    },
    appendText: async (path, text) => {
      files.set(path, `${files.get(path) ?? ""}${String(text ?? "")}`);
    },
    mkdir: async () => undefined,
  };
}

/**
 * Create an in-memory key-value storage adapter for tests.
 * @param {Record<string, unknown>} [seed]
 * @returns {object}
 */
export function createStorageAdapter(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    keys: async () => Array.from(store.keys()),
  };
}

/**
 * Check whether a VFS path exists.
 * @param {object} vfs
 * @param {string} path
 * @param {object|null|undefined} logger
 * @returns {Promise<boolean>}
 */
export async function vfsExists(vfs, path, logger) {
  if (!vfs || typeof vfs !== "object") return false;
  if (typeof vfs.exists === "function") return await vfs.exists(path);
  try {
    const content = await readTextFromVfs(vfs, path);
    return content !== null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger?.debug?.(`[SideEffectJournal] vfsExists check failed: ${msg}`);
    return false;
  }
}

/**
 * Validate parsed WAL entry structure.
 * @param {unknown} parsed
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateWalEntry(parsed) {
  if (!isPlainObject(parsed)) {
    return { valid: false, reason: "not_plain_object" };
  }
  const entry = /** @type {Record<string, unknown>} */ (parsed);
  const kind = entry.kind;
  if (typeof kind !== "string" || !kind.trim()) {
    return { valid: false, reason: "missing_kind" };
  }
  const ts = entry.ts;
  if (ts === undefined || ts === null) {
    return { valid: false, reason: "missing_ts" };
  }
  if (entry.reversible !== undefined && typeof entry.reversible !== "boolean") {
    return { valid: false, reason: "invalid_reversible" };
  }
  return { valid: true };
}

/**
 * Build a normalized journal entry from raw input.
 * @param {unknown} entry
 * @param {number} seq
 * @returns {{
 *   seq: number,
 *   kind: string,
 *   ts: string,
 *   reversible: boolean,
 *   checkpoint?: Record<string, unknown>,
 *   path?: string,
 *   op?: string,
 *   eventId?: string,
 *   meta?: Record<string, unknown>
 * }}
 */
export function buildJournalEntry(entry, seq) {
  const e = /** @type {Record<string, unknown>} */ (isPlainObject(entry) ? entry : {});
  const checkpoint = isPlainObject(e.checkpoint) ? /** @type {Record<string, unknown>} */ (e.checkpoint) : null;
  const meta = isPlainObject(e.meta) ? /** @type {Record<string, unknown>} */ (e.meta) : null;
  const kind = toNonEmptyString(e.kind) || "unknown";
  const ts = toIso(e.ts);
  const reversible = e.reversible === true;

  return {
    seq,
    kind,
    ts,
    reversible,
    ...(checkpoint ? { checkpoint: { ...checkpoint } } : {}),
    ...(toNonEmptyString(e.path) ? { path: toNonEmptyString(e.path) } : {}),
    ...(toNonEmptyString(e.op) ? { op: toNonEmptyString(e.op) } : {}),
    ...(toNonEmptyString(e.eventId) ? { eventId: toNonEmptyString(e.eventId) } : {}),
    ...(meta ? { meta: { ...meta } } : {}),
  };
}

/**
 * Check WAL text size against the allowed limit.
 * @param {string} text
 * @param {object|null|undefined} logger
 * @returns {boolean}
 */
export function isWalTextTooLarge(text, logger) {
  const textSize = new TextEncoder().encode(text).length;
  if (textSize > MAX_WAL_FILE_SIZE) {
    logger?.warn?.(`[SideEffectJournal] WAL file too large: ${textSize} bytes (max ${MAX_WAL_FILE_SIZE})`);
    return true;
  }
  return false;
}

/**
 * Parse WAL text into journal entries and seen event IDs.
 * @param {string} text
 * @param {object|null|undefined} logger
 * @returns {{ entries: object[], seen: Set<string>, skippedLines: number }}
 */
export function parseWalEntries(text, logger) {
  const nextEntries = [];
  const nextSeen = new Set();
  const lines = String(text).split(/\r?\n/);
  let skippedLines = 0;

  for (const rawLine of lines) {
    const line = typeof rawLine === "string" ? rawLine.trim() : "";
    if (!line) continue;

    if (line.length > MAX_WAL_LINE_SIZE) {
      logger?.warn?.(`[SideEffectJournal] WAL line too large: ${line.length} chars (max ${MAX_WAL_LINE_SIZE})`);
      skippedLines += 1;
      continue;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(line, protoSafeReviver);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn?.(`[SideEffectJournal] WAL parse error: ${msg}`);
      skippedLines += 1;
      continue;
    }

    const validation = validateWalEntry(parsed);
    if (!validation.valid) {
      logger?.warn?.(`[SideEffectJournal] WAL entry validation failed: ${validation.reason}`);
      skippedLines += 1;
      continue;
    }

    const entry = buildJournalEntry(parsed, nextEntries.length + 1);
    nextEntries.push(entry);

    const eventId = toNonEmptyString(entry.eventId);
    if (eventId) nextSeen.add(eventId);
  }

  return { entries: nextEntries, seen: nextSeen, skippedLines };
}

/**
 * Build a missing WAL result for replay.
 * @param {number} cursor
 * @returns {{ ok: boolean, reason: string, cursor: number, recovered: number }}
 */
export function missingWalResult(cursor) {
  return { ok: false, reason: "missing_wal", cursor, recovered: 0 };
}

/**
 * Read and parse WAL replay state from storage.
 * @param {{ vfs: object, walPath: string, logger: object|null|undefined, cursor: number }} input
 * @returns {Promise<object>}
 */
export async function readWalReplayState({ vfs, walPath, logger, cursor }) {
  const exists = await vfsExists(vfs, walPath, logger);
  if (!exists) return { ok: false, result: missingWalResult(cursor) };

  const text = await readTextFromVfs(vfs, walPath);
  if (text === null) return { ok: false, result: missingWalResult(cursor) };

  if (isWalTextTooLarge(text, logger)) {
    return { ok: false, result: { ok: false, reason: "wal_too_large", cursor, recovered: 0 } };
  }

  const { entries, seen, skippedLines } = parseWalEntries(text, logger);
  return { ok: true, entries, seen, skippedLines };
}

/**
 * Apply WAL entries and state to a journal instance.
 * @param {object} journal
 * @param {object[]} entries
 * @param {Set<string>} seen
 */
export function applyWalReplayState(journal, entries, seen) {
  journal._entries = entries;
  journal._seenEventIds = seen;
  journal._persistedCursor = entries.length;
}

/**
 * Roll back journal entries from the end down to the target cursor.
 * @param {object[]} entries
 * @param {number} target
 * @param {{ vfs: object, runStore: object|null, storageAdapter: object|null, logger: object|null }} deps
 * @returns {Promise<{ rolledBack: number, failures: object[] }>}
 */
export async function rollbackEntries(entries, target, { vfs, runStore, storageAdapter, logger }) {
  const failures = [];
  let rolledBack = 0;

  for (let i = entries.length - 1; i >= target; i--) {
    const entry = entries[i];
    if (!entry) continue;

    if (entry.reversible && entry.checkpoint?.artifactId) {
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
        logger?.warn?.(`[SideEffectJournal] rollback failed for checkpoint ${entry.checkpoint.artifactId}: ${msg}`);
      }
      continue;
    }

    if (entry.reversible) {
      failures.push({ seq: entry.seq, kind: entry.kind, error: "unknown_reversible_effect" });
    }
  }

  return { rolledBack, failures };
}

/**
 * Resolve rollback dependencies for a journal instance.
 * @param {object} journal
 * @returns {object}
 */
export function resolveRollbackDeps(journal) {
  const vfs = journal.vfs;
  const runStore = journal.runStore && typeof journal.runStore.getArtifactById === "function" ? journal.runStore : null;
  const storageAdapter = journal.storageAdapter;
  if (!vfs || typeof vfs.writeFile !== "function") {
    return { ok: false, reason: "missing_vfs" };
  }
  if (!runStore && !storageAdapter) {
    return { ok: false, reason: "missing_runStore" };
  }
  return { ok: true, vfs, runStore, storageAdapter };
}

/**
 * Apply rollback results and emit event notifications.
 * @param {object} journal
 * @param {{ target: number, current: number, rolledBack: number, failures: object[], reason?: string }} info
 */
export function applyRollbackResult(journal, { target, current, rolledBack, failures, reason }) {
  journal._entries = journal._entries.slice(0, target);
  journal._persistedCursor = Math.min(journal._persistedCursor, journal._entries.length);

  try {
    journal.eventBus?.emit?.("side_effects.rolled_back", {
      cursorBefore: current,
      cursorAfter: target,
      rolledBack,
      failures,
      reason: toNonEmptyString(reason) || null,
    });
  } catch (e) {
    journal.logger?.warn?.(`[SideEffectJournal] Failed to emit rolled_back event: ${e instanceof Error ? e.message : String(e)}`);
  }
}
