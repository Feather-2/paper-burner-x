import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/vfs/checkpoints.js", () => ({
  restoreVfsCheckpoint: vi.fn(async () => undefined),
}));

import { restoreVfsCheckpoint } from "../../../../../js/agents/vfs/checkpoints.js";
import * as sideEffectJournalModule from "../../../../../js/agents/plugins/side-effects/side-effect-journal.js";

const MAX_WAL_FILE_SIZE = 10 * 1024 * 1024;
const MAX_WAL_LINE_SIZE = 100 * 1024;

function createMemoryVfs() {
  /** @type {Map<string, string|Uint8Array>} */
  const files = new Map();
  /** @type {Set<string>} */
  const dirs = new Set();

  const norm = (p) => String(p).replaceAll("\\", "/");
  const toText = (v) =>
    typeof v === "string" ? v : new TextDecoder().decode(v);

  /** @type {import("../../../../../js/agents/plugins/side-effects/side-effect-journal.js").VfsLike & { __files: Map<string, string|Uint8Array>, __dirs: Set<string> }} */
  const vfs = {
    __files: files,
    __dirs: dirs,

    exists: async (path) => files.has(norm(path)) || dirs.has(norm(path)),
    mkdir: async (path) => {
      dirs.add(norm(path));
    },

    read: async (path) => {
      const v = files.get(norm(path));
      if (v == null) return null;
      return typeof v === "string" ? new TextEncoder().encode(v) : v;
    },
    readText: async (path) => {
      const v = files.get(norm(path));
      if (v == null) return null;
      return toText(v);
    },

    write: async (path, data) => {
      files.set(norm(path), data);
    },
    writeText: async (path, text) => {
      files.set(norm(path), String(text));
    },
    writeFile: async (path, content) => {
      files.set(norm(path), content);
    },
    appendText: async (path, text) => {
      const key = norm(path);
      const prev = files.get(key);
      const prevText = prev == null ? "" : toText(prev);
      files.set(key, prevText + String(text));
    },

    readFile: async (path) => {
      const v = files.get(norm(path));
      return v ?? null;
    },
  };

  return vfs;
}

