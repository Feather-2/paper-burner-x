import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 以下测试引用了已删除的 run-context.js，已移除

it("Runtime Constants: report enums + quality mode normalization", async () => {
  const {
    ReportTone,
    ReportAudience,
    ReportLanguage,
    ReportLength,
    QualityMode,
    normalizeReportTone,
    normalizeReportAudience,
    normalizeReportLanguage,
    normalizeReportLength,
    normalizeQualityMode,
  } = await import("../../js/agents/runtime/core/constants.js");

  expect(normalizeReportTone("Business")).toBe(ReportTone.BUSINESS);
  expect(normalizeReportTone("ACADEMIC")).toBe(ReportTone.ACADEMIC);
  expect(normalizeReportTone("neutral")).toBe(undefined);

  expect(normalizeReportAudience("EXECUTIVE")).toBe(ReportAudience.EXECUTIVE);
  expect(normalizeReportAudience("expert")).toBe(ReportAudience.EXPERT);
  expect(normalizeReportAudience("student")).toBe(undefined);

  expect(normalizeReportLanguage("zh")).toBe(ReportLanguage.ZH);
  expect(normalizeReportLanguage("AUTO")).toBe(ReportLanguage.AUTO);
  expect(normalizeReportLanguage("fr")).toBe(undefined);

  expect(normalizeReportLength("detailed")).toBe(ReportLength.DETAILED);
  expect(normalizeReportLength("COMPREHENSIVE")).toBe(ReportLength.COMPREHENSIVE);
  expect(normalizeReportLength("long")).toBe(undefined);

  expect(normalizeQualityMode("HIGH")).toBe(QualityMode.HIGH);
  expect(normalizeQualityMode("standard")).toBe(QualityMode.STANDARD);
  expect(normalizeQualityMode("extreme")).toBe(undefined);
});

it("Runtime Core: EventBus on/off/once/emit + EventRecord fields", async () => {
  const { EventBus, isValidEventName } = await import("../../js/agents/core/event-bus.js");

  expect(isValidEventName("run.started")).toBeTruthy();
  expect(isValidEventName("textprep.chunk.completed")).toBeTruthy();
  expect(isValidEventName("Run.Started")).toBe(false);
  expect(isValidEventName("bad..name")).toBe(false);  // 连续点号不合法
  expect(isValidEventName("bad_name")).toBeTruthy();  // 下划线现在合法

  const bus = new EventBus({ runId: "run_2025-12-12_22-30-01_a3f9f" });

  const seen = [];
  const offAny = bus.on("*", (e) => seen.push(e));

  let onceCount = 0;
  bus.once("run.started", () => {
    onceCount++;
  });

  const evt1 = bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "textprep" } });
  const evt2 = bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "textprep" } });

  expect(onceCount).toBe(1);
  expect(evt1.schemaVersion).toBe("0.1");
  expect(evt1.runId).toBe(bus.runId);
  expect(evt1.name).toBe("run.started");
  expect(evt1.actor).toBe("system");
  expect(evt1.status).toBe("started");
  expect(evt1.payload).toEqual({ mode: "textprep" });
  expect(typeof evt1.eventId === "string" && evt1.eventId.startsWith("evt_")).toBeTruthy();
  expect(typeof evt1.ts === "string" && evt1.ts.includes("T")).toBeTruthy();

  offAny();
  bus.emit("run.ended", { actor: "system", status: "ended" });
  expect(seen.filter((e) => e.name === "run.ended").length).toBe(0);

  // off(name, fn)
  let hits = 0;
  const fn = () => {
    hits++;
  };
  bus.on("run.ended", fn);
  bus.off("run.ended", fn);
  bus.emit("run.ended", { actor: "system", status: "ended" });
  expect(hits).toBe(0);

  // emit(name, payloadObject) convenience
  const evt3 = bus.emit("run.progress", { pct: 50 });
  expect(evt3.payload).toEqual({ pct: 50 });
});

it("Core: KernelBuilder applies config for string plugins", async () => {
  const { KernelBuilder } = await import("../../js/agents/core/index.js");

  const kernel = await KernelBuilder.create()
    .withPreset("minimal")
    .withPlugin("resilience/retry", { maxRetries: 7 })
    .build();

  try {
    const plugin = kernel._getPlugin("resilience/retry");
    expect(plugin?._config?.maxRetries).toBe(7);
  } finally {
    await kernel.stop();
  }
});

it("Runtime: JSRuntimeAdapter blocks main-thread fallback unless trusted", async () => {
  const { JSRuntimeAdapter } = await import("../../js/agents/runtime/core/js-adapter.js");

  const js = new JSRuntimeAdapter({ useWorkerSandbox: false });
  const res = await js.execute("return 1 + 1;", { vfs: {}, state: {} });

  expect(res.success).toBe(false);
  expect(String(res.error || "")).toMatch(/Main-thread fallback blocked/);
});

it("Runtime: JSRuntimeAdapter allows main-thread fallback when trusted=true", async () => {
  const { JSRuntimeAdapter } = await import("../../js/agents/runtime/core/js-adapter.js");

  const js = new JSRuntimeAdapter({ useWorkerSandbox: false });
  const res = await js.execute("return 40 + 2;", { vfs: {}, state: {}, trusted: true });

  expect(res.success).toBe(true);
  expect(res.data).toBe(42);
});

it("Runtime: JSRuntimeAdapter main-thread fallback can be forced allow", async () => {
  const { JSRuntimeAdapter } = await import("../../js/agents/runtime/core/js-adapter.js");

  const js = new JSRuntimeAdapter({ useWorkerSandbox: false, mainThreadFallback: "allow" });
  const res = await js.execute("return 6 * 7;", { vfs: {}, state: {} });

  expect(res.success).toBe(true);
  expect(res.data).toBe(42);
});

it("Runtime: JSRuntimeAdapter reports aborted when signal already aborted", async () => {
  const { JSRuntimeAdapter } = await import("../../js/agents/runtime/core/js-adapter.js");

  const controller = new AbortController();
  controller.abort("test_abort");

  const js = new JSRuntimeAdapter({ useWorkerSandbox: false, mainThreadFallback: "allow" });
  const res = await js.execute("return 1;", { vfs: {}, state: {}, signal: controller.signal });

  expect(res.success).toBe(false);
  expect(String(res.error || "")).toMatch(/Aborted/);
  expect(res.metrics?.aborted).toBe(true);
});

it("Runtime: WorkerRpcClient dispose rejects pending calls and detaches listeners", async () => {
  const { WorkerRpcClient } = await import("../../js/agents/runtime/core/worker-rpc.js");

  class SpyWorker {
    constructor() {
      this.listeners = { message: new Set(), error: new Set() };
      this.postMessageCalls = [];
      this.terminateCalls = 0;
    }

    addEventListener(type, fn) {
      this.listeners[type]?.add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners[type]?.delete(fn);
    }

    postMessage(msg) {
      this.postMessageCalls.push(msg);
    }

    terminate() {
      this.terminateCalls += 1;
    }
  }

  const worker = new SpyWorker();
  const client = new WorkerRpcClient({ worker, timeoutMs: 1_000 });

  const pending = client.call("hang", null, { timeoutMs: 1_000 });
  client.dispose();

  await expect(pending).rejects.toThrow(/disposed/i);
  expect(client.worker).toBe(null);
  expect(client._pending.size).toBe(0);
  expect(worker.terminateCalls).toBe(1);
  expect(worker.listeners.message.size).toBe(0);
  expect(worker.listeners.error.size).toBe(0);

  await expect(client.call("ping", {})).rejects.toThrow(/disposed/i);
  expect(worker.postMessageCalls.length).toBe(1);
});

it("Runtime: WorkerRpcClient dispose clears onmessage/onerror fallback path", async () => {
  const { WorkerRpcClient } = await import("../../js/agents/runtime/core/worker-rpc.js");

  const worker = {
    postMessage() {},
    terminate() {},
    onmessage: null,
    onerror: null,
  };

  const client = new WorkerRpcClient({ worker, timeoutMs: 100 });
  expect(typeof worker.onmessage).toBe("function");
  expect(typeof worker.onerror).toBe("function");

  client.dispose();
  expect(worker.onmessage).toBe(null);
  expect(worker.onerror).toBe(null);
});

