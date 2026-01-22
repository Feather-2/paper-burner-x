import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/vfs/checkpoints.js", () => ({
  restoreVfsCheckpoint: vi.fn(),
}));

import SideEffectJournalDefault, {
  SideEffectJournal,
} from "../../../../../js/agents/plugins/side-effects/side-effect-journal.js";
import { restoreVfsCheckpoint } from "../../../../../js/agents/vfs/checkpoints.js";

const bytesToText = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    const view = value;
    const bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    return new TextDecoder().decode(bytes);
  }
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
  return String(value);
};

const textToBytes = (value) => new TextEncoder().encode(typeof value === "string" ? value : String(value ?? ""));

const createMemoryVfs = () => {
  const files = new Map();
  const dirs = new Set();
  const vfs = {
    exists: vi.fn(async (path) => files.has(path) || dirs.has(path)),
    readText: vi.fn(async (path) => (files.has(path) ? files.get(path) : null)),
    read: vi.fn(async (path) => (files.has(path) ? textToBytes(files.get(path)) : null)),
    readFile: vi.fn(async (path) => (files.has(path) ? textToBytes(files.get(path)) : null)),
    write: vi.fn(async (path, data) => {
      files.set(path, bytesToText(data));
    }),
    writeText: vi.fn(async (path, text) => {
      files.set(path, String(text ?? ""));
    }),
    writeFile: vi.fn(async (path, data) => {
      files.set(path, typeof data === "string" ? data : bytesToText(data));
    }),
    appendText: vi.fn(async (path, text) => {
      files.set(path, `${files.get(path) ?? ""}${String(text ?? "")}`);
    }),
    mkdir: vi.fn(async (path) => {
      dirs.add(path);
    }),
  };
  return { vfs, files, dirs };
};

const createLogger = () => ({
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
});

