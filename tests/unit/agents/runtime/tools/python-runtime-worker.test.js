import { describe, it, expect, vi, beforeEach } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const WORKER_MODULE_SPECIFIER =
  "../../../../../js/agents/runtime/tools/python-runtime-worker.js";
const WORKER_FILE_PATH = fileURLToPath(
  new URL(WORKER_MODULE_SPECIFIER, import.meta.url),
);

vi.mock("../../../../../js/agents/shared/index.js", () => {
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

vi.mock("../../../../../js/agents/runtime/core/vfs-proxy-client.js", () => {
  class VfsProxyClient {
    constructor(...args) {
      this.args = args;
    }
  }
  return { VfsProxyClient };
});

function parseExportedNamesFromSource(source) {
  const names = new Set();

  if (/^\s*export\s+default\b/m.test(source)) names.add("default");

  for (const match of source.matchAll(
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/gm,
  )) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(
    /^\s*export\s+class\s+([A-Za-z_$][\w$]*)\b/gm,
  )) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(
    /^\s*export\s+(?:const|let|var)\s+([^;]+);?/gm,
  )) {
    const decl = match[1] || "";
    for (const part of decl.split(",")) {
      const idMatch = part.trim().match(/^([A-Za-z_$][\w$]*)\b/);
      if (idMatch) names.add(idMatch[1]);
    }
  }

  for (const match of source.matchAll(
    /^\s*export\s*\{([^}]+)\}\s*(?:from\s*["'][^"']+["']\s*)?;?\s*$/gm,
  )) {
    const spec = match[1] || "";
    for (const part of spec.split(",")) {
      const p = part.trim();
      if (!p) continue;

      const asMatch = p.match(/\bas\s+([A-Za-z_$][\w$]*)\b/);
      if (asMatch) {
        names.add(asMatch[1]);
        continue;
      }

      const nameMatch = p.match(/^([A-Za-z_$][\w$]*)\b/);
      if (nameMatch) names.add(nameMatch[1]);
    }
  }

  return [...names].sort();
}

function transformWorkerSourceToScript(source) {
  let code = String(source);

  // Drop static imports.
  // Keep this line-based to avoid matching "import ..." that appears inside
  // template literals (e.g. embedded Python code) and accidentally deleting
  // large chunks of the source.
  code = code.replace(/^\s*import\s+[^\n]*;\s*$/gm, "");

  // Drop re-exports.
  code = code.replace(
    /^\s*export\s*\*\s*from\s*["'][^"']+["']\s*;?\s*$/gm,
    "",
  );

  // Strip `export` keyword on declarations.
  code = code.replace(
    /^\s*export\s+(?=(?:async\s+)?function|class|const|let|var)\s*/gm,
    "",
  );

  // Drop `export { ... }` lines.
  code = code.replace(
    /^\s*export\s*\{[^\n]*\}\s*(?:from\s*["'][^"']+["']\s*)?;?\s*$/gm,
    "",
  );

  // Best-effort handle `export default ...`
  code = code.replace(/^\s*export\s+default\s+/gm, "const __default__ = ");

  const shim = `
const { createLogger } = globalThis.__mocks ?? {};
const { VfsProxyClient } = globalThis.__mocks ?? {};
`;

  const internals = `
globalThis.__internals = {
  isSharedArrayBuffer: (typeof isSharedArrayBuffer !== "undefined") ? isSharedArrayBuffer : undefined,
  getWorkerOrigin: (typeof getWorkerOrigin !== "undefined") ? getWorkerOrigin : undefined,
  getWorkerBaseUrl: (typeof getWorkerBaseUrl !== "undefined") ? getWorkerBaseUrl : undefined,
  ensureTrailingSlashUrl: (typeof ensureTrailingSlashUrl !== "undefined") ? ensureTrailingSlashUrl : undefined,
  resolveAllowedPyodideUrl: (typeof resolveAllowedPyodideUrl !== "undefined") ? resolveAllowedPyodideUrl : undefined,
  resolveAllowedIndexUrl: (typeof resolveAllowedIndexUrl !== "undefined") ? resolveAllowedIndexUrl : undefined,
  resolveAllowedWheelUrl: (typeof resolveAllowedWheelUrl !== "undefined") ? resolveAllowedWheelUrl : undefined,
  ensureDir: (typeof ensureDir !== "undefined") ? ensureDir : undefined,
  ensureDirTree: (typeof ensureDirTree !== "undefined") ? ensureDirTree : undefined,
  ensureSymlink: (typeof ensureSymlink !== "undefined") ? ensureSymlink : undefined,
  decodeBase64ToBytes: (typeof decodeBase64ToBytes !== "undefined") ? decodeBase64ToBytes : undefined,
  verifySha256SRI: (typeof verifySha256SRI !== "undefined") ? verifySha256SRI : undefined,
  PYODIDE_CDN_BASE_URL: (typeof PYODIDE_CDN_BASE_URL !== "undefined") ? PYODIDE_CDN_BASE_URL : undefined,
  PYODIDE_CDN_ORIGIN: (typeof PYODIDE_CDN_ORIGIN !== "undefined") ? PYODIDE_CDN_ORIGIN : undefined,
};
`;

  return `${shim}\n${code}\n${internals}\n`;
}

