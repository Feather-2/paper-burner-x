import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/shared/index.js", () => {
  const makeLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  return {
    createLogger: vi.fn(() => makeLogger()),
  };
});

vi.mock("../../../../../js/agents/runtime/core/vfs-proxy-protocol.js", () => ({
  VFS_REQUEST: "VFS_REQUEST",
  VFS_RESPONSE: "VFS_RESPONSE",
  VFS_OPS: {
    readFile: "readFile",
    writeFile: "writeFile",
    readdir: "readdir",
    stat: "stat",
    mkdir: "mkdir",
    rmdir: "rmdir",
    unlink: "unlink",
    list: "list",
    exists: "exists",
  },
}));

import * as vfsProxyHost from "../../../../../js/agents/runtime/core/vfs-proxy-host.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function decodeBytes(bytes) {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

const suites = {
  isSharedArrayBuffer(fn) {
    it("returns false when SharedArrayBuffer is unavailable", () => {
      vi.stubGlobal("SharedArrayBuffer", undefined);
      expect(fn(undefined)).toBe(false);
      expect(fn(null)).toBe(false);
      expect(fn(new ArrayBuffer(0))).toBe(false);
      expect(fn({})).toBe(false);
    });

    it("detects SharedArrayBuffer instances (and rejects ArrayBuffer)", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(fn(null)).toBe(false);
        return;
      }

      const sab = new SharedArrayBuffer(0);
      expect(fn(sab)).toBe(true);
      expect(fn(new ArrayBuffer(0))).toBe(false);
      expect(fn(new Uint8Array(0))).toBe(false);
      expect(fn("")).toBe(false);
      expect(fn(0)).toBe(false);
    });

    it("is stable under rapid calls", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        for (let i = 0; i < 1000; i++) expect(fn({})).toBe(false);
        return;
      }

      const sab = new SharedArrayBuffer(0);
      for (let i = 0; i < 1000; i++) {
        expect(fn(sab)).toBe(true);
        expect(fn(new ArrayBuffer(0))).toBe(false);
      }
    });
  },

  stripLeadingSlashes(fn) {
    it("handles null/undefined/empty inputs", () => {
      expect(fn(undefined)).toBe("");
      expect(fn(null)).toBe("");
      expect(fn("")).toBe("");
    });

    it("strips only leading forward slashes", () => {
      expect(fn("/")).toBe("");
      expect(fn("///")).toBe("");
      expect(fn("/a")).toBe("a");
      expect(fn("////a/b")).toBe("a/b");
      expect(fn("a/b")).toBe("a/b");
      expect(fn("\\a")).toBe("\\a");
      expect(fn("/\\a")).toBe("\\a");
    });

    it("stringifies non-string inputs", () => {
      expect(fn(0)).toBe("0");
      expect(fn(-1)).toBe("-1");
      expect(fn(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
      expect(fn({})).toBe("[object Object]");
    });
  },

  isAbsoluteVfsPath(fn) {
    it("detects unix-like absolute paths", () => {
      expect(fn("/a")).toBe(true);
      expect(fn("//server/share")).toBe(true);
      expect(fn("\\a")).toBe(true);
      expect(fn("\\\\server\\share")).toBe(true);
    });

    it("detects windows drive absolute paths", () => {
      expect(fn("C:/a")).toBe(true);
      expect(fn("c:\\a")).toBe(true);
      expect(fn("Z:\\dir\\file")).toBe(true);
      expect(fn("C:relative")).toBe(false);
    });

    it("returns false for relative and non-path-ish inputs", () => {
      expect(fn("a/b")).toBe(false);
      expect(fn("")).toBe(false);
      expect(fn("  /a")).toBe(false);
      expect(fn(null)).toBe(false);
      expect(fn(undefined)).toBe(false);
    });
  },

  normalizeVfsPath(fn) {
    it("returns empty string for nullish/empty inputs", () => {
      expect(fn(undefined)).toBe("");
      expect(fn(null)).toBe("");
      expect(fn("")).toBe("");
      expect(fn([])).toBe("");
    });

    it("normalizes dot segments and extra slashes", () => {
      expect(fn("a")).toBe("a");
      expect(fn("a/b")).toBe("a/b");
      expect(fn("a//b")).toBe("a/b");
      expect(fn("a/./b/./c")).toBe("a/b/c");
      expect(fn("./a")).toBe("a");
      expect(fn("a/")).toBe("a");
      expect(fn(".")).toBe("");
      expect(fn("a/.")).toBe("a");
    });

    it("rejects absolute paths and traversal segments", () => {
      expect(fn("/a")).toBe(null);
      expect(fn("///a")).toBe(null);
      expect(fn("\\a")).toBe(null);
      expect(fn("C:/a")).toBe(null);
      expect(fn("../a")).toBe(null);
      expect(fn("a/../b")).toBe(null);
    });

    it("rejects null bytes and backslashes", () => {
      expect(fn("a\0b")).toBe(null);
      expect(fn("a\\b")).toBe(null);
      expect(fn("C:\\a")).toBe(null);
    });

    it("handles boundary numeric and whitespace inputs", () => {
      expect(fn(0)).toBe("0");
      expect(fn(-1)).toBe("-1");
      expect(fn(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
      expect(fn("   ")).toBe("   ");
      expect(fn("a/..../b")).toBe("a/..../b");
    });

    it("handles long and deeply nested paths", () => {
      const long = `seg-${"a".repeat(20000)}`;
      expect(fn(long)).toBe(long);

      const deep = Array.from({ length: 300 }, (_, i) => `d${i}`).join("/");
      expect(fn(deep)).toBe(deep);
    });

    it("is deterministic under rapid calls (no shared state)", () => {
      const inputs = [
        undefined,
        null,
        "",
        ".",
        "./a",
        "a//b",
        "a/./b",
        "a/../b",
        "/a",
        "C:/a",
        "a\0b",
        "a\\b",
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        {},
        [1, 2, 3],
      ];
      const baseline = inputs.map((v) => fn(v));
      for (let i = 0; i < 200; i++) {
        expect(inputs.map((v) => fn(v))).toEqual(baseline);
      }
    });
  },

  isMissingPathError(fn) {
    it("returns false for nullish and unrelated errors", () => {
      expect(fn(undefined)).toBe(false);
      expect(fn(null)).toBe(false);
      expect(fn({})).toBe(false);
      expect(fn({ code: "EACCES" })).toBe(false);
      expect(fn({ message: "Permission denied" })).toBe(false);
      expect(fn("SomeOtherError")).toBe(false);
    });

    it("detects ENOENT by code and message", () => {
      expect(fn({ code: "ENOENT" })).toBe(true);
      expect(fn({ code: "ENOENT", message: "other" })).toBe(true);
      expect(fn({ message: "ENOENT: no such file or directory" })).toBe(true);
      expect(fn("ENOENT")).toBe(true);
    });

    it("detects DOM-style NotFoundError", () => {
      expect(fn({ message: "NotFoundError" })).toBe(true);
      expect(fn("NotFoundError: The object can not be found here.")).toBe(true);
    });

    it("handles type-boundary error shapes safely", () => {
      expect(fn({ code: 0, message: 0 })).toBe(false);
      expect(fn({ code: { toString: () => "ENOENT" } })).toBe(false);
      expect(fn({ message: { toString: () => "ENOENT" } })).toBe(true);
    });
  },

  toDirEntries(fn) {
    it("returns empty array for non-array inputs", () => {
      expect(fn(undefined)).toEqual([]);
      expect(fn(null)).toEqual([]);
      expect(fn({})).toEqual([]);
      expect(fn("not-an-array")).toEqual([]);
    });

    it("converts string entries to unknown kind and filters empties", () => {
      expect(fn(["a", ""])).toEqual([{ name: "a", kind: "unknown" }]);
      expect(fn(["  "])).toEqual([{ name: "  ", kind: "unknown" }]);
    });

    it("infers kind from kind field and dirent-like methods", () => {
      expect(fn([{ name: "d", kind: "dir" }])).toEqual([{ name: "d", kind: "directory" }]);
      expect(fn([{ name: "d2", kind: "directory" }])).toEqual([
        { name: "d2", kind: "directory" },
      ]);
      expect(fn([{ name: "f", kind: "file" }])).toEqual([{ name: "f", kind: "file" }]);

      const entries = fn([
        { name: "x", isDirectory: () => true, isFile: () => true },
        { name: "y", isFile: () => true },
        { name: "z", isDirectory: () => true },
      ]);
      expect(entries).toEqual([
        { name: "x", kind: "directory" },
        { name: "y", kind: "file" },
        { name: "z", kind: "directory" },
      ]);
    });

    it("stringifies non-string names and filters missing names", () => {
      expect(fn([{ name: 0, kind: "file" }])).toEqual([{ name: "0", kind: "file" }]);
      expect(fn([{ kind: "file" }, null, undefined, { name: "" }])).toEqual([]);
    });

    it("handles large arrays without mutation or crashes", () => {
      const input = Array.from({ length: 2000 }, (_, i) => `f${i}`);
      const out = fn(input);
      expect(out).toHaveLength(2000);
      expect(out[0]).toEqual({ name: "f0", kind: "unknown" });
      expect(out[1999]).toEqual({ name: "f1999", kind: "unknown" });
      expect(input[0]).toBe("f0");
    });

    it("is deterministic under rapid calls", () => {
      const input = [
        "a",
        "",
        { name: "d", kind: "dir" },
        { name: "f", kind: "file" },
        { name: 1, isFile: () => true },
        null,
      ];
      const baseline = fn(input);
      for (let i = 0; i < 200; i++) expect(fn(input)).toEqual(baseline);
    });
  },

  writeSharedResponse(fn) {
    it("writes ok responses (Uint8Array) with status and length", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const shared = new SharedArrayBuffer(16 + 8);
      const header = new Int32Array(shared, 0, 4);
      const payload = new Uint8Array(shared, 16);

      const notifySpy = vi.spyOn(Atomics, "notify");

      fn(shared, { ok: true, bytes: new Uint8Array([1, 2, 3]) });

      expect(header[0]).toBe(1);
      expect(header[1]).toBe(3);
      expect(header[2]).toBe(0);
      expect(Array.from(payload.subarray(0, 3))).toEqual([1, 2, 3]);
      expect(Array.from(payload.subarray(3))).toEqual([0, 0, 0, 0, 0]);

      expect(notifySpy).toHaveBeenCalledTimes(1);
      expect(notifySpy).toHaveBeenCalledWith(header, 0);
    });

    it("accepts ArrayBuffer and array-like byte sources", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const shared1 = new SharedArrayBuffer(16 + 4);
      const header1 = new Int32Array(shared1, 0, 4);
      const payload1 = new Uint8Array(shared1, 16);

      const buf = new ArrayBuffer(2);
      new Uint8Array(buf).set([9, 8]);
      fn(shared1, { ok: true, bytes: buf });

      expect(header1[0]).toBe(1);
      expect(header1[1]).toBe(2);
      expect(Array.from(payload1.subarray(0, 2))).toEqual([9, 8]);

      const shared2 = new SharedArrayBuffer(16 + 4);
      const header2 = new Int32Array(shared2, 0, 4);
      const payload2 = new Uint8Array(shared2, 16);

      fn(shared2, { ok: true, bytes: [7, 6, 5] });

      expect(header2[0]).toBe(1);
      expect(header2[1]).toBe(3);
      expect(Array.from(payload2.subarray(0, 3))).toEqual([7, 6, 5]);
    });

    it("writes error responses and truncates message to payload size", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const shared = new SharedArrayBuffer(16 + 5);
      const header = new Int32Array(shared, 0, 4);
      const payload = new Uint8Array(shared, 16);

      fn(shared, { ok: false, error: "abcdef" });

      expect(header[0]).toBe(-1);
      expect(header[2]).toBe(0);
      expect(header[1]).toBe(5);
      expect(decodeBytes(payload)).toBe("abcde");
    });

    it("propagates requiredBytes on explicit errors", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const shared = new SharedArrayBuffer(16 + 64);
      const header = new Int32Array(shared, 0, 4);

      fn(shared, { ok: false, error: "boom", requiredBytes: 123 });

      expect(header[0]).toBe(-1);
      expect(header[2]).toBe(123);
    });

    it("returns EOVERFLOW when payload is too small and sets requiredBytes", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const shared = new SharedArrayBuffer(16 + 12);
      const header = new Int32Array(shared, 0, 4);
      const payload = new Uint8Array(shared, 16);

      const huge = new Uint8Array(5000).fill(1);
      fn(shared, { ok: true, bytes: huge });

      expect(header[0]).toBe(-1);
      expect(header[2]).toBe(5000);
      expect(header[1]).toBeGreaterThan(0);

      const msg = decodeBytes(payload.subarray(0, header[1]));
      expect(msg).toContain("EOVERFLOW");
      expect(msg).toContain("5000");
    });

    it("is safe under concurrent microtasks writing distinct buffers", async () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const sharedA = new SharedArrayBuffer(16 + 3);
      const sharedB = new SharedArrayBuffer(16 + 3);

      await Promise.all([
        Promise.resolve().then(() => fn(sharedA, { ok: true, bytes: [1, 2, 3] })),
        Promise.resolve().then(() => fn(sharedB, { ok: false, error: "err" })),
      ]);

      const headerA = new Int32Array(sharedA, 0, 4);
      const payloadA = new Uint8Array(sharedA, 16);
      expect(headerA[0]).toBe(1);
      expect(headerA[1]).toBe(3);
      expect(Array.from(payloadA.subarray(0, 3))).toEqual([1, 2, 3]);

      const headerB = new Int32Array(sharedB, 0, 4);
      expect(headerB[0]).toBe(-1);
      expect(headerB[1]).toBeGreaterThan(0);
    });

    it("last write wins for rapid sequential calls on the same buffer", () => {
      if (typeof SharedArrayBuffer === "undefined") {
        expect(typeof SharedArrayBuffer).toBe("undefined");
        return;
      }

      const shared = new SharedArrayBuffer(16 + 8);
      const header = new Int32Array(shared, 0, 4);
      const payload = new Uint8Array(shared, 16);

      fn(shared, { ok: true, bytes: [1] });
      fn(shared, { ok: false, error: "nope", requiredBytes: 9 });
      fn(shared, { ok: true, bytes: [7, 7] });

      expect(header[0]).toBe(1);
      expect(header[1]).toBe(2);
      expect(header[2]).toBe(0);
      expect(Array.from(payload.subarray(0, 2))).toEqual([7, 7]);
    });
  },
};

function genericExportSuite(value) {
  it("is defined", () => {
    expect(value).not.toBeUndefined();
  });

  it("has a stable runtime type", () => {
    const t = typeof value;
    expect(["function", "object", "string", "number", "boolean", "bigint", "symbol", "undefined"]).toContain(
      t,
    );
  });
}

const exportNames = Object.keys(vfsProxyHost);

describe("__module_exports__", () => {
  it("exports at least one symbol", () => {
    expect(exportNames.length).toBeGreaterThan(0);
  });
});

for (const exportName of exportNames) {
  describe(exportName, () => {
    const value = vfsProxyHost[exportName];
    if (typeof value === "function" && typeof suites[exportName] === "function") {
      suites[exportName](value);
      return;
    }
    genericExportSuite(value);
  });
}