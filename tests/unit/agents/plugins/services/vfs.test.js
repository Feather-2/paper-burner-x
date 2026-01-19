import { describe, it, expect, vi } from "vitest";

import {
  basenameVfsPath,
  dirnameVfsPath,
  joinVfsPath,
  normalizeVfsPath,
} from '../../../../../js/agents/vfs/path.js';
import MemoryVfs from '../../../../../js/agents/vfs/vfs.memory.js';

function makeNonNodeProcessProxy(originalProcess) {
  const base = originalProcess && typeof originalProcess === "object" ? originalProcess : {};
  const versions = base.versions && typeof base.versions === "object" ? base.versions : {};
  const versionsProxy = new Proxy(versions, {
    get(target, prop) {
      if (prop === "node") return undefined;
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      if (prop === "node") return false;
      return Reflect.has(target, prop);
    },
  });

  return new Proxy(base, {
    get(target, prop) {
      if (prop === "versions") return versionsProxy;
      return Reflect.get(target, prop);
    },
  });
}

describe("vfs/path", () => {
  it("normalizes to relative POSIX paths", () => {
    expect(normalizeVfsPath("")).toBe("");
    expect(normalizeVfsPath(".")).toBe("");
    expect(normalizeVfsPath("./")).toBe("");
    expect(normalizeVfsPath(" ././a/b/ ")).toBe("a/b");
    expect(normalizeVfsPath("/a/b/")).toBe("a/b");
    expect(normalizeVfsPath("\\a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(normalizeVfsPath("a//b/./c")).toBe("a/b/c");
    expect(normalizeVfsPath(123)).toBe("123");
  });

  it("rejects traversal / invalid segments / Windows absolute injection", () => {
    expect(() => normalizeVfsPath("../x")).toThrow(/traversal/i);
    expect(() => normalizeVfsPath("a/../b")).toThrow(/traversal/i);
    expect(() => normalizeVfsPath("C:/Windows/System32")).toThrow(/absolute path/i);
    expect(() => normalizeVfsPath("d:folder/file.txt")).toThrow(/absolute path/i);
    expect(() => normalizeVfsPath("CON")).toThrow(/reserved name/i);
    expect(() => normalizeVfsPath("con.txt")).toThrow(/reserved name/i);
    expect(() => normalizeVfsPath("a/<b>")).toThrow(/segment/i);
    expect(() => normalizeVfsPath("a/*")).toThrow(/segment/i);
  });

  it("provides dirname/basename/join helpers", () => {
    expect(dirnameVfsPath("a/b/c.txt")).toBe("a/b");
    expect(dirnameVfsPath("a")).toBe("");
    expect(dirnameVfsPath("/")).toBe("");

    expect(basenameVfsPath("a/b/c.txt")).toBe("c.txt");
    expect(basenameVfsPath("a")).toBe("a");
    expect(basenameVfsPath("/")).toBe("");

    expect(joinVfsPath("", "a")).toBe("a");
    expect(joinVfsPath("a", "")).toBe("a");
    expect(joinVfsPath("a", "/b/c.txt")).toBe("a/b/c.txt");
    expect(() => joinVfsPath("a", "../b")).toThrow(/traversal/i);
  });
});

describe("vfs/memory", () => {
  it("supports CRUD, stats and directory listing", async () => {
    const vfs = new MemoryVfs();

    await expect(vfs.readFile("/")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.readText("missing.txt")).rejects.toThrow(/ENOENT/i);

    await vfs.writeText("/a/b.txt", "hello");
    await vfs.writeFile("a/raw.bin", new Uint8Array([1, 2, 3]));
    await vfs.writeFile("a/obj.json", { ok: true, n: 1 });

    expect(await vfs.readText("a/b.txt")).toBe("hello");
    expect(await vfs.readFile("a/raw.bin")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await vfs.readText("a/obj.json")).toBe(JSON.stringify({ ok: true, n: 1 }));

    const rootStat = await vfs.stat("");
    expect(rootStat.isDirectory()).toBe(true);
    expect(rootStat.isFile()).toBe(false);

    const fileStat = await vfs.stat("a/b.txt");
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.isDirectory()).toBe(false);
    expect(fileStat.size).toBeGreaterThan(0);

    const names = await vfs.readdir("a");
    expect(names).toEqual(["b.txt", "obj.json", "raw.bin"]);

    const dirents = await vfs.readdir("a", { withFileTypes: true });
    expect(dirents.map((d) => `${d.name}:${d.isFile() ? "f" : "d"}`)).toEqual(["b.txt:f", "obj.json:f", "raw.bin:f"]);
  });

  it("handles mkdir/rmdir/unlink errors and recursive behavior", async () => {
    const vfs = new MemoryVfs();

    await vfs.mkdir("dir/sub", { recursive: true });
    await vfs.writeText("dir/sub/file.txt", "x");

    await expect(vfs.mkdir("dir/sub/file.txt", { recursive: true })).rejects.toThrow(/EEXIST/i);
    await expect(vfs.mkdir("dir/another/sub", { recursive: false })).rejects.toThrow(/ENOENT/i);

    await expect(vfs.rmdir("dir/sub", { recursive: false })).rejects.toThrow(/ENOTEMPTY/i);
    await expect(vfs.rmdir("/", { recursive: true })).rejects.toThrow(/EPERM/i);
    await expect(vfs.rmdir("dir/sub/file.txt", { recursive: true })).rejects.toThrow(/ENOTDIR/i);

    await expect(vfs.unlink("/")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.unlink("dir/sub")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.unlink("missing.txt")).rejects.toThrow(/ENOENT/i);

    await vfs.unlink("dir/sub/file.txt");
    await vfs.rmdir("dir/sub", { recursive: false });
    expect(await vfs.exists("dir/sub")).toBe(false);
  });

  it("lists and walks files with prefixes and recursion flags", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("a/1.txt", "1");
    await vfs.writeText("a/b/2.txt", "2");
    await vfs.writeText("a/b/c/3.txt", "3");

    expect(await vfs.listFiles({ prefix: "missing" })).toEqual([]);
    expect(await vfs.listFiles({ prefix: "a/1.txt" })).toEqual(["a/1.txt"]);
    expect(await vfs.listFiles({ prefix: "a", recursive: false })).toEqual(["a/1.txt"]);
    expect(await vfs.listFiles({ prefix: "a", recursive: true })).toEqual(["a/1.txt", "a/b/2.txt", "a/b/c/3.txt"]);

    const walked = [];
    for await (const p of vfs.walkFiles({ prefix: "a", recursive: true })) walked.push(p);
    expect(walked).toEqual(["a/1.txt", "a/b/2.txt", "a/b/c/3.txt"]);

    const walkedNonRec = [];
    for await (const p of vfs.walkFiles({ prefix: "a", recursive: false })) walkedNonRec.push(p);
    expect(walkedNonRec).toEqual(["a/1.txt"]);
  });

  it("supports copy/move/appendText and common error cases", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("dir/a.txt", "a");
    await vfs.mkdir("dir/existing-dir");

    await expect(vfs.copy("/", "x")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.copy("dir/missing.txt", "x")).rejects.toThrow(/ENOENT/i);

    await vfs.copy("dir/a.txt", "dir/a.copy.txt");
    expect(await vfs.readText("dir/a.copy.txt")).toBe("a");

    await expect(vfs.move("dir/missing.txt", "dir/x")).rejects.toThrow(/ENOENT/i);
    await expect(vfs.move("dir/a.txt", "dir/existing-dir")).rejects.toThrow(/EISDIR/i);

    await vfs.move("dir/a.txt", "dir/moved.txt");
    expect(await vfs.exists("dir/a.txt")).toBe(false);
    expect(await vfs.readText("dir/moved.txt")).toBe("a");

    await vfs.appendText("dir/moved.txt", "!");
    expect(await vfs.readText("dir/moved.txt")).toBe("a!");

    await vfs.appendText("dir/new.txt", 123);
    expect(await vfs.readText("dir/new.txt")).toBe("123");

    await expect(vfs.appendText("dir/existing-dir", "x")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.writeText("/", "x")).rejects.toThrow(/EISDIR/i);

    // Exists returns false for non-directory traversal inside the tree...
    await vfs.writeText("a", "file");
    expect(await vfs.exists("a/b")).toBe(false);
    // ...but path traversal is rejected at normalization time
    await expect(vfs.exists("a/../b")).rejects.toThrow(/traversal/i);
  });
});