const WORKER_SOURCE = readFileSync(WORKER_FILE_PATH, "utf8");
const WORKER_SCRIPT = transformWorkerSourceToScript(WORKER_SOURCE);
const EXPORTED_NAMES = parseExportedNamesFromSource(WORKER_SOURCE);
const CRYPTO = globalThis.crypto ?? webcrypto;

function evaluateWorkerInVm({
} = {}) {
  const options = arguments[0] ?? {};
  const has = (key) => Object.prototype.hasOwnProperty.call(options, key);

  const self = has("self")
    ? options.self
    : {
        location: { origin: "https://example.com", href: "https://example.com/worker.js" },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        postMessage: vi.fn(),
      };
  const crypto = has("crypto") ? options.crypto : CRYPTO;
  const SharedArrayBuffer = has("SharedArrayBuffer") ? options.SharedArrayBuffer : globalThis.SharedArrayBuffer;
  const Buffer = has("Buffer") ? options.Buffer : globalThis.Buffer;
  const atob = has("atob") ? options.atob : globalThis.atob;

  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const createLogger = vi.fn(() => mockLogger);

  class VfsProxyClient {}

  const context = {
    URL,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // Ensure typed arrays created in the VM are compatible with instanceof checks in this test file.
    Uint8Array,

    self,
    crypto,
    SharedArrayBuffer,
    Buffer,
    atob,

    __mocks: { createLogger, VfsProxyClient },
  };
  context.globalThis = context;

  vm.runInNewContext(WORKER_SCRIPT, context, { filename: WORKER_FILE_PATH });

  return {
    internals: context.__internals,
    createLogger,
    mockLogger,
  };
}

async function sha256Integrity(bytes) {
  const digest = await CRYPTO.subtle.digest("SHA-256", bytes);
  const b64 = Buffer.from(new Uint8Array(digest)).toString("base64");
  return `sha256-${b64}`;
}

function corruptBase64(b64) {
  const s = String(b64);
  if (s.length < 2) return `${s}A`;

  const idx = s.endsWith("=") ? s.length - 2 : s.length - 1;
  const head = s.slice(0, idx);
  const tail = s.slice(idx + 1);
  const ch = s[idx];
  const flipped = ch === "A" ? "B" : "A";
  return `${head}${flipped}${tail}`;
}

async function importFreshWorkerModule() {
  return await import(WORKER_MODULE_SPECIFIER);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  globalThis.self = {
    location: { origin: "https://example.com", href: "https://example.com/worker.js" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    onmessage: null,
  };
});

if (EXPORTED_NAMES.length) {
  for (const exportName of EXPORTED_NAMES) {
    describe(`export: ${exportName}`, () => {
      it("is present on the module namespace", async () => {
        const mod = await importFreshWorkerModule();
        expect(Object.prototype.hasOwnProperty.call(mod, exportName)).toBe(true);
      });
    });
  }
}

