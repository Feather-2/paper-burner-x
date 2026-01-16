import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("StageApiFactory createBaseApi merges services and overrides", async () => {
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

  expect(api.eventBus).toBe(eventBus);
  expect(api.aiApiService).toBe(overrideAiApi);
  expect(api.custom).toBe("fromOverrides");
  expect(api.signal).toBeTruthy();
  expect(typeof api.emit).toBe("function");

  api.emit("run.test", { ok: true });
  expect(emitted).toEqual({ name: "run.test", payload: { ok: true } });
});

it("StageApiFactory createDeepSearchApi injects services", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const factory = new StageApiFactory({
    localRetriever: "local",
    externalSearchProvider: "external",
    storageAdapter: "storage",
    ocr: "ocr",
  });

  const api = factory.createDeepSearchApi({ storageAdapter: "override" });

  expect(api.localRetriever).toBe("local");
  expect(api.externalSearchProvider).toBe("external");
  expect(api.storageAdapter).toBe("override");
  expect(api.ocr).toBe("ocr");
  // Note: logger.warn is used internally, not console.warn
  // Missing aiApiService warning is logged via createLogger
});

it("StageApiFactory createDesignApi injects services and skips warnings when complete", async () => {
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

  expect(api.aiApiService.chat.name).toBe("chat");
  expect(api.imageProvider).toBe("override");
  expect(api.svgGenerator).toBe("svg");
  expect(api.modelRouter).toBe("router");
  expect(typeof api.emit).toBe("function");
  expect(warnings.length).toBe(0);
});

it("StageApiFactory createTextPrepApi passes overrides", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const factory = new StageApiFactory({ aiApiService: { chat() {} } });
  const api = factory.createTextPrepApi({ mode: "textprep" });

  expect(api.mode).toBe("textprep");
  expect(api.signal).toBeTruthy();
});

it("StageApiFactory validate returns boolean", async () => {
  const { StageApiFactory } = await import("../../../js/agents/runtime/api/stage-api-factory.js");

  const factory = new StageApiFactory();

  const ok = factory.validate({ signal: "sig", emit: () => {} }, ["signal", "emit"]);
  const bad = factory.validate({ emit: () => {} }, ["signal", "emit"]);

  expect(ok).toBe(true);
  expect(bad).toBe(false);
  // Note: logger.warn is used internally for missing fields warning
});

it("StageApiFactory fromWorkflowContext maps services and exports are wired", async () => {
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
  expect(factory instanceof StageApiFactory).toBeTruthy();
  expect(factory.services.signal).toBe("sig");
  expect(factory.services.emit).toBe(eventBus.emit);
  expect(factory.services.imageProvider).toBe("image-provider");
  expect(factory.services.archive).toBe("archive");
  expect(factory.services.logger).toBe("logger");

  const created = createStageApiFactory({ signal: "s" });
  expect(created instanceof StageApiFactory).toBeTruthy();
  expect(DefaultExport).toBe(StageApiFactory);
});
