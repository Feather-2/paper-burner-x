import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../js/agents/plugins/memory/l3-storage/utils.js", async () => {
  const actual = await vi.importActual(
    "../../../../../../js/agents/plugins/memory/l3-storage/utils.js"
  );
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import {
  decodeTabCoordinatorSession,
  encodeTabCoordinatorSession,
  ensureTabCoordinatorHooks,
  releaseTabCoordinatorHooks,
} from "../../../../../../js/agents/plugins/memory/l3-storage/tab-coordinator.js";
import { toNonEmptyString } from "../../../../../../js/agents/plugins/memory/l3-storage/utils.js";

const HOOKS_KEY = "__l3StorageHooks";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("encodeTabCoordinatorSession", () => {
  it("serializes trimmed runId and snapshotId", () => {
    const result = encodeTabCoordinatorSession(" run-1 ", " snap-1 ");

    expect(result).toBe(JSON.stringify({ runId: "run-1", snapshotId: "snap-1" }));
    expect(toNonEmptyString).toHaveBeenCalledTimes(2);
  });

  it("returns null for empty or invalid runId values", () => {
    const invalidRunIds = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { deep: { nest: "x" } },
    ];

    for (const runId of invalidRunIds) {
      expect(encodeTabCoordinatorSession(runId, "snap")).toBeNull();
    }
  });

  it("returns null for empty or invalid snapshotId values", () => {
    const invalidSnapshotIds = [
      null,
      undefined,
      "",
      "  ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { deep: { nest: "x" } },
    ];

    for (const snapshotId of invalidSnapshotIds) {
      expect(encodeTabCoordinatorSession("run", snapshotId)).toBeNull();
    }
  });

  it("accepts numeric strings and trims whitespace", () => {
    const result = encodeTabCoordinatorSession(" 0 ", " 1 ");

    expect(result).toBe(JSON.stringify({ runId: "0", snapshotId: "1" }));
  });

  it("handles long strings and concurrent calls", async () => {
    const longRunId = "r".repeat(50000);
    const longSnapshotId = "s".repeat(50000);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        encodeTabCoordinatorSession(longRunId, longSnapshotId)
      )
    );

    const unique = new Set(results);
    expect(unique.size).toBe(1);

    const parsed = JSON.parse(results[0]);
    expect(parsed.runId.length).toBe(longRunId.length);
    expect(parsed.snapshotId.length).toBe(longSnapshotId.length);
  });
});

describe("decodeTabCoordinatorSession", () => {
  it("parses valid JSON with trimmed values and ignores extras", () => {
    const deep = { level1: { level2: { level3: { level4: { level5: "x" } } } } };
    const sessionId = JSON.stringify({
      runId: " run ",
      snapshotId: " snap ",
      extra: deep,
    });

    expect(decodeTabCoordinatorSession(sessionId)).toEqual({
      runId: "run",
      snapshotId: "snap",
    });
  });

  it("returns null for empty or non-string inputs", () => {
    const inputs = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
    ];

    for (const input of inputs) {
      expect(decodeTabCoordinatorSession(input)).toBeNull();
    }
  });

  it("returns null for invalid JSON or non-object JSON values", () => {
    const inputs = ["not json", "{", "123", "\"abc\"", "[]"];

    for (const input of inputs) {
      expect(decodeTabCoordinatorSession(input)).toBeNull();
    }
  });

  it("returns null when runId or snapshotId is missing or invalid", () => {
    const inputs = [
      JSON.stringify({ runId: "", snapshotId: "snap" }),
      JSON.stringify({ runId: "run", snapshotId: " " }),
      JSON.stringify({ runId: { deep: { nest: "x" } }, snapshotId: "snap" }),
      JSON.stringify({ runId: "run", snapshotId: [] }),
    ];

    for (const input of inputs) {
      expect(decodeTabCoordinatorSession(input)).toBeNull();
    }
  });

  it("handles large payloads and concurrent decodes", async () => {
    const longRunId = "r".repeat(60000);
    const longSnapshotId = "s".repeat(60000);
    const deep = { l1: { l2: { l3: { l4: { l5: "x" } } } } };
    const sessionId = JSON.stringify({
      runId: longRunId,
      snapshotId: longSnapshotId,
      meta: deep,
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => decodeTabCoordinatorSession(sessionId))
    );

    const unique = new Set(results.map((value) => JSON.stringify(value)));
    expect(unique.size).toBe(1);
    expect(results[0]).toEqual({ runId: longRunId, snapshotId: longSnapshotId });
  });
});

