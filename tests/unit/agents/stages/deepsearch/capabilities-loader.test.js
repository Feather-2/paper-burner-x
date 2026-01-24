import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
}));

const mockedCreateLogger = vi.hoisted(() => ({
  createLogger: vi.fn(() => mockedLogger),
}));

const mockedModules = vi.hoisted(() => {
  const NO_THROW = Symbol("no_throw");

  class SkillsManager {}
  class BudgetManager {}
  class CheckpointManager {}
  class SharedContext {}
  class BacktrackManager {}
  class DiscoveryManager {}

  class SkillsDefault {}
  class BudgetDefault {}
  class CheckpointDefault {}
  class SharedDefault {}
  class BacktrackDefault {}
  class DiscoveryDefault {}

  const classes = {
    SkillsManager,
    BudgetManager,
    CheckpointManager,
    SharedContext,
    BacktrackManager,
    DiscoveryManager,
  };

  const defaults = {
    SkillsManager: SkillsDefault,
    BudgetManager: BudgetDefault,
    CheckpointManager: CheckpointDefault,
    SharedContext: SharedDefault,
    BacktrackManager: BacktrackDefault,
    DiscoveryManager: DiscoveryDefault,
  };

  const state = {
    named: {
      skills: true,
      budget: true,
      checkpoint: true,
      shared: true,
      backtrack: true,
      discovery: true,
    },
    defaults: {
      skills: true,
      budget: true,
      checkpoint: true,
      shared: true,
      backtrack: true,
      discovery: true,
    },
    throws: {
      skills: NO_THROW,
      budget: NO_THROW,
      checkpoint: NO_THROW,
      shared: NO_THROW,
      backtrack: NO_THROW,
      discovery: NO_THROW,
    },
    delays: {
      skills: null,
      budget: null,
      checkpoint: null,
      shared: null,
      backtrack: null,
      discovery: null,
    },
  };

  const reset = () => {
    Object.keys(state.named).forEach((key) => {
      state.named[key] = true;
      state.defaults[key] = true;
      state.throws[key] = NO_THROW;
      state.delays[key] = null;
    });
  };

  const createCapabilityMock = (key, exportName) => async () => {
    const delay = state.delays[key];
    if (delay) await delay;

    const exports = {};

    Object.defineProperty(exports, exportName, {
      enumerable: true,
      get: () => {
        const failure = state.throws[key];
        if (failure !== NO_THROW) throw failure;
        if (!state.named[key]) return undefined;
        return classes[exportName];
      },
    });

    Object.defineProperty(exports, "default", {
      enumerable: true,
      get: () => {
        const failure = state.throws[key];
        if (failure !== NO_THROW) throw failure;
        if (!state.defaults[key]) return undefined;
        return defaults[exportName];
      },
    });

    return exports;
  };

  return {
    classes,
    defaults,
    state,
    reset,
    createCapabilityMock,
  };
});

vi.mock("/js/agents/shared/index.js", () => ({
  createLogger: mockedCreateLogger.createLogger,
}));

vi.mock("/js/agents/skills/index.js", mockedModules.createCapabilityMock("skills", "SkillsManager"));
vi.mock("/js/agents/shared/utils/budget.js", mockedModules.createCapabilityMock("budget", "BudgetManager"));
vi.mock(
  "/js/agents/stages/deepsearch/internal/checkpoint.js",
  mockedModules.createCapabilityMock("checkpoint", "CheckpointManager"),
);
vi.mock(
  "/js/agents/stages/deepsearch/internal/shared-context.js",
  mockedModules.createCapabilityMock("shared", "SharedContext"),
);
vi.mock(
  "/js/agents/stages/deepsearch/internal/backtrack-manager.js",
  mockedModules.createCapabilityMock("backtrack", "BacktrackManager"),
);
vi.mock(
  "/js/agents/sdk/DiscoveryManager.js",
  mockedModules.createCapabilityMock("discovery", "DiscoveryManager"),
);

async function loadSubject() {
  return await import("/js/agents/stages/deepsearch/capabilities-loader.js");
}

const EXPECTED_CAPABILITY_KEYS = [
  "SkillsManager",
  "BudgetManager",
  "CheckpointManager",
  "SharedContext",
  "BacktrackManager",
  "DiscoveryManager",
  "MemoryStore",
  "UnifiedAgentContext",
];

const NAMED_EXPORT_CASES = [
  { name: "SkillsManager", moduleKey: "skills", capabilityKey: "SkillsManager" },
  { name: "BudgetManager", moduleKey: "budget", capabilityKey: "BudgetManager" },
  { name: "CheckpointManager", moduleKey: "checkpoint", capabilityKey: "CheckpointManager" },
  { name: "SharedContext", moduleKey: "shared", capabilityKey: "SharedContext" },
  { name: "BacktrackManager", moduleKey: "backtrack", capabilityKey: "BacktrackManager" },
  { name: "DiscoveryManager", moduleKey: "discovery", capabilityKey: "DiscoveryManager" },
];

