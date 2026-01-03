const test = require("node:test");
const assert = require("node:assert/strict");

// 以下测试引用了已删除的 run-context.js，已移除

test("Runtime Constants: report enums + quality mode normalization", async () => {
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

  assert.equal(normalizeReportTone("Business"), ReportTone.BUSINESS);
  assert.equal(normalizeReportTone("ACADEMIC"), ReportTone.ACADEMIC);
  assert.equal(normalizeReportTone("neutral"), undefined);

  assert.equal(normalizeReportAudience("EXECUTIVE"), ReportAudience.EXECUTIVE);
  assert.equal(normalizeReportAudience("expert"), ReportAudience.EXPERT);
  assert.equal(normalizeReportAudience("student"), undefined);

  assert.equal(normalizeReportLanguage("zh"), ReportLanguage.ZH);
  assert.equal(normalizeReportLanguage("AUTO"), ReportLanguage.AUTO);
  assert.equal(normalizeReportLanguage("fr"), undefined);

  assert.equal(normalizeReportLength("detailed"), ReportLength.DETAILED);
  assert.equal(normalizeReportLength("COMPREHENSIVE"), ReportLength.COMPREHENSIVE);
  assert.equal(normalizeReportLength("long"), undefined);

  assert.equal(normalizeQualityMode("HIGH"), QualityMode.HIGH);
  assert.equal(normalizeQualityMode("standard"), QualityMode.STANDARD);
  assert.equal(normalizeQualityMode("extreme"), undefined);
});

test("Runtime Core: EventBus on/off/once/emit + EventRecord fields", async () => {
  const { EventBus, isValidEventName } = await import("../../js/agents/runtime/events/event-bus.js");

  assert.ok(isValidEventName("run.started"));
  assert.ok(isValidEventName("textprep.chunk.completed"));
  assert.equal(isValidEventName("Run.Started"), false);
  assert.equal(isValidEventName("bad..name"), false);  // 连续点号不合法
  assert.ok(isValidEventName("bad_name"));  // 下划线现在合法

  const bus = new EventBus({ runId: "run_2025-12-12_22-30-01_a3f9f" });

  const seen = [];
  const offAny = bus.on("*", (e) => seen.push(e));

  let onceCount = 0;
  bus.once("run.started", () => {
    onceCount++;
  });

  const evt1 = bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "textprep" } });
  const evt2 = bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "textprep" } });

  assert.equal(onceCount, 1);
  assert.equal(evt1.schemaVersion, "0.1");
  assert.equal(evt1.runId, bus.runId);
  assert.equal(evt1.name, "run.started");
  assert.equal(evt1.actor, "system");
  assert.equal(evt1.status, "started");
  assert.deepEqual(evt1.payload, { mode: "textprep" });
  assert.ok(typeof evt1.eventId === "string" && evt1.eventId.startsWith("evt_"));
  assert.ok(typeof evt1.ts === "string" && evt1.ts.includes("T"));

  offAny();
  bus.emit("run.ended", { actor: "system", status: "ended" });
  assert.equal(seen.filter((e) => e.name === "run.ended").length, 0);

  // off(name, fn)
  let hits = 0;
  const fn = () => {
    hits++;
  };
  bus.on("run.ended", fn);
  bus.off("run.ended", fn);
  bus.emit("run.ended", { actor: "system", status: "ended" });
  assert.equal(hits, 0);

  // emit(name, payloadObject) convenience
  const evt3 = bus.emit("run.progress", { pct: 50 });
  assert.deepEqual(evt3.payload, { pct: 50 });
});