describe("vfs/glob", () => {
  it("expands braces and compiles glob RegExp", async () => {
    const { expandBraces, globToRegExp, matchGlob } = await import("../../../js/agents/vfs/glob.js");

    expect(expandBraces("*.{md,txt}").sort()).toEqual(["*.md", "*.txt"]);
    expect(expandBraces("{a,b}.{c,d}").sort()).toEqual(["a.c", "a.d", "b.c", "b.d"]);
    expect(expandBraces("a.{,}")).toEqual(["a.{,}"]);
    expect(expandBraces("a.{x,y").sort()).toEqual(["a.{x,y"]);

    expect(matchGlob("*.md", "a.md")).toBe(true);
    expect(matchGlob("*.md", "a.txt")).toBe(false);
    expect(matchGlob("**/*.md", "\\dir\\a.md")).toBe(true);
    expect(matchGlob("**/*.md", "dir/a.txt")).toBe(false);

    const re = globToRegExp("a/**/b?.txt");
    expect(re.test("a/b1.txt")).toBe(true);
    expect(re.test("a/x/y/b2.txt")).toBe(true);
    expect(re.test("a/x/y/b.txt")).toBe(false);

    const literal = globToRegExp("a+b(c).txt");
    expect(literal.test("a+b(c).txt")).toBe(true);
    expect(literal.test("ab(c).txt")).toBe(false);
  });

  it("scans over a VFS and respects base/path, maxScanFiles and yieldEvery", async () => {
    const { createVfsGlobFn } = await import("../../../js/agents/vfs/glob.js");

    const vfs = new MemoryVfs();
    await vfs.writeText("base/a.md", "a");
    await vfs.writeText("base/b.txt", "b");
    await vfs.writeText("base/dir/c.md", "c");
    await vfs.writeText("base/dir/d.js", "d");

    const globFn = createVfsGlobFn(vfs, { maxScanFiles: 3, yieldEvery: 1 });
    expect(typeof globFn).toBe("function");

    const out = await globFn({ pattern: "**/*.md", path: "base" });
    expect(out).toEqual(["base/a.md", "base/dir/c.md"]);

    const limited = await globFn({ pattern: "**/*", path: "base", yieldEvery: 1 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it("returns null when VFS lacks listFiles/walkFiles; normalizes abort errors", async () => {
    const { createVfsGlobFn } = await import("../../../js/agents/vfs/glob.js");

    expect(createVfsGlobFn(null)).toBeNull();
    expect(createVfsGlobFn({})).toBeNull();

    const abortingVfs = {
      listFiles: async () => {
        throw new Error("aborted");
      },
    };
    const globFn = createVfsGlobFn(abortingVfs, { useWorker: false });
    await expect(globFn({ pattern: "**/*" })).rejects.toThrow("glob: aborted");

    const failingVfs = {
      listFiles: async () => {
        throw new Error("boom");
      },
    };
    const globFn2 = createVfsGlobFn(failingVfs, { useWorker: false });
    await expect(globFn2({ pattern: "**/*" })).rejects.toThrow(/boom/);
  });

  it("can offload filtering to a Worker in browser-like environments", async () => {
    const originalProcess = globalThis.process;
    let workerDelayMs = 0;
    /** @type {AbortController | null} */
    let abortControllerOnNextPostMessage = null;

    class MockWorker {
      /** @type {MockWorker | null} */
      static last = null;

      constructor(url, options) {
        void url;
        void options;
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
        MockWorker.last = this;
      }

      terminate() {
        this.terminated = true;
      }

      postMessage(msg) {
        const { id, pattern, base, files } = msg || {};

        if (abortControllerOnNextPostMessage) {
          try {
            abortControllerOnNextPostMessage.abort();
          } finally {
            abortControllerOnNextPostMessage = null;
          }
        }

        if (pattern === "__trigger_onerror__") {
          queueMicrotask(() => this.onerror?.(new Error("boom")));
          return;
        }

        const respond = () => {
          if (!this.onmessage) return;
          if (pattern === "__worker_error__") {
            this.onmessage({ data: { id, ok: false, error: "worker says no" } });
            return;
          }

          const normalizePattern = (p) => String(p ?? "").replaceAll("\\", "/").trim();
          const escapeRegExp = (s) => String(s ?? "").replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
          const expandOneBrace = (p) => {
            const start = p.indexOf("{");
            if (start < 0) return [p];
            const end = p.indexOf("}", start + 1);
            if (end < 0) return [p];
            const inner = p.slice(start + 1, end);
            const parts = inner.split(",").map((s) => s.trim()).filter(Boolean);
            if (!parts.length) return [p];
            const head = p.slice(0, start);
            const tail = p.slice(end + 1);
            return parts.map((part) => `${head}${part}${tail}`);
          };
          const expandBraces = (p) => {
            let acc = [normalizePattern(p)];
            for (let i = 0; i < 8; i++) {
              let changed = false;
              const next = [];
              for (const item of acc) {
                const expanded = expandOneBrace(item);
                if (expanded.length !== 1 || expanded[0] !== item) changed = true;
                next.push(...expanded);
              }
              acc = next;
              if (!changed) break;
            }
            return Array.from(new Set(acc));
          };
          const globToRegExp = (p) => {
            const patternStr = normalizePattern(p);
            let re = "";
            for (let i = 0; i < patternStr.length; i++) {
              const ch = patternStr[i];
              const next = patternStr[i + 1];
              if (ch === "*" && next === "*") {
                const after = patternStr[i + 2];
                if (after === "/") {
                  re += "(?:.*\\/)?";
                  i += 2;
                } else {
                  re += ".*";
                  i++;
                }
                continue;
              }
              if (ch === "*") {
                re += "[^/]*";
                continue;
              }
              if (ch === "?") {
                re += "[^/]";
                continue;
              }
              re += escapeRegExp(ch);
            }
            return new RegExp(`^${re}$`);
          };
          const compileGlobRegexes = (p) => expandBraces(p).map(globToRegExp);
          const normalizeBasePath = (value) => {
            const s = String(value ?? "").replaceAll("\\", "/").trim();
            if (!s) return "";
            return s.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
          };

          const regexes = compileGlobRegexes(pattern);
          const basePath = normalizeBasePath(base);
          const out = [];
          for (const file of Array.isArray(files) ? files : []) {
            if (typeof file !== "string") continue;
            const rel = basePath ? (file.startsWith(`${basePath}/`) ? file.slice(basePath.length + 1) : file) : file;
            if (!rel) continue;
            if (regexes.some((re) => re.test(rel))) out.push(file);
          }
          this.onmessage({ data: { id, ok: true, matches: out } });
        };

        if (workerDelayMs > 0) setTimeout(respond, workerDelayMs);
        else queueMicrotask(respond);
      }
    }

    try {
      vi.stubGlobal("process", makeNonNodeProcessProxy(originalProcess));
      vi.stubGlobal("Worker", MockWorker);

      vi.resetModules();
      const { createVfsGlobFn } = await import("../../../js/agents/vfs/glob.js");

      const vfs = new MemoryVfs();
      await vfs.writeText("a.md", "a");
      await vfs.writeText("b.txt", "b");

      const globFn = createVfsGlobFn(
        {
          // Force listFiles branch (no walkFiles) to keep the candidate list deterministic.
          listFiles: (opts) => vfs.listFiles(opts),
        },
        { workerThresholdFiles: 1 }
      );

      const out = await globFn({ pattern: "**/*.md", path: "" });
      expect(out).toEqual(["a.md"]);

      // Abort should reject pending worker requests
      workerDelayMs = 50;
      vi.useFakeTimers();
      const ac = new AbortController();
      abortControllerOnNextPostMessage = ac;
      const pending = globFn({ pattern: "**/*", path: "", signal: ac.signal });
      await expect(pending).rejects.toThrow("glob: aborted");
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      // Worker error response should be surfaced
      workerDelayMs = 0;
      await expect(globFn({ pattern: "__worker_error__", path: "" })).rejects.toThrow(/worker says no/i);

      // Worker onerror should reject all pending
      await expect(globFn({ pattern: "__trigger_onerror__", path: "" })).rejects.toThrow(/boom/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("vfs/index", () => {
  it("creates MemoryVfs by default and supports kind aliases in Node", async () => {
    vi.resetModules();

    // Avoid touching real adapters / OPFS / NodeFS implementation details.
    vi.doMock("../../../js/agents/vfs/storage-adapter.js", () => ({
      createStorageAdapter: vi.fn(async () => ({ get: vi.fn() })),
    }));
    vi.doMock("../../../js/agents/vfs/vfs.opfs.js", () => ({
      supportsOpfs: vi.fn(() => false),
      OpfsVfs: { create: vi.fn(async () => ({ kind: "opfs" })) },
    }));
    vi.doMock("../../../js/agents/vfs/vfs.storage.js", () => ({
      StorageVfs: class StorageVfsMock {
        constructor(adapter, opts) {
          this.adapter = adapter;
          this.opts = opts;
        }
      },
    }));
    vi.doMock("../../../js/agents/vfs/vfs.node.js", () => ({
      NodeFsVfs: class NodeFsVfsMock {
        constructor(opts) {
          this.opts = opts;
        }
      },
    }));

    const mod = await import("../../../js/agents/vfs/index.js");
    const v1 = await mod.createVfs();
    expect(v1).toBeInstanceOf(mod.MemoryVfs);

    const v2 = await mod.createVfs({ kind: "mem" });
    expect(v2).toBeInstanceOf(mod.MemoryVfs);

    const v3 = await mod.createVfs({ kind: "memory" });
    expect(v3).toBeInstanceOf(mod.MemoryVfs);
  });

  it("can select NodeFS in Node without hitting the real filesystem", async () => {
    vi.resetModules();

    class NodeFsVfsMock {
      constructor(opts) {
        this.opts = opts;
      }
    }

    vi.doMock("../../../js/agents/vfs/vfs.node.js", () => ({ NodeFsVfs: NodeFsVfsMock }));
    vi.doMock("../../../js/agents/vfs/vfs.opfs.js", () => ({
      supportsOpfs: vi.fn(() => false),
      OpfsVfs: { create: vi.fn(async () => ({ kind: "opfs" })) },
    }));
    vi.doMock("../../../js/agents/vfs/storage-adapter.js", () => ({
      createStorageAdapter: vi.fn(async () => ({ get: vi.fn() })),
    }));
    vi.doMock("../../../js/agents/vfs/vfs.storage.js", () => ({
      StorageVfs: class StorageVfsMock {},
    }));

    const mod = await import("../../../js/agents/vfs/index.js");
    const v = await mod.createVfs({ kind: "nodefs", rootPath: "/tmp/test-root" });
    expect(v).toBeInstanceOf(NodeFsVfsMock);
    expect(v.opts.rootPath).toBe("/tmp/test-root");
  });

  it("runs browser OPFS preference flow without touching OPFS/storage-adapter implementations", async () => {
    const originalProcess = globalThis.process;

    const supportsOpfsMock = vi.fn(() => true);
    const opfsCreateMock = vi.fn(async () => ({ kind: "opfs-vfs" }));
    const createStorageAdapterMock = vi.fn(async () => ({ get: vi.fn() }));

    class StorageVfsMock {
      constructor(adapter, opts) {
        this.adapter = adapter;
        this.opts = opts;
      }
    }

    try {
      vi.stubGlobal("process", makeNonNodeProcessProxy(originalProcess));

      vi.resetModules();
      vi.doMock("../../../js/agents/vfs/vfs.opfs.js", () => ({
        supportsOpfs: supportsOpfsMock,
        OpfsVfs: { create: opfsCreateMock },
      }));
      vi.doMock("../../../js/agents/vfs/storage-adapter.js", () => ({
        createStorageAdapter: createStorageAdapterMock,
      }));
      vi.doMock("../../../js/agents/vfs/vfs.storage.js", () => ({ StorageVfs: StorageVfsMock }));
      vi.doMock("../../../js/agents/vfs/vfs.node.js", () => ({
        NodeFsVfs: class NodeFsVfsMock {},
      }));

      const mod = await import("../../../js/agents/vfs/index.js");

      const providedAdapter = { get: vi.fn() };
      const vfs = await mod.createVfs({ kind: "opfs", rootDirName: "r", storageAdapter: providedAdapter });
      expect(vfs).toEqual({ kind: "opfs-vfs", storageAdapter: providedAdapter });
      expect(opfsCreateMock).toHaveBeenCalledWith({ rootDirName: "r" });

      // OPFS creation failure falls back to StorageVfs(createStorageAdapter(...))
      opfsCreateMock.mockRejectedValueOnce(new Error("no opfs"));
      const vfs2 = await mod.createVfs({ kind: "opfs", preferOpfs: false, silent: true, keyPrefix: "k:" });
      expect(vfs2).toBeInstanceOf(StorageVfsMock);
      expect(createStorageAdapterMock).toHaveBeenCalledWith({ preferOpfs: false, silent: true });
      expect(vfs2.opts).toEqual({ keyPrefix: "k:" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