it("Runtime: WorkerRpcClient call rejects after dispose without creating worker", async () => {
  const { WorkerRpcClient } = await import("../../js/agents/runtime/core/worker-rpc.js");

  let created = 0;
  const client = new WorkerRpcClient({
    createWorker: () => {
      created += 1;
      return {
        postMessage() {},
        terminate() {},
        addEventListener() {},
        removeEventListener() {},
      };
    },
  });

  client.dispose();
  await expect(client.call("ping", {})).rejects.toThrow(/disposed/i);
  expect(created).toBe(0);
});

it("MCP: parseSseStream enforces default size limits", async () => {
  const { parseSseStream } = await import("../../js/agents/mcp/sse.js");

  const text = `data: ${"a".repeat(300 * 1024)}\n\n`;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  await expect((async () => {
    for await (const _evt of parseSseStream(stream)) {
      // drain
    }
  })()).rejects.toThrow(/SSE: line exceeds maxLineBytes/);
});

it("VFS: MemoryVfs directory tree + mkdir/rmdir/unlink", async () => {
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");

  const vfs = new MemoryVfs();

  await vfs.mkdir("empty");
  await vfs.writeText("a/b.txt", "hi");
  expect(await vfs.exists("a/b.txt")).toBe(true);
  expect(await vfs.exists("a/missing.txt")).toBe(false);

  const rootEntries = await vfs.readdir("", { withFileTypes: true });
  expect(rootEntries.map((e) => e.name)).toEqual(["a", "empty"]
  );
  expect(rootEntries.find((e) => e.name === "a")?.isDirectory()).toBe(true
  );
  expect(rootEntries.find((e) => e.name === "empty")?.isDirectory()).toBe(true
  );

  const aStat = await vfs.stat("a");
  expect(aStat.isDirectory()).toBe(true);

  expect(await vfs.readdir("a")).toEqual(["b.txt"]);
  expect(await vfs.listFiles({ prefix: "a", recursive: true })).toEqual(["a/b.txt"]);
  expect(await vfs.listFiles({ prefix: "a/b.txt" })).toEqual(["a/b.txt"]);

  await vfs.copy("a/b.txt", "a/c.txt");
  expect(await vfs.readText("a/c.txt")).toBe("hi");

  await vfs.move("a/c.txt", "a/d.txt");
  expect(await vfs.exists("a/c.txt")).toBe(false);
  expect(await vfs.readText("a/d.txt")).toBe("hi");

  await vfs.appendText("a/d.txt", "!");
  expect(await vfs.readText("a/d.txt")).toBe("hi!");

  await expect(vfs.rmdir("a")).rejects.toThrow(/ENOTEMPTY/);

  await vfs.unlink("a/b.txt");
  await vfs.unlink("a/d.txt");
  expect(await vfs.readdir("a")).toEqual([]);
  await vfs.rmdir("a");

  await expect(vfs.stat("a")).rejects.toThrow(/ENOENT/);
  await expect(vfs.rmdir("")).rejects.toThrow(/cannot remove root/);
});

it("VFS: MemoryVfs mkdir recursive=false semantics", async () => {
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");
  const vfs = new MemoryVfs();

  await vfs.mkdir("dir");
  await expect(vfs.mkdir("dir", { recursive: false })).rejects.toThrow(/EEXIST/);

  await vfs.writeText("file.txt", "x");
  await expect(vfs.mkdir("file.txt", { recursive: true })).rejects.toThrow(/EEXIST/);
  await expect(vfs.mkdir("file.txt", { recursive: false })).rejects.toThrow(/EEXIST/);

  await expect(vfs.mkdir("missing/child", { recursive: false })).rejects.toThrow(/ENOENT/);
});

it("VFS glob: createVfsGlobFn uses walkFiles + static dir prefix", async () => {
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");
  const { createVfsGlobFn } = await import("../../js/agents/vfs/glob.js");

  const vfs = new MemoryVfs();
  await vfs.writeText("src/a.js", "x");
  await vfs.writeText("src/b.ts", "x");
  await vfs.writeText("other/c.js", "x");

  const seenPrefixes = [];
  const original = vfs.walkFiles.bind(vfs);
  vfs.walkFiles = async function* (opts) {
    seenPrefixes.push(String(opts?.prefix || ""));
    yield* original(opts);
  };

  const globFn = createVfsGlobFn(vfs, { maxScanFiles: 100 });
  const files = await globFn({ pattern: "src/**/*.js", path: "" });
  expect(files).toEqual(["src/a.js"]);
  expect(seenPrefixes[0]).toBe("src");
});

it("VFS operations: writeTextFileWithPolicy serializes concurrent writes", async () => {
  const { writeTextFileWithPolicy } = await import("../../js/agents/vfs/operations.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class SlowVfs {
    constructor() {
      this.text = "start";
    }
    async readText() {
      return this.text;
    }
    async writeText(_path, next) {
      if (next === "first") await sleep(50);
      if (next === "second") await sleep(10);
      this.text = next;
    }
  }

  const vfs = new SlowVfs();

  await Promise.all([
    writeTextFileWithPolicy({ vfs, path: "x.txt", text: "first", checkpoint: false }),
    writeTextFileWithPolicy({ vfs, path: "x.txt", text: "second", checkpoint: false }),
  ]);

  expect(vfs.text).toBe("second");
});

it("VFS operations: multiEditTextFileWithPolicy supports indentation-normalized fallback", async () => {
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");
  const { multiEditTextFileWithPolicy } = await import("../../js/agents/vfs/operations.js");

  const vfs = new MemoryVfs();
  const before = ["function outer() {", "  if (a) {", "    return 1;", "  }", "}", ""].join("\n");
  await vfs.writeText("code.js", before);

  const oldString = ["    if (a) {", "      return 1;", "    }"].join("\n"); // extra indentation vs file
  const newString = ["  if (a) {", "    return 2;", "  }"].join("\n");

  await multiEditTextFileWithPolicy({
    vfs,
    path: "code.js",
    edits: [{ old_string: oldString, new_string: newString }],
    checkpoint: false,
  });

  const after = await vfs.readText("code.js");
  expect(after.includes("return 2;")).toBeTruthy();
  expect(after.includes("return 1;")).toBe(false);
});

it("Runtime Core: EventBus backpressure default stays synchronous", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "a" });
  expect(hits).toBe(1);
});

it("Runtime Core: EventBus backpressure batching + coalesce + order + seq", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seqOf = (evt) => Number(String(evt.eventId).split("_").at(-1));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 25 });

  const events = [];
  bus.on("*", (e) => events.push(e));

  bus.emit("run.progress", { i: 1 });
  bus.emit("run.log", { msg: "a" });
  bus.emit("run.progress", { i: 2 });
  bus.emit("run.log", { msg: "b" });
  bus.emit("run.progress", { i: 3 });
  bus.emit("run.progress", { i: 4 });
  bus.emit("run.progress", { i: 5 });

  expect(events.length).toBe(0);

  await sleep(60);

  expect(events.map((e) => e.name)).toEqual(["run.log", "run.log", "run.progress"]
  );

  const progress = events.filter((e) => e.name === "run.progress");
  expect(progress.length).toBe(1);
  expect(progress[0].payload).toEqual({ i: 5 });

  const logs = events.filter((e) => e.name === "run.log");
  expect(logs.length).toBe(2);
  expect(logs.map((e) => e.payload)).toEqual([{ msg: "a" }, { msg: "b" }]);

  const seqs = events.map(seqOf);
  expect(seqs[0] < seqs[1] && seqs[1] < seqs[2]).toBeTruthy();

  bus.emit("run.log", { msg: "c" });
  await sleep(60);
  expect(events.filter((e) => e.payload?.msg === "c").length).toBe(1);
  expect(seqOf(events.at(-1))).toBeGreaterThan(seqs.at(-1));
});