describe("isSharedArrayBuffer (internal)", () => {
  it("returns false when SharedArrayBuffer is unavailable", () => {
    const { internals } = evaluateWorkerInVm({ SharedArrayBuffer: undefined });
    expect(internals.isSharedArrayBuffer).toBeTypeOf("function");

    expect(internals.isSharedArrayBuffer(null)).toBe(false);
    expect(internals.isSharedArrayBuffer(undefined)).toBe(false);
    expect(internals.isSharedArrayBuffer("")).toBe(false);
    expect(internals.isSharedArrayBuffer(0)).toBe(false);
    expect(internals.isSharedArrayBuffer(-1)).toBe(false);
    expect(internals.isSharedArrayBuffer(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(internals.isSharedArrayBuffer(new ArrayBuffer(1))).toBe(false);
  });

  it("detects SharedArrayBuffer instances when available", () => {
    class FakeSharedArrayBuffer {}
    const { internals } = evaluateWorkerInVm({ SharedArrayBuffer: FakeSharedArrayBuffer });
    expect(internals.isSharedArrayBuffer).toBeTypeOf("function");

    expect(internals.isSharedArrayBuffer(new FakeSharedArrayBuffer())).toBe(true);
    expect(internals.isSharedArrayBuffer({})).toBe(false);
    expect(internals.isSharedArrayBuffer([])).toBe(false);
  });
});

describe("getWorkerOrigin (internal)", () => {
  it("returns self.location.origin when available", () => {
    const { internals } = evaluateWorkerInVm({
      self: {
        location: { origin: "https://app.local", href: "https://app.local/worker.js" },
      },
    });

    expect(internals.getWorkerOrigin).toBeTypeOf("function");
    expect(internals.getWorkerOrigin()).toBe("https://app.local");
  });

  it("returns null when self is missing", () => {
    const { internals } = evaluateWorkerInVm({ self: {} });
    expect(internals.getWorkerOrigin).toBeTypeOf("function");
    expect(internals.getWorkerOrigin()).toBe(null);
  });

  it("returns null when reading location throws", () => {
    const { internals } = evaluateWorkerInVm({
      self: {
        get location() {
          throw new Error("boom");
        },
      },
    });

    expect(internals.getWorkerOrigin).toBeTypeOf("function");
    expect(internals.getWorkerOrigin()).toBe(null);
  });
});

describe("getWorkerBaseUrl (internal)", () => {
  it("returns self.location.href when available", () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "https://app.local/w.js" } },
    });

    expect(internals.getWorkerBaseUrl).toBeTypeOf("function");
    expect(internals.getWorkerBaseUrl()).toBe("https://app.local/w.js");
  });

  it("falls back to PYODIDE_CDN_BASE_URL when href is empty", () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "" } },
    });

    expect(internals.getWorkerBaseUrl).toBeTypeOf("function");
    expect(internals.PYODIDE_CDN_BASE_URL).toBeTypeOf("string");
    expect(internals.getWorkerBaseUrl()).toBe(internals.PYODIDE_CDN_BASE_URL);
  });

  it("falls back to PYODIDE_CDN_BASE_URL when self is missing or location throws", () => {
    const { internals: noSelf } = evaluateWorkerInVm({ self: {} });
    expect(noSelf.PYODIDE_CDN_BASE_URL).toBeTypeOf("string");
    expect(noSelf.getWorkerBaseUrl()).toBe(noSelf.PYODIDE_CDN_BASE_URL);

    const { internals: throwsLocation } = evaluateWorkerInVm({
      self: {
        get location() {
          throw new Error("boom");
        },
      },
    });
    expect(throwsLocation.PYODIDE_CDN_BASE_URL).toBeTypeOf("string");
    expect(throwsLocation.getWorkerBaseUrl()).toBe(throwsLocation.PYODIDE_CDN_BASE_URL);
  });
});

