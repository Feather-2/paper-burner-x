import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../js/agents/vfs/diff.js", () => ({
  createUnifiedDiff: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
}));

const WORKER_PATH = "../../../../js/agents/vfs/diff.worker.js";
const DIFF_PATH = "../../../../js/agents/vfs/diff.js";
const SHARED_PATH = "../../../../js/agents/shared/index.js";

let restoreSelf = null;

async function setupWorker() {
  if (restoreSelf) {
    restoreSelf();
    restoreSelf = null;
  }

  const originalSelf = globalThis.self;
  const postMessage = vi.fn();
  const selfStub = { postMessage };
  globalThis.self = selfStub;

  vi.resetModules();
  const { createUnifiedDiff } = await import(DIFF_PATH);
  const { isPlainObject } = await import(SHARED_PATH);

  createUnifiedDiff.mockReset();
  isPlainObject.mockReset();

  await import(WORKER_PATH);

  restoreSelf = () => {
    if (originalSelf === undefined) {
      delete globalThis.self;
    } else {
      globalThis.self = originalSelf;
    }
  };

  return { self: selfStub, postMessage, createUnifiedDiff, isPlainObject };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  if (restoreSelf) {
    restoreSelf();
    restoreSelf = null;
  }
  vi.restoreAllMocks();
});

describe("self.onmessage", () => {
  it("posts diff for valid requests", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();

    const diffResult = { hunks: ["h1"], text: "ok" };
    const options = { path: "a.txt", beforeText: "a", afterText: "b", context: 3 };

    isPlainObject.mockReturnValue(true);
    createUnifiedDiff.mockReturnValue(diffResult);

    self.onmessage({ data: { id: "req-1", options } });

    expect(isPlainObject).toHaveBeenCalledWith(options);
    expect(createUnifiedDiff).toHaveBeenCalledWith(options);
    expect(postMessage).toHaveBeenCalledWith({ id: "req-1", ok: true, diff: diffResult });
  });

  it("defaults to empty options for missing or non-plain inputs", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();
    const diffResult = { hunks: [], text: "default" };

    isPlainObject.mockReturnValue(false);
    createUnifiedDiff.mockReturnValue(diffResult);

    self.onmessage(undefined);
    self.onmessage({ data: { id: "", options: null } });
    self.onmessage({ data: { id: "array", options: [] } });

    expect(createUnifiedDiff).toHaveBeenCalledTimes(3);
    expect(createUnifiedDiff).toHaveBeenNthCalledWith(1, {});
    expect(createUnifiedDiff).toHaveBeenNthCalledWith(2, {});
    expect(createUnifiedDiff).toHaveBeenNthCalledWith(3, {});

    expect(postMessage).toHaveBeenNthCalledWith(1, { id: undefined, ok: true, diff: diffResult });
    expect(postMessage).toHaveBeenNthCalledWith(2, { id: "", ok: true, diff: diffResult });
    expect(postMessage).toHaveBeenNthCalledWith(3, { id: "array", ok: true, diff: diffResult });

    expect(isPlainObject).toHaveBeenNthCalledWith(1, undefined);
    expect(isPlainObject).toHaveBeenNthCalledWith(2, null);
    expect(isPlainObject).toHaveBeenNthCalledWith(3, []);
  });

  it("forwards boundary values and type-odd options when treated as plain objects", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();
    const diffResult = { hunks: [], text: "boundary" };

    isPlainObject.mockReturnValue(true);
    createUnifiedDiff.mockReturnValue(diffResult);

    const cases = [
      { id: "empty-object", options: {} },
      { id: "ctx-zero", options: { context: 0, path: "   ", beforeText: "", afterText: "" } },
      { id: "ctx-neg", options: { context: -1 } },
      { id: "ctx-max", options: { context: Number.MAX_SAFE_INTEGER } },
      { id: "ctx-str", options: { context: "7" } },
      { id: "array-like", options: { 0: "x", length: 1 } },
    ];

    cases.forEach(({ id, options }) => {
      self.onmessage({ data: { id, options } });
    });

    expect(createUnifiedDiff).toHaveBeenCalledTimes(cases.length);
    cases.forEach(({ id, options }, index) => {
      expect(createUnifiedDiff).toHaveBeenNthCalledWith(index + 1, options);
      expect(postMessage).toHaveBeenNthCalledWith(index + 1, { id, ok: true, diff: diffResult });
      expect(isPlainObject).toHaveBeenNthCalledWith(index + 1, options);
    });
  });

  it("handles rapid consecutive calls", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();

    isPlainObject.mockReturnValue(true);
    createUnifiedDiff.mockImplementation((opts) => ({ hunks: [], text: opts.path || "" }));

    self.onmessage({ data: { id: "fast-1", options: { path: "a" } } });
    self.onmessage({ data: { id: "fast-2", options: { path: "b" } } });

    expect(createUnifiedDiff).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, { id: "fast-1", ok: true, diff: { hunks: [], text: "a" } });
    expect(postMessage).toHaveBeenNthCalledWith(2, { id: "fast-2", ok: true, diff: { hunks: [], text: "b" } });
  });

  it("accepts large payloads and deep nesting", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();
    const diffResult = { hunks: [], text: "large" };

    isPlainObject.mockReturnValue(true);
    createUnifiedDiff.mockReturnValue(diffResult);

    const hugeText = "A".repeat(200000);
    const longText = "B".repeat(10000);
    let deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i <= 40; i += 1) {
      cursor.child = { level: i };
      cursor = cursor.child;
    }

    const options = { beforeText: hugeText, afterText: longText, extra: { deep } };

    self.onmessage({ data: { id: "large", options } });

    expect(createUnifiedDiff).toHaveBeenCalledWith(options);
    const passedOptions = createUnifiedDiff.mock.calls[0][0];
    expect(passedOptions).toBe(options);
    expect(passedOptions.beforeText.length).toBe(200000);
    expect(passedOptions.afterText.length).toBe(10000);
    expect(passedOptions.extra.deep.child.child).toBeDefined();
    expect(postMessage).toHaveBeenCalledWith({ id: "large", ok: true, diff: diffResult });
  });

  it("posts error responses when createUnifiedDiff throws an Error", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();

    isPlainObject.mockReturnValue(true);
    createUnifiedDiff.mockImplementation(() => {
      throw new Error("boom");
    });

    self.onmessage({ data: { id: "err-1", options: {} } });

    expect(postMessage).toHaveBeenCalledWith({ id: "err-1", ok: false, error: "boom" });
  });

  it("stringifies non-Error throwables", async () => {
    const { self, postMessage, createUnifiedDiff, isPlainObject } = await setupWorker();

    isPlainObject.mockReturnValue(true);
    createUnifiedDiff.mockImplementation(() => {
      throw 0;
    });

    self.onmessage({ data: { id: "err-2", options: {} } });

    expect(postMessage).toHaveBeenCalledWith({ id: "err-2", ok: false, error: "0" });
  });
});
