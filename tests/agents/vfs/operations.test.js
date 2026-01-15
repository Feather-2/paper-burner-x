import { describe, it, expect, vi, afterEach } from "vitest";

async function importOperations({ recordVfsCheckpointImpl } = {}) {
  vi.resetModules();

  const recordVfsCheckpoint =
    recordVfsCheckpointImpl ||
    vi.fn(async () => ({
      artifactId: "ckpt_1",
      checkpoint: { kind: "vfs_checkpoint" },
    }));

  // operations.js imports recordVfsCheckpoint from ./checkpoints.js; mock it here so we can
  // assert calls without pulling in diff/storage dependencies.
  vi.doMock("../../../js/agents/vfs/checkpoints.js", () => ({ recordVfsCheckpoint }));

  const mod = await import("../../../js/agents/vfs/operations.js");
  return { ...mod, recordVfsCheckpoint };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unmock("../../../js/agents/vfs/checkpoints.js");
});

describe("vfs/operations: writeTextFileWithPolicy", () => {
  it("writes, records checkpoint, and emits policy + checkpoint metadata", async () => {
    const { writeTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "before"),
      writeText: vi.fn(async () => true),
    };
    const policy = {
      authorize: vi.fn(async () => ({ allowed: true, reason: "ok" })),
    };
    const emit = vi.fn();
    const runStore = { some: "store" };

    const res = await writeTextFileWithPolicy({
      vfs,
      path: "/a/b.txt",
      text: "hi",
      policy,
      runStore,
      runId: "run_1",
      stageApi: { emit },
    });

    expect(res).toEqual({
      ok: true,
      path: "a/b.txt",
      checkpoint: { artifactId: "ckpt_1", type: "vfs_checkpoint.json" },
    });

    expect(policy.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "vfs.write",
        tool: "vfs.writeText",
        resource: "a/b.txt",
        args: { path: "a/b.txt", bytes: 2 },
      }),
      expect.any(Object)
    );

    expect(vfs.writeText).toHaveBeenCalledWith("a/b.txt", "hi");
    expect(recordVfsCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        runStore,
        runId: "run_1",
        path: "a/b.txt",
        before: "before",
        after: "hi",
        op: "writeText",
      })
    );

    expect(emit).toHaveBeenCalledWith(
      "vfs.write.completed",
      expect.objectContaining({
        path: "a/b.txt",
        bytes: 2,
        checkpoint: { artifactId: "ckpt_1", type: "vfs_checkpoint.json" },
        policy: { allowed: true, reason: "ok" },
      })
    );
  });

  it("throws when vfs.writeText is missing", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    await expect(writeTextFileWithPolicy({ path: "a.txt", text: "x" })).rejects.toThrow(/vfs\.writeText is required/i);
  });

  it("throws when path is empty", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };

    await expect(writeTextFileWithPolicy({ vfs, path: "", text: "x", checkpoint: false })).rejects.toThrow(
      /path must be a non-empty VFS path/i
    );
  });

  it("stringifies non-string text values (nullish -> '' and numbers -> '123')", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };

    await writeTextFileWithPolicy({ vfs, path: "a.txt", text: null, checkpoint: false });
    await writeTextFileWithPolicy({ vfs, path: "b.txt", text: 123, checkpoint: false });

    expect(vfs.writeText).toHaveBeenNthCalledWith(1, "a.txt", "");
    expect(vfs.writeText).toHaveBeenNthCalledWith(2, "b.txt", "123");
  });

  it("records checkpoints via stageApi.storageAdapter when runStore is omitted", async () => {
    const { writeTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    const storageAdapter = { kind: "adapter" };
    const vfs = {
      readText: vi.fn(async () => "before"),
      writeText: vi.fn(async () => true),
    };

    const res = await writeTextFileWithPolicy({
      vfs,
      path: "a.txt",
      text: "after",
      runId: "run_1",
      stageApi: { storageAdapter },
      checkpoint: true,
    });

    expect(res).toEqual({ ok: true, path: "a.txt", checkpoint: { artifactId: "ckpt_1", type: "vfs_checkpoint.json" } });
    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ storageAdapter }));
  });

  it("rejects when policy denies", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "before"),
      writeText: vi.fn(async () => true),
    };
    const policy = {
      authorize: vi.fn(async () => ({ allowed: false, reason: "nope" })),
    };

    await expect(
      writeTextFileWithPolicy({ vfs, path: "a.txt", text: "x", policy, runId: "run_1", runStore: {} })
    ).rejects.toThrow("Policy denied: nope");
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("rejects when policy denies without a string reason (defaults to 'denied')", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "before"),
      writeText: vi.fn(async () => true),
    };
    const policy = {
      authorize: vi.fn(async () => ({ allowed: false, reason: { code: "nope" } })),
    };

    await expect(writeTextFileWithPolicy({ vfs, path: "a.txt", text: "x", policy })).rejects.toThrow("Policy denied: denied");
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("omits policy metadata from the emitted payload when authorize() returns a non-plain object", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "before"),
      writeText: vi.fn(async () => true),
    };
    const policy = {
      // Non-plain objects should not be echoed into the event payload.
      authorize: vi.fn(async () => []),
    };
    const emit = vi.fn();

    await writeTextFileWithPolicy({ vfs, path: "a.txt", text: "x", policy, stageApi: { emit }, checkpoint: false });

    expect(emit).toHaveBeenCalledWith(
      "vfs.write.completed",
      expect.objectContaining({
        path: "a.txt",
        bytes: 1,
      })
    );

    const payload = emit.mock.calls[0][1];
    expect(payload.policy).toBeUndefined();
  });

  it("ignores checkpoint failures and still emits completion", async () => {
    const recordFail = vi.fn(async () => {
      throw new Error("checkpoint boom");
    });
    const { writeTextFileWithPolicy } = await importOperations({ recordVfsCheckpointImpl: recordFail });

    const vfs = {
      readText: vi.fn(async () => "before"),
      writeText: vi.fn(async () => true),
    };
    const emit = vi.fn();

    const res = await writeTextFileWithPolicy({
      vfs,
      path: "a.txt",
      text: "x",
      runId: "run_1",
      runStore: {},
      stageApi: { emit },
    });

    expect(res).toEqual({ ok: true, path: "a.txt" });
    expect(emit).toHaveBeenCalledWith("vfs.write.completed", expect.objectContaining({ path: "a.txt", bytes: 1 }));
  });

  it("falls back to readFile() when readText() is unavailable", async () => {
    const { writeTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    const vfs = {
      readFile: vi.fn(async () => new TextEncoder().encode("before")),
      writeText: vi.fn(async () => true),
    };

    await writeTextFileWithPolicy({
      vfs,
      path: "a.txt",
      text: "after",
      runId: "run_1",
      runStore: {},
      checkpoint: true,
    });

    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ before: "before", after: "after" }));
  });

  it("uses an empty string for checkpoint.before when the file cannot be read (safeReadText returns null)", async () => {
    const { writeTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      writeText: vi.fn(async () => true),
    };

    await writeTextFileWithPolicy({
      vfs,
      path: "a.txt",
      text: "after",
      runId: "run_1",
      runStore: {},
      checkpoint: true,
    });

    expect(recordVfsCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        before: "",
        after: "after",
      })
    );
  });

  it("uses an empty string for checkpoint.before when readFile() throws (safeReadText returns null)", async () => {
    const { writeTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    const vfs = {
      // No readText() -> safeReadText() falls back to readFile().
      readFile: vi.fn(async () => {
        throw new Error("boom");
      }),
      writeText: vi.fn(async () => true),
    };

    await writeTextFileWithPolicy({
      vfs,
      path: "a.txt",
      text: "after",
      runId: "run_1",
      runStore: {},
      checkpoint: true,
    });

    expect(recordVfsCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        before: "",
        after: "after",
      })
    );
  });

  it("serializes writes per (vfs,path) so a second writer waits for the lock", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    /** @type {(() => void) | null} */
    let releaseFirstWrite = null;
    const firstWriteGate = new Promise((resolve) => {
      releaseFirstWrite = resolve;
    });

    /** @type {(() => void) | null} */
    let onFirstWriteStart = null;
    const firstWriteStarted = new Promise((resolve) => {
      onFirstWriteStart = resolve;
    });

    let writeCalls = 0;
    const vfs = {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => {
        writeCalls += 1;
        if (writeCalls === 1) {
          onFirstWriteStart?.();
          await firstWriteGate;
        }
        return true;
      }),
    };

    const p1 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "1", checkpoint: false });
    await firstWriteStarted;

    const p2 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "2", checkpoint: false });

    // Give p2 a chance to queue behind the per-path lock. It should not invoke vfs.writeText yet.
    await Promise.resolve();
    expect(vfs.writeText).toHaveBeenCalledTimes(1);

    releaseFirstWrite?.();

    await expect(p1).resolves.toEqual({ ok: true, path: "a.txt" });
    await expect(p2).resolves.toEqual({ ok: true, path: "a.txt" });

    expect(vfs.writeText).toHaveBeenCalledTimes(2);
    expect(vfs.writeText.mock.calls[0][1]).toBe("1");
    expect(vfs.writeText.mock.calls[1][1]).toBe("2");
  });

  it("serializes writes per (vfs,path) and supports abort while waiting on a lock", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    /** @type {(() => void) | null} */
    let releaseFirstWrite = null;
    const firstWriteGate = new Promise((resolve) => {
      releaseFirstWrite = resolve;
    });

    const vfs = {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => {
        // Hold the first writer so the second call has to wait on the per-path lock.
        await firstWriteGate;
        return true;
      }),
    };

    const p1 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "1", checkpoint: false });

    const ac = new AbortController();
    const p2 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "2", checkpoint: false, signal: ac.signal });
    ac.abort();

    await expect(p2).rejects.toThrow(/aborted/i);

    releaseFirstWrite?.();
    await expect(p1).resolves.toEqual({ ok: true, path: "a.txt" });
  });

  it("supports abort while waiting on a lock via stageApi.signal (when no explicit signal is provided)", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    /** @type {(() => void) | null} */
    let releaseFirstWrite = null;
    const firstWriteGate = new Promise((resolve) => {
      releaseFirstWrite = resolve;
    });

    const vfs = {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => {
        // Hold the first writer so the second call has to wait on the per-path lock.
        await firstWriteGate;
        return true;
      }),
    };

    const p1 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "1", checkpoint: false });

    const ac = new AbortController();
    const p2 = writeTextFileWithPolicy({
      vfs,
      path: "a.txt",
      text: "2",
      checkpoint: false,
      stageApi: { signal: ac.signal },
    });
    ac.abort();

    await expect(p2).rejects.toThrow(/aborted/i);

    releaseFirstWrite?.();
    await expect(p1).resolves.toEqual({ ok: true, path: "a.txt" });
  });

  it("supports abort signals whose removeEventListener throws (cleanup is best-effort)", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    /** @type {(() => void) | null} */
    let releaseFirstWrite = null;
    const firstWriteGate = new Promise((resolve) => {
      releaseFirstWrite = resolve;
    });

    /** @type {(() => void) | null} */
    let onFirstWriteStart = null;
    const firstWriteStarted = new Promise((resolve) => {
      onFirstWriteStart = resolve;
    });

    let writeCalls = 0;
    const vfs = {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async () => {
        writeCalls += 1;
        if (writeCalls === 1) {
          onFirstWriteStart?.();
          await firstWriteGate;
        }
        return true;
      }),
    };

    const p1 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "1", checkpoint: false });
    await firstWriteStarted;

    /** @type {null | (() => void)} */
    let abortHandler = null;
    const signal = {
      aborted: false,
      reason: "stop",
      addEventListener: vi.fn((type, cb) => {
        if (type === "abort") abortHandler = cb;
      }),
      removeEventListener: vi.fn(() => {
        throw new Error("removeEventListener failed");
      }),
    };

    const p2 = writeTextFileWithPolicy({ vfs, path: "a.txt", text: "2", checkpoint: false, signal });

    expect(abortHandler).not.toBeNull();

    // Abort while p2 is waiting on the per-path lock. waitFor() should ignore removeEventListener failures.
    signal.aborted = true;
    abortHandler?.();

    await expect(p2).rejects.toThrow("stop");
    expect(signal.removeEventListener).toHaveBeenCalled();
    expect(vfs.writeText).toHaveBeenCalledTimes(1); // only the first writer ran

    releaseFirstWrite?.();
    await expect(p1).resolves.toEqual({ ok: true, path: "a.txt" });
  });

  it("rejects immediately when signal is already aborted", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };
    const ac = new AbortController();
    ac.abort("stop");

    await expect(writeTextFileWithPolicy({ vfs, path: "a.txt", text: "x", checkpoint: false, signal: ac.signal })).rejects.toThrow(
      "stop"
    );
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("rejects immediately when signal is already aborted and reason is not a string (defaults to 'aborted')", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };
    const ac = new AbortController();
    ac.abort();

    await expect(
      writeTextFileWithPolicy({ vfs, path: "a.txt", text: "x", checkpoint: false, signal: ac.signal })
    ).rejects.toThrow(/aborted/i);
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("releases per-path lock entries on normal completion", async () => {
    const { writeTextFileWithPolicy } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };

    await writeTextFileWithPolicy({ vfs, path: "a.txt", text: "1", checkpoint: false });
    await writeTextFileWithPolicy({ vfs, path: "a.txt", text: "2", checkpoint: false });

    expect(vfs.writeText).toHaveBeenCalledTimes(2);
  });
});