describe("SideEffectJournal", () => {
  let logger;

  beforeEach(() => {
    logger = createLogger();
    vi.clearAllMocks();
  });

  describe("constructor and accessors", () => {
    it("initializes defaults and empty state", () => {
      const journal = new SideEffectJournal();
      expect(journal.runId).toBeNull();
      expect(journal.autoPersist).toBe(false);
      expect(journal.walDir).toBe(".agents/wal");
      expect(journal.getCursor()).toBe(0);
      expect(journal.listEntries()).toEqual([]);
    });

    it("returns shallow copies from listEntries", () => {
      const journal = new SideEffectJournal({ runId: "run-1" });
      journal.record({ kind: "custom", ts: 1, meta: { nested: { level: 2 } } });
      const entries = journal.listEntries();
      entries[0].kind = "changed";
      expect(journal.listEntries()[0].kind).toBe("custom");
    });
  });

  describe("record", () => {
    it("builds defaults for null, undefined, and empty entries", () => {
      const journal = new SideEffectJournal({ runId: "run-1" });
      const entryNull = journal.record(null);
      const entryUndefined = journal.record(undefined);
      const entryEmpty = journal.record({});

      expect(entryNull.kind).toBe("unknown");
      expect(entryNull.reversible).toBe(false);
      expect(entryNull.seq).toBe(1);
      expect(typeof entryNull.ts).toBe("string");

      expect(entryUndefined.seq).toBe(2);
      expect(entryEmpty.seq).toBe(3);
    });

    it("normalizes fields and preserves nested meta", () => {
      const journal = new SideEffectJournal({ runId: "run-1" });
      const meta = { nested: { deep: { value: "x" } } };
      const entry = journal.record({
        kind: " test ",
        ts: 0,
        reversible: true,
        path: "   ",
        op: "  write  ",
        eventId: "  evt-1  ",
        meta,
      });

      expect(entry.ts).toBe("1970-01-01T00:00:00.000Z");
      expect(entry.path).toBeUndefined();
      expect(entry.op).toBe("write");
      expect(entry.eventId).toBe("evt-1");
      expect(entry.meta).toEqual(meta);
    });

    it("treats empty strings as missing fields", () => {
      const journal = new SideEffectJournal({ runId: "run-1" });
      const entry = journal.record({
        kind: "",
        ts: "",
        path: "",
        op: "",
        eventId: "",
        meta: {},
      });

      expect(entry.kind).toBe("unknown");
      expect(entry.path).toBeUndefined();
      expect(entry.op).toBeUndefined();
      expect(entry.eventId).toBeUndefined();
      expect(entry.meta).toEqual({});
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("respects persist override and logs append failures", async () => {
      const journal = new SideEffectJournal({ runId: "run-1", autoPersist: true, logger });
      const appendSpy = vi.spyOn(journal, "_appendToStorage").mockResolvedValue({ ok: true });

      journal.record({ kind: "custom", ts: 1 }, { persist: false });
      expect(appendSpy).not.toHaveBeenCalled();

      appendSpy.mockResolvedValueOnce({ ok: true });
      journal.record({ kind: "custom", ts: 2 }, { persist: true });
      expect(appendSpy).toHaveBeenCalledTimes(1);

      appendSpy.mockRejectedValueOnce(new Error("boom"));
      journal.record({ kind: "custom", ts: 3 });
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("append WAL failed"));
    });
  });

  describe("attachEventBus and dispose", () => {
    it("unsubscribes previous listeners on reattach", () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      const eventBus1 = { subscribe: vi.fn(() => unsub1) };
      const eventBus2 = { subscribe: vi.fn(() => unsub2) };
      const journal = new SideEffectJournal({ logger });

      journal.attachEventBus(eventBus1);
      journal.attachEventBus(eventBus2);

      expect(unsub1).toHaveBeenCalledTimes(1);
      expect(journal.eventBus).toBe(eventBus2);
    });

    it("logs handler errors from event bus", () => {
      const eventBus = {
        handler: null,
        subscribe: vi.fn((pattern, handler) => {
          eventBus.handler = handler;
          return vi.fn();
        }),
      };
      const journal = new SideEffectJournal({ logger });
      journal.attachEventBus(eventBus);
      vi.spyOn(journal, "_onVfsWriteEvent").mockImplementation(() => {
        throw new Error("boom");
      });

      eventBus.handler({ payload: {} });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("vfs.write.* handler failed"));
    });

    it("handles dispose unsubscribe failures", () => {
      const journal = new SideEffectJournal({ logger });
      journal._unsub = () => {
        throw new Error("bad-unsub");
      };
      journal.dispose();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("dispose unsubscribe failed"));
    });
  });

  describe("loadFromRunStore", () => {
    it("rejects missing runId or runStore", async () => {
      const journalMissingId = new SideEffectJournal({
        runStore: { getEvents: vi.fn() },
      });
      const resMissingId = await journalMissingId.loadFromRunStore();
      expect(resMissingId.ok).toBe(false);
      expect(resMissingId.reason).toBe("missing_runId");

      const journalMissingStore = new SideEffectJournal({ runId: "run-1" });
      const resMissingStore = await journalMissingStore.loadFromRunStore();
      expect(resMissingStore.ok).toBe(false);
      expect(resMissingStore.reason).toBe("missing_runStore");
    });

    it("handles event load errors and non-array responses", async () => {
      const failingRunStore = {
        getEvents: vi.fn(async () => {
          throw new Error("load-failed");
        }),
      };
      const journalFail = new SideEffectJournal({ runId: "run-1", runStore: failingRunStore });
      const resFail = await journalFail.loadFromRunStore();
      expect(resFail.ok).toBe(false);
      expect(resFail.reason).toBe("load_events_failed");

      const nonArrayRunStore = { getEvents: vi.fn(async () => ({ nope: true })) };
      const journalNonArray = new SideEffectJournal({ runId: "run-1", runStore: nonArrayRunStore });
      const resNonArray = await journalNonArray.loadFromRunStore();
      expect(resNonArray.ok).toBe(true);
      expect(journalNonArray.getCursor()).toBe(0);
    });

    it("records unique VFS checkpoint events and skips replay", async () => {
      const runStore = {
        getEvents: vi.fn(async () => [
          { eventId: "evt-1", ts: 1, payload: { checkpoint: { artifactId: "ck-1" } } },
          { eventId: "evt-1", ts: 2, payload: { checkpoint: { artifactId: "ck-2" } } },
          { meta: { replay: true }, payload: { checkpoint: { artifactId: "ck-3" } } },
          {},
        ]),
      };
      const journal = new SideEffectJournal({ runId: "run-1", runStore });
      const res = await journal.loadFromRunStore();
      expect(res.ok).toBe(true);
      expect(journal.getCursor()).toBe(1);
    });
  });

  describe("persist", () => {
    it("rejects missing runId or vfs", async () => {
      const { vfs } = createMemoryVfs();
      const journalMissingId = new SideEffectJournal({ vfs });
      const resMissingId = await journalMissingId.persist();
      expect(resMissingId.ok).toBe(false);
      expect(resMissingId.reason).toBe("missing_runId");

      const journalMissingVfs = new SideEffectJournal({ runId: "run-1" });
      const resMissingVfs = await journalMissingVfs.persist();
      expect(resMissingVfs.ok).toBe(false);
      expect(resMissingVfs.reason).toBe("missing_vfs");
    });

    it("returns early when no new entries", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      journal.record({ kind: "custom", ts: 1 });
      journal._persistedCursor = 1;

      const res = await journal.persist();
      expect(res.ok).toBe(true);
      expect(res.persisted).toBe(0);
    });

    it("appends new entries to WAL", async () => {
      const { vfs, files } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });

      journal.record({ kind: "custom", ts: 1 });
      journal.record({ kind: "custom", ts: 2 });

      const res = await journal.persist();
      expect(res.ok).toBe(true);
      expect(res.persisted).toBe(2);

      const wal = files.get(".wal/run-1.jsonl");
      expect(wal.trim().split(/\r?\n/).length).toBe(2);
    });

    it("reports failures when append fails", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });

      journal.record({ kind: "custom", ts: 1 });
      journal.record({ kind: "custom", ts: 2 });

      vi.spyOn(journal, "_appendToStorage")
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      const res = await journal.persist();
      expect(res.ok).toBe(false);
    });
  });

  describe("replayFromStorage", () => {
    it("rejects missing runId, vfs, or invalid wal path", async () => {
      const journalMissingId = new SideEffectJournal({ vfs: {} });
      const resMissingId = await journalMissingId.replayFromStorage();
      expect(resMissingId.ok).toBe(false);
      expect(resMissingId.reason).toBe("missing_runId");

      const journalMissingVfs = new SideEffectJournal({ runId: "run-1" });
      const resMissingVfs = await journalMissingVfs.replayFromStorage();
      expect(resMissingVfs.ok).toBe(false);
      expect(resMissingVfs.reason).toBe("missing_vfs");

      const { vfs } = createMemoryVfs();
      const journalBadId = new SideEffectJournal({ runId: "../bad", vfs, walDir: ".wal", logger });
      const resBadId = await journalBadId.replayFromStorage();
      expect(resBadId.ok).toBe(false);
      expect(resBadId.reason).toBe("missing_wal_path");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid runId"));
    });

    it("returns missing_wal when WAL does not exist", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      const res = await journal.replayFromStorage();
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("missing_wal");
    });

    it("returns replay_failed when WAL read throws", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal", logger });
      const walPath = ".wal/run-1.jsonl";

      await vfs.writeText(walPath, `${JSON.stringify({ kind: "custom", ts: 1 })}\n`);
      vfs.readText.mockImplementationOnce(async () => {
        throw new Error("read-failed");
      });

      const res = await journal.replayFromStorage();
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("replay_failed");
      expect(res.error).toContain("read-failed");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("WAL replay failed"));
    });

    it("rejects oversized WAL content", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal", logger });
      const walPath = ".wal/run-1.jsonl";

      const hugeText = "x".repeat(10 * 1024 * 1024 + 1);
      await vfs.writeText(walPath, hugeText);

      const res = await journal.replayFromStorage();
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("wal_too_large");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("WAL file too large"));
    });

    it("skips invalid and oversized WAL lines", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal", logger });
      const walPath = ".wal/run-1.jsonl";

      const validLine = JSON.stringify({
        kind: "vfs_checkpoint",
        ts: 1,
        reversible: true,
        checkpoint: { artifactId: "ck-1" },
      });
      const invalidLine = "{invalid";
      const missingKind = JSON.stringify({ ts: 1 });
      const invalidReversible = JSON.stringify({ kind: "custom", ts: 1, reversible: "yes" });
      const largePayload = "x".repeat(100 * 1024 + 8);
      const oversizedLine = JSON.stringify({
        kind: "vfs_checkpoint",
        ts: 2,
        reversible: true,
        checkpoint: { artifactId: "ck-2" },
        meta: { blob: largePayload },
      });

      await vfs.writeText(walPath, [validLine, invalidLine, missingKind, invalidReversible, oversizedLine].join("\n"));

      const res = await journal.replayFromStorage();
      expect(res.ok).toBe(true);
      expect(res.recovered).toBe(1);
      expect(journal.getCursor()).toBe(1);
      expect(logger.warn.mock.calls.some(([msg]) => String(msg).includes("Skipped"))).toBe(true);
    });

    it("prevents duplicate eventIds after replay", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      const walPath = ".wal/run-1.jsonl";
      const line = JSON.stringify({
        kind: "vfs_checkpoint",
        ts: 1,
        reversible: true,
        eventId: "evt-1",
        checkpoint: { artifactId: "ck-1" },
      });
      await vfs.writeText(walPath, `${line}\n`);

      const res = await journal.replayFromStorage();
      expect(res.ok).toBe(true);
      expect(journal.getCursor()).toBe(1);

      journal._onVfsWriteEvent({ eventId: "evt-1", payload: { checkpoint: { artifactId: "ck-2" } } });
      expect(journal.getCursor()).toBe(1);
    });
  });

  describe("compact", () => {
    it("rejects missing runId, vfs, or invalid wal path", async () => {
      const journalMissingId = new SideEffectJournal({ vfs: {} });
      const resMissingId = await journalMissingId.compact();
      expect(resMissingId.ok).toBe(false);
      expect(resMissingId.reason).toBe("missing_runId");

      const journalMissingVfs = new SideEffectJournal({ runId: "run-1" });
      const resMissingVfs = await journalMissingVfs.compact();
      expect(resMissingVfs.ok).toBe(false);
      expect(resMissingVfs.reason).toBe("missing_vfs");

      const { vfs } = createMemoryVfs();
      const journalBadId = new SideEffectJournal({ runId: "../bad", vfs, walDir: ".wal", logger });
      const resBadId = await journalBadId.compact();
      expect(resBadId.ok).toBe(false);
      expect(resBadId.reason).toBe("missing_wal_path");
    });

    it("handles wal directory or write limitations", async () => {
      const { vfs } = createMemoryVfs();
      delete vfs.mkdir;
      const journalNoDir = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      const resNoDir = await journalNoDir.compact();
      expect(resNoDir.ok).toBe(false);
      expect(resNoDir.reason).toBe("wal_dir_unavailable");

      const { vfs: vfsNoWrite } = createMemoryVfs();
      delete vfsNoWrite.write;
      delete vfsNoWrite.writeText;
      delete vfsNoWrite.writeFile;
      const journalNoWrite = new SideEffectJournal({ runId: "run-1", vfs: vfsNoWrite, walDir: ".wal" });
      const resNoWrite = await journalNoWrite.compact();
      expect(resNoWrite.ok).toBe(false);
      expect(resNoWrite.reason).toBe("wal_write_unsupported");
    });

    it("rewrites WAL to current entries", async () => {
      const { vfs, files } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      const walPath = ".wal/run-1.jsonl";

      journal.record({ kind: "custom", ts: 1 });
      journal.record({ kind: "custom", ts: 2 });
      await journal.persist();

      await vfs.appendText(walPath, `${JSON.stringify({ kind: "custom", ts: 3 })}\n`);

      const res = await journal.compact();
      expect(res.ok).toBe(true);
      expect(res.before).toBe(3);
      expect(res.after).toBe(2);
      expect(res.saved).toBe(1);

      const wal = files.get(walPath);
      expect(wal.trim().split(/\r?\n/).length).toBe(2);
    });

    it("reports write failures as compact_failed", async () => {
      const { vfs } = createMemoryVfs();
      delete vfs.write;
      delete vfs.writeFile;
      vfs.writeText = vi.fn(async () => {
        throw new Error("write-failed");
      });
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal", logger });
      const res = await journal.compact();
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("compact_failed");
    });
  });

  describe("rollbackToCursor", () => {
    it("rejects invalid cursor values", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, storageAdapter: {}, logger });
      const res = await journal.rollbackToCursor({});
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("invalid_cursor");
    });

    it("returns early when target cursor is at or beyond current", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, storageAdapter: {}, logger });
      journal.record({ kind: "custom", ts: 1 });

      const res = await journal.rollbackToCursor(Number.MAX_SAFE_INTEGER);
      expect(res.ok).toBe(true);
      expect(res.rolledBack).toBe(0);
      expect(res.cursor).toBe(1);
    });

    it("requires rollback dependencies", async () => {
      const { vfs } = createMemoryVfs();
      const journalMissingVfs = new SideEffectJournal({ runId: "run-1", storageAdapter: {} });
      journalMissingVfs.record({ kind: "custom", ts: 1 });
      const resMissingVfs = await journalMissingVfs.rollbackToCursor(0);
      expect(resMissingVfs.ok).toBe(false);
      expect(resMissingVfs.reason).toBe("missing_vfs");

      const journalMissingStore = new SideEffectJournal({ runId: "run-1", vfs });
      journalMissingStore.record({ kind: "custom", ts: 1 });
      const resMissingStore = await journalMissingStore.rollbackToCursor(0);
      expect(resMissingStore.ok).toBe(false);
      expect(resMissingStore.reason).toBe("missing_runStore");
    });

    it("rolls back checkpoints and reports unknown reversible effects", async () => {
      const { vfs } = createMemoryVfs();
      const eventBus = { emit: vi.fn() };
      const journal = new SideEffectJournal({
        runId: "run-1",
        vfs,
        storageAdapter: {},
        eventBus,
        logger,
      });

      restoreVfsCheckpoint.mockResolvedValueOnce(undefined);
      journal.record({
        kind: "vfs_checkpoint",
        ts: 1,
        reversible: true,
        checkpoint: { artifactId: "ck-1" },
      });
      journal.record({ kind: "custom", ts: 2, reversible: true });

      const res = await journal.rollbackToCursor(-1, { reason: "test" });
      expect(res.ok).toBe(false);
      expect(res.rolledBack).toBe(1);
      expect(res.failures?.length).toBe(1);
      expect(res.failures?.[0].error).toBe("unknown_reversible_effect");
      expect(journal.getCursor()).toBe(0);
      expect(restoreVfsCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({ artifactId: "ck-1" })
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        "side_effects.rolled_back",
        expect.objectContaining({ reason: "test" })
      );
    });

    it("captures checkpoint restore failures during rollback", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, storageAdapter: {}, logger });

      restoreVfsCheckpoint.mockRejectedValueOnce(new Error("restore-failed"));
      journal.record({
        kind: "vfs_checkpoint",
        ts: 1,
        reversible: true,
        checkpoint: { artifactId: "ck-1" },
      });

      const res = await journal.rollbackToCursor(0);
      expect(res.ok).toBe(false);
      expect(res.rolledBack).toBe(0);
      expect(res.failures?.length).toBe(1);
      expect(res.failures?.[0]).toEqual({ seq: 1, kind: "vfs_checkpoint", error: "restore-failed" });
      expect(res.cursor).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("rollback failed for checkpoint ck-1"));
    });

    it("supports string and array cursor coercion", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, storageAdapter: {}, logger });
      journal.record({ kind: "custom", ts: 1 });
      journal.record({ kind: "custom", ts: 2 });

      const resString = await journal.rollbackToCursor("1");
      expect(resString.ok).toBe(true);
      expect(journal.getCursor()).toBe(1);

      const resArray = await journal.rollbackToCursor([]);
      expect(resArray.ok).toBe(true);
      expect(journal.getCursor()).toBe(0);
    });

    it("logs event bus emit failures without breaking", async () => {
      const { vfs } = createMemoryVfs();
      const eventBus = {
        emit: () => {
          throw new Error("emit-failed");
        },
      };
      const journal = new SideEffectJournal({
        runId: "run-1",
        vfs,
        storageAdapter: {},
        eventBus,
        logger,
      });

      restoreVfsCheckpoint.mockResolvedValueOnce(undefined);
      journal.record({
        kind: "vfs_checkpoint",
        ts: 1,
        reversible: true,
        checkpoint: { artifactId: "ck-1" },
      });

      const res = await journal.rollbackToCursor(0);
      expect(res.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to emit"));
    });
  });

  describe("_appendToStorageNow and queue", () => {
    it("validates runId, vfs, and wal path", async () => {
      const { vfs } = createMemoryVfs();
      const journalNoId = new SideEffectJournal({ vfs, walDir: ".wal" });
      const resNoId = await journalNoId._appendToStorageNow({
        seq: 1,
        kind: "custom",
        ts: "t",
        reversible: false,
      });
      expect(resNoId.ok).toBe(false);
      expect(resNoId.reason).toBe("missing_runId");

      const journalNoVfs = new SideEffectJournal({ runId: "run-1" });
      const resNoVfs = await journalNoVfs._appendToStorageNow({
        seq: 1,
        kind: "custom",
        ts: "t",
        reversible: false,
      });
      expect(resNoVfs.ok).toBe(false);
      expect(resNoVfs.reason).toBe("missing_vfs");

      const journalBadId = new SideEffectJournal({ runId: "../bad", vfs, walDir: ".wal", logger });
      const resBadId = await journalBadId._appendToStorageNow({
        seq: 1,
        kind: "custom",
        ts: "t",
        reversible: false,
      });
      expect(resBadId.ok).toBe(false);
      expect(resBadId.reason).toBe("missing_wal_path");
    });

    it("skips already persisted entries and handles wal dir failure", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      journal._persistedCursor = 2;

      const resSkipped = await journal._appendToStorageNow({
        seq: 2,
        kind: "custom",
        ts: "t",
        reversible: false,
      });
      expect(resSkipped.ok).toBe(true);
      expect(resSkipped.skipped).toBe(true);

      const { vfs: vfsNoDir } = createMemoryVfs();
      delete vfsNoDir.mkdir;
      const journalNoDir = new SideEffectJournal({ runId: "run-1", vfs: vfsNoDir, walDir: ".wal" });
      const resNoDir = await journalNoDir._appendToStorageNow({
        seq: 3,
        kind: "custom",
        ts: "t",
        reversible: false,
      });
      expect(resNoDir.ok).toBe(false);
      expect(resNoDir.reason).toBe("wal_dir_unavailable");
    });

    it("handles stringify failure and append fallback", async () => {
      const { vfs, files } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal", logger });
      const circular = { seq: 1, kind: "custom", ts: "t", reversible: false };
      circular.meta = circular;

      const resCircular = await journal._appendToStorageNow(circular);
      expect(resCircular.ok).toBe(false);
      expect(resCircular.reason).toBe("stringify_failed");

      delete vfs.appendText;
      const entry1 = { seq: 1, kind: "custom", ts: "t", reversible: false };
      const entry2 = { seq: 2, kind: "custom", ts: "t", reversible: false };
      const res1 = await journal._appendToStorageNow(entry1);
      const res2 = await journal._appendToStorageNow(entry2);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(files.get(".wal/run-1.jsonl").trim().split(/\r?\n/).length).toBe(2);
    });

    it("returns wal_write_failed when append throws", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });
      vfs.appendText.mockRejectedValueOnce(new Error("append-failed"));

      const res = await journal._appendToStorageNow({ seq: 1, kind: "custom", ts: "t", reversible: false });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("wal_write_failed");
      expect(res.error).toContain("append-failed");
    });

    it("queues concurrent appends in order", async () => {
      const { vfs, files } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal" });

      const entry1 = journal.record({ kind: "custom", ts: 1 }, { persist: false });
      const entry2 = journal.record({ kind: "custom", ts: 2 }, { persist: false });

      const p1 = journal._appendToStorage(entry1);
      const p2 = journal._appendToStorage(entry2);
      await Promise.all([p1, p2]);

      const wal = files.get(".wal/run-1.jsonl").trim().split(/\r?\n/);
      expect(wal[0]).toContain("\"seq\":1");
      expect(wal[1]).toContain("\"seq\":2");
    });
  });

  describe("_getWalPath and _ensureWalDir", () => {
    it("sanitizes runId and joins wal paths", async () => {
      const { vfs } = createMemoryVfs();
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal/", logger });

      const validPath = journal._getWalPath("run-1");
      expect(validPath).toBe(".wal/run-1.jsonl");

      const invalidPath = journal._getWalPath("../bad");
      expect(invalidPath).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid runId"));

      const dotPath = journal._getWalPath(".hidden");
      expect(dotPath).toBeNull();
    });

    it("ensures wal directory exists", async () => {
      const { vfs } = createMemoryVfs();
      vfs.exists = vi.fn(async (path) => path === ".wal");
      const journal = new SideEffectJournal({ runId: "run-1", vfs, walDir: ".wal", logger });
      const okExisting = await journal._ensureWalDir();
      expect(okExisting).toBe(true);
      expect(vfs.mkdir).not.toHaveBeenCalled();

      const { vfs: vfsNew } = createMemoryVfs();
      const journalNew = new SideEffectJournal({ runId: "run-1", vfs: vfsNew, walDir: ".wal", logger });
      const okNew = await journalNew._ensureWalDir();
      expect(okNew).toBe(true);
      expect(vfsNew.mkdir).toHaveBeenCalled();

      const { vfs: vfsFail } = createMemoryVfs();
      vfsFail.exists = vi.fn(async () => false);
      vfsFail.mkdir = vi.fn(async () => {
        throw new Error("mkdir-failed");
      });
      const journalFail = new SideEffectJournal({ runId: "run-1", vfs: vfsFail, walDir: ".wal", logger });
      const okFail = await journalFail._ensureWalDir();
      expect(okFail).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("WAL mkdir failed"));
    });
  });

  describe("_onVfsWriteEvent", () => {
    it("records vfs checkpoint entries and enforces dedupe", () => {
      const journal = new SideEffectJournal({ runId: "run-1" });
      journal._onVfsWriteEvent({
        eventId: "evt-1",
        ts: 1,
        payload: {
          op: "write",
          path: "file.txt",
          checkpoint: { artifactId: "ck-1", type: "custom.json" },
        },
      });

      expect(journal.getCursor()).toBe(1);
      const [entry] = journal.listEntries();
      expect(entry.kind).toBe("vfs_checkpoint");
      expect(entry.reversible).toBe(true);
      expect(entry.eventId).toBe("evt-1");
      expect(entry.op).toBe("write");
      expect(entry.path).toBe("file.txt");
      expect(entry.checkpoint).toEqual({
        artifactId: "ck-1",
        type: "custom.json",
        path: "file.txt",
      });

      journal._onVfsWriteEvent({
        eventId: "evt-1",
        payload: { checkpoint: { artifactId: "ck-2" } },
      });
      expect(journal.getCursor()).toBe(1);

      journal._onVfsWriteEvent(
        { eventId: "evt-1", payload: { checkpoint: { artifactId: "ck-2" } } },
        { allowDuplicates: true }
      );
      expect(journal.getCursor()).toBe(2);
    });

    it("ignores replay events, missing artifactId, and invalid payloads", () => {
      const journal = new SideEffectJournal({ runId: "run-1" });

      journal._onVfsWriteEvent({ meta: { replay: true }, payload: { checkpoint: { artifactId: "ck-1" } } });
      journal._onVfsWriteEvent({ payload: { checkpoint: {} } });
      journal._onVfsWriteEvent({ payload: [] });
      journal._onVfsWriteEvent({ eventId: "   ", payload: { checkpoint: { artifactId: "ck-2" } } });

      expect(journal.getCursor()).toBe(1);
      expect(journal.listEntries()[0].eventId).toBeUndefined();
    });
  });
});

describe("default (SideEffectJournal)", () => {
  it("exports the SideEffectJournal class as default", () => {
    expect(SideEffectJournalDefault).toBe(SideEffectJournal);
  });
});
