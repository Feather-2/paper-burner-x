import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  warnSpy,
  createLoggerMock,
  mechanismModules,
} = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  createLoggerMock: vi.fn(),
  mechanismModules: {
    checkpoint: {},
    shared: {},
    backtrack: {},
    discovery: {},
  },
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/internal/checkpoint.js", () => mechanismModules.checkpoint);
vi.mock("../../../../../js/agents/stages/deepsearch/internal/shared-context.js", () => mechanismModules.shared);
vi.mock("../../../../../js/agents/sdk/BacktrackManager.js", () => mechanismModules.backtrack);
vi.mock("../../../../../js/agents/sdk/DiscoveryManager.js", () => mechanismModules.discovery);

const MODULE_PATH = "../../../../../js/agents/runtime/core/mechanisms.js";

let importCounter = 0;

const importFreshMechanisms = async () => {
  importCounter += 1;
  return await import(`${MODULE_PATH}?t=${importCounter}`);
};

const resetModuleExports = (target) => {
  Object.getOwnPropertyNames(target).forEach((key) => {
    delete target[key];
  });
};

const assignModuleExports = (target, exports) => {
  resetModuleExports(target);
  Object.assign(target, exports);
};

const defineExportGetter = (target, name, getter) => {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get: getter,
  });
};

const defineThrowingExport = (target, name, error) => {
  defineExportGetter(target, name, () => {
    throw error;
  });
};

const setupMechanismClasses = (overrides = {}) => {
  const classes = {
    CheckpointManager: overrides.CheckpointManager ?? class CheckpointManager {},
    SharedContext: overrides.SharedContext ?? class SharedContext {},
    BacktrackManager: overrides.BacktrackManager ?? class BacktrackManager {},
    DiscoveryManager: overrides.DiscoveryManager ?? class DiscoveryManager {},
  };

  assignModuleExports(mechanismModules.checkpoint, { CheckpointManager: classes.CheckpointManager });
  assignModuleExports(mechanismModules.shared, { SharedContext: classes.SharedContext });
  assignModuleExports(mechanismModules.backtrack, { BacktrackManager: classes.BacktrackManager });
  assignModuleExports(mechanismModules.discovery, { DiscoveryManager: classes.DiscoveryManager });

  return classes;
};

const buildDeepObject = (depth) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = { index: i };
    cursor = cursor.next;
  }
  return root;
};

beforeEach(() => {
  vi.resetModules();
  warnSpy.mockReset();
  createLoggerMock.mockReset();
  createLoggerMock.mockImplementation(() => ({ warn: warnSpy }));
  resetModuleExports(mechanismModules.checkpoint);
  resetModuleExports(mechanismModules.shared);
  resetModuleExports(mechanismModules.backtrack);
  resetModuleExports(mechanismModules.discovery);
});

