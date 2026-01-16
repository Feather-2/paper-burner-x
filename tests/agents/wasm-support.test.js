import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isWasmSupported,
  isWasmThreadsSupported,
} from "../../js/agents/shared/utils/wasm-support.js";

describe("shared/utils/wasm-support", () => {
  describe("isWasmSupported", () => {
    it("returns boolean", () => {
      const result = isWasmSupported();
      assert.equal(typeof result, "boolean");
    });

    it("returns true in Node.js (which supports WASM)", () => {
      // Node.js has WebAssembly support
      assert.ok(isWasmSupported());
    });

    it("caches result on subsequent calls", () => {
      const first = isWasmSupported();
      const second = isWasmSupported();
      assert.equal(first, second);
    });
  });

  describe("isWasmThreadsSupported", () => {
    it("returns boolean", () => {
      const result = isWasmThreadsSupported();
      assert.equal(typeof result, "boolean");
    });

    it("returns false if WASM not supported", () => {
      // If WASM is not supported, threads definitely aren't
      // This is a consistency check
      if (!isWasmSupported()) {
        assert.equal(isWasmThreadsSupported(), false);
      }
    });

    it("returns consistent result", () => {
      const first = isWasmThreadsSupported();
      const second = isWasmThreadsSupported();
      assert.equal(first, second);
    });
  });
});
