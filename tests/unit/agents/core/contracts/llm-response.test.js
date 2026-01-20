/**
 * Unit tests for LLM response contracts to validate tool call and response parsing.
 * Covers boundary inputs, type mismatches, concurrency, and large payload handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedRandomBytes = vi.hoisted(() => vi.fn((size = 16) => Buffer.alloc(size, 120)));

vi.mock("node:crypto", () => ({
  randomBytes: mockedRandomBytes
}));

import { randomBytes } from "node:crypto";
import { validateToolCall, validateLlmResponse } from '../../../../../js/agents/core/contracts/llm-response.js';

beforeEach(() => {
  mockedRandomBytes.mockClear();
});

const makeDeepObject = (depth) => {
  let node = { leaf: true };
  for (let i = 0; i < depth; i++) {
    node = { level: i, child: node };
  }
  return node;
};

const makeLargeString = (size) => randomBytes(size).toString("utf8");

describe("validateToolCall", () => {
  it("rejects non-object values", () => {
    const inputs = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const input of inputs) {
      expect(validateToolCall(input)).toEqual({ ok: false, error: "toolCall: expected object" });
    }
  });

  it("rejects missing or blank names", () => {
    const inputs = [{}, { name: "" }, { name: "   " }, [], { name: 0 }];

    for (const input of inputs) {
      expect(validateToolCall(input)).toEqual({ ok: false, error: "toolCall.name: required non-empty string" });
    }
  });

  it("ignores non-number index when formatting errors", () => {
    const result = validateToolCall({}, "0");

    expect(result).toEqual({ ok: false, error: "toolCall.name: required non-empty string" });
  });

  it("rejects invalid args types", () => {
    expect(validateToolCall({ name: "tool", args: [] }, 0)).toEqual({
      ok: false,
      error: "toolCalls[0].args: expected object"
    });
    expect(validateToolCall({ name: "tool", args: "bad" })).toEqual({
      ok: false,
      error: "toolCall.args: expected object"
    });
  });

  it("allows null args and ignores non-string id", () => {
    const result = validateToolCall({ name: "tool", args: null, id: 123 });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "tool",
        args: undefined,
        id: undefined
      }
    });
  });

  it("trims name and preserves args with boundary values", () => {
    const deepArgs = makeDeepObject(40);
    const args = {
      count: 0,
      negative: -1,
      max: Number.MAX_SAFE_INTEGER,
      numericString: "0",
      deep: deepArgs,
      empty: {}
    };

    const result = validateToolCall({ name: "  tool  ", args, id: "id-1" });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ name: "tool", args, id: "id-1" });
    expect(result.value.args).toBe(args);
  });
});

describe("validateLlmResponse", () => {
  it("rejects non-object responses", () => {
    const inputs = [null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const input of inputs) {
      expect(validateLlmResponse(input)).toEqual({ ok: false, error: "LlmResponse: expected object" });
    }
  });

  it("rejects toolCalls when not an array", () => {
    expect(validateLlmResponse({ toolCalls: {} })).toEqual({
      ok: false,
      error: "LlmResponse.toolCalls: expected array"
    });
    expect(validateLlmResponse({ toolCalls: "not-array" })).toEqual({
      ok: false,
      error: "LlmResponse.toolCalls: expected array"
    });
  });

  it("propagates toolCall validation errors with index", () => {
    expect(validateLlmResponse({ toolCalls: [{ name: "" }] })).toEqual({
      ok: false,
      error: "toolCalls[0].name: required non-empty string"
    });
  });

  it("accepts content and stopReason strings while ignoring non-strings", () => {
    const withStop = validateLlmResponse({ content: "hello", stopReason: "stop" });
    expect(withStop).toEqual({
      ok: true,
      value: {
        content: "hello",
        toolCalls: undefined,
        stopReason: "stop"
      }
    });

    const withNumericStop = validateLlmResponse({ content: "hello", stopReason: 0 });
    expect(withNumericStop).toEqual({
      ok: true,
      value: {
        content: "hello",
        toolCalls: undefined,
        stopReason: undefined
      }
    });
  });

  it("tolerates empty responses and empty toolCalls", () => {
    expect(validateLlmResponse({})).toEqual({
      ok: true,
      value: {
        content: undefined,
        toolCalls: undefined,
        stopReason: undefined
      }
    });
    expect(validateLlmResponse({ content: "" })).toEqual({
      ok: true,
      value: {
        content: "",
        toolCalls: undefined,
        stopReason: undefined
      }
    });
    expect(validateLlmResponse({ toolCalls: [] })).toEqual({
      ok: true,
      value: {
        content: undefined,
        toolCalls: [],
        stopReason: undefined
      }
    });
  });

  it("normalizes toolCalls entries", () => {
    const result = validateLlmResponse({
      toolCalls: [
        { name: "  ping  ", args: { count: 0 }, id: 123 },
        { name: "pong", args: null }
      ],
      stopReason: "tool_calls"
    });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      content: undefined,
      toolCalls: [
        { name: "ping", args: { count: 0 }, id: undefined },
        { name: "pong", args: undefined, id: undefined }
      ],
      stopReason: "tool_calls"
    });
  });

  it("handles large content, long names, and deep args", () => {
    const largeContent = makeLargeString(1024 * 256);
    const longName = `tool-${"a".repeat(10000)}`;
    const deepArgs = makeDeepObject(60);

    const result = validateLlmResponse({
      content: largeContent,
      toolCalls: [
        {
          name: longName,
          args: {
            deep: deepArgs,
            countText: "0"
          }
        }
      ]
    });

    expect(mockedRandomBytes).toHaveBeenCalledWith(1024 * 256);
    expect(result.ok).toBe(true);
    expect(result.value.content).toBe(largeContent);
    expect(result.value.toolCalls).toHaveLength(1);
    expect(result.value.toolCalls[0].name).toBe(longName);
    expect(result.value.toolCalls[0].args.deep).toEqual(deepArgs);
  });

  it("supports concurrent validations", async () => {
    const responses = Array.from({ length: 25 }, (_, index) => ({
      content: `msg-${index}`,
      toolCalls: [{ name: `tool-${index}`, args: { index } }]
    }));

    const results = await Promise.all(
      responses.map((response) => Promise.resolve(validateLlmResponse(response)))
    );

    expect(results).toHaveLength(responses.length);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].ok).toBe(true);
      expect(results[i].value.content).toBe(`msg-${i}`);
      expect(results[i].value.toolCalls[0].name).toBe(`tool-${i}`);
    }
  });

  it("supports rapid sequential validations", () => {
    const results = [];

    for (let i = 0; i < 50; i++) {
      results.push(
        validateLlmResponse({
          content: `fast-${i}`,
          toolCalls: [{ name: "tool", args: { counter: i } }]
        })
      );
    }

    for (let i = 0; i < results.length; i++) {
      expect(results[i].ok).toBe(true);
      expect(results[i].value.content).toBe(`fast-${i}`);
      expect(results[i].value.toolCalls[0].args.counter).toBe(i);
    }
  });
});
