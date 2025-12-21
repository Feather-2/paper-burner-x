const test = require("node:test");
const assert = require("node:assert/strict");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("AsyncCompressor: constructor validates cicada + default layers", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  assert.throws(() => new AsyncCompressor(), /cicada\.compress\(\) is required/);
  assert.throws(() => new AsyncCompressor({ cicada: {} }), /cicada\.compress\(\) is required/);

  const compressor = new AsyncCompressor({ cicada: { compress: async () => ({ context: {} }) } });
  assert.deepEqual(compressor.layers, ["tool_output"]);
});

test("AsyncCompressor.schedule: returns immediately (does not start compress synchronously)", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  let started = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const cicada = {
    compress: async () => {
      started = true;
      await gate;
      return { context: { compressed: true } };
    },
  };

  const compressor = new AsyncCompressor({ cicada });
  compressor.schedule("scan", { ok: true });

  assert.equal(started, false);

  await Promise.resolve();
  assert.equal(started, true);
  assert.equal(compressor.hasPending(), true);
  assert.deepEqual(compressor.getStatus().pending, ["scan"]);

  release();
  await compressor.flush();
  assert.equal(compressor.hasPending(), false);
});

test("AsyncCompressor: schedules multiple stages concurrently", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const cicada = {
    compress: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return { context: { compressed: true } };
    },
  };

  const compressor = new AsyncCompressor({ cicada, layers: [" tool_output ", null] });
  compressor.schedule("a", { id: "a" });
  compressor.schedule("b", { id: "b" });

  await Promise.resolve();
  assert.deepEqual(compressor.getStatus().pending, ["a", "b"]);
  assert.equal(maxActive, 2);

  release();
  const out = await compressor.flush();
  assert.deepEqual(out.completed, ["a", "b"]);
  assert.deepEqual(out.pending, []);
  assert.deepEqual(out.failed, []);
});

test("AsyncCompressor.applyReady: hot-swaps only ready results and returns same context", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const cicada = {
    compress: async (ctx) => {
      if (ctx.hold) await gate;
      return { context: { ...ctx, compressed: true } };
    },
  };

  const compressor = new AsyncCompressor({ cicada });
  compressor.schedule("fast", { id: "fast" });
  compressor.schedule("slow", { id: "slow", hold: true });

  const context = {
    stageResults: {
      fast: { id: "fast" },
      slow: { id: "slow" },
    },
  };

  await immediate();
  assert.equal(compressor.hasPending(), true);

  const returned = compressor.applyReady(context);
  assert.strictEqual(returned, context);
  assert.deepEqual(context.stageResults.fast, { id: "fast", compressed: true });
  assert.deepEqual(context.stageResults.slow, { id: "slow" });

  release();
  await compressor.flush();
  compressor.applyReady(context);

  assert.deepEqual(context.stageResults.slow, { id: "slow", hold: true, compressed: true });
});

test("AsyncCompressor.flush: waits for all tasks and reports failures (isolated)", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  const cicada = {
    compress: async (ctx) => {
      if (ctx.fail) throw new Error(`boom:${ctx.id}`);
      return { context: { ...ctx, compressed: true } };
    },
  };

  const compressor = new AsyncCompressor({ cicada });
  compressor.schedule("ok", { id: "ok" });
  compressor.schedule("bad", { id: "bad", fail: true });

  const statusBefore = compressor.getStatus();
  assert.deepEqual(statusBefore.failed, []);
  assert.deepEqual(statusBefore.ready, []);
  assert.deepEqual(statusBefore.pending.sort(), ["bad", "ok"]);

  const summary = await compressor.flush();
  assert.deepEqual(summary.completed, ["ok"]);
  assert.deepEqual(summary.pending, []);
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.failed[0].stageId, "bad");
  assert.match(String(summary.failed[0].error?.message || ""), /boom:bad/);

  const context = { stageResults: { ok: { id: "ok" }, bad: { id: "bad" } } };
  compressor.applyReady(context);
  assert.deepEqual(context.stageResults.ok, { id: "ok", compressed: true });
  assert.deepEqual(context.stageResults.bad, { id: "bad" });
  assert.deepEqual(compressor.getStatus().failed, ["bad"]);
});

test("AsyncCompressor: applyReady supports Map stageResults and ignores invalid contexts", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  const cicada = {
    compress: async () => "raw",
  };

  const compressor = new AsyncCompressor({ cicada });
  assert.equal(compressor.applyReady(null), null);

  const ctxWithout = { ok: true };
  assert.strictEqual(compressor.applyReady(ctxWithout), ctxWithout);

  const context = { stageResults: new Map([[("stage"), "before"]]) };
  compressor.schedule("stage", { id: "stage" });
  await compressor.flush();
  compressor.applyReady(context);
  assert.equal(context.stageResults.get("stage"), "raw");
});

test("AsyncCompressor.schedule: rescheduling same stage ignores stale completions", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const cicada = {
    compress: async (ctx) => {
      if (ctx.value === 1) await gate;
      return { context: { value: ctx.value, compressed: true } };
    },
  };

  const compressor = new AsyncCompressor({ cicada });
  compressor.schedule("stage", { value: 1 });
  compressor.schedule("stage", { value: 2 });

  await immediate();
  assert.deepEqual(compressor.ready.get("stage"), { value: 2, compressed: true });
  assert.deepEqual(compressor.getStatus().pending, ["stage"]);

  release();
  await compressor.flush();
  assert.deepEqual(compressor.ready.get("stage"), { value: 2, compressed: true });
});

test("AsyncCompressor.schedule: validates stageId", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  const compressor = new AsyncCompressor({ cicada: { compress: async () => ({ context: {} }) } });
  assert.throws(() => compressor.schedule("", {}), /stageId must be a non-empty string/);
  assert.throws(() => compressor.schedule("   ", {}), /stageId must be a non-empty string/);
  assert.throws(() => compressor.schedule(null, {}), /stageId must be a non-empty string/);
});

test("AsyncCompressor.flush: resolves even when no tasks are pending", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  const compressor = new AsyncCompressor({ cicada: { compress: async () => ({ context: {} }) } });
  const summary = await compressor.flush();
  assert.deepEqual(summary, { completed: [], pending: [], failed: [] });
});

test("AsyncCompressor.flush: blocks until pending tasks finish", async () => {
  const { AsyncCompressor } = await import("../../../js/agents/runtime/async-compressor.js");

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const compressor = new AsyncCompressor({
    cicada: {
      compress: async () => {
        await gate;
        return { context: { compressed: true } };
      },
    },
  });

  compressor.schedule("x", { id: "x" });
  await Promise.resolve();

  let resolved = false;
  const p = compressor.flush().then(() => {
    resolved = true;
  });

  await delay(20);
  assert.equal(resolved, false);

  release();
  await p;
  assert.equal(resolved, true);
});

