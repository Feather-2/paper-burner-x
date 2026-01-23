
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  validateRpcRequest,
  validateRpcResponse,
} from '../../../js/agents/core/contracts/rpc-message.js';

describe("shared/contracts/rpc-message", () => {
  describe("validateRpcRequest", () => {
	    it("validates valid request", () => {
	      const result = validateRpcRequest({
	        type: "test:ping",
	        payload: { data: 1 },
	        requestId: "abc123",
	      });
	      expect(result.ok).toBe(true);
	      expect(result.value.type).toBe("test:ping");
	      expect(result.value.payload).toEqual({ data: 1 });
	      expect(result.value.requestId).toBe("abc123");
	    });

	    it("trims type", () => {
	      const result = validateRpcRequest({ type: "  test:ping  ", payload: null });
	      expect(result.ok).toBe(true);
	      expect(result.value.type).toBe("test:ping");
	    });

    it("rejects null", () => {
      const result = validateRpcRequest(null);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("expected object");
    });

    it("rejects non-object", () => {
      const result = validateRpcRequest("string");
      expect(result.ok).toBe(false);
    });

    it("rejects missing type", () => {
      const result = validateRpcRequest({ payload: {} });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("type");
    });

    it("rejects empty type", () => {
      const result = validateRpcRequest({ type: "   ", payload: {} });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("type");
    });

    it("rejects non-string type", () => {
      const result = validateRpcRequest({ type: 123, payload: {} });
      expect(result.ok).toBe(false);
    });

	    it("handles undefined requestId", () => {
	      const result = validateRpcRequest({ type: "test:ping", payload: {} });
	      expect(result.ok).toBe(true);
	      expect(result.value.requestId).toBeUndefined();
	    });

	    it("handles non-string requestId", () => {
	      const result = validateRpcRequest({ type: "test:ping", payload: {}, requestId: 123 });
	      expect(result.ok).toBe(true);
	      expect(result.value.requestId).toBeUndefined();
	    });
  });

  describe("validateRpcResponse", () => {
    it("validates valid response", () => {
      const result = validateRpcResponse({
        ok: true,
        data: { result: "success" },
        requestId: "abc123",
      });
      expect(result.ok).toBe(true);
      expect(result.value.ok).toBe(true);
      expect(result.value.data).toEqual({ result: "success" });
    });

    it("validates failure response", () => {
      const result = validateRpcResponse({
        ok: false,
        error: "Something went wrong",
      });
      expect(result.ok).toBe(true);
      expect(result.value.ok).toBe(false);
      expect(result.value.error).toBe("Something went wrong");
    });

    it("defaults ok to true when missing", () => {
      const result = validateRpcResponse({ data: "test" });
      expect(result.ok).toBe(true);
      expect(result.value.ok).toBe(true);
    });

    it("rejects null", () => {
      const result = validateRpcResponse(null);
      expect(result.ok).toBe(false);
    });

    it("rejects non-object", () => {
      const result = validateRpcResponse("string");
      expect(result.ok).toBe(false);
    });

    it("handles non-string error", () => {
      const result = validateRpcResponse({ ok: false, error: 123 });
      expect(result.ok).toBe(true);
      expect(result.value.error).toBeUndefined();
    });

    it("handles non-string requestId", () => {
      const result = validateRpcResponse({ ok: true, requestId: 123 });
      expect(result.ok).toBe(true);
      expect(result.value.requestId).toBeUndefined();
    });
  });
});
