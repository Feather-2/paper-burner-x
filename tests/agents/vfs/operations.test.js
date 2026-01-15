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

  it("atomicWriteText throws when aborted before any work starts", async () => {
    const { atomicWriteText } = await importOperations();

    const vfs = { writeText: vi.fn(async () => true) };
    const ac = new AbortController();
    ac.abort("stop");

    await expect(atomicWriteText(vfs, "a.txt", "x", { signal: ac.signal })).rejects.toThrow("stop");
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
