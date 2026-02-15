import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextDecoder, TextEncoder } from "node:util";

const MODULE_PATH = "../../../../js/agents/vfs/operations.js";

vi.mock("../../../../js/agents/vfs/path.js", () => {
  const normalizeVfsPath = vi.fn((p) => {
    if (p == null) return "";
    const s = String(p).replace(/\\/g, "/");
    if (!s) return "";
    return s.startsWith("/") ? s : `/${s}`;
  });
  return { normalizeVfsPath };
});

vi.mock("../../../../js/agents/vfs/checkpoints.js", () => {
  const recordVfsCheckpoint = vi.fn(async (_vfs, path) => {
    const id = `chk_${String(path ?? "")}`;
    return { id, checkpointId: id, path: String(path ?? "") };
  });
  return { recordVfsCheckpoint };
});

vi.mock("../../../../js/agents/shared/index.js", () => {
  const cryptoRandomHex = vi.fn((len = 8) => {
    const n =
      typeof len === "number" && Number.isFinite(len)
        ? Math.max(0, Math.floor(len))
        : 8;
    return "a".repeat(n);
  });

  const isPlainObject = vi.fn((v) => {
    if (v === null || typeof v !== "object") return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  });

  return { cryptoRandomHex, isPlainObject };
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizePathKey(path) {
  if (path == null) return "";
  const s = String(path).replace(/\\/g, "/");
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "string") return encoder.encode(value);
  if (value == null) return new Uint8Array();
  return encoder.encode(String(value));
}

function fromBytes(value) {
  if (value instanceof Uint8Array) return decoder.decode(value);
  return decoder.decode(toBytes(value));
}

function deferred() {
  /** @type {(v?: any) => void} */
  let resolve;
  /** @type {(e?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createStageApi() {
  return { emit: vi.fn(), eventBus: { emit: vi.fn() } };
}

function createMemoryVfs(initialFiles = {}) {
  const files = new Map();
  for (const [p, content] of Object.entries(initialFiles)) {
    const key = normalizePathKey(p);
    if (!key) continue;
    files.set(key, toBytes(content));
  }

  const api = {
    __files: files,

    readFile: vi.fn(async (path) => {
      const key = normalizePathKey(path);
      if (!files.has(key)) throw new Error(`ENOENT: ${key}`);
      const bytes = files.get(key) || new Uint8Array();
      return new Uint8Array(bytes);
    }),

    writeFile: vi.fn(async (path, bytes) => {
      const key = normalizePathKey(path);
      if (!key) throw new Error("path required");
      files.set(key, toBytes(bytes));
    }),

    readText: vi.fn(async (path) => {
      const bytes = await api.readFile(path);
      return fromBytes(bytes);
    }),

    writeText: vi.fn(async (path, text) => {
      await api.writeFile(path, toBytes(text));
    }),

    delete: vi.fn(async (path) => {
      const key = normalizePathKey(path);
      if (!files.delete(key)) throw new Error(`ENOENT: ${key}`);
    }),

    unlink: vi.fn(async (path) => api.delete(path)),
    rm: vi.fn(async (path) => api.delete(path)),

    exists: vi.fn(async (path) => files.has(normalizePathKey(path))),

    stat: vi.fn(async (path) => {
      const key = normalizePathKey(path);
      const bytes = files.get(key);
      if (!bytes) throw new Error(`ENOENT: ${key}`);
      return {
        size: bytes.length,
        isFile: () => true,
        isDirectory: () => false,
      };
    }),

    mkdir: vi.fn(async () => {}),
    mkdirp: vi.fn(async () => {}),
    ensureDir: vi.fn(async () => {}),

    readdir: vi.fn(async (dirPath) => {
      const dir = normalizePathKey(dirPath).replace(/\/+$/, "");
      const prefix = dir ? (dir.endsWith("/") ? dir : `${dir}/`) : "";
      const out = new Set();

      for (const key of files.keys()) {
        const normalized = key.replace(/\\/g, "/");
        if (prefix && !normalized.startsWith(prefix)) continue;

        const rest = prefix ? normalized.slice(prefix.length) : normalized;
        const first = rest.split("/")[0];
        if (first) out.add(first);
      }

      return Array.from(out).sort();
    }),
  };

  return api;
}

function seedFilesForPath(path, content) {
  const raw = String(path ?? "");
  const normSlashes = raw.replace(/\\/g, "/");
  const withLeading = normSlashes.startsWith("/") ? normSlashes : `/${normSlashes}`;
  const withoutLeading = withLeading.startsWith("/") ? withLeading.slice(1) : withLeading;

  const keys = new Set([raw, normSlashes, withLeading, withoutLeading].filter(Boolean));
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of keys) out[k] = content;
  return out;
}

function getTextFromVfs(vfs, path) {
  const raw = String(path ?? "");
  const normSlashes = raw.replace(/\\/g, "/");
  const withLeading = normSlashes.startsWith("/") ? normSlashes : `/${normSlashes}`;
  const withoutLeading = withLeading.startsWith("/") ? withLeading.slice(1) : withLeading;

  for (const k of [raw, normSlashes, withLeading, withoutLeading].filter(Boolean)) {
    if (vfs?.__files?.has?.(k)) return fromBytes(vfs.__files.get(k));
  }
  return null;
}

function resolvePathFromArgs(args) {
  if (!args || typeof args !== "object") return undefined;
  return (
    args.path ??
    args.file_path ??
    args.filePath ??
    args.vfs_path ??
    args.vfsPath ??
    args.pathname
  );
}

function resolveContentFromArgs(args) {
  if (!args || typeof args !== "object") return undefined;
  return args.content ?? args.text ?? args.data ?? args.bytes;
}

const CALL_PATTERNS = [
  ({ fn, vfs, stageApi, args }) => fn({ vfs, ...(args || {}) }),
  ({ fn, vfs, stageApi, args }) => fn({ vfs, ...(args || {}) }, stageApi),
  ({ fn, vfs, stageApi, args }) => fn({ ...(args || {}), vfs }, stageApi),
  ({ fn, vfs, stageApi, args }) => fn({ ...(args || {}), vfs }),
  ({ fn, vfs, stageApi, args }) => fn(stageApi, { vfs, ...(args || {}) }),
  ({ fn, vfs, stageApi, args }) => fn({ stageApi, vfs, ...(args || {}) }),
  ({ fn, vfs, stageApi, args }) => {
    const p = resolvePathFromArgs(args);
    return fn(vfs, p, args);
  },
  ({ fn, vfs, stageApi, args }) => {
    const p = resolvePathFromArgs(args);
    const c = resolveContentFromArgs(args);
    return fn(vfs, p, c, stageApi);
  },
  ({ fn, vfs, stageApi, args }) => {
    const p = resolvePathFromArgs(args);
    return fn(stageApi, vfs, p, args);
  },
];

async function findWorkingPattern(fn, { initialFiles = {}, args = {}, stageApi } = {}) {
  /** @type {any[]} */
  const errors = [];
  for (let i = 0; i < CALL_PATTERNS.length; i++) {
    const vfs = createMemoryVfs(initialFiles);
    const sa = stageApi ?? createStageApi();
    try {
      const result = await CALL_PATTERNS[i]({ fn, vfs, stageApi: sa, args });
      if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        const detail = typeof result.error === "string" ? result.error : "operation returned ok:false";
        throw new Error(detail);
      }
      return { result, vfs, stageApi: sa, patternIndex: i };
    } catch (err) {
      errors.push(err);
    }
  }

  const message = errors
    .map((e) => (e && typeof e === "object" && "message" in e ? String(e.message) : String(e)))
    .filter(Boolean)
    .slice(0, 8)
    .join(" | ");

  throw new Error(
    `Unable to invoke export "${fn?.name || "anonymous"}" with common signatures: ${message}`
  );
}

