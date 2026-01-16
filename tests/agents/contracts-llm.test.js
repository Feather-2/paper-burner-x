import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateToolCall,
  validateLlmResponse,
} from "../../js/agents/shared/contracts/llm-response.js";

describe("shared/contracts/llm-response", () => {
  describe("validateToolCall", () => {
    it("validates valid tool call", () => {
      const result = validateToolCall({
        name: "readFile",
        args: { path: "/test.txt" },
        id: "call_123",
      });
      assert.ok(result.ok);
      assert.equal(result.value.name, "readFile");
      assert.deepEqual(result.value.args, { path: "/test.txt" });
      assert.equal(result.value.id, "call_123");
    });

    it("trims name", () => {
      const result = validateToolCall({ name: "  readFile  " });
      assert.ok(result.ok);
      assert.equal(result.value.name, "readFile");
    });

    it("rejects null", () => {
      const result = validateToolCall(null);
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("expected object"));
    });

    it("rejects non-object", () => {
      const result = validateToolCall("string");
      assert.equal(result.ok, false);
    });

    it("rejects missing name", () => {
      const result = validateToolCall({ args: {} });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("name"));
    });

    it("rejects empty name", () => {
      const result = validateToolCall({ name: "   " });
      assert.equal(result.ok, false);
    });

    it("rejects non-string name", () => {
      const result = validateToolCall({ name: 123 });
      assert.equal(result.ok, false);
    });

    it("handles undefined args", () => {
      const result = validateToolCall({ name: "test" });
      assert.ok(result.ok);
      assert.equal(result.value.args, undefined);
    });

    it("handles null args", () => {
      const result = validateToolCall({ name: "test", args: null });
      assert.ok(result.ok);
      assert.equal(result.value.args, undefined);
    });

    it("rejects array args", () => {
      const result = validateToolCall({ name: "test", args: [1, 2, 3] });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("args"));
    });

    it("rejects non-object args", () => {
      const result = validateToolCall({ name: "test", args: "string" });
      assert.equal(result.ok, false);
    });

    it("includes index in error", () => {
      const result = validateToolCall(null, 5);
      assert.ok(result.error.includes("toolCalls[5]"));
    });

    it("handles undefined id", () => {
      const result = validateToolCall({ name: "test" });
      assert.ok(result.ok);
      assert.equal(result.value.id, undefined);
    });

    it("handles non-string id", () => {
      const result = validateToolCall({ name: "test", id: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.id, undefined);
    });
  });

  describe("validateLlmResponse", () => {
    it("validates response with content", () => {
      const result = validateLlmResponse({
        content: "Hello world",
        stopReason: "end_turn",
      });
      assert.ok(result.ok);
      assert.equal(result.value.content, "Hello world");
      assert.equal(result.value.stopReason, "end_turn");
    });

    it("validates response with tool calls", () => {
      const result = validateLlmResponse({
        toolCalls: [{ name: "test", args: {} }],
      });
      assert.ok(result.ok);
      assert.equal(result.value.toolCalls.length, 1);
      assert.equal(result.value.toolCalls[0].name, "test");
    });

    it("validates response with both content and tool calls", () => {
      const result = validateLlmResponse({
        content: "Let me help",
        toolCalls: [{ name: "readFile" }],
      });
      assert.ok(result.ok);
      assert.equal(result.value.content, "Let me help");
      assert.equal(result.value.toolCalls.length, 1);
    });

    it("rejects null", () => {
      const result = validateLlmResponse(null);
      assert.equal(result.ok, false);
    });

    it("rejects non-object", () => {
      const result = validateLlmResponse("string");
      assert.equal(result.ok, false);
    });

    it("handles non-string content", () => {
      const result = validateLlmResponse({ content: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.content, undefined);
    });

    it("handles non-string stopReason", () => {
      const result = validateLlmResponse({ content: "test", stopReason: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.stopReason, undefined);
    });

    it("rejects non-array toolCalls", () => {
      const result = validateLlmResponse({ toolCalls: "not array" });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("toolCalls"));
    });

    it("rejects invalid tool call in array", () => {
      const result = validateLlmResponse({
        toolCalls: [{ name: "valid" }, { name: "" }],
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes("toolCalls[1]"));
    });

    it("accepts empty response", () => {
      const result = validateLlmResponse({});
      assert.ok(result.ok);
      assert.equal(result.value.content, undefined);
      assert.equal(result.value.toolCalls, undefined);
    });
  });
});
