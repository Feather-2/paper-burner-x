import { describe, it, expect, vi, beforeEach } from "vitest";

const LONG_STRING = "a".repeat(10000);
const HUGE_BODY = "b".repeat(1024 * 1024);
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function makeDeepNested(depth = 20) {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i < depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function importIndex() {
  return await import("../../../../js/agents/skills/index.js");
}

async function importIndexWithLoaderMocks({ nodeLike = true } = {}) {
  const nodeMocks = {
    loadSkills: vi.fn(),
    loadSkillFromPath: vi.fn(),
    loadSkillsFromNexus: vi.fn(),
    loadAllSkills: vi.fn(),
  };
  const browserMocks = {
    loadSkills: vi.fn(),
    loadSkillFromPath: vi.fn(),
    loadSkillsFromNexus: vi.fn(),
    loadAllSkills: vi.fn(),
  };
  const moduleLoads = { node: 0, browser: 0 };

  vi.doMock("../../../../js/agents/shared/index.js", async () => {
    const actual = await vi.importActual("../../../../js/agents/shared/index.js");
    return {
      ...actual,
      isNodeLike: vi.fn(() => nodeLike),
    };
  });

  vi.doMock("../../../../js/agents/skills/loader.node.js", () => {
    moduleLoads.node += 1;
    const defaults = {
      loadSkills: nodeMocks.loadSkills,
      loadSkillFromPath: nodeMocks.loadSkillFromPath,
      loadSkillsFromNexus: nodeMocks.loadSkillsFromNexus,
      loadAllSkills: nodeMocks.loadAllSkills,
    };
    return {
      ...defaults,
      default: defaults,
    };
  });

  vi.doMock("../../../../js/agents/skills/loader.browser.js", () => {
    moduleLoads.browser += 1;
    const defaults = {
      loadSkills: browserMocks.loadSkills,
      loadSkillFromPath: browserMocks.loadSkillFromPath,
      loadSkillsFromNexus: browserMocks.loadSkillsFromNexus,
      loadAllSkills: browserMocks.loadAllSkills,
    };
    return {
      ...defaults,
      default: defaults,
    };
  });

  const mod = await import("../../../../js/agents/skills/index.js");
  return { mod, nodeMocks, browserMocks, moduleLoads };
}

async function importIndexWithManagerMocks({ loadSkillsImpl, renderSkillsListImpl } = {}) {
  const loadSkills = vi.fn(loadSkillsImpl ?? (async () => ({ skills: [], errors: [] })));
  const loadSkillFromPath = vi.fn();
  const loadSkillsFromNexus = vi.fn();
  const loadAllSkills = vi.fn();

  vi.doMock("../../../../js/agents/skills/loader.js", () => ({
    loadSkills,
    loadSkillFromPath,
    loadSkillsFromNexus,
    loadAllSkills,
    default: { loadSkills, loadSkillFromPath, loadSkillsFromNexus, loadAllSkills },
  }));

  const renderSkillsSection = vi.fn(() => "section");
  const renderSkillsList = vi.fn(renderSkillsListImpl ?? (() => "list"));

  vi.doMock("../../../../js/agents/skills/render.js", () => ({
    renderSkillsSection,
    renderSkillsList,
    default: { renderSkillsSection, renderSkillsList },
  }));

  const mod = await import("../../../../js/agents/skills/index.js");
  return {
    mod,
    mocks: {
      loadSkills,
      loadSkillFromPath,
      loadSkillsFromNexus,
      loadAllSkills,
      renderSkillsList,
      renderSkillsSection,
    },
  };
}

function buildSkillExecutorMock() {
  const instances = [];
  class SkillExecutorMock {
    constructor(options = {}) {
      this.options = options;
      this.execute = vi.fn(async (skill, context) => ({ skill, context }));
      this.executeMany = vi.fn(async (skills, context) => ({ skills, context }));
      this.dispose = vi.fn();
      instances.push(this);
    }
  }
  return { SkillExecutorMock, instances };
}

async function importIndexWithSandboxMocks({ managerClass } = {}) {
  const { SkillExecutorMock, instances } = buildSkillExecutorMock();

  vi.doMock("../../../../js/agents/core/sandbox/skill-executor.js", () => ({
    SkillExecutor: SkillExecutorMock,
  }));

  if (managerClass) {
    vi.doMock("../../../../js/agents/skills/manager.js", () => ({
      SkillsManager: managerClass,
      default: managerClass,
    }));
  }

  const mod = await import("../../../../js/agents/skills/index.js");
  return { mod, instances };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("SkillScope", () => {
  it("exposes frozen scope values (normal)", async () => {
    const { SkillScope } = await importIndex();

    expect(SkillScope.SYSTEM).toBe("system");
    expect(SkillScope.USER).toBe("user");
    expect(SkillScope.REPO).toBe("repo");
    expect(SkillScope.REMOTE).toBe("remote");
    expect(Object.isFrozen(SkillScope)).toBe(true);
  });

  it("returns undefined for empty or unknown keys (boundary)", async () => {
    const { SkillScope } = await importIndex();

    expect(SkillScope[""]).toBeUndefined();
    expect(SkillScope[null]).toBeUndefined();
    expect(SkillScope[undefined]).toBeUndefined();
  });

  it("throws on mutation attempts (error)", async () => {
    const { SkillScope } = await importIndex();

    expect(() => {
      Object.defineProperty(SkillScope, "NEW", { value: "x" });
    }).toThrow();
  });
});

describe("loadSkills", () => {
  it("uses node implementation and returns outcome (normal)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    const outcome = { skills: [], errors: [] };
    nodeMocks.loadSkills.mockResolvedValue(outcome);

    const result = await mod.loadSkills({ cwd: "/repo" });

    expect(nodeMocks.loadSkills).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(result).toBe(outcome);
  });

  it("uses browser implementation when not node-like (normal)", async () => {
    const { mod, browserMocks, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: false });
    const outcome = { skills: ["alpha"], errors: [] };
    browserMocks.loadSkills.mockResolvedValue(outcome);

    const result = await mod.loadSkills({ manifestUrl: "/skills/manifest.json" });

    expect(browserMocks.loadSkills).toHaveBeenCalledWith({ manifestUrl: "/skills/manifest.json" });
    expect(nodeMocks.loadSkills).not.toHaveBeenCalled();
    expect(result).toBe(outcome);
  });

  it("passes boundary options and defaults (boundary)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadSkills.mockResolvedValue({ skills: [], errors: [] });

    await mod.loadSkills();
    await mod.loadSkills(null);
    await mod.loadSkills({ maxManifestBytes: 0 });
    await mod.loadSkills({ maxManifestBytes: -1 });
    await mod.loadSkills({ maxManifestBytes: MAX_SAFE });

    expect(nodeMocks.loadSkills).toHaveBeenNthCalledWith(1, {});
    expect(nodeMocks.loadSkills).toHaveBeenNthCalledWith(2, null);
    expect(nodeMocks.loadSkills).toHaveBeenNthCalledWith(3, { maxManifestBytes: 0 });
    expect(nodeMocks.loadSkills).toHaveBeenNthCalledWith(4, { maxManifestBytes: -1 });
    expect(nodeMocks.loadSkills).toHaveBeenNthCalledWith(5, { maxManifestBytes: MAX_SAFE });
  });

  it("rejects when implementation throws (error)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadSkills.mockRejectedValue(new Error("boom"));

    await expect(mod.loadSkills({ cwd: "/repo" })).rejects.toThrow("boom");
  });

  it("supports concurrent calls with shared implementation (concurrency)", async () => {
    const { mod, nodeMocks, moduleLoads } = await importIndexWithLoaderMocks({ nodeLike: true });
    const deferred = createDeferred();
    nodeMocks.loadSkills.mockImplementation(() => deferred.promise);

    const first = mod.loadSkills({ cwd: "a" });
    const second = mod.loadSkills({ cwd: "b" });

    deferred.resolve({ skills: [], errors: [] });

    const results = await Promise.all([first, second]);

    expect(moduleLoads.node).toBe(1);
    expect(nodeMocks.loadSkills).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { skills: [], errors: [] },
      { skills: [], errors: [] },
    ]);
  });
});

