import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { computeHash, buildManifest, computeDelta } from "../../../../js/agents/vfs/delta-sync.js";

const repeatHex = (byte, count) =>
  new Array(count).fill(byte.toString(16).padStart(2, "0")).join("");

const createDigestMock = () =>
  vi.fn(async (_algo, data) => {
    const bytes = new Uint8Array(data);
    return new Uint8Array(32).fill(bytes.length & 0xff).buffer;
  });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("computeHash", () => {
  it("hashes string, Uint8Array, and ArrayBuffer using crypto.subtle", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    const h1 = await computeHash("hi");
    const h2 = await computeHash(new Uint8Array([1, 2, 3, 4]));
    const h3 = await computeHash(new Uint8Array([9]).buffer);

    expect(digestMock).toHaveBeenCalledTimes(3);
    expect(digestMock).toHaveBeenNthCalledWith(1, "SHA-256", expect.any(Uint8Array));
    expect(h1).toBe(repeatHex(2, 32));
    expect(h2).toBe(repeatHex(4, 32));
    expect(h3).toBe(repeatHex(1, 32));
  });

  it("handles empty and whitespace inputs", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    const emptyString = await computeHash("");
    const whitespace = await computeHash("   ");
    const emptyBytes = await computeHash(new Uint8Array());

    expect(emptyString).toBe(repeatHex(0, 32));
    expect(whitespace).toBe(repeatHex(3, 32));
    expect(emptyBytes).toBe(repeatHex(0, 32));
    expect(digestMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to FNV-1a when digest fails", async () => {
    const digestMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    await expect(computeHash("a")).resolves.toBe("e40c292c");
    expect(digestMock).toHaveBeenCalled();
  });

  it("rejects invalid input types", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    await expect(computeHash(null)).rejects.toThrow(TypeError);
    await expect(computeHash(undefined)).rejects.toThrow(TypeError);
    await expect(computeHash(123)).rejects.toThrow(TypeError);
    await expect(computeHash([])).rejects.toThrow(TypeError);
    await expect(computeHash({})).rejects.toThrow(TypeError);
  });

  it("supports concurrent hashing without shared state", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    const [h1, h2, h3] = await Promise.all([
      computeHash("a"),
      computeHash("abc"),
      computeHash(new Uint8Array([0, 1, 2, 3, 4, 5])),
    ]);

    expect(h1).toBe(repeatHex(1, 32));
    expect(h2).toBe(repeatHex(3, 32));
    expect(h3).toBe(repeatHex(6, 32));
  });
});