describe("vfs/operations: multiEditTextFileWithPolicy", () => {
  it("applies edits, records checkpoint, and emits via stageApi.eventBus.emit()", async () => {
    const { multiEditTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    let current = "hello world";
    const vfs = {
      readText: vi.fn(async () => current),
      writeText: vi.fn(async (_path, text) => {
        current = text;
        return true;
      }),
    };

    const policy = { authorize: vi.fn(async () => ({ allowed: true })) };
    const eventBusEmit = vi.fn();

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: "/a.txt",
      edits: [{ old_string: "world", new_string: "there" }],
      policy,
      runId: "run_1",
      runStore: {},
      stageApi: { eventBus: { emit: eventBusEmit } },
    });

    expect(res.ok).toBe(true);
    expect(res.path).toBe("a.txt");
    expect(current).toBe("hello there");
    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ op: "multi_edit", before: "hello world" }));
    expect(eventBusEmit).toHaveBeenCalledWith(
      "vfs.write.completed",
      expect.objectContaining({ path: "a.txt", bytes: "hello there".length })
    );
  });

  it("errors when file is missing (safeReadText returns null)", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "x", new_string: "y" }],
      })
    ).rejects.toThrow(/file not found/i);
  });

  it("throws when vfs.writeText is missing", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    await expect(multiEditTextFileWithPolicy({ path: "a.txt", edits: [{ old_string: "x", new_string: "y" }] })).rejects.toThrow(
      /vfs\.writeText is required/i
    );
  });

  it("throws when path is empty", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };
    await expect(multiEditTextFileWithPolicy({ vfs, path: "", edits: [{ old_string: "x", new_string: "y" }] })).rejects.toThrow(
      /path must be a non-empty VFS path/i
    );
  });

  it("errors when edits is not an array", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello"),
      writeText: vi.fn(async () => true),
    };

    await expect(multiEditTextFileWithPolicy({ vfs, path: "a.txt", edits: null })).rejects.toThrow(/edits must be a non-empty array/i);
  });

  it("accepts oldString/newString camelCase edit keys", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    let current = "hello world";
    const vfs = {
      readText: vi.fn(async () => current),
      writeText: vi.fn(async (_path, text) => {
        current = text;
        return true;
      }),
    };

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: "a.txt",
      edits: [{ oldString: "world", newString: "there" }],
      checkpoint: false,
    });

    expect(res).toEqual({ ok: true, path: "a.txt" });
    expect(current).toBe("hello there");
  });

  it("supports whitespace/indentation-normalized matching and can short-circuit to noOp", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const before = ["header", "  function x() {", "    return 1;", "  }", "footer"].join("\n");
    const vfs = {
      readText: vi.fn(async () => before),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: true })) };

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: "a.txt",
      edits: [
        {
          // Same block but with different common indent. normalizeBlockText() should match it.
          old_string: ["    function x() {", "      return 1;", "    }"].join("\n"),
          // Equal to the block in the file -> after === before -> noOp.
          // NOTE: the matched slice includes the trailing newline after the closing brace line.
          new_string: ["  function x() {", "    return 1;", "  }"].join("\n") + "\n",
        },
      ],
      policy,
    });

    expect(res).toEqual({ ok: true, path: "a.txt", noOp: true });
    expect(vfs.writeText).not.toHaveBeenCalled();
    expect(policy.authorize).not.toHaveBeenCalled();
  });

  it("reuses the per-call file index cache when multiple edits require normalized matching", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    let current = [
      "header",
      "  function a() {",
      "    return 1;",
      "  }",
      "  function b() {",
      "    return 2;",
      "  }",
      "footer",
    ].join("\n");

    const vfs = {
      readText: vi.fn(async () => current),
      writeText: vi.fn(async (_path, text) => {
        current = text;
        return true;
      }),
    };

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: "a.txt",
      edits: [
        {
          old_string: ["    function a() {", "      return 1;", "    }"].join("\n"),
          new_string: ["  function a() {", "    return 10;", "  }"].join("\n") + "\n",
        },
        {
          old_string: ["    function b() {", "      return 2;", "    }"].join("\n"),
          new_string: ["  function b() {", "    return 20;", "  }"].join("\n") + "\n",
        },
      ],
      checkpoint: false,
    });

    expect(res).toEqual({ ok: true, path: "a.txt" });
    expect(current).toContain("return 10;");
    expect(current).toContain("return 20;");
  });

  it("rejects when policy denies without a string reason (defaults to 'denied')", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello world"),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: false, reason: { code: "nope" } })) };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "world", new_string: "there" }],
        policy,
      })
    ).rejects.toThrow("Policy denied: denied");
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("rejects when policy denies with a string reason", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello world"),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: false, reason: "nope" })) };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "world", new_string: "there" }],
        policy,
      })
    ).rejects.toThrow("Policy denied: nope");
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("emits completion without checkpoint metadata when checkpointing is disabled", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    let current = "hello world";
    const vfs = {
      readText: vi.fn(async () => current),
      writeText: vi.fn(async (_path, text) => {
        current = text;
        return true;
      }),
    };
    const emit = vi.fn();
    const policy = { authorize: vi.fn(async () => []) };

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: "a.txt",
      edits: [{ old_string: "world", new_string: "there" }],
      policy,
      checkpoint: false,
      stageApi: { emit },
    });

    expect(res).toEqual({ ok: true, path: "a.txt" });
    expect(current).toBe("hello there");

    const payload = emit.mock.calls[0][1];
    expect(payload.checkpoint).toBeUndefined();
    expect(payload.policy).toBeUndefined();
  });

  it("records checkpoints via stageApi.storageAdapter when runStore is omitted", async () => {
    const { multiEditTextFileWithPolicy, recordVfsCheckpoint } = await importOperations();

    const storageAdapter = { kind: "adapter" };
    const vfs = {
      readText: vi.fn(async () => "hello world"),
      writeText: vi.fn(async () => true),
    };
    const policy = { authorize: vi.fn(async () => ({ allowed: true })) };

    const res = await multiEditTextFileWithPolicy({
      vfs,
      path: "a.txt",
      edits: [{ old_string: "world", new_string: "there" }],
      policy,
      runId: "run_1",
      stageApi: { storageAdapter },
    });

    expect(res).toEqual({ ok: true, path: "a.txt", checkpoint: { artifactId: "ckpt_1", type: "vfs_checkpoint.json" } });
    expect(recordVfsCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ storageAdapter }));
  });

  it("errors when an edit's old_string is not found (and no unique normalized match exists)", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello world"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "missing", new_string: "present" }],
      })
    ).rejects.toThrow(/not found \(exact\)/i);
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("errors when an edit's old_string is non-unique (and no unique normalized match exists)", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => ["foo", "foo", ""].join("\n")),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "foo", new_string: "bar" }],
      })
    ).rejects.toThrow(/found 2 times/i);
    expect(vfs.writeText).not.toHaveBeenCalled();
  });

  it("errors when edits is empty", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello"),
      writeText: vi.fn(async () => true),
    };

    await expect(multiEditTextFileWithPolicy({ vfs, path: "a.txt", edits: [] })).rejects.toThrow(/edits must be a non-empty array/i);
  });

  it("errors when an edit has an empty old_string", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "", new_string: "x" }],
      })
    ).rejects.toThrow(/old_string must be a non-empty string/i);
  });

  it("errors when an edit is a no-op (old_string equals new_string)", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "hello", new_string: "hello" }],
      })
    ).rejects.toThrow(/no-op/i);
  });

  it("errors when duplicate old_string values are provided", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "hello world"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [
          { old_string: "world", new_string: "there" },
          { old_string: "world", new_string: "planet" },
        ],
      })
    ).rejects.toThrow(/duplicate old_string/i);
  });

  it("detects overlapping edit ranges", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "abcde"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [
          { old_string: "abc", new_string: "xxx" },
          { old_string: "bcd", new_string: "yyy" },
        ],
      })
    ).rejects.toThrow(/overlap/i);
  });

  it("detects dependency conflicts (new_string contains another edit's old_string)", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "foo baz"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [
          { old_string: "foo", new_string: "baz" },
          { old_string: "baz", new_string: "qux" },
        ],
      })
    ).rejects.toThrow(/contains/i);
  });

  it("detects dependency conflicts when a later edit's new_string contains an earlier edit's old_string", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const vfs = {
      readText: vi.fn(async () => "foo baz"),
      writeText: vi.fn(async () => true),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [
          { old_string: "foo", new_string: "bar" },
          { old_string: "baz", new_string: "foo" },
        ],
      })
    ).rejects.toThrow(/contains/i);
  });

  it("rolls back on write failure (best-effort) and rethrows the original error", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const before = "hello world";
    const after = "hello there";

    const vfs = {
      readText: vi.fn(async () => before),
      writeText: vi.fn(async (_path, text) => {
        if (text === after) throw new Error("fail write");
        return true;
      }),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "world", new_string: "there" }],
      })
    ).rejects.toThrow("fail write");

    // First attempt writes `after` (fails), second writes `before` (rollback attempt).
    expect(vfs.writeText).toHaveBeenCalledTimes(2);
    expect(vfs.writeText).toHaveBeenNthCalledWith(2, "a.txt", before);
  });

  it("rethrows the original write error even if the rollback write fails", async () => {
    const { multiEditTextFileWithPolicy } = await importOperations();

    const before = "hello world";
    const after = "hello there";

    const vfs = {
      readText: vi.fn(async () => before),
      writeText: vi.fn(async (_path, text) => {
        if (text === after) throw new Error("fail write");
        throw new Error("rollback failed");
      }),
    };

    await expect(
      multiEditTextFileWithPolicy({
        vfs,
        path: "a.txt",
        edits: [{ old_string: "world", new_string: "there" }],
      })
    ).rejects.toThrow("fail write");

    expect(vfs.writeText).toHaveBeenCalledTimes(2);
    expect(vfs.writeText).toHaveBeenNthCalledWith(2, "a.txt", before);
  });
});