function extractText(result) {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (result instanceof Uint8Array) return fromBytes(result);
  if (typeof result === "object") {
    const candidate =
      result.content ??
      result.text ??
      result.data ??
      result.result ??
      result.value ??
      null;
    if (typeof candidate === "string") return candidate;
    if (candidate instanceof Uint8Array) return fromBytes(candidate);
  }
  return null;
}

function makeDeepObject(depth) {
  const root = {};
  let cur = root;
  for (let i = 0; i < depth; i++) {
    cur.next = {};
    cur = cur.next;
  }
  return root;
}

async function expectThrowOrReject(thunk) {
  let didThrow = false;
  try {
    const res = thunk();
    await res;
  } catch (err) {
    didThrow = true;
    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message ?? "")).not.toBe("");
  }
  if (!didThrow) throw new Error("Expected function to throw or reject");
}

const initialModule = await import(MODULE_PATH);
const EXPORT_ENTRIES = Object.entries(initialModule);

describe("js/agents/vfs/operations.js", () => {
  it("exports at least one symbol", () => {
    expect(EXPORT_ENTRIES.length).toBeGreaterThan(0);
  });
});

describe("withVfsPathLock behavior via writeTextFileWithPolicy", () => {
  it("preserves serialization when a queued waiter aborts", async () => {
    vi.resetModules();
    const { writeTextFileWithPolicy } = await import(MODULE_PATH);
    const vfs = createMemoryVfs(seedFilesForPath("/locked.txt", "init"));
    const gate = deferred();
    const originalWriteText = vfs.writeText;
    let writeCount = 0;

    vfs.writeText = vi.fn(async (path, text) => {
      writeCount += 1;
      if (writeCount === 1) {
        await gate.promise;
      }
      return await originalWriteText(path, text);
    });

    const first = writeTextFileWithPolicy({ vfs, path: "/locked.txt", text: "first" });

    for (let i = 0; i < 8 && writeCount === 0; i += 1) {
      await Promise.resolve();
    }
    expect(writeCount).toBe(1);

    const controller = new AbortController();
    const second = writeTextFileWithPolicy({
      vfs,
      path: "/locked.txt",
      text: "second",
      signal: controller.signal,
    });
    controller.abort("cancelled");
    await expect(second).rejects.toHaveProperty("message", "cancelled");

    const third = writeTextFileWithPolicy({ vfs, path: "/locked.txt", text: "third" });
    let thirdSettled = false;
    third.finally(() => {
      thirdSettled = true;
    });
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve();
    }
    expect(thirdSettled).toBe(false);

    gate.resolve();
    await expect(first).resolves.toMatchObject({ ok: true, path: "/locked.txt" });
    await expect(third).resolves.toMatchObject({ ok: true, path: "/locked.txt" });
    await expect(vfs.readText("/locked.txt")).resolves.toBe("third");
  });
});

