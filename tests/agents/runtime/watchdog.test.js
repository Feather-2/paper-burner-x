import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
  };
}

it("Watchdog.tick tracks iterations", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const watchdog = new Watchdog();

  expect(watchdog._iterationCount).toBe(0);
  watchdog.tick();
  expect(watchdog._iterationCount).toBe(1);
  watchdog.tick();
  expect(watchdog._iterationCount).toBe(2);
});

it("Watchdog.checkHealth detects max iterations exceeded", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const watchdog = new Watchdog();

  for (let i = 0; i < 5; i++) watchdog.tick();

  const result = watchdog.checkHealth({ maxIterations: 3 });
  expect(result.healthy).toBe(false);
  expect(result.issues.some(i => i.type === "max_iterations")).toBeTruthy();
});

it("Watchdog.observe and intervene notify handlers", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const { WatchdogEvents } = await import("../../../js/agents/runtime/events/events.js");
  const watchdog = new Watchdog();

  let seen = null;
  const off = watchdog.observe(WatchdogEvents.WATCHDOG_INTERVENTION, (payload) => {
    seen = payload;
  });

  // intervene 现在接受 (reason, options) 而非 { action, reason }
  const decision = watchdog.intervene("retry", { context: "test" });
  expect(decision.reason).toBe("retry");
  expect(seen.reason).toBe("retry");

  off();
  seen = null;
  watchdog.intervene("skip", { context: "test" });
  expect(seen).toBe(null);
});

it("Watchdog.observe unsubscribe is idempotent (does not remove newly added handlers)", async () => {
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

  expect(called1).toBe(0);
  expect(called2).toBe(1);
  off2();
});

it("Watchdog.reset clears state", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const watchdog = new Watchdog();

  watchdog.tick();
  watchdog.tick();
  expect(watchdog._iterationCount).toBe(2);

  watchdog.reset();
  expect(watchdog._iterationCount).toBe(0);
});

it("Watchdog emits events via eventBus", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const bus = makeEventBus();
  const watchdog = new Watchdog({ eventBus: bus });

  for (let i = 0; i < 10; i++) watchdog.tick();
  watchdog.checkHealth({ maxIterations: 5 });

  expect(bus.events.length > 0).toBeTruthy();
});
