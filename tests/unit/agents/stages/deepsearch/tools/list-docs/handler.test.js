/**
 * @file tests/unit/agents/stages/deepsearch/tools/list-docs/handler.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { SourceManagerMock, instances, defaultCtorImpl } = vi.hoisted(() => {
  const instances = [];
  const defaultCtorImpl = function (sources) {
    this.initialSources = sources;
    this.syncSources = vi.fn();
    this.listSources = vi.fn(() => []);
    instances.push(this);
  };
  const SourceManagerMock = vi.fn().mockImplementation(defaultCtorImpl);

  return { SourceManagerMock, instances, defaultCtorImpl };
});

vi.mock("../../../../../../../js/agents/stages/deepsearch/source-manager.js", () => ({
  default: SourceManagerMock,
}));

import defaultExport, { definition, handler } from "../../../../../../../js/agents/stages/deepsearch/tools/list-docs/handler.js";

const setupNextInstance = ({ listSources = [], syncSources } = {}) => {
  SourceManagerMock.mockImplementationOnce(function (sources) {
    this.initialSources = sources;
    this.syncSources = syncSources ? vi.fn(syncSources) : vi.fn();
    this.listSources =
      typeof listSources === "function"
        ? vi.fn(listSources)
        : vi.fn(() => listSources);
    instances.push(this);
  });
};

const createManager = ({ listSources = [], syncSources } = {}) => {
  const manager = new SourceManagerMock(["seed"]);
  if (typeof listSources === "function") {
    manager.listSources = vi.fn(listSources);
  } else {
    manager.listSources.mockReturnValue(listSources);
  }

  if (syncSources) {
    manager.syncSources = vi.fn(syncSources);
  }

  return manager;
};

const ARRAY_LIKE_SOURCES = { 0: "first", length: 1 };
const DEEP_SOURCES = [
  {
    id: "root",
    children: [
      {
        id: "child",
        meta: {
          info: {
            levels: {
              deep: {
                value: 1,
              },
            },
          },
        },
      },
    ],
  },
];
const LONG_NAME = "x".repeat(10000);

beforeEach(() => {
  instances.length = 0;
  SourceManagerMock.mockReset();
  SourceManagerMock.mockImplementation(defaultCtorImpl);
});

describe("definition", () => {
  it("exposes list-docs metadata", () => {
    expect(definition).toMatchObject({
      name: "list-docs",
      layer: 0,
    });
    expect(definition.description).toBeTypeOf("string");
    expect(definition.description.length).toBeGreaterThan(0);
    expect(definition.activation.keywords).toEqual(
      expect.arrayContaining(["list", "docs"])
    );
    expect(definition.activation.phases).toEqual(
      expect.arrayContaining(["exploring"])
    );
  });
});

describe("handler", () => {
  it.each([
    { label: "undefined", context: undefined },
    { label: "null", context: null },
  ])("rejects when context is $label", async ({ context }) => {
    await expect(handler({}, context)).rejects.toThrow(TypeError);
  });

  it("lists documents and emits event", async () => {
    const sources = [{ id: "raw-1" }];
    const docs = [
      { sourceId: "s1", name: "Doc A", size: 12, extra: "ignored" },
      { sourceId: "s2", name: "Doc B", size: 0, extra: { nested: true } },
    ];

    setupNextInstance({ listSources: docs });

    const emit = vi.fn();
    const result = await handler({}, { state: { L0: { sources } }, emit });

    const instance = instances[0];
    expect(SourceManagerMock).toHaveBeenCalledTimes(1);
    expect(SourceManagerMock).toHaveBeenCalledWith(sources);
    expect(instance.syncSources).toHaveBeenCalledWith(sources);
    expect(instance.listSources).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("deepsearch.docs.listed", { count: 2 });
    expect(result).toEqual({
      success: true,
      count: 2,
      docs: [
        { sourceId: "s1", name: "Doc A", size: 12 },
        { sourceId: "s2", name: "Doc B", size: 0 },
      ],
    });
  });

  it.each([
    { label: "null", sources: null },
    { label: "undefined", sources: undefined },
    { label: "empty string", sources: "" },
    { label: "0", sources: 0 },
  ])("defaults to empty sources when input is $label", async ({ sources }) => {
    setupNextInstance({ listSources: [] });

    const result = await handler({}, { state: { L0: { sources } }, emit: null });

    const instance = instances[0];
    expect(SourceManagerMock).toHaveBeenCalledWith([]);
    expect(instance.syncSources).toHaveBeenCalledWith(sources);
    expect(result).toEqual({ success: true, count: 0, docs: [] });
  });

  it.each([
    { label: "empty array", sources: [] },
    { label: "empty object", sources: {} },
    { label: "whitespace string", sources: "   " },
    { label: "array-like object", sources: ARRAY_LIKE_SOURCES },
    { label: "deep nested", sources: DEEP_SOURCES },
  ])("passes through truthy sources for $label", async ({ sources }) => {
    setupNextInstance({ listSources: [] });

    const result = await handler({}, { state: { L0: { sources } } });

    const instance = instances[0];
    expect(SourceManagerMock).toHaveBeenCalledWith(sources);
    expect(instance.syncSources).toHaveBeenCalledWith(sources);
    expect(result).toEqual({ success: true, count: 0, docs: [] });
  });

  it("preserves boundary doc values and long strings", async () => {
    const docs = [
      { sourceId: "zero", name: "", size: 0, extra: "ignored" },
      { sourceId: "neg", name: "   ", size: -1 },
      { sourceId: "max", name: LONG_NAME, size: Number.MAX_SAFE_INTEGER },
      { sourceId: "string-size", name: "Doc", size: "123" },
    ];

    setupNextInstance({ listSources: docs });

    const emit = vi.fn();
    const result = await handler({}, { state: { L0: { sources: [] } }, emit });

    expect(emit).toHaveBeenCalledWith("deepsearch.docs.listed", {
      count: docs.length,
    });
    expect(result).toEqual({
      success: true,
      count: docs.length,
      docs: [
        { sourceId: "zero", name: "", size: 0 },
        { sourceId: "neg", name: "   ", size: -1 },
        { sourceId: "max", name: LONG_NAME, size: Number.MAX_SAFE_INTEGER },
        { sourceId: "string-size", name: "Doc", size: "123" },
      ],
    });
  });

  it("creates a new manager when provided sourceManager is not an instance", async () => {
    const docs = [{ sourceId: "s1", name: "From Mock", size: 1 }];
    setupNextInstance({ listSources: docs });

    const fakeManager = {
      syncSources: vi.fn(),
      listSources: vi.fn(() => [{ sourceId: "ignored", name: "ignored", size: 999 }]),
    };

    const emit = vi.fn();
    const sources = [{ id: "state-source" }];
    const result = await handler({}, { state: { L0: { sources } }, emit, sourceManager: fakeManager });

    expect(SourceManagerMock).toHaveBeenCalledTimes(1);
    expect(fakeManager.syncSources).not.toHaveBeenCalled();
    expect(fakeManager.listSources).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("deepsearch.docs.listed", { count: 1 });
    expect(result).toEqual({ success: true, count: 1, docs });
  });

  it("uses provided sourceManager instance", async () => {
    const docs = [{ sourceId: "s1", name: "Doc A", size: 5 }];
    const manager = createManager({ listSources: docs });
    const sources = [{ id: "state-source" }];
    const emit = vi.fn();
    const callsBefore = SourceManagerMock.mock.calls.length;

    const result = await handler({}, {
      state: { L0: { sources } },
      emit,
      sourceManager: manager,
    });

    expect(SourceManagerMock.mock.calls.length).toBe(callsBefore);
    expect(manager.syncSources).toHaveBeenCalledWith(sources);
    expect(manager.listSources).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, count: 1, docs });
  });

  it("propagates SourceManager constructor errors", async () => {
    const error = new Error("ctor failure");
    SourceManagerMock.mockImplementationOnce(function () {
      throw error;
    });

    const emit = vi.fn();
    await expect(handler({}, { state: { L0: { sources: [] } }, emit })).rejects.toThrow("ctor failure");
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects when emit is non-callable but defined", async () => {
    setupNextInstance({ listSources: [] });

    const emit = {};
    await expect(handler({}, { state: { L0: { sources: [] } }, emit })).rejects.toThrow(TypeError);
    expect(instances[0].listSources).toHaveBeenCalledTimes(1);
  });

  it("rejects when listSources returns a non-array value", async () => {
    setupNextInstance({ listSources: {} });

    const emit = vi.fn();
    await expect(handler({}, { state: { L0: { sources: [] } }, emit })).rejects.toThrow(TypeError);
    expect(emit).not.toHaveBeenCalled();
  });

  it("rejects when listSources contains a null entry", async () => {
    setupNextInstance({ listSources: [null] });

    const emit = vi.fn();
    await expect(handler({}, { state: { L0: { sources: [] } }, emit })).rejects.toThrow(TypeError);
    expect(emit).not.toHaveBeenCalled();
  });

  it("handles concurrent calls", async () => {
    const docsA = [{ sourceId: "a", name: "Doc A", size: 1 }];
    const docsB = [{ sourceId: "b", name: "Doc B", size: 2 }];
    const managerA = createManager({ listSources: docsA });
    const managerB = createManager({ listSources: docsB });
    const emitA = vi.fn();
    const emitB = vi.fn();
    const stateA = { L0: { sources: ["a"] } };
    const stateB = { L0: { sources: ["b"] } };

    const results = await Promise.all([
      handler({}, { state: stateA, emit: emitA, sourceManager: managerA }),
      handler({}, { state: stateB, emit: emitB, sourceManager: managerB }),
    ]);

    expect(managerA.syncSources).toHaveBeenCalledWith(stateA.L0.sources);
    expect(managerB.syncSources).toHaveBeenCalledWith(stateB.L0.sources);
    expect(managerA.listSources).toHaveBeenCalledTimes(1);
    expect(managerB.listSources).toHaveBeenCalledTimes(1);
    expect(emitA).toHaveBeenCalledWith("deepsearch.docs.listed", { count: 1 });
    expect(emitB).toHaveBeenCalledWith("deepsearch.docs.listed", { count: 1 });

    const docsList = results.map((result) => result.docs);
    expect(docsList).toEqual(
      expect.arrayContaining([docsA, docsB])
    );
  });

  it("handles rapid successive calls", async () => {
    const docs = [{ sourceId: "fast", name: "Doc Fast", size: 3 }];
    const manager = createManager({ listSources: docs });
    const emit = vi.fn();
    const state = { L0: { sources: ["fast"] } };

    const first = await handler({}, { state, emit, sourceManager: manager });
    const second = await handler({}, { state, emit, sourceManager: manager });

    expect(manager.syncSources).toHaveBeenCalledTimes(2);
    expect(manager.listSources).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ success: true, count: 1, docs });
    expect(second).toEqual({ success: true, count: 1, docs });
  });

  it("propagates syncSources errors", async () => {
    const error = new Error("sync failure");

    setupNextInstance({
      syncSources: () => {
        throw error;
      },
    });

    const emit = vi.fn();
    await expect(
      handler({}, { state: { L0: { sources: [] } }, emit })
    ).rejects.toThrow("sync failure");

    const instance = instances[0];
    expect(instance.listSources).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("propagates listSources errors", async () => {
    const error = new Error("list failure");
    const manager = createManager({
      listSources: () => {
        throw error;
      },
    });
    const emit = vi.fn();

    await expect(
      handler({}, { state: { L0: { sources: [] } }, emit, sourceManager: manager })
    ).rejects.toThrow("list failure");

    expect(emit).not.toHaveBeenCalled();
  });
});

describe("default", () => {
  it("exports definition and handler", () => {
    expect(defaultExport).toEqual({ definition, handler });
  });
});
