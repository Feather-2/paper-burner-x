const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");

test("GlobalConcurrencyLimiter: enforces type limit", async () => {
  const { GlobalConcurrencyLimiter, mapConcurrent } = await import("../../../js/agents/shared/concurrency.js");

  const limiter = new GlobalConcurrencyLimiter({ global: 10, fetch: 3 });
  const items = Array.from({ length: 20 }, (_, i) => i);

  let inFlight = 0;
  let maxInFlight = 0;

  await mapConcurrent(
    items,
    async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10);
      inFlight -= 1;
      return 1;
    },
    20,
    { limiter, limiterType: "fetch" }
  );

  assert.ok(maxInFlight <= 3, `expected max in-flight <= 3, got ${maxInFlight}`);
});

test("GlobalConcurrencyLimiter: global + type dual limits", async () => {
  const { GlobalConcurrencyLimiter, mapConcurrent } = await import("../../../js/agents/shared/concurrency.js");

  const limiter = new GlobalConcurrencyLimiter({ global: 2, model: 5 });
  const items = Array.from({ length: 12 }, (_, i) => i);

  let inFlight = 0;
  let maxInFlight = 0;

  await mapConcurrent(
    items,
    async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(10);
      inFlight -= 1;
      return 1;
    },
    12,
    { limiter, limiterType: "model" }
  );

  assert.ok(maxInFlight <= 2, `expected global limit 2 to apply, got ${maxInFlight}`);
});

test("mapConcurrent: supports signal abort", async () => {
  const { mapConcurrent } = await import("../../../js/agents/shared/concurrency.js");

  const ac = new AbortController();
  const items = Array.from({ length: 20 }, (_, i) => i);

  const p = mapConcurrent(
    items,
    async () => {
      await delay(20);
      return 1;
    },
    3,
    { signal: ac.signal }
  );

  await delay(5);
  ac.abort();

  await assert.rejects(p, /Aborted/);
});

test("GlobalConcurrencyLimiter: release wakes queued waiters", async () => {
  const { GlobalConcurrencyLimiter } = await import("../../../js/agents/shared/concurrency.js");

  const limiter = new GlobalConcurrencyLimiter({ global: 1, model: 1, fetch: 1 });
  const events = [];

  const releaseFetch = await limiter.acquire("fetch");
  events.push("fetch_acquired");

  const p = limiter.acquire("model").then((releaseModel) => {
    events.push("model_acquired");
    releaseModel();
  });

  await delay(15);
  assert.deepEqual(events, ["fetch_acquired"]);

  releaseFetch();
  await p;

  assert.deepEqual(events, ["fetch_acquired", "model_acquired"]);
});