test("VFS: MemoryVfs directory tree + mkdir/rmdir/unlink", async () => {
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");

  const vfs = new MemoryVfs();

  await vfs.mkdir("empty");
  await vfs.writeText("a/b.txt", "hi");
  assert.equal(await vfs.exists("a/b.txt"), true);
  assert.equal(await vfs.exists("a/missing.txt"), false);

  const rootEntries = await vfs.readdir("", { withFileTypes: true });
  assert.deepEqual(
    rootEntries.map((e) => e.name),
    ["a", "empty"]
  );
  assert.equal(
    rootEntries.find((e) => e.name === "a")?.isDirectory(),
    true
  );
  assert.equal(
    rootEntries.find((e) => e.name === "empty")?.isDirectory(),
    true
  );

  const aStat = await vfs.stat("a");
  assert.equal(aStat.isDirectory(), true);

  assert.deepEqual(await vfs.readdir("a"), ["b.txt"]);
  assert.deepEqual(await vfs.listFiles({ prefix: "a", recursive: true }), ["a/b.txt"]);
  assert.deepEqual(await vfs.listFiles({ prefix: "a/b.txt" }), ["a/b.txt"]);

  await vfs.copy("a/b.txt", "a/c.txt");
  assert.equal(await vfs.readText("a/c.txt"), "hi");

  await vfs.move("a/c.txt", "a/d.txt");
  assert.equal(await vfs.exists("a/c.txt"), false);
  assert.equal(await vfs.readText("a/d.txt"), "hi");

  await vfs.appendText("a/d.txt", "!");
  assert.equal(await vfs.readText("a/d.txt"), "hi!");

  await assert.rejects(async () => vfs.rmdir("a"), /ENOTEMPTY/);

  await vfs.unlink("a/b.txt");
  await vfs.unlink("a/d.txt");
  assert.deepEqual(await vfs.readdir("a"), []);
  await vfs.rmdir("a");

  await assert.rejects(async () => vfs.stat("a"), /ENOENT/);
  await assert.rejects(async () => vfs.rmdir(""), /cannot remove root/);
});

test("VFS: MemoryVfs mkdir recursive=false semantics", async () => {
  const { MemoryVfs } = await import("../../js/agents/vfs/vfs.memory.js");
  const vfs = new MemoryVfs();

  await vfs.mkdir("dir");
  await assert.rejects(async () => vfs.mkdir("dir", { recursive: false }), /EEXIST/);

  await vfs.writeText("file.txt", "x");
  await assert.rejects(async () => vfs.mkdir("file.txt", { recursive: true }), /EEXIST/);
  await assert.rejects(async () => vfs.mkdir("file.txt", { recursive: false }), /EEXIST/);

  await assert.rejects(async () => vfs.mkdir("missing/child", { recursive: false }), /ENOENT/);
});

test("VFS glob: createVfsGlobFn uses walkFiles + static dir prefix", async () => {
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
  assert.deepEqual(files, ["src/a.js"]);
  assert.equal(seenPrefixes[0], "src");
});

test("VFS operations: writeTextFileWithPolicy serializes concurrent writes", async () => {
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

  assert.equal(vfs.text, "second");
});

test("VFS operations: multiEditTextFileWithPolicy supports indentation-normalized fallback", async () => {
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
  assert.ok(after.includes("return 2;"));
  assert.equal(after.includes("return 1;"), false);
});

test("Runtime Core: EventBus backpressure default stays synchronous", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "a" });
  assert.equal(hits, 1);
});

test("Runtime Core: EventBus backpressure batching + coalesce + order + seq", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

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

  assert.equal(events.length, 0);

  await sleep(60);

  assert.deepEqual(
    events.map((e) => e.name),
    ["run.log", "run.log", "run.progress"]
  );

  const progress = events.filter((e) => e.name === "run.progress");
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].payload, { i: 5 });

  const logs = events.filter((e) => e.name === "run.log");
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((e) => e.payload), [{ msg: "a" }, { msg: "b" }]);

  const seqs = events.map(seqOf);
  assert.ok(seqs[0] < seqs[1] && seqs[1] < seqs[2]);

  bus.emit("run.log", { msg: "c" });
  await sleep(60);
  assert.equal(events.filter((e) => e.payload?.msg === "c").length, 1);
  assert.ok(seqOf(events.at(-1)) > seqs.at(-1));
});

test("Runtime Core: EventBus backpressure custom coalescePattern + disable restores sync", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

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

  assert.equal(progress.length, 3);
  assert.deepEqual(progress.map((e) => e.payload), [{ i: 1 }, { i: 2 }, { i: 3 }]);

  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].payload, { msg: "c" });

  bus.disableBackpressure();

  let sync = false;
  bus.on("run.log", () => {
    sync = true;
  });
  bus.emit("run.log", { msg: "sync" });
  assert.equal(sync, true);
});