describe("loadMechanisms", () => {
  it("loads mechanisms once for concurrent and repeated calls", async () => {
    const accessCounts = {
      checkpoint: 0,
      shared: 0,
      backtrack: 0,
      discovery: 0,
    };
    class Checkpoint {}
    class Shared {}
    class Backtrack {}
    class Discovery {}

    defineExportGetter(mechanismModules.checkpoint, "CheckpointManager", () => {
      accessCounts.checkpoint += 1;
      return Checkpoint;
    });
    defineExportGetter(mechanismModules.shared, "SharedContext", () => {
      accessCounts.shared += 1;
      return Shared;
    });
    defineExportGetter(mechanismModules.backtrack, "BacktrackManager", () => {
      accessCounts.backtrack += 1;
      return Backtrack;
    });
    defineExportGetter(mechanismModules.discovery, "DiscoveryManager", () => {
      accessCounts.discovery += 1;
      return Discovery;
    });

    const mod = await importFreshMechanisms();
    await Promise.all([mod.loadMechanisms(), mod.loadMechanisms()]);
    await mod.loadMechanisms();

    expect(accessCounts.checkpoint).toBe(1);
    expect(accessCounts.shared).toBe(1);
    expect(accessCounts.backtrack).toBe(1);
    expect(accessCounts.discovery).toBe(1);

    const loaded = mod.getMechanismClasses();
    expect(loaded).toMatchObject({
      CheckpointManager: Checkpoint,
      SharedContext: Shared,
      BacktrackManager: Backtrack,
      DiscoveryManager: Discovery,
    });
  });

  it("suppresses warnings for optional missing modules", async () => {
    defineThrowingExport(mechanismModules.checkpoint, "CheckpointManager", new Error("Cannot find module"));
    defineThrowingExport(mechanismModules.shared, "SharedContext", new Error("Failed to resolve module specifier"));
    defineThrowingExport(mechanismModules.backtrack, "BacktrackManager", new Error("module specifier backtrack was not found"));
    defineThrowingExport(mechanismModules.discovery, "DiscoveryManager", new Error("ERR_MODULE_NOT_FOUND"));

    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs warnings for unexpected import errors", async () => {
    defineThrowingExport(mechanismModules.checkpoint, "CheckpointManager", new Error("boom"));
    defineThrowingExport(mechanismModules.shared, "SharedContext", "shared-boom");
    defineThrowingExport(mechanismModules.backtrack, "BacktrackManager", { toString: () => "backtrack-boom" });
    defineThrowingExport(mechanismModules.discovery, "DiscoveryManager", new Error("discovery-boom"));

    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();

    expect(warnSpy).toHaveBeenCalledTimes(4);
    const messages = warnSpy.mock.calls.map((call) => call[0]);
    expect(messages.some((msg) => msg.includes("Failed to load CheckpointManager"))).toBe(true);
    expect(messages.some((msg) => msg.includes("Failed to load SharedContext") && msg.includes("shared-boom"))).toBe(true);
    expect(messages.some((msg) => msg.includes("Failed to load BacktrackManager") && msg.includes("backtrack-boom"))).toBe(true);
    expect(messages.some((msg) => msg.includes("Failed to load DiscoveryManager") && msg.includes("discovery-boom"))).toBe(true);
  });
});

