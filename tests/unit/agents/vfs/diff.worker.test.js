import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/vfs/diff.js", () => ({
  createUnifiedDiff: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: vi.fn(),
}));

let createUnifiedDiff;
let isPlainObject;

function prepareWorkerSelf() {
  if (globalThis.self && typeof globalThis.self === "object") {
    globalThis.self.postMessage = vi.fn();
    globalThis.self.onmessage = undefined;
    return { workerSelf: globalThis.self, postMessage: globalThis.self.postMessage };
  }

  const workerSelf = { postMessage: vi.fn(), onmessage: undefined };
  try {
    globalThis.self = workerSelf;
  } catch {
    Object.defineProperty(globalThis, "self", { value: workerSelf, configurable: true, writable: true });
  }
  return { workerSelf, postMessage: workerSelf.postMessage };
}

async function loadWorker() {
  const { workerSelf, postMessage } = prepareWorkerSelf();
  await import("../../../../js/agents/vfs/diff.worker.js");

  const onmessage = workerSelf.onmessage;
  if (typeof onmessage !== "function") {
    throw new Error("Expected self.onmessage to be a function");
  }

  return { workerSelf, onmessage, postMessage };
}

beforeEach(async () => {
  vi.resetModules();

  ({ createUnifiedDiff } = await import("../../../../js/agents/vfs/diff.js"));
  ({ isPlainObject } = await import("../../../../js/agents/shared/index.js"));

  createUnifiedDiff.mockReset();
  isPlainObject.mockReset();

  isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
});