it("Runtime Core: EventBus backpressure custom coalescePattern + disable restores sync", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 20, coalescePattern: /\.log$/ });

  const progress = [];
  const logs = [];
  bus.on("run.progress", (e) => progress.push(e));
  bus.on("run.log", (e) => logs.push(e));

  bus.emit("run.progress", { i: 1 });
  bus.emit("run.progress", { i: 2 });
  bus.emit("run.progress", { i: 3 });

  bus.emit("run.log", { msg: "a" });
  bus.emit("run.log", { msg: "b" });
  bus.emit("run.log", { msg: "c" });

  await sleep(50);

  expect(progress.length).toBe(3);
  expect(progress.map((e) => e.payload)).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);

  expect(logs.length).toBe(1);
  expect(logs[0].payload).toEqual({ msg: "c" });

  bus.disableBackpressure();

  let sync = false;
  bus.on("run.log", () => {
    sync = true;
  });
  bus.emit("run.log", { msg: "sync" });
  expect(sync).toBe(true);
});

it("Runtime Core: EventBus backpressure batchWindowMs controls flush timing", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 40 });

  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "delayed" });
  await sleep(10);
  expect(hits).toBe(0);

  await sleep(60);
  expect(hits).toBe(1);
});

it("Runtime Core: EventBus backpressure rAF scheduling branch", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;

  try {
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 25);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

    const bus = new EventBus({ runId: "run_test" });
    bus.enableBackpressure();

    let hits = 0;
    bus.on("run.log", () => {
      hits++;
    });

    bus.emit("run.log", { msg: "x" });
    bus.disableBackpressure();
    expect(hits).toBe(1);

    // Exercise the empty-queue flush path.
    bus.enableBackpressure();
    bus.disableBackpressure();
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

it("Runtime Core: EventBus backpressure ignores stale scheduled flush callbacks", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;

  const callbacks = new Map();
  let nextId = 1;

  try {
    globalThis.requestAnimationFrame = (cb) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    };
    // Simulate a buggy cancelAnimationFrame (noop): old callbacks may still fire.
    globalThis.cancelAnimationFrame = () => {};

    const bus = new EventBus({ runId: "run_test" });
    let hits = 0;
    bus.on("run.log", () => {
      hits++;
    });

    bus.enableBackpressure({ batchWindowMs: 0 });
    bus.emit("run.log", { msg: "old" });
    const oldId = bus._backpressure?.rafId;

    bus.disableBackpressure();
    expect(hits).toBe(1);

    bus.enableBackpressure({ batchWindowMs: 0 });
    bus.emit("run.log", { msg: "new" });
    const newId = bus._backpressure?.rafId;
    expect(hits).toBe(1);

    callbacks.get(oldId)?.(Date.now());
    expect(hits).toBe(1);

    callbacks.get(newId)?.(Date.now());
    expect(hits).toBe(2);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

it("Runtime Core: EventBus validation errors", async () => {
  const { EventBus, createEventRecord } = await import("../../js/agents/core/event-bus.js");

  expect(() => createEventRecord({ name: "Bad.Name" })).toThrow(/Invalid event name/);

  const bus = new EventBus({ runId: "run_test" });
  expect(() => bus.on("run.log", "nope")).toThrow(/handler must be a function/);
  expect(() => bus.on("Bad.Name", () => {}), /Invalid event name/);

  expect(() => bus.enableBackpressure(123)).toThrow(/options must be an object/);
  expect(() => bus.enableBackpressure({ batchWindowMs: -1 })).toThrow(/batchWindowMs/);
  expect(() => bus.enableBackpressure({ coalescePattern: "x" })).toThrow(/coalescePattern/);
});

it("Runtime Core: EventBus backpressure re-enable flushes queued and cancels timer", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  const seen = [];
  bus.on("run.log", (e) => seen.push(e));

  bus.enableBackpressure({ batchWindowMs: 100 });
  bus.emit("run.log", { msg: "queued" });

  // Re-enabling should cancel the pending timer and flush queued events immediately.
  bus.enableBackpressure({ batchWindowMs: 1, coalescePattern: /\.progress$/g });
  expect(seen.length).toBe(1);
  expect(seen[0].payload).toEqual({ msg: "queued" });

  // Also exercise global-regexp coalescing behavior.
  const progress = [];
  bus.on("run.progress", (e) => progress.push(e));
  bus.emit("run.progress", { i: 1 });
  bus.emit("run.progress", { i: 2 });
  await sleep(20);
  expect(progress.length).toBe(1);
  expect(progress[0].payload).toEqual({ i: 2 });
});

it("Runtime Core: EventBus persistence adapter best-effort appendEvents", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Promise-returning appendEvents should be caught (no unhandled rejection).
  {
    let calls = 0;
    const appended = [];
    const bus = new EventBus({
      runId: "run_test",
      persistenceAdapter: {
        appendEvents: (events) => {
          calls++;
          appended.push(...events);
          return Promise.reject(new Error("nope"));
        },
        getEvents: async () => [],
      },
    });

    bus.emit("run.log", { msg: "a" });
    await sleep(0);

    expect(calls).toBe(1);
    expect(appended.length).toBe(1);
    expect(appended[0].name).toBe("run.log");
  }

  // Throwing appendEvents should be swallowed.
  {
    const bus = new EventBus({
      runId: "run_test",
      persistenceAdapter: {
        appendEvents: () => {
          throw new Error("boom");
        },
        getEvents: async () => [],
      },
    });

    bus.emit("run.log", { msg: "b" });
    await sleep(0);
  }
});

it("Runtime Core: EventBus replay loads events and marks meta.replay", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  // No adapter -> clear error.
  await expect(() => new EventBus().replay("run_test")).rejects.toThrow(/persistenceAdapter is required/);

  // Bad runId.
  await expect(
    new EventBus({
      persistenceAdapter: { appendEvents: async () => {}, getEvents: async () => [] },
    }).replay(123)
  ).rejects.toThrow(/runId must be a string/);

  // getEvents throws -> wrapped error.
  await expect(
    new EventBus({
      persistenceAdapter: {
        appendEvents: async () => {},
        getEvents: async () => {
          throw new Error("boom");
        },
      },
    }).replay("run_test")
  ).rejects.toThrow(/failed to load events/);

  // Successful replay.
  const replayed = [];
  let appendCalls = 0;
  const bus = new EventBus({
    persistenceAdapter: {
      appendEvents: async () => {
        appendCalls++;
      },
      getEvents: async () => [
        "skip-me",
        { name: "run.started", actor: "system", payload: { x: 1 }, meta: { foo: "bar" }, eventId: "evt_run_test_1", ts: new Date().toISOString(), runId: "run_test" },
      ],
    },
  });
  bus.on("*", (e) => replayed.push(e));

  const out = await bus.replay("run_test");
  expect(out.length).toBe(1);
  expect(out[0].meta.replay).toBe(true);
  expect(out[0].meta.foo).toBe("bar");
  expect(replayed.length).toBe(1);

  // replay should not persist events.
  expect(appendCalls).toBe(0);
});

it("Runtime Core: RunStoreAdapter validation + appendEvents branches", async () => {
  const { RunStoreAdapter } = await import("../../js/agents/core/event-bus.js");

  expect(() => new RunStoreAdapter(null)).toThrow(/runStore.getEvents must be a function/);
  expect(() => new RunStoreAdapter({ getEvents: async () => [] }), /appendEvents\/appendEvent/);

  // appendEvents path
  {
    const calls = [];
    const runStore = {
      getEvents: async (runId) => [{ runId, name: "run.log" }],
      appendEvents: async (runId, events) => {
        calls.push({ runId, events });
      },
    };
    const adapter = new RunStoreAdapter(runStore);

    await expect(adapter.appendEvents("nope")).rejects.toThrow(/events must be an array/);
    expect(await adapter.appendEvents([])).toBe(0);

    const n = await adapter.appendEvents([
      { runId: "run_a", name: "run.log" },
      { runId: "run_a", name: "run.log" },
    ]);
    expect(n).toBe(2);
    expect(calls.length).toBe(1);
    expect(calls[0].runId).toBe("run_a");
    expect(calls[0].events.length).toBe(2);

    const got = await adapter.getEvents("run_a");
    expect(got[0].runId).toBe("run_a");
  }

  // appendEvent (per-event) path + missing runId error
  {
    const calls = [];
    const runStore = {
      getEvents: async () => [],
      appendEvent: async (runId, evt) => {
        calls.push({ runId, evt });
      },
    };
    const adapter = new RunStoreAdapter(runStore);

    await expect(adapter.appendEvents([{ name: "run.log" }])).rejects.toThrow(/must include a string runId/);
    expect(calls.length).toBe(0);

    const n = await adapter.appendEvents([
      { runId: "run_b", name: "run.log", payload: { i: 1 } },
      { runId: "run_b", name: "run.log", payload: { i: 2 } },
    ]);
    expect(n).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0].runId).toBe("run_b");
    expect(calls[1].evt.payload.i).toBe(2);
  }
});

