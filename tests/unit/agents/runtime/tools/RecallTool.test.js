// RecallTool unit tests covering list/search/get paths, boundaries, and errors.
// Includes concurrency, resource edge cases, and tool definition schema checks.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(() => Promise.resolve()),
}));

import { setTimeout as delay } from "node:timers/promises";
import {
  createRecallTool,
  RECALL_TOOL_DEFINITION,
} from "../../../../../js/agents/runtime/tools/RecallTool.js";

describe("createRecallTool", () => {
  let compressor;
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    compressor = {
      listArchives: vi.fn(),
      restore: vi.fn(),
    };
    logger = {
      error: vi.fn(),
    };
  });

  it("throws when compressor is null or undefined", () => {
    expect(() => createRecallTool({ compressor: null })).toThrow(
      "RecallTool requires a CicadaCompressor instance",
    );
    expect(() => createRecallTool({ compressor: undefined })).toThrow(
      "RecallTool requires a CicadaCompressor instance",
    );
  });

  it("rejects when args are null or undefined", async () => {
    const handler = createRecallTool({ compressor });

    await expect(handler(null, { logger })).rejects.toThrow();
    await expect(handler(undefined, { logger })).rejects.toThrow();
  });

  it("lists archives by default with empty args object", async () => {
    const handler = createRecallTool({ compressor });
    const archives = [
      { id: "a1", timestamp: 0, summary: "First summary" },
      { id: "b2", timestamp: 1000, summary: "Second summary" },
    ];
    compressor.listArchives.mockResolvedValue(archives);

    const result = await handler({}, { logger });

    expect(compressor.listArchives).toHaveBeenCalledWith({ limit: 5 });
    expect(result.ok).toBe(true);
    expect(result.data).toContain("Available memories:");
    expect(result.data).toContain("ID: a1");
    expect(result.data).toContain("Summary: First summary");
  });

  it("defaults to list action when args is an empty array", async () => {
    const handler = createRecallTool({ compressor });
    compressor.listArchives.mockResolvedValue([]);

    const result = await handler([], { logger });

    expect(compressor.listArchives).toHaveBeenCalledWith({ limit: 5 });
    expect(result.ok).toBe(true);
    expect(result.data).toBe("No archived memories found.");
  });

  it("passes boundary limit values including numeric strings", async () => {
    const handler = createRecallTool({ compressor });
    const limits = [0, -1, Number.MAX_SAFE_INTEGER, "0"];
    compressor.listArchives.mockResolvedValue([]);

    for (const limit of limits) {
      await handler({ action: "list", limit }, { logger });
    }

    expect(compressor.listArchives).toHaveBeenCalledTimes(limits.length);
    limits.forEach((limit, index) => {
      expect(compressor.listArchives.mock.calls[index][0]).toEqual({ limit });
    });
  });

  it("requires query for search when query is empty", async () => {
    const handler = createRecallTool({ compressor });
    const invalidQueries = [null, undefined, "", 0];

    for (const query of invalidQueries) {
      const result = await handler({ action: "search", query }, { logger });
      expect(result).toEqual({ ok: false, error: "Query is required for search" });
    }
  });

  it("handles whitespace and long query strings", async () => {
    const handler = createRecallTool({ compressor });
    const whitespaceQuery = "   ";
    compressor.listArchives.mockResolvedValueOnce([]);

    const whitespaceResult = await handler(
      { action: "search", query: whitespaceQuery, limit: 1 },
      { logger },
    );

    expect(compressor.listArchives).toHaveBeenCalledWith({
      pattern: whitespaceQuery,
      limit: 1,
    });
    expect(whitespaceResult.ok).toBe(true);
    expect(whitespaceResult.data).toContain(`"${whitespaceQuery}"`);

    const longQuery = "q".repeat(100000);
    compressor.listArchives.mockResolvedValueOnce([]);

    const longResult = await handler(
      { action: "search", query: longQuery },
      { logger },
    );

    expect(compressor.listArchives).toHaveBeenCalledWith({
      pattern: longQuery,
      limit: 5,
    });
    expect(longResult.ok).toBe(true);
    expect(longResult.data).toContain(longQuery);
  });

  it("returns formatted search results", async () => {
    const handler = createRecallTool({ compressor });
    const results = [
      { id: "s1", summary: "Alpha" },
      { id: "s2", summary: "Beta" },
    ];
    compressor.listArchives.mockResolvedValue(results);

    const result = await handler(
      { action: "search", query: "alpha", limit: 2 },
      { logger },
    );

    expect(compressor.listArchives).toHaveBeenCalledWith({
      pattern: "alpha",
      limit: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toContain("Search results for \"alpha\":");
    expect(result.data).toContain("ID: s1 | Summary: Alpha");
  });

  it("requires archive_id for get when archive_id is empty", async () => {
    const handler = createRecallTool({ compressor });
    const invalidIds = [null, undefined, "", 0];

    for (const archive_id of invalidIds) {
      const result = await handler({ action: "get", archive_id }, { logger });
      expect(result).toEqual({ ok: false, error: "Archive ID is required for get" });
    }

    expect(compressor.restore).not.toHaveBeenCalled();
  });

  it("handles whitespace archive_id values and not-found snapshots", async () => {
    const handler = createRecallTool({ compressor });
    compressor.restore.mockResolvedValue(null);

    const result = await handler(
      { action: "get", archive_id: "   " },
      { logger },
    );

    expect(compressor.restore).toHaveBeenCalledWith("   ");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns snapshot context or snapshot fallback", async () => {
    const handler = createRecallTool({ compressor });
    const snapshotWithContext = { context: { foo: "bar" } };
    const emptySnapshot = {};
    compressor.restore
      .mockResolvedValueOnce(snapshotWithContext)
      .mockResolvedValueOnce(emptySnapshot);

    const contextResult = await handler(
      { action: "get", archive_id: "ctx" },
      { logger },
    );
    const emptyResult = await handler(
      { action: "get", archive_id: "empty" },
      { logger },
    );

    expect(contextResult.ok).toBe(true);
    expect(contextResult.data).toEqual(snapshotWithContext.context);
    expect(emptyResult.ok).toBe(true);
    expect(emptyResult.data).toEqual(emptySnapshot);
  });

  it("returns large and deeply nested snapshots", async () => {
    const handler = createRecallTool({ compressor });
    const hugePayload = "x".repeat(1024 * 1024);
    const deepNested = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: "deep",
            },
          },
        },
      },
    };
    const snapshot = { context: { file: hugePayload, deep: deepNested } };
    compressor.restore.mockResolvedValue(snapshot);

    const result = await handler(
      { action: "get", archive_id: "huge" },
      { logger },
    );

    expect(result.ok).toBe(true);
    expect(result.data.file.length).toBe(hugePayload.length);
    expect(result.data.deep.level1.level2.level3.level4.value).toBe("deep");
  });

  it("returns an error for unknown actions", async () => {
    const handler = createRecallTool({ compressor });

    const result = await handler({ action: "unknown" }, { logger });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unknown action: unknown");
  });

  it("logs and returns errors thrown by the compressor", async () => {
    const handler = createRecallTool({ compressor });
    compressor.listArchives.mockRejectedValue(new Error("boom"));

    const result = await handler({ action: "list" }, { logger });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
    expect(logger.error).toHaveBeenCalledWith("Recall tool failed: boom");
  });

  it("handles non-array archive responses", async () => {
    const handler = createRecallTool({ compressor });
    const arrayLike = { 0: { id: "x", timestamp: 0, summary: "bad" }, length: 1 };
    compressor.listArchives.mockResolvedValue(arrayLike);

    const result = await handler({ action: "list" }, { logger });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("map");
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles concurrent calls without shared state", async () => {
    const handler = createRecallTool({ compressor });
    const listResults = [{ id: "l1", timestamp: 0, summary: "List" }];
    const searchResults = [{ id: "s1", summary: "Search" }];
    compressor.listArchives.mockImplementation(async ({ pattern }) => {
      await delay(0);
      return pattern ? searchResults : listResults;
    });

    const [listResult, searchResult] = await Promise.all([
      handler({ action: "list", limit: 1 }, { logger }),
      handler({ action: "search", query: "needle", limit: 1 }, { logger }),
    ]);

    expect(listResult.ok).toBe(true);
    expect(searchResult.ok).toBe(true);
    expect(listResult.data).toContain("ID: l1");
    expect(searchResult.data).toContain("ID: s1");
    expect(compressor.listArchives).toHaveBeenCalledWith({ limit: 1 });
    expect(compressor.listArchives).toHaveBeenCalledWith({
      pattern: "needle",
      limit: 1,
    });
  });

  it("handles rapid consecutive calls", async () => {
    const handler = createRecallTool({ compressor });
    compressor.listArchives
      .mockResolvedValueOnce([{ id: "r1", timestamp: 0, summary: "First" }])
      .mockResolvedValueOnce([{ id: "r2", timestamp: 0, summary: "Second" }]);

    const first = await handler({ action: "list", limit: 1 }, { logger });
    const second = await handler({ action: "list", limit: 1 }, { logger });

    expect(first.data).toContain("ID: r1");
    expect(second.data).toContain("ID: r2");
    expect(compressor.listArchives).toHaveBeenCalledTimes(2);
  });
});

