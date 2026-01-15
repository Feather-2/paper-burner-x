import { describe, it, expect, vi, afterEach } from "vitest";

async function importCheckpoints({
  computeSha256Impl,
  createUnifiedDiffAsyncImpl,
  makeSecureTimestampedIdImpl,
} = {}) {
  vi.resetModules();

  const computeSha256 =
    computeSha256Impl ||
    vi.fn(async (data) => {
      // Provide stable-ish digests for tests without depending on crypto subtleties.
      if (typeof data === "string") return `sha_${data}`;
      if (data instanceof Uint8Array) return `sha_${new TextDecoder().decode(data)}`;
      return "sha_unknown";
    });

  const createUnifiedDiffAsync =
    createUnifiedDiffAsyncImpl || vi.fn(async () => ({ text: "--- a\n+++ b\n@@\n-dummy\n+dummy\n" }));

  vi.doMock("../../../js/agents/storage/artifact-manager.js", () => ({ computeSha256 }));
  vi.doMock("../../../js/agents/vfs/diff.js", () => ({ createUnifiedDiffAsync }));

  if (makeSecureTimestampedIdImpl) {
    vi.doMock("../../../js/agents/shared/utils/secure-id.js", () => ({ makeSecureTimestampedId: makeSecureTimestampedIdImpl }));
  }

  const mod = await import("../../../js/agents/vfs/checkpoints.js");
  return { ...mod, computeSha256, createUnifiedDiffAsync };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unmock("../../../js/agents/storage/artifact-manager.js");
  vi.unmock("../../../js/agents/vfs/diff.js");
  vi.unmock("../../../js/agents/shared/utils/secure-id.js");
});

