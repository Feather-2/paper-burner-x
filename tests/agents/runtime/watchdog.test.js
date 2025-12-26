const test = require("node:test");
const assert = require("node:assert/strict");

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
  };
}

function makeCompressor(summary, archiveId = "arch_1") {
  const calls = [];
  return {
    calls,
    compress: async (stageKey, processMemory, options) => {
      calls.push({ stageKey, processMemory, options });
      return { summary, archiveId, keyIndex: { ids: [], keywords: [], paths: [] } };
    },
  };
}

function makeAgentLoop({ processMemory, result, withAddToContext = true } = {}) {
  const loop = {
    forkCalls: [],
    contextEntries: [],
    sharedContext: { id: "ctx_1" },
    fork: (options) => {
      loop.forkCalls.push(options);
      return {
        execute: async (task, execOptions) => result || { ok: true, task, execOptions },
        getProcessMemory: async () => processMemory || { content: { step: "work" }, contentType: "tool_output" },
      };
    },
  };
  if (withAddToContext) {
    loop.addToContext = (entry) => loop.contextEntries.push(entry);
  }
  return loop;
}

test("Watchdog.decideDelegationMode applies rules and emits events", async () => {
  const { Watchdog, DelegationMode, DelegationReason } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const { WatchdogEvents } = await import("../../../js/agents/runtime/events/events.js");
  const bus = makeEventBus();
  const watchdog = new Watchdog({ eventBus: bus, cicadaCompressor: makeCompressor("noop") });

  // 默认复杂任务 → watchdog
  let decision = watchdog.decideDelegationMode({}, {});
  assert.equal(decision.mode, DelegationMode.WATCHDOG);
  assert.equal(decision.reason, DelegationReason.COMPLEX_DEFAULT);

  decision = watchdog.decideDelegationMode({ requiresHistory: true }, {});
  assert.equal(decision.reason, DelegationReason.CONTEXT_DEPENDENT);

  decision = watchdog.decideDelegationMode({ parallelizable: true, independent: true }, {});
  assert.equal(decision.mode, DelegationMode.SUBAGENT);
  assert.equal(decision.reason, DelegationReason.PARALLEL_INDEPENDENT);
  assert.equal(decision.parallel, true);

  decision = watchdog.decideDelegationMode({ toolType: "mcp" }, {});
  assert.equal(decision.reason, DelegationReason.EXTERNAL_TOOL);

  decision = watchdog.decideDelegationMode({ complexity: "simple", inputSchema: { type: "object" } }, {});
  assert.equal(decision.reason, DelegationReason.SIMPLE_TASK);

  decision = watchdog.decideDelegationMode({ complexity: "complex" }, {});
  assert.equal(decision.reason, DelegationReason.COMPLEX_DEFAULT);

  const names = bus.events.map((evt) => evt.name);
  assert.equal(names.length, 6);
  assert.ok(names.every((name) => name === WatchdogEvents.WATCHDOG_DECISION));
});

test("Watchdog.watchdogDelegate shares context and compresses", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const { WatchdogEvents } = await import("../../../js/agents/runtime/events/events.js");
  const bus = makeEventBus();
  const compressor = makeCompressor({ text: "compressed" }, "arch_2");
  const agentLoop = makeAgentLoop();
  const watchdog = new Watchdog({ eventBus: bus, cicadaCompressor: compressor });

  const result = await watchdog.watchdogDelegate({ stageKey: "scan" }, agentLoop);

  assert.equal(agentLoop.forkCalls.length, 1);
  assert.equal(agentLoop.forkCalls[0].shareContext, true);
  assert.equal(agentLoop.forkCalls[0].trackProcessMemory, true);
  assert.equal(result.result.ok, true);

  assert.equal(compressor.calls.length, 1);
  assert.equal(compressor.calls[0].stageKey, "scan");
  assert.equal(compressor.calls[0].options.sharedContext, agentLoop.sharedContext);

  assert.equal(agentLoop.contextEntries.length, 1);
  assert.equal(agentLoop.contextEntries[0].summary, JSON.stringify({ text: "compressed" }));
  assert.ok(!("result" in agentLoop.contextEntries[0]));
  assert.deepEqual(result.contextDelta, agentLoop.contextEntries[0]);

  const names = bus.events.map((evt) => evt.name);
  assert.ok(names.includes(WatchdogEvents.WATCHDOG_DELEGATED));
  assert.ok(names.includes(WatchdogEvents.WATCHDOG_COMPRESSED));
});

test("Watchdog.watchdogDelegate defaults stage key and keeps string summary", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const compressor = makeCompressor("short summary", "arch_3");
  const agentLoop = makeAgentLoop({ withAddToContext: false });
  const watchdog = new Watchdog({ cicadaCompressor: compressor });

  const result = await watchdog.watchdogDelegate({ taskGoal: "fallback stage" }, agentLoop);

  assert.equal(compressor.calls[0].stageKey, "watchdog");
  assert.equal(result.contextDelta.summary, "short summary");
  assert.equal(agentLoop.contextEntries.length, 0);
});

test("Watchdog.observe and intervene notify handlers", async () => {
  const { Watchdog } = await import("../../../js/agents/runtime/compression/watchdog.js");
  const { WatchdogEvents } = await import("../../../js/agents/runtime/events/events.js");
  const watchdog = new Watchdog({ cicadaCompressor: makeCompressor("noop") });

  let seen = null;
  const off = watchdog.observe(WatchdogEvents.WATCHDOG_INTERVENTION, (payload) => {
    seen = payload;
  });

  const decision = watchdog.intervene({ action: "retry", reason: "test" });
  assert.equal(decision.action, "retry");
  assert.equal(seen.action, "retry");

  off();
  seen = null;
  watchdog.intervene({ action: "skip", reason: "test" });
  assert.equal(seen, null);
});
