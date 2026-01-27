import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/plugins/transports/index.js";

const state = vi.hoisted(() => ({
  platformIsNode: true,
  nodeExports: {},
  browserExports: {},
  nodeImportError: null,
  browserImportError: null,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  Platform: {
    get isNode() {
      return state.platformIsNode;
    },
  },
}));

vi.mock("../../../../../js/agents/plugins/transports/index.node.js", () => {
  if (state.nodeImportError) throw state.nodeImportError;
  return state.nodeExports;
});

vi.mock("../../../../../js/agents/plugins/transports/index.browser.js", () => {
  if (state.browserImportError) throw state.browserImportError;
  return state.browserExports;
});

async function importUnderTest() {
  return await import(MODULE_PATH);
}

function makeDeepObject(depth) {
  const root = {};
  let cur = root;
  for (let i = 0; i < depth; i++) {
    cur.next = {};
    cur = cur.next;
  }
  return root;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  state.platformIsNode = true;
  state.nodeImportError = null;
  state.browserImportError = null;
  state.nodeExports = {};
  state.browserExports = {};
});

describe("ProcessTransport", () => {
  it("selects node implementation when Platform.isNode is true", async () => {
    class NodeProcessTransport {}
    class BrowserProcessTransport {}

    state.platformIsNode = true;
    state.nodeExports = { ProcessTransport: NodeProcessTransport };
    state.browserExports = { ProcessTransport: BrowserProcessTransport };

    const mod = await importUnderTest();
    expect(mod.ProcessTransport).toBe(NodeProcessTransport);
  });

  it("selects browser implementation when Platform.isNode is false", async () => {
    class NodeProcessTransport {}
    class BrowserProcessTransport {}

    state.platformIsNode = false;
    state.nodeExports = { ProcessTransport: NodeProcessTransport };
    state.browserExports = { ProcessTransport: BrowserProcessTransport };

    const mod = await importUnderTest();
    expect(mod.ProcessTransport).toBe(BrowserProcessTransport);
  });

  it("handles isNode boundary types (truthy string vs 0) deterministically", async () => {
    class NodeProcessTransport {}
    class BrowserProcessTransport {}

    state.platformIsNode = "0";
    state.nodeExports = { ProcessTransport: NodeProcessTransport };
    state.browserExports = { ProcessTransport: BrowserProcessTransport };

    const modTruthyString = await importUnderTest();
    expect(modTruthyString.ProcessTransport).toBe(NodeProcessTransport);

    vi.resetModules();

    state.platformIsNode = 0;
    const modZero = await importUnderTest();
    expect(modZero.ProcessTransport).toBe(BrowserProcessTransport);
  });

  it("is undefined if selected implementation omits it", async () => {
    state.platformIsNode = true;
    state.nodeExports = {};
    state.browserExports = { ProcessTransport: class BrowserProcessTransport {} };

    const mod = await importUnderTest();
    expect(mod.ProcessTransport).toBeUndefined();
  });
});

