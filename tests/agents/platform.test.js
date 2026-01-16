
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Platform, isNodeLike } from "../../js/agents/shared/platform.js";

describe("shared/platform", () => {
  describe("Platform", () => {
    it("exports Platform object", () => {
      expect(Platform).toBeTruthy();
      expect(typeof Platform.runtime === "string").toBeTruthy();
    });

    it("has runtime property", () => {
      expect(["node", "bun", "deno", "browser", "unknown"].includes(Platform.runtime)).toBeTruthy();
    });

    it("has boolean flags", () => {
      expect(typeof Platform.isNode).toBe("boolean");
      expect(typeof Platform.isBun).toBe("boolean");
      expect(typeof Platform.isDeno).toBe("boolean");
      expect(typeof Platform.isBrowser).toBe("boolean");
    });

    it("detects Node.js in test environment", () => {
      // In Node.js test environment, should detect as node
      expect(Platform.isNode || Platform.isBun).toBeTruthy();
      expect(Platform.isBrowser).toBe(false);
    });
  });

  describe("isNodeLike", () => {
    it("returns boolean", () => {
      const result = isNodeLike();
      expect(typeof result).toBe("boolean");
    });

    it("returns true in Node.js test environment", () => {
      // Running in Node.js, should return true
      expect(isNodeLike()).toBeTruthy();
    });
  });
});