describe("vfs/checkpoints: recordVfsCheckpoint", () => {
  it("embeds small utf8 payloads, computes unified diff, and saves via runStore", async () => {
    const { recordVfsCheckpoint, VFS_CHECKPOINT_TYPE, createUnifiedDiffAsync } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async (_runId, type, _data) => `artifact:${type}:1`),
      getArtifactById: vi.fn(),
    };

    const { artifactId, checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "/a.txt",
      before: "hello",
      after: "hello world",
      op: "writeText",
      maxEmbedBytes: 10_000,
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

    expect(createUnifiedDiffAsync).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.txt", beforeText: "hello", afterText: "hello world", context: 3 }),
      expect.objectContaining({ useWorker: true })
    );

    expect(runStore.saveArtifact).toHaveBeenCalledWith(
      "run_1",
      VFS_CHECKPOINT_TYPE,
      expect.objectContaining({ kind: "vfs_checkpoint", path: "a.txt" }),
      expect.objectContaining({ mime: "application/json" })
    );
  });

  it("skips diff when content is unchanged (via precomputed sha256)", async () => {
    const { recordVfsCheckpoint, createUnifiedDiffAsync } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: "same",
      after: "same",
      beforeSha256: "abc",
      afterSha256: "abc",
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.diff).toBeUndefined();
    expect(checkpoint.diffPromise).toBeUndefined();
    expect(createUnifiedDiffAsync).not.toHaveBeenCalled();
  });

  it("can defer diff computation via diffPromise", async () => {
    const { recordVfsCheckpoint, createUnifiedDiffAsync } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: "a",
      after: "b",
      deferDiff: true,
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.diff).toBeUndefined();
    expect(checkpoint.diffPromise).toBeInstanceOf(Promise);
    const diff = await checkpoint.diffPromise;
    expect(diff).toEqual(expect.objectContaining({ format: "unified", context: 3, text: expect.any(String) }));
    expect(createUnifiedDiffAsync).toHaveBeenCalled();
  });

  it("treats unified diff generation as best-effort (diff is omitted when the diff helper throws)", async () => {
    const createUnifiedDiffAsync = vi.fn(async () => {
      throw new Error("diff boom");
    });
    const { recordVfsCheckpoint } = await importCheckpoints({ createUnifiedDiffAsyncImpl: createUnifiedDiffAsync });

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: "a",
      after: "b",
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.diff).toBeUndefined();
    expect(checkpoint.diffPromise).toBeUndefined();
    expect(createUnifiedDiffAsync).toHaveBeenCalled();
  });

  it("stores large binary payloads out-of-band when using runStore (payload is bytes, not base64)", async () => {
    const { recordVfsCheckpoint, VFS_PAYLOAD_TYPE, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const saveArtifact = vi.fn(async (_runId, type) => `artifact:${type}:${saveArtifact.mock.calls.length + 1}`);
    const runStore = { saveArtifact, getArtifactById: vi.fn() };

    // Contains 0 bytes -> guessIsUtf8Text() should treat as binary.
    const bigBinary = new Uint8Array(64);
    bigBinary[0] = 0;
    bigBinary[1] = 255;

    const { artifactId, checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "bin.dat",
      before: bigBinary,
      after: bigBinary,
      maxEmbedBytes: 8, // force truncation + payload refs
    });

    expect(checkpoint.before.truncated).toBe(true);
    expect(checkpoint.before.payload).toEqual(
      expect.objectContaining({ type: VFS_PAYLOAD_TYPE, encoding: "binary", bytes: bigBinary.byteLength })
    );

    // Two payload artifacts + one checkpoint artifact.
    expect(runStore.saveArtifact).toHaveBeenCalledTimes(3);
    expect(runStore.saveArtifact).toHaveBeenNthCalledWith(
      1,
      "run_1",
      VFS_PAYLOAD_TYPE,
      expect.any(Uint8Array),
      expect.objectContaining({ mime: "application/octet-stream" })
    );
    expect(artifactId).toMatch(`artifact:${VFS_CHECKPOINT_TYPE}:`);
  });

  it("uses storageAdapter local artifacts and base64 for binary payloads when truncated", async () => {
    const { recordVfsCheckpoint, VFS_PAYLOAD_TYPE, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const kv = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    const bigBinary = new Uint8Array(64);
    bigBinary[0] = 0;
    bigBinary[1] = 255;

    const { artifactId, checkpoint } = await recordVfsCheckpoint({
      storageAdapter,
      runId: "run_1",
      path: "bin.dat",
      before: bigBinary,
      after: "small",
      maxEmbedBytes: 8,
    });

    expect(artifactId).toMatch(/^pb_vfs_artifact\|/);
    expect(checkpoint.before.truncated).toBe(true);
    expect(checkpoint.before.payload?.type).toBe(VFS_PAYLOAD_TYPE);
    expect(checkpoint.after.text).toBe("small");

    // Adapter stores a base64 string for binary payloads when using local artifacts.
    const beforePayloadId = checkpoint.before.payload?.artifactId;
    expect(beforePayloadId).toMatch(new RegExp(`^pb_vfs_artifact\\|${VFS_PAYLOAD_TYPE.replace(".", "\\.")}\\|run_1\\|`));
    expect(typeof kv.get(beforePayloadId)).toBe("string");

    // And stores the checkpoint JSON object.
    expect(kv.get(artifactId)).toEqual(expect.objectContaining({ kind: "vfs_checkpoint" }));
    expect(checkpoint.before.payload?.encoding).toBe("binary");
    expect(checkpoint.after.payload).toBeUndefined();
    expect(checkpoint.after.base64).toBeUndefined();
    expect(checkpoint.after.text).toBe("small");
    expect(checkpoint.after.truncated).toBeUndefined();
    expect(checkpoint).toEqual(expect.objectContaining({ op: expect.any(String), ts: expect.any(String) }));

    // Ensure we actually created both payload + checkpoint artifacts.
    const keys = Array.from(kv.keys());
    expect(keys.some((k) => k.includes(`|${VFS_PAYLOAD_TYPE}|run_1|`))).toBe(true);
    expect(keys.some((k) => k.includes(`|${VFS_CHECKPOINT_TYPE}|run_1|`))).toBe(true);
  });

  it("embeds non-string plain objects/arrays as JSON strings", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "data.json",
      before: { a: 1 },
      after: [1, 2],
      // Avoid diff noise; we only care about payload encoding/embedding.
      skipDiff: true,
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.before.text).toBe('{"a":1}');
    expect(checkpoint.after.text).toBe("[1,2]");
    expect(checkpoint.before.preview).toBe('{"a":1}');
    expect(checkpoint.after.preview).toBe("[1,2]");
  });

  it("falls back to String() encoding for non-plain objects", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "data.txt",
      before: new Map([["a", 1]]),
      after: 123,
      skipDiff: true,
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.before.text).toBe("[object Map]");
    expect(checkpoint.after.text).toBe("123");
  });

  it("rejects a storageAdapter that is missing delete()/keys() (required for local artifact lifecycle)", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    // Looks "almost" right but fails isStorageAdapterLike() because delete/keys are required.
    const storageAdapter = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };

    await expect(
      recordVfsCheckpoint({ storageAdapter, runId: "run_1", path: "a.txt", before: "x", after: "y" })
    ).rejects.toThrow(/runStore or storageAdapter/i);
  });

  it("treats whitespace-only runId as invalid when generating local artifact keys (boundary case)", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const kv = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    await expect(
      recordVfsCheckpoint({ storageAdapter, runId: "   ", path: "a.txt", before: "x", after: "y" })
    ).rejects.toThrow(/makeLocalArtifactKey/i);
  });

  it("falls back to a non-crypto local id generator when makeSecureTimestampedId() fails", async () => {
    const makeSecureTimestampedId = vi.fn(() => {
      throw new Error("no crypto");
    });
    const { recordVfsCheckpoint } = await importCheckpoints({ makeSecureTimestampedIdImpl: makeSecureTimestampedId });

    const kv = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    const { artifactId } = await recordVfsCheckpoint({
      storageAdapter,
      runId: "run_1",
      path: "a.txt",
      before: "x",
      after: "y",
    });

    expect(makeSecureTimestampedId).toHaveBeenCalled();
    expect(artifactId).toMatch(/^pb_vfs_artifact\|/);
  });

  it("truncates preview text for long payloads", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const long = "a".repeat(300);
    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: long,
      after: long + "b",
      // Avoid diff work; preview still happens.
      skipDiff: true,
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.before.preview).toContain("...(truncated)");
    expect(checkpoint.after.preview).toContain("...(truncated)");
  });

  it("omits sha256 fields when hashing fails (best-effort)", async () => {
    const computeSha256 = vi.fn(async () => {
      throw new Error("hash boom");
    });
    const { recordVfsCheckpoint } = await importCheckpoints({ computeSha256Impl: computeSha256 });

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "a.txt",
      before: "a",
      after: "b",
      skipDiff: true,
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.before.sha256).toBeUndefined();
    expect(checkpoint.after.sha256).toBeUndefined();
    expect(computeSha256).toHaveBeenCalled();
  });

  it("treats invalid UTF-8 as binary and embeds base64 for small payloads", async () => {
    const { recordVfsCheckpoint, createUnifiedDiffAsync } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
      getArtifactById: vi.fn(),
    };

    // Invalid UTF-8 sequence (no NUL bytes) -> TextDecoder(fatal) throws -> guessIsUtf8Text() returns false.
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);

    const { checkpoint } = await recordVfsCheckpoint({
      runStore,
      runId: "run_1",
      path: "bin.dat",
      before: invalidUtf8,
      after: invalidUtf8,
      maxEmbedBytes: 10_000,
    });

    expect(checkpoint.before.preview).toBeNull();
    expect(checkpoint.after.preview).toBeNull();
    expect(checkpoint.before.base64).toMatch(/\S+/);
    expect(checkpoint.after.base64).toMatch(/\S+/);

    // Diff only applies to text payloads.
    expect(createUnifiedDiffAsync).not.toHaveBeenCalled();
  });

  it("falls back to text.length when TextEncoder fails (encodeUtf8Bytes() catch branch)", async () => {
    const originalTextEncoder = globalThis.TextEncoder;
    try {
      // Force encodeUtf8Bytes() to take the catch branch.
      vi.stubGlobal(
        "TextEncoder",
        class BrokenTextEncoder {
          encode() {
            throw new Error("no TextEncoder");
          }
        }
      );

      const { recordVfsCheckpoint } = await importCheckpoints();

      const runStore = {
        saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
        getArtifactById: vi.fn(),
      };

      // Binary payloads avoid dataToBytes() paths that would otherwise need TextEncoder.
      const bytes = new Uint8Array([0, 255, 1]);
      const { checkpoint } = await recordVfsCheckpoint({
        runStore,
        runId: "run_1",
        path: "bin.dat",
        before: bytes,
        after: bytes,
        maxEmbedBytes: 10_000,
      });

      const opts = runStore.saveArtifact.mock.calls.at(-1)?.[3];
      expect(opts?.bytes).toBe(JSON.stringify(checkpoint).length);
    } finally {
      vi.unstubAllGlobals();
      if (originalTextEncoder) globalThis.TextEncoder = originalTextEncoder;
    }
  });

  it("falls back to empty base64 when neither Buffer nor btoa is available (bytesToBase64 fallback)", async () => {
    const originalBuffer = globalThis.Buffer;
    const originalBtoa = globalThis.btoa;
    try {
      // Force the module-level `NodeBuffer` to be undefined and bypass the browser btoa path.
      vi.stubGlobal("Buffer", undefined);
      vi.stubGlobal("btoa", undefined);

      const { recordVfsCheckpoint } = await importCheckpoints();

      const runStore = {
        saveArtifact: vi.fn(async () => "artifact:ckpt:1"),
        getArtifactById: vi.fn(),
      };

      const bytes = new Uint8Array([0, 255, 1]);
      const { checkpoint } = await recordVfsCheckpoint({
        runStore,
        runId: "run_1",
        path: "bin.dat",
        before: bytes,
        after: bytes,
        maxEmbedBytes: 10_000,
      });

      expect(checkpoint.before.base64).toBe("");
      expect(checkpoint.after.base64).toBe("");
    } finally {
      vi.unstubAllGlobals();
      if (originalBuffer) globalThis.Buffer = originalBuffer;
      if (originalBtoa) globalThis.btoa = originalBtoa;
    }
  });

  it("validates required inputs", async () => {
    const { recordVfsCheckpoint } = await importCheckpoints();

    await expect(recordVfsCheckpoint({ runId: "run_1", path: "a.txt" })).rejects.toThrow(/runStore or storageAdapter/i);

    const runStore = { saveArtifact: vi.fn(), getArtifactById: vi.fn() };
    await expect(recordVfsCheckpoint({ runStore, runId: 123, path: "a.txt" })).rejects.toThrow(/runId must be a string/i);
    await expect(recordVfsCheckpoint({ runStore, runId: "run_1", path: "" })).rejects.toThrow(/path must be a non-empty/i);
  });
});

