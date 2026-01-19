import { describe, it, expect } from "vitest";

import { validateRpcRequest, validateRpcResponse } from '../../../../js/agents/shared/contracts/rpc-message.js';
import { validateToolCall, validateLlmResponse } from '../../../../js/agents/shared/contracts/llm-response.js';

describe("shared/contracts/rpc-message", () => {
  it("validateRpcRequest: rejects non-object and missing/blank type", () => {
    expect(validateRpcRequest(null)).toEqual({ ok: false, error: "RpcRequest: expected object" });
    expect(validateRpcRequest("nope")).toEqual({ ok: false, error: "RpcRequest: expected object" });

    expect(validateRpcRequest({})).toEqual({ ok: false, error: "RpcRequest.type: required non-empty string" });
    expect(validateRpcRequest({ type: "   ", payload: 1 })).toEqual({
      ok: false,
      error: "RpcRequest.type: required non-empty string",
    });
  });

  it("validateRpcRequest: trims type and preserves payload + optional requestId", () => {
    const out = validateRpcRequest({ type: " ping ", payload: { ok: true }, requestId: "req_1" });
    expect(out.ok).toBe(true);
    expect(out).toEqual({
      ok: true,
      value: { type: "ping", payload: { ok: true }, requestId: "req_1" },
    });

    // Non-string requestId is ignored.
    const out2 = validateRpcRequest({ type: "pong", payload: 123, requestId: 42 });
    expect(out2.ok).toBe(true);
    expect(out2.value.requestId).toBeUndefined();
  });

  it("validateRpcResponse: defaults ok=true and normalizes optional fields", () => {
    expect(validateRpcResponse(null)).toEqual({ ok: false, error: "RpcResponse: expected object" });

    const legacy = validateRpcResponse({ data: { x: 1 } });
    expect(legacy.ok).toBe(true);
    expect(legacy.value).toEqual({ ok: true, data: { x: 1 }, error: undefined, requestId: undefined });

    const err = validateRpcResponse({ ok: false, error: "boom", requestId: "r1", data: { any: "thing" } });
    expect(err.ok).toBe(true);
    expect(err.value.ok).toBe(false);
    expect(err.value.error).toBe("boom");
    expect(err.value.requestId).toBe("r1");

    // Non-string optional fields are ignored.
    const out = validateRpcResponse({ ok: true, error: 1, requestId: {} });
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ ok: true, data: undefined, error: undefined, requestId: undefined });
  });
});

describe("shared/contracts/llm-response", () => {
  it("validateToolCall: validates object/name/args and trims name", () => {
    expect(validateToolCall(null)).toEqual({ ok: false, error: "toolCall: expected object" });
    expect(validateToolCall({})).toEqual({ ok: false, error: "toolCall.name: required non-empty string" });

    expect(validateToolCall({ name: "  ", args: {} })).toEqual({
      ok: false,
      error: "toolCall.name: required non-empty string",
    });

    // args must be a plain object when provided
    expect(validateToolCall({ name: "x", args: [] })).toEqual({ ok: false, error: "toolCall.args: expected object" });
    expect(validateToolCall({ name: "x", args: 1 })).toEqual({ ok: false, error: "toolCall.args: expected object" });

    expect(validateToolCall({ name: "  tool  ", args: { a: 1 }, id: "tc_1" })).toEqual({
      ok: true,
      value: { name: "tool", args: { a: 1 }, id: "tc_1" },
    });

    // args:null/undefined is tolerated and normalized to undefined.
    expect(validateToolCall({ name: "tool", args: null }).ok).toBe(true);
    expect(validateToolCall({ name: "tool", args: null }).value.args).toBeUndefined();
  });

  it("validateLlmResponse: validates toolCalls array and propagates indexed errors", () => {
    expect(validateLlmResponse(null)).toEqual({ ok: false, error: "LlmResponse: expected object" });
    expect(validateLlmResponse({ toolCalls: {} })).toEqual({ ok: false, error: "LlmResponse.toolCalls: expected array" });

    const bad = validateLlmResponse({ toolCalls: [{ name: "ok" }, null] });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("toolCalls[1]: expected object");
  });

  it("validateLlmResponse: returns parsed content/toolCalls/stopReason and tolerates empty response", () => {
    const out = validateLlmResponse({
      content: "hello",
      stopReason: "eos",
      toolCalls: [{ name: "  search  ", args: { q: "x" } }],
    });
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({
      content: "hello",
      stopReason: "eos",
      toolCalls: [{ name: "search", args: { q: "x" }, id: undefined }],
    });

    // "Empty" responses are allowed (lenient mode) and should still validate.
    const empty = validateLlmResponse({});
    expect(empty.ok).toBe(true);
    expect(empty.value).toEqual({ content: undefined, toolCalls: undefined, stopReason: undefined });
  });
});