describe("ensureTabCoordinatorHooks", () => {
  it("returns null for non-object coordinators", () => {
    const inputs = [null, undefined, "", 0, -1, () => {}];

    for (const input of inputs) {
      expect(ensureTabCoordinatorHooks(input)).toBeNull();
    }
  });

  it("creates hooks, wraps handlers, and calls originals", () => {
    const originalEviction = vi.fn();
    const originalAccess = vi.fn();
    const coordinator = {
      _onEviction: originalEviction,
      _onAccess: originalAccess,
    };

    const hooks = ensureTabCoordinatorHooks(coordinator);
    const evictionHandler = vi.fn();
    const accessHandler = vi.fn();

    hooks.eviction.add(evictionHandler);
    hooks.access.add(accessHandler);

    coordinator._onEviction("session-1");
    coordinator._onAccess("session-2");

    expect(hooks.eviction).toBeInstanceOf(Set);
    expect(hooks.access).toBeInstanceOf(Set);
    expect(hooks.originalEviction).toBe(originalEviction);
    expect(hooks.originalAccess).toBe(originalAccess);
    expect(originalEviction).toHaveBeenCalledWith("session-1");
    expect(originalAccess).toHaveBeenCalledWith("session-2");
    expect(evictionHandler).toHaveBeenCalledWith("session-1");
    expect(accessHandler).toHaveBeenCalledWith("session-2");
  });

  it("logs handler errors and continues other handlers", () => {
    const logger = { warn: vi.fn() };
    const coordinator = {};
    const hooks = ensureTabCoordinatorHooks(coordinator, logger);
    const error = new Error("boom");
    const throwingHandler = () => {
      throw error;
    };
    const safeHandler = vi.fn();

    hooks.eviction.add(throwingHandler);
    hooks.eviction.add(safeHandler);
    hooks.eviction.add("not-a-function");

    coordinator._onEviction("session-x");

    expect(logger.warn).toHaveBeenCalledWith(
      "[L3Storage] tabCoordinator onEviction handler error:",
      error
    );
    expect(safeHandler).toHaveBeenCalledWith("session-x");
  });

  it("returns existing hooks without re-wrapping", () => {
    const existingEviction = vi.fn();
    const existingAccess = vi.fn();
    const existingHooks = {
      eviction: new Set(),
      access: new Set(),
      originalEviction: null,
      originalAccess: null,
    };
    const coordinator = {
      _onEviction: existingEviction,
      _onAccess: existingAccess,
      [HOOKS_KEY]: existingHooks,
    };

    const hooks = ensureTabCoordinatorHooks(coordinator);

    expect(hooks).toBe(existingHooks);
    expect(coordinator._onEviction).toBe(existingEviction);
    expect(coordinator._onAccess).toBe(existingAccess);
  });

  it("handles array coordinators and repeated calls", async () => {
    const coordinator = [];
    const first = ensureTabCoordinatorHooks(coordinator);
    const [second, third] = await Promise.all([
      ensureTabCoordinatorHooks(coordinator),
      ensureTabCoordinatorHooks(coordinator),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(coordinator._onEviction).toBeDefined();
  });
});

describe("releaseTabCoordinatorHooks", () => {
  it("does nothing for invalid inputs or mismatched hooks", () => {
    const coordinator = {};
    const hooks = ensureTabCoordinatorHooks(coordinator);
    const otherHooks = { eviction: new Set(), access: new Set() };

    releaseTabCoordinatorHooks(null, hooks);
    releaseTabCoordinatorHooks(coordinator, null);
    releaseTabCoordinatorHooks(coordinator, otherHooks);

    expect(coordinator[HOOKS_KEY]).toBe(hooks);
  });

  it("restores originals and clears hooks when no handlers remain", () => {
    const originalEviction = vi.fn();
    const originalAccess = vi.fn();
    const coordinator = {
      _onEviction: originalEviction,
      _onAccess: originalAccess,
    };

    const hooks = ensureTabCoordinatorHooks(coordinator);

    releaseTabCoordinatorHooks(coordinator, hooks);
    releaseTabCoordinatorHooks(coordinator, hooks);

    expect(coordinator._onEviction).toBe(originalEviction);
    expect(coordinator._onAccess).toBe(originalAccess);
    expect(coordinator[HOOKS_KEY]).toBeUndefined();
  });

  it("keeps hooks when handlers are still registered", () => {
    const originalEviction = vi.fn();
    const coordinator = { _onEviction: originalEviction };

    const hooks = ensureTabCoordinatorHooks(coordinator);
    const wrapper = coordinator._onEviction;
    hooks.eviction.add(vi.fn());

    releaseTabCoordinatorHooks(coordinator, hooks);

    expect(coordinator[HOOKS_KEY]).toBe(hooks);
    expect(coordinator._onEviction).toBe(wrapper);
  });
});
