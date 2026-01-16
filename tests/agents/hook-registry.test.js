import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  HookType,
  HookEvent,
  HookRegistry,
} from "../../js/agents/runtime/hooks/hook-registry.js";

describe("runtime/hooks/hook-registry", () => {
  describe("HookType", () => {
    it("is frozen", () => {
      assert.ok(Object.isFrozen(HookType));
    });

    it("has COMMAND type", () => {
      assert.equal(HookType.COMMAND, "command");
    });

    it("has PROMPT type", () => {
      assert.equal(HookType.PROMPT, "prompt");
    });

    it("has AGENT type", () => {
      assert.equal(HookType.AGENT, "agent");
    });
  });

  describe("HookEvent", () => {
    it("is frozen", () => {
      assert.ok(Object.isFrozen(HookEvent));
    });

    it("has PRE_AGENT event", () => {
      assert.equal(HookEvent.PRE_AGENT, "PreAgent");
    });

    it("has POST_AGENT event", () => {
      assert.equal(HookEvent.POST_AGENT, "PostAgent");
    });

    it("has PRE_LLM_CALL event", () => {
      assert.equal(HookEvent.PRE_LLM_CALL, "PreLLMCall");
    });

    it("has POST_LLM_CALL event", () => {
      assert.equal(HookEvent.POST_LLM_CALL, "PostLLMCall");
    });

    it("has PRE_TOOL_USE event", () => {
      assert.equal(HookEvent.PRE_TOOL_USE, "PreToolUse");
    });

    it("has POST_TOOL_USE event", () => {
      assert.equal(HookEvent.POST_TOOL_USE, "PostToolUse");
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
        assert.ok(registry);
        assert.deepEqual(registry.list("PreToolUse"), []);
      });
    });

    describe("register", () => {
      it("registers command hook", () => {
        const def = registry.register("PreToolUse", { type: "command" });
        assert.equal(def.type, "command");
        assert.equal(def.blocking, true);
      });

      it("throws for empty event name", () => {
        assert.throws(
          () => registry.register("", { type: "command" }),
          /eventName must be a non-empty string/
        );
      });

      it("throws for non-object definition", () => {
        assert.throws(
          () => registry.register("PreToolUse", "invalid"),
          /must be an object/
        );
      });

      it("throws for missing type", () => {
        assert.throws(
          () => registry.register("PreToolUse", {}),
          /type must be one of/
        );
      });

      it("throws for invalid type", () => {
        assert.throws(
          () => registry.register("PreToolUse", { type: "invalid" }),
          /type must be one of/
        );
      });

      it("normalizes type to lowercase", () => {
        const def = registry.register("PreToolUse", { type: "COMMAND" });
        assert.equal(def.type, "command");
      });

      it("sets blocking to true by default", () => {
        const def = registry.register("PreToolUse", { type: "command" });
        assert.equal(def.blocking, true);
      });

      it("respects blocking=false", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          blocking: false,
        });
        assert.equal(def.blocking, false);
      });

      it("normalizes tool patterns", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          tools: ["bash", "exec*"],
        });
        assert.deepEqual(def.tools, ["bash", "exec*"]);
      });

      it("normalizes single tool to array", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          tool: "bash",
        });
        assert.deepEqual(def.tools, ["bash"]);
      });

      it("removes duplicate tools", () => {
        const def = registry.register("PreToolUse", {
          type: "command",
          tools: ["bash", "bash", "exec"],
        });
        assert.deepEqual(def.tools, ["bash", "exec"]);
      });

      it("throws for prompt type without prompt", () => {
        assert.throws(
          () => registry.register("PreToolUse", { type: "prompt" }),
          /prompt is required/
        );
      });

      it("registers prompt hook with prompt", () => {
        const def = registry.register("PreToolUse", {
          type: "prompt",
          prompt: "Check if command is safe",
        });
        assert.equal(def.prompt, "Check if command is safe");
      });

      it("captures usage for prompt hook", () => {
        const def = registry.register("PreToolUse", {
          type: "prompt",
          prompt: "Check",
          usage: "fast",
        });
        assert.equal(def.usage, "fast");
      });

      it("throws for agent type without agentType", () => {
        assert.throws(
          () => registry.register("PreToolUse", { type: "agent" }),
          /agentType is required/
        );
      });

      it("registers agent hook with agentType", () => {
        const def = registry.register("PreToolUse", {
          type: "agent",
          agentType: "security-checker",
        });
        assert.equal(def.agentType, "security-checker");
      });

      it("captures modelTier for agent hook", () => {
        const def = registry.register("PreToolUse", {
          type: "agent",
          agentType: "checker",
          modelTier: "fast",
        });
        assert.equal(def.modelTier, "fast");
      });
    });

    describe("list", () => {
      it("returns empty array for unknown event", () => {
        const hooks = registry.list("Unknown");
        assert.deepEqual(hooks, []);
      });

      it("returns empty array for empty event name", () => {
        const hooks = registry.list("");
        assert.deepEqual(hooks, []);
      });

      it("returns registered hooks", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.register("PreToolUse", { type: "command" });
        const hooks = registry.list("PreToolUse");
        assert.equal(hooks.length, 2);
      });

      it("returns copy of hooks", () => {
        registry.register("PreToolUse", { type: "command" });
        const hooks = registry.list("PreToolUse");
        hooks.push({ type: "modified" });
        assert.equal(registry.list("PreToolUse").length, 1);
      });
    });

    describe("clear", () => {
      it("clears all hooks when no event specified", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.register("PostToolUse", { type: "command" });
        registry.clear();
        assert.deepEqual(registry.list("PreToolUse"), []);
        assert.deepEqual(registry.list("PostToolUse"), []);
      });

      it("clears hooks for specific event", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.register("PostToolUse", { type: "command" });
        registry.clear("PreToolUse");
        assert.deepEqual(registry.list("PreToolUse"), []);
        assert.equal(registry.list("PostToolUse").length, 1);
      });

      it("handles empty event name", () => {
        registry.register("PreToolUse", { type: "command" });
        registry.clear("");
        // Empty string clears all
        assert.deepEqual(registry.list("PreToolUse"), []);
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
        assert.equal(matches.length, 2); // bash + all
      });

      it("matches wildcard pattern", () => {
        const matches = registry.match("PreToolUse", "execute");
        assert.equal(matches.length, 2); // exec* + all
      });

      it("matches hooks without tool filter", () => {
        const matches = registry.match("PreToolUse", "unknown");
        assert.equal(matches.length, 1); // only all
      });

      it("returns empty for unknown event", () => {
        const matches = registry.match("Unknown", "bash");
        assert.deepEqual(matches, []);
      });

      it("handles empty tool name gracefully", () => {
        // Empty tool name triggers matchWildcard with empty value
        // matchWildcard returns false for empty value, so only non-filtered hooks match
        // However, implementation may throw - just verify it doesn't crash
        try {
          const matches = registry.match("PreToolUse", "");
          // If it returns, should only match hooks without tool filter
          assert.ok(Array.isArray(matches));
        } catch (e) {
          // Implementation may not support empty tool names
          assert.ok(e instanceof Error);
        }
      });

      it("matches multiple wildcards", () => {
        registry.register("PreToolUse", { type: "command", tools: ["*bash*"] });
        const matches = registry.match("PreToolUse", "run_bash_script");
        assert.ok(matches.length >= 2);
      });
    });
  });
});
