import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../js/agents/vfs/checkpoints.js";

const computeSha256Mock = vi.fn();
const normalizeVfsPathMock = vi.fn();
const createUnifiedDiffAsyncMock = vi.fn();
const makeSecureTimestampedIdMock = vi.fn();
const isPlainObjectMock = vi.fn();

vi.mock("../../../../js/agents/storage/artifact-manager.js", () => ({
  computeSha256: computeSha256Mock,
}));

vi.mock("../../../../js/agents/vfs/path.js", () => ({
  normalizeVfsPath: normalizeVfsPathMock,
}));

vi.mock("../../../../js/agents/vfs/diff.js", () => ({
  createUnifiedDiffAsync: createUnifiedDiffAsyncMock,
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  makeSecureTimestampedId: makeSecureTimestampedIdMock,
  isPlainObject: isPlainObjectMock,
}));

let idCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;

  computeSha256Mock.mockImplementation(async (data) => {
    if (typeof data === "string") return `sha_str_${data}`;
    if (data instanceof Uint8Array) {
      const head = Array.from(data.slice(0, 4)).join(",");
      return `sha_bytes_${data.length}_${head}`;
    }
    return "sha_unknown";
  });

  normalizeVfsPathMock.mockImplementation((value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    return trimmed.replace(/^[/\\\\]+/, "").replace(/\\\\/g, "/");
  });

  createUnifiedDiffAsyncMock.mockImplementation(async () => ({
    text: "--- a\n+++ b\n@@\n-old\n+new\n",
  }));

  makeSecureTimestampedIdMock.mockImplementation((prefix) => `${prefix}_${++idCounter}`);

  isPlainObjectMock.mockImplementation((value) => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
});

async function importCheckpoints() {
  vi.resetModules();
  return await import(MODULE_PATH);
}