describe("RECALL_TOOL_DEFINITION", () => {
  it("defines the tool metadata", () => {
    expect(RECALL_TOOL_DEFINITION.name).toBe("Recall");
    expect(RECALL_TOOL_DEFINITION.description).toContain("Search or retrieve");
    expect(RECALL_TOOL_DEFINITION.parameters.type).toBe("object");
  });

  it("specifies action enum and limit defaults", () => {
    const { action, limit } = RECALL_TOOL_DEFINITION.parameters.properties;

    expect(action.enum).toEqual(["list", "search", "get"]);
    expect(RECALL_TOOL_DEFINITION.parameters.required).toContain("action");
    expect(limit.default).toBe(5);
  });
});

describe("memory:recalled event emission", () => {
  let compressor;
  let eventBus;
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    compressor = {
      listArchives: vi.fn(),
      restore: vi.fn(),
    };
    eventBus = {
      emit: vi.fn(),
    };
    logger = {
      error: vi.fn(),
    };
  });

  it("should emit memory:recalled on successful search", async () => {
    const handler = createRecallTool({ compressor, eventBus });
    const results = [{ id: "s1", summary: "Search result" }];
    compressor.listArchives.mockResolvedValue(results);

    await handler({ action: "search", query: "test", limit: 5 }, { logger });

    expect(eventBus.emit).toHaveBeenCalledWith("memory:recalled", {
      query: "test",
      action: "search",
      resultCount: 1,
    });
  });

  it("should emit memory:recalled on successful get", async () => {
    const handler = createRecallTool({ compressor, eventBus });
    const snapshot = { context: { data: "test" } };
    compressor.restore.mockResolvedValue(snapshot);

    await handler({ action: "get", archive_id: "test-id" }, { logger });

    expect(eventBus.emit).toHaveBeenCalledWith("memory:recalled", {
      atomId: "test-id",
      action: "get",
    });
  });

  it("should NOT emit when eventBus is not provided", async () => {
    const handler = createRecallTool({ compressor });
    compressor.listArchives.mockResolvedValue([]);

    const result = await handler({ action: "list" }, { logger });

    expect(result.ok).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("should NOT emit on failed search", async () => {
    const handler = createRecallTool({ compressor, eventBus });
    compressor.listArchives.mockRejectedValue(new Error("search failed"));

    await handler({ action: "search", query: "test" }, { logger });

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
