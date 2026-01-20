import { describe, it, expect, vi, beforeEach } from "vitest";

let isPlainObjectMock;
let postMessage;
let restoreSelf = null;

vi.mock("../../../../js/agents/shared/index.js", () => {
  isPlainObjectMock = vi.fn();
  return { isPlainObject: isPlainObjectMock };
});

const MODULE_PATH = "../../../../js/agents/vfs/glob.worker.js";

function collectMessages() {
  return postMessage.mock.calls.map(([message]) => message);
}

function findMessage(id) {
  return collectMessages().find((message) => message.id === id);
}

beforeEach(async () => {
  if (restoreSelf) {
    restoreSelf();
    restoreSelf = null;
  }

  const originalSelf = globalThis.self;
  postMessage = vi.fn();
  globalThis.self = { postMessage };

  vi.resetModules();
  await import(MODULE_PATH);

  restoreSelf = () => {
    if (originalSelf === undefined) {
      delete globalThis.self;
    } else {
      globalThis.self = originalSelf;
    }
  };

  isPlainObjectMock.mockReset();
  isPlainObjectMock.mockImplementation(
    (value) => value && typeof value === "object" && !Array.isArray(value),
  );
});

describe("self.onmessage", () => {
  it("ignores events without a valid id", () => {
    globalThis.self.onmessage({});
    globalThis.self.onmessage({ data: null });
    globalThis.self.onmessage({ data: undefined });
    globalThis.self.onmessage({ data: {} });
    globalThis.self.onmessage({ data: { id: "" } });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("defaults to empty options when data is not a plain object", () => {
    isPlainObjectMock.mockReturnValue(false);
    const data = [];
    data.id = "np";
    data.pattern = "**/*.js";
    data.base = "src";
    data.files = ["src/index.js"];

    globalThis.self.onmessage({ data });

    expect(postMessage).toHaveBeenCalledWith({ id: "np", ok: true, matches: [] });
  });

  it("handles null/undefined values and non-array files", () => {
    globalThis.self.onmessage({
      data: { id: "empty-array", pattern: "", base: "", files: [] },
    });
    globalThis.self.onmessage({
      data: { id: "object-files", pattern: null, base: undefined, files: {} },
    });

    expect(findMessage("empty-array")).toEqual({
      id: "empty-array",
      ok: true,
      matches: [],
    });
    expect(findMessage("object-files")).toEqual({
      id: "object-files",
      ok: true,
      matches: [],
    });
  });

  it("matches base-relative paths with brace expansion and ? wildcard", () => {
    const files = [
      "src/lib/file1.js",
      "src/lib/file10.js",
      "src/bin/file2.ts",
      "src/bin/fileA.ts",
      "src/bin/fileB.jsx",
      "src/lib/other.js",
    ];

    globalThis.self.onmessage({
      data: {
        id: "brace",
        pattern: "{lib,bin}/file?.{js,ts}",
        base: " ./src/ ",
        files,
      },
    });

    expect(findMessage("brace").matches).toEqual([
      "src/lib/file1.js",
      "src/bin/file2.ts",
      "src/bin/fileA.ts",
    ]);
  });

  it("supports ** patterns and backslash normalization", () => {
    const files = [
      "src/test1.js",
      "src/deep/test2.js",
      "src/deep/nested/test3.js",
      "src/test12.js",
      "src/deep/testA.jsx",
      "src/atest1.js",
    ];

    globalThis.self.onmessage({
      data: {
        id: "globstar",
        pattern: "src\\**\\test?.js",
        base: "",
        files,
      },
    });

    expect(findMessage("globstar").matches).toEqual([
      "src/test1.js",
      "src/deep/test2.js",
      "src/deep/nested/test3.js",
    ]);
  });

  it("skips empty rel paths and non-string entries", () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 40; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const files = [
      "",
      "base/",
      "base/file.txt",
      "base/.gitignore",
      "base/dir/file.js",
      deep,
      0,
      -1,
      null,
      undefined,
      { a: 1 },
    ];

    globalThis.self.onmessage({
      data: { id: "skip", pattern: "*.*", base: "base", files },
    });

    expect(findMessage("skip")).toEqual({
      id: "skip",
      ok: true,
      matches: ["base/file.txt", "base/.gitignore"],
    });
  });

  it("coerces numeric and whitespace patterns", () => {
    const max = Number.MAX_SAFE_INTEGER;

    globalThis.self.onmessage({
      data: { id: "zero", pattern: 0, files: ["0", "00"] },
    });
    globalThis.self.onmessage({
      data: { id: "neg", pattern: -1, files: ["-1", "1"] },
    });
    globalThis.self.onmessage({
      data: { id: "max", pattern: max, files: [String(max), "other"] },
    });
    globalThis.self.onmessage({
      data: { id: "ws", pattern: "   ", files: ["", " ", "a"] },
    });
    globalThis.self.onmessage({
      data: { id: "num-str", pattern: "42", files: ["42", "0042"] },
    });

    expect(findMessage("zero").matches).toEqual(["0"]);
    expect(findMessage("neg").matches).toEqual(["-1"]);
    expect(findMessage("max").matches).toEqual([String(max)]);
    expect(findMessage("ws").matches).toEqual([]);
    expect(findMessage("num-str").matches).toEqual(["42"]);
  });

  it("handles large file lists and very long names", () => {
    const longName = "a".repeat(20000);
    const files = Array.from({ length: 1000 }, (_, i) => `item-${i}.log`);
    files.splice(500, 0, longName);

    globalThis.self.onmessage({
      data: { id: "large", pattern: "*", files },
    });

    const result = findMessage("large");
    expect(result.matches).toHaveLength(files.length);
    expect(result.matches).toContain(longName);
  });

  it("posts error responses when regex compilation fails", () => {
    const originalRegExp = globalThis.RegExp;
    globalThis.RegExp = function () {
      throw new Error("boom");
    };

    try {
      globalThis.self.onmessage({
        data: { id: "err", pattern: "*", files: ["a"] },
      });
    } finally {
      globalThis.RegExp = originalRegExp;
    }

    expect(postMessage).toHaveBeenCalledWith({
      id: "err",
      ok: false,
      error: "boom",
    });
  });

  it("supports concurrent calls without state bleed", async () => {
    const events = [
      { id: "c1", pattern: "*.js", files: ["a.js", "b.ts"] },
      { id: "c2", pattern: "dir/**", files: ["dir/a", "dir/sub/b", "other"] },
      { id: "c3", pattern: "?.txt", files: ["a.txt", "ab.txt"] },
    ];

    await Promise.all(
      events.map((data) => Promise.resolve().then(() => globalThis.self.onmessage({ data }))),
    );

    expect(findMessage("c1").matches).toEqual(["a.js"]);
    expect(findMessage("c2").matches).toEqual(["dir/a", "dir/sub/b"]);
    expect(findMessage("c3").matches).toEqual(["a.txt"]);
  });

  it("handles rapid consecutive calls", () => {
    for (let i = 0; i < 5; i += 1) {
      globalThis.self.onmessage({
        data: { id: `msg-${i}`, pattern: "*", files: [`file-${i}`] },
      });
    }

    expect(postMessage).toHaveBeenCalledTimes(5);
    const ids = postMessage.mock.calls.map(([message]) => message.id);
    expect(ids).toHaveLength(5);
    expect(ids).toEqual(
      expect.arrayContaining(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]),
    );
  });
});