function createStorageAdapter(seed = new Map()) {
  const store = seed;
  return {
    store,
    get: vi.fn(async (key) => store.get(key)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
  };
}

function createRunStore() {
  let counter = 0;
  return {
    saveArtifact: vi.fn(async (_runId, type) => `artifact:${type}:${++counter}`),
    getArtifactById: vi.fn(),
  };
}

describe("recordVfsCheckpoint", () => {
  it("embeds small utf8 payloads, computes diff, and saves via runStore", async () => {
    const { recordVfsCheckpoint, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const runStore = createRunStore();

    const { artifactId, checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "/a.txt",
      before: "hello",
      after: "hello world",
      op: "write",
      maxEmbedBytes: 1000,
    });

    expect(artifactId).toBe(`artifact:${VFS_CHECKPOINT_TYPE}:1`);
    expect(checkpoint.kind).toBe("vfs_checkpoint");
    expect(checkpoint.path).toBe("a.txt");
    expect(checkpoint.before.text).toBe("hello");
    expect(checkpoint.after.text).toBe("hello world");
    expect(checkpoint.diff).toEqual(
      expect.objectContaining({
        format: "unified",
        context: 3,
        text: expect.any(String),
        bytes: expect.any(Number),
      })
    );
    expect(createUnifiedDiffAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.txt", beforeText: "hello", afterText: "hello world", context: 3 }),
      expect.objectContaining({ useWorker: true })
    );
    expect(runStore.saveArtifact).toHaveBeenCalledWith(
      "run_1",
      VFS_CHECKPOINT_TYPE,
      expect.objectContaining({ kind: "vfs_checkpoint", path: "a.txt" }),
      expect.objectContaining({ mime: "application/json", bytes: expect.any(Number) })
    );
  });

  it("skips diff when content is unchanged or skipDiff is true", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();

    const unchanged = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "same.txt",
      before: "same",
      after: "same",
      beforeSha256: "abc",
      afterSha256: "abc",
      maxEmbedBytes: 1000,
    });

    const skipped = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "skip.txt",
      before: "a",
      after: "b",
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    expect(unchanged.checkpoint.diff).toBeUndefined();
    expect(unchanged.checkpoint.diffPromise).toBeUndefined();
    expect(skipped.checkpoint.diff).toBeUndefined();
    expect(skipped.checkpoint.diffPromise).toBeUndefined();
    expect(createUnifiedDiffAsyncMock).not.toHaveBeenCalled();
  });

  it("defers diff computation when deferDiff is true", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: "a",
      after: "b",
      deferDiff: true,
      maxEmbedBytes: 1000,
    });

    expect(checkpoint.diff).toBeUndefined();
    expect(checkpoint.diffPromise).toBeInstanceOf(Promise);

    const diff = await checkpoint.diffPromise;
    expect(diff).toEqual(expect.objectContaining({ format: "unified", context: 3, text: expect.any(String) }));
    expect(createUnifiedDiffAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("omits diff when diff generation throws", async () => {
    createUnifiedDiffAsyncMock.mockImplementation(async () => {
      throw new Error("diff boom");
    });

    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: "a",
      after: "b",
      maxEmbedBytes: 1000,
    });

    expect(checkpoint.diff).toBeUndefined();
    expect(checkpoint.diffPromise).toBeUndefined();
    expect(createUnifiedDiffAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("treats invalid utf8 as binary, embeds base64, and skips diff", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "bin.dat",
      before: invalidUtf8,
      after: invalidUtf8,
      maxEmbedBytes: 1000,
    });

    expect(checkpoint.before.preview).toBeNull();
    expect(checkpoint.after.preview).toBeNull();
    expect(checkpoint.before.base64).toMatch(/\S/);
    expect(checkpoint.after.base64).toMatch(/\S/);
    expect(createUnifiedDiffAsyncMock).not.toHaveBeenCalled();
  });

  it("stores large payloads out-of-band via runStore (resource boundary)", async () => {
    const { recordVfsCheckpoint, VFS_PAYLOAD_TYPE } = await importCheckpoints();

    const runStore = createRunStore();
    const bigBinary = new Uint8Array(1_000_000);
    bigBinary[0] = 1;
    bigBinary[1] = 2;

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_big",
      path: "big.bin",
      before: bigBinary,
      after: bigBinary,
      maxEmbedBytes: 8,
    });

    expect(checkpoint.before.truncated).toBe(true);
    expect(checkpoint.after.truncated).toBe(true);
    expect(checkpoint.before.payload).toEqual(
      expect.objectContaining({ type: VFS_PAYLOAD_TYPE, encoding: "binary", bytes: bigBinary.byteLength })
    );

    const payloadCalls = runStore.saveArtifact.mock.calls.filter((call) => call[1] === VFS_PAYLOAD_TYPE);
    expect(payloadCalls.length).toBe(2);
    expect(payloadCalls.some((call) => call[2] instanceof Uint8Array)).toBe(true);
  });

  it("uses storageAdapter local artifacts with base64 payloads and fallback ids", async () => {
    makeSecureTimestampedIdMock.mockImplementation(() => {
      throw new Error("no crypto");
    });

    const { recordVfsCheckpoint, VFS_PAYLOAD_TYPE } = await importCheckpoints();

    const storageAdapter = createStorageAdapter();
    const bytes = new Uint8Array([0, 255, 1, 2]);

    const { artifactId, checkpoint } = await recordVfsCheckpoint({
      storageAdapter,
      runId: "run_1",
      path: "bin.dat",
      before: bytes,
      after: bytes,
      maxEmbedBytes: 1,
    });

    expect(makeSecureTimestampedIdMock).toHaveBeenCalled();
    expect(artifactId).toMatch(/^pb_vfs_artifact\|/);
    expect(checkpoint.before.payload).toEqual(expect.objectContaining({ type: VFS_PAYLOAD_TYPE, encoding: "binary" }));

    const payloadId = checkpoint.before.payload?.artifactId;
    expect(typeof payloadId).toBe("string");
    expect(typeof storageAdapter.store.get(payloadId)).toBe("string");
  });

  it("handles null/undefined and JSON encodes deep objects and arrays", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();
    const deep = { level: { one: { two: { three: { four: 4 } } } } };

    const { checkpoint: deepCheckpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "deep.json",
      before: deep,
      after: "ok",
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    expect(deepCheckpoint.before.text).toBe(JSON.stringify(deep));
    expect(deepCheckpoint.after.text).toBe("ok");

    const { checkpoint: emptyCheckpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "empty.json",
      before: {},
      after: [],
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    expect(emptyCheckpoint.before.text).toBe("{}");
    expect(emptyCheckpoint.after.text).toBe("[]");

    const { checkpoint: nullCheckpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "null.txt",
      before: null,
      after: undefined,
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    expect(nullCheckpoint.before.bytes).toBe(0);
    expect(nullCheckpoint.after.bytes).toBe(0);
    expect(nullCheckpoint.before.preview).toBeNull();
    expect(nullCheckpoint.after.preview).toBeNull();
  });

  it("truncates previews for very long strings (resource boundary)", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();
    const longText = "a".repeat(1000);

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "long.txt",
      before: "",
      after: longText,
      skipDiff: true,
      maxEmbedBytes: 2000,
    });

    expect(checkpoint.before.text).toBe("");
    expect(checkpoint.after.text).toBe(longText);
    expect(checkpoint.after.preview).toContain("...(truncated)");
  });

  it("respects maxEmbedBytes boundaries and numeric string values", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();

    const zero = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "zero.txt",
      before: "a",
      after: "b",
      maxEmbedBytes: 0,
      skipDiff: true,
    });

    expect(zero.checkpoint.before.truncated).toBe(true);
    expect(zero.checkpoint.before.payload).toBeDefined();

    const negative = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "neg.txt",
      before: "a",
      after: "b",
      maxEmbedBytes: -1,
      skipDiff: true,
    });

    expect(negative.checkpoint.before.truncated).toBe(true);
    expect(negative.checkpoint.before.payload).toBeDefined();

    const huge = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "huge.txt",
      before: "a",
      after: "b",
      maxEmbedBytes: Number.MAX_SAFE_INTEGER,
      skipDiff: true,
    });

    expect(huge.checkpoint.before.truncated).toBeUndefined();
    expect(huge.checkpoint.before.text).toBe("a");

    const numericString = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "string.txt",
      before: "a",
      after: "b",
      maxEmbedBytes: "2",
      skipDiff: true,
    });

    expect(numericString.checkpoint.before.text).toBe("a");
    expect(numericString.checkpoint.before.truncated).toBeUndefined();
  });

  it("omits sha256 when hashing fails", async () => {
    computeSha256Mock.mockImplementation(async () => {
      throw new Error("hash boom");
    });

    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = createRunStore();

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "hash.txt",
      before: "a",
      after: "b",
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    expect(checkpoint.before.sha256).toBeUndefined();
    expect(checkpoint.after.sha256).toBeUndefined();
  });

  it("handles concurrent and rapid consecutive calls without key collisions", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const storageAdapter = createStorageAdapter();

    const [first, second] = await Promise.all([
      recordVfsCheckpoint({
        storageAdapter,
        runId: "run_1",
        path: "a.txt",
        before: "a",
        after: "b",
        skipDiff: true,
        maxEmbedBytes: 1000,
      }),
      recordVfsCheckpoint({
        storageAdapter,
        runId: "run_1",
        path: "b.txt",
        before: "c",
        after: "d",
        skipDiff: true,
        maxEmbedBytes: 1000,
      }),
    ]);

    const third = await recordVfsCheckpoint({
      storageAdapter,
      runId: "run_1",
      path: "c.txt",
      before: "e",
      after: "f",
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    const fourth = await recordVfsCheckpoint({
      storageAdapter,
      runId: "run_1",
      path: "d.txt",
      before: "g",
      after: "h",
      skipDiff: true,
      maxEmbedBytes: 1000,
    });

    const keys = Array.from(storageAdapter.store.keys());
    expect(keys.length).toBe(4);
    expect(new Set(keys).size).toBe(4);
    expect(first.artifactId).not.toBe(second.artifactId);
    expect(third.artifactId).not.toBe(fourth.artifactId);
  });

  it("validates required inputs and whitespace boundaries", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    await expect(recordVfsCheckpoint({ runId: "run_1", path: "a.txt" })).rejects.toThrow(/runStore or storageAdapter/i);

    const runStore = createRunStore();
    await expect(recordVfsCheckpoint({ runStore, runId: 0, path: "a.txt" })).rejects.toThrow(/runId must be a string/i);
    await expect(recordVfsCheckpoint({ runStore, runId: "run_1", path: "   " })).rejects.toThrow(/path must be a non-empty/i);

    const storageAdapter = createStorageAdapter();
    await expect(
      recordVfsCheckpoint({ storageAdapter, runId: "   ", path: "a.txt", before: "x", after: "y" })
    ).rejects.toThrow(/makeLocalArtifactKey/i);
  });
});

