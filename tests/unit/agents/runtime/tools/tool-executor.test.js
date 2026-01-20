import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/tools/schema-validator.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/runtime/tools/schema-validator.js");
  return {
    ...actual,
    validateArgs: vi.fn(actual.validateArgs),
  };
});

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    isNodeLike: vi.fn(actual.isNodeLike),
  };
});

vi.mock("../../../../../js/agents/runtime/hooks/hook-runner.js", () => ({
  createPreToolUseHook: vi.fn(() => async () => ({})),
}));

import DefaultToolExecutor, {
  ToolExecutor,
  createToolExecutor,
  executeTool,
  __test,
} from "../../../../../js/agents/runtime/tools/tool-executor.js";
import { validateArgs } from "../../../../../js/agents/runtime/tools/schema-validator.js";
import { isNodeLike } from "../../../../../js/agents/shared/index.js";
import { createPreToolUseHook } from "../../../../../js/agents/runtime/hooks/hook-runner.js";

const { WorkerPool } = __test;

const boundary = {
  nullValue: null,
  undefinedValue: undefined,
  emptyString: "",
  whitespaceString: "   ",
  emptyArray: [],
  emptyObject: {},
  zero: 0,
  negativeOne: -1,
  maxSafe: Number.MAX_SAFE_INTEGER,
  stringNumber: "123",
  objectAsArray: { 0: "a", length: 1 },
  longString: "x".repeat(100000),
  deepObject: { level1: { level2: { level3: { level4: { level5: { value: "deep" } } } } } },
  largeFile: { name: "big.bin", content: "x".repeat(50000) },
};

class WorkerSpyExecutor extends ToolExecutor {
  constructor(options) {
    super(options);
    this.workerCalls = [];
  }

  async _executeInWorker(moduleUrl, exportName, args, context, timeoutMs) {
    this.workerCalls.push({ moduleUrl, exportName, args, context, timeoutMs });
    return { ok: true, data: { moduleUrl, exportName } };
  }
}

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createWorkerStub = () => ({
  ref: vi.fn(),
  unref: vi.fn(),
  terminate: vi.fn(() => Promise.resolve()),
});

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof isNodeLike?.mockReturnValue === "function") {
    isNodeLike.mockReturnValue(true);
  }
});

describe("default export", () => {
  it("matches ToolExecutor", () => {
    expect(DefaultToolExecutor).toBe(ToolExecutor);
  });
});

