import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateRpcRequest,
  validateRpcResponse,
} from "../../js/agents/shared/contracts/rpc-message.js";

describe("shared/contracts/rpc-message", () => {
  describe("validateRpcRequest", () => {
    it("validates valid request", () => {
      const result = validateRpcRequest({
        type: "test",
        payload: { data: 1 },
        requestId: "abc123",
      });
      assert.ok(result.ok);
      assert.equal(result.value.type, "test");
      assert.deepEqual(result.value.payload, { data: 1 });
      assert.equal(result.value.requestId, "abc123");
    });

    it("trims type", () => {
      const result = validateRpcRequest({ type: "  test  ", payload: null });
      assert.ok(result.ok);
      assert.equal(result.value.type, "test");
    });

    it("rejects null", () => {
      const result = validateRpcRequest(null);
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("expected object"));
    });

    it("rejects non-object", () => {
      const result = validateRpcRequest("string");
      assert.equal(result.ok, false);
    });

    it("rejects missing type", () => {
      const result = validateRpcRequest({ payload: {} });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("type"));
    });

    it("rejects empty type", () => {
      const result = validateRpcRequest({ type: "   ", payload: {} });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("type"));
    });

    it("rejects non-string type", () => {
      const result = validateRpcRequest({ type: 123, payload: {} });
      assert.equal(result.ok, false);
    });

    it("handles undefined requestId", () => {
      const result = validateRpcRequest({ type: "test", payload: {} });
      assert.ok(result.ok);
      assert.equal(result.value.requestId, undefined);
    });

    it("handles non-string requestId", () => {
      const result = validateRpcRequest({ type: "test", payload: {}, requestId: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.requestId, undefined);
    });
  });

  describe("validateRpcResponse", () => {
    it("validates valid response", () => {
      const result = validateRpcResponse({
        ok: true,
        data: { result: "success" },
        requestId: "abc123",
      });
      assert.ok(result.ok);
      assert.equal(result.value.ok, true);
      assert.deepEqual(result.value.data, { result: "success" });
    });

    it("validates failure response", () => {
      const result = validateRpcResponse({
        ok: false,
        error: "Something went wrong",
      });
      assert.ok(result.ok);
      assert.equal(result.value.ok, false);
      assert.equal(result.value.error, "Something went wrong");
    });

    it("defaults ok to true when missing", () => {
      const result = validateRpcResponse({ data: "test" });
      assert.ok(result.ok);
      assert.equal(result.value.ok, true);
    });

    it("rejects null", () => {
      const result = validateRpcResponse(null);
      assert.equal(result.ok, false);
    });

    it("rejects non-object", () => {
      const result = validateRpcResponse("string");
      assert.equal(result.ok, false);
    });

    it("handles non-string error", () => {
      const result = validateRpcResponse({ ok: false, error: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.error, undefined);
    });

    it("handles non-string requestId", () => {
      const result = validateRpcResponse({ ok: true, requestId: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.requestId, undefined);
    });
  });
});