// 以下测试引用了已删除的 run-context.js 和 orchestrator.js，已移除

it("Runtime Core: EventBus subscribe with wildcard pattern", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const deepSearchEvents = [];
  const designEvents = [];

	  bus.subscribe("deepsearch.*", (e) => deepSearchEvents.push(e));
	  bus.subscribe("design.*", (e) => designEvents.push(e));

	  bus.emit("deepsearch.scan.started", { status: "started" });
	  bus.emit("deepsearch.gaps.completed", { status: "completed" });
	  bus.emit("design.started", { status: "started" });
	  bus.emit("run.started", { status: "started" });

  expect(deepSearchEvents.length).toBe(2);
  expect(designEvents.length).toBe(1);
  expect(deepSearchEvents.every((e) => e.name.startsWith("deepsearch."))).toBeTruthy();
});

it("Runtime Core: EventBus subscribe returns unsubscribe function", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const events = [];

  const unsubscribe = bus.subscribe("deepsearch.*", (e) => events.push(e));

  bus.emit("deepsearch.scan.started", {});
  expect(events.length).toBe(1);

  unsubscribe();

  bus.emit("deepsearch.scan.completed", {});
  expect(events.length).toBe(1); // no new events after unsubscribe
});

it("Runtime Core: EventBus subscribe with priority executes in order", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  // 注册不同优先级的 handlers
  bus.subscribe("test.event", () => execution.push("low"), { priority: -10 });
  bus.subscribe("test.event", () => execution.push("normal"));  // priority 0
  bus.subscribe("test.event", () => execution.push("high"), { priority: 10 });
  bus.subscribe("test.event", () => execution.push("critical"), { priority: 100 });

  bus.emit("test.event", {});

  // 高优先级先执行
  expect(execution).toEqual(["critical", "high", "normal", "low"]);
});

it("Runtime Core: EventBus subscribe with priority + wildcard", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  // 通配符 + 优先级
  bus.subscribe("test.*", () => execution.push("wildcard-high"), { priority: 50 });
  bus.subscribe("test.*", () => execution.push("wildcard-normal"));
  bus.subscribe("test.event", () => execution.push("exact-low"), { priority: -5 });
  bus.subscribe("test.event", () => execution.push("exact-high"), { priority: 25 });

  bus.emit("test.event", {});

  expect(execution).toEqual(["wildcard-high", "exact-high", "wildcard-normal", "exact-low"]);
});

it("Runtime Core: EventBus subscribe priority unsubscribe cleanup", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  const unsub1 = bus.subscribe("test.event", () => execution.push("a"), { priority: 10 });
  const unsub2 = bus.subscribe("test.*", () => execution.push("b"), { priority: 20 });

  bus.emit("test.event", {});
  expect(execution).toEqual(["b", "a"]);

  unsub1();
  unsub2();

  execution.length = 0;
  bus.emit("test.event", {});
  expect(execution).toEqual([]);  // all unsubscribed
});

it("Runtime Core: EventBus subscribe priority validation", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });

  expect(() => bus.subscribe("test.event", () => {}, { priority: "high" }), /priority must be a finite number/);
  expect(() => bus.subscribe("test.event", () => {}, { priority: Infinity }), /priority must be a finite number/);
});

it("Runtime Core: EventBus listener errors are isolated (sync + async)", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const errors = [];
  const bus = new EventBus({
    runId: "run_listener_errors",
    onListenerError(err, evt) {
      errors.push({ message: String(err?.message || err), name: evt?.name });
    },
  });

  const order = [];
  bus.on("run.log", () => {
    order.push("a");
    throw new Error("boom_sync");
  });
  bus.on("run.log", async () => {
    order.push("b");
    throw new Error("boom_async");
  });
  bus.on("run.log", () => {
    order.push("c");
  });

  expect(() => bus.emit("run.log", { msg: "x" })).not.toThrow();
  expect(order).toEqual(["a", "b", "c"]);

  await new Promise((r) => setImmediate(r));
  expect(errors.length).toBe(2);
  expect(errors.some(e => e.message.includes("boom_sync") && e.name === "run.log"));
  expect(errors.some(e => e.message.includes("boom_async") && e.name === "run.log"));
});

it("Runtime Telemetry: subscribeTelemetry keeps bounded in-memory timeline", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { subscribeTelemetry } = await import("../../js/agents/runtime/telemetry/runstore-telemetry.js");

  const bus = new EventBus({ runId: "run_telemetry" });
  const stored = [];
  const runStore = {
    async appendEvent(runId, evt) {
      stored.push({ runId, evt });
    },
  };

  const sub = subscribeTelemetry(bus, runStore, { maxTimelineEntries: 3 });
  for (let i = 0; i < 5; i++) bus.emit("run.progress", { i });
  await sub.flush();

  expect(stored.length).toBe(5);
  expect(sub.timeline.length).toBe(3);
  expect(sub.timeline.map((r) => r.payload?.i)).toEqual([2, 3, 4]
  );
  expect(sub.snapshot().timeline.length).toBe(3);
  sub.unsubscribe();
});

it("Runtime Tools: ToolExecutor worker isolation enforces hard timeout for sync work", async () => {
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");
  const { ToolExecutor } = await import("../../js/agents/runtime/tools/tool-executor.js");

  const fixturePath = path.join(__dirname, "../fixtures/tool-executor/busy-loop.mjs");
  const moduleUrl = pathToFileURL(fixturePath).href;

  const executor = new ToolExecutor({
    tools: {
      busy: {
        handler: async () => ({ ok: true, ran: "main" }),
        worker: { moduleUrl, exportName: "handler" },
      },
    },
    timeoutMs: 50,
    maxRetries: 0,
  });

  const started = Date.now();
  const result = await executor.execute("busy", { durationMs: 500 }, {}, { isolation: "worker" });
  const elapsedMs = Date.now() - started;

  expect(result.success).toBe(false);
  expect(String(result.error || "")).toContain("timed out");
  expect(elapsedMs < 300).toBeTruthy();
});

it("Runtime Tools: WorkerPool caps concurrent worker creation", async () => {
  const { __test } = await import("../../js/agents/runtime/tools/tool-executor.js");
  const WorkerPool = __test?.WorkerPool;
  expect(typeof WorkerPool === "function").toBeTruthy();

  let created = 0;
  const pool = new WorkerPool({
    maxWorkers: 2,
    createWorker: async () => {
      created += 1;
      await new Promise((r) => setImmediate(r));
      return { terminate: async () => {} };
    },
  });

  const p1 = pool.acquire();
  const p2 = pool.acquire();
  const p3 = pool.acquire();

  const w1 = await p1;
  const w2 = await p2;
  expect(created).toBe(2);

  let p3Resolved = false;
  void p3.then(() => {
    p3Resolved = true;
  });

  await new Promise((r) => setImmediate(r));
  expect(p3Resolved).toBe(false);

  pool.release(w1);
  const w3 = await p3;
  expect(w3).toBeTruthy();
  expect(created).toBe(2);

  pool.release(w2);
  pool.release(w3);
});