describe("createProcessTransport", () => {
  it("re-exports the selected implementation function reference (node)", async () => {
    const createProcessTransport = vi.fn(async () => ({ ok: true }));

    state.platformIsNode = true;
    state.nodeExports = { createProcessTransport };
    state.browserExports = { createProcessTransport: vi.fn() };

    const mod = await importUnderTest();
    expect(mod.createProcessTransport).toBe(createProcessTransport);
  });

  it("passes through normal path, boundaries, and propagates errors (node)", async () => {
    const createProcessTransport = vi.fn(async (options) => {
      await Promise.resolve();

      if (options == null) throw new TypeError("options is required");
      if (typeof options !== "object" || Array.isArray(options))
        throw new TypeError("options must be an object");

      const { cmd, args, timeoutMs, payload } = options ?? {};

      if (typeof cmd !== "string") throw new TypeError("cmd must be a string");
      if (cmd.trim() === "") throw new RangeError("cmd cannot be empty/blank");

      if (!Array.isArray(args)) throw new TypeError("args must be an array");
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs))
        throw new TypeError("timeoutMs must be a finite number");

      return {
        cmdLen: cmd.length,
        argsLen: args.length,
        timeoutMs,
        payloadTag:
          payload == null
            ? "nullish"
            : payload instanceof Uint8Array
              ? `u8:${payload.byteLength}`
              : typeof payload,
      };
    });

    state.platformIsNode = true;
    state.nodeExports = { createProcessTransport };
    state.browserExports = { createProcessTransport: vi.fn() };

    const mod = await importUnderTest();

    // 空值: null / undefined
    await expect(mod.createProcessTransport(null)).rejects.toThrow(TypeError);
    await expect(mod.createProcessTransport(undefined)).rejects.toThrow(TypeError);

    // 空数组 / 空对象 (类型边界也覆盖)
    await expect(mod.createProcessTransport([])).rejects.toThrow(TypeError);
    await expect(mod.createProcessTransport({})).rejects.toThrow(TypeError);

    // cmd 空字符串 / 空白字符串
    await expect(
      mod.createProcessTransport({ cmd: "", args: [], timeoutMs: 0 }),
    ).rejects.toThrow(RangeError);
    await expect(
      mod.createProcessTransport({ cmd: "   ", args: [], timeoutMs: 0 }),
    ).rejects.toThrow(RangeError);

    // 类型边界: 字符串当数字传入
    await expect(
      mod.createProcessTransport({ cmd: "tool", args: [], timeoutMs: "1000" }),
    ).rejects.toThrow(TypeError);

    // 类型边界: 对象当数组传入
    await expect(
      mod.createProcessTransport({ cmd: "tool", args: {}, timeoutMs: 0 }),
    ).rejects.toThrow(TypeError);

    // 边界值: 0 / -1 / MAX_SAFE_INTEGER + 空数组作为 args
    const r0 = await mod.createProcessTransport({
      cmd: "tool",
      args: [],
      timeoutMs: 0,
      payload: null,
    });
    expect(r0).toEqual({
      cmdLen: 4,
      argsLen: 0,
      timeoutMs: 0,
      payloadTag: "nullish",
    });

    const rNeg = await mod.createProcessTransport({
      cmd: "tool",
      args: ["x"],
      timeoutMs: -1,
      payload: undefined,
    });
    expect(rNeg).toEqual({
      cmdLen: 4,
      argsLen: 1,
      timeoutMs: -1,
      payloadTag: "nullish",
    });

    const rMax = await mod.createProcessTransport({
      cmd: "tool",
      args: ["x", "y"],
      timeoutMs: Number.MAX_SAFE_INTEGER,
      payload: "",
    });
    expect(rMax).toEqual({
      cmdLen: 4,
      argsLen: 2,
      timeoutMs: Number.MAX_SAFE_INTEGER,
      payloadTag: "string",
    });

    // 资源边界: 超长字符串 / 超大文件(用 Uint8Array 模拟) / 深层嵌套
    const longCmd = "x".repeat(200_000);
    const bigPayload = new Uint8Array(1_000_000);
    const deep = makeDeepObject(2000);

    const rRes = await mod.createProcessTransport({
      cmd: longCmd,
      args: [],
      timeoutMs: 0,
      payload: { bigPayload, deep },
    });
    expect(rRes.cmdLen).toBe(200_000);
    expect(rRes.argsLen).toBe(0);
    expect(rRes.timeoutMs).toBe(0);
    expect(rRes.payloadTag).toBe("object");

    expect(createProcessTransport).toHaveBeenCalled();
  });

  it("supports concurrency boundaries (simultaneous + rapid calls)", async () => {
    const createProcessTransport = vi.fn(async (options) => {
      await Promise.resolve();
      return options;
    });

    state.platformIsNode = true;
    state.nodeExports = { createProcessTransport };
    state.browserExports = { createProcessTransport: vi.fn() };

    const mod = await importUnderTest();

    const simultaneous = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        mod.createProcessTransport({
          cmd: `tool${i}`,
          args: [],
          timeoutMs: i,
        }),
      ),
    );
    expect(simultaneous).toHaveLength(25);
    expect(createProcessTransport).toHaveBeenCalledTimes(25);

    for (let i = 0; i < 10; i++) {
      // 快速连续调用
      // eslint-disable-next-line no-await-in-loop
      await mod.createProcessTransport({ cmd: "tool", args: [], timeoutMs: i });
    }
    expect(createProcessTransport).toHaveBeenCalledTimes(35);
  });

  it("selects browser implementation when Platform.isNode is false", async () => {
    const nodeFn = vi.fn(async () => "node");
    const browserFn = vi.fn(async () => "browser");

    state.platformIsNode = false;
    state.nodeExports = { createProcessTransport: nodeFn };
    state.browserExports = { createProcessTransport: browserFn };

    const mod = await importUnderTest();
    expect(mod.createProcessTransport).toBe(browserFn);
    await expect(mod.createProcessTransport()).resolves.toBe("browser");
    expect(nodeFn).not.toHaveBeenCalled();
  });
});

