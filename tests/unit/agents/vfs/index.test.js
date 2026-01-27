import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  Platform: { isNode: false },
  createBrowserVfs: vi.fn(),
  createNodeVfs: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  Platform: mocks.Platform,
}));

vi.mock("../../../../js/agents/vfs/index.browser.js", () => ({
  createVfs: mocks.createBrowserVfs,
}));

vi.mock("../../../../js/agents/vfs/index.node.js", () => ({
  createVfs: mocks.createNodeVfs,
}));

async function importCreateVfs() {
  const mod = await import("../../../../js/agents/vfs/index.js");
  return mod.createVfs;
}

function makeDeepNested(depth) {
  let root = { level: 0 };
  let cur = root;
  for (let i = 1; i <= depth; i++) {
    cur.next = { level: i };
    cur = cur.next;
  }
  return root;
}

beforeEach(() => {
  vi.resetModules();
  mocks.Platform.isNode = false;
  mocks.createBrowserVfs.mockReset();
  mocks.createNodeVfs.mockReset();
});

describe("createVfs", () => {
  describe("browser runtime (Platform.isNode=false)", () => {
    it("delegates to browser createVfs and returns its result", async () => {
      const createVfs = await importCreateVfs();

      const options = { kind: "memory", keyPrefix: "k" };
      const expected = { backend: "browser" };

      mocks.createBrowserVfs.mockReturnValue(expected);

      const result = await createVfs(options);

      expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(1);
      expect(mocks.createBrowserVfs).toHaveBeenCalledWith(options);
      expect(mocks.createNodeVfs).not.toHaveBeenCalled();
      expect(result).toBe(expected);
    });

    it("defaults options to {} when called with no arguments or undefined", async () => {
      const createVfs = await importCreateVfs();

      mocks.createBrowserVfs.mockReturnValue("ok");

      const r1 = await createVfs();
      const r2 = await createVfs(undefined);

      expect(r1).toBe("ok");
      expect(r2).toBe("ok");
      expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(2);

      const arg0 = mocks.createBrowserVfs.mock.calls[0][0];
      const arg1 = mocks.createBrowserVfs.mock.calls[1][0];

      expect(arg0).toEqual({});
      expect(arg1).toEqual({});
      expect(arg0).not.toBe(arg1);
    });

    it("forwards options objects containing empty/whitespace strings and empty containers (field boundaries)", async () => {
      const createVfs = await importCreateVfs();

      const options = {
        kind: "storage",
        rootDirName: "",
        rootPath: "   ",
        keyPrefix: "",
        preferOpfs: false,
        silent: true,
        storageAdapter: { kind: "dummy", keys: [] },
        extra: {
          emptyArray: [],
          emptyObject: {},
          numberBoundary0: 0,
          numberBoundaryNeg1: -1,
          numberBoundaryMax: Number.MAX_SAFE_INTEGER,
          stringAsNumber: "0",
          objectAsArray: { length: 0 },
        },
      };

      mocks.createBrowserVfs.mockReturnValue("ok");

      const out = await createVfs(options);

      expect(out).toBe("ok");
      expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(1);
      expect(mocks.createBrowserVfs.mock.calls[0][0]).toBe(options);
    });

    it.each([
      ["null", null],
      ["empty string", ""],
      ["whitespace string", " \t\n"],
      ["empty array", []],
      ["empty object", {}],
      ["0", 0],
      ["-1", -1],
      ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
      ["numeric string", "123"],
      ["array-like object", { length: 2, 0: "a", 1: "b" }],
    ])("forwards boundary input: %s", async (_name, value) => {
      const createVfs = await importCreateVfs();

      mocks.createBrowserVfs.mockImplementation((opts) => ({ opts }));

      const out = await createVfs(value);

      expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(1);
      expect(mocks.createBrowserVfs).toHaveBeenCalledWith(value);
      expect(out).toEqual({ opts: value });
    });

    it("handles very long strings, large payloads, and deeply nested options (resource boundaries)", async () => {
      const createVfs = await importCreateVfs();

      const longString = "x".repeat(100_000);
      const largePayload = "y".repeat(1_000_000);
      const deep = makeDeepNested(80);
      const options = { keyPrefix: longString, payload: largePayload, nested: deep };

      mocks.createBrowserVfs.mockReturnValue("ok");

      const out = await createVfs(options);

      expect(out).toBe("ok");
      expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(1);

      const passed = mocks.createBrowserVfs.mock.calls[0][0];
      expect(passed).toBe(options);
      expect(passed.keyPrefix).toBe(longString);
      expect(passed.payload).toBe(largePayload);
      expect(passed.nested).toBe(deep);
    });

    it("propagates synchronous errors from browser createVfs", async () => {
      const createVfs = await importCreateVfs();

      const err = new Error("browser boom");
      mocks.createBrowserVfs.mockImplementation(() => {
        throw err;
      });

      await expect(createVfs({})).rejects.toBe(err);
    });

    it("propagates rejected promises from browser createVfs", async () => {
      const createVfs = await importCreateVfs();

      const err = new Error("browser reject");
      mocks.createBrowserVfs.mockRejectedValue(err);

      await expect(createVfs({})).rejects.toBe(err);
    });

    it("supports rapid successive and concurrent calls without cross-talk (concurrency boundaries)", async () => {
      const createVfs = await importCreateVfs();

      mocks.createBrowserVfs.mockImplementation(async (opts) => ({ ok: true, opts }));

      const a = await createVfs({ id: 1 });
      const b = await createVfs({ id: 2 });
      const [c, d] = await Promise.all([createVfs({ id: 3 }), createVfs({ id: 4 })]);

      expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(4);
      expect(a.opts).toEqual({ id: 1 });
      expect(b.opts).toEqual({ id: 2 });
      expect(c.opts).toEqual({ id: 3 });
      expect(d.opts).toEqual({ id: 4 });
    });
  });

  describe("node runtime (Platform.isNode=true)", () => {
    beforeEach(() => {
      mocks.Platform.isNode = true;
    });

    it("delegates to node createVfs via dynamic import and returns its result", async () => {
      const createVfs = await importCreateVfs();

      const options = { kind: "nodefs", rootPath: "/tmp" };
      const expected = { backend: "node" };

      mocks.createNodeVfs.mockReturnValue(expected);

      const result = await createVfs(options);

      expect(mocks.createNodeVfs).toHaveBeenCalledTimes(1);
      expect(mocks.createNodeVfs).toHaveBeenCalledWith(options);
      expect(mocks.createBrowserVfs).not.toHaveBeenCalled();
      expect(result).toBe(expected);
    });

    it("defaults options to {} when called with no arguments or undefined", async () => {
      const createVfs = await importCreateVfs();

      mocks.createNodeVfs.mockReturnValue("ok");

      const r1 = await createVfs();
      const r2 = await createVfs(undefined);

      expect(r1).toBe("ok");
      expect(r2).toBe("ok");
      expect(mocks.createNodeVfs).toHaveBeenCalledTimes(2);

      const arg0 = mocks.createNodeVfs.mock.calls[0][0];
      const arg1 = mocks.createNodeVfs.mock.calls[1][0];

      expect(arg0).toEqual({});
      expect(arg1).toEqual({});
      expect(arg0).not.toBe(arg1);
    });

    it.each([
      ["null", null],
      ["whitespace string", "   "],
      ["empty array", []],
      ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
      ["numeric string", "123"],
      ["object passed as array-like", { length: 1, 0: "x" }],
    ])("forwards boundary input: %s", async (_name, value) => {
      const createVfs = await importCreateVfs();

      mocks.createNodeVfs.mockImplementation((opts) => ({ opts }));

      const out = await createVfs(value);

      expect(mocks.createNodeVfs).toHaveBeenCalledTimes(1);
      expect(mocks.createNodeVfs).toHaveBeenCalledWith(value);
      expect(out).toEqual({ opts: value });
    });

    it("propagates synchronous errors from node createVfs", async () => {
      const createVfs = await importCreateVfs();

      const err = new Error("node boom");
      mocks.createNodeVfs.mockImplementation(() => {
        throw err;
      });

      await expect(createVfs({})).rejects.toBe(err);
    });

    it("propagates rejected promises from node createVfs", async () => {
      const createVfs = await importCreateVfs();

      const err = new Error("node reject");
      mocks.createNodeVfs.mockRejectedValue(err);

      await expect(createVfs({})).rejects.toBe(err);
    });

    it("supports rapid successive and concurrent calls without cross-talk (concurrency boundaries)", async () => {
      const createVfs = await importCreateVfs();

      mocks.createNodeVfs.mockImplementation(async (opts) => ({ ok: true, opts }));

      const a = await createVfs({ id: 1 });
      const b = await createVfs({ id: 2 });
      const [c, d] = await Promise.all([createVfs({ id: 3 }), createVfs({ id: 4 })]);

      expect(mocks.createNodeVfs).toHaveBeenCalledTimes(4);
      expect(a.opts).toEqual({ id: 1 });
      expect(b.opts).toEqual({ id: 2 });
      expect(c.opts).toEqual({ id: 3 });
      expect(d.opts).toEqual({ id: 4 });
    });
  });

  it("selects backend based on Platform.isNode at call time", async () => {
    const createVfs = await importCreateVfs();

    mocks.createBrowserVfs.mockReturnValue("browser");
    mocks.createNodeVfs.mockReturnValue("node");

    mocks.Platform.isNode = false;
    const r1 = await createVfs({ a: 1 });

    mocks.Platform.isNode = true;
    const r2 = await createVfs({ b: 2 });

    mocks.Platform.isNode = false;
    const r3 = await createVfs({ c: 3 });

    expect(r1).toBe("browser");
    expect(r2).toBe("node");
    expect(r3).toBe("browser");

    expect(mocks.createBrowserVfs).toHaveBeenCalledTimes(2);
    expect(mocks.createNodeVfs).toHaveBeenCalledTimes(1);
  });
});