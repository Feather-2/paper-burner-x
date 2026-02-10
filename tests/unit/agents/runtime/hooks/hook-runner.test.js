import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/safety/command-classifier.js", () => ({
  classifyCommand: vi.fn(),
}));

vi.mock("../../../../../js/agents/runtime/safety/tool-restrictions.js", () => ({
  evaluateToolRestrictions: vi.fn(),
  normalizeToolRestrictions: vi.fn((input) => (input && typeof input === "object" ? input : null)),
}));

vi.mock("../../../../../js/agents/runtime/hooks/hook-registry.js", () => ({
  HookType: {
    COMMAND: "command",
    PROMPT: "prompt",
    AGENT: "agent",
  },
}));

vi.mock("../../../../../js/agents/runtime/hooks/event-bus-hooks.js", () => {
  const createRegistry = () => {
    /** @type {Map<string, any[]>} */
    const hooksByEvent = new Map();

    const register = (eventName, hook) => {
      const name = String(eventName || "");
      const list = hooksByEvent.get(name) || [];
      list.push(hook);
      hooksByEvent.set(name, list);
    };

    const list = (eventName) => hooksByEvent.get(String(eventName || "")) || [];

    const match = (eventName, toolName) => {
      const hooks = list(eventName);
      const tool = String(toolName || "");
      return hooks.filter((hook) => {
        const declaredTool = typeof hook?.tool === "string" ? hook.tool.trim() : "";
        if (!declaredTool) return true;
        return declaredTool === tool;
      });
    };

    return { register, list, match };
  };

  const enhanceEventBusWithHooks = (eventBus) => {
    const bus = eventBus && typeof eventBus === "object" ? eventBus : {};
    if (!bus.__hookRegistry) bus.__hookRegistry = createRegistry();
    if (typeof bus.registerHook !== "function") {
      bus.registerHook = (eventName, hook) => bus.__hookRegistry.register(eventName, hook);
    }
    return bus;
  };

  const getHookRegistry = (eventBus) => {
    const bus = eventBus && typeof eventBus === "object" ? eventBus : null;
    return bus?.__hookRegistry || null;
  };

  return { enhanceEventBusWithHooks, getHookRegistry };
});

vi.mock("../../../../../js/agents/shared/index.js", () => {
  const toNonEmptyString = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed ? trimmed : "";
  };

  const isPlainObject = (value) => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const robustParseJson = (text, fallback) => {
    if (typeof text !== "string") return fallback;
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  return { isPlainObject, toNonEmptyString, robustParseJson };
});

import {
  createPreToolUseHook,
  createPreAgentHook,
  createPostAgentHook,
  default as hookRunnerDefault,
} from "../../../../../js/agents/runtime/hooks/hook-runner.js";
import { HookType } from "../../../../../js/agents/runtime/hooks/hook-registry.js";
import { enhanceEventBusWithHooks } from "../../../../../js/agents/runtime/hooks/event-bus-hooks.js";
import { classifyCommand } from "../../../../../js/agents/runtime/safety/command-classifier.js";
import { evaluateToolRestrictions, normalizeToolRestrictions } from "../../../../../js/agents/runtime/safety/tool-restrictions.js";

const classifyCommandMock = vi.mocked(classifyCommand);
const evaluateToolRestrictionsMock = vi.mocked(evaluateToolRestrictions);
const normalizeToolRestrictionsMock = vi.mocked(normalizeToolRestrictions);

function createEventBus() {
  const events = [];
  const bus = {
    emit: vi.fn((event, payload) => {
      events.push({ event, payload });
    }),
    events,
  };
  return enhanceEventBusWithHooks(bus);
}

function createContext(eventBus, extras = {}) {
  return { eventBus, ...extras };
}

function findEvent(events, name) {
  return events.find((entry) => entry.event === name) || null;
}

beforeEach(() => {
  vi.clearAllMocks();
  classifyCommandMock.mockReturnValue({ requiresApproval: false, level: "safe" });
  evaluateToolRestrictionsMock.mockReturnValue({ allowed: true });
  normalizeToolRestrictionsMock.mockImplementation((input) => (input && typeof input === "object" ? input : null));
});

