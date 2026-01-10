import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Kernel } from "../../../js/agents/core/kernel.js";

describe("Kernel (compat)", () => {
  it("registers and resolves services via container", async () => {
    const kernel = new Kernel();

    let callCount = 0;
    kernel.container.register("counter", () => {
      callCount++;
      return { value: callCount };
    });

    const first = await kernel.container.get("counter");
    const second = await kernel.container.get("counter");

    assert.equal(callCount, 1);
    assert.equal(first, second);

    kernel.container.register("kernel", kernel);
    kernel.container.register("eventBus", kernel.eventBus);

    assert.equal(await kernel.container.get("kernel"), kernel);
    assert.equal(await kernel.container.get("eventBus"), kernel.eventBus);
  });

  it("emit/on forwards payload", async () => {
    const kernel = new Kernel();

    await new Promise((resolve) => {
      const off = kernel.on("demo.event", (evt) => {
        assert.equal(evt.name, "demo.event");
        assert.deepEqual(evt.payload, { ok: true });
        off();
        resolve();
      });
      kernel.emit("demo.event", { ok: true });
    });
  });

  it("schedule executes function tasks", async () => {
    const kernel = new Kernel();
    const res = await kernel.schedule(() => 123);
    assert.equal(res, 123);
  });

  it("schedule delegates to scheduler.schedule for dispatch tasks", async () => {
    const seen = { calls: 0, args: null };
    const scheduler = {
      schedule: async (...args) => {
        seen.calls++;
        seen.args = args;
        return { success: true, data: "ok" };
      },
    };

    const kernel = new Kernel();
    kernel.register("scheduler", scheduler);
    const out = await kernel.schedule(
      { runtimeType: "js", code: "return 1;", inputState: { a: 1 }, options: { dependencies: { x: 1 } } },
      7
    );

    assert.equal(out.success, true);
    assert.equal(seen.calls, 1);
    assert.deepEqual(seen.args, [
      { runtimeType: "js", code: "return 1;", inputState: { a: 1 }, options: { dependencies: { x: 1 } } },
      7,
    ]);
  });

  it("start/stop calls provider lifecycle hooks", async () => {
    const calls = [];
    const provider = {
      async register(k) {
        calls.push("register");
        k.register("answer", 42);
      },
      async start() {
        calls.push("start");
      },
      async stop() {
        calls.push("stop");
      },
    };

    const kernel = new Kernel();
    await kernel.use(provider);
    await kernel.start();
    await kernel.start(); // idempotent
    assert.deepEqual(calls, ["register", "start"]);
    assert.equal(await kernel.container.get("answer"), 42);

    await kernel.stop();
    assert.deepEqual(calls, ["register", "start", "stop"]);
  });
});
