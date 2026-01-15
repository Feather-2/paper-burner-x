import { describe, it, expect, vi, afterEach } from "vitest";

async function importDeltaSync() {
  vi.resetModules();

  const loggerInfo = vi.fn();
  const createLogger = vi.fn(() => ({
    info: loggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }));

  vi.doMock("../../../js/agents/shared/utils/logger.js", () => ({ createLogger }));

  const mod = await import("../../../js/agents/vfs/delta-sync.js");
  return { ...mod, loggerInfo, createLogger };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unmock("../../../js/agents/shared/utils/logger.js");
});

describe("vfs/delta-sync: computeHash", () => {
  it("computes SHA-256 (crypto.subtle) and falls back to FNV-1a when digest fails", async () => {
    const { computeHash } = await importDeltaSync();

    // SHA-256 branch (should be 64 hex chars).
    const h1 = await computeHash("hello");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);

    // Force fallback for a single call.
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(new Error("boom"));
    const h2 = await computeHash("hello");
    expect(h2).toMatch(/^[0-9a-f]{8}$/);
    spy.mockRestore();

    // Supports bytes input types.
    const bytes = new Uint8Array([1, 2, 3]);
    const h3 = await computeHash(bytes);
    expect(h3).toMatch(/^[0-9a-f]{64}$/);
    const h4 = await computeHash(bytes.buffer);
    expect(h4).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid input types", async () => {
    const { computeHash } = await importDeltaSync();
    // @ts-expect-error - invalid on purpose
    await expect(computeHash({})).rejects.toThrow(TypeError);
  });
});

describe("vfs/delta-sync: manifest/delta/conflicts", () => {
  it("buildManifest hashes and sizes files with deterministic timestamps when time is mocked", async () => {
    const { buildManifest } = await importDeltaSync();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));

    const manifest = await buildManifest([
      { path: "a.txt", content: "hi", mtime: 123 },
      { path: "b.bin", content: new Uint8Array([1, 2, 3]) },
    ]);

    expect(manifest.id).toMatch(/^manifest_/);
    expect(manifest.ts).toBe(Date.now());

    const a = manifest.files.get("a.txt");
    expect(a).toEqual(expect.objectContaining({ path: "a.txt", mtime: 123 }));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.size).toBe(new TextEncoder().encode("hi").length);

    const b = manifest.files.get("b.bin");
    expect(b).toEqual(expect.objectContaining({ path: "b.bin", mtime: Date.now() }));
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.size).toBe(3);
  });

  it("computeDelta reports add/modify/delete", async () => {
    const { computeDelta } = await importDeltaSync();

    const base = {
      id: "base",
      ts: 0,
      files: new Map([
        ["a.txt", { path: "a.txt", hash: "h1", size: 1, mtime: 1 }],
        ["b.txt", { path: "b.txt", hash: "h2", size: 1, mtime: 1 }],
      ]),
    };
    const target = {
      id: "target",
      ts: 0,
      files: new Map([
        ["a.txt", { path: "a.txt", hash: "h1_changed", size: 2, mtime: 2 }],
        ["c.txt", { path: "c.txt", hash: "h3", size: 3, mtime: 3 }],
      ]),
    };

    expect(computeDelta(base, target)).toEqual(
      expect.arrayContaining([
        { path: "c.txt", type: "add", hash: "h3", size: 3 },
        { path: "a.txt", type: "modify", hash: "h1_changed", size: 2 },
        { path: "b.txt", type: "delete" },
      ])
    );
  });

  it("detectConflicts flags modify-vs-modify (different hash) and delete-vs-modify", async () => {
    const { detectConflicts } = await importDeltaSync();

    const localDelta = [
      { path: "a.txt", type: "modify", hash: "h_local", size: 1 },
      { path: "b.txt", type: "delete" },
    ];
    const remoteDelta = [
      { path: "a.txt", type: "modify", hash: "h_remote", size: 1 },
      { path: "b.txt", type: "modify", hash: "h_remote2", size: 1 },
    ];

    const conflicts = detectConflicts(localDelta, remoteDelta);
    expect(conflicts.map((c) => c.path).sort()).toEqual(["a.txt", "b.txt"]);

    // Same hash should not conflict.
    expect(detectConflicts([{ path: "x", type: "modify", hash: "same" }], [{ path: "x", type: "modify", hash: "same" }])).toEqual(
      []
    );
  });

  it("resolveConflicts applies strategies", async () => {
    const { resolveConflicts, ConflictStrategy } = await importDeltaSync();

    const conflicts = [
      { path: "a.txt", local: { path: "a.txt", type: "modify" }, remote: { path: "a.txt", type: "modify" } },
    ];

    const localManifest = { files: new Map([["a.txt", { mtime: 10 }]]) };
    const remoteManifest = { files: new Map([["a.txt", { mtime: 5 }]]) };

    expect(resolveConflicts(conflicts, ConflictStrategy.LOCAL_WINS, localManifest, remoteManifest)[0].resolution).toBe("local");
    expect(resolveConflicts(conflicts, ConflictStrategy.REMOTE_WINS, localManifest, remoteManifest)[0].resolution).toBe("remote");
    expect(resolveConflicts(conflicts, ConflictStrategy.NEWER_WINS, localManifest, remoteManifest)[0].resolution).toBe("local");

    const remoteNewer = { files: new Map([["a.txt", { mtime: 999 }]]) };
    expect(resolveConflicts(conflicts, ConflictStrategy.NEWER_WINS, localManifest, remoteNewer)[0].resolution).toBe("remote");

    expect(resolveConflicts(conflicts, "unknown", localManifest, remoteManifest)[0].resolution).toBe("manual");
  });
});