describe("BinarySkillProvider", () => {
  it("selects node implementation class when Platform.isNode is true", async () => {
    class NodeBinarySkillProvider {
      constructor(config) {
        if (config == null) throw new TypeError("config is required");
        this.config = config;
      }
    }
    class BrowserBinarySkillProvider {}

    state.platformIsNode = true;
    state.nodeExports = { BinarySkillProvider: NodeBinarySkillProvider };
    state.browserExports = { BinarySkillProvider: BrowserBinarySkillProvider };

    const mod = await importUnderTest();
    expect(mod.BinarySkillProvider).toBe(NodeBinarySkillProvider);

    const instance = new mod.BinarySkillProvider({ name: "ok" });
    expect(instance).toBeInstanceOf(NodeBinarySkillProvider);
    expect(instance.config).toEqual({ name: "ok" });

    expect(() => new mod.BinarySkillProvider(null)).toThrow(TypeError);
    expect(() => new mod.BinarySkillProvider(undefined)).toThrow(TypeError);
  });

  it("selects browser implementation class when Platform.isNode is false", async () => {
    class NodeBinarySkillProvider {}
    class BrowserBinarySkillProvider {
      constructor(x) {
        this.x = x;
      }
    }

    state.platformIsNode = false;
    state.nodeExports = { BinarySkillProvider: NodeBinarySkillProvider };
    state.browserExports = { BinarySkillProvider: BrowserBinarySkillProvider };

    const mod = await importUnderTest();
    expect(mod.BinarySkillProvider).toBe(BrowserBinarySkillProvider);

    const instance = new mod.BinarySkillProvider("hi");
    expect(instance).toBeInstanceOf(BrowserBinarySkillProvider);
    expect(instance.x).toBe("hi");
  });

  it("is undefined if selected implementation omits it", async () => {
    state.platformIsNode = false;
    state.nodeExports = { BinarySkillProvider: class NodeBinarySkillProvider {} };
    state.browserExports = {};

    const mod = await importUnderTest();
    expect(mod.BinarySkillProvider).toBeUndefined();
  });
});

