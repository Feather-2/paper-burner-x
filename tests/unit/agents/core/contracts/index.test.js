/**
 * @file tests/unit/agents/core/contracts/index.test.js
 * @description Unit tests for contracts index exports.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  rpc: { actual: null },
  llm: { actual: null },
  tool: { actual: null },
}));

vi.mock("../../../../../js/agents/core/contracts/rpc-message.js", async (importOriginal) => {
  const actual = await importOriginal();
  mockState.rpc.actual = actual;
  return {
    ...actual,
    validateRpcRequest: vi.fn(actual.validateRpcRequest),
    validateRpcResponse: vi.fn(actual.validateRpcResponse),
  };
});

vi.mock("../../../../../js/agents/core/contracts/llm-response.js", async (importOriginal) => {
  const actual = await importOriginal();
  mockState.llm.actual = actual;
  return {
    ...actual,
    validateLlmResponse: vi.fn(actual.validateLlmResponse),
    validateToolCall: vi.fn(actual.validateToolCall),
  };
});

vi.mock("../../../../../js/agents/core/contracts/tool-result.js", async (importOriginal) => {
  const actual = await importOriginal();
  mockState.tool.actual = actual;
  return {
    ...actual,
    validateToolResult: vi.fn(actual.validateToolResult),
    normalizeToolResult: vi.fn(actual.normalizeToolResult),
  };
});

import {
  validateRpcRequest,
  validateRpcResponse,
  validateLlmResponse,
  validateToolCall,
  validateToolResult,
  normalizeToolResult,
  isDisposable,
  safeDispose,
  disposeAll,
  using,
  createCompositeDisposable,
} from "../../../../../js/agents/core/contracts/index.js";
import * as disposableExports from "../../../../../js/agents/core/contracts/disposable.js";

const LONG_TEXT = "x".repeat(120000);
const LARGE_TEXT = "y".repeat(300000);

const createDeepNested = (depth) => {
  let node = { level: 0 };
  for (let i = 1; i <= depth; i++) {
    node = { level: i, child: node };
  }
  return node;
};

const DEEP_NESTED = createDeepNested(50);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateRpcRequest", () => {
  it("accepts valid request and normalizes type/requestId", () => {
    const input = { type: " core:ping ", payload: { a: 1 }, requestId: "req-1" };
    const result = validateRpcRequest(input);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      type: "core:ping",
      payload: { a: 1 },
      requestId: "req-1",
    });
  });

  it("rejects non-object inputs (null/undefined/empty string/number)", () => {
    const cases = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER];
    for (const value of cases) {
      const result = validateRpcRequest(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("RpcRequest: expected object");
    }
  });

  it("rejects empty object or array without type", () => {
    const cases = [{}, []];
    for (const value of cases) {
      const result = validateRpcRequest(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("RpcRequest.type: required non-empty string");
    }
  });

  it("rejects whitespace or invalid type format (string-as-number)", () => {
    const cases = [
      { type: "   ", payload: 1, error: "RpcRequest.type: required non-empty string" },
      { type: "invalid", payload: 1, error: "RpcRequest.type: must be domain:action format" },
      { type: "123", payload: 1, error: "RpcRequest.type: must be domain:action format" },
      { type: "Core:ping", payload: 1, error: "RpcRequest.type: must be domain:action format" },
    ];

    for (const { type, payload, error } of cases) {
      const result = validateRpcRequest({ type, payload });
      expect(result.ok).toBe(false);
      expect(result.error).toBe(error);
    }
  });

  it("only includes requestId when it is a string", () => {
    const result = validateRpcRequest({ type: "core:ping", payload: 0, requestId: 123 });

    expect(result.ok).toBe(true);
    expect(result.value.requestId).toBeUndefined();
  });

  it("handles concurrent validations consistently", async () => {
    const inputs = [
      { type: "core:ping", payload: { v: 1 } },
      { type: "core:ping", payload: { v: 2 }, requestId: "r2" },
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve(validateRpcRequest(input)))
    );

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    expect(results[0].value.payload).toEqual({ v: 1 });
    expect(results[1].value.requestId).toBe("r2");
  });
});

describe("validateRpcResponse", () => {
  it("defaults ok to true and normalizes optional fields", () => {
    const result = validateRpcResponse({});

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(true);
    expect(result.value.data).toBeUndefined();
    expect(result.value.error).toBeUndefined();
    expect(result.value.requestId).toBeUndefined();
  });

  it("propagates explicit failure and error message", () => {
    const result = validateRpcResponse({
      ok: false,
      error: "bad",
      data: { a: 1 },
      requestId: "req-1",
    });

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(false);
    expect(result.value.error).toBe("bad");
    expect(result.value.data).toEqual({ a: 1 });
    expect(result.value.requestId).toBe("req-1");
  });

  it("treats non-false ok values as success and ignores non-string fields", () => {
    const result = validateRpcResponse({ ok: 0, error: 123, requestId: -1 });

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(true);
    expect(result.value.error).toBeUndefined();
    expect(result.value.requestId).toBeUndefined();
  });

  it("rejects non-object inputs", () => {
    const cases = [null, undefined, "", 0];
    for (const value of cases) {
      const result = validateRpcResponse(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("RpcResponse: expected object");
    }
  });

  it("rejects array responses to enforce object-only contract", () => {
    const result = validateRpcResponse([]);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("RpcResponse: expected object");
  });
});

describe("validateToolCall", () => {
  it("accepts valid tool call and trims name", () => {
    const input = { name: "  tool.name  ", args: { a: 1 }, id: "id-1" };
    const result = validateToolCall(input, 0);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      name: "tool.name",
      args: { a: 1 },
      id: "id-1",
    });
  });

  it("rejects non-object inputs", () => {
    const cases = [null, undefined, ""];
    for (const value of cases) {
      const result = validateToolCall(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("toolCall: expected object");
    }
  });

  it("rejects empty or whitespace name", () => {
    const cases = ["", "   "];
    for (const name of cases) {
      const result = validateToolCall({ name });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("toolCall.name: required non-empty string");
    }
  });

  it("rejects args when not a plain object", () => {
    const cases = [[], "bad args"];
    for (const args of cases) {
      const result = validateToolCall({ name: "tool", args }, 2);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("toolCalls[2].args: expected object");
    }
  });

  it("allows null or undefined args", () => {
    const cases = [null, undefined];
    for (const args of cases) {
      const result = validateToolCall({ name: "tool", args });
      expect(result.ok).toBe(true);
      expect(result.value.args).toBeUndefined();
    }
  });

  it("uses generic prefix when index is not a number (string-as-number boundary)", () => {
    const result = validateToolCall(null, "1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("toolCall: expected object");
  });
});

describe("validateLlmResponse", () => {
  it("accepts content and stopReason", () => {
    const result = validateLlmResponse({ content: "hello", stopReason: "stop" });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ content: "hello", toolCalls: undefined, stopReason: "stop" });
  });

  it("accepts toolCalls array and normalizes entries", () => {
    const result = validateLlmResponse({
      toolCalls: [{ name: "  tool  ", args: { x: 1 }, id: "id-1" }],
    });

    expect(result.ok).toBe(true);
    expect(result.value.toolCalls).toHaveLength(1);
    expect(result.value.toolCalls[0]).toEqual({
      name: "tool",
      args: { x: 1 },
      id: "id-1",
    });
  });

  it("rejects non-object response", () => {
    const cases = [null, undefined];
    for (const value of cases) {
      const result = validateLlmResponse(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("LlmResponse: expected object");
    }
  });

  it("rejects toolCalls when not an array (object-as-array boundary)", () => {
    const result = validateLlmResponse({ toolCalls: {} });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("LlmResponse.toolCalls: expected array");
  });

  it("propagates tool call validation errors with index", () => {
    const result = validateLlmResponse({ toolCalls: [{ name: "" }] });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("toolCalls[0].name: required non-empty string");
  });

  it("allows empty content and empty toolCalls", () => {
    const result = validateLlmResponse({ content: "", toolCalls: [] });

    expect(result.ok).toBe(true);
    expect(result.value.content).toBe("");
    expect(result.value.toolCalls).toEqual([]);
  });

  it("handles long content strings and deep nested args", () => {
    const result = validateLlmResponse({
      content: LONG_TEXT,
      toolCalls: [{ name: "deep", args: DEEP_NESTED }],
    });

    expect(result.ok).toBe(true);
    expect(result.value.content.length).toBe(LONG_TEXT.length);
    expect(result.value.toolCalls[0].args).toBe(DEEP_NESTED);
  });
});

describe("validateToolResult", () => {
  it("normalizes ok and success when ok is true", () => {
    const result = validateToolResult({ ok: true, data: { a: 1 } });

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(true);
    expect(result.value.success).toBe(true);
    expect(result.value.data).toEqual({ a: 1 });
  });

  it("treats explicit failure as ok false", () => {
    const result = validateToolResult({ success: false, error: "bad" });

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(false);
    expect(result.value.success).toBe(false);
    expect(result.value.error).toBe("bad");
  });

  it("accepts deep nested meta object and ignores array meta", () => {
    const okWithMeta = validateToolResult({ ok: true, meta: DEEP_NESTED });
    const okWithArrayMeta = validateToolResult({ ok: true, meta: [] });

    expect(okWithMeta.ok).toBe(true);
    expect(okWithMeta.value.meta).toBe(DEEP_NESTED);
    expect(okWithArrayMeta.value.meta).toBeUndefined();
  });

  it("rejects non-object inputs", () => {
    const cases = [null, undefined];
    for (const value of cases) {
      const result = validateToolResult(value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("ToolResult: expected object");
    }
  });

  it("handles empty object as failure result", () => {
    const result = validateToolResult({});

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(false);
    expect(result.value.success).toBe(false);
  });

  it("treats string flags as false (type boundary)", () => {
    const result = validateToolResult({ ok: "true", success: "false" });

    expect(result.ok).toBe(true);
    expect(result.value.ok).toBe(false);
    expect(result.value.success).toBe(false);
  });
});

describe("normalizeToolResult", () => {
  it("returns validated tool result when ok/success present", () => {
    const result = normalizeToolResult({ ok: true, data: 1 });

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.data).toBe(1);
  });

  it("treats error-only object as failure and keeps meta", () => {
    const result = normalizeToolResult({ error: "boom", data: 1, meta: { tag: "x" } });

    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(result.data).toBe(1);
    expect(result.meta).toEqual({ tag: "x" });
  });

  it("treats data-only object as success and ignores array meta", () => {
    const result = normalizeToolResult({ data: 2, meta: [] });

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.data).toBe(2);
    expect(result.meta).toBeUndefined();
  });

  it("normalizes Error instances", () => {
    const result = normalizeToolResult(new Error("nope"));

    expect(result.ok).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toBe("nope");
    expect(result.data).toBeUndefined();
  });

  it("normalizes null/undefined to success with null data", () => {
    const cases = [null, undefined];
    for (const value of cases) {
      const result = normalizeToolResult(value);
      expect(result.ok).toBe(true);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    }
  });

  it("wraps primitive values as data", () => {
    const result = normalizeToolResult(0);

    expect(result.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.data).toBe(0);
  });

  it("handles large payloads and rapid consecutive calls", () => {
    const results = [];
    for (let i = 0; i < 25; i++) {
      results.push(normalizeToolResult(LARGE_TEXT));
    }

    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(LARGE_TEXT.length);
    }
  });
});

describe("contracts index disposable re-exports", () => {
  it("re-exports disposable helpers from canonical index entry", () => {
    expect(isDisposable).toBe(disposableExports.isDisposable);
    expect(safeDispose).toBe(disposableExports.safeDispose);
    expect(disposeAll).toBe(disposableExports.disposeAll);
    expect(using).toBe(disposableExports.using);
    expect(createCompositeDisposable).toBe(disposableExports.createCompositeDisposable);
  });
});
