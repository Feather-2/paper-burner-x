const test = require("node:test");
const assert = require("node:assert/strict");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

class MemoryStorageAdapter {
  constructor() {
    this.map = new Map();
  }
  async set(key, value) {
    this.map.set(key, value);
  }
  async get(key) {
    return this.map.get(key);
  }
}

test("TaskManager: lifecycle (create → running → completed) + persistence", async () => {
  const { TaskManager, TaskStatus } = await import("../../../js/agents/core/task-manager.js");
  const { RunStore } = await import("../../../js/agents/storage/run-store.js");

  const storage = new MemoryStorageAdapter();
  const runStore = new RunStore({ storageAdapter: storage });
  const tm = new TaskManager({ runStore });

  const task = tm.create({ runId: "run_test_1", type: "deepsearch", metadata: { a: 1 } });
  assert.equal(task.taskId, "run_test_1");
  assert.equal(task.status, TaskStatus.PENDING);
  assert.deepEqual(task.progress, { iteration: 0, gapCount: 0, claimCount: 0 });
  assert.deepEqual(task.metadata, { a: 1 });

  await tick();
  const raw0 = await storage.get("deepsearch:run:run_test_1");
  assert.ok(typeof raw0 === "string" && raw0.includes('"taskId":"run_test_1"'));

  tm.updateProgress("run_test_1", { iteration: 1, gapCount: 2, claimCount: 3 });
  const running = tm.get("run_test_1");
  assert.equal(running.status, TaskStatus.RUNNING);
  assert.deepEqual(running.progress, { iteration: 1, gapCount: 2, claimCount: 3 });
  assert.ok(typeof running.updatedAt === "string" && running.updatedAt.includes("T"));

  tm.complete("run_test_1", { ok: true });
  const completed = tm.get("run_test_1");
  assert.equal(completed.status, TaskStatus.COMPLETED);
  assert.deepEqual(completed.result, { ok: true });
  assert.ok(typeof completed.completedAt === "string" && completed.completedAt.includes("T"));

  await tick();
  const raw1 = await storage.get("deepsearch:run:run_test_1");
  const saved = JSON.parse(raw1);
  assert.equal(saved.status, TaskStatus.COMPLETED);
  assert.equal(saved.progress.iteration, 1);
  assert.deepEqual(saved.result, { ok: true });
});

test("TaskManager: failed + cancelled states + safe no-ops", async () => {
  const { TaskManager, TaskStatus } = await import("../../../js/agents/core/task-manager.js");
  const { RunStore } = await import("../../../js/agents/storage/run-store.js");

  const storage = new MemoryStorageAdapter();
  const runStore = new RunStore({ storageAdapter: storage });
  const tm = new TaskManager({ runStore });

  assert.equal(tm.updateProgress("missing", { iteration: 1 }), undefined);
  assert.equal(tm.complete("missing", {}), undefined);
  assert.equal(tm.fail("missing", new Error("x")), undefined);
  assert.equal(tm.cancel("missing", "x"), undefined);
  assert.equal(await tm.load("missing"), null);

  tm.create({ runId: "run_test_2" });
  tm.updateProgress("run_test_2", { iteration: 2 });
  tm.fail("run_test_2", new Error("boom"));
  const failed = tm.get("run_test_2");
  assert.equal(failed.status, TaskStatus.FAILED);
  assert.ok(failed.error && failed.error.message === "boom");
  assert.ok(typeof failed.completedAt === "string");

  tm.create({ runId: "run_test_3" });
  tm.cancel("run_test_3", "user_cancelled");
  const cancelled = tm.get("run_test_3");
  assert.equal(cancelled.status, TaskStatus.CANCELLED);
  assert.equal(cancelled.error.message, "user_cancelled");
});

test("TaskManager: load() hydrates from persisted task", async () => {
  const { TaskManager, TaskStatus } = await import("../../../js/agents/core/task-manager.js");
  const { RunStore } = await import("../../../js/agents/storage/run-store.js");

  const storage = new MemoryStorageAdapter();
  const runStore = new RunStore({ storageAdapter: storage });

  const tm1 = new TaskManager({ runStore });
  tm1.create({ runId: "run_test_4" });
  tm1.updateProgress("run_test_4", { iteration: 4, gapCount: 5, claimCount: 6 });

  await tick();

  const tm2 = new TaskManager({ runStore });
  const loaded = await tm2.load("run_test_4");
  assert.ok(loaded);
  assert.equal(loaded.status, TaskStatus.RUNNING);
  assert.deepEqual(loaded.progress, { iteration: 4, gapCount: 5, claimCount: 6 });
  assert.equal(tm2.list().length, 1);
});