describe("initMechanisms", () => {
  it("initializes shared context and managers with expected options", async () => {
    const sharedInstances = [];
    const backtrackOptions = [];
    const discoveryOptions = [];
    const checkpointOptions = [];

    class SharedContext {
      constructor() {
        sharedInstances.push(this);
      }
    }

    class BacktrackManager {
      constructor(options) {
        backtrackOptions.push(options);
      }
    }

    class DiscoveryManager {
      constructor(options) {
        discoveryOptions.push(options);
      }
    }

    class CheckpointManager {
      constructor(options) {
        checkpointOptions.push(options);
      }
    }

    assignModuleExports(mechanismModules.checkpoint, { CheckpointManager });
    assignModuleExports(mechanismModules.shared, { SharedContext });
    assignModuleExports(mechanismModules.backtrack, { BacktrackManager });
    assignModuleExports(mechanismModules.discovery, { DiscoveryManager });

    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();

    const emit = vi.fn();
    const logger = { warn: vi.fn() };
    const archive = { store: "mem" };
    const loop = { maxBacktracks: 2 };

    mod.initMechanisms(loop, { stageApi: { archive }, emit, logger, runId: "run-1" });

    expect(loop.sharedContext).toBeInstanceOf(SharedContext);
    expect(loop.backtrackManager).toBeInstanceOf(BacktrackManager);
    expect(loop.discoveryManager).toBeInstanceOf(DiscoveryManager);
    expect(loop.checkpoint).toBeInstanceOf(CheckpointManager);

    expect(sharedInstances).toHaveLength(1);
    expect(backtrackOptions[0]).toEqual({
      archive,
      maxBacktracks: 2,
      emit,
      logger,
    });
    expect(discoveryOptions[0]).toEqual({
      sharedContext: loop.sharedContext,
      runId: "run-1",
      logger,
    });
    expect(checkpointOptions[0]).toEqual({
      archive,
      emit,
    });
  });

  it("does not overwrite existing mechanism instances", async () => {
    const sharedCtor = vi.fn();
    const backtrackCtor = vi.fn();
    const discoveryCtor = vi.fn();
    const checkpointCtor = vi.fn();

    class SharedContext {
      constructor() {
        sharedCtor();
      }
    }

    class BacktrackManager {
      constructor() {
        backtrackCtor();
      }
    }

    class DiscoveryManager {
      constructor() {
        discoveryCtor();
      }
    }

    class CheckpointManager {
      constructor() {
        checkpointCtor();
      }
    }

    assignModuleExports(mechanismModules.checkpoint, { CheckpointManager });
    assignModuleExports(mechanismModules.shared, { SharedContext });
    assignModuleExports(mechanismModules.backtrack, { BacktrackManager });
    assignModuleExports(mechanismModules.discovery, { DiscoveryManager });

    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();

    const existing = {
      sharedContext: { existing: "shared" },
      backtrackManager: { existing: "backtrack" },
      discoveryManager: { existing: "discovery" },
      checkpoint: { existing: "checkpoint" },
    };

    const loop = { ...existing, maxBacktracks: 1 };
    mod.initMechanisms(loop, { stageApi: { archive: {} }, emit: vi.fn(), logger: {}, runId: "run" });

    expect(loop.sharedContext).toBe(existing.sharedContext);
    expect(loop.backtrackManager).toBe(existing.backtrackManager);
    expect(loop.discoveryManager).toBe(existing.discoveryManager);
    expect(loop.checkpoint).toBe(existing.checkpoint);
    expect(sharedCtor).not.toHaveBeenCalled();
    expect(backtrackCtor).not.toHaveBeenCalled();
    expect(discoveryCtor).not.toHaveBeenCalled();
    expect(checkpointCtor).not.toHaveBeenCalled();
  });

  it("handles boundary and resource inputs", async () => {
    const backtrackOptions = [];
    const discoveryOptions = [];
    const checkpointOptions = [];

    class SharedContext {}
    class BacktrackManager {
      constructor(options) {
        backtrackOptions.push(options);
      }
    }

    class DiscoveryManager {
      constructor(options) {
        discoveryOptions.push(options);
      }
    }

    class CheckpointManager {
      constructor(options) {
        checkpointOptions.push(options);
      }
    }

    assignModuleExports(mechanismModules.checkpoint, { CheckpointManager });
    assignModuleExports(mechanismModules.shared, { SharedContext });
    assignModuleExports(mechanismModules.backtrack, { BacktrackManager });
    assignModuleExports(mechanismModules.discovery, { DiscoveryManager });

    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();

    const hugeString = "x".repeat(1024 * 512);
    const longString = "r".repeat(4096);
    const deep = buildDeepObject(40);
    const arrayLike = { 0: "blob", length: 1 };
    const resourceArchive = { content: hugeString, deep };

    const cases = [
      {
        label: "nulls",
        loop: { maxBacktracks: null },
        options: { stageApi: null, emit: null, logger: null, runId: null },
        expectedArchive: undefined,
        expectedMax: 3,
      },
      {
        label: "undefined and empty string",
        loop: {},
        options: { stageApi: undefined, emit: undefined, logger: undefined, runId: "" },
        expectedArchive: undefined,
        expectedMax: 3,
      },
      {
        label: "empty containers and whitespace",
        loop: { maxBacktracks: 0 },
        options: { stageApi: [], emit: [], logger: {}, runId: "   " },
        expectedArchive: undefined,
        expectedMax: 0,
      },
      {
        label: "negative and array-like objects",
        loop: { maxBacktracks: -1 },
        options: { stageApi: { archive: arrayLike }, emit: { 0: "e", length: 0 }, logger: "", runId: { id: "obj" } },
        expectedArchive: arrayLike,
        expectedMax: -1,
      },
      {
        label: "string-number and deep resources",
        loop: { maxBacktracks: "5" },
        options: { stageApi: { archive: resourceArchive }, emit: () => {}, logger: { warn: vi.fn() }, runId: longString },
        expectedArchive: resourceArchive,
        expectedMax: "5",
      },
      {
        label: "max safe integer",
        loop: { maxBacktracks: Number.MAX_SAFE_INTEGER },
        options: { stageApi: { archive: hugeString }, emit: undefined, logger: undefined, runId: longString },
        expectedArchive: hugeString,
        expectedMax: Number.MAX_SAFE_INTEGER,
      },
    ];

    cases.forEach((testCase, index) => {
      const loop = { ...testCase.loop };
      mod.initMechanisms(loop, testCase.options);

      expect(loop.sharedContext).toBeInstanceOf(SharedContext);
      expect(loop.backtrackManager).toBeInstanceOf(BacktrackManager);
      expect(loop.discoveryManager).toBeInstanceOf(DiscoveryManager);
      expect(loop.checkpoint).toBeInstanceOf(CheckpointManager);

      const backtrack = backtrackOptions[index];
      const discovery = discoveryOptions[index];
      const checkpoint = checkpointOptions[index];

      expect(backtrack.archive).toBe(testCase.expectedArchive);
      expect(backtrack.maxBacktracks).toBe(testCase.expectedMax);
      expect(backtrack.emit).toBe(testCase.options.emit);
      expect(backtrack.logger).toBe(testCase.options.logger);

      expect(discovery.sharedContext).toBe(loop.sharedContext);
      expect(discovery.runId).toBe(testCase.options.runId);
      expect(discovery.logger).toBe(testCase.options.logger);

      expect(checkpoint.archive).toBe(testCase.expectedArchive);
      expect(checkpoint.emit).toBe(testCase.options.emit);
    });

    expect(backtrackOptions).toHaveLength(cases.length);
    expect(discoveryOptions).toHaveLength(cases.length);
    expect(checkpointOptions).toHaveLength(cases.length);
  });

  it("throws when loop is null or undefined", async () => {
    setupMechanismClasses();
    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();
    expect(() => mod.initMechanisms(null)).toThrow();
    expect(() => mod.initMechanisms(undefined)).toThrow();
  });
});

