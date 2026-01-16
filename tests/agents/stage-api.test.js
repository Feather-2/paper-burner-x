
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
      expect(Array.isArray(StageApiSpec.required)).toBeTruthy();
      expect(StageApiSpec.required.includes("signal")).toBeTruthy();
    });

    it("has optional fields", () => {
      expect(typeof StageApiSpec.optional === "object").toBeTruthy();
      expect("emit" in StageApiSpec.optional).toBeTruthy();
      expect("modelRouter" in StageApiSpec.optional).toBeTruthy();
      expect("aiApiService" in StageApiSpec.optional).toBeTruthy();
    });
  });

  describe("validateStageApi", () => {
    it("returns invalid for non-object", () => {
      const result = validateStageApi(null);
      expect(result.valid).toBe(false);
      expect(result.missing[0].includes("object")).toBeTruthy();
    });

    it("returns invalid for array", () => {
      const result = validateStageApi([]);
      expect(result.valid).toBe(false);
    });

    it("returns invalid for missing signal", () => {
      const result = validateStageApi({});
      expect(result.valid).toBe(false);
      expect(result.missing.includes("signal")).toBeTruthy();
    });

    it("returns valid for object with signal", () => {
      const result = validateStageApi({ signal: new AbortController().signal });
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("warns for non-function emit", () => {
      const result = validateStageApi({
        signal: new AbortController().signal,
        emit: "not a function",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("emit")));
    });

    it("warns for invalid modelRouter", () => {
      const result = validateStageApi({
        signal: new AbortController().signal,
        modelRouter: { call: "not a function" },
      });
      expect(result.warnings.some(w => w.includes("modelRouter")));
    });

    it("warns for invalid aiApiService", () => {
      const result = validateStageApi({
        signal: new AbortController().signal,
        aiApiService: { chat: "not a function" },
      });
      expect(result.warnings.some(w => w.includes("aiApiService")));
    });

    it("accepts class instance (not plain object)", () => {
      class MyApi {
        signal = new AbortController().signal;
      }
      const result = validateStageApi(new MyApi());
      expect(result.valid).toBe(true);
    });
  });

  describe("createStageApi", () => {
    it("creates api with default signal", () => {
      const api = createStageApi();
      expect(api.signal).toBeTruthy();
      expect(api.signal instanceof AbortSignal).toBeTruthy();
    });

    it("preserves provided signal", () => {
      const signal = new AbortController().signal;
      const api = createStageApi({ signal });
      expect(api.signal).toBe(signal);
    });

    it("sets optional fields to defaults", () => {
      const api = createStageApi({});
      expect(api.modelRouter).toBe(null);
      expect(api.aiApiService).toBe(null);
      expect(api.localRetriever).toBe(null);
    });

    it("provides emit function", () => {
      const api = createStageApi();
      expect(typeof api.emit).toBe("function");
      // Should not throw
      api.emit("test", {});
    });

    it("uses provided emit function", () => {
      let called = false;
      const emit = () => { called = true; };
      const api = createStageApi({ emit });
      api.emit("test", {});
      expect(called).toBeTruthy();
    });

    it("uses eventBus.emit if no emit provided", () => {
      let called = false;
      const eventBus = { emit: () => { called = true; } };
      const api = createStageApi({ eventBus });
      api.emit("test", {});
      expect(called).toBeTruthy();
    });

    it("provides checkCancelled function", () => {
      const api = createStageApi();
      expect(typeof api.checkCancelled).toBe("function");
      // Should not throw for non-aborted signal
      api.checkCancelled();
    });

    it("checkCancelled throws when signal aborted", () => {
      const controller = new AbortController();
      const api = createStageApi({ signal: controller.signal });
      controller.abort();
      expect(() => api.checkCancelled()).toThrow(/cancelled|aborted/i);
    });

    it("uses provided checkCancelled", () => {
      let called = false;
      const checkCancelled = () => { called = true; };
      const api = createStageApi({ checkCancelled });
      api.checkCancelled();
      expect(called).toBeTruthy();
    });

    it("handles non-object partial", () => {
      const api = createStageApi("invalid");
      expect(api.signal).toBeTruthy();
    });

    it("strict mode does not throw when signal auto-created", () => {
      // Signal is auto-created, so strict mode passes
      const api = createStageApi({}, { strict: true });
      expect(api.signal).toBeTruthy();
    });

    it("strict mode passes with valid api", () => {
      const api = createStageApi(
        { signal: new AbortController().signal },
        { strict: true }
      );
      expect(api).toBeTruthy();
    });
  });

  describe("extractServices", () => {
    it("extracts signal from api", () => {
      const signal = new AbortController().signal;
      const services = extractServices({ signal });
      expect(services.signal).toBe(signal);
    });

    it("returns null for missing services", () => {
      const services = extractServices({});
      expect(services.signal).toBe(null);
      expect(services.eventBus).toBe(null);
      expect(services.modelRouter).toBe(null);
    });

    it("extracts emit from eventBus", () => {
      let called = false;
      const eventBus = { emit: () => { called = true; } };
      const services = extractServices({ eventBus });
      services.emit("test");
      expect(called).toBeTruthy();
    });

    it("provides default emit if none", () => {
      const services = extractServices({});
      expect(typeof services.emit).toBe("function");
      services.emit("test"); // Should not throw
    });

    it("extracts runTool if function", () => {
      const runTool = () => {};
      const services = extractServices({ runTool });
      expect(services.runTool).toBe(runTool);
    });

    it("returns null for non-function runTool", () => {
      const services = extractServices({ runTool: "not a function" });
      expect(services.runTool).toBe(null);
    });

    it("handles null input", () => {
      const services = extractServices(null);
      expect(services).toBeTruthy();
      expect(services.signal).toBe(null);
    });

    it("handles non-object input", () => {
      const services = extractServices("invalid");
      expect(services).toBeTruthy();
    });

    it("provides checkCancelled function", () => {
      const services = extractServices({});
      expect(typeof services.checkCancelled).toBe("function");
    });
  });

  describe("mergeStageApis", () => {
    it("merges multiple apis", () => {
      const signal = new AbortController().signal;
      const modelRouter = { call: () => {} };
      const merged = mergeStageApis({ signal }, { modelRouter });
      expect(merged.signal).toBe(signal);
      expect(merged.modelRouter).toBe(modelRouter);
    });

    it("later values override earlier", () => {
      const sig1 = new AbortController().signal;
      const sig2 = new AbortController().signal;
      const merged = mergeStageApis({ signal: sig1 }, { signal: sig2 });
      expect(merged.signal).toBe(sig2);
    });

    it("skips null/undefined values", () => {
      const signal = new AbortController().signal;
      const merged = mergeStageApis({ signal }, { modelRouter: null });
      expect(merged.signal).toBe(signal);
      expect(merged.modelRouter).toBe(null);
    });

    it("handles null entries in args", () => {
      const signal = new AbortController().signal;
      const merged = mergeStageApis(null, { signal }, undefined);
      expect(merged.signal).toBe(signal);
    });

    it("returns valid stageApi with defaults", () => {
      const merged = mergeStageApis({});
      expect(merged.signal).toBeTruthy();
      expect(typeof merged.emit).toBe("function");
    });
  });

  describe("createChildApi", () => {
    it("inherits parent properties", () => {
      const signal = new AbortController().signal;
      const parent = { signal, modelRouter: { call: () => {} } };
      const child = createChildApi(parent);
      expect(child.signal).toBe(signal);
      expect(child.modelRouter).toBeTruthy();
    });

    it("overrides with provided values", () => {
      const parentSignal = new AbortController().signal;
      const childSignal = new AbortController().signal;
      const parent = { signal: parentSignal };
      const child = createChildApi(parent, { signal: childSignal });
      expect(child.signal).toBe(childSignal);
    });

    it("adds new properties", () => {
      const parent = { signal: new AbortController().signal };
      const child = createChildApi(parent, { customProp: "value" });
      expect(child.customProp).toBe("value");
    });
  });

  describe("createRunTool", () => {
    it("returns null without modelRouter", () => {
      const result = createRunTool({});
      expect(result).toBe(null);
    });

    it("returns null for invalid modelRouter", () => {
      const result = createRunTool({ modelRouter: {} });
      expect(result).toBe(null);
    });

    it("returns null for non-function call", () => {
      const result = createRunTool({ modelRouter: { call: "not a function" } });
      expect(result).toBe(null);
    });

    it("returns function for valid modelRouter", () => {
      const modelRouter = { call: async () => ({}) };
      const runTool = createRunTool({ modelRouter });
      expect(typeof runTool).toBe("function");
    });

    it("throws for unknown tool", async () => {
      const modelRouter = { call: async () => ({}) };
      const runTool = createRunTool({ modelRouter });
      await expect(() => runTool("unknown_tool", {}),
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
      expect(calledWith).toBeTruthy();
      expect(calledWith.taskType).toBe("tool_call");
      expect(result).toEqual({ mergedClaims: [] });
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
      expect(calledWith).toBeTruthy();
      expect(result).toEqual({ conflicts: [] });
    });

    it("handles non-string content", async () => {
      const modelRouter = {
        call: async () => ({ content: { already: "parsed" } }),
      };
      const runTool = createRunTool({ modelRouter });
      const result = await runTool("synthesize_claims", { claims: [] });
      expect(result).toEqual({ already: "parsed" });
    });

    it("logs and rethrows on error", async () => {
      let warned = false;
      const logger = { warn: () => { warned = true; } };
      const modelRouter = {
        call: async () => { throw new Error("API error"); },
      };
      const runTool = createRunTool({ modelRouter, logger });
      await expect(() => runTool("synthesize_claims", { claims: [] }),
        /API error/
      );
      expect(warned).toBeTruthy();
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
      expect(passedSignal).toBe(controller.signal);
    });
  });
});
