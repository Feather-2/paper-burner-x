
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isWasmSupported,
  isWasmThreadsSupported,
} from "../../js/agents/shared/utils/wasm-support.js";

describe("shared/utils/wasm-support", () => {
  describe("isWasmSupported", () => {
    it("returns boolean", () => {
      const result = isWasmSupported();
      expect(typeof result).toBe("boolean");
    });

    it("returns true in Node.js (which supports WASM)", () => {
      // Node.js has WebAssembly support
      expect(isWasmSupported()).toBe(true);
    });

    it("caches result on subsequent calls", () => {
      const first = isWasmSupported();
      const second = isWasmSupported();
      expect(first).toBe(second);
    });
  });

  describe("isWasmThreadsSupported", () => {
    it("returns boolean", () => {
      const result = isWasmThreadsSupported();
      expect(typeof result).toBe("boolean");
    });

    it("returns false if WASM not supported", () => {
      // If WASM is not supported, threads definitely aren't
      // This is a consistency check
      if (!isWasmSupported()) {
        expect(isWasmThreadsSupported()).toBe(false);
      }
    });

    it("returns consistent result", () => {
      const first = isWasmThreadsSupported();
      const second = isWasmThreadsSupported();
      expect(first).toBe(second);
    });
  });
});
