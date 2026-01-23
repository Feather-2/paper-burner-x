
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  validateToolCall,
  validateLlmResponse,
} from '../../../js/agents/core/contracts/llm-response.js';

describe("shared/contracts/llm-response", () => {
  describe("validateToolCall", () => {
    it("validates valid tool call", () => {
      const result = validateToolCall({
        name: "readFile",
        args: { path: "/test.txt" },
        id: "call_123",
      });
      expect(result.ok).toBe(true);
      expect(result.value.name).toBe("readFile");
      expect(result.value.args).toEqual({ path: "/test.txt" });
      expect(result.value.id).toBe("call_123");
    });

    it("trims name", () => {
      const result = validateToolCall({ name: "  readFile  " });
      expect(result.ok).toBe(true);
      expect(result.value.name).toBe("readFile");
    });

    it("rejects null", () => {
      const result = validateToolCall(null);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("expected object");
    });

    it("rejects non-object", () => {
      const result = validateToolCall("string");
      expect(result.ok).toBe(false);
    });

    it("rejects missing name", () => {
      const result = validateToolCall({ args: {} });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("name");
    });

    it("rejects empty name", () => {
      const result = validateToolCall({ name: "   " });
      expect(result.ok).toBe(false);
    });

    it("rejects non-string name", () => {
      const result = validateToolCall({ name: 123 });
      expect(result.ok).toBe(false);
    });

    it("handles undefined args", () => {
      const result = validateToolCall({ name: "test" });
      expect(result.ok).toBe(true);
      expect(result.value.args).toBe(undefined);
    });

    it("handles null args", () => {
      const result = validateToolCall({ name: "test", args: null });
      expect(result.ok).toBe(true);
      expect(result.value.args).toBe(undefined);
    });

    it("rejects array args", () => {
      const result = validateToolCall({ name: "test", args: [1, 2, 3] });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("args");
    });

    it("rejects non-object args", () => {
      const result = validateToolCall({ name: "test", args: "string" });
      expect(result.ok).toBe(false);
    });

    it("includes index in error", () => {
      const result = validateToolCall(null, 5);
      expect(result.error).toContain("toolCalls[5]");
    });

    it("handles undefined id", () => {
      const result = validateToolCall({ name: "test" });
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe(undefined);
    });

    it("handles non-string id", () => {
      const result = validateToolCall({ name: "test", id: 123 });
      expect(result.ok).toBe(true);
      expect(result.value.id).toBe(undefined);
    });
  });

  describe("validateLlmResponse", () => {
    it("validates response with content", () => {
      const result = validateLlmResponse({
        content: "Hello world",
        stopReason: "end_turn",
      });
      expect(result.ok).toBe(true);
      expect(result.value.content).toBe("Hello world");
      expect(result.value.stopReason).toBe("end_turn");
    });

    it("validates response with tool calls", () => {
      const result = validateLlmResponse({
        toolCalls: [{ name: "test", args: {} }],
      });
      expect(result.ok).toBe(true);
      expect(result.value.toolCalls.length).toBe(1);
      expect(result.value.toolCalls[0].name).toBe("test");
    });

    it("validates response with both content and tool calls", () => {
      const result = validateLlmResponse({
        content: "Let me help",
        toolCalls: [{ name: "readFile" }],
      });
      expect(result.ok).toBe(true);
      expect(result.value.content).toBe("Let me help");
      expect(result.value.toolCalls.length).toBe(1);
    });

    it("rejects null", () => {
      const result = validateLlmResponse(null);
      expect(result.ok).toBe(false);
    });

    it("rejects non-object", () => {
      const result = validateLlmResponse("string");
      expect(result.ok).toBe(false);
    });

    it("handles non-string content", () => {
      const result = validateLlmResponse({ content: 123 });
      expect(result.ok).toBe(true);
      expect(result.value.content).toBe(undefined);
    });

    it("handles non-string stopReason", () => {
      const result = validateLlmResponse({ content: "test", stopReason: 123 });
      expect(result.ok).toBe(true);
      expect(result.value.stopReason).toBe(undefined);
    });

    it("rejects non-array toolCalls", () => {
      const result = validateLlmResponse({ toolCalls: "not array" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("toolCalls");
    });

    it("rejects invalid tool call in array", () => {
      const result = validateLlmResponse({
        toolCalls: [{ name: "valid" }, { name: "" }],
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("toolCalls[1]");
    });

    it("accepts empty response", () => {
      const result = validateLlmResponse({});
      expect(result.ok).toBe(true);
      expect(result.value.content).toBe(undefined);
      expect(result.value.toolCalls).toBe(undefined);
    });
  });
});
