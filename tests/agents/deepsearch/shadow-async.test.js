const test = require("node:test");
const assert = require("node:assert/strict");
const { mock, Mock } = require("node:test");

test("createShadowSubscriber: returns unsubscribe function when disabled", async () => {
  const { createShadowSubscriber } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const handlers = new Map();
  const mockEventBus = {
    subscribe: mock.fn((eventName, handler) => {
      if (!handlers.has(eventName)) handlers.set(eventName, []);
      handlers.get(eventName).push(handler);
      return () => {
        const arr = handlers.get(eventName) || [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    }),
    emit: mock.fn(),
    once: mock.fn(),
  };
  const mockStageApi = { emit: mock.fn() };

  const unsub = createShadowSubscriber(mockEventBus, mockStageApi, { enabled: false });
  assert.equal(typeof unsub, "function");
  assert.equal(mockEventBus.subscribe.mock.callCount(), 0);
});

test("createShadowSubscriber: subscribes to UNDERSTAND_COMPLETED when enabled", async () => {
  const { createShadowSubscriber } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const handlers = new Map();
  const mockEventBus = {
    subscribe: mock.fn((eventName, handler) => {
      if (!handlers.has(eventName)) handlers.set(eventName, []);
      handlers.get(eventName).push(handler);
      return () => {
        const arr = handlers.get(eventName) || [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    }),
    emit: mock.fn(),
    once: mock.fn(),
  };
  const mockStageApi = { emit: mock.fn() };

  const unsub = createShadowSubscriber(mockEventBus, mockStageApi, { enabled: true });
  assert.equal(mockEventBus.subscribe.mock.callCount(), 1);
  const call = mockEventBus.subscribe.mock.calls[0];
  assert.equal(call.arguments[0], "deepsearch.understand.completed");
  assert.equal(typeof unsub, "function");
});

test("createShadowSubscriber: handles invalid eventBus gracefully", async () => {
  const { createShadowSubscriber } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");
  const mockStageApi = { emit: mock.fn() };

  const unsub = createShadowSubscriber(null, mockStageApi, { enabled: true });
  assert.equal(typeof unsub, "function");
});

test("createShadowSubscriber: unsubscribe function removes listener", async () => {
  const { createShadowSubscriber } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const handlers = new Map();
  const mockEventBus = {
    subscribe: mock.fn((eventName, handler) => {
      if (!handlers.has(eventName)) handlers.set(eventName, []);
      handlers.get(eventName).push(handler);
      return () => {
        const arr = handlers.get(eventName) || [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    }),
    emit: mock.fn(),
    once: mock.fn(),
  };
  const mockStageApi = { emit: mock.fn() };

  const unsub = createShadowSubscriber(mockEventBus, mockStageApi, { enabled: true });
  assert.equal(handlers.get("deepsearch.understand.completed")?.length, 1);

  unsub();
  assert.equal(handlers.get("deepsearch.understand.completed")?.length, 0);
});

test("ShadowAgent.validateBatch: handles empty claims array", async () => {
  const { ShadowAgent } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const mockStageApi = { emit: mock.fn() };
  const agent = new ShadowAgent(mockStageApi, {}, {});

  const results = await agent.validateBatch([], [], {});
  assert.deepEqual(results, []);
});

test("ShadowAgent.validateBatch: validates claims against evidence", async () => {
  const { ShadowAgent } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const mockStageApi = { emit: mock.fn() };
  const agent = new ShadowAgent(mockStageApi, {}, {});

  // Mock validateEvidence to return a simple result
  agent.validateEvidence = mock.fn(async () => ({
    supports: true,
    strength: "moderate",
    confidence: 0.8,
  }));

  const claims = [{ claimId: "c_1", text: "Claim 1", evidenceIds: ["e_1"] }];
  const evidenceLedger = [{ evidenceId: "e_1", quote: "Evidence 1" }];

  const results = await agent.validateBatch(claims, evidenceLedger, { gapId: "gap_1" });

  assert.equal(results.length, 1);
  assert.equal(results[0].claimId, "c_1");
  assert.equal(results[0].evidenceId, "e_1");
  assert.equal(results[0].valid, true);
});

test("ShadowAgent.validateBatch: respects maxCallsPerRound limit", async () => {
  const { ShadowAgent } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const mockStageApi = { emit: mock.fn() };
  const agent = new ShadowAgent(mockStageApi, {}, { maxCallsPerRound: 2 });

  agent.validateEvidence = mock.fn(async () => ({ supports: true }));

  const claims = [
    { claimId: "c_1", evidenceIds: ["e_1"] },
    { claimId: "c_2", evidenceIds: ["e_2"] },
    { claimId: "c_3", evidenceIds: ["e_3"] }, // should be skipped
  ];
  const evidence = [
    { evidenceId: "e_1" },
    { evidenceId: "e_2" },
    { evidenceId: "e_3" },
  ];

  await agent.validateBatch(claims, evidence, {});
  assert.equal(agent.validateEvidence.mock.callCount(), 2);
});

test("ShadowAgent.validateBatch: catches validation errors gracefully", async () => {
  const { ShadowAgent } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const mockStageApi = { emit: mock.fn() };
  const agent = new ShadowAgent(mockStageApi, {}, {});

  agent.validateEvidence = mock.fn(async () => {
    throw new Error("Test error");
  });

  const claims = [{ claimId: "c_1", evidenceIds: ["e_1"] }];
  const evidence = [{ evidenceId: "e_1" }];

  const results = await agent.validateBatch(claims, evidence, {});
  assert.equal(results[0].claimId, "c_1");
  assert.equal(results[0].evidenceId, "e_1");
  assert.equal(results[0].valid, false);
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].reason, "Test error");
});

test("waitForShadowValidation: resolves with null on timeout", async () => {
  const { waitForShadowValidation } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const handlers = new Map();
  const mockEventBus = {
    subscribe: mock.fn((eventName, handler) => {
      if (!handlers.has(eventName)) handlers.set(eventName, []);
      handlers.get(eventName).push(handler);
      return () => { };
    }),
    emit: mock.fn(),
    once: mock.fn((eventName, handler) => {
      const unsub = mockEventBus.subscribe(eventName, (payload) => {
        unsub();
        handler(payload);
      });
      return unsub;
    }),
  };

  const results = await waitForShadowValidation(mockEventBus, "gap_1", 50);
  assert.equal(results, null);
});

test("waitForShadowValidation: handles invalid eventBus", async () => {
  const { waitForShadowValidation } = await import("../../../js/agents/stages/deepsearch/shadow-agent.js");

  const results = await waitForShadowValidation(null, "gap_1", 50);
  assert.equal(results, null);
});