it("Runtime Compression: anchors preserve initial system prompts across repeated compression", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  const loop = new BaseAgentLoop({
    stageName: "test",
    actor: "test",
    contextConfig: { keepLastTurns: 2, contextWindow: 100000, compressThreshold: 0.9 },
  });

  const anchor1 = "ANCHOR: Keep this verbatim (goal + constraints)";
  const anchor2 = "ANCHOR: Second pinned instruction";

  loop.addMessage({ role: "system", content: anchor1 });
  loop.addMessage({ role: "system", content: anchor2 });

  for (let i = 0; i < 12; i++) {
    loop.addMessage({ role: "user", content: `u${i}` });
    loop.addMessage({ role: "assistant", content: `a${i}` });
  }

  await loop._compressMessages();

  expect(loop.messages[0].content).toBe(anchor1);
  expect(loop.messages[1].content).toBe(anchor2);
  const summaryIdx1 = loop.messages.findIndex((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]"));
  expect(summaryIdx1).toBe(loop.messages.length - 1);
  expect(loop.messages.filter((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]")).length).toBe(1);

  for (let i = 12; i < 24; i++) {
    loop.addMessage({ role: "user", content: `u${i}` });
    loop.addMessage({ role: "assistant", content: `a${i}` });
  }

  await loop._compressMessages();

  expect(loop.messages[0].content).toBe(anchor1);
  expect(loop.messages[1].content).toBe(anchor2);
  const summaryIdx2 = loop.messages.findIndex((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]"));
  expect(summaryIdx2).toBe(loop.messages.length - 1);
  expect(loop.messages.filter((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]")).length).toBe(1);
});

it("Runtime Compression: title-only mode trims old messages aggressively", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  const loop = new BaseAgentLoop({
    stageName: "test",
    actor: "test",
    contextConfig: {
      keepLastTurns: 1,
      contextWindow: 100,
      compressThreshold: 0.9,
      titleOnlySummaryThreshold: 0, // always title-only during compression
      titleOnlySummaryMaxWords: 10,
      titleOnlySummaryMaxChars: 80,
    },
  });

  loop.addMessage({ role: "system", content: "ANCHOR" });

  const words = Array.from({ length: 20 }, (_, i) => `w${i + 1}`).join(" ");

  for (let i = 0; i < 6; i++) {
    loop.addMessage({ role: "user", content: words });
    loop.addMessage({ role: "assistant", content: "ok" });
  }

  await loop._compressMessages();

  const summaryMsg = loop.messages.find((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]"));
  expect(summaryMsg).toBeTruthy();
  const body = String(summaryMsg.content || "").split("\n").slice(1).join("\n");

  // When title-only is enabled, we should not include words beyond the first 10.
  expect(body.includes("w11")).toBe(false);
});

it("Runtime Compression: _scheduleCompression is idempotent and flushCompression resolves", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  const loop = new BaseAgentLoop({
    stageName: "test",
    actor: "test",
    contextConfig: { contextWindow: 800, compressThreshold: 0.9, keepLastTurns: 1, compressCooldownMs: 1000 },
  });

  loop.addMessage({ role: "user", content: "x".repeat(8000) });
  loop.addMessage({ role: "assistant", content: "ok" });
  expect(loop.getContextStatus().needsCompression).toBe(true);
  expect(loop.getContextStatus().compressionPending).toBe(true);

  const p1 = loop._compressionPromise;
  expect(p1).toBeTruthy();
  loop._scheduleCompression();
  expect(loop._compressionPromise).toBe(p1);

  await loop.flushCompression();
  expect(loop.getContextStatus().compressionPending).toBe(false);
  expect(loop.getContextStatus().needsCompression).toBe(false);
});

it("AgentOrchestrator: stage timeout timer is cleaned up on success", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = new Set();
  let nextTimerId = 1;

  const orch = new AgentOrchestrator({ runId: "run_orch_timer" });
  let stageAborted = false;

  try {
    globalThis.setTimeout = () => {
      const id = nextTimerId++;
      scheduled.push(id);
      return id;
    };
    globalThis.clearTimeout = (id) => {
      cleared.add(id);
    };

  orch.registerStage(
    "deepsearch.stage.timer_test",
    async (_ctx, _input, api) => {
      api.signal?.addEventListener?.("abort", () => {
        stageAborted = true;
      });
      return { ok: true };
    },
    { timeoutMs: 10 }
  );

  await orch.runStage("deepsearch.stage.timer_test", { ok: true });
  expect(stageAborted).toBe(false);
  expect(scheduled.length).toBe(1);
  expect(cleared.has(scheduled[0])).toBe(true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

it("PromptLoader: LRU cache evicts oldest prompts", async () => {
  const {
    loadPrompt,
    clearPromptCache,
    getCachedPromptNames,
    configurePromptCache,
  } = await import("../../js/agents/prompts/prompt-loader.js");

  clearPromptCache();
  const original = configurePromptCache();

  try {
    configurePromptCache({ maxEntries: 2 });

    await loadPrompt("deepsearch/system");
    await loadPrompt("codesearch/system");

    // Touch the first entry again to make it most-recently-used.
    await loadPrompt("deepsearch/system");

    // Insert a third entry => should evict the LRU ("codesearch/system").
    await loadPrompt("design/batch-generator-system");

    const cached = getCachedPromptNames();
    expect(cached.length).toBe(2);
    expect(cached.includes("deepsearch/system")).toBe(true);
    expect(cached.includes("design/batch-generator-system")).toBe(true);
    expect(cached.includes("codesearch/system")).toBe(false);
  } finally {
    configurePromptCache({ maxEntries: original.maxEntries });
    clearPromptCache();
  }
});

it("PromptLoader: browser manifest resolves prompt URLs (best-effort)", async () => {
  const { loadPrompt, clearPromptCache } = await import("../../js/agents/prompts/prompt-loader.js");

  const originalProcess = globalThis.process;
  const originalFetch = globalThis.fetch;

  clearPromptCache();

  try {
    globalThis.process = undefined;

    const manifestUrl = "https://example.com/prompts/manifest.json";
    let manifestFetches = 0;
    let promptFetches = 0;

    globalThis.fetch = async (url) => {
      const u = String(url || "");

      if (u === manifestUrl) {
        manifestFetches += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              prompts: [{ name: "deepsearch/system", path: "deepsearch/system.md" }],
            };
          },
        };
      }

      if (u === "https://example.com/prompts/deepsearch/system.md") {
        promptFetches += 1;
        return {
          ok: true,
          status: 200,
          async text() {
            return "# system\n";
          },
        };
      }

      return {
        ok: false,
        status: 404,
        async text() {
          return "not_found";
        },
      };
    };

    const first = await loadPrompt("deepsearch/system", { cache: false, manifestUrl });
    expect(first).toBe("# system");

    // Second call should reuse the cached manifest (no second manifest fetch).
    const second = await loadPrompt("deepsearch/system", { cache: false, manifestUrl });
    expect(second).toBe("# system");

    expect(manifestFetches).toBe(1);
    expect(promptFetches).toBe(2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.process = originalProcess;
    clearPromptCache();
  }
});

it("PromptLoader: maxPromptBytes blocks oversized prompt fetch (browser)", async () => {
  const { PromptLoader } = await import("../../js/agents/prompts/prompt-loader.js");

  const originalProcess = globalThis.process;
  globalThis.process = undefined;

  try {
    const manifestUrl = "https://example.com/prompts/manifest.json";
    let manifestFetches = 0;
    let promptFetches = 0;

    const loader = new PromptLoader({
      maxPromptBytes: 50,
      fetchImpl: async (url) => {
        const u = String(url || "");

        if (u === manifestUrl) {
          manifestFetches += 1;
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                prompts: [{ name: "deepsearch/system", path: "deepsearch/system.md" }],
              };
            },
          };
        }

        if (u === "https://example.com/prompts/deepsearch/system.md") {
          promptFetches += 1;
          return new Response("x".repeat(200), {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        return new Response("not_found", { status: 404 });
      },
    });

    await expect(
      loader.loadPrompt("deepsearch/system", { cache: false, manifestUrl })
    ).rejects.toThrow(/exceeds limit/i);
    expect(manifestFetches).toBe(1);
    expect(promptFetches).toBe(1);
  } finally {
    globalThis.process = originalProcess;
  }
});

it("PromptLoader: maxManifestBytes rejects oversized manifest then falls back to basePath fetch", async () => {
  const { PromptLoader } = await import("../../js/agents/prompts/prompt-loader.js");

  const originalProcess = globalThis.process;
  globalThis.process = undefined;

  try {
    const manifestUrl = "https://example.com/prompts/manifest.json";
    let manifestFetches = 0;
    let promptFetches = 0;

    const loader = new PromptLoader({
      basePath: "https://example.com/prompts/",
      maxManifestBytes: 50,
      fetchImpl: async (url) => {
        const u = String(url || "");

        if (u === manifestUrl) {
          manifestFetches += 1;
          return new Response(
            JSON.stringify({
              prompts: [{ name: "deepsearch/system", path: "deepsearch/system.md", padding: "x".repeat(200) }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (u === "public/prompts/manifest.json") {
          manifestFetches += 1;
          return new Response("not_found", { status: 404 });
        }

        if (u === "https://example.com/prompts/deepsearch/system.md") {
          promptFetches += 1;
          return new Response("# system\n", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }

        return new Response("not_found", { status: 404 });
      },
    });

    const out = await loader.loadPrompt("deepsearch/system", { cache: false, manifestUrl });
    expect(out).toBe("# system");
    expect(manifestFetches).toBe(2);
    expect(promptFetches).toBe(1);
  } finally {
    globalThis.process = originalProcess;
  }
});

it("ConfigLoader: loadAgentConfig loads .agent/agent.md in Node", async () => {
  const { loadAgentConfig } = await import("../../js/agents/sdk/config-loader.js");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const os = require("node:os");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pb-agentcfg-"));
  try {
    await fs.mkdir(path.join(tmp, ".agent"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".agent", "agent.md"),
      [
        "---",
        "skills: [search-docs, write-report]",
        "model: gpt-4",
        "hooks:",
        "  - ./hooks/audit.js",
        "---",
        "Hello",
        "",
      ].join("\n"),
      "utf8"
    );

    const cfg = await loadAgentConfig(tmp);
    expect(cfg._loaded).toBe(true);
    expect(cfg._path).toBe(path.join(tmp, ".agent", "agent.md"));
    expect(cfg.instructions).toBe("Hello");
    expect(cfg.skills).toEqual(["search-docs", "write-report"]);
    expect(cfg.model).toBe("gpt-4");
    expect(cfg.hooks).toEqual(["./hooks/audit.js"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

it("ConfigLoader: loadAgentConfig degrades gracefully without Node APIs", async () => {
  const { loadAgentConfig } = await import("../../js/agents/sdk/config-loader.js");

  const originalProcess = globalThis.process;
  try {
    globalThis.process = undefined;
    const cfg = await loadAgentConfig("/repo-root/");
    expect(cfg._loaded).toBe(false);
    expect(cfg.instructions).toBe("");
    expect(cfg._path).toBe("/repo-root/.agent/agent.md");
  } finally {
    globalThis.process = originalProcess;
  }
});

it("BaseAgentLoop: strict loopStatus transitions reject illegal jumps", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const { AgentStatus } = await import("../../js/agents/runtime/core/agent-status.js");

  const strictLoop = new BaseAgentLoop({ actor: "test", stageName: "test", strictLoopStatus: true });
  strictLoop.initLoopStatus({ status: AgentStatus.IDLE });
  strictLoop._transitionLoopStatus(AgentStatus.RUNNING, { runId: "run_test" });
  strictLoop._transitionLoopStatus(AgentStatus.COMPLETED, { runId: "run_test" });

  expect(() => strictLoop._transitionLoopStatus(AgentStatus.RUNNING, { runId: "run_test" })).toThrow(/loopStatus transition rejected/);

  // Explicit reset is allowed even in strict mode.
  strictLoop._transitionLoopStatus(AgentStatus.IDLE, { runId: "run_test", allowReset: true });
  expect(strictLoop.loopStatus).toBe(AgentStatus.IDLE);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const warnOnlyLoop = new BaseAgentLoop({ actor: "test", stageName: "test", strictLoopStatus: false });
    warnOnlyLoop.initLoopStatus({ status: AgentStatus.COMPLETED });
    warnOnlyLoop._transitionLoopStatus(AgentStatus.RUNNING, { runId: "run_test" });
    expect(warnOnlyLoop.loopStatus).toBe(AgentStatus.RUNNING);
  } finally {
    console.warn = originalWarn;
  }
});

it("PlanStore: lifecycle transitions enforce draft→approved→in_progress", async () => {
  const {
    PlanLifecycleStatus,
    createPlan,
    canTransitionPlanLifecycle,
    setPlanLifecycleStatus,
  } = await import("../../js/agents/runtime/plan/plan-store.js");

  const plan = createPlan({ runId: "run_test", title: "T", steps: [] });
  expect(plan.lifecycleStatus).toBe(PlanLifecycleStatus.DRAFT);

  expect(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.IN_PROGRESS)).toBe(false);

  const approved = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED);
  expect(approved.lifecycleStatus).toBe(PlanLifecycleStatus.APPROVED);

  const inProgress = setPlanLifecycleStatus(approved, PlanLifecycleStatus.IN_PROGRESS);
  expect(inProgress.lifecycleStatus).toBe(PlanLifecycleStatus.IN_PROGRESS);

  const completed = setPlanLifecycleStatus(inProgress, PlanLifecycleStatus.COMPLETED);
  expect(completed.lifecycleStatus).toBe(PlanLifecycleStatus.COMPLETED);

  expect(() => setPlanLifecycleStatus(completed, PlanLifecycleStatus.IN_PROGRESS)).toThrow(/invalid transition/);

  const forced = setPlanLifecycleStatus(completed, PlanLifecycleStatus.IN_PROGRESS, { force: true });
  expect(forced.lifecycleStatus).toBe(PlanLifecycleStatus.IN_PROGRESS);
});

it("PolicyEngine: domain suffix + all/any/not + timeRange matching", async () => {
  const { PolicyEngine } = await import("../../js/agents/runtime/policy/engine.js");

  const engine = new PolicyEngine({
    defaultEffect: "prompt",
    rules: [
      {
        ruleId: "deny_github",
        effect: "deny",
        priority: 10,
        match: {
          all: [
            { type: "tool.call" },
            { domainSuffix: "github.com" },
          ],
        },
      },
      {
        ruleId: "deny_off_hours",
        effect: "deny",
        priority: 9,
        match: {
          all: [
            { type: "tool.call" },
            { timeRange: { start: "00:00", end: "00:10", timezone: "utc" } },
          ],
        },
      },
      {
        ruleId: "allow_docs_path",
        effect: "allow",
        priority: 3,
        match: {
          all: [
            { type: "vfs.*" },
            { path: "/docs/**" },
          ],
        },
      },
      {
        ruleId: "allow_vfs_except_secrets",
        effect: "allow",
        priority: 2,
        match: {
          all: [
            { type: "vfs.*" },
            { not: [{ path: "secrets/**" }] },
          ],
        },
      },
    ],
  });

  const denyGithub = engine.evaluate({
    type: "tool.call",
    tool: "http.get",
    resource: "https://api.github.com/repos/openai",
  });
  expect(denyGithub.allowed).toBe(false);
  expect(denyGithub.requiresApproval).toBe(false);
  expect(denyGithub.effect).toBe("deny");
  expect(denyGithub.ruleId).toBe("deny_github");

  const denyOffHours = engine.evaluate({
    type: "tool.call",
    tool: "http.get",
    resource: "https://example.com",
    ts: "2025-01-01T00:05:00Z",
  });
  expect(denyOffHours.allowed).toBe(false);
  expect(denyOffHours.requiresApproval).toBe(false);
  expect(denyOffHours.ruleId).toBe("deny_off_hours");

  const engineInvalidTime = new PolicyEngine({
    defaultEffect: "prompt",
    rules: [
      {
        ruleId: "deny_invalid_time_should_not_match",
        effect: "deny",
        priority: 1,
        match: {
          all: [
            { type: "tool.call" },
            { timeRange: { start: "xx", end: "yy", timezone: "utc" } },
          ],
        },
      },
    ],
  });
  const invalidTimeDoesNotMatch = engineInvalidTime.evaluate({
    type: "tool.call",
    tool: "http.get",
    resource: "https://example.com",
    ts: "2025-01-01T00:05:00Z",
  });
  expect(invalidTimeDoesNotMatch.allowed).toBe(false);
  expect(invalidTimeDoesNotMatch.requiresApproval).toBe(true);
  expect(invalidTimeDoesNotMatch.reason).toBe("no_matching_rule");

  const allowDocs = engine.evaluate({
    type: "vfs.write",
    tool: "vfs.writeText",
    resource: "docs/readme.md",
  });
  expect(allowDocs.allowed).toBe(true);
  expect(allowDocs.requiresApproval).toBe(false);
  expect(allowDocs.effect).toBe("allow");
  expect(allowDocs.ruleId).toBe("allow_docs_path");

  const secretsRequireApproval = engine.evaluate({
    type: "vfs.write",
    tool: "vfs.writeText",
    resource: "secrets/token.txt",
  });
  expect(secretsRequireApproval.allowed).toBe(false);
  expect(secretsRequireApproval.requiresApproval).toBe(true);
  expect(secretsRequireApproval.reason).toBe("no_matching_rule");
});

function createFakeTime(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
  };
}

it("RuntimeScheduler: health status transitions (failures + latency)", async () => {
  const { RuntimeScheduler, RuntimeHealthStatus } = await import("../../js/agents/runtime/core/scheduler.js");

  const time = createFakeTime(0);
  const scheduler = new RuntimeScheduler({
    time,
    health: {
      degradedFailureThreshold: 1,
      unhealthyFailureThreshold: 2,
      degradedLatencyMs: 50,
      unhealthyLatencyMs: 500,
      latencyEwmaAlpha: 1,
      recoverySuccessThreshold: 1,
    },
  });

  let mode = "fast_ok";
  const runtime = {
    execute: async () => {
      if (mode === "fast_ok") {
        time.advance(10);
        return { success: true, data: "ok" };
      }
      if (mode === "slow_ok") {
        time.advance(60);
        return { success: true, data: "ok" };
      }
      if (mode === "fail_1") {
        time.advance(10);
        return { success: false, error: "boom" };
      }
      if (mode === "fail_2") {
        time.advance(10);
        return { success: false, error: "boom2" };
      }
      time.advance(1);
      return { success: true };
    },
  };

  scheduler.registerRuntime("js", runtime);
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.HEALTHY);

  await scheduler.dispatch("js", "return 1;", {}, {});
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.HEALTHY);
  expect(scheduler.getHealthMetrics("js").averageLatencyMs).toBe(10);

  mode = "slow_ok";
  await scheduler.dispatch("js", "return 1;", {}, {});
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.DEGRADED);
  expect(scheduler.getHealthMetrics("js").averageLatencyMs).toBe(60);

  mode = "fast_ok";
  await scheduler.dispatch("js", "return 1;", {}, {});
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.HEALTHY);

  mode = "fail_1";
  await scheduler.dispatch("js", "return 1;", {}, {});
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.DEGRADED);

  mode = "fail_2";
  const out = await scheduler.dispatch("js", "return 1;", {}, {});
  expect(out.success).toBe(false);
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.UNHEALTHY);
  expect(scheduler.getHealthMetrics("js").isolated).toBe(true);
});

it("RuntimeScheduler: isolation blocks dispatch and recoveryCheck restores runtime", async () => {
  const { RuntimeScheduler, RuntimeHealthStatus } = await import("../../js/agents/runtime/core/scheduler.js");

  const time = createFakeTime(0);
  const scheduler = new RuntimeScheduler({
    time,
    health: {
      degradedFailureThreshold: 1,
      unhealthyFailureThreshold: 1,
      degradedLatencyMs: 1000,
      unhealthyLatencyMs: 5000,
      latencyEwmaAlpha: 1,
      recoverySuccessThreshold: 1,
    },
  });

  let shouldFail = true;
  let executeCalls = 0;

  const runtime = {
    execute: async () => {
      executeCalls += 1;
      time.advance(5);
      if (shouldFail) return { success: false, error: "boom" };
      return { success: true, data: "ok" };
    },
    healthCheck: async () => {
      time.advance(1);
      return !shouldFail;
    },
  };

  scheduler.registerRuntime("js", runtime);

  const first = await scheduler.dispatch("js", "return 1;", {}, {});
  expect(first.success).toBe(false);
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.UNHEALTHY);
  expect(scheduler.getHealthMetrics("js").isolated).toBe(true);

  const beforeCalls = executeCalls;
  const blocked = await scheduler.dispatch("js", "return 1;", {}, {});
  expect(blocked.success).toBe(false);
  expect(blocked.error).toMatch(/isolated/i);
  expect(executeCalls).toBe(beforeCalls);
  expect(scheduler.getHealthMetrics("js").blockedCount).toBe(1);

  shouldFail = false;
  const recovered = await scheduler.recoveryCheck();
  expect(recovered.js.ok).toBe(true);
  expect(scheduler.getHealthMetrics("js").isolated).toBe(false);
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.DEGRADED);

  const after = await scheduler.dispatch("js", "return 1;", {}, {});
  expect(after.success).toBe(true);
  expect(scheduler.getHealthStatus("js")).toBe(RuntimeHealthStatus.HEALTHY);
});

it("Runtime: TaskGraph layered topo sort + cycle/missing detection", async () => {
  const { TaskGraph } = await import("../../js/agents/runtime/parallel/task-graph.js");

  const g = new TaskGraph();
  g.addTask("A");
  g.addTask("B", ["A"]);
  g.addTask("C", ["A"]);
  g.addTask("D", ["B", "C"]);

  const levels = g.getLevels();
  expect(levels).toEqual([["A"], ["B", "C"], ["D"]]);

  const cycle = new TaskGraph();
  cycle.addTask("A", ["B"]);
  cycle.addTask("B", ["A"]);
  expect(() => cycle.getLevels()).toThrow(/cycle detected/i);

  const missing = new TaskGraph();
  missing.addTask("A", ["NOPE"]);
  expect(() => missing.getLevels()).toThrow(/missing dependency/i);
});

it("Runtime: command classifier parses compound commands and flags danger", async () => {
  const { classifyCommand, parseCompoundCommand } = await import("../../js/agents/runtime/safety/command-classifier.js");

  expect(parseCompoundCommand("echo hi && ls")).toEqual([["echo", "hi"], ["ls"]]);
  expect(classifyCommand(["ls", "-la"]).level).toBe("safe");
  expect(classifyCommand("unknowncmd").level).toBe("unknown");

  const dangerous = classifyCommand("rm -rf /");
  expect(dangerous.level).toBe("dangerous");
  expect(dangerous.requiresApproval).toBe(true);

  const forkBomb = classifyCommand("bash -c ':(){ :|:& };:'");
  expect(forkBomb.level).toBe("dangerous");
  expect(forkBomb.requiresApproval).toBe(true);
  expect(forkBomb.reasons).toEqual(["fork_bomb"]);

  const sensitive = classifyCommand("cat /etc/shadow");
  expect(sensitive.level).toBe("dangerous");
  expect(sensitive.requiresApproval).toBe(true);
  expect(sensitive.reasons).toEqual(["sensitive_path"]);

  const nested = classifyCommand(["bash", "-c", "ls && rm -rf /"]);
  expect(nested.level).toBe("dangerous");
});

it("Runtime: AgentCheckpointStore persists and restores checkpoints", async () => {
  const { AgentCheckpointStore } = await import("../../js/agents/runtime/checkpoints/agent-checkpoint-store.js");
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");

  const vfs = new MemoryVfs();
  const store = new AgentCheckpointStore({ vfs, runId: "run_test" });

  const saved = await store.saveCheckpoint({
    messages: [{ role: "user", content: "hello" }],
    toolCalls: [{ action: "noop", args: {}, result: { ok: true } }],
    results: [{ kind: "final", output: "ok" }],
    metadata: { note: "checkpoint" },
    iteration: 1,
  });

  expect(saved.checkpointId).toBeTruthy();

  const list = await store.listCheckpoints();
  expect(list.length).toBe(1);
  expect(list[0].checkpointId).toBe(saved.checkpointId);

  const last = await store.loadCheckpoint({ mode: "last" });
  expect(last.checkpointId).toBe(saved.checkpointId);
  expect(last.messages).toEqual([{ role: "user", content: "hello" }]);

  const byStep = await store.loadCheckpoint({ mode: "step", step: 1 });
  expect(byStep.checkpointId).toBe(saved.checkpointId);

  const byId = await store.loadCheckpoint({ checkpointId: saved.checkpointId });
  expect(byId.checkpointId).toBe(saved.checkpointId);
});

it("Runtime: EventBus hook registry attaches and PreToolUse hook can block", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/event-bus-hooks.js");
  const { createPreToolUseHook } = await import("../../js/agents/runtime/hooks/hook-runner.js");

  const bus = new EventBus();
  enhanceEventBusWithHooks(bus);

  bus.registerHook("PreToolUse", { type: "command", tools: "shell*", blocking: true });

  const pre = createPreToolUseHook();
  const blocked = await pre({
    tool: "shell.run",
    params: { command: "rm -rf /" },
    context: { eventBus: bus },
  });
  expect(blocked?.skip).toBe(true);
  expect(String(blocked?.value?.error || "")).toMatch(/requires approval/i);

  const allowed = await pre({
    tool: "shell.run",
    params: { command: "ls -la" },
    context: { eventBus: bus },
  });
  expect(allowed).toBe(null);
});

it("Runtime: PreToolUse prompt hook allows/denies based on model output", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/event-bus-hooks.js");
  const { createPreToolUseHook } = await import("../../js/agents/runtime/hooks/hook-runner.js");

  const bus = new EventBus();
  enhanceEventBusWithHooks(bus);

  bus.registerHook("PreToolUse", {
    type: "prompt",
    blocking: true,
    usage: "shadow",
    prompt: "Tool={{tool}} Args={{args}}",
  });

  const pre = createPreToolUseHook();

  const allow = await pre({
    tool: "write_file",
    params: { path: "a.txt", content: "hi" },
    context: {
      eventBus: bus,
      modelRouter: {
        call: async () => ({ content: '{"allow": true, "reason": "ok"}' }),
      },
    },
  });
  expect(allow).toBe(null);

  const deny = await pre({
    tool: "write_file",
    params: { path: "a.txt", content: "hi" },
    context: {
      eventBus: bus,
      modelRouter: {
        call: async () => ({ content: '{"allow": false, "reason": "no"}' }),
      },
    },
  });
  expect(deny?.skip).toBe(true);
  expect(String(deny?.value?.error || "")).toMatch(/no/i);
});

it("Runtime: PreToolUse prompt hook blocks on unparseable decision when blocking=true", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/event-bus-hooks.js");
  const { createPreToolUseHook } = await import("../../js/agents/runtime/hooks/hook-runner.js");

  const bus = new EventBus();
  enhanceEventBusWithHooks(bus);

  bus.registerHook("PreToolUse", {
    type: "prompt",
    blocking: true,
    usage: "shadow",
    prompt: "Tool={{tool}} Args={{args}}",
  });

  const pre = createPreToolUseHook();
  const out = await pre({
    tool: "write_file",
    params: { path: "a.txt" },
    context: {
      eventBus: bus,
      modelRouter: { call: async () => ({ content: "maybe" }) },
    },
  });

  expect(out?.skip).toBe(true);
  expect(String(out?.value?.error || "")).toMatch(/unparseable/i);
});

