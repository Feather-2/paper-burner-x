const test = require("node:test");
const assert = require("node:assert/strict");

test("validateStageApi: rejects non-objects and reports missing required fields", async () => {
  const { validateStageApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  {
    const out = validateStageApi(null);
    assert.equal(out.valid, false);
    assert.ok(out.missing.some((x) => String(x).includes("stageApi must be an object")));
  }

  {
    const out = validateStageApi(123);
    assert.equal(out.valid, false);
    assert.ok(out.missing.some((x) => String(x).includes("stageApi must be an object")));
  }

  {
    const out = validateStageApi({});
    assert.equal(out.valid, false);
    assert.deepEqual(out.missing, ["signal"]);
    assert.deepEqual(out.warnings, []);
  }
});

test("validateStageApi: emits warnings for invalid optional field types", async () => {
  const { validateStageApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  const controller = new AbortController();
  const out = validateStageApi({
    signal: controller.signal,
    emit: 123,
    modelRouter: {},
    aiApiService: { chat: 1 },
  });

  assert.equal(out.valid, true);
  assert.ok(out.warnings.includes("emit should be a function"));
  assert.ok(out.warnings.includes("modelRouter.call should be a function"));
  assert.ok(out.warnings.includes("aiApiService.chat should be a function"));
});

test("createStageApi: fills defaults (signal, emit, checkCancelled) and supports strict warnings", async () => {
  const { createStageApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  {
    const api = createStageApi();
    assert.ok(api.signal && typeof api.signal.aborted === "boolean");
    assert.equal(typeof api.emit, "function");
    assert.equal(typeof api.checkCancelled, "function");
  }

  {
    const busCalls = [];
    const bus = {
      emit: function (name, record) {
        busCalls.push({ name, record, thisValue: this });
      },
    };

    const api = createStageApi({ eventBus: bus });
    api.emit("evt", { ok: true });
    assert.equal(busCalls.length, 1);
    assert.equal(busCalls[0].name, "evt");
    assert.deepEqual(busCalls[0].record, { ok: true });
    assert.equal(busCalls[0].thisValue, bus);
  }

  {
    const controller = new AbortController();
    const api = createStageApi({ signal: controller.signal, emit: 1 });
    controller.abort("cancelled");
    assert.throws(() => api.checkCancelled(), /cancelled|cancel/i);
  }

  {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      // Force warnings: aiApiService present but invalid shape.
      const api = createStageApi({ aiApiService: {} }, { strict: true });
      assert.ok(api.signal);
      assert.ok(warnings.length >= 1);
    } finally {
      console.warn = originalWarn;
    }
  }
});

test("extractServices: provides safe fallbacks and binds emit correctly", async () => {
  const { extractServices } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  {
    const { signal, emit, checkCancelled, eventBus } = extractServices(null);
    assert.equal(signal, null);
    assert.equal(eventBus, null);
    assert.equal(typeof emit, "function");
    assert.equal(typeof checkCancelled, "function");
    assert.doesNotThrow(() => checkCancelled());
  }

  {
    const calls = [];
    const stageApi = {
      emit: function (name, record) {
        calls.push({ name, record, thisValue: this });
      },
    };
    const { emit } = extractServices(stageApi);
    emit("evt", { a: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].thisValue, stageApi);
  }

  {
    const calls = [];
    const bus = {
      emit: function (name, record) {
        calls.push({ name, record, thisValue: this });
      },
    };
    const { emit } = extractServices({ eventBus: bus });
    emit("evt_bus", { b: 2 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].thisValue, bus);
  }
});

test("mergeStageApis: merges non-null/undefined values and returns a complete api", async () => {
  const { mergeStageApis } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  const a = new AbortController();
  const b = new AbortController();

  const busA = { emit: () => {} };
  const busB = { emit: () => {} };

  const merged = mergeStageApis(
    { signal: a.signal, eventBus: busA, logger: null },
    { signal: b.signal, eventBus: null, modelRouter: { call: async () => ({ content: "ok" }) } },
    { eventBus: busB }
  );

  assert.equal(merged.signal, b.signal);
  assert.equal(merged.eventBus, busB);
  assert.ok(merged.modelRouter && typeof merged.modelRouter.call === "function");
  assert.equal(typeof merged.emit, "function");
  assert.equal(typeof merged.checkCancelled, "function");
});

test("createChildApi: inherits parent values and allows overrides", async () => {
  const { createChildApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  const controller = new AbortController();
  const parent = { signal: controller.signal, logger: { info: () => {} } };
  const child = createChildApi(parent, { externalSearchProvider: { search: async () => [] } });

  assert.equal(child.signal, controller.signal);
  assert.ok(child.logger && typeof child.logger.info === "function");
  assert.ok(child.externalSearchProvider && typeof child.externalSearchProvider.search === "function");
});