describe("ToolExecutor", () => {
  describe("constructor", () => {
    it("sets defaults and registers a pre-tool hook", () => {
      const executor = new ToolExecutor();

      expect(executor.defaultTimeoutMs).toBe(30000);
      expect(executor.maxRetries).toBe(1);
      expect(executor.validateSchema).toBe(true);
      expect(executor.strictValidation).toBe(false);
      expect(executor.defaultIsolation).toBe("none");

      expect(createPreToolUseHook).toHaveBeenCalledTimes(1);
      const preHook = createPreToolUseHook.mock.results[0].value;
      expect(executor.hooks.before[0]).toBe(preHook);
    });
  });

  describe("registration", () => {
    it("registers tools and supports bulk registration", () => {
      const executor = new ToolExecutor();
      const tool = { handler: vi.fn() };

      executor.register("alpha", tool);
      expect(executor.hasTool("alpha")).toBe(true);
      expect(executor.getTool("alpha")).toBe(tool);

      executor.registerAll(boundary.emptyObject);
      executor.registerAll({ beta: tool });
      expect(executor.hasTool("beta")).toBe(true);
    });

    it("returns tool definitions with descriptions and parameters", () => {
      const executor = new ToolExecutor({
        tools: {
          t1: { description: "desc", parameters: { type: "object" }, handler: vi.fn() },
          t2: { definition: { parameters: { foo: "bar" } }, handler: vi.fn() },
        },
      });

      expect(executor.getToolDefinitions()).toEqual([
        { name: "t1", description: "desc", parameters: { type: "object" } },
        { name: "t2", description: "", parameters: { foo: "bar" } },
      ]);
    });
  });

  describe("execute", () => {
    it("returns error for unknown tool names including empty and null", async () => {
      const executor = new ToolExecutor({ tools: {} });
      const names = ["", boundary.whitespaceString, boundary.nullValue, boundary.undefinedValue];

      for (const name of names) {
        const result = await executor.execute(name, {}, {});
        expect(result.success).toBe(false);
        expect(result.error).toContain("Unknown tool");
      }
    });

    it("passes through empty args when schema validation is disabled", async () => {
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: (args) => ({ args }) },
        },
        validateSchema: false,
      });

      const results = await Promise.all([
        executor.execute("echo", boundary.nullValue, {}),
        executor.execute("echo", boundary.undefinedValue, {}),
        executor.execute("echo", boundary.emptyObject, {}),
        executor.execute("echo", boundary.emptyArray, {}),
      ]);

      expect(results[0].data.args).toBeNull();
      expect(results[1].data.args).toBeUndefined();
      expect(results[2].data.args).toEqual({});
      expect(results[3].data.args).toEqual([]);
    });

    it("executes function-style tools", async () => {
      const executor = new ToolExecutor({
        tools: {
          add: (args) => args.a + args.b,
        },
      });

      const result = await executor.execute("add", { a: 2, b: 3 }, {});
      expect(result.success).toBe(true);
      expect(result.data).toBe(5);
    });

    it("returns error when tool has no handler", async () => {
      const executor = new ToolExecutor({
        tools: {
          missing: { description: "no handler" },
        },
      });

      const result = await executor.execute("missing", {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("no handler");
    });

    it("normalizes nullish and error results", async () => {
      const executor = new ToolExecutor({
        tools: {
          noop: { handler: async () => undefined },
          nuller: { handler: async () => null },
          errorObj: { handler: async () => ({ error: "boom" }) },
        },
      });

      const res1 = await executor.execute("noop", {}, {});
      const res2 = await executor.execute("nuller", {}, {});
      const res3 = await executor.execute("errorObj", {}, {});

      expect(res1.success).toBe(true);
      expect(res1.data).toBeNull();
      expect(res2.success).toBe(true);
      expect(res2.data).toBeNull();
      expect(res3.success).toBe(false);
      expect(res3.data.error).toBe("boom");
    });

    it("retries on failure with backoff", async () => {
      let attempts = 0;
      const executor = new ToolExecutor({
        tools: {
          flaky: {
            handler: async () => {
              attempts += 1;
              if (attempts < 3) throw new Error("flaky");
              return { ok: true, data: attempts };
            },
          },
        },
        maxRetries: 2,
      });

      const delaySpy = vi.spyOn(executor, "_delay").mockResolvedValue();
      const result = await executor.execute("flaky", {}, {});

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
      expect(delaySpy).toHaveBeenCalledTimes(2);
      expect(delaySpy).toHaveBeenNthCalledWith(1, 100);
      expect(delaySpy).toHaveBeenNthCalledWith(2, 200);
    });

    it("times out long-running handlers", async () => {
      const executor = new ToolExecutor({
        tools: {
          slow: { handler: () => new Promise(() => {}) },
        },
        timeoutMs: 5,
        maxRetries: 0,
      });

      vi.useFakeTimers();
      try {
        const promise = executor.execute("slow", {}, {});
        await vi.advanceTimersByTimeAsync(5);
        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain("timed out");
      } finally {
        vi.useRealTimers();
      }
    });

    it("supports concurrent executions", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const resolvers = [];

      const handler = vi.fn(() => new Promise((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        resolvers.push(() => {
          inFlight -= 1;
          resolve({ ok: true, data: inFlight });
        });
      }));

      const executor = new ToolExecutor({
        tools: { slow: { handler } },
        maxRetries: 0,
      });

      const p1 = executor.execute("slow", { id: 1 }, {});
      const p2 = executor.execute("slow", { id: 2 }, {});
      await Promise.resolve();

      expect(resolvers).toHaveLength(2);
      expect(maxInFlight).toBe(2);

      resolvers.forEach((resolve) => resolve());
      const results = await Promise.all([p1, p2]);

      expect(results.every((r) => r.success)).toBe(true);
    });

    it("handles rapid sequential executions", async () => {
      const executor = new ToolExecutor({
        tools: { ping: { handler: ({ id }) => id } },
        maxRetries: 0,
      });

      const results = [];
      for (let i = 0; i < 5; i += 1) {
        results.push(await executor.execute("ping", { id: i }, {}));
      }

      expect(results.map((r) => r.data)).toEqual([0, 1, 2, 3, 4]);
    });

    it("handles large payloads and deep nesting", async () => {
      const executor = new ToolExecutor({
        tools: {
          echo: { handler: (args) => ({ data: args }) },
        },
        validateSchema: false,
      });

      const result = await executor.execute(
        "echo",
        { text: boundary.longString, deep: boundary.deepObject, file: boundary.largeFile },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.data.text.length).toBe(boundary.longString.length);
      expect(result.data.deep.level1.level2.level3.level4.level5.value).toBe("deep");
      expect(result.data.file.content.length).toBe(boundary.largeFile.content.length);
    });
  });

  describe("schema validation", () => {
    it("rejects in strict mode and emits validation failures", async () => {
      const handler = vi.fn();
      const emit = vi.fn();
      const executor = new ToolExecutor({
        tools: {
          t: { parameters: { type: "object" }, handler },
        },
        validateSchema: true,
        strictValidation: true,
        emit,
      });

      validateArgs.mockReturnValueOnce({ valid: false, errors: ["bad"] });

      const result = await executor.execute("t", { value: 1 }, {});
      expect(handler).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation failed: bad");
      expect(emit).toHaveBeenCalledWith(
        "tool:validationFailed",
        expect.objectContaining({ tool: "t" })
      );
    });

    it("continues execution when validation fails in non-strict mode", async () => {
      const handler = vi.fn(async () => ({ ok: true, data: "ok" }));
      const executor = new ToolExecutor({
        tools: {
          t: { parameters: { type: "object" }, handler },
        },
        validateSchema: true,
        strictValidation: false,
      });

      validateArgs.mockReturnValueOnce({ valid: false, errors: ["bad"] });

      const result = await executor.execute("t", {}, {});
      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it("handles boundary values and type mismatches", async () => {
      const schema = {
        type: "object",
        properties: {
          count: { type: "number", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          list: { type: "array", minItems: 1 },
          name: { type: "string", minLength: 1, pattern: "^\\S+$" },
        },
        required: ["count", "list", "name"],
      };

      const handler = vi.fn((args) => ({ ok: true, data: args.count }));
      const executor = new ToolExecutor({
        tools: { t: { parameters: schema, handler } },
        validateSchema: true,
        strictValidation: true,
      });

      const okZero = await executor.execute("t", { count: boundary.zero, list: [1], name: "ok" }, {});
      const okMax = await executor.execute("t", { count: boundary.maxSafe, list: [1], name: "ok" }, {});

      expect(okZero.success).toBe(true);
      expect(okMax.success).toBe(true);

      const cases = [
        { args: boundary.nullValue, label: "null args" },
        { args: boundary.undefinedValue, label: "undefined args" },
        { args: boundary.emptyObject, label: "empty object" },
        { args: { count: boundary.negativeOne, list: [1], name: "ok" }, label: "negative number" },
        { args: { count: boundary.stringNumber, list: [1], name: "ok" }, label: "string as number" },
        { args: { count: boundary.zero, list: boundary.objectAsArray, name: "ok" }, label: "object as array" },
        { args: { count: boundary.zero, list: boundary.emptyArray, name: "ok" }, label: "empty array" },
        { args: { count: boundary.zero, list: [1], name: boundary.emptyString }, label: "empty string" },
        { args: { count: boundary.zero, list: [1], name: boundary.whitespaceString }, label: "whitespace string" },
      ];

      for (const item of cases) {
        const result = await executor.execute("t", item.args, {});
        expect(result.success).toBe(false);
        expect(result.error).toContain("Validation failed");
      }
    });
  });

  describe("hooks", () => {
    it("runs pre-tool hook before custom before hooks", async () => {
      const order = [];
      createPreToolUseHook.mockImplementationOnce(() => async () => {
        order.push("pre");
      });

      const executor = new ToolExecutor({
        tools: { t: { handler: async () => "ok" } },
        hooks: {
          before: [async () => { order.push("custom"); }],
          after: [],
        },
      });

      await executor.execute("t", {}, {});
      expect(order).toEqual(["pre", "custom"]);
    });

    it("allows before hooks to modify params and after hooks to override data", async () => {
      const before = vi.fn(async ({ params }) => ({ params: { value: params.value + 1 } }));
      const after = vi.fn(async ({ result }) => result + 1);

      const executor = new ToolExecutor({
        tools: {
          t: { handler: ({ value }) => value * 2 },
        },
        hooks: {
          before: [before],
          after: [after],
        },
      });

      const result = await executor.execute("t", { value: 1 }, {});
      expect(before).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
      expect(result.data).toBe(5);
    });

    it("allows before hooks to skip execution", async () => {
      const handler = vi.fn();
      const executor = new ToolExecutor({
        tools: { t: { handler } },
      });

      const result = await executor.execute(
        "t",
        {},
        {},
        {
          hooks: {
            before: [async () => ({ skip: true, value: { ok: true, data: "skipped" } })],
            after: [],
          },
        }
      );

      expect(handler).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toBe("skipped");
    });

    it("logs hook errors but continues execution", async () => {
      const logger = { warn: vi.fn() };
      const executor = new ToolExecutor({
        tools: { t: { handler: async () => "ok" } },
        logger,
      });

      const result = await executor.execute(
        "t",
        {},
        {},
        {
          hooks: {
            before: [() => { throw new Error("boom"); }],
            after: [],
          },
        }
      );

      expect(logger.warn).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe("policy", () => {
    it("authorizes using policy mapper and passes signal", async () => {
      const authorize = vi.fn(async () => ({ allowed: true }));
      const policy = { authorize };
      const mapper = vi.fn(() => ({ action: "run" }));
      const signal = new AbortController().signal;

      const executor = new ToolExecutor({
        tools: { t: { handler: async () => "ok" } },
        policy,
        policyMapper: mapper,
      });

      const result = await executor.execute("t", { value: 1 }, { signal });

      expect(result.success).toBe(true);
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ tool: "t", args: { value: 1 } }),
        { signal }
      );
    });

    it("denies tool execution when policy rejects", async () => {
      const authorize = vi.fn(async () => ({ allowed: false, reason: "nope" }));
      const emit = vi.fn();

      const executor = new ToolExecutor({
        tools: { t: { handler: async () => "ok" } },
        policy: { authorize },
        policyMapper: () => ({ action: "run" }),
        emit,
      });

      const result = await executor.execute("t", { value: 1 }, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Policy denied: nope");
      expect(emit).toHaveBeenCalledWith(
        "tool:denied",
        expect.objectContaining({ tool: "t", reason: "nope" })
      );
    });

    it("returns policy errors when authorization throws", async () => {
      const authorize = vi.fn(async () => {
        throw new Error("policy boom");
      });
      const emit = vi.fn();

      const executor = new ToolExecutor({
        tools: { t: { handler: async () => "ok" } },
        policy: { authorize },
        policyMapper: () => ({ action: "run" }),
        emit,
      });

      const result = await executor.execute("t", { value: 1 }, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Policy error: policy boom");
      expect(emit).toHaveBeenCalledWith(
        "tool:denied",
        expect.objectContaining({ tool: "t", reason: "policy_error" })
      );
    });
  });

  describe("executeBatch", () => {
    it("executes actions and returns per-tool results", async () => {
      const executor = new ToolExecutor({
        tools: {
          add: { handler: ({ a, b }) => a + b },
          fail: { handler: () => { throw new Error("boom"); } },
        },
        maxRetries: 0,
      });

      const results = await executor.executeBatch(
        [
          { action: "add", args: { a: 1, b: 2 } },
          { name: "fail", args: {} },
        ],
        {}
      );

      expect(results).toHaveLength(2);
      expect(results[0].tool).toBe("add");
      expect(results[0].success).toBe(true);
      expect(results[0].data).toBe(3);
      expect(results[1].tool).toBe("fail");
      expect(results[1].success).toBe(false);
      expect(results[1].error).toContain("boom");
    });
  });

  describe("worker isolation", () => {
    it("executes via worker for file URLs in node", async () => {
      const handler = vi.fn();
      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler,
            isolation: "worker",
            worker: { moduleUrl: "file:///tmp/worker.mjs", exportName: "run" },
          },
        },
      });

      const result = await executor.execute("job", { a: 1 }, {});

      expect(handler).not.toHaveBeenCalled();
      expect(executor.workerCalls).toHaveLength(1);
      expect(executor.workerCalls[0].moduleUrl).toBe("file:///tmp/worker.mjs");
      expect(executor.workerCalls[0].exportName).toBe("run");
      expect(result.success).toBe(true);
    });

    it("rejects bare specifiers without allow policy", async () => {
      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler: vi.fn(),
            isolation: "worker",
            worker: { moduleUrl: "bare-spec" },
          },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("job", {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("bare specifiers require moduleUrlPolicy=allow");
      expect(executor.workerCalls).toHaveLength(0);
    });

    it("allows bare specifiers when policy is allow", async () => {
      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler: vi.fn(),
            isolation: "worker",
            worker: { moduleUrl: "bare-spec", moduleUrlPolicy: "allow" },
          },
        },
      });

      const result = await executor.execute("job", {}, {});
      expect(result.success).toBe(true);
      expect(executor.workerCalls[0].moduleUrl).toBe("bare-spec");
    });

    it("enforces browser origin allowlist", async () => {
      isNodeLike.mockReturnValue(false);

      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler: vi.fn(),
            isolation: "worker",
            worker: {
              moduleUrl: "https://allowed.test/worker.mjs",
              allowedOrigins: ["https://allowed.test"],
            },
          },
        },
      });

      const result = await executor.execute("job", {}, {});
      expect(result.success).toBe(true);
      expect(executor.workerCalls[0].moduleUrl).toBe("https://allowed.test/worker.mjs");
    });

    it("rejects browser URLs from disallowed origins", async () => {
      isNodeLike.mockReturnValue(false);

      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler: vi.fn(),
            isolation: "worker",
            worker: {
              moduleUrl: "https://blocked.test/worker.mjs",
              allowedOrigins: ["https://allowed.test"],
            },
          },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("job", {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("origin not allowed");
    });

    it("rejects non-file protocols in node", async () => {
      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler: vi.fn(),
            isolation: "worker",
            worker: { moduleUrl: "https://example.com/worker.mjs" },
          },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("job", {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("unsupported protocol in node");
    });

    it("rejects overly long moduleUrl strings", async () => {
      const longUrl = "a".repeat(5000);
      const executor = new WorkerSpyExecutor({
        tools: {
          job: {
            handler: vi.fn(),
            isolation: "worker",
            worker: { moduleUrl: longUrl },
          },
        },
        maxRetries: 0,
      });

      const result = await executor.execute("job", {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("moduleUrl too long");
    });
  });

  describe("context snapshot", () => {
    it("captures only state and runId fields", () => {
      const executor = new ToolExecutor();
      const snapshot = executor._createWorkerContextSnapshot({
        state: { a: 1 },
        runId: "run-1",
        extra: "ignored",
      });

      expect(snapshot).toEqual({ state: { a: 1 }, runId: "run-1" });
    });

    it("returns empty snapshots for non-objects or uncloneable data", () => {
      const executor = new ToolExecutor();
      const nonObject = executor._createWorkerContextSnapshot("nope");
      const uncloneable = executor._createWorkerContextSnapshot({
        state: { fn: () => {} },
        runId: "run-2",
      });

      expect(nonObject).toEqual({});
      expect(uncloneable).toEqual({});
    });
  });
});