describe("listVfsCheckpoints", () => {
  it("returns an empty list when no runStore or storageAdapter is available", async () => {
    const { listVfsCheckpoints } = await importCheckpoints();

    await expect(listVfsCheckpoints(null, "run_1")).resolves.toEqual([]);
  });

  it("prefers listArtifactSummaries and sorts by seq", async () => {
    const { listVfsCheckpoints, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(),
      listArtifactSummaries: vi.fn(async () => [
        { artifactId: "a2", type: VFS_CHECKPOINT_TYPE, seq: 2 },
        { artifactId: "a1", type: VFS_CHECKPOINT_TYPE, seq: 1 },
      ]),
    };

    const out = await listVfsCheckpoints(runStore, "run_1");
    expect(out.map((row) => row.artifactId)).toEqual(["a1", "a2"]);
  });

  it("falls back to listArtifacts when listArtifactSummaries fails", async () => {
    const { listVfsCheckpoints, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(),
      listArtifactSummaries: vi.fn(async () => {
        throw new Error("boom");
      }),
      listArtifacts: vi.fn(async () => [
        { artifactId: "x", type: "other", seq: 1 },
        { artifactId: "b2", type: VFS_CHECKPOINT_TYPE, seq: 2 },
        { artifactId: "b1", type: VFS_CHECKPOINT_TYPE, seq: 1 },
      ]),
    };

    const out = await listVfsCheckpoints(runStore, "run_1");
    expect(out.map((row) => row.artifactId)).toEqual(["b1", "b2"]);
  });

  it("lists checkpoint keys from a local storageAdapter and ignores malformed keys", async () => {
    const { listVfsCheckpoints, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const store = new Map();
    store.set(`pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_1|id1`, { ok: true });
    store.set(`pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_1|id2`, { ok: true });
    store.set(`pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_2|id3`, { ok: true });
    store.set(`pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_1|`, { ok: false });
    store.set("not_a_checkpoint", { ok: false });

    const storageAdapter = createStorageAdapter(store);

    const out = await listVfsCheckpoints(null, "run_1", storageAdapter);
    expect(out.map((row) => row.id).sort()).toEqual(["id1", "id2"]);
  });

  it("returns an empty list for non-string or whitespace runIds", async () => {
    const { listVfsCheckpoints } = await importCheckpoints();

    const storageAdapter = createStorageAdapter();

    const outNumber = await listVfsCheckpoints(null, 0, storageAdapter);
    const outWhitespace = await listVfsCheckpoints(null, "   ", storageAdapter);

    expect(outNumber).toEqual([]);
    expect(outWhitespace).toEqual([]);
  });
});

describe("restoreVfsCheckpoint", () => {
  it("restores embedded text payloads and defaults encoding", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ path: "a.txt", before: { text: "" } })),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res).toEqual({ ok: true, path: "a.txt", encoding: "utf8" });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "");
  });

  it("restores embedded base64 payloads via writeFile", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const bytes = new Uint8Array([1, 2, 3]);
    const base64 = Buffer.from(bytes).toString("base64");

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ path: "bin.dat", before: { base64 } })),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res).toEqual({ ok: true, path: "bin.dat", encoding: "binary" });
    const written = vfs.writeFile.mock.calls[0]?.[1];
    expect(written).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("restores payload references via adapter fallback (utf8 and binary)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => {
        throw new Error("runStore unavailable");
      }),
    };

    const store = new Map();
    store.set("ckpt_utf8", { path: "a.txt", before: { payload: { artifactId: "payload_utf8", encoding: "utf8" } } });
    store.set("payload_utf8", "hello payload");
    store.set("ckpt_bin", { path: "b.bin", before: { payload: { artifactId: "payload_bin", encoding: "binary" } } });
    store.set("payload_bin", Buffer.from([4, 5]).toString("base64"));

    const storageAdapter = createStorageAdapter(store);
    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };

    const resText = await restoreVfsCheckpoint({ vfs, runStore, storageAdapter, artifactId: "ckpt_utf8" });
    expect(resText).toEqual({ ok: true, path: "a.txt", encoding: "utf8", payloadArtifactId: "payload_utf8" });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "hello payload");

    const resBin = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_bin" });
    expect(resBin).toEqual({ ok: true, path: "b.bin", encoding: "binary", payloadArtifactId: "payload_bin" });
    const written = vfs.writeFile.mock.calls.find((call) => call[0] === "b.bin")?.[1];
    expect(written).toEqual(new Uint8Array([4, 5]));
  });

  it("treats non-string encoding as binary and handles byte payloads", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const store = new Map();
    store.set("ckpt_utf8_bytes", {
      path: "utf8.txt",
      before: { payload: { artifactId: "payload_utf8_bytes", encoding: "utf8" } },
    });
    store.set("payload_utf8_bytes", new TextEncoder().encode("bytes"));

    store.set("ckpt_bad_enc", {
      path: "bad.bin",
      before: { payload: { artifactId: "payload_bad", encoding: 123 } },
    });
    store.set("payload_bad", new Uint8Array([9, 8]));

    const storageAdapter = createStorageAdapter(store);
    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };

    const resUtf8 = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_utf8_bytes" });
    expect(resUtf8).toEqual({ ok: true, path: "utf8.txt", encoding: "utf8", payloadArtifactId: "payload_utf8_bytes" });
    expect(vfs.writeText).toHaveBeenCalledWith("utf8.txt", "bytes");

    const resBinary = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_bad_enc" });
    expect(resBinary).toEqual({ ok: true, path: "bad.bin", encoding: "binary", payloadArtifactId: "payload_bad" });
    const written = vfs.writeFile.mock.calls.find((call) => call[0] === "bad.bin")?.[1];
    expect(written).toEqual(new Uint8Array([9, 8]));
  });

  it("returns ok:false when payload restore fails", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async (id) => {
        if (id === "ckpt_1") return { path: "a.txt", before: { payload: { artifactId: "payload_1", encoding: "utf8" } } };
        throw new Error("store miss");
      }),
    };

    const storageAdapter = {
      get: vi.fn(async () => {
        throw new Error("payload missing");
      }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, storageAdapter, artifactId: "ckpt_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Failed to restore payload payload_1/i);
  });

  it("validates required inputs and missing checkpoint paths", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    await expect(restoreVfsCheckpoint({})).rejects.toThrow(/vfs with writeFile/i);
    await expect(
      restoreVfsCheckpoint({ vfs: { writeFile: vi.fn(), writeText: vi.fn() }, artifactId: "ckpt_1" })
    ).rejects.toThrow(/runStore or storageAdapter/i);
    await expect(
      restoreVfsCheckpoint({
        vfs: { writeFile: vi.fn(), writeText: vi.fn() },
        runStore: { saveArtifact: vi.fn(), getArtifactById: vi.fn() },
        artifactId: "   ",
      })
    ).rejects.toThrow(/artifactId must be a non-empty string/i);

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ before: { text: "hello" } })),
    };
    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    await expect(restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" })).rejects.toThrow(/checkpoint missing path/i);
  });

  it("returns ok:false when no embedded payload or payload reference exists", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ path: "a.txt", before: {} })),
    };
    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };

    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no embedded before payload/i);
  });
});
