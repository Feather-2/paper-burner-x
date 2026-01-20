import { beforeEach, describe, expect, it, vi } from "vitest";

const restoreVfsCheckpointMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../../../../js/agents/vfs/checkpoints.js", () => ({
  restoreVfsCheckpoint: restoreVfsCheckpointMock,
}));

import MemoryVfs from "../../../../../js/agents/vfs/vfs.memory.js";
import { SideEffectJournal } from "../../../../../js/agents/plugins/side-effects/side-effect-journal.js";

function makeLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeEventBus() {
  return {
    emit: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

function getWalPath(journal, runId) {
  const path = journal._getWalPath(runId);
  if (!path) throw new Error("WAL path missing");
  return path;
}

describe("SideEffectJournal", () => {
  beforeEach(() => {
    restoreVfsCheckpointMock.mockReset();
  });

  it("returns missing_wal when no WAL file exists", async () => {
    const vfs = new MemoryVfs();
    const journal = new SideEffectJournal({ runId: "run-1", vfs, logger: makeLogger() });

    const result = await journal.replayFromStorage();

    expect(result).toMatchObject({
      ok: false,
      reason: "missing_wal",
      cursor: 0,
      recovered: 0,
    });
  });

  it("replays WAL entries while skipping invalid lines", async () => {
    const vfs = new MemoryVfs();
    const logger = makeLogger();
    const journal = new SideEffectJournal({ runId: "run-2", vfs, logger });

    const walPath = getWalPath(journal, "run-2");
    const lines = [
      JSON.stringify({
        kind: "vfs_checkpoint",
        ts: "2020-01-01T00:00:00Z",
        reversible: true,
        eventId: "evt-1",
        checkpoint: { artifactId: "artifact-1" },
      }),
      "{bad json",
      JSON.stringify({ ts: "2020-01-01T00:00:01Z" }),
      JSON.stringify({ kind: "unknown", ts: 0 }),
    ];
    await vfs.writeText(walPath, `${lines.join("\n")}\n`);

    const result = await journal.replayFromStorage("run-2");

    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(2);
    expect(journal.getCursor()).toBe(2);

    const entries = journal.listEntries();
    expect(entries.map((entry) => entry.kind)).toEqual(["vfs_checkpoint", "unknown"]);
    expect(entries[0].eventId).toBe("evt-1");
  });

  it("persists new entries and compacts WAL contents", async () => {
    const vfs = new MemoryVfs();
    const journal = new SideEffectJournal({ runId: "run-3", vfs, logger: makeLogger() });

    journal.record({
      kind: "vfs_checkpoint",
      reversible: true,
      checkpoint: { artifactId: "artifact-1" },
    });
    journal.record({
      kind: "vfs_checkpoint",
      reversible: true,
      checkpoint: { artifactId: "artifact-2" },
    });

    const firstPersist = await journal.persist();
    expect(firstPersist.ok).toBe(true);
    expect(firstPersist.persisted).toBe(2);

    const secondPersist = await journal.persist();
    expect(secondPersist.ok).toBe(true);
    expect(secondPersist.persisted).toBe(0);

    const walPath = getWalPath(journal, "run-3");
    const walText = await vfs.readText(walPath);
    await vfs.writeText(walPath, `${walText}${JSON.stringify({ kind: "unknown", ts: "2020-01-01" })}\n`);

    const compactResult = await journal.compact();
    expect(compactResult.ok).toBe(true);
    expect(compactResult.before).toBe(3);
    expect(compactResult.after).toBe(2);
    expect(compactResult.saved).toBe(1);
  });

  it("emits rollback events and restores checkpoints", async () => {
    const vfs = new MemoryVfs();
    const eventBus = makeEventBus();
    const runStore = { getArtifactById: vi.fn(async () => ({ ok: true })) };
    const journal = new SideEffectJournal({
      runId: "run-4",
      vfs,
      runStore,
      eventBus,
      logger: makeLogger(),
    });

    journal.record({
      kind: "vfs_checkpoint",
      reversible: true,
      checkpoint: { artifactId: "artifact-1" },
    });
    journal.record({
      kind: "vfs_checkpoint",
      reversible: true,
      checkpoint: { artifactId: "artifact-2" },
    });

    const result = await journal.rollbackToCursor(1, { reason: "test" });

    expect(result.ok).toBe(true);
    expect(result.rolledBack).toBe(1);
    expect(result.failures).toEqual([]);
    expect(journal.getCursor()).toBe(1);
    expect(restoreVfsCheckpointMock).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "side_effects.rolled_back",
      expect.objectContaining({
        cursorBefore: 2,
        cursorAfter: 1,
        rolledBack: 1,
        reason: "test",
      })
    );
  });

  it("rejects rollback when runStore/storageAdapter are missing", async () => {
    const vfs = new MemoryVfs();
    const journal = new SideEffectJournal({ runId: "run-5", vfs, logger: makeLogger() });

    journal.record({
      kind: "vfs_checkpoint",
      reversible: true,
      checkpoint: { artifactId: "artifact-1" },
    });

    const result = await journal.rollbackToCursor(0);

    expect(result).toMatchObject({ ok: false, reason: "missing_runStore" });
  });
});
