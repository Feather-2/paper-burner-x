import { beforeEach, describe, expect, it, vi } from "vitest";

const platformState = vi.hoisted(() => ({
  isNode: false,
}));

const browserMock = vi.hoisted(() => ({
  createVfs: vi.fn(),
}));

const nodeMock = vi.hoisted(() => ({
  createVfs: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  Platform: platformState,
}));

vi.mock("../../../../js/agents/vfs/index.browser.js", () => ({
  createVfs: browserMock.createVfs,
}));

vi.mock("../../../../js/agents/vfs/index.node.js", () => ({
  createVfs: nodeMock.createVfs,
}));

async function loadIndex() {
  return await import("../../../../js/agents/vfs/index.js");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildDeepObject(depth) {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i++) {
    current.child = { level: i };
    current = current.child;
  }
  return root;
}

describe("agents/vfs/index createVfs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    platformState.isNode = false;
    browserMock.createVfs.mockImplementation(async (options) => ({
      tag: "browser",
      options,
    }));
    nodeMock.createVfs.mockImplementation(async (options) => ({
      tag: "node",
      options,
    }));
  });

  it("uses browser implementation when Platform.isNode is false", async () => {
    const { createVfs } = await loadIndex();
    const options = { kind: "memory", rootDirName: "root", preferOpfs: true };

    const result = await createVfs(options);

    expect(browserMock.createVfs).toHaveBeenCalledTimes(1);
    expect(browserMock.createVfs).toHaveBeenCalledWith(options);
    expect(nodeMock.createVfs).not.toHaveBeenCalled();
    expect(result).toEqual({ tag: "browser", options });
  });

  it("defaults options to an empty object when undefined", async () => {
    const { createVfs } = await loadIndex();

    const result = await createVfs();

    expect(browserMock.createVfs).toHaveBeenCalledTimes(1);
    expect(browserMock.createVfs.mock.calls[0][0]).toEqual({});
    expect(result).toEqual({ tag: "browser", options: {} });
  });

  it.each([
    ["null", null],
    ["empty string", ""],
    ["empty array", []],
    ["empty object", {}],
  ])("forwards %s options without normalization", async (_label, input) => {
    const { createVfs } = await loadIndex();

    await createVfs(input);

    expect(browserMock.createVfs).toHaveBeenCalledTimes(1);
    expect(browserMock.createVfs).toHaveBeenCalledWith(input);
  });

  it.each([
    ["zero", 0],
    ["negative one", -1],
    ["max safe integer", Number.MAX_SAFE_INTEGER],
    ["whitespace string", "   "],
  ])("forwards boundary value %s", async (_label, input) => {
    const { createVfs } = await loadIndex();

    await createVfs(input);

    expect(browserMock.createVfs).toHaveBeenCalledTimes(1);
    expect(browserMock.createVfs).toHaveBeenCalledWith(input);
  });

  it.each([
    ["numeric string (string as number)", "123"],
    ["array-like object (object as array)", { 0: "x", length: 1 }],
  ])("forwards type boundary input: %s", async (_label, input) => {
    const { createVfs } = await loadIndex();

    await createVfs(input);

    expect(browserMock.createVfs).toHaveBeenCalledTimes(1);
    expect(browserMock.createVfs).toHaveBeenCalledWith(input);
  });

  it("forwards large resource-oriented options payloads", async () => {
    const { createVfs } = await loadIndex();
    const longString = "x".repeat(200_000);
    const largeBuffer = new Uint8Array(1024 * 1024);
    const deepNested = buildDeepObject(40);
    const options = {
      kind: "memory",
      keyPrefix: longString,
      storageAdapter: {
        blob: largeBuffer,
        nested: deepNested,
      },
    };

    await createVfs(options);

    expect(browserMock.createVfs).toHaveBeenCalledTimes(1);
    expect(browserMock.createVfs).toHaveBeenCalledWith(options);
  });

  it("propagates browser createVfs errors", async () => {
    const { createVfs } = await loadIndex();
    const error = new Error("browser fail");
    browserMock.createVfs.mockRejectedValueOnce(error);

    await expect(createVfs({ kind: "memory" })).rejects.toThrow("browser fail");
  });

  it("uses node implementation when Platform.isNode is true", async () => {
    const { createVfs } = await loadIndex();
    platformState.isNode = true;
    const options = { kind: "nodefs", rootPath: "/tmp" };

    const result = await createVfs(options);

    expect(nodeMock.createVfs).toHaveBeenCalledTimes(1);
    expect(nodeMock.createVfs).toHaveBeenCalledWith(options);
    expect(browserMock.createVfs).not.toHaveBeenCalled();
    expect(result).toEqual({ tag: "node", options });
  });

  it("propagates node createVfs errors", async () => {
    const { createVfs } = await loadIndex();
    platformState.isNode = true;
    const error = new Error("node fail");
    nodeMock.createVfs.mockRejectedValueOnce(error);

    await expect(createVfs({ kind: "nodefs" })).rejects.toThrow("node fail");
  });

  it("handles concurrent calls", async () => {
    const { createVfs } = await loadIndex();
    const defers = [deferred(), deferred(), deferred()];

    browserMock.createVfs
      .mockImplementationOnce(() => defers[0].promise)
      .mockImplementationOnce(() => defers[1].promise)
      .mockImplementationOnce(() => defers[2].promise);

    const p1 = createVfs({ kind: "memory" });
    const p2 = createVfs({ kind: "opfs" });
    const p3 = createVfs({ kind: "storage" });

    defers[1].resolve({ id: "b" });
    defers[0].resolve({ id: "a" });
    defers[2].resolve({ id: "c" });

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    expect(browserMock.createVfs).toHaveBeenCalledTimes(3);
  });

  it("handles rapid successive calls", async () => {
    const { createVfs } = await loadIndex();

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await createVfs({ seq: i }));
    }

    expect(results).toHaveLength(5);
    expect(browserMock.createVfs).toHaveBeenCalledTimes(5);
    expect(browserMock.createVfs.mock.calls.map((call) => call[0])).toEqual([
      { seq: 0 },
      { seq: 1 },
      { seq: 2 },
      { seq: 3 },
      { seq: 4 },
    ]);
  });
});