describe("createBinarySkillProvider", () => {
  it("re-exports the selected implementation function reference (browser)", async () => {
    const createBinarySkillProvider = vi.fn(async () => ({ ok: true }));

    state.platformIsNode = false;
    state.nodeExports = { createBinarySkillProvider: vi.fn() };
    state.browserExports = { createBinarySkillProvider };

    const mod = await importUnderTest();
    expect(mod.createBinarySkillProvider).toBe(createBinarySkillProvider);
  });

  it("covers normal path, boundary values, type edges, resource edges, and error propagation", async () => {
    const createBinarySkillProvider = vi.fn(async (spec) => {
      await Promise.resolve();

      if (spec == null) throw new TypeError("spec is required");
      if (typeof spec !== "object" || Array.isArray(spec))
        throw new TypeError("spec must be an object");

      const { binaryPath, args, maxConcurrency, meta } = spec ?? {};

      if (typeof binaryPath !== "string")
        throw new TypeError("binaryPath must be a string");
      if (binaryPath.trim() === "")
        throw new RangeError("binaryPath cannot be empty/blank");

      if (!Array.isArray(args)) throw new TypeError("args must be an array");
      if (
        typeof maxConcurrency !== "number" ||
        !Number.isFinite(maxConcurrency)
      ) {
        throw new TypeError("maxConcurrency must be a finite number");
      }

      return {
        binaryPathLen: binaryPath.length,
        argsLen: args.length,
        maxConcurrency,
        metaType: meta == null ? "nullish" : typeof meta,
      };
    });

    state.platformIsNode = true;
    state.nodeExports = { createBinarySkillProvider };
    state.browserExports = { createBinarySkillProvider: vi.fn() };

    const mod = await importUnderTest();

    // 空值: null / undefined
    await expect(mod.createBinarySkillProvider(null)).rejects.toThrow(TypeError);
    await expect(mod.createBinarySkillProvider(undefined)).rejects.toThrow(
      TypeError,
    );

    // 空数组 / 空对象
    await expect(mod.createBinarySkillProvider([])).rejects.toThrow(TypeError);
    await expect(mod.createBinarySkillProvider({})).rejects.toThrow(TypeError);

    // binaryPath 空字符串 / 空白字符串
    await expect(
      mod.createBinarySkillProvider({
        binaryPath: "",
        args: [],
        maxConcurrency: 0,
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      mod.createBinarySkillProvider({
        binaryPath: "   ",
        args: [],
        maxConcurrency: 0,
      }),
    ).rejects.toThrow(RangeError);

    // 类型边界: 字符串当数字传入
    await expect(
      mod.createBinarySkillProvider({
        binaryPath: "tool",
        args: [],
        maxConcurrency: "2",
      }),
    ).rejects.toThrow(TypeError);

    // 类型边界: 对象当数组传入
    await expect(
      mod.createBinarySkillProvider({
        binaryPath: "tool",
        args: {},
        maxConcurrency: 1,
      }),
    ).rejects.toThrow(TypeError);

    // 边界值: 0 / -1 / MAX_SAFE_INTEGER + 空数组 args
    const r0 = await mod.createBinarySkillProvider({
      binaryPath: "tool",
      args: [],
      maxConcurrency: 0,
      meta: "",
    });
    expect(r0).toEqual({
      binaryPathLen: 4,
      argsLen: 0,
      maxConcurrency: 0,
      metaType: "string",
    });

    const rNeg = await mod.createBinarySkillProvider({
      binaryPath: "tool",
      args: ["--x"],
      maxConcurrency: -1,
      meta: undefined,
    });
    expect(rNeg).toEqual({
      binaryPathLen: 4,
      argsLen: 1,
      maxConcurrency: -1,
      metaType: "nullish",
    });

    const rMax = await mod.createBinarySkillProvider({
      binaryPath: "tool",
      args: ["--x", "--y"],
      maxConcurrency: Number.MAX_SAFE_INTEGER,
      meta: null,
    });
    expect(rMax).toEqual({
      binaryPathLen: 4,
      argsLen: 2,
      maxConcurrency: Number.MAX_SAFE_INTEGER,
      metaType: "nullish",
    });

    // 资源边界: 超长字符串 / 超大文件(用 Uint8Array 模拟) / 深层嵌套
    const longPath = "p".repeat(150_000);
    const bigPayload = new Uint8Array(1_000_000);
    const deep = makeDeepObject(1500);

    const rRes = await mod.createBinarySkillProvider({
      binaryPath: longPath,
      args: [],
      maxConcurrency: 1,
      meta: { bigPayload, deep },
    });
    expect(rRes.binaryPathLen).toBe(150_000);
    expect(rRes.argsLen).toBe(0);
    expect(rRes.maxConcurrency).toBe(1);
    expect(rRes.metaType).toBe("object");

    expect(createBinarySkillProvider).toHaveBeenCalled();
  });

  it("supports concurrency boundaries (simultaneous + rapid calls)", async () => {
    const createBinarySkillProvider = vi.fn(async (spec) => {
      await Promise.resolve();
      return spec?.id ?? null;
    });

    state.platformIsNode = false;
    state.nodeExports = { createBinarySkillProvider: vi.fn() };
    state.browserExports = { createBinarySkillProvider };

    const mod = await importUnderTest();

    const ids = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        mod.createBinarySkillProvider({
          id: i,
          binaryPath: "tool",
          args: [],
          maxConcurrency: 1,
        }),
      ),
    );
    expect(ids).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(createBinarySkillProvider).toHaveBeenCalledTimes(30);

    for (let i = 0; i < 12; i++) {
      // eslint-disable-next-line no-await-in-loop
      await mod.createBinarySkillProvider({
        id: `r${i}`,
        binaryPath: "tool",
        args: [],
        maxConcurrency: 1,
      });
    }
    expect(createBinarySkillProvider).toHaveBeenCalledTimes(42);
  });
});