test("Runtime Core: EventBus backpressure batchWindowMs controls flush timing", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  bus.enableBackpressure({ batchWindowMs: 40 });

  let hits = 0;
  bus.on("run.log", () => {
    hits++;
  });

  bus.emit("run.log", { msg: "delayed" });
  await sleep(10);
  assert.equal(hits, 0);

  await sleep(60);
  assert.equal(hits, 1);
});

test("Runtime Core: EventBus backpressure rAF scheduling branch", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

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
    assert.equal(hits, 1);

    // Exercise the empty-queue flush path.
    bus.enableBackpressure();
    bus.disableBackpressure();
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("Runtime Core: EventBus backpressure ignores stale scheduled flush callbacks", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

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
    assert.equal(hits, 1);

    bus.enableBackpressure({ batchWindowMs: 0 });
    bus.emit("run.log", { msg: "new" });
    const newId = bus._backpressure?.rafId;
    assert.equal(hits, 1);

    callbacks.get(oldId)?.(Date.now());
    assert.equal(hits, 1);

    callbacks.get(newId)?.(Date.now());
    assert.equal(hits, 2);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("Runtime Core: EventBus validation errors", async () => {
  const { EventBus, createEventRecord } = await import("../../js/agents/runtime/events/event-bus.js");

  assert.throws(() => createEventRecord({ name: "Bad.Name" }), /Invalid event name/);

  const bus = new EventBus({ runId: "run_test" });
  assert.throws(() => bus.on("run.log", "nope"), /handler must be a function/);
  assert.throws(() => bus.on("Bad.Name", () => {}), /Invalid event name/);

  assert.throws(() => bus.enableBackpressure(123), /options must be an object/);
  assert.throws(() => bus.enableBackpressure({ batchWindowMs: -1 }), /batchWindowMs/);
  assert.throws(() => bus.enableBackpressure({ coalescePattern: "x" }), /coalescePattern/);
});

test("Runtime Core: EventBus backpressure re-enable flushes queued and cancels timer", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const bus = new EventBus({ runId: "run_test" });
  const seen = [];
  bus.on("run.log", (e) => seen.push(e));

  bus.enableBackpressure({ batchWindowMs: 100 });
  bus.emit("run.log", { msg: "queued" });

  // Re-enabling should cancel the pending timer and flush queued events immediately.
  bus.enableBackpressure({ batchWindowMs: 1, coalescePattern: /\.progress$/g });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].payload, { msg: "queued" });

  // Also exercise global-regexp coalescing behavior.
  const progress = [];
  bus.on("run.progress", (e) => progress.push(e));
  bus.emit("run.progress", { i: 1 });
  bus.emit("run.progress", { i: 2 });
  await sleep(20);
  assert.equal(progress.length, 1);
  assert.deepEqual(progress[0].payload, { i: 2 });
});

test("Runtime Core: EventBus persistence adapter best-effort appendEvents", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

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

    assert.equal(calls, 1);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].name, "run.log");
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

test("Runtime Core: EventBus replay loads events and marks meta.replay", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  // No adapter -> clear error.
  await assert.rejects(() => new EventBus().replay("run_test"), /persistenceAdapter is required/);

  // Bad runId.
  await assert.rejects(
    () =>
      new EventBus({
        persistenceAdapter: { appendEvents: async () => {}, getEvents: async () => [] },
      }).replay(123),
    /runId must be a string/
  );

  // getEvents throws -> wrapped error.
  await assert.rejects(
    () =>
      new EventBus({
        persistenceAdapter: {
          appendEvents: async () => {},
          getEvents: async () => {
            throw new Error("boom");
          },
        },
      }).replay("run_test"),
    /failed to load events/
  );

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
  assert.equal(out.length, 1);
  assert.equal(out[0].meta.replay, true);
  assert.equal(out[0].meta.foo, "bar");
  assert.equal(replayed.length, 1);

  // replay should not persist events.
  assert.equal(appendCalls, 0);
});

