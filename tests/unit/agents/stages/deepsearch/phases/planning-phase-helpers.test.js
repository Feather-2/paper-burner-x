import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSkillsPrompt, resolveSkillsCatalogCwd } from "../../../../../../js/agents/stages/deepsearch/phases/planning-phase-helpers.js";

const originalProcess = globalThis.process;

function setProcessCwd(value) {
  if (value === undefined) {
    try {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    } catch {
      globalThis.process = undefined;
    }
    return;
  }
  try {
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      writable: true,
      value: { cwd: typeof value === "function" ? value : () => value },
    });
  } catch {
    globalThis.process = { cwd: typeof value === "function" ? value : () => value };
  }
}

function createAgent(overrides = {}) {
  return {
    state: { userConfig: { skills: { includeCatalog: true } } },
    globalConfig: null,
    _logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

class SkillsManagerMock {
  constructor() {
    this.getCatalogPrompt = vi.fn(async (cwd) => `catalog:${cwd}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setProcessCwd("/repo");
});

afterEach(() => {
  if (originalProcess === undefined) {
    setProcessCwd(undefined);
  } else {
    try {
      Object.defineProperty(globalThis, "process", {
        configurable: true,
        writable: true,
        value: originalProcess,
      });
    } catch {
      globalThis.process = originalProcess;
    }
  }
});

describe("resolveSkillsCatalogCwd", () => {
  it("prefers stageApi.cwd over process.cwd", () => {
    const agent = createAgent();
    const resolved = resolveSkillsCatalogCwd({ agent, stageApi: { cwd: "/stage-api" } });
    expect(resolved).toEqual({ cwd: "/stage-api", source: "stageApi.cwd" });
  });

  it("supports stageApi.getCwd and disable process fallback", () => {
    const agent = createAgent();
    const fromGetter = resolveSkillsCatalogCwd({
      agent,
      stageApi: { getCwd: () => " /getter/path " },
    });
    expect(fromGetter).toEqual({ cwd: "/getter/path", source: "stageApi.getCwd" });

    const disabled = resolveSkillsCatalogCwd({
      agent,
      stageApi: { allowProcessCwdForSkills: false },
    });
    expect(disabled).toEqual({ cwd: "", source: "disabled" });
  });
});

describe("buildSkillsPrompt", () => {
  it("builds catalog from explicit stageApi cwd", async () => {
    const agent = createAgent();
    const prompt = await buildSkillsPrompt({
      agent,
      stageApi: { cwd: "/explicit" },
      SkillsManager: SkillsManagerMock,
    });

    expect(prompt).toBe("catalog:/explicit");
    expect(agent._logger.info).toHaveBeenCalledWith("[Skills] Included skills catalog", { source: "stageApi.cwd" });
  });

  it("falls back to process.cwd in node-like environments", async () => {
    const agent = createAgent();
    const prompt = await buildSkillsPrompt({
      agent,
      stageApi: {},
      SkillsManager: SkillsManagerMock,
    });

    expect(prompt).toBe("catalog:/repo");
    expect(agent._logger.info).toHaveBeenCalledWith("[Skills] Included skills catalog", { source: "process.cwd" });
  });

  it("returns empty prompt when cwd is unavailable (browser-like)", async () => {
    setProcessCwd(undefined);
    const agent = createAgent();

    const prompt = await buildSkillsPrompt({
      agent,
      stageApi: {},
      SkillsManager: SkillsManagerMock,
    });

    expect(prompt).toBe("");
    expect(agent._logger.info).toHaveBeenCalledWith("[Skills] Skipping skills catalog: cwd unavailable", {
      source: "unavailable",
    });
  });

  it("returns empty prompt when SkillsManager missing or feature disabled", async () => {
    const disabledAgent = createAgent({ state: { userConfig: { skills: { includeCatalog: false } } } });

    await expect(buildSkillsPrompt({ agent: disabledAgent, stageApi: {}, SkillsManager: SkillsManagerMock })).resolves.toBe("");
    await expect(buildSkillsPrompt({ agent: createAgent(), stageApi: {}, SkillsManager: null })).resolves.toBe("");
  });
});