describe("loadSkillFromPath", () => {
  it("loads a skill via implementation (normal)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    const outcome = {
      metadata: { name: "One", description: "d", path: "/path/skill", scope: "repo" },
      body: "body",
    };
    nodeMocks.loadSkillFromPath.mockResolvedValue(outcome);

    const result = await mod.loadSkillFromPath("/path/skill", "repo", { maxSkillBytes: 1024 });

    expect(nodeMocks.loadSkillFromPath).toHaveBeenCalledWith("/path/skill", "repo", { maxSkillBytes: 1024 });
    expect(result).toBe(outcome);
  });

  it("passes empty, whitespace, long, and typed inputs (boundary)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    const longPath = `/${LONG_STRING}`;
    const outcome = {
      metadata: { name: "Big", description: "d", path: longPath, scope: "repo" },
      body: HUGE_BODY,
    };
    nodeMocks.loadSkillFromPath.mockResolvedValue(outcome);

    await mod.loadSkillFromPath("", "repo", {});
    await mod.loadSkillFromPath("   ", "repo");
    const result = await mod.loadSkillFromPath(longPath, "repo", { maxSkillBytes: MAX_SAFE });
    await mod.loadSkillFromPath(123, "repo");

    expect(nodeMocks.loadSkillFromPath).toHaveBeenNthCalledWith(1, "", "repo", {});
    expect(nodeMocks.loadSkillFromPath).toHaveBeenNthCalledWith(2, "   ", "repo", undefined);
    expect(nodeMocks.loadSkillFromPath).toHaveBeenNthCalledWith(3, longPath, "repo", { maxSkillBytes: MAX_SAFE });
    expect(nodeMocks.loadSkillFromPath).toHaveBeenNthCalledWith(4, 123, "repo", undefined);
    expect(result.body.length).toBe(HUGE_BODY.length);
  });

  it("rejects when implementation throws (error)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadSkillFromPath.mockRejectedValue(new Error("boom"));

    await expect(mod.loadSkillFromPath("/path/skill", "repo")).rejects.toThrow("boom");
  });
});