test("Runtime Core: RunStoreAdapter validation + appendEvents branches", async () => {
  const { RunStoreAdapter } = await import("../../js/agents/runtime/events/event-bus.js");

  assert.throws(() => new RunStoreAdapter(null), /runStore.getEvents must be a function/);
  assert.throws(() => new RunStoreAdapter({ getEvents: async () => [] }), /appendEvents\/appendEvent/);

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

    await assert.rejects(() => adapter.appendEvents("nope"), /events must be an array/);
    assert.equal(await adapter.appendEvents([]), 0);

    const n = await adapter.appendEvents([
      { runId: "run_a", name: "run.log" },
      { runId: "run_a", name: "run.log" },
    ]);
    assert.equal(n, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].runId, "run_a");
    assert.equal(calls[0].events.length, 2);

    const got = await adapter.getEvents("run_a");
    assert.equal(got[0].runId, "run_a");
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

    await assert.rejects(() => adapter.appendEvents([{ name: "run.log" }]), /must include a string runId/);

    const n = await adapter.appendEvents([
      { runId: "run_b", name: "run.log", payload: { i: 1 } },
      { runId: "run_b", name: "run.log", payload: { i: 2 } },
    ]);
    assert.equal(n, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].runId, "run_b");
    assert.equal(calls[1].evt.payload.i, 2);
  }
});

// 以下测试引用了已删除的 run-context.js 和 orchestrator.js，已移除

test("Runtime Core: EventBus subscribe with wildcard pattern", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const deepSearchEvents = [];
  const designEvents = [];

	  bus.subscribe("deepsearch.*", (e) => deepSearchEvents.push(e));
	  bus.subscribe("design.*", (e) => designEvents.push(e));

	  bus.emit("deepsearch.scan.started", { status: "started" });
	  bus.emit("deepsearch.gaps.completed", { status: "completed" });
	  bus.emit("design.started", { status: "started" });
	  bus.emit("run.started", { status: "started" });

  assert.equal(deepSearchEvents.length, 2);
  assert.equal(designEvents.length, 1);
  assert.ok(deepSearchEvents.every((e) => e.name.startsWith("deepsearch.")));
});

test("Runtime Core: EventBus subscribe returns unsubscribe function", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const events = [];

  const unsubscribe = bus.subscribe("deepsearch.*", (e) => events.push(e));

  bus.emit("deepsearch.scan.started", {});
  assert.equal(events.length, 1);

  unsubscribe();

  bus.emit("deepsearch.scan.completed", {});
  assert.equal(events.length, 1); // no new events after unsubscribe
});

test("Runtime Core: EventBus subscribe with priority executes in order", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  // 注册不同优先级的 handlers
  bus.subscribe("test.event", () => execution.push("low"), { priority: -10 });
  bus.subscribe("test.event", () => execution.push("normal"));  // priority 0
  bus.subscribe("test.event", () => execution.push("high"), { priority: 10 });
  bus.subscribe("test.event", () => execution.push("critical"), { priority: 100 });

  bus.emit("test.event", {});

  // 高优先级先执行
  assert.deepEqual(execution, ["critical", "high", "normal", "low"]);
});

test("Runtime Core: EventBus subscribe with priority + wildcard", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  // 通配符 + 优先级
  bus.subscribe("test.*", () => execution.push("wildcard-high"), { priority: 50 });
  bus.subscribe("test.*", () => execution.push("wildcard-normal"));
  bus.subscribe("test.event", () => execution.push("exact-low"), { priority: -5 });
  bus.subscribe("test.event", () => execution.push("exact-high"), { priority: 25 });

  bus.emit("test.event", {});

  assert.deepEqual(execution, ["wildcard-high", "exact-high", "wildcard-normal", "exact-low"]);
});

test("Runtime Core: EventBus subscribe priority unsubscribe cleanup", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });
  const execution = [];

  const unsub1 = bus.subscribe("test.event", () => execution.push("a"), { priority: 10 });
  const unsub2 = bus.subscribe("test.*", () => execution.push("b"), { priority: 20 });

  bus.emit("test.event", {});
  assert.deepEqual(execution, ["b", "a"]);

  unsub1();
  unsub2();

  execution.length = 0;
  bus.emit("test.event", {});
  assert.deepEqual(execution, []);  // all unsubscribed
});

test("Runtime Core: EventBus subscribe priority validation", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

  const bus = new EventBus({ runId: "run_test" });

  assert.throws(() => bus.subscribe("test.event", () => {}, { priority: "high" }), /priority must be a finite number/);
  assert.throws(() => bus.subscribe("test.event", () => {}, { priority: Infinity }), /priority must be a finite number/);
});

