import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MicroKernel } from "../../../js/agents/runtime/kernel/micro-kernel.js";
import { ServiceId } from "../../../js/agents/runtime/di/defaults.js";

describe("MicroKernel", () => {
  it("registers and resolves services via container", () => {
    const kernel = new MicroKernel();

    let callCount = 0;
    kernel.register("counter", () => {
      callCount++;
      return { value: callCount };
    });

    const first = kernel.getService("counter");
    const second = kernel.getService("counter");

    assert.equal(callCount, 1);
    assert.equal(first, second);

    assert.equal(kernel.getService("kernel"), kernel);
    assert.equal(kernel.getService(ServiceId.EVENT_BUS), kernel.eventBus);
  });

  it("emit/on forwards payload", async () => {
    const kernel = new MicroKernel();

    await new Promise((resolve) => {
      const off = kernel.on("demo.event", (payload) => {
        assert.deepEqual(payload, { ok: true });
        off();
        resolve();
      });
      kernel.emit("demo.event", { ok: true });
    });
  });

  it("request resolves response from on handler", async () => {
    const kernel = new MicroKernel();

    kernel.on("rpc.echo", (payload) => {
      return { echo: payload };
    });

    const res = await kernel.request("rpc.echo", { value: 42 }, { timeoutMs: 250 });
    assert.deepEqual(res, { echo: { value: 42 } });
  });

  it("request rejects when handler throws", async () => {
    const kernel = new MicroKernel();

    kernel.on("rpc.fail", () => {
      throw new Error("boom");
    });

    await assert.rejects(
      async () => kernel.request("rpc.fail", { x: 1 }, { timeoutMs: 250 }),
      /boom/
    );
  });

  it("request times out when no handler responds", async () => {
    const kernel = new MicroKernel();
    await assert.rejects(
      async () => kernel.request("rpc.timeout", { x: 1 }, { timeoutMs: 50 }),
      /timeout/i
    );
  });

  it("schedule executes function tasks", async () => {
    const kernel = new MicroKernel();
    const res = await kernel.schedule(() => 123);
    assert.equal(res, 123);
  });

  it("schedule delegates to scheduler.dispatch for dispatch tasks", async () => {
    const seen = { calls: 0, args: null };
    const scheduler = {
      dispatch: async (...args) => {
        seen.calls++;
        seen.args = args;
        return { success: true, data: "ok" };
      },
    };

    const kernel = new MicroKernel({ scheduler });
    const out = await kernel.schedule(
      { runtimeType: "js", code: "return 1;", inputState: { a: 1 }, options: { dependencies: { x: 1 } } },
      7
    );

    assert.equal(out.success, true);
    assert.equal(seen.calls, 1);
    assert.equal(seen.args[0], "js");
    assert.equal(seen.args[1], "return 1;");
    assert.deepEqual(seen.args[2], { a: 1 });
    assert.equal(seen.args[3].priority, 7);
    assert.deepEqual(seen.args[3].dependencies, { x: 1 });
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

    const kernel = new MicroKernel({ providers: [provider] });
    await kernel.start();
    await kernel.start(); // idempotent
    assert.deepEqual(calls, ["register", "start"]);
    assert.equal(kernel.getService("answer"), 42);

    await kernel.stop();
    assert.deepEqual(calls, ["register", "start", "stop"]);
  });
});