describe("ensureTrailingSlashUrl (internal)", () => {
  it("adds a trailing slash when missing", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.ensureTrailingSlashUrl).toBeTypeOf("function");

    const url = new URL("https://example.com/foo");
    const out = internals.ensureTrailingSlashUrl(url);
    expect(out).toBe("https://example.com/foo/");
    expect(url.pathname).toBe("/foo/");
  });

  it("preserves query/hash and does not double-add", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.ensureTrailingSlashUrl).toBeTypeOf("function");

    const url1 = new URL("https://example.com/foo/?bar=baz#q");
    const out1 = internals.ensureTrailingSlashUrl(url1);
    expect(out1).toBe("https://example.com/foo/?bar=baz#q");
    expect(url1.pathname).toBe("/foo/");

    const url2 = new URL("https://example.com/a/b/c?x=1#y");
    const out2 = internals.ensureTrailingSlashUrl(url2);
    expect(out2).toBe("https://example.com/a/b/c/?x=1#y");
    expect(url2.pathname).toBe("/a/b/c/");
  });
});

describe("resolveAllowedPyodideUrl (internal)", () => {
  it("returns null for empty/non-string inputs (including boundary numbers and long whitespace)", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.resolveAllowedPyodideUrl).toBeTypeOf("function");

    expect(internals.resolveAllowedPyodideUrl("")).toBe(null);
    expect(internals.resolveAllowedPyodideUrl("   ")).toBe(null);
    expect(internals.resolveAllowedPyodideUrl(" \n\t ")).toBe(null);
    expect(internals.resolveAllowedPyodideUrl(" ".repeat(10_000))).toBe(null);

    expect(internals.resolveAllowedPyodideUrl(null)).toBe(null);
    expect(internals.resolveAllowedPyodideUrl(undefined)).toBe(null);
    expect(internals.resolveAllowedPyodideUrl([])).toBe(null);
    expect(internals.resolveAllowedPyodideUrl({})).toBe(null);

    expect(internals.resolveAllowedPyodideUrl(0)).toBe(null);
    expect(internals.resolveAllowedPyodideUrl(-1)).toBe(null);
    expect(internals.resolveAllowedPyodideUrl(Number.MAX_SAFE_INTEGER)).toBe(null);
  });

  it("throws on invalid URLs or non-http(s) protocols", () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "https://app.local/worker.js" } },
    });

    expect(() => internals.resolveAllowedPyodideUrl("http://example.com:bad/")).toThrow();
    expect(() => internals.resolveAllowedPyodideUrl("file:///etc/passwd")).toThrow(
      /http\(s\)/i,
    );
  });

  it("allows same-origin URLs when workerOrigin is available", () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "https://app.local/worker.js" } },
    });

    const url = internals.resolveAllowedPyodideUrl("/assets/pyodide/");
    expect(url).toBeInstanceOf(URL);
    expect(url.origin).toBe("https://app.local");
    expect(url.href).toBe("https://app.local/assets/pyodide/");
  });

  it("allows Pyodide CDN origin; optionally enforces CDN base prefix", () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "https://app.local/worker.js" } },
    });

    expect(internals.PYODIDE_CDN_BASE_URL).toBeTypeOf("string");
    expect(internals.PYODIDE_CDN_ORIGIN).toBeTypeOf("string");

    const ok = internals.resolveAllowedPyodideUrl(
      `${internals.PYODIDE_CDN_BASE_URL}pyodide.mjs`,
      { requireCdnPrefix: true },
    );
    expect(ok).toBeInstanceOf(URL);
    expect(ok.origin).toBe(internals.PYODIDE_CDN_ORIGIN);

    const okWithoutPrefix = internals.resolveAllowedPyodideUrl(
      `${internals.PYODIDE_CDN_ORIGIN}/some/other/path.js`,
      { requireCdnPrefix: false },
    );
    expect(okWithoutPrefix).toBeInstanceOf(URL);
    expect(okWithoutPrefix.origin).toBe(internals.PYODIDE_CDN_ORIGIN);

    expect(() =>
      internals.resolveAllowedPyodideUrl(`${internals.PYODIDE_CDN_ORIGIN}/not/pyodide/`, {
        requireCdnPrefix: true,
      }),
    ).toThrow(/base path/i);
  });

  it("rejects other origins (including when workerOrigin is unavailable)", () => {
    const { internals } = evaluateWorkerInVm({ self: {} });

    expect(() => internals.resolveAllowedPyodideUrl("https://evil.example/")).toThrow(
      /not allowed/i,
    );
  });

  it("is safe under rapid/concurrent calls", async () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "https://app.local/worker.js" } },
    });

    const tasks = [
      () => internals.resolveAllowedPyodideUrl(""),
      () => internals.resolveAllowedPyodideUrl("   "),
      () => internals.resolveAllowedPyodideUrl("/ok"),
      () =>
        internals.resolveAllowedPyodideUrl(`${internals.PYODIDE_CDN_BASE_URL}pyodide.mjs`, {
          requireCdnPrefix: true,
        }),
    ];

    const results = await Promise.all(tasks.map((fn) => Promise.resolve().then(fn)));
    expect(results[0]).toBe(null);
    expect(results[1]).toBe(null);
    expect(results[2]).toBeInstanceOf(URL);
    expect(results[3]).toBeInstanceOf(URL);
  });
});