describe("vfs/checkpoints: listVfsCheckpoints", () => {
  it("returns an empty list when no runStore or storageAdapter is available", async () => {
    const { listVfsCheckpoints } = await importCheckpoints();

    await expect(listVfsCheckpoints(null, "run_1")).resolves.toEqual([]);
  });

  it("prefers listArtifactSummaries() when provided, and sorts by seq", async () => {
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
    expect(out.map((r) => r.artifactId)).toEqual(["a1", "a2"]);
  });

  it("falls back to listArtifacts() when listArtifactSummaries is not provided", async () => {
    const { listVfsCheckpoints, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(),
      listArtifacts: vi.fn(async () => [
        { artifactId: "x", type: "other", seq: 1 },
        { artifactId: "b2", type: VFS_CHECKPOINT_TYPE, seq: 2 },
        { artifactId: "b1", type: VFS_CHECKPOINT_TYPE, seq: 1 },
      ]),
    };

    const out = await listVfsCheckpoints(runStore, "run_1");
    expect(out.map((r) => r.artifactId)).toEqual(["b1", "b2"]);
  });

  it("falls back to listArtifacts() when listArtifactSummaries fails", async () => {
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
    expect(out.map((r) => r.artifactId)).toEqual(["b1", "b2"]);
  });

  it("lists checkpoint keys from a local storageAdapter", async () => {
    const { listVfsCheckpoints, VFS_CHECKPOINT_TYPE } = await importCheckpoints();

    const kv = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => [
        "not_a_checkpoint",
        // Looks like a checkpoint prefix but is malformed -> parseLocalArtifactKey() should ignore it.
        `pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_1|`,
        `pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_1|id1`,
        `pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_1|id2`,
        `pb_vfs_artifact|${VFS_CHECKPOINT_TYPE}|run_2|id3`,
      ]),
    };

    const out = await listVfsCheckpoints(null, "run_1", storageAdapter);
    expect(out.map((r) => r.id).sort()).toEqual(["id1", "id2"]);
  });
});