describe("createPreToolUseHook", () => {
  describe("when no eventBus and no restrictions", () => {
    let result;

    beforeEach(async () => {
      const hook = createPreToolUseHook();
      result = await hook({ tool: "read", params: {}, context: {} });
    });

    it("should_return_null_when_no_event_bus_and_no_restrictions", () => {
      expect(result).toBe(null);
    });

    it("should_not_call_evaluateToolRestrictions_when_no_restrictions", () => {
      expect(evaluateToolRestrictionsMock).not.toHaveBeenCalled();
    });
  });

  describe("when eventBus has no hook registry", () => {
    let result;

    beforeEach(async () => {
      const hook = createPreToolUseHook();
      result = await hook({
        tool: "read",
        params: {},
        context: { eventBus: { emit: vi.fn() }, toolRestrictions: {} },
      });
    });

    it("should_return_null_when_hook_registry_is_missing", () => {
      expect(result).toBe(null);
    });
  });

  describe("when tool restrictions deny", () => {
    let eventBus;
    let result;
    let denied;
    let args;

    beforeEach(async () => {
      eventBus = createEventBus();

      evaluateToolRestrictionsMock.mockReturnValue({
        allowed: false,
        reason: "tool_blocked",
        policy: { type: "blocklist" },
      });

      const deep = {
        level1: { level2: { level3: { level4: { level5: { level6: { level7: "x" } } } } } },
      };
      const circular = {};
      circular.self = circular;

      const params = {
        emptyString: "",
        whitespace: "   ",
        emptyArray: [],
        emptyObject: {},
        nullVal: null,
        undefinedVal: undefined,
        zero: 0,
        neg: -1,
        max: Number.MAX_SAFE_INTEGER,
        numAsString: "42",
        listObject: { 0: "a", length: "2" },
        password: "secret",
        token: "abc",
        header: "authorization: bearer supersecret",
        query: "api_key=12345",
        longString: `${"a".repeat(600)} token=secret`,
        deep,
        largeArray: Array.from({ length: 60 }, (_v, i) => i),
        circular,
        big: 123n,
        fn: () => {},
        lotsOfKeys: Object.fromEntries(Array.from({ length: 55 }, (_v, i) => [`k${i}`, i])),
        buffer: new ArrayBuffer(1024 * 1024),
        typed: new Uint8Array(4),
        __proto__: { polluted: true },
        constructor: { polluted: true },
        prototype: { polluted: true },
      };

      const hook = createPreToolUseHook();
      result = await hook({
        tool: "write",
        params,
        context: createContext(eventBus, { toolRestrictions: {} }),
      });

      denied = findEvent(eventBus.events, "tool:denied");
      args = denied?.payload?.args || null;
    });

    it("should_skip_when_restriction_denies", () => {
      expect(result).toMatchObject({ skip: true, value: { ok: false, error: "tool_blocked" } });
    });

    it("should_emit_tool_denied_event_when_restriction_denies", () => {
      expect(denied?.event).toBe("tool:denied");
    });

    it("should_redact_sensitive_keys_when_sanitizing_args", () => {
      expect({ password: args.password, token: args.token }).toEqual({ password: "[REDACTED]", token: "[REDACTED]" });
    });

    it("should_redact_secrets_in_header_strings_when_sanitizing_args", () => {
      expect(args.header).toContain("[REDACTED]");
    });

    it("should_redact_secrets_in_query_strings_when_sanitizing_args", () => {
      expect(args.query).toContain("[REDACTED]");
    });

    it("should_truncate_long_strings_when_sanitizing_args", () => {
      expect(args.longString).toContain("[REDACTED]");
    });

    it("should_limit_string_length_to_maxString_when_sanitizing_args", () => {
      expect(args.longString.length <= 500).toBe(true);
    });

    it("should_preserve_null_values_when_sanitizing_args", () => {
      expect(args.nullVal).toBeNull();
    });

    it("should_preserve_undefined_properties_when_sanitizing_args", () => {
      expect(Object.prototype.hasOwnProperty.call(args, "undefinedVal")).toBe(true);
    });

    it("should_limit_object_depth_when_sanitizing_args", () => {
      expect(args.deep.level1.level2.level3.level4.level5).toBe("[MaxDepth]");
    });

    it("should_summarize_arraybuffers_when_sanitizing_args", () => {
      expect(args.buffer).toBe("[ArrayBuffer 1048576 bytes]");
    });

    it("should_summarize_typed_arrays_when_sanitizing_args", () => {
      expect(args.typed).toBe("[Uint8Array 4 bytes]");
    });

    it("should_drop_proto_pollution_keys_when_sanitizing_args", () => {
      expect(Object.prototype.hasOwnProperty.call(args, "__proto__")).toBe(false);
    });

    it("should_drop_constructor_key_when_sanitizing_args", () => {
      expect(Object.prototype.hasOwnProperty.call(args, "constructor")).toBe(false);
    });

    it("should_drop_prototype_key_when_sanitizing_args", () => {
      expect(Object.prototype.hasOwnProperty.call(args, "prototype")).toBe(false);
    });

    it("should_truncate_large_arrays_when_sanitizing_args", () => {
      expect(args.largeArray.at(-1)).toBe("[+10 items]");
    });

    it("should_mark_circular_references_when_sanitizing_args", () => {
      expect(args.circular.self).toBe("[Circular]");
    });

    it("should_stringify_bigints_when_sanitizing_args", () => {
      expect(args.big).toBe("123");
    });

    it("should_label_functions_when_sanitizing_args", () => {
      expect(args.fn).toBe("[Function]");
    });

    it("should_record_truncated_object_key_count_when_sanitizing_args", () => {
      expect(args.lotsOfKeys.__truncatedKeys).toBe(5);
    });
  });

  describe("when permissionLevel is readonly", () => {
    let capturedRestrictions;

    beforeEach(async () => {
      const eventBus = createEventBus();
      capturedRestrictions = null;

      evaluateToolRestrictionsMock.mockImplementation((input) => {
        capturedRestrictions = input.restrictions;
        return { allowed: true };
      });

      const hook = createPreToolUseHook();
      await hook({
        tool: "bash",
        params: { command: "ls" },
        context: createContext(eventBus, {
          permissionLevel: "read-only",
          toolRestrictions: { blockedTools: ["net"], bash: { blockedCommands: ["rm"], toolNames: ["bash"] } },
        }),
      });
    });

    it("should_merge_readonly_blocked_tools_when_permissionLevel_is_readonly", () => {
      expect(capturedRestrictions.blockedTools).toEqual(expect.arrayContaining(["net", "write"]));
    });

    it("should_include_readonly_bash_allowlist_when_permissionLevel_is_readonly", () => {
      expect(capturedRestrictions.bash.allowedCommands).toEqual(expect.arrayContaining(["ls"]));
    });

    it("should_preserve_existing_bash_blocklist_when_permissionLevel_is_readonly", () => {
      expect(capturedRestrictions.bash.blockedCommands).toEqual(expect.arrayContaining(["rm"]));
    });
  });

  describe("command hooks", () => {
    describe("when command requires approval", () => {
      let eventBus;
      let result;
      let denied;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

        classifyCommandMock.mockReturnValue({
          requiresApproval: true,
          baseCommand: "rm",
          level: "dangerous",
        });

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "bash",
          params: { command: "rm -rf /" },
          context: createContext(eventBus),
        });

        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_call_classifyCommand_with_extracted_command", () => {
        expect(classifyCommandMock).toHaveBeenCalledWith("rm -rf /");
      });

      it("should_skip_when_command_requires_approval", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_emit_command_policy_when_command_requires_approval", () => {
        expect(denied?.payload?.policy?.hookType).toBe("command");
      });
    });

    describe("when blocking is false", () => {
      let eventBus;
      let result;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.COMMAND, blocking: false });

        classifyCommandMock.mockReturnValue({
          requiresApproval: true,
          baseCommand: "rm",
          level: "dangerous",
        });

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "bash",
          params: { command: "rm -rf /" },
          context: createContext(eventBus),
        });
      });

      it("should_return_null_when_nonblocking_command_hook_requires_approval", () => {
        expect(result).toBe(null);
      });
    });

    describe("when argv is not an array", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "bash",
          params: { argv: { 0: "ls" } },
          context: createContext(eventBus),
        });
      });

      it("should_call_classifyCommand_with_null_when_argv_is_not_array", () => {
        expect(classifyCommandMock).toHaveBeenCalledWith(null);
      });

      it("should_return_null_when_argv_is_not_array", () => {
        expect(result).toBe(null);
      });
    });

    describe("when params is a string", () => {
      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

        const hook = createPreToolUseHook();
        await hook({ tool: "bash", params: "ls -la", context: createContext(eventBus) });
      });

      it("should_call_classifyCommand_with_string_params", () => {
        expect(classifyCommandMock).toHaveBeenCalledWith("ls -la");
      });
    });

    describe("when params is an array", () => {
      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

        const hook = createPreToolUseHook();
        await hook({ tool: "bash", params: ["ls", "-la"], context: createContext(eventBus) });
      });

      it("should_call_classifyCommand_with_array_params", () => {
        expect(classifyCommandMock).toHaveBeenCalledWith(["ls", "-la"]);
      });
    });
  });

  describe("prompt hooks", () => {
    describe("when modelRouter is unavailable", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });

        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_when_prompt_hook_has_no_model_router", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_emit_prompt_error_model_router_unavailable_when_modelRouter_missing", () => {
        expect(denied?.payload?.policy?.error).toBe("model_router_unavailable");
      });
    });

    describe("when modelRouter is unavailable and blocking is false", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check", blocking: false });

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });
      });

      it("should_return_null_when_nonblocking_prompt_hook_has_no_model_router", () => {
        expect(result).toBe(null);
      });
    });

    describe("when modelRouter comes from container.get", () => {
      let container;
      let modelRouter;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check {{tool}}" });

        modelRouter = { call: vi.fn().mockResolvedValue({ content: "allow" }) };
        container = { get: vi.fn().mockResolvedValue(modelRouter) };

        const hook = createPreToolUseHook();
        await hook({ tool: "read", params: {}, context: createContext(eventBus, { container }) });
      });

      it("should_call_container_get_with_modelRouter_service_id_when_resolving_model_router", () => {
        expect(container.get).toHaveBeenCalledWith("modelRouter");
      });

      it("should_call_modelRouter_when_resolved_from_container", () => {
        expect(modelRouter.call).toHaveBeenCalled();
      });
    });

    describe("when prompt hook returns deny decision", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

        const modelRouter = {
          call: vi.fn().mockResolvedValue({ content: "{\"allow\": false, \"reason\": \"nope\"}" }),
        };

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "read",
          params: {},
          context: createContext(eventBus, { modelRouter }),
        });

        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_with_reason_when_prompt_hook_denies", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false, error: "nope" } });
      });

      it("should_emit_denied_reason_when_prompt_hook_denies", () => {
        expect(denied?.payload?.reason).toBe("nope");
      });
    });

    describe("when prompt hook allows", () => {
      let result;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

        const modelRouter = {
          call: vi.fn().mockResolvedValue({ content: "allow" }),
        };

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "read",
          params: {},
          context: createContext(eventBus, { modelRouter }),
        });
      });

      it("should_return_null_when_prompt_hook_allows", () => {
        expect(result).toBe(null);
      });
    });

    describe("when prompt hook response is unparseable", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

        const modelRouter = {
          call: vi.fn().mockResolvedValue({ content: "maybe" }),
        };

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "read",
          params: {},
          context: createContext(eventBus, { modelRouter }),
        });

        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_when_prompt_decision_is_unparseable", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_emit_prompt_error_unparseable_when_prompt_decision_is_unparseable", () => {
        expect(denied?.payload?.policy?.error).toBe("unparseable");
      });
    });

    describe("when prompt hook response is unparseable and blocking is false", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check", blocking: false });

        const modelRouter = { call: vi.fn().mockResolvedValue({ content: "maybe" }) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { modelRouter }) });
      });

      it("should_return_null_when_nonblocking_prompt_decision_is_unparseable", () => {
        expect(result).toBe(null);
      });
    });

    describe("when prompt hook model call throws", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

        const modelRouter = {
          call: vi.fn().mockRejectedValue(new Error("boom")),
        };

        const hook = createPreToolUseHook();
        result = await hook({
          tool: "read",
          params: {},
          context: createContext(eventBus, { modelRouter }),
        });

        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_when_prompt_model_call_fails", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_emit_prompt_error_model_call_failed_when_model_call_throws", () => {
        expect(denied?.payload?.policy?.error).toBe("model_call_failed");
      });
    });

    describe("when prompt hook model call throws and blocking is false", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check", blocking: false });

        const modelRouter = { call: vi.fn().mockRejectedValue(new Error("boom")) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { modelRouter }) });
      });

      it("should_return_null_when_nonblocking_prompt_model_call_fails", () => {
        expect(result).toBe(null);
      });
    });
  });

  describe("agent hooks", () => {
    describe("when subagent registry is missing", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });
        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_when_subagent_registry_is_unavailable", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_emit_registry_unavailable_when_subagent_registry_missing", () => {
        expect(denied?.payload?.policy?.error).toBe("registry_unavailable");
      });
    });

    describe("when subagent registry is missing and blocking is false", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard", blocking: false });

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });
      });

      it("should_return_null_when_nonblocking_agent_hook_registry_missing", () => {
        expect(result).toBe(null);
      });
    });

    describe("when agent type is unknown", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

        const subagentRegistry = { getFactory: vi.fn().mockReturnValue(null) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { subagentRegistry }) });
        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_when_agent_type_is_unknown", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_emit_unknown_agent_error_when_agent_type_is_unknown", () => {
        expect(denied?.payload?.policy?.error).toBe("unknown_agent");
      });
    });

    describe("when agent hook denies", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

        const factory = vi.fn().mockResolvedValue({ run: vi.fn().mockResolvedValue({ allow: false, reason: "no" }) });
        const subagentRegistry = { getFactory: vi.fn().mockReturnValue(factory) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { subagentRegistry }) });
        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_with_reason_when_agent_hook_denies", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false, error: "no" } });
      });

      it("should_emit_agentType_in_policy_when_agent_hook_denies", () => {
        expect(denied?.payload?.policy?.agentType).toBe("guard");
      });
    });

    describe("when agent hook denies and blocking is false", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard", blocking: false });

        const factory = vi.fn().mockResolvedValue({ run: vi.fn().mockResolvedValue({ allow: false, reason: "no" }) });
        const subagentRegistry = { getFactory: vi.fn().mockReturnValue(factory) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { subagentRegistry }) });
      });

      it("should_return_null_when_nonblocking_agent_hook_denies", () => {
        expect(result).toBe(null);
      });
    });

    describe("when agent hook permits", () => {
      let result;

      beforeEach(async () => {
        const eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

        const factory = vi.fn().mockResolvedValue({ run: vi.fn().mockResolvedValue({ allow: true }) });
        const subagentRegistry = { getFactory: vi.fn().mockReturnValue(factory) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { subagentRegistry }) });
      });

      it("should_return_null_when_agent_hook_allows", () => {
        expect(result).toBe(null);
      });
    });

    describe("when agent hook throws", () => {
      let result;
      let denied;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

        const factory = vi.fn().mockRejectedValue(new Error("factory down"));
        const subagentRegistry = { getFactory: vi.fn().mockReturnValue(factory) };

        const hook = createPreToolUseHook();
        result = await hook({ tool: "read", params: {}, context: createContext(eventBus, { subagentRegistry }) });
        denied = findEvent(eventBus.events, "tool:denied");
      });

      it("should_skip_when_agent_hook_throws", () => {
        expect(result).toMatchObject({ skip: true, value: { ok: false } });
      });

      it("should_include_error_reason_when_agent_hook_throws", () => {
        expect(denied?.payload?.reason).toContain("factory down");
      });
    });

    describe("when agent registry comes from container.tryGet", () => {
      let container;
      let eventBus;

      beforeEach(async () => {
        eventBus = createEventBus();
        eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

        const factory = vi.fn().mockResolvedValue({ run: vi.fn().mockResolvedValue({ allow: true }) });
        const registry = { getFactory: vi.fn().mockReturnValue(factory) };
        container = { tryGet: vi.fn().mockResolvedValue(registry) };

        const hook = createPreToolUseHook();
        await hook({ tool: "read", params: {}, context: createContext(eventBus, { container }) });
      });

      it("should_call_container_tryGet_with_subagentRegistry_service_id_when_resolving_subagent_registry", () => {
        expect(container.tryGet).toHaveBeenCalledWith("subagentRegistry");
      });

      it("should_not_emit_tool_denied_when_agent_registry_resolves_from_container", () => {
        expect(findEvent(eventBus.events, "tool:denied")).toBeNull();
      });
    });
  });

  describe("concurrency and sequencing", () => {
    it("should_handle_concurrent_calls_independently", async () => {
      const eventBus = createEventBus();
      eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

      classifyCommandMock.mockImplementation((cmd) => {
        const text = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
        if (text.includes("rm")) return { requiresApproval: true, baseCommand: "rm", level: "dangerous" };
        return { requiresApproval: false, level: "safe" };
      });

      const hook = createPreToolUseHook();
      const [denyResult, allowResult] = await Promise.all([
        hook({ tool: "bash", params: { command: "rm -rf /" }, context: createContext(eventBus) }),
        hook({ tool: "bash", params: { command: "ls" }, context: createContext(eventBus) }),
      ]);

      expect({
        denySkip: denyResult?.skip === true,
        allowIsNull: allowResult === null,
        deniedEvents: eventBus.events.filter((e) => e.event === "tool:denied").length,
      }).toEqual({ denySkip: true, allowIsNull: true, deniedEvents: 1 });
    });

    it("should_handle_rapid_sequential_calls_with_different_outcomes", async () => {
      const eventBus = createEventBus();
      const hook = createPreToolUseHook();

      evaluateToolRestrictionsMock
        .mockReturnValueOnce({ allowed: false, reason: "tool_blocked" })
        .mockReturnValueOnce({ allowed: true });

      const first = await hook({ tool: "write", params: { path: "/tmp/a" }, context: createContext(eventBus, { toolRestrictions: {} }) });
      const second = await hook({ tool: "write", params: { path: "/tmp/b" }, context: createContext(eventBus, { toolRestrictions: {} }) });

      expect({ firstSkip: first?.skip === true, secondIsNull: second === null }).toEqual({ firstSkip: true, secondIsNull: true });
    });
  });
});