describe("vfs/operations: atomicWrite*", () => {
  it("atomicWriteText uses temp file + rename when supported", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => {
        if (!store.has(p)) throw new Error("ENOENT");
        return store.get(p);
      }),
      rename: vi.fn(async (from, to) => {
        store.set(to, store.get(from));
        store.delete(from);
      }),
    };

    const res = await atomicWriteText(vfs, "/a/b.txt", "content");
    expect(res).toEqual({ ok: true, path: "a/b.txt" });

    const tempPath = vfs.writeText.mock.calls[0][0];
    expect(String(tempPath)).toMatch(/^a\/b\.txt\.tmp_/);
    expect(vfs.rename).toHaveBeenCalledWith(tempPath, "a/b.txt");
    expect(store.get("a/b.txt")).toBe("content");
    expect(store.has(tempPath)).toBe(false);
  });

  it("atomicWriteText falls back to delete+rewrite when rename is unavailable", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map([["a.txt", "old"]]);
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => {
        if (!store.has(p)) throw new Error("ENOENT");
        return store.get(p);
      }),
      exists: vi.fn(async (p) => store.has(p)),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "new");
    expect(res).toEqual({ ok: true, path: "a.txt" });

    // Old file should be overwritten with new content.
    expect(store.get("a.txt")).toBe("new");
    expect(vfs.delete).toHaveBeenCalled(); // best-effort cleanup
  });

  it("atomicWriteText fallback path skips deleting the old file when exists() returns false", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => {
        if (!store.has(p)) throw new Error("ENOENT");
        return store.get(p);
      }),
      exists: vi.fn(async () => false),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "new");
    expect(res).toEqual({ ok: true, path: "a.txt" });

    const tempPath = vfs.writeText.mock.calls[0][0];
    expect(vfs.exists).toHaveBeenCalledWith("a.txt");
    expect(vfs.delete).not.toHaveBeenCalledWith("a.txt");
    expect(store.get("a.txt")).toBe("new");
    expect(vfs.delete).toHaveBeenCalledWith(tempPath);
  });

  it("atomicWriteText fallback path ignores delete(old) errors and still overwrites the target", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map([["a.txt", "old"]]);
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => {
        if (!store.has(p)) throw new Error("ENOENT");
        return store.get(p);
      }),
      exists: vi.fn(async (p) => store.has(p)),
      delete: vi.fn(async (p) => {
        if (p === "a.txt") throw new Error("delete failed");
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "new");
    expect(res).toEqual({ ok: true, path: "a.txt" });
    expect(store.get("a.txt")).toBe("new");
    expect(vfs.delete).toHaveBeenCalledWith("a.txt");
  });

  it("atomicWriteText fallback path ignores temp cleanup errors", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => {
        if (!store.has(p)) throw new Error("ENOENT");
        return store.get(p);
      }),
      exists: vi.fn(async () => false),
      delete: vi.fn(async (p) => {
        if (String(p).includes(".tmp_")) throw new Error("cleanup failed");
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "new");
    expect(res).toEqual({ ok: true, path: "a.txt" });
    expect(store.get("a.txt")).toBe("new");
    expect(vfs.delete).toHaveBeenCalled(); // attempted temp cleanup (ignored errors)
  });

  it("atomicWriteText returns ok:false on verification mismatch and cleans up the temp file", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      // Force safeReadText() to fail so verification sees written !== content.
      readText: vi.fn(async () => {
        throw new Error("boom");
      }),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "x", { verify: true });
    expect(res.ok).toBe(false);
    expect(res.path).toBe("a.txt");
    expect(res.error).toMatch(/verification failed/i);
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteText returns ok:false when read-back content mismatches the requested content", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      // Safe-read returns a *different* string than what was just written.
      readText: vi.fn(async () => "different"),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "expected", { verify: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/content mismatch/i);
    expect(vfs.writeText).toHaveBeenCalledTimes(1); // only temp write happened
    expect(store.has("a.txt")).toBe(false);
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteText throws when aborted before any work starts", async () => {
    const { atomicWriteText } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };
    const ac = new AbortController();
    ac.abort("stop");

    await expect(atomicWriteText(vfs, "a.txt", "x", { signal: ac.signal })).rejects.toThrow("stop");
  });

  it("atomicWriteText returns ok:false when aborted after writing the temp file (and cleans up)", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const ac = new AbortController();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        // Simulate an abort that happens after the temp write finishes.
        if (String(p).includes(".tmp_")) ac.abort("stop");
        return true;
      }),
      readText: vi.fn(async () => "should-not-be-read"),
      rename: vi.fn(async () => true),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "x", { signal: ac.signal });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/stop/i);
    expect(vfs.readText).not.toHaveBeenCalled();
    expect(vfs.rename).not.toHaveBeenCalled();
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteText returns ok:false when aborted after verification but before rename", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const ac = new AbortController();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => {
        const val = store.get(p);
        // Abort after the temp file is written and read back successfully.
        ac.abort(); // default reason is not a string -> error message should be "aborted"
        return val;
      }),
      rename: vi.fn(async () => true),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteText(vfs, "a.txt", "x", { signal: ac.signal });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/aborted/i);
    expect(vfs.rename).not.toHaveBeenCalled();
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteText uses normalizeVfsPath() (Windows separators / trimming) and rejects Windows absolute paths", async () => {
    const { atomicWriteText } = await importOperations();

    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (p, text) => {
        store.set(p, text);
        return true;
      }),
      readText: vi.fn(async (p) => store.get(p)),
      rename: vi.fn(async (from, to) => {
        store.set(to, store.get(from));
        store.delete(from);
      }),
    };

    const res = await atomicWriteText(vfs, " \\a\\b\\c.txt ", "content");
    expect(res).toEqual({ ok: true, path: "a/b/c.txt" });

    await expect(atomicWriteText(vfs, "C:\\Windows\\System32\\x.txt", "x")).rejects.toThrow(/absolute/i);
  });

  it("atomicWriteFile returns ok:false when verification fails at the end of the file", async () => {
    const { atomicWriteFile } = await importOperations();

    const bytes = new Uint8Array(2048);
    bytes.fill(1);
    const written = bytes.slice();
    written[written.length - 1] = 2; // mismatch at end

    const store = new Map();
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => {
        void p;
        return written;
      }),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteFile(vfs, "a.bin", bytes, { verify: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/content mismatch at end/i);
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteFile returns ok:false when verification fails at the start of the file", async () => {
    const { atomicWriteFile } = await importOperations();

    const bytes = new Uint8Array([1, 2, 3]);
    const written = new Uint8Array([9, 2, 3]); // mismatch at start

    const vfs = {
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => written),
      delete: vi.fn(async () => {}),
    };

    const res = await atomicWriteFile(vfs, "a.bin", bytes, { verify: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/content mismatch at start/i);
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteFile falls back to delete+rewrite when rename is unavailable", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map([["a.bin", new Uint8Array([9])]]);
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => store.get(p) || new Uint8Array()),
      exists: vi.fn(async (p) => store.has(p)),
      delete: vi.fn(async (p) => void store.delete(p)),
    };

    const res = await atomicWriteFile(vfs, "a.bin", new Uint8Array([1, 2, 3]), { verify: false });
    expect(res).toEqual({ ok: true, path: "a.bin" });

    const tempPath = vfs.writeFile.mock.calls[0][0];
    expect(String(tempPath)).toMatch(/^a\.bin\.tmp_/);
    expect(vfs.exists).toHaveBeenCalledWith("a.bin");
    expect(vfs.writeFile).toHaveBeenCalledWith("a.bin", expect.any(Uint8Array));
    expect(vfs.delete).toHaveBeenCalledWith(tempPath);
  });

  it("atomicWriteFile uses temp file + rename when supported and generates a well-formed temp name", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map();
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => {
        if (!store.has(p)) throw new Error("ENOENT");
        return store.get(p);
      }),
      rename: vi.fn(async (from, to) => {
        store.set(to, store.get(from));
        store.delete(from);
      }),
    };

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const res = await atomicWriteFile(vfs, "/a/b.bin", bytes, { verify: true });
    expect(res).toEqual({ ok: true, path: "a/b.bin" });

    const tempPath = vfs.writeFile.mock.calls[0][0];
    expect(String(tempPath)).toMatch(/^a\/b\.bin\.tmp_[0-9a-z]+_[0-9a-f]{6}$/);
    expect(vfs.rename).toHaveBeenCalledWith(tempPath, "a/b.bin");
    expect(store.get("a/b.bin")).toEqual(bytes);
    expect(store.has(tempPath)).toBe(false);
  });

  it("atomicWriteFile returns ok:false on verification size mismatch and cleans up the temp file", async () => {
    const { atomicWriteFile } = await importOperations();

    const bytes = new Uint8Array([1, 2, 3]);
    const vfs = {
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => new Uint8Array([1, 2])), // shorter than `bytes`
      delete: vi.fn(async () => {}),
    };

    const res = await atomicWriteFile(vfs, "a.bin", bytes, { verify: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/size mismatch/i);
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteFile fallback path skips deleting the old file when exists() returns false", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map();
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => store.get(p) || new Uint8Array()),
      exists: vi.fn(async () => false),
      delete: vi.fn(async (p) => void store.delete(p)),
    };

    const bytes = new Uint8Array([1, 2, 3]);
    const res = await atomicWriteFile(vfs, "a.bin", bytes, { verify: false });
    expect(res).toEqual({ ok: true, path: "a.bin" });

    const tempPath = vfs.writeFile.mock.calls[0][0];
    expect(vfs.exists).toHaveBeenCalledWith("a.bin");
    expect(vfs.delete).not.toHaveBeenCalledWith("a.bin");
    expect(store.get("a.bin")).toEqual(bytes);
    expect(vfs.delete).toHaveBeenCalledWith(tempPath);
  });

  it("atomicWriteFile fallback path ignores delete(old) errors and still overwrites the target", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map([["a.bin", new Uint8Array([9])]]);
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => store.get(p) || new Uint8Array()),
      exists: vi.fn(async (p) => store.has(p)),
      delete: vi.fn(async (p) => {
        if (p === "a.bin") throw new Error("delete failed");
        store.delete(p);
      }),
    };

    const bytes = new Uint8Array([1, 2, 3]);
    const res = await atomicWriteFile(vfs, "a.bin", bytes, { verify: false });
    expect(res).toEqual({ ok: true, path: "a.bin" });
    expect(store.get("a.bin")).toEqual(bytes);
    expect(vfs.delete).toHaveBeenCalledWith("a.bin");
  });

  it("atomicWriteFile fallback path ignores temp cleanup errors", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map();
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => store.get(p) || new Uint8Array()),
      exists: vi.fn(async () => false),
      delete: vi.fn(async (p) => {
        if (String(p).includes(".tmp_")) throw new Error("cleanup failed");
        store.delete(p);
      }),
    };

    const bytes = new Uint8Array([1]);
    const res = await atomicWriteFile(vfs, "a.bin", bytes, { verify: false });
    expect(res).toEqual({ ok: true, path: "a.bin" });
    expect(store.get("a.bin")).toEqual(bytes);
    expect(vfs.delete).toHaveBeenCalled(); // attempted temp cleanup (ignored errors)
  });

  it("atomicWriteFile throws when aborted before any work starts", async () => {
    const { atomicWriteFile } = await importOperations();

    const vfs = { writeFile: vi.fn(async () => true) };
    const ac = new AbortController();
    ac.abort("stop");

    await expect(atomicWriteFile(vfs, "a.bin", new Uint8Array([1]), { signal: ac.signal })).rejects.toThrow("stop");
    expect(vfs.writeFile).not.toHaveBeenCalled();
  });

  it("atomicWriteFile accepts ArrayBuffer input and coerces unsupported data types to empty bytes", async () => {
    const { atomicWriteFile } = await importOperations();

    const vfs = {
      writeFile: vi.fn(async () => true),
      rename: vi.fn(async () => true),
    };

    const buf = new Uint8Array([1, 2, 3]).buffer;
    await atomicWriteFile(vfs, "a.bin", buf, { verify: false });
    expect(vfs.writeFile.mock.calls[0][1]).toBeInstanceOf(Uint8Array);
    expect(vfs.writeFile.mock.calls[0][1].length).toBe(3);

    await atomicWriteFile(vfs, "b.bin", "not-bytes", { verify: false });
    expect(vfs.writeFile.mock.calls[1][1]).toBeInstanceOf(Uint8Array);
    expect(vfs.writeFile.mock.calls[1][1].length).toBe(0);
  });

  it("atomicWriteFile returns ok:false when aborted after writing the temp file (and cleans up)", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map();
    const ac = new AbortController();
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        // Simulate an abort that happens after the temp write finishes.
        if (String(p).includes(".tmp_")) ac.abort("stop");
        return true;
      }),
      readFile: vi.fn(async () => new Uint8Array([1])),
      rename: vi.fn(async () => true),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteFile(vfs, "a.bin", new Uint8Array([1, 2, 3]), { signal: ac.signal });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/stop/i);
    expect(vfs.readFile).not.toHaveBeenCalled();
    expect(vfs.rename).not.toHaveBeenCalled();
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWriteFile returns ok:false when aborted after verification but before rename", async () => {
    const { atomicWriteFile } = await importOperations();

    const store = new Map();
    const ac = new AbortController();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const vfs = {
      writeFile: vi.fn(async (p, data) => {
        store.set(p, new Uint8Array(data));
        return true;
      }),
      readFile: vi.fn(async (p) => {
        const val = store.get(p);
        // Abort after the temp file is written and read back successfully.
        ac.abort(); // default reason is not a string -> error message should be "aborted"
        return val;
      }),
      rename: vi.fn(async () => true),
      delete: vi.fn(async (p) => {
        store.delete(p);
      }),
    };

    const res = await atomicWriteFile(vfs, "a.bin", bytes, { signal: ac.signal });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/aborted/i);
    expect(vfs.rename).not.toHaveBeenCalled();
    expect(vfs.delete).toHaveBeenCalledWith(res.tempPath);
  });

  it("atomicWrite dispatches based on input type (string vs bytes)", async () => {
    const { atomicWrite } = await importOperations();

    const vfs = {
      writeText: vi.fn(async () => true),
      readText: vi.fn(async () => "x"),
      rename: vi.fn(async () => true),
      writeFile: vi.fn(async () => true),
      readFile: vi.fn(async () => new Uint8Array([1])),
    };

    await atomicWrite(vfs, "a.txt", "hello", { verify: false });
    expect(vfs.writeText).toHaveBeenCalled();

    await atomicWrite(vfs, "a.bin", new Uint8Array([1, 2, 3]), { verify: false });
    expect(vfs.writeFile).toHaveBeenCalled();
  });
});