describe("getMechanismClasses", () => {
  it("returns null classes before load", async () => {
    const mod = await importFreshMechanisms();
    const classes = mod.getMechanismClasses();

    expect(classes).toEqual({
      CheckpointManager: null,
      SharedContext: null,
      BacktrackManager: null,
      DiscoveryManager: null,
    });
  });

  it("returns loaded class references after loadMechanisms", async () => {
    const classes = setupMechanismClasses();
    const mod = await importFreshMechanisms();
    await mod.loadMechanisms();

    const loaded = mod.getMechanismClasses();
    expect(loaded).toMatchObject(classes);
  });
});

describe("CheckpointManager", () => {
  it("is null before load and set after load", async () => {
    class CheckpointManager {}
    setupMechanismClasses({ CheckpointManager });

    const mod = await importFreshMechanisms();
    expect(mod.CheckpointManager).toBe(null);
    await mod.loadMechanisms();
    expect(mod.CheckpointManager).toBe(CheckpointManager);
  });
});

describe("SharedContext", () => {
  it("is null before load and set after load", async () => {
    class SharedContext {}
    setupMechanismClasses({ SharedContext });

    const mod = await importFreshMechanisms();
    expect(mod.SharedContext).toBe(null);
    await mod.loadMechanisms();
    expect(mod.SharedContext).toBe(SharedContext);
  });
});

describe("BacktrackManager", () => {
  it("is null before load and set after load", async () => {
    class BacktrackManager {}
    setupMechanismClasses({ BacktrackManager });

    const mod = await importFreshMechanisms();
    expect(mod.BacktrackManager).toBe(null);
    await mod.loadMechanisms();
    expect(mod.BacktrackManager).toBe(BacktrackManager);
  });
});

describe("DiscoveryManager", () => {
  it("is null before load and set after load", async () => {
    class DiscoveryManager {}
    setupMechanismClasses({ DiscoveryManager });

    const mod = await importFreshMechanisms();
    expect(mod.DiscoveryManager).toBe(null);
    await mod.loadMechanisms();
    expect(mod.DiscoveryManager).toBe(DiscoveryManager);
  });
});