describe("createToolExecutor", () => {
  it("creates ToolExecutor instances with provided options", () => {
    const tools = { ping: { handler: () => "pong" } };
    const executor = createToolExecutor({ tools, timeoutMs: 123 });

    expect(executor).toBeInstanceOf(ToolExecutor);
    expect(executor.tools).toBe(tools);
    expect(executor.defaultTimeoutMs).toBe(123);
  });
});

describe("executeTool", () => {
  it("executes a tool using a one-off executor", async () => {
    const tools = { add: { handler: ({ a, b }) => a + b } };

    const result = await executeTool(tools, "add", { a: 1, b: 2 }, {});
    expect(result.success).toBe(true);
    expect(result.data).toBe(3);
  });

  it("returns unknown tool errors when missing", async () => {
    const result = await executeTool({}, "missing", {}, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});

describe("__test.WorkerPool", () => {
  it("throws when createWorker is not a function", () => {
    expect(() => new WorkerPool()).toThrow(TypeError);
  });

  it("acquires and reuses idle workers with ref/unref", async () => {
    const worker = createWorkerStub();
    const createWorker = vi.fn(async () => worker);
    const pool = new WorkerPool({ createWorker, maxWorkers: 1 });

    const first = await pool.acquire();
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.ref).toHaveBeenCalledTimes(1);

    pool.release(first);
    expect(worker.unref).toHaveBeenCalledTimes(1);

    const second = await pool.acquire();
    expect(second).toBe(first);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("waits when max workers reached and resolves on release", async () => {
    const workers = [createWorkerStub(), createWorkerStub()];
    const createWorker = vi.fn(async () => workers.shift());
    const pool = new WorkerPool({ createWorker, maxWorkers: 1 });

    const first = await pool.acquire();
    let resolved = false;
    const secondPromise = pool.acquire().then((worker) => {
      resolved = true;
      return worker;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    pool.release(first);
    const second = await secondPromise;
    expect(resolved).toBe(true);
    expect(second).toBe(first);
  });

  it("setMaxWorkers ignores invalid values and does not shrink", () => {
    const pool = new WorkerPool({ createWorker: async () => createWorkerStub(), maxWorkers: 2 });

    expect(pool.setMaxWorkers(0)).toBe(2);
    expect(pool.setMaxWorkers(-1)).toBe(2);
    expect(pool.setMaxWorkers("3")).toBe(3);
    expect(pool.setMaxWorkers(1)).toBe(3);
  });

  it("destroys workers and fulfills waiters with new workers", async () => {
    const workers = [createWorkerStub(), createWorkerStub()];
    const createWorker = vi.fn(async () => workers.shift());
    const pool = new WorkerPool({ createWorker, maxWorkers: 1 });

    const first = await pool.acquire();
    const waiter = pool.acquire();

    await pool.destroy(first);
    const second = await waiter;

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(first.worker.terminate).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
  });

  it("rejects waiters when createWorker fails", async () => {
    const deferred = createDeferred();
    const createWorker = vi.fn(() => deferred.promise);
    const pool = new WorkerPool({ createWorker, maxWorkers: 1 });

    const firstPromise = pool.acquire();
    const secondPromise = pool.acquire();

    deferred.reject(new Error("boom"));

    await expect(firstPromise).rejects.toThrow("boom");
    await expect(secondPromise).rejects.toThrow("boom");
  });
});
