const test = require("node:test");
const assert = require("node:assert/strict");

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
  };
}

test("Watchdog.tick tracks iterations", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const watchdog = new Watchdog();

  assert.equal(watchdog._iterationCount, 0);
  watchdog.tick();
  assert.equal(watchdog._iterationCount, 1);
  watchdog.tick();
  assert.equal(watchdog._iterationCount, 2);
});

test("Watchdog.checkHealth detects max iterations exceeded", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const watchdog = new Watchdog();

  for (let i = 0; i < 5; i++) watchdog.tick();

  const result = watchdog.checkHealth({ maxIterations: 3 });
  assert.equal(result.healthy, false);
  assert.ok(result.issues.some((i) => i.type === "max_iterations"));
});

test("Watchdog.observe and intervene notify handlers", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const { WatchdogEvents } = await import("../../../js/agents/runtime/events/events.js");
  const watchdog = new Watchdog();

  let seen = null;
  const off = watchdog.observe(WatchdogEvents.WATCHDOG_INTERVENTION, (payload) => {
    seen = payload;
  });

  // intervene 现在接受 (reason, options) 而非 { action, reason }
  const decision = watchdog.intervene("retry", { context: "test" });
  assert.equal(decision.reason, "retry");
  assert.equal(seen.reason, "retry");

  off();
  seen = null;
  watchdog.intervene("skip", { context: "test" });
  assert.equal(seen, null);
});

test("Watchdog.observe unsubscribe is idempotent (does not remove newly added handlers)", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const { WatchdogEvents } = await import("../../../js/agents/runtime/events/events.js");
  const watchdog = new Watchdog();

  let called1 = 0;
  let called2 = 0;
  const off1 = watchdog.observe(WatchdogEvents.WATCHDOG_INTERVENTION, () => {
    called1 += 1;
  });
  off1();

  const off2 = watchdog.observe(WatchdogEvents.WATCHDOG_INTERVENTION, () => {
    called2 += 1;
  });

  // Calling a stale unsubscribe must not delete the new observer set.
  off1();
  watchdog.intervene("retry");

  assert.equal(called1, 0);
  assert.equal(called2, 1);
  off2();
});

test("Watchdog.reset clears state", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const watchdog = new Watchdog();

  watchdog.tick();
  watchdog.tick();
  assert.equal(watchdog._iterationCount, 2);

  watchdog.reset();
  assert.equal(watchdog._iterationCount, 0);
});

test("Watchdog emits events via eventBus", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const bus = makeEventBus();
  const watchdog = new Watchdog({ eventBus: bus });

  for (let i = 0; i < 10; i++) watchdog.tick();
  watchdog.checkHealth({ maxIterations: 5 });

  assert.ok(bus.events.length > 0);
});
