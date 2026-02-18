import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPromptMock = vi.hoisted(() => vi.fn());
const renderPromptTemplateMock = vi.hoisted(() => vi.fn((template) => `rendered:${template}`));
const getToolCatalogPromptMock = vi.hoisted(() => vi.fn(() => "TOOL_CATALOG"));
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../js/agents/prompts/prompt-loader.js", () => ({
  loadPrompt: loadPromptMock,
  renderPromptTemplate: renderPromptTemplateMock,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  getToolCatalogPrompt: getToolCatalogPromptMock,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => ({ warn: loggerWarnMock })),
}));

const MODULE_PATH =
  "../../../../../../js/agents/stages/deepsearch/phases/planning-phase-helpers.js";

async function loadModule() {
  return await import(MODULE_PATH);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  loadPromptMock.mockImplementation(async (name) => `prompt:${name}`);
});

describe("getSystemPrompt cache control", () => {
  it("reuses module prompt cache for repeated calls under the same cache key", async () => {
    const subject = await loadModule();

    const first = await subject.getSystemPrompt({ mode: "wider", skillsPrompt: "SKILLS" });
    const second = await subject.getSystemPrompt({ mode: "wider", skillsPrompt: "SKILLS" });

    expect(first).toContain("rendered:");
    expect(second).toContain("rendered:");
    expect(loadPromptMock).toHaveBeenCalledTimes(3);
    expect(loadPromptMock).toHaveBeenCalledWith("deepsearch/system-core");
    expect(loadPromptMock).toHaveBeenCalledWith("deepsearch/wider");
    expect(loadPromptMock).toHaveBeenCalledWith("deepsearch/system-subagents");
  });

  it("reloads prompt templates when cacheKey changes", async () => {
    const subject = await loadModule();

    await subject.getSystemPrompt({ mode: "wider", cacheKey: "run-a" });
    await subject.getSystemPrompt({ mode: "wider", cacheKey: "run-b" });

    expect(loadPromptMock).toHaveBeenCalledTimes(6);
  });

  it("supports explicit resetSystemPromptCache for hot-reload/test isolation", async () => {
    const subject = await loadModule();

    await subject.getSystemPrompt({ mode: "quick" });
    subject.resetSystemPromptCache();
    await subject.getSystemPrompt({ mode: "quick" });

    // quick mode loads core + quick mode template (no subagents)
    expect(loadPromptMock).toHaveBeenCalledTimes(4);
    expect(loadPromptMock).toHaveBeenNthCalledWith(1, "deepsearch/system-core");
    expect(loadPromptMock).toHaveBeenNthCalledWith(2, "deepsearch/quick");
    expect(loadPromptMock).toHaveBeenNthCalledWith(3, "deepsearch/system-core");
    expect(loadPromptMock).toHaveBeenNthCalledWith(4, "deepsearch/quick");
  });
});