describe("loadSkillsFromNexus", () => {
  it("loads remote skills from provider (normal)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    const provider = { name: "provider" };
    const outcome = { skills: ["alpha"], errors: [] };
    nodeMocks.loadSkillsFromNexus.mockResolvedValue(outcome);

    const result = await mod.loadSkillsFromNexus(provider);

    expect(nodeMocks.loadSkillsFromNexus).toHaveBeenCalledWith(provider);
    expect(result).toBe(outcome);
  });

  it("accepts empty or null providers (boundary)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadSkillsFromNexus.mockResolvedValue({ skills: [], errors: [] });

    await mod.loadSkillsFromNexus({});
    await mod.loadSkillsFromNexus(null);

    expect(nodeMocks.loadSkillsFromNexus).toHaveBeenNthCalledWith(1, {});
    expect(nodeMocks.loadSkillsFromNexus).toHaveBeenNthCalledWith(2, null);
  });

  it("rejects when implementation throws (error)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadSkillsFromNexus.mockRejectedValue(new Error("boom"));

    await expect(mod.loadSkillsFromNexus({})).rejects.toThrow("boom");
  });
});

describe("loadAllSkills", () => {
  it("loads all skills via implementation (normal)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    const outcome = { skills: ["alpha"], errors: [] };
    nodeMocks.loadAllSkills.mockResolvedValue(outcome);

    const result = await mod.loadAllSkills({ cwd: "/repo" });

    expect(nodeMocks.loadAllSkills).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(result).toBe(outcome);
  });

  it("defaults options and keeps boundary values (boundary)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadAllSkills.mockResolvedValue({ skills: [], errors: [] });

    await mod.loadAllSkills();
    await mod.loadAllSkills({ maxManifestBytes: 0 });

    expect(nodeMocks.loadAllSkills).toHaveBeenNthCalledWith(1, {});
    expect(nodeMocks.loadAllSkills).toHaveBeenNthCalledWith(2, { maxManifestBytes: 0 });
  });

  it("rejects when implementation throws (error)", async () => {
    const { mod, nodeMocks } = await importIndexWithLoaderMocks({ nodeLike: true });
    nodeMocks.loadAllSkills.mockRejectedValue(new Error("boom"));

    await expect(mod.loadAllSkills({ cwd: "/repo" })).rejects.toThrow("boom");
  });
});