describe("createPreAgentHook", () => {
  it("should_return_null_when_no_eventBus", async () => {
    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s", runId: "r", input: {}, context: {} });
    expect(result).toBe(null);
  });

  it("should_return_skip_when_handler_requests_skip", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      handler: vi.fn().mockResolvedValue({ skip: true, reason: "blocked", value: { ok: false } }),
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: 0, runId: -1, input: "", context: createContext(eventBus) });
    expect(result).toMatchObject({ skip: true, reason: "blocked", value: { ok: false } });
  });

  it("should_emit_agent_denied_when_handler_requests_skip", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      handler: vi.fn().mockResolvedValue({ skip: true, reason: "blocked", value: { ok: false } }),
    });

    const hook = createPreAgentHook();
    await hook({ sessionId: "s", runId: "r", input: {}, context: createContext(eventBus) });
    expect(findEvent(eventBus.events, "agent:denied")?.payload?.reason).toBe("blocked");
  });

  it("should_ignore_skip_when_blocking_is_false", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      blocking: false,
      handler: vi.fn().mockResolvedValue({ skip: true, reason: "blocked" }),
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s", runId: "r", input: {}, context: createContext(eventBus) });
    expect(result).toBe(null);
  });

  it("should_emit_hook_error_when_handler_throws", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      handler: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const hook = createPreAgentHook();
    await hook({ sessionId: "s", runId: "r", input: {}, context: createContext(eventBus) });
    expect(findEvent(eventBus.events, "agent:hook:error")?.payload?.error).toBe("boom");
  });
});