it("Runtime: PreToolUse agent hook can block and can be cleared", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/event-bus-hooks.js");
  const { createPreToolUseHook } = await import("../../js/agents/runtime/hooks/hook-runner.js");

  const bus = new EventBus();
  enhanceEventBusWithHooks(bus);

  const makeRegistry = (allow) => ({
    getFactory: () => async () => ({
      run: async () => ({ allow, reason: allow ? "ok" : "nope" }),
    }),
  });

  bus.registerHook("PreToolUse", { type: "agent", agentType: "Guard", blocking: true, prompt: "Tool={{tool}}" });

  const pre = createPreToolUseHook();
  const denied = await pre({
    tool: "write_file",
    params: { path: "a.txt" },
    context: { eventBus: bus, subagentRegistry: makeRegistry(false) },
  });
  expect(denied?.skip).toBe(true);
  expect(String(denied?.value?.error || "")).toMatch(/nope/i);

  bus.clearHooks("PreToolUse");
  bus.registerHook("PreToolUse", { type: "agent", agentType: "Guard", blocking: true, prompt: "Tool={{tool}}" });

  const allowed = await pre({
    tool: "write_file",
    params: { path: "a.txt" },
    context: { eventBus: bus, subagentRegistry: makeRegistry(true) },
  });
  expect(allowed).toBe(null);
});

