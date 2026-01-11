const test = require("node:test");
const assert = require("node:assert/strict");

async function loadRegistryModule() {
  return await import("../../../js/ppt/workflow/event-handler-registry.js");
}

test("EventHandlerRegistry.register validates handler", async () => {
  const { EventHandlerRegistry } = await loadRegistryModule();
  const registry = new EventHandlerRegistry();

  assert.throws(() => registry.register("run.started", null), {
    name: "TypeError",
    message: "handler must be a function",
  });
});

test("EventHandlerRegistry dispatches exact + wildcard handlers", async () => {
  const { EventHandlerRegistry } = await loadRegistryModule();
  const context = { count: 0 };
  const registry = new EventHandlerRegistry(context);

  let exactCalls = 0;
  let wildcardCalls = 0;

  const exactHandler = function (eventName, payload, ctx) {
    assert.equal(this, context);
    assert.equal(ctx, context);
    assert.equal(eventName, "run.started");
    exactCalls += 1;
    ctx.count += payload.delta;
  };

  const wildcardHandler = function (eventName, payload, ctx) {
    wildcardCalls += 1;
    assert.equal(this, context);
    assert.equal(ctx, context);
    assert.equal(eventName, "run.started");
    assert.equal(payload.delta, 3);
  };

  registry.register("run.started", exactHandler);
  registry.register("run.*", wildcardHandler);
  registry.register("design.v1.*", () => {
    wildcardCalls += 1;
  });

  assert.equal(registry.dispatch("run.started", { delta: 3 }), true);
  assert.equal(context.count, 3);
  assert.equal(exactCalls, 1);
  assert.equal(wildcardCalls, 1);

  assert.equal(registry.dispatch("designXv1.test", {}), false);
  assert.equal(registry.dispatch("design.v1.test", {}), true);
  assert.equal(wildcardCalls, 2);
});

test("EventHandlerRegistry catches handler errors", async () => {
  const { EventHandlerRegistry } = await loadRegistryModule();
  const registry = new EventHandlerRegistry();
  let okCalls = 0;

  const okHandler = () => {
    okCalls += 1;
  };

  const boomHandler = () => {
    throw new Error("boom");
  };

  const originalError = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args);
  };

  try {
    registry.register("task.done", boomHandler);
    registry.register("task.done", okHandler);
    registry.register("task.*", boomHandler);

    assert.equal(registry.dispatch("task.done", { id: 1 }), true);
  } finally {
    console.error = originalError;
  }

  assert.equal(okCalls, 1);
  assert.ok(errors.length >= 2);
});

test("EventHandlerRegistry unregisters handlers and clears", async () => {
  const { EventHandlerRegistry } = await loadRegistryModule();
  const registry = new EventHandlerRegistry();
  const handlerA = () => {};
  const handlerB = () => {};

  registry.register("alpha", handlerA);
  registry.register("alpha", handlerB);
  registry.unregister("alpha", handlerA);
  assert.equal(registry.handlers.get("alpha").length, 1);
  registry.unregister("alpha");
  assert.equal(registry.handlers.has("alpha"), false);

  registry.register("beta.*", handlerA);
  registry.register("beta.*", handlerB);
  registry.unregister("beta.*", handlerA);
  assert.equal(registry.wildcardHandlers.length, 1);
  registry.unregister("beta.*");
  assert.equal(registry.wildcardHandlers.length, 0);

  registry.register("gamma", handlerA);
  registry.register("delta.*", handlerB);
  registry.clear();
  assert.equal(registry.handlers.size, 0);
  assert.equal(registry.wildcardHandlers.length, 0);
});

test("createWorkflowEventRegistry wires predefined handlers", async () => {
  const { createWorkflowEventRegistry } = await loadRegistryModule();
  const updates = [];
  const logs = [];
  const phaseChanges = [];
  const errors = [];
  let runCompleted = null;
  let runFailed = null;

  const context = {
    updateTodos: (todos) => updates.push(todos),
    onRunCompleted: (payload) => {
      runCompleted = payload;
    },
    onRunFailed: (payload) => {
      runFailed = payload;
    },
    onDesignPhaseChange: (from, to) => phaseChanges.push([from, to]),
    logTerminal: (...args) => logs.push(args),
    onError: (eventName, error) => errors.push({ eventName, error }),
  };

  const registry = createWorkflowEventRegistry(context);

  registry.dispatch("run.started", { todos: ["t1"] });
  registry.dispatch("run.completed", { ok: true });
  registry.dispatch("run.failed", { error: "fail" });
  registry.dispatch("deepsearch.scan.started", { status: "started" });
  registry.dispatch("deepsearch.scan.completed", { status: "completed" });
  registry.dispatch("deepsearch.scan.warn", { status: "warn", message: "careful" });
  registry.dispatch("design.phase.transition", { from: "draft", to: "final" });
  registry.dispatch("design.degraded", { slideNo: 4 });
  registry.dispatch("design.error", { message: "oops" });

  assert.deepEqual(updates, [["t1"]]);
  assert.deepEqual(runCompleted, { ok: true });
  assert.deepEqual(runFailed, { error: "fail" });
  assert.deepEqual(phaseChanges, [["draft", "final"]]);

  assert.ok(logs.some((entry) => entry[0] === "system" && entry[1].includes("[DeepSearch] scan started")));
  assert.ok(logs.some((entry) => entry[0] === "system" && entry[1].includes("[DeepSearch] scan completed")));
  assert.ok(logs.some((entry) => entry[0] === "warning" && entry[1].includes("[DeepSearch] scan: careful")));
  assert.ok(logs.some((entry) => entry[0] === "warning" && entry[1].includes("[Design] Slide degraded: 4")));
  assert.ok(logs.some((entry) => entry[0] === "error" && entry[1].includes("[Error] run.failed: fail")));
  assert.ok(logs.some((entry) => entry[0] === "error" && entry[1].includes("[Error] design.error: oops")));

  assert.deepEqual(errors, [
    { eventName: "run.failed", error: "fail" },
    { eventName: "design.error", error: "oops" },
  ]);
});