for (const [exportName, exportedValue] of EXPORT_ENTRIES) {
  const exportType = typeof exportedValue;
  const fnName = exportType === "function" ? exportedValue.name : "";
  const source = exportType === "function" ? String(exportedValue) : "";
  const isClass = exportType === "function" && /^class\s/.test(source);

  const isWaitFor = exportName === "waitFor" || fnName === "waitFor";
  const isWithVfsPathLock = exportName === "withVfsPathLock" || fnName === "withVfsPathLock";
  const isSafeReadText = exportName === "safeReadText" || fnName === "safeReadText";
  const isRemoveVfsPath = exportName === "removeVfsPath" || fnName === "removeVfsPath";
  const isGetEmitFn = exportName === "getEmitFn" || fnName === "getEmitFn";
  const isNormalizeEditOperation =
    exportName === "normalizeEditOperation" || fnName === "normalizeEditOperation";
  const isCountOccurrences = exportName === "countOccurrences" || fnName === "countOccurrences";

  const seemsLikeEditOp =
    !isNormalizeEditOperation &&
    (/old_string|oldString/.test(source) && /new_string|newString/.test(source));

  const seemsLikeWriteOp = /writeText|writeFile/.test(source);
  const seemsLikeReadOp = /readText|readFile/.test(source) && !seemsLikeWriteOp;
  const seemsLikeDeleteOp = /\.(delete|unlink|rm)\(/.test(source) || /\bremoveVfsPath\b/.test(source);

  describe(exportName, () => {
    /** @type {any} */
    let mod;
    /** @type {any} */
    let exported;

    beforeEach(async () => {
      vi.resetModules();
      mod = await import(MODULE_PATH);
      exported = mod[exportName];
      vi.clearAllMocks();
    });

    if (exportType !== "function") {
      it("export type is stable", () => {
        expect(typeof exported).toBe(exportType);
      });

      if (exportType === "object") {
        it("object export is not null and is not an array", () => {
          expect(exported).not.toBeNull();
          expect(Array.isArray(exported)).toBe(false);
        });
      }

      return;
    }

    if (isClass) {
      it("constructs (or throws) with minimal inputs", () => {
        try {
          // eslint-disable-next-line new-cap
          new exported();
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect(String(err?.message ?? "")).not.toBe("");
        }
      });

      return;
    }

    it("is a function", () => {
      expect(typeof exported).toBe("function");
    });

    if (isWaitFor) {
      it("resolves immediate values and thenables without a signal", async () => {
        await expect(exported(123)).resolves.toBe(123);

        const thenable = { then: (resolve) => resolve("ok") };
        await expect(exported(thenable)).resolves.toBe("ok");
      });

      it("rejects immediately when signal is already aborted (string reason)", async () => {
        const signal = { aborted: true, reason: "stop" };
        await expect(exported(Promise.resolve("x"), { signal })).rejects.toHaveProperty(
          "message",
          "stop"
        );
      });

      it("rejects with default message when signal is already aborted (non-string reason)", async () => {
        const signal = { aborted: true, reason: { code: "ABORT" } };
        await expect(exported(Promise.resolve("x"), { signal })).rejects.toHaveProperty(
          "message",
          "aborted"
        );
      });

      it("races abort vs pending promise and removes the abort listener", async () => {
        const d = deferred();
        /** @type {null | ((...args: any[]) => void)} */
        let abortHandler = null;

        const signal = {
          aborted: false,
          reason: undefined,
          addEventListener: vi.fn((type, cb) => {
            if (type === "abort") abortHandler = cb;
          }),
          removeEventListener: vi.fn((type, cb) => {
            if (type === "abort" && abortHandler === cb) abortHandler = null;
          }),
        };

        const p = exported(d.promise, { signal });

        signal.aborted = true;
        signal.reason = "cancelled";
        abortHandler?.();

        await expect(p).rejects.toHaveProperty("message", "cancelled");
        expect(signal.addEventListener).toHaveBeenCalledTimes(1);
        expect(signal.removeEventListener).toHaveBeenCalledTimes(1);

        d.resolve("late");
      });

      return;
    }

    if (isWithVfsPathLock) {
      it("bypasses locking when vfs is nullish or path is empty", async () => {
        const fn = vi.fn(async () => "ok");

        await expect(exported(null, "/x", fn)).resolves.toBe("ok");
        await expect(exported({}, "", fn)).resolves.toBe("ok");

        expect(fn).toHaveBeenCalledTimes(2);
      });

      it("serializes concurrent calls for the same (vfs,path)", async () => {
        const vfs = {};
        const gate = deferred();
        const order = [];

        const p1 = exported(vfs, "/file.txt", async () => {
          order.push("start1");
          await gate.promise;
          order.push("end1");
          return 1;
        });

        const p2 = exported(vfs, "/file.txt", async () => {
          order.push("start2");
          order.push("end2");
          return 2;
        });

        await Promise.resolve();
        expect(order).toEqual(["start1"]);

        gate.resolve();
        await expect(Promise.all([p1, p2])).resolves.toEqual([1, 2]);
        expect(order).toEqual(["start1", "end1", "start2", "end2"]);
      });

      it("allows parallel calls for different paths", async () => {
        const vfs = {};
        const gate1 = deferred();
        const gate2 = deferred();
        const order = [];

        const p1 = exported(vfs, "/a.txt", async () => {
          order.push("start1");
          await gate1.promise;
          order.push("end1");
          return "a";
        });

        const p2 = exported(vfs, "/b.txt", async () => {
          order.push("start2");
          await gate2.promise;
          order.push("end2");
          return "b";
        });

        await Promise.resolve();
        expect(new Set(order)).toEqual(new Set(["start1", "start2"]));

        gate2.resolve();
        gate1.resolve();
        await expect(Promise.all([p1, p2])).resolves.toEqual(["a", "b"]);
      });

      it("releases the lock when the function throws", async () => {
        const vfs = {};
        const gate = deferred();

        const p1 = exported(vfs, "/x", async () => {
          await gate.promise;
          throw new Error("boom");
        });

        gate.resolve();
        await expect(p1).rejects.toHaveProperty("message", "boom");

        await expect(exported(vfs, "/x", async () => "ok")).resolves.toBe("ok");
      });

      return;
    }

    if (isSafeReadText) {
      it("uses vfs.readText when available", async () => {
        const vfs = {
          readText: vi.fn(async () => "hello"),
          readFile: vi.fn(async () => toBytes("should-not-be-called")),
        };

        await expect(exported(vfs, "/a.txt")).resolves.toBe("hello");
        expect(vfs.readText).toHaveBeenCalledTimes(1);
        expect(vfs.readFile).toHaveBeenCalledTimes(0);
      });

      it("falls back to vfs.readFile + TextDecoder", async () => {
        const vfs = { readFile: vi.fn(async () => toBytes("hi")) };
        await expect(exported(vfs, "/a.txt")).resolves.toBe("hi");
        expect(vfs.readFile).toHaveBeenCalledTimes(1);
      });

      it("returns null on read errors", async () => {
        const vfs = {
          readText: vi.fn(async () => {
            throw new Error("read fail");
          }),
        };
        await expect(exported(vfs, "/a.txt")).resolves.toBeNull();
      });

      it("handles a very large file (resource boundary)", async () => {
        const big = "x".repeat(1024 * 256);
        const vfs = { readFile: vi.fn(async () => toBytes(big)) };
        const text = await exported(vfs, "/big.txt");
        expect(text).toHaveLength(big.length);
        expect(text.slice(0, 16)).toBe("x".repeat(16));
      });

      return;
    }

    if (isRemoveVfsPath) {
      it("returns false for non-object vfs (null/undefined/string)", async () => {
        await expect(exported(null, "/x")).resolves.toBe(false);
        await expect(exported(undefined, "/x")).resolves.toBe(false);
        await expect(exported("not-an-object", "/x")).resolves.toBe(false);
      });

      it("prefers vfs.delete, then vfs.unlink, then vfs.rm", async () => {
        const vfs1 = { delete: vi.fn(async () => {}) };
        await expect(exported(vfs1, "/a")).resolves.toBe(true);
        expect(vfs1.delete).toHaveBeenCalledTimes(1);

        const vfs2 = { unlink: vi.fn(async () => {}) };
        await expect(exported(vfs2, "/b")).resolves.toBe(true);
        expect(vfs2.unlink).toHaveBeenCalledTimes(1);

        const vfs3 = { rm: vi.fn(async () => {}) };
        await expect(exported(vfs3, "/c")).resolves.toBe(true);
        expect(vfs3.rm).toHaveBeenCalledTimes(1);
      });

      it("returns false if no supported removal method exists", async () => {
        const vfs = { readFile: vi.fn() };
        await expect(exported(vfs, "/x")).resolves.toBe(false);
      });

      return;
    }

    if (isGetEmitFn) {
      it("returns stageApi.emit when present", () => {
        const stageApi = { emit: () => {} };
        expect(exported(stageApi)).toBe(stageApi.emit);
      });

      it("returns stageApi.eventBus.emit when stageApi.emit is missing", () => {
        const busEmit = () => {};
        const stageApi = { eventBus: { emit: busEmit } };
        expect(exported(stageApi)).toBe(busEmit);
      });

      it("returns null when no emit function exists", () => {
        expect(exported(null)).toBeNull();
        expect(exported({})).toBeNull();
        expect(exported({ emit: 123 })).toBeNull();
        expect(exported({ eventBus: { emit: 123 } })).toBeNull();
      });

      return;
    }

    if (isNormalizeEditOperation) {
      it("normalizes snake_case and camelCase edit objects", () => {
        expect(exported({ old_string: "a", new_string: "b" }, 0)).toEqual({
          oldString: "a",
          newString: "b",
        });

        expect(exported({ oldString: "x", newString: "y" }, 1)).toEqual({
          oldString: "x",
          newString: "y",
        });
      });

      it("throws on empty old_string (null/undefined/empty string/empty array)", () => {
        expect(() => exported(null, 0)).toThrow(/old_string must be a non-empty string/);
        expect(() => exported(undefined, 0)).toThrow(/old_string must be a non-empty string/);
        expect(() => exported({}, 0)).toThrow(/old_string must be a non-empty string/);
        expect(() => exported([], 0)).toThrow(/old_string must be a non-empty string/);
        expect(() => exported({ old_string: "" }, 0)).toThrow(/old_string must be a non-empty string/);
      });

      it("includes boundary indices in error messages (-1 and MAX_SAFE_INTEGER)", () => {
        expect(() => exported({}, -1)).toThrow(/edits\[-1\]/);
        expect(() => exported({}, Number.MAX_SAFE_INTEGER)).toThrow(
          new RegExp(`edits\\[${Number.MAX_SAFE_INTEGER}\\]`)
        );
      });

      it("allows whitespace-only old_string but rejects exact no-op replacements", () => {
        const r = exported({ old_string: "   ", new_string: "x" }, 0);
        expect(r.oldString).toBe("   ");

        expect(() => exported({ old_string: "same", new_string: "same" }, 0)).toThrow(/no-op/);
      });

      it("handles deep nested objects without crashing (resource boundary)", () => {
        const deep = makeDeepObject(64);
        deep.old_string = "a";
        deep.new_string = "b";
        expect(exported(deep, 0)).toEqual({ oldString: "a", newString: "b" });
      });

      return;
    }

    if (isCountOccurrences) {
      it("returns 0 for empty needle and counts non-overlapping occurrences", () => {
        expect(exported("abc", "")).toBe(0);
        expect(exported("abc", null)).toBe(0);
        expect(exported("aaaa", "aa")).toBe(2);
        expect(exported("aaa", "aa")).toBe(1);
      });

      it("covers boundary values (0, -1, MAX_SAFE_INTEGER) and type boundaries", () => {
        expect(exported("111", 0)).toBe(0); // 0 is falsy => early return
        expect(exported("111", -1)).toBe(0);
        expect(exported("111", Number.MAX_SAFE_INTEGER)).toBe(0);

        // Non-string needle is permitted by JS coercion in indexOf, but needle.length will affect stepping.
        // This assertion documents current behavior for a numeric needle: first match only.
        expect(exported("111", 1)).toBe(1);
      });

      it("throws on non-string haystack (type boundary)", () => {
        expect(() => exported(123, "1")).toThrow();
        expect(() => exported({}, "1")).toThrow();
      });

      it("handles very long strings (resource boundary)", () => {
        const big = "a".repeat(10000) + "Z" + "a".repeat(10000);
        expect(exported(big, "Z")).toBe(1);
        expect(exported(big, "not-there")).toBe(0);
      });

      return;
    }

    if (exportName === "writeTextFileWithPolicy" || fnName === "writeTextFileWithPolicy") {
      it("writes text to the VFS and returns ok/path", async () => {
        const vfs = createMemoryVfs({});
        const res = await exported({ vfs, path: "dir/file.txt", text: "hello" });

        expect(res).toEqual(expect.objectContaining({ ok: true, path: "/dir/file.txt" }));
        expect(getTextFromVfs(vfs, "/dir/file.txt")).toBe("hello");
      });

      it("throws for nullish vfs and empty paths", async () => {
        await expect(exported({ vfs: null, path: "/x", text: "y" })).rejects.toBeInstanceOf(Error);
        await expect(exported({ vfs: createMemoryVfs({}), path: "", text: "y" })).rejects.toBeInstanceOf(Error);
      });

      it("accepts whitespace-only paths (boundary value)", async () => {
        const vfs = createMemoryVfs({});
        const res = await exported({ vfs, path: "   ", text: "ok" });
        expect(res).toEqual(expect.objectContaining({ ok: true, path: "/   " }));
        expect(getTextFromVfs(vfs, "/   ")).toBe("ok");
      });

      return;
    }

    if (exportName === "atomicWriteText" || fnName === "atomicWriteText") {
      it("writes content to the VFS (string input) and reports ok=true", async () => {
        const vfs = createMemoryVfs({});
        const path = "/write.txt";

        const res = await exported(vfs, path, "hello");

        expect(res).toEqual(expect.objectContaining({ ok: true, path }));
        expect(getTextFromVfs(vfs, path)).toBe("hello");
      });

      it("returns ok=false for nullish vfs / empty path inputs (error handling, boundary values)", async () => {
        await expect(exported(null, "/x", "y")).resolves.toEqual(expect.objectContaining({ ok: false }));
        await expect(exported({}, "", "y")).resolves.toEqual(expect.objectContaining({ ok: false }));
        await expect(exported({}, "   ", "y")).resolves.toEqual(expect.objectContaining({ ok: false }));
      });

      return;
    }

    if (exportName === "atomicWriteFile" || fnName === "atomicWriteFile") {
      it("writes content to the VFS (bytes input) and reports ok=true", async () => {
        const vfs = createMemoryVfs({});
        const path = "/write.bin";

        const res = await exported(vfs, path, toBytes("BYTES"));

        expect(res).toEqual(expect.objectContaining({ ok: true, path }));
        expect(getTextFromVfs(vfs, path)).toBe("BYTES");
      });

      it("returns ok=false for nullish vfs / empty path inputs (error handling, boundary values)", async () => {
        await expect(exported(null, "/x", toBytes("y"))).resolves.toEqual(expect.objectContaining({ ok: false }));
        await expect(exported({}, "", toBytes("y"))).resolves.toEqual(expect.objectContaining({ ok: false }));
        await expect(exported({}, "   ", toBytes("y"))).resolves.toEqual(expect.objectContaining({ ok: false }));
      });

      return;
    }

    if (seemsLikeEditOp) {
      it("applies a single old_string -> new_string replacement (normal path)", async () => {
        const path = "dir/file.txt";
        const initialText = "hello world";
        const args = {
          path,
          file_path: path,
          old_string: "world",
          new_string: "there",
          edits: [{ old_string: "world", new_string: "there" }],
          expected_replacements: 1,
          expectedReplacements: 1,
        };

        const { vfs } = await findWorkingPattern(exported, {
          initialFiles: seedFilesForPath(path, initialText),
          args,
        });

        expect(getTextFromVfs(vfs, path)).toBe("hello there");
      });

      it("rejects invalid edits: empty old_string and no-op replacements (error handling)", async () => {
        const path = "/x.txt";
        const baseFiles = seedFilesForPath(path, "abc");

        await expectThrowOrReject(() =>
          findWorkingPattern(exported, {
            initialFiles: baseFiles,
            args: { path, edits: [{ old_string: "", new_string: "x" }] },
          })
        );

        await expectThrowOrReject(() =>
          findWorkingPattern(exported, {
            initialFiles: baseFiles,
            args: { path, edits: [{ old_string: "a", new_string: "a" }] },
          })
        );
      });

      it("handles multiple sequential edits (edge: empty edits array rejected)", async () => {
        const path = "/seq.txt";

        await expectThrowOrReject(() =>
          findWorkingPattern(exported, {
            initialFiles: seedFilesForPath(path, "a b c"),
            args: { path, edits: [] },
          })
        );

        const { vfs } = await findWorkingPattern(exported, {
          initialFiles: seedFilesForPath(path, "a b c"),
          args: {
            path,
            edits: [
              { old_string: "a", new_string: "x" },
              { old_string: "b", new_string: "y" },
            ],
          },
        });

        expect(getTextFromVfs(vfs, path)).toBe("x y c");
      });

      it("handles a large file edit (resource boundary)", async () => {
        const path = "/big-edit.txt";
        const big = `START\n${"x".repeat(1024 * 128)}\nEND`;

        const { vfs } = await findWorkingPattern(exported, {
          initialFiles: seedFilesForPath(path, big),
          args: { path, edits: [{ old_string: "END", new_string: "DONE" }] },
        });

        const finalText = getTextFromVfs(vfs, path);
        expect(finalText?.endsWith("DONE")).toBe(true);
      });

      return;
    }

    if (seemsLikeWriteOp) {
      it("writes content to the VFS (text + bytes inputs)", async () => {
        const path = "/write.txt";

        const { vfs: vfs1 } = await findWorkingPattern(exported, {
          initialFiles: {},
          args: {
            path,
            file_path: path,
            content: "hello",
            text: "hello",
            data: "hello",
            bytes: toBytes("hello"),
          },
        });
        expect(getTextFromVfs(vfs1, path)).toBe("hello");

        const { vfs: vfs2 } = await findWorkingPattern(exported, {
          initialFiles: {},
          args: {
            path,
            file_path: path,
            content: toBytes("BYTES"),
            bytes: toBytes("BYTES"),
          },
        });
        expect(getTextFromVfs(vfs2, path)).toBe("BYTES");
      });

      it("rejects nullish vfs / empty path inputs (error handling, boundary values)", async () => {
        await expectThrowOrReject(() => exported(null, "/x", "y"));
        await expectThrowOrReject(() => exported({}, "", "y"));
        await expectThrowOrReject(() => exported({}, "   ", "y"));
      });

      it("accepts large numeric metadata inputs without crashing (MAX_SAFE_INTEGER)", async () => {
        const path = "/meta.txt";
        const { vfs } = await findWorkingPattern(exported, {
          initialFiles: {},
          args: { path, content: "x", size: Number.MAX_SAFE_INTEGER, mtime: Number.MAX_SAFE_INTEGER },
        });
        expect(getTextFromVfs(vfs, path)).toBe("x");
      });

      return;
    }

    if (seemsLikeReadOp) {
      it("reads existing file content (including large files)", async () => {
        const path = "/read.txt";
        const large = "x".repeat(1024 * 128);

        const { result } = await findWorkingPattern(exported, {
          initialFiles: seedFilesForPath(path, `A\n${large}\nB`),
          args: { path, file_path: path },
        });

        const text = extractText(result);
        expect(typeof text).toBe("string");
        expect(text).toContain("A");
        expect(text).toContain("B");
      });

      it("handles path type boundary by string coercion (number as path)", async () => {
        const path = "/123";
        const { result } = await findWorkingPattern(exported, {
          initialFiles: seedFilesForPath(path, "ok"),
          args: { path: 123, file_path: 123 },
        });

        const text = extractText(result);
        expect(typeof text).toBe("string");
        expect(text).toContain("ok");
      });

      return;
    }

    if (seemsLikeDeleteOp) {
      it("removes an existing file (normal path)", async () => {
        const path = "/rm.txt";

        const { vfs } = await findWorkingPattern(exported, {
          initialFiles: seedFilesForPath(path, "bye"),
          args: { path, file_path: path },
        });

        expect(getTextFromVfs(vfs, path)).toBeNull();
      });

      it("rejects invalid vfs inputs (null/undefined) (error handling)", async () => {
        await expectThrowOrReject(() => exported(null, "/x"));
        await expectThrowOrReject(() => exported(undefined, "/x"));
      });

      return;
    }

    it("has a stable arity and name (API surface)", () => {
      expect(Number.isInteger(exported.length)).toBe(true);
      expect(exported.length).toBeGreaterThanOrEqual(0);
      expect(typeof exported.name).toBe("string");
    });
  });
}
