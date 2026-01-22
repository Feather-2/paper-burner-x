import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventHandlerRegistry, createWorkflowEventRegistry } from '../../../js/ppt/workflow/event-handler-registry.js';

test("EventHandlerRegistry.register validates handler", async () => {
  const registry = new EventHandlerRegistry();

  expect(() => registry.register("run.started", null)).toThrow("handler must be a function");
});

test("EventHandlerRegistry dispatches exact + wildcard handlers", async () => {
  const context = { count: 0 };
  const registry = new EventHandlerRegistry(context);

  let exactCalls = 0;
  let wildcardCalls = 0;

  const exactHandler = function (eventName, payload, ctx) {
    expect(this).toBe(context);
    expect(ctx).toBe(context);
    expect(eventName).toBe("run.started");
    exactCalls += 1;
    ctx.count += payload.delta;
  };

  const wildcardHandler = function (eventName, payload, ctx) {
    wildcardCalls += 1;
    expect(this).toBe(context);
    expect(ctx).toBe(context);
    expect(eventName).toBe("run.started");
    expect(payload.delta).toBe(3);
  };

  registry.register("run.started", exactHandler);
  registry.register("run.*", wildcardHandler);
  registry.register("design.v1.*", () => {
    wildcardCalls += 1;
  });

  expect(registry.dispatch("run.started", { delta: 3 })).toBe(true);
  expect(context.count).toBe(3);
  expect(exactCalls).toBe(1);
  expect(wildcardCalls).toBe(1);

  expect(registry.dispatch("designXv1.test", {})).toBe(false);
  expect(registry.dispatch("design.v1.test", {})).toBe(true);
  expect(wildcardCalls).toBe(2);
});

test("EventHandlerRegistry catches handler errors", async () => {
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

    expect(registry.dispatch("task.done", { id: 1 })).toBe(true);
  } finally {
    console.error = originalError;
  }

  expect(okCalls).toBe(1);
  expect(errors.length >= 2).toBeTruthy();
});

test("EventHandlerRegistry unregisters handlers and clears", async () => {
  const registry = new EventHandlerRegistry();
  const handlerA = () => {};
  const handlerB = () => {};

  registry.register("alpha", handlerA);
  registry.register("alpha", handlerB);
  registry.unregister("alpha", handlerA);
  expect(registry.handlers.get("alpha").length).toBe(1);
  registry.unregister("alpha");
  expect(registry.handlers.has("alpha")).toBe(false);

  registry.register("beta.*", handlerA);
  registry.register("beta.*", handlerB);
  registry.unregister("beta.*", handlerA);
  expect(registry.wildcardHandlers.length).toBe(1);
  registry.unregister("beta.*");
  expect(registry.wildcardHandlers.length).toBe(0);

  registry.register("gamma", handlerA);
  registry.register("delta.*", handlerB);
  registry.clear();
  expect(registry.handlers.size).toBe(0);
  expect(registry.wildcardHandlers.length).toBe(0);
});

test("createWorkflowEventRegistry wires predefined handlers", async () => {
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

  expect(updates).toEqual([["t1"]]);
  expect(runCompleted).toEqual({ ok: true });
  expect(runFailed).toEqual({ error: "fail" });
  expect(phaseChanges).toEqual([["draft", "final"]]);

  expect(logs.some((entry) => entry[0] === "system" && entry[1].includes("[DeepSearch] scan started"))).toBeTruthy();
  expect(logs.some((entry) => entry[0] === "system" && entry[1].includes("[DeepSearch] scan completed"))).toBeTruthy();
  expect(logs.some((entry) => entry[0] === "warning" && entry[1].includes("[DeepSearch] scan: careful"))).toBeTruthy();
  expect(logs.some((entry) => entry[0] === "warning" && entry[1].includes("[Design] Slide degraded: 4"))).toBeTruthy();
  expect(logs.some((entry) => entry[0] === "error" && entry[1].includes("[Error] run.failed: fail"))).toBeTruthy();
  expect(logs.some((entry) => entry[0] === "error" && entry[1].includes("[Error] design.error: oops"))).toBeTruthy();

  expect(errors).toEqual([
    { eventName: "run.failed", error: "fail" },
    { eventName: "design.error", error: "oops" },
  ]);
});