describe("resolveAllowedIndexUrl (internal)", () => {
  it("defaults to PYODIDE_CDN_BASE_URL for empty inputs", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.resolveAllowedIndexUrl).toBeTypeOf("function");
    expect(internals.PYODIDE_CDN_BASE_URL).toBeTypeOf("string");

    expect(internals.resolveAllowedIndexUrl(null)).toBe(internals.PYODIDE_CDN_BASE_URL);
    expect(internals.resolveAllowedIndexUrl(undefined)).toBe(internals.PYODIDE_CDN_BASE_URL);
    expect(internals.resolveAllowedIndexUrl("")).toBe(internals.PYODIDE_CDN_BASE_URL);
    expect(internals.resolveAllowedIndexUrl("   ")).toBe(internals.PYODIDE_CDN_BASE_URL);
  });

  it("ensures trailing slash for allowed URLs", () => {
    const { internals } = evaluateWorkerInVm({
      self: { location: { origin: "https://app.local", href: "https://app.local/worker.js" } },
    });

    const out1 = internals.resolveAllowedIndexUrl("https://cdn.jsdelivr.net/pyodide/v0.26.4/full");
    expect(out1.endsWith("/")).toBe(true);

    const out2 = internals.resolveAllowedIndexUrl("https://app.local/pyodide/full");
    expect(out2).toBe("https://app.local/pyodide/full/");
  });

  it("throws when pointing to CDN origin outside base path", () => {
    const { internals } = evaluateWorkerInVm();
    expect(() =>
      internals.resolveAllowedIndexUrl("https://cdn.jsdelivr.net/not-pyodide/"),
    ).toThrow();
  });
});

describe("resolveAllowedWheelUrl (internal)", () => {
  it("returns null for empty/non-string inputs and preserves emfs: URLs", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.resolveAllowedWheelUrl).toBeTypeOf("function");

    expect(internals.resolveAllowedWheelUrl("")).toBe(null);
    expect(internals.resolveAllowedWheelUrl("   ")).toBe(null);
    expect(internals.resolveAllowedWheelUrl(null)).toBe(null);
    expect(internals.resolveAllowedWheelUrl(undefined)).toBe(null);
    expect(internals.resolveAllowedWheelUrl([])).toBe(null);
    expect(internals.resolveAllowedWheelUrl({})).toBe(null);
    expect(internals.resolveAllowedWheelUrl(0)).toBe(null);
    expect(internals.resolveAllowedWheelUrl(-1)).toBe(null);
    expect(internals.resolveAllowedWheelUrl(Number.MAX_SAFE_INTEGER)).toBe(null);

    expect(internals.resolveAllowedWheelUrl("emfs:/wheels/pkg.whl")).toBe("emfs:/wheels/pkg.whl");
  });

  it("accepts wheels within the Pyodide CDN base and rejects others", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.PYODIDE_CDN_BASE_URL).toBeTypeOf("string");

    const ok = internals.resolveAllowedWheelUrl(`${internals.PYODIDE_CDN_BASE_URL}numpy.whl`);
    expect(ok).toBe(`${internals.PYODIDE_CDN_BASE_URL}numpy.whl`);

    expect(() => internals.resolveAllowedWheelUrl("https://evil.example/pkg.whl")).toThrow(
      /not allowed/i,
    );
    expect(() =>
      internals.resolveAllowedWheelUrl("https://cdn.jsdelivr.net/not-pyodide/pkg.whl"),
    ).toThrow();
  });
});

