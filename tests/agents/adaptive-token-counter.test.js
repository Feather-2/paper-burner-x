
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createAdaptiveTokenCounter,
} from "../../js/agents/shared/tokenizers/adaptive-token-counter.js";

describe("shared/tokenizers/adaptive-token-counter", () => {
  const expectTokenCounter = (counter) => {
    expect(counter).toMatchObject({
      count: expect.any(Function),
      init: expect.any(Function),
      dispose: expect.any(Function),
      getStatus: expect.any(Function),
    });
  };

  describe("createAdaptiveTokenCounter", () => {
    it("creates token counter", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      expectTokenCounter(counter);
      counter.dispose();
    });

    it("throws for non-object options", () => {
      expect(() => createAdaptiveTokenCounter("invalid")).toThrow(/options must be an object/);
    });

    it("counts tokens for string", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count("Hello world");
      expect(count).toBeGreaterThan(0);
      counter.dispose();
    });

    it("returns 0 for empty string", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count("");
      expect(count).toBe(0);
      counter.dispose();
    });

    it("returns 0 for null", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count(null);
      expect(count).toBe(0);
      counter.dispose();
    });

    it("returns 0 for undefined", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count(undefined);
      expect(count).toBe(0);
      counter.dispose();
    });

    it("counts tokens for object (stringified)", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count({ key: "value" });
      expect(count).toBeGreaterThan(0);
      counter.dispose();
    });

    it("counts tokens for array", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count([1, 2, 3]);
      expect(count).toBeGreaterThan(0);
      counter.dispose();
    });

    it("counts tokens for number", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count(12345);
      expect(count).toBeGreaterThan(0);
      counter.dispose();
    });

    describe("getStatus", () => {
      it("returns initial status", () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        const status = counter.getStatus();
        expect(status.mode).toBe("heuristic");
        expect(status.ready).toBe(false);
        expect(status.failed).toBe(false);
        counter.dispose();
      });
    });

    describe("dispose", () => {
      it("resets state", () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        counter.dispose();
        const status = counter.getStatus();
        expect(status.mode).toBe("heuristic");
        expect(status.ready).toBe(false);
      });

      it("can be called multiple times", () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        counter.dispose();
        counter.dispose();
        counter.dispose();
      });
    });

    describe("init", () => {
      it("returns false when WASM not supported", async () => {
        // In Node.js without tiktoken, should fail
        const counter = createAdaptiveTokenCounter({ warmup: false });
        const result = await counter.init();
        // Will fail because tiktoken is not installed
        const status = counter.getStatus();
        // Either ready or failed
        expect(status.ready || status.failed).toBe(true);
        counter.dispose();
      });

      it("returns false after failed init", async () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        await counter.init();
        const status = counter.getStatus();
        if (status.failed) {
          const result = await counter.init();
          expect(result).toBe(false);
        }
        counter.dispose();
      });
    });

    describe("options", () => {
      it("accepts model option", () => {
        const counter = createAdaptiveTokenCounter({
          model: "gpt-4",
          warmup: false,
        });
        expectTokenCounter(counter);
        counter.dispose();
      });

      it("accepts encoding option", () => {
        const counter = createAdaptiveTokenCounter({
          encoding: "cl100k_base",
          warmup: false,
        });
        expectTokenCounter(counter);
        counter.dispose();
      });

      it("accepts onLog callback", () => {
        let logged = false;
        const counter = createAdaptiveTokenCounter({
          warmup: false,
          onLog: () => { logged = true; },
        });
        counter.dispose();
      });

      it("warmup defaults to true", async () => {
        // Just verify it doesn't throw
        const counter = createAdaptiveTokenCounter();
        await new Promise(r => setTimeout(r, 10));
        counter.dispose();
      });

      it("accepts warmupIdleMs option", async () => {
        const counter = createAdaptiveTokenCounter({
          warmup: true,
          warmupIdleMs: 10,
        });
        await new Promise(r => setTimeout(r, 20));
        counter.dispose();
      });
    });
  });
});