describe("loadDeepSearchCapabilities", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockedModules.reset();
  });

  it("should_create_logger_when_module_is_imported", async () => {
    await loadSubject();
    expect(mockedCreateLogger.createLogger).toHaveBeenCalledWith("stages/deepsearch/capabilities-loader");
  });

  it("should_return_capabilities_object_with_expected_keys_when_called", async () => {
    const subject = await loadSubject();
    const result = await subject.loadDeepSearchCapabilities();
    expect(Object.keys(result).sort()).toEqual([...EXPECTED_CAPABILITY_KEYS].sort());
  });

  it.each(NAMED_EXPORT_CASES)(
    "should_return_named_export_when_named_export_is_available_for_$name",
    async ({ moduleKey, capabilityKey }) => {
      mockedModules.state.named[moduleKey] = true;
      const subject = await loadSubject();
      const result = await subject.loadDeepSearchCapabilities();
      expect(result[capabilityKey]).toBe(mockedModules.classes[capabilityKey]);
    },
  );

  it.each(NAMED_EXPORT_CASES)(
    "should_return_default_export_when_named_export_is_missing_for_$name",
    async ({ moduleKey, capabilityKey }) => {
      mockedModules.state.named[moduleKey] = false;
      mockedModules.state.defaults[moduleKey] = true;
      const subject = await loadSubject();
      const result = await subject.loadDeepSearchCapabilities();
      expect(result[capabilityKey]).toBe(mockedModules.defaults[capabilityKey]);
    },
  );

  it("should_return_null_when_budget_manager_export_throws", async () => {
    mockedModules.state.throws.budget = new Error("budget down");
    const subject = await loadSubject();
    const result = await subject.loadDeepSearchCapabilities();
    expect(result.BudgetManager).toBeNull();
  });

  it("should_warn_when_budget_manager_export_throws", async () => {
    mockedModules.state.throws.budget = new Error("budget down");
    const subject = await loadSubject();
    await subject.loadDeepSearchCapabilities();
    const warned = mockedLogger.warn.mock.calls.some(([msg]) =>
      msg.includes("Failed to load BudgetManager: budget down"),
    );
    expect(warned).toBe(true);
  });

  it("should_stringify_thrown_value_when_shared_context_export_throws_non_error", async () => {
    mockedModules.state.throws.shared = 0;
    const subject = await loadSubject();
    await subject.loadDeepSearchCapabilities();
    const warned = mockedLogger.warn.mock.calls.some(([msg]) =>
      msg.includes("Failed to load SharedContext: 0"),
    );
    expect(warned).toBe(true);
  });

  it("should_return_same_instance_when_called_concurrently", async () => {
    let release = null;
    mockedModules.state.delays.skills = new Promise((resolve) => {
      release = resolve;
    });

    const subject = await loadSubject();

    const first = subject.loadDeepSearchCapabilities();
    const second = subject.loadDeepSearchCapabilities();
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
  });

  it("should_return_cached_instance_when_called_after_resolution", async () => {
    const subject = await loadSubject();
    const first = await subject.loadDeepSearchCapabilities();
    const second = await subject.loadDeepSearchCapabilities();
    expect(second).toBe(first);
  });

  it("should_warn_when_memory_store_module_is_missing", async () => {
    const subject = await loadSubject();
    await subject.loadDeepSearchCapabilities();
    const warned = mockedLogger.warn.mock.calls.some(([msg]) =>
      msg.startsWith("[deepsearch] Failed to load MemoryStore:"),
    );
    expect(warned).toBe(true);
  });

  it("should_warn_when_unified_agent_context_module_is_missing", async () => {
    const subject = await loadSubject();
    await subject.loadDeepSearchCapabilities();
    const warned = mockedLogger.warn.mock.calls.some(([msg]) =>
      msg.startsWith("[deepsearch] Failed to load UnifiedAgentContext:"),
    );
    expect(warned).toBe(true);
  });

  it("should_return_null_when_memory_store_import_fails", async () => {
    const subject = await loadSubject();
    const result = await subject.loadDeepSearchCapabilities();
    expect(result.MemoryStore).toBeNull();
  });

  it("should_return_null_when_unified_agent_context_import_fails", async () => {
    const subject = await loadSubject();
    const result = await subject.loadDeepSearchCapabilities();
    expect(result.UnifiedAgentContext).toBeNull();
  });
});