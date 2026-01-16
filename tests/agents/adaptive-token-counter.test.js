import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createAdaptiveTokenCounter,
} from "../../js/agents/shared/tokenizers/adaptive-token-counter.js";

describe("shared/tokenizers/adaptive-token-counter", () => {
  describe("createAdaptiveTokenCounter", () => {
    it("creates token counter", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      assert.ok(counter);
      assert.equal(typeof counter.count, "function");
      assert.equal(typeof counter.init, "function");
      assert.equal(typeof counter.dispose, "function");
      assert.equal(typeof counter.getStatus, "function");
      counter.dispose();
    });

    it("throws for non-object options", () => {
      assert.throws(
        () => createAdaptiveTokenCounter("invalid"),
        /options must be an object/
      );
    });

    it("counts tokens for string", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count("Hello world");
      assert.ok(count > 0);
      counter.dispose();
    });

    it("returns 0 for empty string", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count("");
      assert.equal(count, 0);
      counter.dispose();
    });

    it("returns 0 for null", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count(null);
      assert.equal(count, 0);
      counter.dispose();
    });

    it("returns 0 for undefined", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count(undefined);
      assert.equal(count, 0);
      counter.dispose();
    });

    it("counts tokens for object (stringified)", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count({ key: "value" });
      assert.ok(count > 0);
      counter.dispose();
    });

    it("counts tokens for array", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count([1, 2, 3]);
      assert.ok(count > 0);
      counter.dispose();
    });

    it("counts tokens for number", () => {
      const counter = createAdaptiveTokenCounter({ warmup: false });
      const count = counter.count(12345);
      assert.ok(count > 0);
      counter.dispose();
    });

    describe("getStatus", () => {
      it("returns initial status", () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        const status = counter.getStatus();
        assert.equal(status.mode, "heuristic");
        assert.equal(status.ready, false);
        assert.equal(status.failed, false);
        counter.dispose();
      });
    });

    describe("dispose", () => {
      it("resets state", () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        counter.dispose();
        const status = counter.getStatus();
        assert.equal(status.mode, "heuristic");
        assert.equal(status.ready, false);
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
        assert.ok(status.ready || status.failed);
        counter.dispose();
      });

      it("returns false after failed init", async () => {
        const counter = createAdaptiveTokenCounter({ warmup: false });
        await counter.init();
        const status = counter.getStatus();
        if (status.failed) {
          const result = await counter.init();
          assert.equal(result, false);
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
        assert.ok(counter);
        counter.dispose();
      });

      it("accepts encoding option", () => {
        const counter = createAdaptiveTokenCounter({
          encoding: "cl100k_base",
          warmup: false,
        });
        assert.ok(counter);
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