describe("SkillsManager", () => {
  it("loads skills and caches rapid consecutive calls (normal)", async () => {
    const outcome = {
      skills: [
        {
          metadata: {
            name: "Alpha",
            description: "A",
            path: "/alpha",
            scope: "repo",
            keywords: [],
          },
          body: "body",
        },
      ],
      errors: [],
    };
    const { mod, mocks } = await importIndexWithManagerMocks({ loadSkillsImpl: async () => outcome });
    const manager = new mod.SkillsManager({ homeDir: "/home", manifestUrl: " http://manifest " });

    const result = await manager.getSkillsForCwd("/repo");
    await manager.getSkillsForCwd("/repo");

    expect(result).toBe(outcome);
    expect(mocks.loadSkills).toHaveBeenCalledWith({
      cwd: "/repo",
      homeDir: "/home",
      manifestUrl: "http://manifest",
    });
    expect(mocks.loadSkills).toHaveBeenCalledTimes(1);
  });

  it("normalizes cache options and handles empty inputs (boundary)", async () => {
    const { mod, mocks } = await importIndexWithManagerMocks();
    mocks.loadSkills.mockResolvedValue({ skills: [], errors: [] });

    const manager = new mod.SkillsManager({
      homeDir: "/home",
      cacheTtlMs: "-1",
      cacheMaxEntries: "0",
    });

    expect(manager.cacheTtlMs).toBe(0);
    expect(manager.cacheMaxEntries).toBe(1);

    await manager.getSkillsForCwd("", true);
    await manager.getSkillsForCwd(null, true);

    expect(mocks.loadSkills).toHaveBeenNthCalledWith(1, { cwd: "", homeDir: "/home" });
    expect(mocks.loadSkills).toHaveBeenNthCalledWith(2, { cwd: null, homeDir: "/home" });
  });

  it("captures remote provider errors (error)", async () => {
    const { mod, mocks } = await importIndexWithManagerMocks();
    mocks.loadSkills.mockResolvedValue({ skills: [], errors: [] });

    const remoteProvider = {
      listSkills: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const manager = new mod.SkillsManager({ homeDir: "/home", remoteProvider });

    const outcome = await manager.getSkillsForCwd("/repo", true);

    expect(outcome.errors).toEqual([
      {
        path: "remote://",
        message: "boom",
      },
    ]);
  });
});

describe("renderSkillsSection", () => {
  it("renders prioritized skills with normalized paths (normal)", async () => {
    const { renderSkillsSection } = await importIndex();
    const deepNested = makeDeepNested(30);
    const skills = [
      {
        metadata: {
          name: "Core",
          description: "Core desc",
          path: "/root/skills/skill.md",
          priority: -1,
          extra: deepNested,
        },
      },
      {
        metadata: {
          name: "Standard",
          description: "Standard desc",
          path: "relative\\path\\standard.md",
          priority: 100,
        },
      },
      {
        metadata: {
          name: "Optional",
          description: LONG_STRING,
          path: "https://example.com/skills/optional.md?x=1",
          priority: MAX_SAFE,
        },
      },
      {
        metadata: {
          name: "NoPath",
          description: "No path",
          path: "   ",
          priority: 100,
        },
      },
    ];

    const output = renderSkillsSection(skills);

    expect(output).toContain("## Skills");
    expect(output).toContain("Core Skills");
    expect(output).toContain("Standard Skills");
    expect(output).toContain("Optional Skills");
    expect(output.indexOf("Core Skills")).toBeLessThan(output.indexOf("Standard Skills"));
    expect(output.indexOf("Standard Skills")).toBeLessThan(output.indexOf("Optional Skills"));
    expect(output).toContain("- Core: Core desc (file: skill.md)");
    expect(output).toContain("standard.md");
    expect(output).toContain("/skills/optional.md?x=1");
    expect(output).toMatch(/- NoPath: No path$/m);
  });

  it("returns null for empty inputs and can hide priority headers (boundary)", async () => {
    const { renderSkillsSection } = await importIndex();

    expect(renderSkillsSection(null)).toBeNull();
    expect(renderSkillsSection(undefined)).toBeNull();
    expect(renderSkillsSection([])).toBeNull();

    const output = renderSkillsSection(
      [{ metadata: { name: "Solo", description: "d", path: "solo.md", priority: 100 } }],
      { showPriority: false },
    );

    expect(output).not.toContain("Core Skills");
    expect(output).not.toContain("Standard Skills");
    expect(output).not.toContain("Optional Skills");
  });

  it("throws when dependencies fail (error)", async () => {
    vi.doMock("../../../../js/agents/shared/index.js", async () => {
      const actual = await vi.importActual("../../../../js/agents/shared/index.js");
      return {
        ...actual,
        toNonEmptyString: (value) => {
          if (value === "throw") {
            throw new Error("boom");
          }
          return actual.toNonEmptyString(value);
        },
      };
    });

    const { renderSkillsSection } = await importIndex();

    expect(() => renderSkillsSection([
      { metadata: { name: "Bad", description: "d", path: "throw", priority: 100 } },
    ])).toThrow("boom");
  });
});

describe("renderSkillsList", () => {
  it("renders ordered list with descriptions (normal)", async () => {
    const { renderSkillsList } = await importIndex();
    const skills = [
      {
        metadata: {
          name: "Core",
          description: "Core desc",
          shortDescription: "Core short",
          priority: 0,
          extra: makeDeepNested(10),
        },
      },
      {
        metadata: {
          name: "Standard",
          description: "Standard desc",
          priority: 100,
        },
      },
      {
        metadata: {
          name: "Optional",
          description: "Optional desc",
          shortDescription: null,
          priority: 200,
        },
      },
    ];

    const output = renderSkillsList(skills);

    expect(output).toContain("Available skills:");
    expect(output.indexOf("$Core")).toBeLessThan(output.indexOf("$Standard"));
    expect(output.indexOf("$Standard")).toBeLessThan(output.indexOf("$Optional"));
    expect(output).toContain("$Core: Core short");
    expect(output).toContain("$Standard: Standard desc");
  });

  it("returns empty string for empty or wrong inputs (boundary)", async () => {
    const { renderSkillsList } = await importIndex();

    expect(renderSkillsList(null)).toBe("");
    expect(renderSkillsList(undefined)).toBe("");
    expect(renderSkillsList([])).toBe("");
    expect(renderSkillsList({})).toBe("");
  });

  it("throws when skill accessors fail (error)", async () => {
    const { renderSkillsList } = await importIndex();
    const badSkill = {
      get metadata() {
        throw new Error("boom");
      },
    };

    expect(() => renderSkillsList([badSkill])).toThrow("boom");
  });
});

describe("enhanceWithSandbox", () => {
  it("enhances manager and executes skills (normal)", async () => {
    const { mod, instances } = await importIndexWithSandboxMocks();

    const localSkill = { metadata: { name: "Alpha", scope: "repo" }, body: "body" };
    const manager = {
      getSkillsForCwd: vi.fn().mockResolvedValue({ skills: [localSkill] }),
      clearCache: vi.fn(),
    };

    const enhanced = mod.enhanceWithSandbox(manager, { kernel: "k", trustChecker: vi.fn() });
    const executor = instances[0];

    const result = await enhanced.executeSkill("Alpha", { cwd: "/repo" });
    const batch = await enhanced.executeSkills(["Alpha", "Missing"], { cwd: "/repo" });

    expect(manager.getSkillsForCwd).toHaveBeenCalledWith("/repo");
    expect(executor.execute).toHaveBeenCalledWith(localSkill, { cwd: "/repo" });
    expect(executor.executeMany).toHaveBeenCalledWith([localSkill], { cwd: "/repo" });
    expect(result).toEqual({ skill: localSkill, context: { cwd: "/repo" } });
    expect(batch).toEqual({ skills: [localSkill], context: { cwd: "/repo" } });
    expect(enhanced.getExecutor()).toBe(executor);

    enhanced.clearCache("x");
    expect(manager.clearCache).toHaveBeenCalledWith("x");

    enhanced.dispose();
    expect(executor.dispose).toHaveBeenCalled();
    expect(executor.options.kernel).toBe("k");
  });

  it("handles empty inputs for execution (boundary)", async () => {
    const { mod } = await importIndexWithSandboxMocks();

    const manager = {
      getSkillsForCwd: vi.fn().mockResolvedValue({ skills: [] }),
      clearCache: vi.fn(),
    };

    const enhanced = mod.enhanceWithSandbox(manager);
    const result = await enhanced.executeSkill("", { cwd: "/repo" });
    const executor = enhanced.getExecutor();
    await enhanced.executeSkills([], { cwd: "/repo" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Skill not found/);
    expect(executor.executeMany).toHaveBeenCalledWith([], { cwd: "/repo" });
  });

  it("returns failure when remote skill load fails (error)", async () => {
    const { mod } = await importIndexWithSandboxMocks();

    const remoteSkill = { metadata: { name: "Remote", scope: "remote" }, body: null };
    const manager = {
      getSkillsForCwd: vi.fn().mockResolvedValue({ skills: [remoteSkill] }),
      clearCache: vi.fn(),
      remoteProvider: { loadSkillBody: vi.fn().mockRejectedValue(new Error("fail")) },
    };

    const enhanced = mod.enhanceWithSandbox(manager);
    const result = await enhanced.executeSkill("Remote", { cwd: "/repo" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to load remote skill/);
  });
});

describe("createSandboxedSkillsManager", () => {
  it("creates a sandboxed manager with options (normal)", async () => {
    class MockManager {
      constructor(options = {}) {
        this.options = options;
        this.getSkillsForCwd = vi.fn().mockResolvedValue({ skills: [], errors: [] });
        this.clearCache = vi.fn();
      }
    }

    const { mod, instances } = await importIndexWithSandboxMocks({ managerClass: MockManager });
    const remoteProvider = { name: "remote" };
    const trustChecker = vi.fn();

    const manager = await mod.createSandboxedSkillsManager({
      homeDir: "/home",
      manifestUrl: "manifest",
      remoteProvider,
      cacheTtlMs: 10,
      cacheMaxEntries: 2,
      kernel: "k",
      trustChecker,
    });

    expect(manager).toBeInstanceOf(MockManager);
    expect(manager.options).toEqual({
      homeDir: "/home",
      manifestUrl: "manifest",
      remoteProvider,
      cacheTtlMs: 10,
      cacheMaxEntries: 2,
    });
    expect(typeof manager.executeSkill).toBe("function");
    expect(instances[0].options).toEqual({ kernel: "k", trustChecker });
  });

  it("forwards boundary values to manager (boundary)", async () => {
    class MockManager {
      constructor(options = {}) {
        this.options = options;
        this.getSkillsForCwd = vi.fn().mockResolvedValue({ skills: [], errors: [] });
        this.clearCache = vi.fn();
      }
    }

    const { mod } = await importIndexWithSandboxMocks({ managerClass: MockManager });

    const manager = await mod.createSandboxedSkillsManager({
      cacheTtlMs: -1,
      cacheMaxEntries: 0,
      manifestUrl: "   ",
    });

    expect(manager.options.cacheTtlMs).toBe(-1);
    expect(manager.options.cacheMaxEntries).toBe(0);
    expect(manager.options.manifestUrl).toBe("   ");
  });

  it("throws when options are invalid (error)", async () => {
    class MockManager {
      constructor(options = {}) {
        this.options = options;
        this.getSkillsForCwd = vi.fn().mockResolvedValue({ skills: [], errors: [] });
        this.clearCache = vi.fn();
      }
    }

    const { mod } = await importIndexWithSandboxMocks({ managerClass: MockManager });

    await expect(mod.createSandboxedSkillsManager(null)).rejects.toThrow();
  });
});

describe("analyzeSkillRisk", () => {
  it("flags dangerous patterns and sets risk levels (normal)", async () => {
    const { analyzeSkillRisk } = await importIndex();
    const result = analyzeSkillRisk("eval('1'); const child_process = true;");

    expect(result.safe).toBe(false);
    expect(result.overallRisk).toBe("critical");
    expect(result.risks.length).toBeGreaterThan(0);
    expect(result.risks.map((r) => r.pattern)).toContain("child_process");
  });

  it("handles empty, numeric, and long inputs (boundary)", async () => {
    const { analyzeSkillRisk } = await importIndex();
    const longBody = `${"x".repeat(100000)}fetch(`;

    expect(analyzeSkillRisk("").safe).toBe(true);
    expect(analyzeSkillRisk("   ").safe).toBe(true);
    expect(analyzeSkillRisk(0).safe).toBe(true);
    expect(analyzeSkillRisk(MAX_SAFE).safe).toBe(true);

    const longResult = analyzeSkillRisk(longBody);
    expect(longResult.safe).toBe(false);
    expect(longResult.overallRisk).toBe("low");
  });

  it("throws when input cannot be coerced (error)", async () => {
    const { analyzeSkillRisk } = await importIndex();
    const badInput = {
      toString() {
        throw new Error("boom");
      },
    };

    expect(() => analyzeSkillRisk(badInput)).toThrow("boom");
  });
});

describe("default", () => {
  it("exposes SkillsManager and returns metadata (normal)", async () => {
    const outcome = {
      skills: [
        {
          metadata: { name: "Alpha", description: "d", path: "/alpha", scope: "repo", keywords: [] },
          body: "body",
        },
      ],
      errors: [],
    };
    const { mod } = await importIndexWithManagerMocks({ loadSkillsImpl: async () => outcome });

    expect(mod.default).toBe(mod.SkillsManager);

    const manager = new mod.default({ homeDir: "/home" });
    const metadata = await manager.getAllSkillMetadata("/repo");

    expect(metadata).toEqual([outcome.skills[0].metadata]);
  });

  it("supports headerless catalog rendering (boundary)", async () => {
    const { mod } = await importIndexWithManagerMocks({
      loadSkillsImpl: async () => ({ skills: [], errors: [] }),
      renderSkillsListImpl: () => "List",
    });

    const manager = new mod.default({ homeDir: "/home" });
    const catalog = await manager.getCatalogPrompt("/repo", { header: false });

    expect(catalog).toBe("List");
  });

  it("rejects when loading skills fails (error)", async () => {
    const { mod, mocks } = await importIndexWithManagerMocks();
    mocks.loadSkills.mockRejectedValue(new Error("boom"));

    const manager = new mod.default({ homeDir: "/home" });

    await expect(manager.getSkillsForCwd("/repo")).rejects.toThrow("boom");
  });
});
