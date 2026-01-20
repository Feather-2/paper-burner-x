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
  class MemoryStore {}
  class UnifiedAgentContext {}

  class SkillsDefault {}
  class BudgetDefault {}
  class CheckpointDefault {}
  class SharedDefault {}
  class BacktrackDefault {}
  class DiscoveryDefault {}
  class MemoryDefault {}
  class UnifiedDefault {}

  const classes = {
    SkillsManager,
    BudgetManager,
    CheckpointManager,
    SharedContext,
    BacktrackManager,
    DiscoveryManager,
    MemoryStore,
    UnifiedAgentContext,
  };

  const defaults = {
    SkillsManager: SkillsDefault,
    BudgetManager: BudgetDefault,
    CheckpointManager: CheckpointDefault,
    SharedContext: SharedDefault,
    BacktrackManager: BacktrackDefault,
    DiscoveryManager: DiscoveryDefault,
    MemoryStore: MemoryDefault,
    UnifiedAgentContext: UnifiedDefault,
  };

  const state = {
    named: {
      skills: true,
      budget: true,
      checkpoint: true,
      shared: true,
      backtrack: true,
      discovery: true,
      memory: true,
      unified: true,
    },
    defaults: {
      skills: true,
      budget: true,
      checkpoint: true,
      shared: true,
      backtrack: true,
      discovery: true,
      memory: true,
      unified: true,
    },
    throws: {
      skills: NO_THROW,
      budget: NO_THROW,
      checkpoint: NO_THROW,
      shared: NO_THROW,
      backtrack: NO_THROW,
      discovery: NO_THROW,
      memory: NO_THROW,
      unified: NO_THROW,
    },
    delays: {
      skills: null,
      budget: null,
      checkpoint: null,
      shared: null,
      backtrack: null,
      discovery: null,
      memory: null,
      unified: null,
    },
    importCounts: {
      skills: 0,
      budget: 0,
      checkpoint: 0,
      shared: 0,
      backtrack: 0,
      discovery: 0,
      memory: 0,
      unified: 0,
    },
    accessCounts: {
      skills: 0,
      budget: 0,
      checkpoint: 0,
      shared: 0,
      backtrack: 0,
      discovery: 0,
      memory: 0,
      unified: 0,
    },
  };

  const reset = () => {
    Object.keys(state.named).forEach((key) => {
      state.named[key] = true;
      state.defaults[key] = true;
      state.throws[key] = NO_THROW;
      state.delays[key] = null;
      state.importCounts[key] = 0;
      state.accessCounts[key] = 0;
    });
  };

  const createCapabilityMock = (key, exportName) => async () => {
    state.importCounts[key] += 1;
    const delay = state.delays[key];
    if (delay) await delay;

    const exports = {};
    Object.defineProperty(exports, exportName, {
      enumerable: true,
      get: () => {
        state.accessCounts[key] += 1;
        const failure = state.throws[key];
        if (failure !== NO_THROW) throw failure;
        if (!state.named[key]) return undefined;
        return classes[exportName];
      },
    });
    Object.defineProperty(exports, "default", {
      enumerable: true,
      get: () => {
        state.accessCounts[key] += 1;
        const failure = state.throws[key];
        if (failure !== NO_THROW) throw failure;
        if (!state.defaults[key]) return undefined;
        return defaults[exportName];
      },
    });
    return exports;
  };

  return {
    NO_THROW,
    classes,
    defaults,
    state,
    reset,
    createCapabilityMock,
  };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: mockedCreateLogger.createLogger,
}));

vi.mock("/js/agents/skills/index.js", mockedModules.createCapabilityMock("skills", "SkillsManager"));
vi.mock("/js/agents/shared/utils/budget.js", mockedModules.createCapabilityMock("budget", "BudgetManager"));
vi.mock("/js/agents/stages/deepsearch/internal/checkpoint.js", mockedModules.createCapabilityMock("checkpoint", "CheckpointManager"));
vi.mock("/js/agents/stages/deepsearch/internal/shared-context.js", mockedModules.createCapabilityMock("shared", "SharedContext"));
vi.mock("/js/agents/stages/deepsearch/internal/backtrack-manager.js", mockedModules.createCapabilityMock("backtrack", "BacktrackManager"));
vi.mock("/js/agents/sdk/DiscoveryManager.js", mockedModules.createCapabilityMock("discovery", "DiscoveryManager"));
vi.mock("/js/agents/runtime/memory/memory-store.js", mockedModules.createCapabilityMock("memory", "MemoryStore"), {
  virtual: true,
});
vi.mock("/js/agents/runtime/context/unified-agent-context.js", mockedModules.createCapabilityMock("unified", "UnifiedAgentContext"), {
  virtual: true,
});