function createStorageAdapter() {
  const store = new Map();
  return {
    get: vi.fn(async (key) => store.get(key)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    __store: store,
  };
}

function createLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function createEventBus() {
  /** @type {Array<{pattern: string, handler: Function}>} */
  const subs = [];
  const match = (pattern, event) => {
    if (pattern === "*" || pattern === "**") return true;
    if (pattern.endsWith("*")) return event.startsWith(pattern.slice(0, -1));
    return pattern === event;
  };

  return {
    subscribe: vi.fn((pattern, handler) => {
      subs.push({ pattern, handler });
      return () => {
        const idx = subs.findIndex(
          (s) => s.pattern === pattern && s.handler === handler,
        );
        if (idx >= 0) subs.splice(idx, 1);
      };
    }),
    emit: vi.fn((event, payload) => {
      for (const s of subs) {
        if (match(String(s.pattern), String(event))) {
          s.handler({
            event,
            type: event,
            name: event,
            payload,
            data: payload,
          });
        }
      }
    }),
    __subs: subs,
  };
}

function createRunStore() {
  return {
    getEvents: vi.fn(async () => []),
    getArtifactById: vi.fn(async () => null),
  };
}

function isClassLike(fn) {
  if (typeof fn !== "function") return false;
  const proto = fn.prototype;
  if (!proto || typeof proto !== "object") return false;
  const methods = Object.getOwnPropertyNames(proto).filter(
    (k) => k !== "constructor" && typeof proto[k] === "function",
  );
  return methods.length > 0;
}

function getMethodNames(obj) {
  const proto = Object.getPrototypeOf(obj);
  if (!proto) return [];
  return Object.getOwnPropertyNames(proto).filter(
    (k) => k !== "constructor" && typeof obj[k] === "function",
  );
}

function findMethodName(obj, preferredNames, fallbackSubstrings) {
  for (const name of preferredNames) {
    if (typeof obj?.[name] === "function") return name;
  }
  const methods = getMethodNames(obj);
  const lower = methods.map((m) => [m, m.toLowerCase()]);
  for (const sub of fallbackSubstrings) {
    const needle = sub.toLowerCase();
    const hit = lower.find(([, l]) => l.includes(needle));
    if (hit) return hit[0];
  }
  return null;
}

async function createJournalFromExport(exported, options) {
  if (typeof exported !== "function") {
    throw new TypeError("Export is not callable/constructable");
  }

  if (isClassLike(exported)) {
    return new exported(options);
  }

  return await exported(options);
}

function splitNonEmptyLines(text) {
  return String(text)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

function findWalFilePath(vfs) {
  const keys = [...vfs.__files.keys()];
  if (keys.length === 0) return null;
  const wal = keys.find((k) => k.toLowerCase().endsWith(".wal"));
  if (wal) return wal;
  const walish = keys.find((k) => k.toLowerCase().includes("wal"));
  return walish ?? keys[0];
}

async function expectThrowsOrReturnsFailure(thunk) {
  try {
    const value = await thunk();
    if (value && typeof value === "object" && "ok" in value) {
      expect(value.ok).toBe(false);
      return;
    }
    expect(value).toBeUndefined();
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
  }
}

function looksLikeJournalExport(exportName, exported) {
  if (typeof exported !== "function") return false;
  if (/journal/i.test(exportName)) return true;
  if (isClassLike(exported)) {
    const proto = exported.prototype;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((k) => k !== "constructor" && typeof proto[k] === "function")
      .map((k) => k.toLowerCase());
    return methods.some((m) =>
      ["record", "persist", "replay", "rollback", "compact"].some((s) =>
        m.includes(s),
      ),
    );
  }
  return false;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("module", () => {
  it("exports at least one runtime symbol", () => {
    expect(Object.keys(sideEffectJournalModule).length).toBeGreaterThan(0);
  });
});

for (const [exportName, exported] of Object.entries(sideEffectJournalModule)) {
  describe(exportName, () => {
    it("is defined", () => {
      expect(exported).not.toBeUndefined();
    });

    it("handles boundary values without crashing (type-level)", async () => {
      if (typeof exported === "function") {
        await expectThrowsOrReturnsFailure(() => exported(null));
        await expectThrowsOrReturnsFailure(() => exported(undefined));
        await expectThrowsOrReturnsFailure(() => exported(""));
        await expectThrowsOrReturnsFailure(() => exported("   "));
        await expectThrowsOrReturnsFailure(() => exported(0));
        await expectThrowsOrReturnsFailure(() => exported(-1));
        await expectThrowsOrReturnsFailure(() => exported(Number.MAX_SAFE_INTEGER));
        await expectThrowsOrReturnsFailure(() => exported([]));
        await expectThrowsOrReturnsFailure(() => exported({}));
      } else if (typeof exported === "number") {
        expect(Number.isFinite(exported)).toBe(true);
      } else if (typeof exported === "string") {
        expect(exported.length).toBeGreaterThanOrEqual(0);
      } else if (exported && typeof exported === "object") {
        expect(exported).toBeTruthy();
      }
    });

    if (!looksLikeJournalExport(exportName, exported)) return;

    it("creates a journal instance with DI stubs", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      expect(journal).toBeTruthy();
      expect(typeof journal).toBe("object");
    });

    it("records entries with normalized shape (including empty/undefined inputs)", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      expect(recordName).toBeTruthy();

      const record = journal[recordName].bind(journal);

      const e0 = await record();
      expect(e0).toBeTruthy();
      expect(typeof e0.kind).toBe("string");
      expect(e0.kind.trim().length).toBeGreaterThan(0);
      expect(typeof e0.seq).toBe("number");
      expect(typeof e0.ts).toBe("string");
      expect(e0.ts.trim().length).toBeGreaterThan(0);
      expect(typeof e0.reversible).toBe("boolean");

      const e1 = await record({
        kind: "vfs",
        ts: 0,
        reversible: true,
        checkpoint: { artifactId: "a1", type: "file", path: "file.txt" },
        path: "file.txt",
        op: "write",
        eventId: "evt-1",
        meta: { foo: "bar" },
      });

      expect(e1).toBeTruthy();
      expect(e1).toEqual(
        expect.objectContaining({
          kind: "vfs",
          reversible: true,
          path: "file.txt",
          op: "write",
          eventId: "evt-1",
        }),
      );
      expect(typeof e1.seq).toBe("number");
      expect(typeof e1.ts).toBe("string");
      expect(e1.ts.trim().length).toBeGreaterThan(0);
      expect(e1.checkpoint).toEqual(expect.objectContaining({ artifactId: "a1" }));
    });

    it("record(null) rejects; ts numeric/string extremes normalize", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      expect(recordName).toBeTruthy();
      const record = journal[recordName].bind(journal);

      await expectThrowsOrReturnsFailure(() => record(null));

      const entries = await Promise.all([
        record({ ts: -1 }),
        record({ ts: 0 }),
        record({ ts: Number.MAX_SAFE_INTEGER }),
        record({ ts: "123" }),
        record({ ts: "   456   " }),
      ]);

      for (const e of entries) {
        expect(e).toBeTruthy();
        expect(typeof e.ts).toBe("string");
        expect(e.ts.trim().length).toBeGreaterThan(0);
      }
    });

    it("generates unique seq under rapid/concurrent record calls", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      expect(recordName).toBeTruthy();
      const record = journal[recordName].bind(journal);

      const n = 50;
      const entries = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          record({
            kind: "vfs",
            reversible: true,
            checkpoint: { artifactId: `a${i}` },
            path: `p${i}.txt`,
            op: "write",
            eventId: `e${i}`,
          }),
        ),
      );

      const seqs = entries.map((e) => e?.seq);
      expect(seqs.every((s) => typeof s === "number")).toBe(true);
      expect(new Set(seqs).size).toBe(n);
    });

    it("persists JSONL WAL and respects MAX_WAL_LINE_SIZE", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName = findMethodName(
        journal,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      expect(recordName).toBeTruthy();
      expect(persistName).toBeTruthy();

      const record = journal[recordName].bind(journal);
      const persist = journal[persistName].bind(journal);

      const huge = "x".repeat(MAX_WAL_LINE_SIZE + 1024);
      await record({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "huge-1" },
        path: "huge.txt",
        op: "write",
        eventId: "huge",
        meta: { huge },
      });

      await record({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "small-1" },
        path: "small.txt",
        op: "write",
        eventId: "small",
        meta: { ok: true },
      });

      const res = await persist();
      if (res && typeof res === "object" && "ok" in res) {
        expect(typeof res.ok).toBe("boolean");
      }

      const walPath = findWalFilePath(vfs);
      expect(walPath).toBeTruthy();

      const walText = await vfs.readText(walPath);
      expect(typeof walText).toBe("string");

      const lines = splitNonEmptyLines(walText);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(
          MAX_WAL_LINE_SIZE,
        );
        const obj = JSON.parse(line);
        expect(obj).toEqual(
          expect.objectContaining({
            seq: expect.any(Number),
            kind: expect.any(String),
            ts: expect.any(String),
            reversible: expect.any(Boolean),
          }),
        );
      }
    });

    it("persist is stable on immediate re-call (no duplicate WAL growth)", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName = findMethodName(
        journal,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      expect(recordName).toBeTruthy();
      expect(persistName).toBeTruthy();

      const record = journal[recordName].bind(journal);
      const persist = journal[persistName].bind(journal);

      await record({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a1" },
        path: "x.txt",
        op: "write",
        eventId: "e1",
      });
      await persist();

      const walPath = findWalFilePath(vfs);
      expect(walPath).toBeTruthy();

      const before = await vfs.readText(walPath);
      await persist();
      const after = await vfs.readText(walPath);

      expect(after).toBe(before);
    });

    it("replays WAL and advances seq beyond persisted max", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal1 = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName1 = findMethodName(
        journal1,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName1 = findMethodName(
        journal1,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      expect(recordName1).toBeTruthy();
      expect(persistName1).toBeTruthy();

      const record1 = journal1[recordName1].bind(journal1);
      const persist1 = journal1[persistName1].bind(journal1);

      const e1 = await record1({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a1" },
        path: "a.txt",
        op: "write",
        eventId: "e1",
      });
      const e2 = await record1({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a2" },
        path: "b.txt",
        op: "write",
        eventId: "e2",
      });

      await persist1();

      const walPath = findWalFilePath(vfs);
      expect(walPath).toBeTruthy();

      const walText = await vfs.readText(walPath);
      const lines = splitNonEmptyLines(walText);
      const parsed = lines.map((l) => JSON.parse(l));
      const maxSeq = Math.max(...parsed.map((o) => Number(o.seq)));

      const journal2 = await createJournalFromExport(exported, {
        vfs,
        logger: createLogger(),
        storageAdapter: createStorageAdapter(),
        eventBus: createEventBus(),
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const replayName2 = findMethodName(
        journal2,
        ["replay"],
        ["replay", "recover", "load"],
      );
      const recordName2 = findMethodName(
        journal2,
        ["record"],
        ["record", "log", "append", "add"],
      );
      expect(replayName2).toBeTruthy();
      expect(recordName2).toBeTruthy();

      const replay2 = journal2[replayName2].bind(journal2);
      const record2 = journal2[recordName2].bind(journal2);

      const replayRes = await replay2();
      if (replayRes && typeof replayRes === "object" && "ok" in replayRes) {
        expect(typeof replayRes.ok).toBe("boolean");
      }

      const e3 = await record2({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a3" },
        path: "c.txt",
        op: "write",
        eventId: "e3",
      });

      expect(typeof e3.seq).toBe("number");
      expect(e3.seq).toBeGreaterThan(maxSeq);

      // sanity: recorded seqs from first journal are numbers too
      expect(typeof e1.seq).toBe("number");
      expect(typeof e2.seq).toBe("number");
    });

    it("replay warns on invalid JSON line and continues", async () => {
      const vfs = createMemoryVfs();
      const logger1 = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal1 = await createJournalFromExport(exported, {
        vfs,
        logger: logger1,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal1,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName = findMethodName(
        journal1,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      expect(recordName).toBeTruthy();
      expect(persistName).toBeTruthy();

      await journal1[recordName]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a1" },
        path: "x.txt",
        op: "write",
        eventId: "e1",
      });
      await journal1[persistName]();

      const walPath = findWalFilePath(vfs);
      expect(walPath).toBeTruthy();

      const good = await vfs.readText(walPath);
      await vfs.writeText(walPath, "{not-json}\n" + good);

      const logger2 = createLogger();
      const journal2 = await createJournalFromExport(exported, {
        vfs,
        logger: logger2,
        storageAdapter: createStorageAdapter(),
        eventBus: createEventBus(),
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const replayName = findMethodName(
        journal2,
        ["replay"],
        ["replay", "recover", "load"],
      );
      const recordName2 = findMethodName(
        journal2,
        ["record"],
        ["record", "log", "append", "add"],
      );
      expect(replayName).toBeTruthy();
      expect(recordName2).toBeTruthy();

      await journal2[replayName]();
      expect(logger2.warn.mock.calls.length + logger2.error.mock.calls.length).toBeGreaterThan(
        0,
      );

      const e = await journal2[recordName2]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a2" },
        path: "y.txt",
        op: "write",
        eventId: "e2",
      });
      expect(typeof e.seq).toBe("number");
      expect(typeof e.ts).toBe("string");
    });

    it("replay rejects oversized WAL content (> MAX_WAL_FILE_SIZE)", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal1 = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal1,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName = findMethodName(
        journal1,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      expect(recordName).toBeTruthy();
      expect(persistName).toBeTruthy();

      await journal1[recordName]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a1" },
        path: "x.txt",
        op: "write",
        eventId: "e1",
      });
      await journal1[persistName]();

      const walPath = findWalFilePath(vfs);
      expect(walPath).toBeTruthy();

      const huge = "a".repeat(MAX_WAL_FILE_SIZE + 1);
      await vfs.writeText(walPath, huge);

      const journal2 = await createJournalFromExport(exported, {
        vfs,
        logger: createLogger(),
        storageAdapter: createStorageAdapter(),
        eventBus: createEventBus(),
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const replayName = findMethodName(
        journal2,
        ["replay"],
        ["replay", "recover", "load"],
      );
      expect(replayName).toBeTruthy();

      await expectThrowsOrReturnsFailure(() => journal2[replayName]());
    });

    it("rollback uses restoreVfsCheckpoint and surfaces failures", async () => {
      vi.mocked(restoreVfsCheckpoint).mockResolvedValue(undefined);

      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const rollbackName = findMethodName(
        journal,
        ["rollback"],
        ["rollback", "undo", "revert"],
      );
      expect(recordName).toBeTruthy();
      expect(rollbackName).toBeTruthy();

      await journal[recordName]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "c1" },
        path: "a.txt",
        op: "write",
        eventId: "e1",
      });
      await journal[recordName]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "c2" },
        path: "b.txt",
        op: "write",
        eventId: "e2",
      });

      vi.mocked(restoreVfsCheckpoint)
        .mockImplementationOnce(async () => {
          throw new Error("boom");
        })
        .mockResolvedValueOnce(undefined);

      // Some implementations expose rollbackToCursor(cursor, options) rather than rollback(options).
      // Try the options-only form first, then fall back to cursor-based rollback when we detect it.
      let res = await journal[rollbackName]({ reason: "test" });
      if (res && typeof res === "object" && res.reason === "invalid_cursor") {
        res = await journal[rollbackName](0, { reason: "test" });
      }

      expect(vi.mocked(restoreVfsCheckpoint).mock.calls.length).toBeGreaterThanOrEqual(1);

      const asFailures =
        Array.isArray(res) ? res : res && typeof res === "object"
          ? (res.failures ?? res.errors ?? res.rollbackFailures ?? null)
          : null;

      if (Array.isArray(asFailures)) {
        expect(asFailures.length).toBeGreaterThanOrEqual(1);
        const f = asFailures[0];
        expect(f).toEqual(
          expect.objectContaining({
            error: expect.any(String),
          }),
        );
      } else {
        expect(logger.error.mock.calls.length + logger.warn.mock.calls.length).toBeGreaterThan(
          0,
        );
      }
    });

    it("persist returns failure on VFS write errors (error-handling)", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      // force a write failure regardless of which write API is used
      vfs.appendText = vi.fn(async () => {
        throw new Error("append failed");
      });
      vfs.writeText = vi.fn(async () => {
        throw new Error("writeText failed");
      });
      vfs.writeFile = vi.fn(async () => {
        throw new Error("writeFile failed");
      });
      vfs.write = vi.fn(async () => {
        throw new Error("write failed");
      });

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName = findMethodName(
        journal,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      expect(recordName).toBeTruthy();
      expect(persistName).toBeTruthy();

      await journal[recordName]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a1" },
        path: "x.txt",
        op: "write",
        eventId: "e1",
      });

      await expectThrowsOrReturnsFailure(() => journal[persistName]());
      expect(logger.error.mock.calls.length + logger.warn.mock.calls.length).toBeGreaterThan(
        0,
      );
    });

    it("compact is callable and does not break WAL invariants", async () => {
      const vfs = createMemoryVfs();
      const logger = createLogger();
      const storageAdapter = createStorageAdapter();
      const eventBus = createEventBus();
      const runStore = createRunStore();

      const journal = await createJournalFromExport(exported, {
        vfs,
        logger,
        storageAdapter,
        eventBus,
        runStore,
        runId: "run-1",
        walDir: "wal",
        autoPersist: false,
      });

      const recordName = findMethodName(
        journal,
        ["record"],
        ["record", "log", "append", "add"],
      );
      const persistName = findMethodName(
        journal,
        ["persist"],
        ["persist", "flush", "save", "write"],
      );
      const compactName = findMethodName(
        journal,
        ["compact"],
        ["compact", "prune", "gc", "compress"],
      );
      expect(recordName).toBeTruthy();
      expect(persistName).toBeTruthy();
      expect(compactName).toBeTruthy();

      await journal[recordName]({
        kind: "vfs",
        reversible: true,
        checkpoint: { artifactId: "a1" },
        path: "x.txt",
        op: "write",
        eventId: "e1",
        meta: (() => {
          // deep nested meta boundary (non-circular)
          let obj = { leaf: true };
          for (let i = 0; i < 50; i++) obj = { level: i, child: obj };
          return obj;
        })(),
      });
      await journal[persistName]();

      const walPathBefore = findWalFilePath(vfs);
      expect(walPathBefore).toBeTruthy();
      const before = await vfs.readText(walPathBefore);

      const res = await journal[compactName]();
      if (res && typeof res === "object" && "ok" in res) {
        expect(typeof res.ok).toBe("boolean");
      }

      const walPathAfter = findWalFilePath(vfs);
      expect(walPathAfter).toBeTruthy();
      const after = await vfs.readText(walPathAfter);

      const afterLines = splitNonEmptyLines(after ?? "");
      for (const line of afterLines) {
        expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(
          MAX_WAL_LINE_SIZE,
        );
      }

      // should not grow when compacting
      if (typeof before === "string" && typeof after === "string") {
        expect(after.length).toBeLessThanOrEqual(before.length + 64);
      }
    });
  });
}
