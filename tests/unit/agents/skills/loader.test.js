import { describe, it, expect, vi, beforeEach } from "vitest";

const loaderPath = "../../../../js/agents/skills/loader.js";
const sharedPath = "../../../../js/agents/shared/index.js";
const nodePath = "../../../../js/agents/skills/loader.node.js";
const browserPath = "../../../../js/agents/skills/loader.browser.js";

let isNodeLikeMock = vi.fn();
let nodeImpl = {};
let browserImpl = {};

vi.mock(sharedPath, () => ({
  isNodeLike: (...args) => isNodeLikeMock(...args),
}));

vi.mock(nodePath, () => nodeImpl);
vi.mock(browserPath, () => browserImpl);

const defaultOutcome = { skills: [], errors: [] };
const defaultSkill = { metadata: { name: "skill", description: "desc" }, body: null };

async function setup({ isNodeLikeReturn = true, nodeOverrides = {}, browserOverrides = {} } = {}) {
  vi.resetModules();
  isNodeLikeMock = vi.fn(() => isNodeLikeReturn);

  nodeImpl = {
    loadSkills: vi.fn().mockResolvedValue(defaultOutcome),
    loadSkillsFromNexus: vi.fn().mockResolvedValue(defaultOutcome),
    loadAllSkills: vi.fn().mockResolvedValue(defaultOutcome),
    loadSkillFromPath: vi.fn().mockResolvedValue(defaultSkill),
    ...nodeOverrides,
  };

  browserImpl = {
    loadSkills: vi.fn().mockResolvedValue(defaultOutcome),
    loadSkillsFromNexus: vi.fn().mockResolvedValue(defaultOutcome),
    loadAllSkills: vi.fn().mockResolvedValue(defaultOutcome),
    loadSkillFromPath: vi.fn().mockResolvedValue(defaultSkill),
    ...browserOverrides,
  };

  const mod = await import(loaderPath);
  return { mod, nodeImpl, browserImpl, isNodeLikeMock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadSkills", () => {
  it("uses node implementation when isNodeLike is true", async () => {
    const nodeOutcome = { skills: [{ id: "node" }], errors: [] };
    const { mod, nodeImpl, browserImpl, isNodeLikeMock } = await setup({
      isNodeLikeReturn: true,
      nodeOverrides: { loadSkills: vi.fn().mockResolvedValue(nodeOutcome) },
    });

    const result = await mod.loadSkills({ cwd: "/repo" });

    expect(result).toBe(nodeOutcome);
    expect(nodeImpl.loadSkills).toHaveBeenCalledWith({ cwd: "/repo" });
    expect(browserImpl.loadSkills).not.toHaveBeenCalled();
    expect(isNodeLikeMock).toHaveBeenCalledTimes(1);
  });

  it("uses browser implementation when isNodeLike is false", async () => {
    const browserOutcome = { skills: [{ id: "browser" }], errors: [] };
    const { mod, nodeImpl, browserImpl, isNodeLikeMock } = await setup({
      isNodeLikeReturn: false,
      browserOverrides: { loadSkills: vi.fn().mockResolvedValue(browserOutcome) },
    });

    const result = await mod.loadSkills({ manifestUrl: "/skills/manifest.json" });

    expect(result).toBe(browserOutcome);
    expect(browserImpl.loadSkills).toHaveBeenCalledWith({ manifestUrl: "/skills/manifest.json" });
    expect(nodeImpl.loadSkills).not.toHaveBeenCalled();
    expect(isNodeLikeMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "undefined defaults to empty object", input: undefined, expected: {} },
    { label: "null passes through", input: null, expected: null },
    { label: "empty string passes through", input: "", expected: "" },
    { label: "empty array passes through", input: [], expected: [] },
    { label: "empty object passes through", input: {}, expected: {} },
  ])("forwards boundary options (%s)", async ({ input, expected }) => {
    const { mod, nodeImpl } = await setup({ isNodeLikeReturn: true });

    await mod.loadSkills(input);

    expect(nodeImpl.loadSkills).toHaveBeenCalledWith(expected);
  });

  it("propagates implementation errors", async () => {
    const error = new Error("boom");
    const { mod } = await setup({
      isNodeLikeReturn: true,
      nodeOverrides: { loadSkills: vi.fn().mockRejectedValue(error) },
    });

    await expect(mod.loadSkills({})).rejects.toThrow("boom");
  });

  it("shares implementation promise for concurrent calls", async () => {
    const { mod, nodeImpl, isNodeLikeMock } = await setup({ isNodeLikeReturn: true });

    const [first, second] = await Promise.all([
      mod.loadSkills({ cwd: "/repo-a" }),
      mod.loadSkills({ cwd: "/repo-b" }),
    ]);

    expect(first).toBe(defaultOutcome);
    expect(second).toBe(defaultOutcome);
    expect(nodeImpl.loadSkills).toHaveBeenCalledTimes(2);
    expect(isNodeLikeMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadSkillsFromNexus", () => {
  it("forwards provider to the implementation", async () => {
    const provider = { id: "nexus" };
    const { mod, nodeImpl } = await setup({ isNodeLikeReturn: true });

    const result = await mod.loadSkillsFromNexus(provider);

    expect(result).toBe(defaultOutcome);
    expect(nodeImpl.loadSkillsFromNexus).toHaveBeenCalledWith(provider);
  });

  it.each([
    { label: "null provider", provider: null },
    { label: "undefined provider", provider: undefined },
    { label: "empty object provider", provider: {} },
    { label: "array-like object provider", provider: { 0: "x", length: 1 } },
  ])("handles boundary provider value (%s)", async ({ provider }) => {
    const { mod, nodeImpl } = await setup({ isNodeLikeReturn: true });

    await mod.loadSkillsFromNexus(provider);

    expect(nodeImpl.loadSkillsFromNexus).toHaveBeenCalledWith(provider);
  });

  it("propagates implementation errors", async () => {
    const error = new Error("nexus failure");
    const { mod } = await setup({
      isNodeLikeReturn: true,
      nodeOverrides: { loadSkillsFromNexus: vi.fn().mockRejectedValue(error) },
    });

    await expect(mod.loadSkillsFromNexus({})).rejects.toThrow("nexus failure");
  });
});

describe("loadAllSkills", () => {
  it("uses browser implementation for combined load", async () => {
    const browserOutcome = { skills: [{ id: "all" }], errors: [] };
    const { mod, browserImpl, nodeImpl } = await setup({
      isNodeLikeReturn: false,
      browserOverrides: { loadAllSkills: vi.fn().mockResolvedValue(browserOutcome) },
    });

    const result = await mod.loadAllSkills({ manifestUrl: "/skills/manifest.json" });

    expect(result).toBe(browserOutcome);
    expect(browserImpl.loadAllSkills).toHaveBeenCalledWith({ manifestUrl: "/skills/manifest.json" });
    expect(nodeImpl.loadAllSkills).not.toHaveBeenCalled();
  });

  it("forwards boundary options including numeric limits and deep nesting", async () => {
    const deepOptions = { level1: { level2: { level3: { flag: true } } } };
    const cases = [
      {},
      { maxManifestBytes: 0 },
      { maxManifestBytes: -1 },
      { maxManifestBytes: Number.MAX_SAFE_INTEGER },
      { maxManifestBytes: "1024" },
      { manifestUrl: "   " },
      { nexusProvider: deepOptions },
    ];

    const { mod, nodeImpl } = await setup({ isNodeLikeReturn: true });

    for (const options of cases) {
      await mod.loadAllSkills(options);
    }

    expect(nodeImpl.loadAllSkills).toHaveBeenCalledTimes(cases.length);
    cases.forEach((options, index) => {
      expect(nodeImpl.loadAllSkills.mock.calls[index][0]).toEqual(options);
    });
  });

  it("propagates implementation errors", async () => {
    const error = new Error("all skills failure");
    const { mod } = await setup({
      isNodeLikeReturn: true,
      nodeOverrides: { loadAllSkills: vi.fn().mockRejectedValue(error) },
    });

    await expect(mod.loadAllSkills({})).rejects.toThrow("all skills failure");
  });
});

describe("loadSkillFromPath", () => {
  it("forwards file path, scope, and options", async () => {
    const skill = { metadata: { name: "alpha", description: "desc" }, body: "body" };
    const { mod, nodeImpl } = await setup({
      isNodeLikeReturn: true,
      nodeOverrides: { loadSkillFromPath: vi.fn().mockResolvedValue(skill) },
    });

    const result = await mod.loadSkillFromPath("/skills/alpha/SKILL.md", "user", { maxSkillBytes: 2048 });

    expect(result).toBe(skill);
    expect(nodeImpl.loadSkillFromPath).toHaveBeenCalledWith("/skills/alpha/SKILL.md", "user", { maxSkillBytes: 2048 });
  });

  it.each([
    { label: "empty path with undefined options", args: ["", undefined, undefined] },
    { label: "whitespace path and scope with zero max", args: ["   ", "   ", { maxSkillBytes: 0 }] },
    {
      label: "long path with huge max and deep nesting",
      args: ["a".repeat(10000), null, { maxSkillBytes: Number.MAX_SAFE_INTEGER, nested: { a: { b: { c: true } } } }],
    },
    { label: "negative max bytes", args: ["/path", "scope", { maxSkillBytes: -1 }] },
  ])("handles boundary inputs (%s)", async ({ args }) => {
    const { mod, nodeImpl } = await setup({ isNodeLikeReturn: true });

    await mod.loadSkillFromPath(...args);

    expect(nodeImpl.loadSkillFromPath).toHaveBeenCalledWith(...args);
  });

  it("propagates implementation errors", async () => {
    const error = new Error("path failure");
    const { mod } = await setup({
      isNodeLikeReturn: true,
      nodeOverrides: { loadSkillFromPath: vi.fn().mockRejectedValue(error) },
    });

    await expect(mod.loadSkillFromPath("/skills/bad/SKILL.md")).rejects.toThrow("path failure");
  });

  it("reuses implementation on fast consecutive calls", async () => {
    const { mod, nodeImpl, isNodeLikeMock } = await setup({ isNodeLikeReturn: true });

    await mod.loadSkillFromPath("/skills/one/SKILL.md", "repo");
    await mod.loadSkillFromPath("/skills/two/SKILL.md", "user", { maxSkillBytes: "2048" });

    expect(nodeImpl.loadSkillFromPath).toHaveBeenCalledTimes(2);
    expect(isNodeLikeMock).toHaveBeenCalledTimes(1);
  });
});

describe("default export", () => {
  it("exposes the named loaders", async () => {
    const { mod } = await setup({ isNodeLikeReturn: true });

    expect(mod.default.loadSkills).toBe(mod.loadSkills);
    expect(mod.default.loadSkillFromPath).toBe(mod.loadSkillFromPath);
    expect(mod.default.loadSkillsFromNexus).toBe(mod.loadSkillsFromNexus);
    expect(mod.default.loadAllSkills).toBe(mod.loadAllSkills);
  });
});