async function loadCapabilitiesLoader() {
  return await import("../../../../../js/agents/stages/deepsearch/capabilities-loader.js");
}

function makeDeepObject(depth) {
  let node = { depth: 0 };
  for (let i = 1; i <= depth; i++) {
    node = { depth: i, next: node };
  }
  return node;
}

describe("loadDeepSearchCapabilities", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockedModules.reset();
  });

  it("loads capabilities using named exports when available", async () => {
    const { loadDeepSearchCapabilities } = await loadCapabilitiesLoader();

    const result = await loadDeepSearchCapabilities();

    expect(mockedCreateLogger.createLogger).toHaveBeenCalledWith("stages/deepsearch/capabilities-loader");
    expect(result.SkillsManager).toBe(mockedModules.classes.SkillsManager);
    expect(result.BudgetManager).toBe(mockedModules.classes.BudgetManager);
    expect(result.CheckpointManager).toBe(mockedModules.classes.CheckpointManager);
    expect(result.SharedContext).toBe(mockedModules.classes.SharedContext);
    expect(result.BacktrackManager).toBe(mockedModules.classes.BacktrackManager);
    expect(result.DiscoveryManager).toBe(mockedModules.classes.DiscoveryManager);
    expect(result.MemoryStore).toBe(mockedModules.classes.MemoryStore);
    expect(result.UnifiedAgentContext).toBe(mockedModules.classes.UnifiedAgentContext);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  it("falls back to default exports when named exports are missing", async () => {
    mockedModules.state.named.budget = false;
    mockedModules.state.named.shared = false;
    mockedModules.state.named.unified = false;

    const { loadDeepSearchCapabilities } = await loadCapabilitiesLoader();

    const result = await loadDeepSearchCapabilities();

    expect(result.BudgetManager).toBe(mockedModules.defaults.BudgetManager);
    expect(result.SharedContext).toBe(mockedModules.defaults.SharedContext);
    expect(result.UnifiedAgentContext).toBe(mockedModules.defaults.UnifiedAgentContext);
    expect(result.SkillsManager).toBe(mockedModules.classes.SkillsManager);
    expect(result.BacktrackManager).toBe(mockedModules.classes.BacktrackManager);
  });

  it("warns and leaves null when imports fail", async () => {
    mockedModules.state.throws.budget = new Error("budget down");
    mockedModules.state.throws.shared = 0;

    const { loadDeepSearchCapabilities } = await loadCapabilitiesLoader();

    const result = await loadDeepSearchCapabilities();

    expect(result.BudgetManager).toBeNull();
    expect(result.SharedContext).toBeNull();
    expect(result.SkillsManager).toBe(mockedModules.classes.SkillsManager);
    expect(mockedLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockedLogger.warn).toHaveBeenCalledWith("[deepsearch] Failed to load BudgetManager: budget down");
    expect(mockedLogger.warn).toHaveBeenCalledWith("[deepsearch] Failed to load SharedContext: 0");
  });

  it("coalesces concurrent calls into a single in-flight load", async () => {
    const { loadDeepSearchCapabilities } = await loadCapabilitiesLoader();

    const firstPromise = loadDeepSearchCapabilities();
    const secondPromise = loadDeepSearchCapabilities();

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    expect(firstResult).toBe(secondResult);
  });

  it("returns the cached result for rapid successive calls", async () => {
    const { loadDeepSearchCapabilities } = await loadCapabilitiesLoader();

    const first = await loadDeepSearchCapabilities();
    const second = await loadDeepSearchCapabilities();

    expect(second).toBe(first);
  });

  it("ignores boundary and resource arguments", async () => {
    const hugeFile = new Uint8Array(1024 * 1024);
    const longString = "x".repeat(200000);
    const deepNested = makeDeepObject(80);

    const { loadDeepSearchCapabilities } = await loadCapabilitiesLoader();

    const result = await loadDeepSearchCapabilities(
      null,
      undefined,
      "",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ",
      "123",
      { 0: "x", length: 1 },
      hugeFile,
      longString,
      deepNested,
    );

    expect(result).toBeTruthy();
    expect(result.SkillsManager).toBe(mockedModules.classes.SkillsManager);
    expect(result.BudgetManager).toBe(mockedModules.classes.BudgetManager);
  });
});