describe("buildManifest", () => {
  it("builds a manifest with hashes, sizes, and mtimes", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    const manifest = await buildManifest([
      { path: "a.txt", content: "hi", mtime: 0 },
      { path: "b.bin", content: new Uint8Array([1, 2, 3]), mtime: -1 },
      { path: "c.buf", content: new Uint8Array([9]).buffer, mtime: Number.MAX_SAFE_INTEGER },
      { path: "d.txt", content: "  ", mtime: "123" },
      { path: "e.txt", content: "" },
    ]);

    expect(manifest.id).toBe(`manifest_${Date.now().toString(36)}`);
    expect(manifest.ts).toBe(1700000000000);
    expect(manifest.files.size).toBe(5);

    const a = manifest.files.get("a.txt");
    expect(a).toEqual(expect.objectContaining({ path: "a.txt", mtime: 0, size: 2 }));
    expect(a.hash).toBe(repeatHex(2, 32));

    const b = manifest.files.get("b.bin");
    expect(b).toEqual(expect.objectContaining({ path: "b.bin", mtime: -1, size: 3 }));
    expect(b.hash).toBe(repeatHex(3, 32));

    const c = manifest.files.get("c.buf");
    expect(c).toEqual(
      expect.objectContaining({
        path: "c.buf",
        mtime: Number.MAX_SAFE_INTEGER,
        size: 1,
      })
    );
    expect(c.hash).toBe(repeatHex(1, 32));

    const d = manifest.files.get("d.txt");
    expect(d).toEqual(expect.objectContaining({ path: "d.txt", mtime: "123", size: 2 }));
    expect(d.hash).toBe(repeatHex(2, 32));

    const e = manifest.files.get("e.txt");
    expect(e).toEqual(
      expect.objectContaining({ path: "e.txt", mtime: 1700000000000, size: 0 })
    );
    expect(e.hash).toBe(repeatHex(0, 32));
  });

  it("handles an empty file list", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    const manifest = await buildManifest([]);
    expect(manifest.files.size).toBe(0);
    expect(manifest.id).toMatch(/^manifest_/);
  });

  it("throws when files is not iterable", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    await expect(buildManifest(null)).rejects.toThrow(TypeError);
    await expect(buildManifest(undefined)).rejects.toThrow(TypeError);
    await expect(buildManifest({})).rejects.toThrow(TypeError);
  });

  it("rejects invalid file content types", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    await expect(
      buildManifest([{ path: "bad.txt", content: { not: "bytes" } }])
    ).rejects.toThrow(TypeError);
  });

  it("supports concurrent calls with large content and deep paths", async () => {
    const digestMock = createDigestMock();
    vi.stubGlobal("crypto", { subtle: { digest: digestMock } });

    const largeString = "a".repeat(1024 * 1024 + 1);
    const largeBytes = new Uint8Array(512 * 1024 + 2);
    const deepPath = "deep/nested/path/for/large/file.txt";

    const [manifestA, manifestB] = await Promise.all([
      buildManifest([{ path: deepPath, content: largeString }]),
      buildManifest([{ path: "big.bin", content: largeBytes }]),
    ]);

    const entryA = manifestA.files.get(deepPath);
    expect(entryA.size).toBe(largeString.length);
    expect(entryA.hash).toBe(repeatHex(largeString.length & 0xff, 32));

    const entryB = manifestB.files.get("big.bin");
    expect(entryB.size).toBe(largeBytes.byteLength);
    expect(entryB.hash).toBe(repeatHex(largeBytes.length & 0xff, 32));
  });
});

describe("computeDelta", () => {
  it("returns add/modify/delete entries", () => {
    const base = {
      id: "base",
      ts: 0,
      files: new Map([
        ["a.txt", { path: "a.txt", hash: "h1", size: 1, mtime: 1 }],
        ["b.txt", { path: "b.txt", hash: "h2", size: 2, mtime: 2 }],
      ]),
    };
    const target = {
      id: "target",
      ts: 0,
      files: new Map([
        ["a.txt", { path: "a.txt", hash: "h1-new", size: 10, mtime: 10 }],
        ["c.txt", { path: "c.txt", hash: "h3", size: 3, mtime: 3 }],
      ]),
    };

    const delta = computeDelta(base, target);
    expect(delta).toEqual(
      expect.arrayContaining([
        { path: "a.txt", type: "modify", hash: "h1-new", size: 10 },
        { path: "c.txt", type: "add", hash: "h3", size: 3 },
        { path: "b.txt", type: "delete" },
      ])
    );
  });

  it("handles empty manifests", () => {
    const emptyBase = { id: "b", ts: 0, files: new Map() };
    const emptyTarget = { id: "t", ts: 0, files: new Map() };

    expect(computeDelta(emptyBase, emptyTarget)).toEqual([]);
  });

  it("throws when base or target are invalid", () => {
    const valid = { id: "v", ts: 0, files: new Map() };

    expect(() => computeDelta(null, valid)).toThrow();
    expect(() => computeDelta(valid, undefined)).toThrow();
    expect(() => computeDelta(valid, { id: "bad", ts: 0, files: {} })).toThrow();
  });

  it("is deterministic across rapid repeated calls", () => {
    const base = {
      id: "base",
      ts: 0,
      files: new Map([["a.txt", { path: "a.txt", hash: "h1", size: "1", mtime: 1 }]]),
    };
    const target = {
      id: "target",
      ts: 0,
      files: new Map([["a.txt", { path: "a.txt", hash: "h2", size: "2", mtime: 2 }]]),
    };

    const first = computeDelta(base, target);
    const second = computeDelta(base, target);

    expect(first).toEqual([{ path: "a.txt", type: "modify", hash: "h2", size: "2" }]);
    expect(second).toEqual(first);
    expect(base.files.size).toBe(1);
    expect(target.files.size).toBe(1);
  });
});