describe("ensureDir / ensureDirTree / ensureSymlink (internal)", () => {
  it("does not throw when FS operations succeed or fail (including missing methods)", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.ensureDir).toBeTypeOf("function");
    expect(internals.ensureDirTree).toBeTypeOf("function");
    expect(internals.ensureSymlink).toBeTypeOf("function");

    const FS1 = {
      mkdir: vi.fn(),
      mkdirTree: vi.fn(),
      symlink: vi.fn(),
    };

    expect(() => internals.ensureDir(FS1, "/tmp")).not.toThrow();
    expect(FS1.mkdir).toHaveBeenCalledWith("/tmp");

    FS1.mkdir.mockImplementationOnce(() => {
      throw new Error("EEXIST");
    });
    expect(() => internals.ensureDir(FS1, "/tmp")).not.toThrow();

    expect(() => internals.ensureDirTree(FS1, "/a/b/c")).not.toThrow();
    expect(FS1.mkdirTree).toHaveBeenCalledWith("/a/b/c");

    FS1.mkdirTree.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => internals.ensureDirTree(FS1, "/a/b/c")).not.toThrow();

    const FS2 = {};
    expect(() => internals.ensureDir(FS2, "/x")).not.toThrow();
    expect(() => internals.ensureDirTree(FS2, "/x/y")).not.toThrow();
    expect(() => internals.ensureSymlink(FS2, "/target", "/x/y/z")).not.toThrow();
  });

  it("ensureSymlink ensures parent directory creation and is safe under concurrency", async () => {
    const { internals } = evaluateWorkerInVm();

    const FS = {
      mkdirTree: vi.fn(),
      symlink: vi.fn(),
    };

    const deepLink = "/a/b/c/d/e/f/g/h/i/j/k/link";
    expect(() => internals.ensureSymlink(FS, "/target", deepLink)).not.toThrow();
    expect(FS.mkdirTree).toHaveBeenCalledWith("/a/b/c/d/e/f/g/h/i/j/k");
    expect(FS.symlink).toHaveBeenCalledWith("/target", deepLink);

    await expect(
      Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          Promise.resolve().then(() =>
            internals.ensureSymlink(FS, `/t${i}`, `/p/q/r/s/${i}/lnk`),
          ),
        ),
      ),
    ).resolves.toBeDefined();
  });
});