describe("js/agents/vfs/diff.worker.js", () => {
  describe("module initialization", () => {
    it("registers self.onmessage", async () => {
      const { workerSelf } = await loadWorker();
      expect(typeof workerSelf.onmessage).toBe("function");
    });
  });

  describe("self.onmessage", () => {
    it("posts ok response with diff for plain options", async () => {
      const diff = { hunks: [{ a: 1 }], text: "u-diff" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage, postMessage } = await loadWorker();
      const options = { path: "file.txt", beforeText: "a", afterText: "b", context: 3 };

      onmessage({ data: { id: "req-1", options } });

      expect(isPlainObject).toHaveBeenCalledWith(options);
      expect(createUnifiedDiff).toHaveBeenCalledWith(options);
      expect(createUnifiedDiff.mock.calls[0][0]).toBe(options);
      expect(postMessage).toHaveBeenCalledWith({ id: "req-1", ok: true, diff });
    });

    it.each([
      ["empty object", {}],
      ["empty strings + context 0", { path: "", beforeText: "", afterText: "", context: 0 }],
      ["whitespace strings + context -1", { path: "   ", beforeText: " \n\t", afterText: "   ", context: -1 }],
      ["MAX_SAFE_INTEGER context", { path: "x", beforeText: "a", afterText: "b", context: Number.MAX_SAFE_INTEGER }],
      ["string context", { path: "x", beforeText: "a", afterText: "b", context: "3" }],
      ["object context", { path: "x", beforeText: "a", afterText: "b", context: { n: 3 } }],
      ["array beforeText", { path: "x", beforeText: ["a"], afterText: "b", context: 1 }],
    ])("forwards plain options unchanged (%s)", async (_label, options) => {
      const diff = { hunks: [], text: "ok" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage, postMessage } = await loadWorker();
      onmessage({ data: { id: "id", options } });

      expect(isPlainObject).toHaveBeenCalledWith(options);
      expect(createUnifiedDiff).toHaveBeenCalledWith(options);
      expect(createUnifiedDiff.mock.calls[0][0]).toBe(options);
      expect(postMessage).toHaveBeenCalledWith({ id: "id", ok: true, diff });
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["whitespace string", "   "],
      ["number 0", 0],
      ["number -1", -1],
      ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
      ["empty array", []],
      ["array", [1, 2]],
      ["date", new Date(0)],
      ["function", () => {}],
    ])("defaults options to {} when not plain (%s)", async (_label, options) => {
      const diff = { hunks: [], text: "ok" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage, postMessage } = await loadWorker();
      onmessage({ data: { id: "id", options } });

      expect(isPlainObject).toHaveBeenCalledWith(options);
      expect(createUnifiedDiff).toHaveBeenCalledTimes(1);
      expect(createUnifiedDiff.mock.calls[0][0]).toEqual({});
      expect(postMessage).toHaveBeenCalledWith({ id: "id", ok: true, diff });
    });

    it("uses {} when isPlainObject returns false (even for objects)", async () => {
      isPlainObject.mockReturnValue(false);

      const diff = { hunks: [], text: "ok" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage } = await loadWorker();
      const options = { path: "x" };

      onmessage({ data: { id: "id", options } });

      expect(isPlainObject).toHaveBeenCalledWith(options);
      expect(createUnifiedDiff).toHaveBeenCalledTimes(1);
      expect(createUnifiedDiff.mock.calls[0][0]).toEqual({});
    });

    it.each([
      ["undefined event", undefined],
      ["null event", null],
      ["empty object event", {}],
      ["event with undefined data", { data: undefined }],
      ["event with null data", { data: null }],
      ["event with empty string data", { data: "" }],
      ["event with number data (0)", { data: 0 }],
      ["event with array data", { data: [] }],
      ["event with string data", { data: "x" }],
      ["event with data missing id/options", { data: {} }],
    ])("handles missing/invalid event/data (%s)", async (_label, event) => {
      const diff = { hunks: [], text: "ok" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage, postMessage } = await loadWorker();

      expect(() => onmessage(event)).not.toThrow();
      expect(createUnifiedDiff).toHaveBeenCalledTimes(1);
      expect(createUnifiedDiff.mock.calls[0][0]).toEqual({});
      expect(postMessage).toHaveBeenCalledWith({ id: undefined, ok: true, diff });
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["0", 0],
      ["-1", -1],
      ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ])("preserves id value (%s)", async (_label, id) => {
      const diff = { hunks: [], text: "ok" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage, postMessage } = await loadWorker();
      onmessage({ data: { id, options: {} } });

      expect(postMessage).toHaveBeenCalledWith({ id, ok: true, diff });
    });

    it.each([
      ["Error with message", new Error("boom"), "boom"],
      ["string", "fail", "fail"],
      ["undefined", undefined, "undefined"],
      ["object with empty message", { message: "" }, "[object Object]"],
      ["object with message", { message: "x" }, "x"],
      ["object with message 0", { message: 0 }, "[object Object]"],
    ])("posts error when createUnifiedDiff throws (%s)", async (_label, thrown, expectedError) => {
      createUnifiedDiff.mockImplementation(() => {
        throw thrown;
      });

      const { onmessage, postMessage } = await loadWorker();
      onmessage({ data: { id: "e", options: {} } });

      expect(postMessage).toHaveBeenCalledWith({ id: "e", ok: false, error: expectedError });
    });

    it("propagates error if isPlainObject throws (no postMessage)", async () => {
      isPlainObject.mockImplementation(() => {
        throw new Error("nope");
      });

      const { onmessage, postMessage } = await loadWorker();

      expect(() => onmessage({ data: { id: "x", options: {} } })).toThrow("nope");
      expect(createUnifiedDiff).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    });

    it("handles rapid consecutive messages independently (mixed ok/error)", async () => {
      createUnifiedDiff.mockImplementation((opts) => {
        if (opts?.path === "err") throw new Error("bad");
        return { hunks: [opts?.path ?? null], text: String(opts?.afterText ?? "") };
      });

      const { onmessage, postMessage } = await loadWorker();

      const payloads = [
        { id: "1", options: { path: "a", afterText: "A" } },
        { id: "2", options: { path: "err", afterText: "B" } },
        { id: "3", options: null },
        { id: "4", options: { path: "c", afterText: "" } },
      ];

      await Promise.all(payloads.map((data) => Promise.resolve().then(() => onmessage({ data }))));

      expect(createUnifiedDiff).toHaveBeenCalledTimes(payloads.length);

      const posted = postMessage.mock.calls.map(([msg]) => msg);
      expect(posted).toEqual(
        expect.arrayContaining([
          { id: "1", ok: true, diff: { hunks: ["a"], text: "A" } },
          { id: "2", ok: false, error: "bad" },
          { id: "3", ok: true, diff: { hunks: [null], text: "" } },
          { id: "4", ok: true, diff: { hunks: ["c"], text: "" } },
        ]),
      );
    });

    it("forwards very large strings and deep nested objects", async () => {
      const diff = { hunks: [], text: "ok" };
      createUnifiedDiff.mockReturnValue(diff);

      const { onmessage } = await loadWorker();

      const beforeText = "a".repeat(1_000_000);
      const afterText = "b".repeat(1_000_000);

      let nested = { depth: 0 };
      for (let i = 1; i <= 500; i += 1) nested = { depth: i, next: nested };

      const options = {
        path: "big.txt",
        beforeText,
        afterText,
        context: Number.MAX_SAFE_INTEGER,
        meta: nested,
      };

      onmessage({ data: { id: "big", options } });

      expect(createUnifiedDiff).toHaveBeenCalledWith(options);
    });
  });
});