describe("vfs/checkpoints: restoreVfsCheckpoint", () => {
  it("restores embedded before.text via writeText()", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ path: "a.txt", encoding: "utf8", before: { text: "hello" } })),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res).toEqual({ ok: true, path: "a.txt", encoding: "utf8" });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "hello");
  });

  it("defaults encoding to utf8 when restoring embedded before.text and checkpoint.encoding is missing", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ path: "a.txt", before: { text: "hello" } })), // no encoding field
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res).toEqual({ ok: true, path: "a.txt", encoding: "utf8" });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "hello");
  });

  it("restores embedded before.base64 via writeFile()", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const base64 = Buffer.from(new Uint8Array([1, 2, 3])).toString("base64");
    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ path: "bin.dat", before: { base64 } })),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res).toEqual({ ok: true, path: "bin.dat", encoding: "binary" });
    expect(vfs.writeFile).toHaveBeenCalledWith("bin.dat", new Uint8Array([1, 2, 3]));
  });

  it("restores payload references (utf8 + binary), and falls back from runStore to storageAdapter", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const checkpointId = "ckpt_1";
    const payloadUtf8Id = "payload_utf8_1";
    const payloadBinId = "payload_bin_1";

    // runStore fails; adapter supplies both checkpoint and payloads.
    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => {
        throw new Error("nope");
      }),
    };

    const kv = new Map();
    kv.set(checkpointId, {
      path: "a.txt",
      before: { payload: { artifactId: payloadUtf8Id, encoding: "utf8" } },
    });
    kv.set(payloadUtf8Id, "hello payload");

    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, storageAdapter, artifactId: checkpointId });
    expect(res).toEqual({ ok: true, path: "a.txt", encoding: "utf8", payloadArtifactId: payloadUtf8Id });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "hello payload");

    // Now restore a binary payload stored as base64 string.
    const checkpointId2 = "ckpt_2";
    kv.set(checkpointId2, {
      path: "b.bin",
      before: { payload: { artifactId: payloadBinId, encoding: "binary" } },
    });
    kv.set(payloadBinId, Buffer.from([4, 5]).toString("base64"));

    const res2 = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: checkpointId2 });
    expect(res2).toEqual({ ok: true, path: "b.bin", encoding: "binary", payloadArtifactId: payloadBinId });
    expect(vfs.writeFile).toHaveBeenCalledWith("b.bin", new Uint8Array([4, 5]));
  });

  it("treats non-string payload encoding as binary (payload encoding validation branch)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const checkpointId = "ckpt_bad_enc";
    const payloadId = "payload_bad_enc";

    const kv = new Map();
    kv.set(checkpointId, {
      path: "b.bin",
      before: { payload: { artifactId: payloadId, encoding: 123 } }, // non-string -> treated as ""
    });
    kv.set(payloadId, Buffer.from([4, 5]).toString("base64"));

    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: checkpointId });
    expect(res).toEqual({ ok: true, path: "b.bin", encoding: "binary", payloadArtifactId: payloadId });
    expect(vfs.writeFile).toHaveBeenCalledWith("b.bin", new Uint8Array([4, 5]));
  });

  it("restores utf8 payloads when the stored payload is bytes (non-string)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const checkpointId = "ckpt_bytes_utf8";
    const payloadId = "payload_bytes_utf8";

    const kv = new Map();
    kv.set(checkpointId, {
      path: "a.txt",
      before: { payload: { artifactId: payloadId, encoding: "utf8" } },
    });
    kv.set(payloadId, new TextEncoder().encode("hello bytes"));

    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: checkpointId });
    expect(res).toEqual({ ok: true, path: "a.txt", encoding: "utf8", payloadArtifactId: payloadId });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "hello bytes");
  });

  it("restores binary payloads when the stored payload is bytes (non-string)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const checkpointId = "ckpt_bytes_bin";
    const payloadId = "payload_bytes_bin";

    const kv = new Map();
    kv.set(checkpointId, {
      path: "b.bin",
      before: { payload: { artifactId: payloadId, encoding: "binary" } },
    });
    kv.set(payloadId, new Uint8Array([7, 8, 9]));

    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: checkpointId });
    expect(res).toEqual({ ok: true, path: "b.bin", encoding: "binary", payloadArtifactId: payloadId });
    expect(vfs.writeFile).toHaveBeenCalledWith("b.bin", new Uint8Array([7, 8, 9]));
  });

  it("supports multiple payload shapes via payloadToBytes (ArrayBufferView/ArrayBuffer/Blob/primitive/string)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const kv = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => kv.get(k)),
      set: vi.fn(async (k, v) => void kv.set(k, v)),
      delete: vi.fn(async (k) => void kv.delete(k)),
      keys: vi.fn(async () => Array.from(kv.keys())),
    };

    // ArrayBuffer (utf8)
    kv.set("ckpt_ab", { path: "ab.txt", before: { payload: { artifactId: "payload_ab", encoding: "utf8" } } });
    kv.set("payload_ab", new TextEncoder().encode("ab").buffer);

    // ArrayBufferView but not Uint8Array (utf8): DataView -> Uint8Array([0x68,0x69]) -> "hi"
    const dvBuf = new ArrayBuffer(2);
    const dv = new DataView(dvBuf);
    dv.setUint8(0, 0x68);
    dv.setUint8(1, 0x69);
    kv.set("ckpt_view", { path: "view.txt", before: { payload: { artifactId: "payload_view", encoding: "utf8" } } });
    kv.set("payload_view", dv);

    // Blob (utf8)
    kv.set("ckpt_blob", { path: "blob.txt", before: { payload: { artifactId: "payload_blob", encoding: "utf8" } } });
    kv.set("payload_blob", new Blob(["blob"]));

    // Primitive -> String(value) branch (binary)
    kv.set("ckpt_num", { path: "num.bin", before: { payload: { artifactId: "payload_num", encoding: "binary" } } });
    kv.set("payload_num", 123);

    // Empty string hits payloadToBytes(string) (binary) because base64ToBytes path requires a truthy string.
    kv.set("ckpt_empty", { path: "empty.bin", before: { payload: { artifactId: "payload_empty", encoding: "binary" } } });
    kv.set("payload_empty", "");

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };

    await expect(restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_ab" })).resolves.toEqual(
      expect.objectContaining({ ok: true, path: "ab.txt", encoding: "utf8" })
    );
    await expect(restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_view" })).resolves.toEqual(
      expect.objectContaining({ ok: true, path: "view.txt", encoding: "utf8" })
    );
    await expect(restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_blob" })).resolves.toEqual(
      expect.objectContaining({ ok: true, path: "blob.txt", encoding: "utf8" })
    );
    await expect(restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_num" })).resolves.toEqual(
      expect.objectContaining({ ok: true, path: "num.bin", encoding: "binary" })
    );
    await expect(restoreVfsCheckpoint({ vfs, storageAdapter, artifactId: "ckpt_empty" })).resolves.toEqual(
      expect.objectContaining({ ok: true, path: "empty.bin", encoding: "binary" })
    );

    expect(vfs.writeText).toHaveBeenCalledWith("ab.txt", "ab");
    expect(vfs.writeText).toHaveBeenCalledWith("view.txt", "hi");
    expect(vfs.writeText).toHaveBeenCalledWith("blob.txt", "blob");

    // payloadToBytes(number) -> "123"
    expect(vfs.writeFile).toHaveBeenCalledWith("num.bin", new TextEncoder().encode("123"));
    // payloadToBytes("") -> empty
    expect(vfs.writeFile).toHaveBeenCalledWith("empty.bin", new Uint8Array(0));
  });

  it("returns ok:false when restoring payload fails", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const storageAdapter = {
      get: vi.fn(async () => {
        throw new Error("payload missing");
      }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    };

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async (id) => {
        if (id === "ckpt_1") return { path: "a.txt", before: { payload: { artifactId: "payload_1", encoding: "utf8" } } };
        throw new Error("store miss");
      }),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, storageAdapter, artifactId: "ckpt_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Failed to restore payload payload_1/i);
  });

  it("includes the thrown value when payload restore fails without an Error.message (restore failure formatting branch)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const storageAdapter = {
      get: vi.fn(async () => {
        throw "payload missing"; // non-Error -> err?.message is undefined
      }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    };

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async (id) => {
        if (id === "ckpt_1") return { path: "a.txt", before: { payload: { artifactId: "payload_1", encoding: "utf8" } } };
        throw new Error("store miss");
      }),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, storageAdapter, artifactId: "ckpt_1" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Failed to restore payload payload_1: payload missing/i);
  });

  it("covers browser base64 helpers when Buffer is unavailable (btoa/atob branches)", async () => {
    const originalBuffer = globalThis.Buffer;
    try {
      // Force the module-level `NodeBuffer` constant to be undefined.
      vi.stubGlobal("Buffer", undefined);

      const { recordVfsCheckpoint, restoreVfsCheckpoint } = await importCheckpoints();

      const kv = new Map();
      const storageAdapter = {
        get: vi.fn(async (k) => kv.get(k)),
        set: vi.fn(async (k, v) => void kv.set(k, v)),
        delete: vi.fn(async (k) => void kv.delete(k)),
        keys: vi.fn(async () => Array.from(kv.keys())),
      };

      // Small binary -> embed base64 (not payload ref).
      const smallBinary = new Uint8Array([0, 255, 1]);
      const { artifactId } = await recordVfsCheckpoint({
        storageAdapter,
        runId: "run_1",
        path: "bin.dat",
        before: smallBinary,
        after: smallBinary,
        maxEmbedBytes: 10_000,
      });

      const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
      const res = await restoreVfsCheckpoint({ vfs, storageAdapter, artifactId });
      expect(res).toEqual({ ok: true, path: "bin.dat", encoding: "binary" });
      expect(vfs.writeFile).toHaveBeenCalledWith("bin.dat", smallBinary);
    } finally {
      vi.unstubAllGlobals();
      // Ensure the original Buffer is restored even if stubGlobal couldn't.
      if (originalBuffer) globalThis.Buffer = originalBuffer;
    }
  });

  it("falls back to empty bytes when base64 decoding helpers are unavailable (base64ToBytes fallback)", async () => {
    const originalBuffer = globalThis.Buffer;
    const originalAtob = globalThis.atob;
    try {
      // Force base64ToBytes() to take the final fallback branch.
      vi.stubGlobal("Buffer", undefined);
      vi.stubGlobal("atob", undefined);

      const { restoreVfsCheckpoint } = await importCheckpoints();

      const runStore = {
        saveArtifact: vi.fn(),
        getArtifactById: vi.fn(async () => ({
          path: "bin.dat",
          before: { base64: "AAEC" }, // non-empty string so base64ToBytes() doesn't return early
        })),
      };

      const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
      const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
      expect(res).toEqual({ ok: true, path: "bin.dat", encoding: "binary" });
      expect(vfs.writeFile).toHaveBeenCalledWith("bin.dat", new Uint8Array(0));
    } finally {
      vi.unstubAllGlobals();
      if (originalBuffer) globalThis.Buffer = originalBuffer;
      if (originalAtob) globalThis.atob = originalAtob;
    }
  });

  it("falls back to an empty payload when runStore misses and no adapter is available", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async (id) => {
        if (id === "ckpt_1") return { path: "a.txt", before: { payload: { artifactId: "payload_1", encoding: "utf8" } } };
        throw new Error("missing");
      }),
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    const res = await restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" });
    expect(res).toEqual({ ok: true, path: "a.txt", encoding: "utf8", payloadArtifactId: "payload_1" });
    expect(vfs.writeText).toHaveBeenCalledWith("a.txt", "");
  });

  it("returns a clear error when checkpoint has no restorable before payload", async () => {
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

  it("validates required inputs", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    await expect(restoreVfsCheckpoint({})).rejects.toThrow(/vfs with writeFile/i);
    await expect(restoreVfsCheckpoint({ vfs: { writeFile: vi.fn() }, artifactId: "x" })).rejects.toThrow(
      /runStore or storageAdapter/i
    );
    await expect(restoreVfsCheckpoint({ vfs: { writeFile: vi.fn() }, runStore: { saveArtifact: vi.fn(), getArtifactById: vi.fn() } })).rejects.toThrow(
      /artifactId must be a non-empty string/i
    );
  });

  it("throws when the checkpoint artifact is missing a usable path (restore failure path)", async () => {
    const { restoreVfsCheckpoint } = await importCheckpoints();

    const runStore = {
      saveArtifact: vi.fn(),
      getArtifactById: vi.fn(async () => ({ before: { text: "hello" } })), // missing path
    };

    const vfs = { writeFile: vi.fn(async () => true), writeText: vi.fn(async () => true) };
    await expect(restoreVfsCheckpoint({ vfs, runStore, artifactId: "ckpt_1" })).rejects.toThrow(/checkpoint missing path/i);
  });
});
