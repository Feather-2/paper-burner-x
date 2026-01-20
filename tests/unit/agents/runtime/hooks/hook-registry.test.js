import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import { HookType, HookEvent, HookRegistry } from "../../../../../js/agents/runtime/hooks/hook-registry.js";
import { isPlainObject, toNonEmptyString } from "../../../../../js/agents/shared/index.js";

describe("HookType", () => {
  it("exposes frozen hook types", () => {
    expect(HookType).toEqual({
      COMMAND: "command",
      PROMPT: "prompt",
      AGENT: "agent",
    });
    expect(Object.isFrozen(HookType)).toBe(true);
  });
});

describe("HookEvent", () => {
  it("exposes frozen hook events", () => {
    expect(HookEvent).toEqual({
      PRE_AGENT: "PreAgent",
      POST_AGENT: "PostAgent",
      PRE_LLM_CALL: "PreLLMCall",
      POST_LLM_CALL: "PostLLMCall",
      PRE_TOOL_USE: "PreToolUse",
      POST_TOOL_USE: "PostToolUse",
    });
    expect(Object.isFrozen(HookEvent)).toBe(true);
  });
});

describe("HookRegistry", () => {
  /** @type {HookRegistry} */
  let registry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new HookRegistry();
  });

  describe("constructor", () => {
    it("starts with no hooks", () => {
      expect(registry.list("PreToolUse")).toEqual([]);
      expect(registry.list("Unknown")).toEqual([]);
    });
  });

  describe("register", () => {
    it("registers a command hook with defaults", () => {
      const def = registry.register("PreToolUse", { type: "command" });
      expect(def).toMatchObject({ type: "command", blocking: true });
      expect(registry.list("PreToolUse").length).toBe(1);
    });

    it("trims event names and normalizes type", () => {
      const def = registry.register("  PreToolUse  ", { type: "COMMAND" });
      expect(def.type).toBe("command");
      expect(registry.list("PreToolUse").length).toBe(1);
    });

    it("throws for invalid event names", () => {
      const invalid = ["", "   ", null, undefined];
      for (const eventName of invalid) {
        expect(() => registry.register(eventName, { type: "command" }))
          .toThrow(/eventName must be a non-empty string/);
      }
    });

    it("throws for invalid definitions", () => {
      const invalidDefs = [null, undefined, "nope", [], 42];
      for (const def of invalidDefs) {
        expect(() => registry.register("PreToolUse", def))
          .toThrow(/HookDefinition must be an object/);
      }
    });

    it("throws for missing or invalid type", () => {
      expect(() => registry.register("PreToolUse", {}))
        .toThrow(/type must be one of/);
      expect(() => registry.register("PreToolUse", { type: "" }))
        .toThrow(/type must be one of/);
      expect(() => registry.register("PreToolUse", { type: "invalid" }))
        .toThrow(/type must be one of/);
      expect(() => registry.register("PreToolUse", { type: 0 }))
        .toThrow(/type must be one of/);
    });

    it("normalizes and deduplicates tool patterns", () => {
      const def = registry.register("PreToolUse", {
        type: "command",
        tools: [" bash ", "bash", "exec*", "", "   ", null],
      });
      expect(def.tools).toEqual(["bash", "exec*"]);
    });

    it("honors blocking=false only for boolean false", () => {
      const disabled = registry.register("PreToolUse", {
        type: "command",
        blocking: false,
      });
      const truthy = registry.register("PostToolUse", {
        type: "command",
        blocking: "false",
      });
      const numeric = registry.register("PreAgent", {
        type: "command",
        blocking: 0,
      });
      expect(disabled.blocking).toBe(false);
      expect(truthy.blocking).toBe(true);
      expect(numeric.blocking).toBe(true);
    });

    it("requires prompt for prompt hooks and supports usage alias", () => {
      expect(() => registry.register("PreToolUse", { type: "prompt", prompt: "   " }))
        .toThrow(/prompt is required/);
      const def = registry.register("PreToolUse", {
        type: "prompt",
        prompt: "Check",
        model: "fast",
      });
      expect(def.prompt).toBe("Check");
      expect(def.usage).toBe("fast");
    });

    it("requires agentType for agent hooks and supports aliases", () => {
      expect(() => registry.register("PreToolUse", { type: "agent" }))
        .toThrow(/agentType is required/);
      const def = registry.register("PreToolUse", {
        type: "agent",
        subagent_type: "qa",
        model_tier: "advanced",
        prompt: "Run audit",
      });
      expect(def.agentType).toBe("qa");
      expect(def.modelTier).toBe("advanced");
      expect(def.prompt).toBe("Run audit");
    });

    it("accepts object tool definitions without crashing", () => {
      const def = registry.register("PreToolUse", {
        type: "command",
        tools: { pattern: "bash" },
      });
      expect(def.tools).toEqual(["[object Object]"]);
      const matches = registry.match("PreToolUse", {});
      expect(matches.length).toBe(1);
    });

    it("accepts numeric event names at boundaries", () => {
      registry.register(0, { type: "command" });
      registry.register(-1, { type: "command" });
      registry.register(Number.MAX_SAFE_INTEGER, { type: "command" });
      registry.register("1", { type: "command" });

      expect(registry.list("0").length).toBe(1);
      expect(registry.list("-1").length).toBe(1);
      expect(registry.list(String(Number.MAX_SAFE_INTEGER)).length).toBe(1);
      expect(registry.list(1).length).toBe(1);
    });

    it("calls shared helpers", () => {
      const def = { type: "command" };
      registry.register("PreToolUse", def);
      expect(isPlainObject).toHaveBeenCalledWith(def);
      expect(toNonEmptyString).toHaveBeenCalledWith("PreToolUse");
    });

  });

  describe("list", () => {
    it("returns empty array for nullish or empty event names", () => {
      expect(registry.list(null)).toEqual([]);
      expect(registry.list(undefined)).toEqual([]);
      expect(registry.list("")).toEqual([]);
      expect(registry.list("   ")).toEqual([]);
    });

    it("returns a copy of the hooks list", () => {
      registry.register("PreToolUse", { type: "command" });
      const hooks = registry.list("PreToolUse");
      hooks.push({ type: "agent" });
      expect(registry.list("PreToolUse").length).toBe(1);
    });
  });

  describe("clear", () => {
    it("clears all hooks when eventName is missing or blank", () => {
      registry.register("PreToolUse", { type: "command" });
      registry.register("PostToolUse", { type: "command" });

      registry.clear();
      expect(registry.list("PreToolUse")).toEqual([]);
      expect(registry.list("PostToolUse")).toEqual([]);

      registry.register("PreToolUse", { type: "command" });
      registry.clear("   ");
      expect(registry.list("PreToolUse")).toEqual([]);
    });

    it("clears only the specified event", () => {
      registry.register("PreToolUse", { type: "command" });
      registry.register("PostToolUse", { type: "command" });
      registry.clear("PreToolUse");
      expect(registry.list("PreToolUse")).toEqual([]);
      expect(registry.list("PostToolUse").length).toBe(1);
    });

    it("clears all hooks for nullish event names", () => {
      registry.register("PreToolUse", { type: "command" });
      registry.register("PostToolUse", { type: "command" });
      registry.clear(null);
      expect(registry.list("PreToolUse")).toEqual([]);
      expect(registry.list("PostToolUse")).toEqual([]);
    });
  });

  describe("match", () => {
    it("matches exact and wildcard patterns", () => {
      registry.register("PreToolUse", { type: "command", tools: ["bash", "exec*"] });
      registry.register("PreToolUse", { type: "command", tools: ["*script"] });
      registry.register("PreToolUse", { type: "command", tools: ["*ash*"] });
      registry.register("PreToolUse", { type: "command", tools: ["*"] });
      registry.register("PreToolUse", { type: "command" });

      expect(registry.match("PreToolUse", "bash").length).toBe(4);
      expect(registry.match("PreToolUse", "execute").length).toBe(3);
      expect(registry.match("PreToolUse", "run_script").length).toBe(3);
    });

    it("matches when tools are empty or null", () => {
      registry.register("PreToolUse", { type: "command", tools: [] });
      registry.register("PreToolUse", { type: "command", tools: null });
      registry.register("PreToolUse", { type: "command" });
      const matches = registry.match("PreToolUse", "anything");
      expect(matches.length).toBe(3);
    });

    it("uses tool aliases for matching", () => {
      registry.register("PreToolUse", { type: "command", tool: "bash" });
      registry.register("PreToolUse", { type: "command", toolPattern: "exec*" });
      registry.register("PreToolUse", { type: "command", toolPatterns: ["*run*"] });

      expect(registry.match("PreToolUse", "bash").length).toBe(1);
      expect(registry.match("PreToolUse", "execute").length).toBe(1);
      expect(registry.match("PreToolUse", "dry-run").length).toBe(1);
    });

    it("returns empty for unknown event", () => {
      expect(registry.match("Unknown", "bash")).toEqual([]);
    });

    it("matches only unfiltered hooks when toolName is empty", () => {
      registry.register("PreToolUse", { type: "command", tools: ["bash"] });
      registry.register("PreToolUse", { type: "command" });
      expect(registry.match("PreToolUse", "").length).toBe(1);
      expect(registry.match("PreToolUse", "   ").length).toBe(1);
      expect(registry.match("PreToolUse", null).length).toBe(1);
    });

    it("handles long tool names and patterns", () => {
      const longName = `tool_${"a".repeat(10000)}`;
      registry.register("PreToolUse", { type: "command", tools: ["tool_*"] });
      registry.register("PreToolUse", { type: "command" });
      expect(registry.match("PreToolUse", longName).length).toBe(2);
    });

    it("matches numeric tool names at boundaries", () => {
      registry.register("PreToolUse", { type: "command", tools: ["0", "-1", String(Number.MAX_SAFE_INTEGER)] });
      expect(registry.match("PreToolUse", 0).length).toBe(1);
      expect(registry.match("PreToolUse", -1).length).toBe(1);
      expect(registry.match("PreToolUse", Number.MAX_SAFE_INTEGER).length).toBe(1);
    });
  });

  describe("concurrency", () => {
    it("supports parallel registrations", async () => {
      const tasks = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() => registry.register("PreToolUse", { type: "command", tool: `tool-${i}` }))
      );
      await Promise.all(tasks);
      expect(registry.list("PreToolUse").length).toBe(50);
    });

    it("supports rapid consecutive registrations", () => {
      for (let i = 0; i < 100; i++) {
        registry.register("PreToolUse", { type: "command", tool: `fast-${i}` });
      }
      expect(registry.match("PreToolUse", "fast-42").length).toBe(1);
      expect(registry.list("PreToolUse").length).toBe(100);
    });
  });

  describe("resource boundaries", () => {
    it("handles large content strings and deep nesting together", () => {
      const largeContent = "file".repeat(50000);
      const deep = { level: 0 };
      let cursor = deep;
      for (let i = 1; i < 20; i++) {
        cursor.next = { level: i };
        cursor = cursor.next;
      }

      const def = registry.register("PreToolUse", {
        type: "prompt",
        prompt: largeContent,
        meta: deep,
      });

      expect(def.prompt.length).toBe(largeContent.length);
      expect(def.meta.next.next.level).toBe(2);
    });
  });
});