it("LLM: parseContextOverflowError handles OpenAI-style messages", async () => {
  const { parseContextOverflowError, computeOverflowRetryMaxTokens } = await import("../../js/agents/llm/overflow-recovery.js");

  const err = new Error(
    "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens (8000 in the messages, 1000 in the completion)."
  );
  const info = parseContextOverflowError(err);
  expect(info?.contextLimit).toBe(8192);
  expect(info?.inputLength).toBe(8000);
  expect(info?.maxTokens).toBe(1000);

  const next = computeOverflowRetryMaxTokens(info, { minTokens: 256, bufferTokens: 128 });
  expect(next).toBe(256);
});

it("LLM: overflow recovery parses and retries with reduced max_tokens", async () => {
  const { CliModelClient } = await import("../../js/agents/cli/model-client.js");

  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (_url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ max_tokens: body.max_tokens, messages: body.messages });

    if (calls.length === 1) {
      return {
        ok: false,
        status: 400,
        headers: { get: () => "application/json" },
        json: async () => ({
          error: { message: "input length and `max_tokens` exceed context limit: 1500 + 900 > 2000" },
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({
        model: "mock-model",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };

  try {
    const client = new CliModelClient({
      apiKey: "test",
      baseUrl: "https://example.test/v1",
      model: "mock-model",
      contextWindow: 2000,
    });

    const messages = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] },
      { role: "tool", tool_call_id: "call_1", content: "x".repeat(50_000) },
      { role: "user", content: "later" },
    ];

    const out = await client.chat({ messages, maxTokens: 900 });
    expect(out.content).toBe("ok");
    expect(calls.length).toBe(2);
    expect(calls[1].max_tokens < calls[0].max_tokens).toBeTruthy();

    // Truncation should not leave a dangling tool output without its call.
    const sent = calls[0].messages;
    const lastRole = sent[sent.length - 1]?.role;
    expect(lastRole).not.toBe("tool");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("Runtime: AgentOrchestrator.runStagesGraph executes by dependency levels", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ scheduling: { mode: "parallel", maxConcurrency: 10 } });
  orch.registerStage("a", async () => "A");
  orch.registerStage("b", async () => "B");
  orch.registerStage("c", async () => "C");

  const results = await orch.runStagesGraph([
    { name: "a" },
    { name: "b", dependsOn: ["a"] },
    { name: "c", dependsOn: ["a"] },
  ]);

  expect(results.get("a").success).toBe(true);
  expect(results.get("b").success).toBe(true);
  expect(results.get("c").success).toBe(true);
});

it("Runtime: AgentOrchestrator.runStagesGraph skips dependents after failure when continueOnError=true", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");

  const orch = new AgentOrchestrator({ scheduling: { mode: "parallel", maxConcurrency: 10 } });
  orch.registerStage("a", async () => {
    throw new Error("boom");
  });
  orch.registerStage("b", async () => "B");

  const results = await orch.runStagesGraph(
    [
      { name: "a" },
      { name: "b", dependsOn: ["a"] },
    ],
    { continueOnError: true }
  );

  expect(results.get("a").success).toBe(false);
  expect(results.get("b").success).toBe(false);
  expect(results.get("b").skipped).toBe(true);
  expect(String(results.get("b").error || "")).toMatch(/dependency_failed:a/);
});