describe("createPostAgentHook", () => {
  it("should_resolve_when_no_eventBus", async () => {
    const hook = createPostAgentHook();
    await expect(hook({ sessionId: "s", runId: "r", input: {}, result: {}, context: {} })).resolves.toBeUndefined();
  });

  it("should_call_handler_with_payload_when_hook_registered", async () => {
    const eventBus = createEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    eventBus.registerHook("PostAgent", { handler });

    const hook = createPostAgentHook();
    await hook({
      sessionId: "s",
      runId: "r",
      input: { q: "x" },
      result: { ok: true },
      error: null,
      duration: 12,
      context: createContext(eventBus),
    });

    expect(handler).toHaveBeenCalledWith({
      sessionId: "s",
      runId: "r",
      input: { q: "x" },
      result: { ok: true },
      error: null,
      duration: 12,
      context: createContext(eventBus),
    });
  });

  it("should_emit_hook_error_when_handler_throws", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PostAgent", { handler: vi.fn().mockRejectedValue(new Error("post boom")) });

    const hook = createPostAgentHook();
    await hook({
      sessionId: "s",
      runId: "r",
      input: {},
      result: {},
      error: null,
      duration: 0,
      context: createContext(eventBus),
    });

    expect(findEvent(eventBus.events, "agent:hook:error")?.payload?.error).toBe("post boom");
  });
});

describe("default export", () => {
  it("should_expose_hook_creators", () => {
    expect(hookRunnerDefault).toMatchObject({ createPreToolUseHook, createPreAgentHook, createPostAgentHook });
  });
});
