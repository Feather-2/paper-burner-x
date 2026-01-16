import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Platform, isNodeLike } from "../../js/agents/shared/platform.js";

describe("shared/platform", () => {
  describe("Platform", () => {
    it("exports Platform object", () => {
      assert.ok(Platform);
      assert.ok(typeof Platform.runtime === "string");
    });

    it("has runtime property", () => {
      assert.ok(["node", "bun", "deno", "browser", "unknown"].includes(Platform.runtime));
    });

    it("has boolean flags", () => {
      assert.equal(typeof Platform.isNode, "boolean");
      assert.equal(typeof Platform.isBun, "boolean");
      assert.equal(typeof Platform.isDeno, "boolean");
      assert.equal(typeof Platform.isBrowser, "boolean");
    });

    it("detects Node.js in test environment", () => {
      // In Node.js test environment, should detect as node
      assert.ok(Platform.isNode || Platform.isBun);
      assert.equal(Platform.isBrowser, false);
    });
  });

  describe("isNodeLike", () => {
    it("returns boolean", () => {
      const result = isNodeLike();
      assert.equal(typeof result, "boolean");
    });

    it("returns true in Node.js test environment", () => {
      // Running in Node.js, should return true
      assert.ok(isNodeLike());
    });
  });
});
