const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModules() {
  const { AutoPausePolicy } = await import("../../../js/agents/runtime/auto-pause-policy.js");
  return { AutoPausePolicy };
}

test("AutoPausePolicy.createTimeoutChecker detects timeout", async () => {
  const { AutoPausePolicy } = await loadModules();

  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;

  try {
    const isTimedOut = AutoPausePolicy.createTimeoutChecker(50);

    assert.equal(isTimedOut(), false);

    now = 1049;
    assert.equal(isTimedOut(), false);

    now = 1051;
    assert.equal(isTimedOut(), true);
  } finally {
    Date.now = originalNow;
  }
});

test("AutoPausePolicy.createSignalHandler triggers callback and can unsubscribe", async () => {
  const { AutoPausePolicy } = await loadModules();

  const calls = [];
  const cleanup = AutoPausePolicy.createSignalHandler((reason) => calls.push(reason));

  try {
    process.emit("SIGINT");
    process.emit("SIGTERM");

    assert.deepEqual(calls, ["signal_SIGINT", "signal_SIGTERM"]);
  } finally {
    cleanup();
  }

  const prev = calls.length;
  process.emit("SIGINT");
  process.emit("SIGTERM");
  assert.equal(calls.length, prev);
});
