import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockedSubagentRegistry = vi.hoisted(() => {
  const instances = [];

  class SubagentRegistry {
    constructor() {
      this.register = vi.fn();
      instances.push(this);
    }
  }

  return { SubagentRegistry, instances };
});

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => ({
    log: mockedLogger.log,
    debug: mockedLogger.debug,
    info: mockedLogger.info,
    warn: mockedLogger.warn,
    error: mockedLogger.error,
  })),
}));

vi.mock("../../../../js/agents/sdk/SubagentRegistry.js", () => ({
  SubagentRegistry: mockedSubagentRegistry.SubagentRegistry,
}));

import AgentConfigDefault, { AgentConfig } from "../../../../js/agents/sdk/agent-config.js";

const createDeepObject = (depth) => {
  let root = {};
  let current = root;

  for (let i = 0; i < depth; i++) {
    current.next = {};
    current = current.next;
  }

  return root;
};

describe("AgentConfig", () => {
  beforeEach(() => {
    mockedLogger.warn.mockClear();
    mockedSubagentRegistry.instances.length = 0;
  });

  it("exports default as AgentConfig", () => {
    expect(AgentConfigDefault).toBe(AgentConfig);
  });

  describe("constructor", () => {
    it("initializes defaults and subagent registry", () => {
      const config = new AgentConfig();

      expect(config.capabilities).toBeInstanceOf(Map);
      expect(config.capabilities.size).toBe(0);
      expect(config.hooks).toEqual({ before: [], after: [] });
      expect(config.mcpConfig).toBeNull();
      expect(config.eventHandlers).toEqual([]);
      expect(config.options).toEqual({});
      expect(config.actor).toBe("agent");
      expect(config.cicadaConfig).toBeNull();
      expect(config.backtrackConfig).toBeNull();
      expect(config.watchdogConfig).toBeNull();
      expect(config.discoveryConfig).toBeNull();
      expect(config.alertMonitorConfig).toBeNull();
      expect(mockedSubagentRegistry.instances.length).toBe(1);
      expect(config.subagentRegistry).toBe(mockedSubagentRegistry.instances[0]);
    });

    it("normalizes options and actor values", () => {
      const configFromString = new AgentConfig("not-object");
      expect(configFromString.options).toEqual({});
      expect(configFromString.actor).toBe("agent");

      const arrayOptions = [];
      arrayOptions.actor = "array-actor";
      const configFromArray = new AgentConfig(arrayOptions);
      expect(configFromArray.options).toBe(arrayOptions);
      expect(configFromArray.actor).toBe("array-actor");

      const configWithEmptyActor = new AgentConfig({ actor: "" });
      expect(configWithEmptyActor.actor).toBe("agent");

      const configWithWhitespaceActor = new AgentConfig({ actor: "   " });
      expect(configWithWhitespaceActor.actor).toBe("   ");
    });
  });

  describe("useCapability", () => {
    it("registers function capabilities and supports empty/long names", () => {
      const config = new AgentConfig();
      const handler = vi.fn();

      expect(config.useCapability("", handler)).toBe(config);
      const emptyEntry = config.capabilities.get("");
      expect(emptyEntry.definition).toEqual({
        name: "",
        description: "Capability: ",
        lazy: false,
      });
      expect(emptyEntry.handler).toBe(handler);

      const longName = "x".repeat(10000);
      const longHandler = vi.fn();
      config.useCapability(longName, longHandler);
      const longEntry = config.capabilities.get(longName);
      expect(longEntry.definition.name).toBe(longName);
      expect(longEntry.definition.lazy).toBe(false);
      expect(longEntry.handler).toBe(longHandler);
    });

    it("registers object capabilities and defaults lazy to true", () => {
      const config = new AgentConfig();
      const handler = vi.fn();

      config.useCapability("beta", {
        definition: { name: "beta", description: "Beta", lazy: 0 },
        handler,
        module: "beta.js",
      });
      const entry = config.capabilities.get("beta");
      expect(entry.definition).toEqual({
        name: "beta",
        description: "Beta",
        lazy: true,
      });
      expect(entry.handler).toBe(handler);
      expect(entry._module).toBe("beta.js");
    });

    it("respects lazy false and module aliases", () => {
      const config = new AgentConfig();

      config.useCapability("lazy", {
        definition: { name: "lazy", description: "Lazy", lazy: false },
        _module: "lazy.js",
      });
      const entry = config.capabilities.get("lazy");
      expect(entry.definition.lazy).toBe(false);
      expect(entry.handler).toBeNull();
      expect(entry._module).toBe("lazy.js");
    });

    it("warns when overwriting an existing capability", () => {
      const config = new AgentConfig();
      const first = vi.fn();
      const second = vi.fn();

      config.useCapability("dup", first);
      config.useCapability("dup", second);

      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        '[AgentBuilder] Capability "dup" is being overwritten.'
      );
      expect(config.capabilities.get("dup").handler).toBe(second);
    });

    it("rejects invalid capability configs", () => {
      const invalidConfigs = [null, undefined, "", [], {}, { definition: null }];

      for (const invalid of invalidConfigs) {
        const config = new AgentConfig();
        expect(() => config.useCapability("bad", invalid)).toThrow(
          'Invalid capability config for "bad"'
        );
      }
    });

    it("handles concurrent capability registration", async () => {
      const config = new AgentConfig();
      const names = ["A", "B", "C", "D"];

      await Promise.all(
        names.map((name, index) =>
          Promise.resolve().then(() => config.useCapability(name, () => index))
        )
      );

      expect(config.capabilities.size).toBe(names.length);
    });
  });

  describe("useCapabilities", () => {
    it("registers capabilities from maps and array-like objects", () => {
      const config = new AgentConfig();
      const alpha = vi.fn();
      const beta = vi.fn();

      expect(
        config.useCapabilities({
          Alpha: alpha,
          Beta: { definition: { name: "Beta" }, handler: beta },
        })
      ).toBe(config);

      expect(config.capabilities.has("Alpha")).toBe(true);
      expect(config.capabilities.has("Beta")).toBe(true);

      const arrayLike = { 0: vi.fn() };
      config.useCapabilities(arrayLike);
      expect(config.capabilities.has("0")).toBe(true);
    });

    it("ignores nullish or empty inputs", () => {
      const config = new AgentConfig();

      expect(config.useCapabilities(null)).toBe(config);
      expect(config.useCapabilities(undefined)).toBe(config);
      expect(config.useCapabilities([])).toBe(config);
      expect(config.capabilities.size).toBe(0);
    });

    it("propagates invalid capability configs", () => {
      const config = new AgentConfig();

      expect(() => config.useCapabilities({ Bad: 123 })).toThrow(
        'Invalid capability config for "Bad"'
      );
    });
  });

  describe("useHook", () => {
    it("registers before and after hooks", () => {
      const config = new AgentConfig();
      const beforeHook = vi.fn();
      const afterHook = vi.fn();

      config.useHook("before", beforeHook).useHook("after", afterHook);
      expect(config.hooks.before).toEqual([beforeHook]);
      expect(config.hooks.after).toEqual([afterHook]);
    });

    it("rejects invalid hook phases", () => {
      const config = new AgentConfig();
      const invalidPhases = ["during", "", " ", 0, -1, Number.MAX_SAFE_INTEGER];

      for (const phase of invalidPhases) {
        expect(() => config.useHook(phase, () => {})).toThrow(
          `Invalid hook phase: ${phase}`
        );
      }
    });

    it("rejects non-function hooks", () => {
      const config = new AgentConfig();
      const invalidHooks = [null, {}, "not-a-function"];

      for (const hook of invalidHooks) {
        expect(() => config.useHook("before", hook)).toThrow("Hook must be a function");
      }
    });

    it("handles rapid consecutive hook registration", () => {
      const config = new AgentConfig();

      for (let i = 0; i < 25; i++) {
        config.useHook("before", () => {});
      }

      expect(config.hooks.before).toHaveLength(25);
    });
  });

  describe("config setters", () => {
    it("assigns configs and supports resource boundaries", () => {
      const config = new AgentConfig();
      const largePayload = "x".repeat(200000);
      const longString = "y".repeat(10000);
      const deepConfig = createDeepObject(25);

      const mcpArray = [];
      config.useMcp(mcpArray);
      expect(config.mcpConfig).toBe(mcpArray);

      config.useCicada({ payload: largePayload, hint: longString });
      expect(config.cicadaConfig).toEqual({ payload: largePayload, hint: longString });

      config.useDiscovery(deepConfig);
      expect(config.discoveryConfig).toBe(deepConfig);

      config.useBacktrack({});
      expect(config.backtrackConfig).toEqual({});

      config.useWatchdog({ threshold: 0 });
      expect(config.watchdogConfig).toEqual({ threshold: 0 });

      config.useAlertMonitor({ list: [] });
      expect(config.alertMonitorConfig).toEqual({ list: [] });
    });

    it("clears configs with null and handles defaults for undefined", () => {
      const config = new AgentConfig();

      config.useMcp({ enabled: true });
      config.useMcp(undefined);
      expect(config.mcpConfig).toBeNull();

      config.useCicada({ enabled: true });
      config.useCicada(null);
      expect(config.cicadaConfig).toBeNull();

      config.useBacktrack();
      expect(config.backtrackConfig).toEqual({});
      config.useBacktrack(null);
      expect(config.backtrackConfig).toBeNull();

      config.useWatchdog();
      expect(config.watchdogConfig).toEqual({});

      config.useDiscovery();
      expect(config.discoveryConfig).toEqual({});

      config.useAlertMonitor();
      expect(config.alertMonitorConfig).toEqual({});
    });

    it("rejects invalid config types", () => {
      const config = new AgentConfig();
      const invalidCases = [
        { method: "useMcp", error: "MCP config must be an object", value: "not-object" },
        { method: "useCicada", error: "Cicada config must be an object", value: -1 },
        { method: "useBacktrack", error: "Backtrack config must be an object", value: Number.MAX_SAFE_INTEGER },
        { method: "useWatchdog", error: "Watchdog config must be an object", value: "123" },
        { method: "useDiscovery", error: "Discovery config must be an object", value: "   " },
        { method: "useAlertMonitor", error: "AlertMonitor config must be an object", value: true },
      ];

      for (const { method, error, value } of invalidCases) {
        expect(() => config[method](value)).toThrow(error);
      }
    });
  });

  describe("onEvent", () => {
    it("registers handlers and supports concurrent calls", async () => {
      const config = new AgentConfig();
      const handler = vi.fn();

      config.onEvent("", handler);
      expect(config.eventHandlers).toEqual([{ pattern: "", handler }]);

      const patterns = ["a", "b", "c", "d"];
      await Promise.all(
        patterns.map((pattern) =>
          Promise.resolve().then(() => config.onEvent(pattern, handler))
        )
      );

      expect(config.eventHandlers).toHaveLength(1 + patterns.length);
    });
  });

  describe("setActor", () => {
    it("sets actor values including whitespace", () => {
      const config = new AgentConfig();

      expect(config.setActor("   ")).toBe(config);
      expect(config.actor).toBe("   ");
      config.setActor("agent-2");
      expect(config.actor).toBe("agent-2");
    });
  });

  describe("useSubagent", () => {
    it("registers subagents with default description", () => {
      const config = new AgentConfig();
      const factory = vi.fn();

      expect(config.useSubagent("Worker", factory)).toBe(config);
      const registry = mockedSubagentRegistry.instances[0];
      expect(registry.register).toHaveBeenCalledWith("Worker", factory, "");
    });

    it("passes through explicit descriptions", () => {
      const config = new AgentConfig();
      const factory = vi.fn();

      config.useSubagent("", factory, "  ");
      const registry = mockedSubagentRegistry.instances[0];
      expect(registry.register).toHaveBeenCalledWith("", factory, "  ");
    });
  });
});
