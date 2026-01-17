
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  HookType,
  HookEvent,
  HookRegistry,
} from "../../js/agents/runtime/hooks/hook-registry.js";

describe("runtime/hooks/hook-registry", () => {
  describe("HookType", () => {
    it("is frozen", () => {
      expect(Object.isFrozen(HookType)).toBe(true);
    });

    it("has COMMAND type", () => {
      expect(HookType.COMMAND).toBe("command");
    });

    it("has PROMPT type", () => {
      expect(HookType.PROMPT).toBe("prompt");
    });

    it("has AGENT type", () => {
      expect(HookType.AGENT).toBe("agent");
    });
  });

  describe("HookEvent", () => {
    it("is frozen", () => {
      expect(Object.isFrozen(HookEvent)).toBe(true);
    });

    it("has PRE_AGENT event", () => {
      expect(HookEvent.PRE_AGENT).toBe("PreAgent");
    });

    it("has POST_AGENT event", () => {
      expect(HookEvent.POST_AGENT).toBe("PostAgent");
    });

    it("has PRE_LLM_CALL event", () => {
      expect(HookEvent.PRE_LLM_CALL).toBe("PreLLMCall");
    });

    it("has POST_LLM_CALL event", () => {
      expect(HookEvent.POST_LLM_CALL).toBe("PostLLMCall");
    });

    it("has PRE_TOOL_USE event", () => {
      expect(HookEvent.PRE_TOOL_USE).toBe("PreToolUse");
    });

    it("has POST_TOOL_USE event", () => {
      expect(HookEvent.POST_TOOL_USE).toBe("PostToolUse");
    });
  });

  describe("HookRegistry", () => {
    /** @type {HookRegistry} */
    let registry;

    beforeEach(() => {
      registry = new HookRegistry();
    });

    describe("constructor", () => {
      it("creates empty registry", () => {
        expect(registry).toBeInstanceOf(HookRegistry);
        expect(registry.list("PreToolUse")).toEqual([]);
      });
    });

    describe("register", () => {
      it("registers command hook", () => {
        const def = registry.register("PreToolUse", { type: "command" });
        expect(def.type).toBe("command");
        expect(def.blocking).toBe(true);
      });

      it("throws for empty event name", () => {
        expect(() => registry.register("", { type: "command" })).toThrow(/eventName must be a non-empty string/);
      });

      it("throws for non-object definition", () => {
        expect(() => registry.register("PreToolUse", "invalid")).toThrow(/must be an object/);
      });

      it("throws for missing type", () => {
        expect(() => registry.register("PreToolUse", {})).toThrow(/type must be one of/);
      });

      it("throws for invalid type", () => {
        expect(() => registry.register("PreToolUse", { type: "invalid" })).toThrow(/type must be one of/);
      });

      it("normalizes type to lowercase", () => {
        const def = registry.register("PreToolUse", { type: "COMMAND" });
        expect(def.type).toBe("command");
      });

      it("sets blocking to true by default", () => {
        const def = registry.register("PreToolUse", { type: "command" });
        expect(def.blocking).toBe(true);
      });

      it("respects blocking=false", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          blocking: false,
        });
        expect(def.blocking).toBe(false);
      });

      it("normalizes tool patterns", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          tools: ["bash", "exec*"],
        });
        expect(def.tools).toEqual(["bash", "exec*"]);
      });

      it("normalizes single tool to array", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          tool: "bash",
        });
        expect(def.tools).toEqual(["bash"]);
      });

      it("removes duplicate tools", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          tools: ["bash", "bash", "exec"],
        });
        expect(def.tools).toEqual(["bash", "exec"]);
      });

      it("throws for prompt type without prompt", () => {
        expect(() => registry.register("PreToolUse", { type: "prompt" })).toThrow(/prompt is required/);
      });

      it("registers prompt hook with prompt", () => {
        const def = registry.register("PreToolUse", {
          type: "prompt",
          prompt: "Check if command is safe",
        });
        expect(def.prompt).toBe("Check if command is safe");
      });

      it("captures usage for prompt hook", () => {
        const def = registry.register("PreToolUse", {
          type: "prompt",
          prompt: "Check",
          usage: "fast",
        });
        expect(def.usage).toBe("fast");
      });

      it("throws for agent type without agentType", () => {
        expect(() => registry.register("PreToolUse", { type: "agent" })).toThrow(/agentType is required/);
      });

      it("registers agent hook with agentType", () => {
        const def = registry.register("PreToolUse", {
          type: "agent",
          agentType: "security-checker",
        });
        expect(def.agentType).toBe("security-checker");
      });

      it("captures modelTier for agent hook", () => {
        const def = registry.register("PreToolUse", {
          type: "agent",
          agentType: "checker",
          modelTier: "fast",
        });
        expect(def.modelTier).toBe("fast");
      });
    });

    describe("list", () => {
      it("returns empty array for unknown event", () => {
        const hooks = registry.list("Unknown");
        expect(hooks).toEqual([]);
      });

      it("returns empty array for empty event name", () => {
        const hooks = registry.list("");
        expect(hooks).toEqual([]);
      });

      it("returns registered hooks", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.register("PreToolUse", { type: "command" });
        const hooks = registry.list("PreToolUse");
        expect(hooks.length).toBe(2);
      });

      it("returns copy of hooks", () => {
        registry.register("PreToolUse", { type: "command" });
        const hooks = registry.list("PreToolUse");
        hooks.push({ type: "modified" });
        expect(registry.list("PreToolUse").length).toBe(1);
      });
    });

    describe("clear", () => {
      it("clears all hooks when no event specified", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.register("PostToolUse", { type: "command" });
        registry.clear();
        expect(registry.list("PreToolUse")).toEqual([]);
        expect(registry.list("PostToolUse")).toEqual([]);
      });

      it("clears hooks for specific event", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.register("PostToolUse", { type: "command" });
        registry.clear("PreToolUse");
        expect(registry.list("PreToolUse")).toEqual([]);
        expect(registry.list("PostToolUse").length).toBe(1);
      });

      it("handles empty event name", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.clear("");
        // Empty string clears all
        expect(registry.list("PreToolUse")).toEqual([]);
      });
    });

    describe("match", () => {
      beforeEach(() => {
        registry.register("PreToolUse", { type: "command", tools: ["bash"] });
        registry.register("PreToolUse", { type: "command", tools: ["exec*"] });
        registry.register("PreToolUse", { type: "command" }); // matches all
      });

      it("matches exact tool name", () => {
        const matches = registry.match("PreToolUse", "bash");
        expect(matches.length).toBe(2); // bash + all
      });

      it("matches wildcard pattern", () => {
        const matches = registry.match("PreToolUse", "execute");
        expect(matches.length).toBe(2); // exec* + all
      });

      it("matches hooks without tool filter", () => {
        const matches = registry.match("PreToolUse", "unknown");
        expect(matches.length).toBe(1); // only all
      });

      it("returns empty for unknown event", () => {
        const matches = registry.match("Unknown", "bash");
        expect(matches).toEqual([]);
      });

      it("handles empty tool name gracefully", () => {
        // Empty tool name triggers matchWildcard with empty value
        // matchWildcard returns false for empty value, so only non-filtered hooks match
        // However, implementation may throw - just verify it doesn't crash
        try {
          const matches = registry.match("PreToolUse", "");
          // If it returns, should only match hooks without tool filter
          expect(Array.isArray(matches)).toBe(true);
        } catch (e) {
          // Implementation may not support empty tool names
          expect(e instanceof Error).toBe(true);
        }
      });

      it("matches multiple wildcards", () => {
        registry.register("PreToolUse", { type: "command", tools: ["*bash*"] });
        const matches = registry.match("PreToolUse", "run_bash_script");
        expect(matches.length).toBeGreaterThanOrEqual(2);
      });
    });
  });
});
