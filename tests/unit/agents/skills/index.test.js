import { beforeEach, describe, expect, it, vi } from "vitest";

const depMocks = vi.hoisted(() => {
  class SkillScope {}
  class SkillsManager {}

  return {
    SkillScope,
    loadSkills: vi.fn(),
    loadSkillFromPath: vi.fn(),
    loadSkillsFromNexus: vi.fn(),
    loadAllSkills: vi.fn(),
    SkillsManager,
    renderSkillsSection: vi.fn(),
    renderSkillsList: vi.fn(),
    enhanceWithSandbox: vi.fn(),
    createSandboxedSkillsManager: vi.fn(),
    analyzeSkillRisk: vi.fn(),
  };
});

vi.mock("../../../../js/agents/skills/model.js", () => ({
  SkillScope: depMocks.SkillScope,
}));

vi.mock("../../../../js/agents/skills/loader.js", () => ({
  loadSkills: depMocks.loadSkills,
  loadSkillFromPath: depMocks.loadSkillFromPath,
  loadSkillsFromNexus: depMocks.loadSkillsFromNexus,
  loadAllSkills: depMocks.loadAllSkills,
}));

vi.mock("../../../../js/agents/skills/manager.js", () => ({
  SkillsManager: depMocks.SkillsManager,
}));

vi.mock("../../../../js/agents/skills/render.js", () => ({
  renderSkillsSection: depMocks.renderSkillsSection,
  renderSkillsList: depMocks.renderSkillsList,
}));

vi.mock("../../../../js/agents/skills/sandbox-adapter.js", () => ({
  enhanceWithSandbox: depMocks.enhanceWithSandbox,
  createSandboxedSkillsManager: depMocks.createSandboxedSkillsManager,
  analyzeSkillRisk: depMocks.analyzeSkillRisk,
}));

async function importSkillsIndex() {
  return await import("../../../../js/agents/skills/index.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("agents/skills/index (public exports)", () => {
  it("should_export_SkillScope_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.SkillScope).toBe(depMocks.SkillScope);
  });

  it("should_export_loadSkills_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.loadSkills).toBe(depMocks.loadSkills);
  });

  it("should_export_loadSkillFromPath_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.loadSkillFromPath).toBe(depMocks.loadSkillFromPath);
  });

  it("should_export_loadSkillsFromNexus_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.loadSkillsFromNexus).toBe(depMocks.loadSkillsFromNexus);
  });

  it("should_export_loadAllSkills_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.loadAllSkills).toBe(depMocks.loadAllSkills);
  });

  it("should_export_SkillsManager_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.SkillsManager).toBe(depMocks.SkillsManager);
  });

  it("should_export_renderSkillsSection_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.renderSkillsSection).toBe(depMocks.renderSkillsSection);
  });

  it("should_export_renderSkillsList_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.renderSkillsList).toBe(depMocks.renderSkillsList);
  });

  it("should_export_enhanceWithSandbox_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.enhanceWithSandbox).toBe(depMocks.enhanceWithSandbox);
  });

  it("should_export_createSandboxedSkillsManager_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.createSandboxedSkillsManager).toBe(depMocks.createSandboxedSkillsManager);
  });

  it("should_export_analyzeSkillRisk_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.analyzeSkillRisk).toBe(depMocks.analyzeSkillRisk);
  });

  it("should_export_default_SkillsManager_when_importing_module", async () => {
    const mod = await importSkillsIndex();

    expect(mod.default).toBe(depMocks.SkillsManager);
  });
});

describe("agents/skills/index (edge and error cases)", () => {
  it("should_return_empty_string_when_loadSkillFromPath_receives_empty_string", async () => {
    const mod = await importSkillsIndex();
    depMocks.loadSkillFromPath.mockImplementationOnce((value) => value);

    expect(mod.loadSkillFromPath("")).toBe("");
  });

  it("should_return_null_when_loadSkillFromPath_receives_null", async () => {
    const mod = await importSkillsIndex();
    depMocks.loadSkillFromPath.mockImplementationOnce((value) => value);

    expect(mod.loadSkillFromPath(null)).toBe(null);
  });

  it("should_throw_error_when_analyzeSkillRisk_throws", async () => {
    const mod = await importSkillsIndex();
    depMocks.analyzeSkillRisk.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => mod.analyzeSkillRisk({})).toThrow("boom");
  });
});