describe("decodeBase64ToBytes (internal)", () => {
  it("returns null for empty/non-string inputs (including boundary numbers)", () => {
    const { internals } = evaluateWorkerInVm();
    expect(internals.decodeBase64ToBytes).toBeTypeOf("function");

    expect(internals.decodeBase64ToBytes(null)).toBe(null);
    expect(internals.decodeBase64ToBytes(undefined)).toBe(null);
    expect(internals.decodeBase64ToBytes("")).toBe(null);
    expect(internals.decodeBase64ToBytes("   ")).toBe(null);
    expect(internals.decodeBase64ToBytes([])).toBe(null);
    expect(internals.decodeBase64ToBytes({})).toBe(null);
    expect(internals.decodeBase64ToBytes(0)).toBe(null);
    expect(internals.decodeBase64ToBytes(-1)).toBe(null);
    expect(internals.decodeBase64ToBytes(Number.MAX_SAFE_INTEGER)).toBe(null);
  });

  it("decodes base64 using Buffer path (normal + whitespace trimming)", () => {
    const { internals } = evaluateWorkerInVm();
    const out = internals.decodeBase64ToBytes("aGVsbG8=");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(out).toString("utf8")).toBe("hello");

    const out2 = internals.decodeBase64ToBytes("  aGVsbG8=  ");
    expect(Buffer.from(out2).toString("utf8")).toBe("hello");
  });

  it("decodes base64 using atob path when Buffer is unavailable; throws on invalid base64", () => {
    const nodeBuffer = globalThis.Buffer;

    const strictAtob = (b64) => {
      const s = String(b64);
      if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error("Invalid base64");
      return nodeBuffer.from(s, "base64").toString("binary");
    };

    const { internals } = evaluateWorkerInVm({
      Buffer: undefined,
      atob: strictAtob,
    });

    const out = internals.decodeBase64ToBytes("aGVsbG8=");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(nodeBuffer.from(out).toString("utf8")).toBe("hello");

    expect(() => internals.decodeBase64ToBytes("@@not-base64@@")).toThrow(/base64/i);
  });

  it("handles long base64 strings (resource boundary)", () => {
    const { internals } = evaluateWorkerInVm();

    const bytes = new Uint8Array(256 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;

    const b64 = Buffer.from(bytes).toString("base64");
    const decoded = internals.decodeBase64ToBytes(b64);

    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0]).toBe(bytes[0]);
    expect(decoded[bytes.length - 1]).toBe(bytes[bytes.length - 1]);
  });
});

describe("verifySha256SRI (internal)", () => {
  it("no-ops when expected integrity is empty (even if crypto is missing)", async () => {
    const { internals } = evaluateWorkerInVm({ crypto: undefined });
    expect(internals.verifySha256SRI).toBeTypeOf("function");

    await expect(internals.verifySha256SRI(new Uint8Array([1, 2, 3]), "")).resolves.toBeUndefined();
    await expect(
      internals.verifySha256SRI(new Uint8Array([1, 2, 3]), "   "),
    ).resolves.toBeUndefined();
    await expect(
      internals.verifySha256SRI(new Uint8Array([1, 2, 3]), null),
    ).resolves.toBeUndefined();
    await expect(
      internals.verifySha256SRI(new Uint8Array([1, 2, 3]), undefined),
    ).resolves.toBeUndefined();
  });

  it("rejects when crypto.subtle is unavailable and integrity is provided", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const integrity = await sha256Integrity(bytes);

    const { internals } = evaluateWorkerInVm({ crypto: undefined });

    await expect(internals.verifySha256SRI(bytes, integrity)).rejects.toThrow();
  });

  it("accepts matching integrity (with and without sha256- prefix) and rejects mismatches", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3]);
    const integrity = await sha256Integrity(bytes);
    const b64 = integrity.replace(/^sha256-/, "");

    const { internals } = evaluateWorkerInVm({ crypto: CRYPTO });

    await expect(internals.verifySha256SRI(bytes, integrity)).resolves.toBeUndefined();
    await expect(internals.verifySha256SRI(bytes, b64)).resolves.toBeUndefined();

    const bad = `sha256-${corruptBase64(b64)}`;
    await expect(internals.verifySha256SRI(bytes, bad)).rejects.toThrow();
  });

  it("is safe under concurrency and large inputs (resource + concurrency boundary)", async () => {
    const bytes = new Uint8Array(512 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 251;

    const integrity = await sha256Integrity(bytes);
    const { internals } = evaluateWorkerInVm({ crypto: CRYPTO });

    await expect(
      Promise.all(
        Array.from({ length: 20 }, () => internals.verifySha256SRI(bytes, integrity)),
      ),
    ).resolves.toBeDefined();
  });

  it("handles type-boundary bytes input by rejecting when bytes is not binary-like", async () => {
    const { internals } = evaluateWorkerInVm({ crypto: CRYPTO });

    // @ts-expect-error intentional type boundary
    await expect(internals.verifySha256SRI("not-bytes", "sha256-AAAA")).rejects.toThrow();
  });
});
