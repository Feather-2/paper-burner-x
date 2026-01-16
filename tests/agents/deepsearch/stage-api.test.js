import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("validateStageApi: rejects non-objects and reports missing required fields", async () => {
  const { validateStageApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  {
    const out = validateStageApi(null);
    expect(out.valid).toBe(false);
    expect(out.missing.some(x => String(x).includes("stageApi must be an object")));
  }

  {
    const out = validateStageApi(123);
    expect(out.valid).toBe(false);
    expect(out.missing.some(x => String(x).includes("stageApi must be an object")));
  }

  {
    const out = validateStageApi({});
    expect(out.valid).toBe(false);
    expect(out.missing).toEqual(["signal"]);
    expect(out.warnings).toEqual([]);
  }
});

it("validateStageApi: emits warnings for invalid optional field types", async () => {
  const { validateStageApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  const controller = new AbortController();
  const out = validateStageApi({
    signal: controller.signal,
    emit: 123,
    modelRouter: {},
    aiApiService: { chat: 1 },
  });

  expect(out.valid).toBe(true);
  expect(out.warnings.includes("emit should be a function")).toBeTruthy();
  expect(out.warnings.includes("modelRouter.call should be a function")).toBeTruthy();
  expect(out.warnings.includes("aiApiService.chat should be a function")).toBeTruthy();
});

it("createStageApi: fills defaults (signal, emit, checkCancelled) and supports strict warnings", async () => {
  const { createStageApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  {
    const api = createStageApi();
    expect(api.signal && typeof api.signal.aborted === "boolean").toBeTruthy();
    expect(typeof api.emit).toBe("function");
    expect(typeof api.checkCancelled).toBe("function");
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
    expect(busCalls.length).toBe(1);
    expect(busCalls[0].name).toBe("evt");
    expect(busCalls[0].record).toEqual({ ok: true });
    expect(busCalls[0].thisValue).toBe(bus);
  }

  {
    const controller = new AbortController();
    const api = createStageApi({ signal: controller.signal, emit: 1 });
    controller.abort("cancelled");
    expect(() => api.checkCancelled()).toThrow(/cancelled|cancel/i);
  }

  {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      // Force warnings: aiApiService present but invalid shape.
      const api = createStageApi({ aiApiService: {} }, { strict: true });
      expect(api.signal).toBeTruthy();
      expect(warnings.length >= 1).toBeTruthy();
    } finally {
      console.warn = originalWarn;
    }
  }
});

it("extractServices: provides safe fallbacks and binds emit correctly", async () => {
  const { extractServices } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  {
    const { signal, emit, checkCancelled, eventBus } = extractServices(null);
    expect(signal).toBe(null);
    expect(eventBus).toBe(null);
    expect(typeof emit).toBe("function");
    expect(typeof checkCancelled).toBe("function");
    expect(() => checkCancelled()).not.toThrow();
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
    expect(calls.length).toBe(1);
    expect(calls[0].thisValue).toBe(stageApi);
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
    expect(calls.length).toBe(1);
    expect(calls[0].thisValue).toBe(bus);
  }
});

it("mergeStageApis: merges non-null/undefined values and returns a complete api", async () => {
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

  expect(merged.signal).toBe(b.signal);
  expect(merged.eventBus).toBe(busB);
  expect(merged.modelRouter && typeof merged.modelRouter.call === "function").toBeTruthy();
  expect(typeof merged.emit).toBe("function");
  expect(typeof merged.checkCancelled).toBe("function");
});

it("createChildApi: inherits parent values and allows overrides", async () => {
  const { createChildApi } = await import("../../../js/agents/stages/deepsearch/utils/stage-api.js");

  const controller = new AbortController();
  const parent = { signal: controller.signal, logger: { info: () => {} } };
  const child = createChildApi(parent, { externalSearchProvider: { search: async () => [] } });

  expect(child.signal).toBe(controller.signal);
  expect(child.logger && typeof child.logger.info === "function").toBeTruthy();
  expect(child.externalSearchProvider && typeof child.externalSearchProvider.search === "function").toBeTruthy();
});