it("Runtime: concurrent agent loops keep isolated sessions", async () => {
  const { DefaultAgentLoop } = await import("../../js/agents/sdk/DefaultAgentLoop.js");

  const makeCallModel = (label, delayMs) => async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return JSON.stringify({ action: "complete", final: `done:${label}` });
  };

  const loopA = new DefaultAgentLoop({ actor: "agent-a", stageName: "agent-a" });
  const loopB = new DefaultAgentLoop({ actor: "agent-b", stageName: "agent-b" });

  const [resA, resB] = await Promise.all([
    loopA.run("hello A", { callModel: makeCallModel("A", 20) }),
    loopB.run("hello B", { callModel: makeCallModel("B", 5) }),
  ]);

  expect(resA.success).toBe(true);
  expect(resB.success).toBe(true);
  expect(resA.output).toBe("done:A");
  expect(resB.output).toBe("done:B");
  expect(resA.toolCalls.length).toBe(0);
  expect(resB.toolCalls.length).toBe(0);

  expect(loopA.messages).not.toBe(loopB.messages);

  const aUserMessages = loopA.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const bUserMessages = loopB.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");

  expect(aUserMessages).toMatch(/hello A/);
  expect(bUserMessages).toMatch(/hello B/);
  expect(/hello B/.test(aUserMessages)).toBe(false);
  expect(/hello A/.test(bUserMessages)).toBe(false);
});