test("Runtime Core: EventBus listener errors are isolated (sync + async)", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");

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

  assert.doesNotThrow(() => bus.emit("run.log", { msg: "x" }));
  assert.deepEqual(order, ["a", "b", "c"]);

  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 2);
  assert.ok(errors.some((e) => e.message.includes("boom_sync") && e.name === "run.log"));
  assert.ok(errors.some((e) => e.message.includes("boom_async") && e.name === "run.log"));
});

test("Runtime Telemetry: subscribeTelemetry keeps bounded in-memory timeline", async () => {
  const { EventBus } = await import("../../js/agents/runtime/events/event-bus.js");
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

  assert.equal(stored.length, 5);
  assert.equal(sub.timeline.length, 3);
  assert.deepEqual(
    sub.timeline.map((r) => r.payload?.i),
    [2, 3, 4]
  );
  assert.equal(sub.snapshot().timeline.length, 3);
  sub.unsubscribe();
});

test("Runtime Tools: ToolExecutor worker isolation enforces hard timeout for sync work", async () => {
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

  assert.equal(result.success, false);
  assert.ok(String(result.error || "").includes("timed out"));
  assert.ok(elapsedMs < 300);
});

test("Runtime Tools: WorkerPool caps concurrent worker creation", async () => {
  const { __test } = await import("../../js/agents/runtime/tools/tool-executor.js");
  const WorkerPool = __test?.WorkerPool;
  assert.ok(typeof WorkerPool === "function");

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
  assert.equal(created, 2);

  let p3Resolved = false;
  void p3.then(() => {
    p3Resolved = true;
  });

  await new Promise((r) => setImmediate(r));
  assert.equal(p3Resolved, false);

  pool.release(w1);
  const w3 = await p3;
  assert.ok(w3);
  assert.equal(created, 2);

  pool.release(w2);
  pool.release(w3);
});

