const test = require("node:test");
const assert = require("node:assert/strict");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mustResolve(promise, { withinMs = 2000, label = "promise" } = {}) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not resolve within ${withinMs}ms`)), withinMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("Semaphore: acquire/release + pending/available", async () => {
  const { Semaphore, mapConcurrentWithPool } = await import("../../../js/agents/shared/concurrency.js");

  const s = new Semaphore(2.9);
  assert.equal(s.max, 2);
  assert.equal(s.available, 2);
  assert.equal(s.pending, 0);

  await s.acquire();
  await s.acquire();
  assert.equal(s.available, 0);

  let thirdAcquired = false;
  const third = (async () => {
    await s.acquire();
    thirdAcquired = true;
    return true;
  })();

  await delay(0);
  assert.equal(s.pending, 1);

  s.release();
  assert.equal(await mustResolve(third, { label: "third acquire" }), true);
  assert.equal(thirdAcquired, true);
  assert.equal(s.pending, 0);
  assert.equal(s.available, 0);

  s.release();
  s.release(); // extra release should not underflow
  assert.equal(s.available, 2);

  // empty list should be supported
  const empty = await mapConcurrentWithPool([], async () => "x", 5, s);
  assert.deepEqual(empty, []);
});

test("llmPool: enforces global concurrency limit", async () => {
  const { llmPool } = await import("../../../js/agents/shared/concurrency.js");

  const total = llmPool.max + 7;
  let active = 0;
  let maxActive = 0;
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let resolveReached;
  const reached = new Promise((resolve) => {
    resolveReached = resolve;
  });
  let reachedOnce = false;

  const tasks = Array.from({ length: total }, async () => {
    await llmPool.acquire();
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (!reachedOnce && active >= llmPool.max) {
      reachedOnce = true;
      resolveReached();
    }
    await gate;
    active -= 1;
    llmPool.release();
  });

  await mustResolve(reached, { label: "reach pool max" });
  assert.equal(maxActive, llmPool.max);
  assert.ok(llmPool.pending > 0);
  releaseGate();
  await Promise.all(tasks);
  assert.equal(llmPool.pending, 0);
  assert.equal(llmPool.available, llmPool.max);
});

test("mapConcurrentWithPool: shares llmPool across concurrent maps", async () => {
  const { llmPool, mapConcurrentWithPool, Semaphore } = await import("../../../js/agents/shared/concurrency.js");

  // custom pool should cap worker count to pool.max
  {
    const pool = new Semaphore(1);
    let active = 0;
    let maxActive = 0;
    const out = await mapConcurrentWithPool(
      [1, 2, 3],
      async (x) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active -= 1;
        return x * 2;
      },
      10,
      pool
    );
    assert.deepEqual(out, [2, 4, 6]);
    assert.equal(maxActive, 1);
  }

  const itemsA = Array.from({ length: llmPool.max }, (_, i) => `a_${i}`);
  const itemsB = Array.from({ length: llmPool.max }, (_, i) => `b_${i}`);

  let active = 0;
  let maxActive = 0;
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let resolveReached;
  const reached = new Promise((resolve) => {
    resolveReached = resolve;
  });
  let reachedOnce = false;

  async function fn(x) {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (!reachedOnce && active >= llmPool.max) {
      reachedOnce = true;
      resolveReached();
    }
    await gate;
    active -= 1;
    return String(x).toUpperCase();
  }

  const pA = mapConcurrentWithPool(itemsA, fn, llmPool.max);
  const pB = mapConcurrentWithPool(itemsB, fn, llmPool.max);

  await mustResolve(reached, { label: "reach pool max (two maps)" });
  assert.equal(maxActive, llmPool.max);
  assert.ok(llmPool.pending > 0);

  releaseGate();
  const [outA, outB] = await Promise.all([pA, pB]);
  assert.deepEqual(outA, itemsA.map((x) => String(x).toUpperCase()));
  assert.deepEqual(outB, itemsB.map((x) => String(x).toUpperCase()));
  assert.equal(llmPool.pending, 0);
  assert.equal(llmPool.available, llmPool.max);
});

