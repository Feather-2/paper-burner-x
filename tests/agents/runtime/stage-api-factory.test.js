const test = require("node:test");
const assert = require("node:assert/strict");

test("StageApiFactory createBaseApi merges services and overrides", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  let emitted = null;
  const eventBus = {
    emit: (name, payload) => {
      emitted = { name, payload };
    },
  };

  const services = {
    eventBus,
    aiApiService: { chat() {} },
    logger: { info() {} },
    custom: "fromServices",
  };

  const factory = new StageApiFactory(services);
  const overrideAiApi = { chat() { return "override"; } };
  const api = factory.createBaseApi({
    aiApiService: overrideAiApi,
    custom: "fromOverrides",
  });

  assert.equal(api.eventBus, eventBus);
  assert.equal(api.aiApiService, overrideAiApi);
  assert.equal(api.custom, "fromOverrides");
  assert.ok(api.signal);
  assert.equal(typeof api.emit, "function");

  api.emit("run.test", { ok: true });
  assert.deepEqual(emitted, { name: "run.test", payload: { ok: true } });
});

test("StageApiFactory createDeepSearchApi injects services and warns when missing aiApiService", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));

  let api = null;
  try {
    const factory = new StageApiFactory({
      localRetriever: "local",
      externalSearchProvider: "external",
      storageAdapter: "storage",
      ocr: "ocr",
    });

    api = factory.createDeepSearchApi({ storageAdapter: "override" });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(api.localRetriever, "local");
  assert.equal(api.externalSearchProvider, "external");
  assert.equal(api.storageAdapter, "override");
  assert.equal(api.ocr, "ocr");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /DeepSearch API missing fields: aiApiService/);
});

test("StageApiFactory createDesignApi injects services and skips warnings when complete", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));

  let api = null;
  try {
    const aiApiService = { chat() {} };
    const factory = new StageApiFactory({
      aiApiService,
      imageProvider: "image",
      svgGenerator: "svg",
      modelRouter: "router",
    });

    api = factory.createDesignApi({ imageProvider: "override" });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(api.aiApiService.chat.name, "chat");
  assert.equal(api.imageProvider, "override");
  assert.equal(api.svgGenerator, "svg");
  assert.equal(api.modelRouter, "router");
  assert.equal(typeof api.emit, "function");
  assert.equal(warnings.length, 0);
});

test("StageApiFactory createTextPrepApi passes overrides", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const factory = new StageApiFactory({ aiApiService: { chat() {} } });
  const api = factory.createTextPrepApi({ mode: "textprep" });

  assert.equal(api.mode, "textprep");
  assert.ok(api.signal);
});

test("StageApiFactory validate returns boolean and uses default stage name", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const factory = new StageApiFactory();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));

  let ok = false;
  let bad = false;
  try {
    ok = factory.validate({ signal: "sig", emit: () => {} }, ["signal", "emit"]);
    bad = factory.validate({ emit: () => {} }, ["signal", "emit"]);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(ok, true);
  assert.equal(bad, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Stage API missing fields: signal/);
});

test("StageApiFactory fromWorkflowContext maps services and exports are wired", async () => {
  const mod = await import("../../../js/agents/runtime/api/stage-api-factory.js");
  const { StageApiFactory, createStageApiFactory, default: DefaultExport } = mod;

  const eventBus = { emit() {} };
  const ctx = {
    signal: "sig",
    eventBus,
    aiApiService: { chat() {} },
    modelRouter: "router",
    localRetriever: "local",
    externalSearchProvider: "external",
    storageAdapter: "storage",
    ocr: "ocr",
    imageService: "image-service",
    imageProvider: "image-provider",
    svgGenerator: "svg",
    archive: "archive",
    logger: "logger",
  };

  const factory = StageApiFactory.fromWorkflowContext(ctx);
  assert.ok(factory instanceof StageApiFactory);
  assert.equal(factory.services.signal, "sig");
  assert.equal(factory.services.emit, eventBus.emit);
  assert.equal(factory.services.imageProvider, "image-provider");
  assert.equal(factory.services.archive, "archive");
  assert.equal(factory.services.logger, "logger");

  const created = createStageApiFactory({ signal: "s" });
  assert.ok(created instanceof StageApiFactory);
  assert.equal(DefaultExport, StageApiFactory);
});