describe("vfs/delta-sync: DeltaSyncSession", () => {
  it("requires local+remote manifests before computing a plan", async () => {
    const { DeltaSyncSession } = await importDeltaSync();
    const s = new DeltaSyncSession();
    expect(() => s.computeSyncPlan()).toThrow(/Both local and remote manifests required/i);
  });

  it("computes upload/download plan, supports custom onConflict, and logs counts", async () => {
    const { DeltaSyncSession, ConflictStrategy, loggerInfo } = await importDeltaSync();

    const base = {
      id: "base",
      ts: 0,
      files: new Map([["a.txt", { path: "a.txt", hash: "h0", size: 1, mtime: 1 }]]),
    };
    const local = {
      id: "local",
      ts: 0,
      files: new Map([["a.txt", { path: "a.txt", hash: "h_local", size: 1, mtime: 10 }]]),
    };
    const remote = {
      id: "remote",
      ts: 0,
      files: new Map([["a.txt", { path: "a.txt", hash: "h_remote", size: 1, mtime: 5 }]]),
    };

    const onConflict = vi.fn((conflicts) => conflicts.map((c) => ({ ...c, resolution: "local" })));

    const session = new DeltaSyncSession({ conflictStrategy: ConflictStrategy.REMOTE_WINS, onConflict });
    session.setBaseManifest(base);
    session.setLocalManifest(local);
    session.setRemoteManifest(remote);

    const plan = session.computeSyncPlan();
    expect(onConflict).toHaveBeenCalled();
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].resolution).toBe("local");
    expect(plan.toUpload).toEqual([{ path: "a.txt", type: "modify", hash: "h_local", size: 1 }]);
    expect(plan.toDownload).toEqual([]);

    expect(loggerInfo).toHaveBeenCalledWith(
      "Sync plan computed",
      expect.objectContaining({ toUpload: 1, toDownload: 0, conflicts: 0 })
    );
  });

  it("defaults to NEWER_WINS strategy when conflicts are not handled manually", async () => {
    const { DeltaSyncSession } = await importDeltaSync();

    const base = { id: "base", ts: 0, files: new Map() };
    const local = { id: "local", ts: 0, files: new Map([["a.txt", { path: "a.txt", hash: "h1", size: 1, mtime: 1 }]]) };
    const remote = { id: "remote", ts: 0, files: new Map([["a.txt", { path: "a.txt", hash: "h2", size: 1, mtime: 999 }]]) };

    const session = new DeltaSyncSession();
    session.setBaseManifest(base);
    session.setLocalManifest(local);
    session.setRemoteManifest(remote);

    const plan = session.computeSyncPlan();
    expect(plan.toDownload).toEqual([{ path: "a.txt", type: "add", hash: "h2", size: 1 }]);
    expect(plan.toUpload).toEqual([]);
    expect(plan.conflicts[0].resolution).toBe("remote");
  });

  it("_reportProgress computes percent and calls onProgress when configured", async () => {
    const { DeltaSyncSession } = await importDeltaSync();

    const onProgress = vi.fn();
    const s = new DeltaSyncSession({ onProgress });
    s._reportProgress("phase", 1, 4);

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "phase", current: 1, total: 4, percent: 25 }));
  });
});