test("Runtime Compression: anchors preserve initial system prompts across repeated compression", async () => {
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

  assert.equal(loop.messages[0].content, anchor1);
  assert.equal(loop.messages[1].content, anchor2);
  const summaryIdx1 = loop.messages.findIndex((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]"));
  assert.equal(summaryIdx1, loop.messages.length - 1);
  assert.equal(loop.messages.filter((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]")).length, 1);

  for (let i = 12; i < 24; i++) {
    loop.addMessage({ role: "user", content: `u${i}` });
    loop.addMessage({ role: "assistant", content: `a${i}` });
  }

  await loop._compressMessages();

  assert.equal(loop.messages[0].content, anchor1);
  assert.equal(loop.messages[1].content, anchor2);
  const summaryIdx2 = loop.messages.findIndex((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]"));
  assert.equal(summaryIdx2, loop.messages.length - 1);
  assert.equal(loop.messages.filter((m) => m?.role === "system" && String(m.content || "").startsWith("[Context Summary]")).length, 1);
});

test("Runtime Compression: title-only mode trims old messages aggressively", async () => {
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
  assert.ok(summaryMsg);
  const body = String(summaryMsg.content || "").split("\n").slice(1).join("\n");

  // When title-only is enabled, we should not include words beyond the first 10.
  assert.equal(body.includes("w11"), false);
});

test("Runtime Compression: _scheduleCompression is idempotent and flushCompression resolves", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  const loop = new BaseAgentLoop({
    stageName: "test",
    actor: "test",
    contextConfig: { contextWindow: 800, compressThreshold: 0.9, keepLastTurns: 1, compressCooldownMs: 1000 },
  });

  loop.addMessage({ role: "user", content: "x".repeat(8000) });
  loop.addMessage({ role: "assistant", content: "ok" });
  assert.equal(loop.getContextStatus().needsCompression, true);
  assert.equal(loop.getContextStatus().compressionPending, true);

  const p1 = loop._compressionPromise;
  assert.ok(p1);
  loop._scheduleCompression();
  assert.equal(loop._compressionPromise, p1);

  await loop.flushCompression();
  assert.equal(loop.getContextStatus().compressionPending, false);
  assert.equal(loop.getContextStatus().needsCompression, false);
});

test("AgentOrchestrator: stage timeout timer is cleaned up on success", async () => {
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
  assert.equal(stageAborted, false);
  assert.equal(scheduled.length, 1);
  assert.equal(cleared.has(scheduled[0]), true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("PromptLoader: LRU cache evicts oldest prompts", async () => {
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
    assert.equal(cached.length, 2);
    assert.equal(cached.includes("deepsearch/system"), true);
    assert.equal(cached.includes("design/batch-generator-system"), true);
    assert.equal(cached.includes("codesearch/system"), false);
  } finally {
    configurePromptCache({ maxEntries: original.maxEntries });
    clearPromptCache();
  }
});

test("PromptLoader: browser manifest resolves prompt URLs (best-effort)", async () => {
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
    assert.equal(first, "# system");

    // Second call should reuse the cached manifest (no second manifest fetch).
    const second = await loadPrompt("deepsearch/system", { cache: false, manifestUrl });
    assert.equal(second, "# system");

    assert.equal(manifestFetches, 1);
    assert.equal(promptFetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.process = originalProcess;
    clearPromptCache();
  }
});

test("ConfigLoader: loadAgentConfig loads .agent/agent.md in Node", async () => {
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
    assert.equal(cfg._loaded, true);
    assert.equal(cfg._path, path.join(tmp, ".agent", "agent.md"));
    assert.equal(cfg.instructions, "Hello");
    assert.deepEqual(cfg.skills, ["search-docs", "write-report"]);
    assert.equal(cfg.model, "gpt-4");
    assert.deepEqual(cfg.hooks, ["./hooks/audit.js"]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("ConfigLoader: loadAgentConfig degrades gracefully without Node APIs", async () => {
  const { loadAgentConfig } = await import("../../js/agents/sdk/config-loader.js");

  const originalProcess = globalThis.process;
  try {
    globalThis.process = undefined;
    const cfg = await loadAgentConfig("/repo-root/");
    assert.equal(cfg._loaded, false);
    assert.equal(cfg.instructions, "");
    assert.equal(cfg._path, "/repo-root/.agent/agent.md");
  } finally {
    globalThis.process = originalProcess;
  }
});

test("BaseAgentLoop: strict loopStatus transitions reject illegal jumps", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const { AgentStatus } = await import("../../js/agents/runtime/core/agent-status.js");

  const strictLoop = new BaseAgentLoop({ actor: "test", stageName: "test", strictLoopStatus: true });
  strictLoop.initLoopStatus({ status: AgentStatus.IDLE });
  strictLoop._transitionLoopStatus(AgentStatus.RUNNING, { runId: "run_test" });
  strictLoop._transitionLoopStatus(AgentStatus.COMPLETED, { runId: "run_test" });

  assert.throws(
    () => strictLoop._transitionLoopStatus(AgentStatus.RUNNING, { runId: "run_test" }),
    /loopStatus transition rejected/
  );

  // Explicit reset is allowed even in strict mode.
  strictLoop._transitionLoopStatus(AgentStatus.IDLE, { runId: "run_test", allowReset: true });
  assert.equal(strictLoop.loopStatus, AgentStatus.IDLE);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const warnOnlyLoop = new BaseAgentLoop({ actor: "test", stageName: "test", strictLoopStatus: false });
    warnOnlyLoop.initLoopStatus({ status: AgentStatus.COMPLETED });
    warnOnlyLoop._transitionLoopStatus(AgentStatus.RUNNING, { runId: "run_test" });
    assert.equal(warnOnlyLoop.loopStatus, AgentStatus.RUNNING);
  } finally {
    console.warn = originalWarn;
  }
});

test("PlanStore: lifecycle transitions enforce draft→approved→in_progress", async () => {
  const {
    PlanLifecycleStatus,
    createPlan,
    canTransitionPlanLifecycle,
    setPlanLifecycleStatus,
  } = await import("../../js/agents/runtime/plan/plan-store.js");

  const plan = createPlan({ runId: "run_test", title: "T", steps: [] });
  assert.equal(plan.lifecycleStatus, PlanLifecycleStatus.DRAFT);

  assert.equal(canTransitionPlanLifecycle(PlanLifecycleStatus.DRAFT, PlanLifecycleStatus.IN_PROGRESS), false);

  const approved = setPlanLifecycleStatus(plan, PlanLifecycleStatus.APPROVED);
  assert.equal(approved.lifecycleStatus, PlanLifecycleStatus.APPROVED);

  const inProgress = setPlanLifecycleStatus(approved, PlanLifecycleStatus.IN_PROGRESS);
  assert.equal(inProgress.lifecycleStatus, PlanLifecycleStatus.IN_PROGRESS);

  const completed = setPlanLifecycleStatus(inProgress, PlanLifecycleStatus.COMPLETED);
  assert.equal(completed.lifecycleStatus, PlanLifecycleStatus.COMPLETED);

  assert.throws(
    () => setPlanLifecycleStatus(completed, PlanLifecycleStatus.IN_PROGRESS),
    /invalid transition/
  );

  const forced = setPlanLifecycleStatus(completed, PlanLifecycleStatus.IN_PROGRESS, { force: true });
  assert.equal(forced.lifecycleStatus, PlanLifecycleStatus.IN_PROGRESS);
});

test("PolicyEngine: domain suffix + all/any/not + timeRange matching", async () => {
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
  assert.equal(denyGithub.allowed, false);
  assert.equal(denyGithub.requiresApproval, false);
  assert.equal(denyGithub.effect, "deny");
  assert.equal(denyGithub.ruleId, "deny_github");

  const denyOffHours = engine.evaluate({
    type: "tool.call",
    tool: "http.get",
    resource: "https://example.com",
    ts: "2025-01-01T00:05:00Z",
  });
  assert.equal(denyOffHours.allowed, false);
  assert.equal(denyOffHours.requiresApproval, false);
  assert.equal(denyOffHours.ruleId, "deny_off_hours");

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
  assert.equal(invalidTimeDoesNotMatch.allowed, false);
  assert.equal(invalidTimeDoesNotMatch.requiresApproval, true);
  assert.equal(invalidTimeDoesNotMatch.reason, "no_matching_rule");

  const allowDocs = engine.evaluate({
    type: "vfs.write",
    tool: "vfs.writeText",
    resource: "docs/readme.md",
  });
  assert.equal(allowDocs.allowed, true);
  assert.equal(allowDocs.requiresApproval, false);
  assert.equal(allowDocs.effect, "allow");
  assert.equal(allowDocs.ruleId, "allow_docs_path");

  const secretsRequireApproval = engine.evaluate({
    type: "vfs.write",
    tool: "vfs.writeText",
    resource: "secrets/token.txt",
  });
  assert.equal(secretsRequireApproval.allowed, false);
  assert.equal(secretsRequireApproval.requiresApproval, true);
  assert.equal(secretsRequireApproval.reason, "no_matching_rule");
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

test("RuntimeScheduler: health status transitions (failures + latency)", async () => {
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
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.HEALTHY);

  await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.HEALTHY);
  assert.equal(scheduler.getHealthMetrics("js").averageLatencyMs, 10);

  mode = "slow_ok";
  await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.DEGRADED);
  assert.equal(scheduler.getHealthMetrics("js").averageLatencyMs, 60);

  mode = "fast_ok";
  await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.HEALTHY);

  mode = "fail_1";
  await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.DEGRADED);

  mode = "fail_2";
  const out = await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(out.success, false);
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.UNHEALTHY);
  assert.equal(scheduler.getHealthMetrics("js").isolated, true);
});

test("RuntimeScheduler: isolation blocks dispatch and recoveryCheck restores runtime", async () => {
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
  assert.equal(first.success, false);
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.UNHEALTHY);
  assert.equal(scheduler.getHealthMetrics("js").isolated, true);

  const beforeCalls = executeCalls;
  const blocked = await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(blocked.success, false);
  assert.match(blocked.error, /isolated/i);
  assert.equal(executeCalls, beforeCalls);
  assert.equal(scheduler.getHealthMetrics("js").blockedCount, 1);

  shouldFail = false;
  const recovered = await scheduler.recoveryCheck();
  assert.equal(recovered.js.ok, true);
  assert.equal(scheduler.getHealthMetrics("js").isolated, false);
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.DEGRADED);

  const after = await scheduler.dispatch("js", "return 1;", {}, {});
  assert.equal(after.success, true);
  assert.equal(scheduler.getHealthStatus("js"), RuntimeHealthStatus.HEALTHY);
});