describe("default", () => {
  it("default export exposes the same selected implementation namespace (node)", async () => {
    class NodeProcessTransport {}
    const createProcessTransport = vi.fn(async () => ({ kind: "pt" }));
    class NodeBinarySkillProvider {}
    const createBinarySkillProvider = vi.fn(async () => ({ kind: "bsp" }));

    state.platformIsNode = true;
    state.nodeExports = {
      ProcessTransport: NodeProcessTransport,
      createProcessTransport,
      BinarySkillProvider: NodeBinarySkillProvider,
      createBinarySkillProvider,
      extra: "node-only",
    };
    state.browserExports = {
      ProcessTransport: class BrowserProcessTransport {},
      createProcessTransport: vi.fn(async () => ({ kind: "pt-browser" })),
      BinarySkillProvider: class BrowserBinarySkillProvider {},
      createBinarySkillProvider: vi.fn(async () => ({ kind: "bsp-browser" })),
      extra: "browser-only",
    };

    const mod = await importUnderTest();

    expect(mod.default.ProcessTransport).toBe(mod.ProcessTransport);
    expect(mod.default.createProcessTransport).toBe(mod.createProcessTransport);
    expect(mod.default.BinarySkillProvider).toBe(mod.BinarySkillProvider);
    expect(mod.default.createBinarySkillProvider).toBe(
      mod.createBinarySkillProvider,
    );
    expect(mod.default.extra).toBe("node-only");
  });

  it("default export selects browser impl for falsey isNode values (null/undefined/empty string)", async () => {
    class NodeProcessTransport {}
    class BrowserProcessTransport {}

    state.nodeExports = { ProcessTransport: NodeProcessTransport };
    state.browserExports = { ProcessTransport: BrowserProcessTransport };

    state.platformIsNode = null;
    const modNull = await importUnderTest();
    expect(modNull.default.ProcessTransport).toBe(BrowserProcessTransport);

    vi.resetModules();

    state.platformIsNode = undefined;
    const modUndef = await importUnderTest();
    expect(modUndef.default.ProcessTransport).toBe(BrowserProcessTransport);

    vi.resetModules();

    state.platformIsNode = "";
    const modEmptyStr = await importUnderTest();
    expect(modEmptyStr.default.ProcessTransport).toBe(BrowserProcessTransport);
  });

  it("propagates errors when the selected implementation module fails to import", async () => {
    state.platformIsNode = true;
    state.nodeImportError = new Error("node import failed");
    state.browserExports = {};

    await expect(importUnderTest()).rejects.toThrow("node import failed");
  });

  it("propagates errors when browser implementation module fails to import", async () => {
    state.platformIsNode = false;
    state.browserImportError = new Error("browser import failed");
    state.nodeExports = {};

    await expect(importUnderTest()).rejects.toThrow("browser import failed");
  });
});