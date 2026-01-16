import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  StageApiSpec,
  validateStageApi,
  createStageApi,
  extractServices,
  mergeStageApis,
  createChildApi,
  createRunTool,
} from "../../js/agents/shared/utils/stage-api.js";

describe("shared/utils/stage-api", () => {
  describe("StageApiSpec", () => {
    it("has required fields", () => {
      assert.ok(Array.isArray(StageApiSpec.required));
      assert.ok(StageApiSpec.required.includes("signal"));
    });

    it("has optional fields", () => {
      assert.ok(typeof StageApiSpec.optional === "object");
      assert.ok("emit" in StageApiSpec.optional);
      assert.ok("modelRouter" in StageApiSpec.optional);
      assert.ok("aiApiService" in StageApiSpec.optional);
    });
  });

  describe("validateStageApi", () => {
    it("returns invalid for non-object", () => {
      const result = validateStageApi(null);
      assert.equal(result.valid, false);
      assert.ok(result.missing[0].includes("object"));
    });

    it("returns invalid for array", () => {
      const result = validateStageApi([]);
      assert.equal(result.valid, false);
    });

    it("returns invalid for missing signal", () => {
      const result = validateStageApi({});
      assert.equal(result.valid, false);
      assert.ok(result.missing.includes("signal"));
    });

    it("returns valid for object with signal", () => {
      const result = validateStageApi({ signal: new AbortController().signal });
      assert.equal(result.valid, true);
      assert.deepEqual(result.missing, []);
    });

    it("warns for non-function emit", () => {
      const result = validateStageApi({
        signal: new AbortController().signal,
        emit: "not a function",
      });
      assert.equal(result.valid, true);
      assert.ok(result.warnings.some((w) => w.includes("emit")));
    });

    it("warns for invalid modelRouter", () => {
      const result = validateStageApi({
        signal: new AbortController().signal,
        modelRouter: { call: "not a function" },
      });
      assert.ok(result.warnings.some((w) => w.includes("modelRouter")));
    });

    it("warns for invalid aiApiService", () => {
      const result = validateStageApi({
        signal: new AbortController().signal,
        aiApiService: { chat: "not a function" },
      });
      assert.ok(result.warnings.some((w) => w.includes("aiApiService")));
    });

    it("accepts class instance (not plain object)", () => {
      class MyApi {
        signal = new AbortController().signal;
      }
      const result = validateStageApi(new MyApi());
      assert.equal(result.valid, true);
    });
  });

  describe("createStageApi", () => {
    it("creates api with default signal", () => {
      const api = createStageApi();
      assert.ok(api.signal);
      assert.ok(api.signal instanceof AbortSignal);
    });

    it("preserves provided signal", () => {
      const signal = new AbortController().signal;
      const api = createStageApi({ signal });
      assert.equal(api.signal, signal);
    });

    it("sets optional fields to defaults", () => {
      const api = createStageApi({});
      assert.equal(api.modelRouter, null);
      assert.equal(api.aiApiService, null);
      assert.equal(api.localRetriever, null);
    });

    it("provides emit function", () => {
      const api = createStageApi();
      assert.equal(typeof api.emit, "function");
      // Should not throw
      api.emit("test", {});
    });

    it("uses provided emit function", () => {
      let called = false;
      const emit = () => { called = true; };
      const api = createStageApi({ emit });
      api.emit("test", {});
      assert.ok(called);
    });

    it("uses eventBus.emit if no emit provided", () => {
      let called = false;
      const eventBus = { emit: () => { called = true; } };
      const api = createStageApi({ eventBus });
      api.emit("test", {});
      assert.ok(called);
    });

    it("provides checkCancelled function", () => {
      const api = createStageApi();
      assert.equal(typeof api.checkCancelled, "function");
      // Should not throw for non-aborted signal
      api.checkCancelled();
    });

    it("checkCancelled throws when signal aborted", () => {
      const controller = new AbortController();
      const api = createStageApi({ signal: controller.signal });
      controller.abort();
      assert.throws(() => api.checkCancelled(), /cancelled|aborted/i);
    });

    it("uses provided checkCancelled", () => {
      let called = false;
      const checkCancelled = () => { called = true; };
      const api = createStageApi({ checkCancelled });
      api.checkCancelled();
      assert.ok(called);
    });

    it("handles non-object partial", () => {
      const api = createStageApi("invalid");
      assert.ok(api.signal);
    });

    it("strict mode does not throw when signal auto-created", () => {
      // Signal is auto-created, so strict mode passes
      const api = createStageApi({}, { strict: true });
      assert.ok(api.signal);
    });

    it("strict mode passes with valid api", () => {
      const api = createStageApi(
        { signal: new AbortController().signal },
        { strict: true }
      );
      assert.ok(api);
    });
  });

  describe("extractServices", () => {
    it("extracts signal from api", () => {
      const signal = new AbortController().signal;
      const services = extractServices({ signal });
      assert.equal(services.signal, signal);
    });

    it("returns null for missing services", () => {
      const services = extractServices({});
      assert.equal(services.signal, null);
      assert.equal(services.eventBus, null);
      assert.equal(services.modelRouter, null);
    });

    it("extracts emit from eventBus", () => {
      let called = false;
      const eventBus = { emit: () => { called = true; } };
      const services = extractServices({ eventBus });
      services.emit("test");
      assert.ok(called);
    });

    it("provides default emit if none", () => {
      const services = extractServices({});
      assert.equal(typeof services.emit, "function");
      services.emit("test"); // Should not throw
    });

    it("extracts runTool if function", () => {
      const runTool = () => {};
      const services = extractServices({ runTool });
      assert.equal(services.runTool, runTool);
    });

    it("returns null for non-function runTool", () => {
      const services = extractServices({ runTool: "not a function" });
      assert.equal(services.runTool, null);
    });

    it("handles null input", () => {
      const services = extractServices(null);
      assert.ok(services);
      assert.equal(services.signal, null);
    });

    it("handles non-object input", () => {
      const services = extractServices("invalid");
      assert.ok(services);
    });

    it("provides checkCancelled function", () => {
      const services = extractServices({});
      assert.equal(typeof services.checkCancelled, "function");
    });
  });

  describe("mergeStageApis", () => {
    it("merges multiple apis", () => {
      const signal = new AbortController().signal;
      const modelRouter = { call: () => {} };
      const merged = mergeStageApis({ signal }, { modelRouter });
      assert.equal(merged.signal, signal);
      assert.equal(merged.modelRouter, modelRouter);
    });

    it("later values override earlier", () => {
      const sig1 = new AbortController().signal;
      const sig2 = new AbortController().signal;
      const merged = mergeStageApis({ signal: sig1 }, { signal: sig2 });
      assert.equal(merged.signal, sig2);
    });

    it("skips null/undefined values", () => {
      const signal = new AbortController().signal;
      const merged = mergeStageApis({ signal }, { modelRouter: null });
      assert.equal(merged.signal, signal);
      assert.equal(merged.modelRouter, null);
    });

    it("handles null entries in args", () => {
      const signal = new AbortController().signal;
      const merged = mergeStageApis(null, { signal }, undefined);
      assert.equal(merged.signal, signal);
    });

    it("returns valid stageApi with defaults", () => {
      const merged = mergeStageApis({});
      assert.ok(merged.signal);
      assert.equal(typeof merged.emit, "function");
    });
  });

  describe("createChildApi", () => {
    it("inherits parent properties", () => {
      const signal = new AbortController().signal;
      const parent = { signal, modelRouter: { call: () => {} } };
      const child = createChildApi(parent);
      assert.equal(child.signal, signal);
      assert.ok(child.modelRouter);
    });

    it("overrides with provided values", () => {
      const parentSignal = new AbortController().signal;
      const childSignal = new AbortController().signal;
      const parent = { signal: parentSignal };
      const child = createChildApi(parent, { signal: childSignal });
      assert.equal(child.signal, childSignal);
    });

    it("adds new properties", () => {
      const parent = { signal: new AbortController().signal };
      const child = createChildApi(parent, { customProp: "value" });
      assert.equal(child.customProp, "value");
    });
  });

  describe("createRunTool", () => {
    it("returns null without modelRouter", () => {
      const result = createRunTool({});
      assert.equal(result, null);
    });

    it("returns null for invalid modelRouter", () => {
      const result = createRunTool({ modelRouter: {} });
      assert.equal(result, null);
    });

    it("returns null for non-function call", () => {
      const result = createRunTool({ modelRouter: { call: "not a function" } });
      assert.equal(result, null);
    });

    it("returns function for valid modelRouter", () => {
      const modelRouter = { call: async () => ({}) };
      const runTool = createRunTool({ modelRouter });
      assert.equal(typeof runTool, "function");
    });

    it("throws for unknown tool", async () => {
      const modelRouter = { call: async () => ({}) };
      const runTool = createRunTool({ modelRouter });
      await assert.rejects(
        () => runTool("unknown_tool", {}),
        /Unknown tool/
      );
    });

    it("calls modelRouter for synthesize_claims", async () => {
      let calledWith = null;
      const modelRouter = {
        call: async (opts) => {
          calledWith = opts;
          return { content: '{"mergedClaims":[]}' };
        },
      };
      const runTool = createRunTool({ modelRouter });
      const result = await runTool("synthesize_claims", { claims: [] });
      assert.ok(calledWith);
      assert.equal(calledWith.taskType, "tool_call");
      assert.deepEqual(result, { mergedClaims: [] });
    });

    it("calls modelRouter for analyze_conflicts", async () => {
      let calledWith = null;
      const modelRouter = {
        call: async (opts) => {
          calledWith = opts;
          return { choices: [{ message: { content: '{"conflicts":[]}' } }] };
        },
      };
      const runTool = createRunTool({ modelRouter });
      const result = await runTool("analyze_conflicts", { pairs: [] });
      assert.ok(calledWith);
      assert.deepEqual(result, { conflicts: [] });
    });

    it("handles non-string content", async () => {
      const modelRouter = {
        call: async () => ({ content: { already: "parsed" } }),
      };
      const runTool = createRunTool({ modelRouter });
      const result = await runTool("synthesize_claims", { claims: [] });
      assert.deepEqual(result, { already: "parsed" });
    });

    it("logs and rethrows on error", async () => {
      let warned = false;
      const logger = { warn: () => { warned = true; } };
      const modelRouter = {
        call: async () => { throw new Error("API error"); },
      };
      const runTool = createRunTool({ modelRouter, logger });
      await assert.rejects(
        () => runTool("synthesize_claims", { claims: [] }),
        /API error/
      );
      assert.ok(warned);
    });

    it("respects signal in options", async () => {
      const controller = new AbortController();
      let passedSignal = null;
      const modelRouter = {
        call: async (opts) => {
          passedSignal = opts.signal;
          return { content: "{}" };
        },
      };
      const runTool = createRunTool({ modelRouter, signal: controller.signal });
      await runTool("synthesize_claims", { claims: [] });
      assert.equal(passedSignal, controller.signal);
    });
  });
});
