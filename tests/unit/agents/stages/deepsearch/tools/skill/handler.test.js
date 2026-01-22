/**
 * @file tests/unit/agents/stages/deepsearch/tools/skill/handler.test.js
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const loadSkills = vi.fn();
const loadSkillFromPath = vi.fn();

vi.mock("../../../../../../../js/agents/skills/loader.js", () => ({
  loadSkills,
  loadSkillFromPath,
}));

const MODULE_PATH =
  "../../../../../../../js/agents/stages/deepsearch/tools/skill/handler.js";

const ORIGINAL_PROCESS = globalThis.process;

const loadModule = async () => import(MODULE_PATH);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  loadSkills.mockReset();
  loadSkillFromPath.mockReset();
  globalThis.process = ORIGINAL_PROCESS;
});

describe("definition", () => {
  it("exposes the expected metadata", async () => {
    const { definition } = await loadModule();

    expect(definition).toMatchObject({
      name: "skill",
      description: expect.any(String),
    });
    expect(definition.description).toContain("执行一个 Skill");
    expect(definition.description).toContain("SKILL.md");
  });
});

describe("handler", () => {
  it("returns error when name is missing (undefined/null/empty/0)", async () => {
    const { handler } = await loadModule();
    const cases = [undefined, null, "", 0];

    for (const name of cases) {
      const result = await handler({ name }, { stageApi: { cwd: "/tmp" } });

      expect(result).toEqual({
        success: false,
        error: "缺少参数: name",
      });
    }
  });

  it("returns error when args is an empty object", async () => {
    const { handler } = await loadModule();

    const result = await handler({}, { stageApi: { cwd: "/tmp" } });

    expect(result).toEqual({
      success: false,
      error: "缺少参数: name",
    });
  });

  it("returns error when args is an empty array (type boundary)", async () => {
    const { handler } = await loadModule();

    const result = await handler([], { stageApi: { cwd: "/tmp" } });

    expect(result).toEqual({
      success: false,
      error: "缺少参数: name",
    });
  });

  it("throws when args is null or undefined (type boundary)", async () => {
    const { handler } = await loadModule();

    await expect(handler(null, { stageApi: { cwd: "/tmp" } })).rejects.toBeInstanceOf(TypeError);
    await expect(handler(undefined, { stageApi: { cwd: "/tmp" } })).rejects.toBeInstanceOf(TypeError);
  });

  it("throws when context is null or undefined (type boundary)", async () => {
    const { handler } = await loadModule();

    await expect(handler({ name: "Alpha" }, null)).rejects.toBeInstanceOf(TypeError);
    await expect(handler({ name: "Alpha" }, undefined)).rejects.toBeInstanceOf(TypeError);
  });

  it("returns error when cwd is missing", async () => {
    const { handler } = await loadModule();
    globalThis.process = {};

    const result = await handler(
      { name: "Alpha" },
      { stageApi: { cwd: "" } }
    );

    expect(result).toEqual({
      success: false,
      error:
        "当前环境无法加载 Skill（缺少 cwd）。请在 Node 环境中提供 stageApi.cwd。",
    });
  });

  it("returns error when process.cwd returns an empty string", async () => {
    const { handler } = await loadModule();
    globalThis.process = { cwd: () => "" };

    const result = await handler({ name: "Alpha" }, {});

    expect(result).toEqual({
      success: false,
      error:
        "当前环境无法加载 Skill（缺少 cwd）。请在 Node 环境中提供 stageApi.cwd。",
    });
  });

  it("uses process.cwd when stageApi.cwd is missing (null/undefined)", async () => {
    loadSkills.mockResolvedValue({
      skills: [{ body: "Body", metadata: { name: "Alpha" } }],
    });
    const cwdSpy = vi.spyOn(globalThis.process, "cwd").mockReturnValue("/process-cwd");
    const { handler } = await loadModule();

    const resultUndefined = await handler({ name: "Alpha" }, {});
    const resultNull = await handler({ name: "Alpha" }, { stageApi: null });

    expect(cwdSpy).toHaveBeenCalledTimes(2);
    expect(loadSkills).toHaveBeenCalledWith({ cwd: "/process-cwd" });
    expect(resultUndefined.success).toBe(true);
    expect(resultNull.success).toBe(true);
  });

  it("prefers stageApi.cwd over process.cwd", async () => {
    loadSkills.mockResolvedValue({
      skills: [{ body: "Body", metadata: { name: "Alpha" } }],
    });
    const cwdSpy = vi.spyOn(globalThis.process, "cwd").mockReturnValue("/process-cwd");
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/stage-cwd" } });

    expect(cwdSpy).not.toHaveBeenCalled();
    expect(loadSkills).toHaveBeenCalledWith({ cwd: "/stage-cwd" });
    expect(result.success).toBe(true);
  });

  it("returns available list when skill is not found (whitespace name)", async () => {
    loadSkills.mockResolvedValue({
      skills: [
        { body: "Body", metadata: { name: "Alpha" } },
        { body: "Body", metadata: { name: "Beta" } },
      ],
    });
    const { handler } = await loadModule();

    const result = await handler({ name: "   " }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Skill "   " 不存在');
    expect(result.available).toBe("Alpha, Beta");
  });

  it("returns no available skills message for an empty list", async () => {
    loadSkills.mockResolvedValue({ skills: [] });
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result).toEqual({
      success: false,
      error: 'Skill "Alpha" 不存在',
      available: "无可用 Skills",
    });
  });

  it("returns skill content and metadata for case-insensitive match", async () => {
    loadSkills.mockResolvedValue({
      skills: [
        {
          body: "Skill body",
          metadata: {
            name: "Alpha",
            description: "desc",
            keywords: ["k1"],
            path: "/path",
            scope: "global",
          },
        },
      ],
    });
    const { handler } = await loadModule();

    const result = await handler({ name: "alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result).toEqual({
      success: true,
      skill: "Alpha",
      body: "Skill body",
      allowedTools: null,
      metadata: {
        description: "desc",
        keywords: ["k1"],
        path: "/path",
        scope: "global",
      },
    });
  });

  it("does not call loadSkillFromPath when cached body is present", async () => {
    loadSkills.mockResolvedValue({
      skills: [
        {
          body: "Body",
          metadata: { name: "Alpha", path: "/path", scope: "global" },
        },
      ],
    });
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(loadSkillFromPath).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.body).toBe("Body");
  });

  it("loads body from path when missing and preserves deep metadata", async () => {
    const longBody = "A".repeat(100000);
    const deepKeywords = {
      level1: {
        level2: {
          level3: {
            value: "x",
          },
        },
      },
    };

    loadSkills.mockResolvedValue({
      skills: [
        {
          body: "",
          metadata: {
            name: "DeepSkill",
            description: "desc",
            keywords: deepKeywords,
            path: "/skills/deep",
            scope: "local",
            allowedTools: [],
          },
        },
      ],
    });
    loadSkillFromPath.mockResolvedValue({
      body: longBody,
      metadata: { name: "Other" },
    });
    const { handler } = await loadModule();

    const result = await handler(
      { name: "DeepSkill" },
      { stageApi: { cwd: "/tmp" } }
    );

    expect(loadSkillFromPath).toHaveBeenCalledWith("/skills/deep", "local");
    expect(result.success).toBe(true);
    expect(result.skill).toBe("DeepSkill");
    expect(result.body).toBe(longBody);
    expect(result.allowedTools).toEqual([]);
    expect(result.metadata.keywords).toEqual(deepKeywords);
  });

  it("returns error when loadSkillFromPath returns a non-string body (type boundary)", async () => {
    loadSkills.mockResolvedValue({
      skills: [
        {
          body: "",
          metadata: { name: "Alpha", path: "/path", scope: "global" },
        },
      ],
    });
    loadSkillFromPath.mockResolvedValue({ body: { not: "a string" } });
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Skill "Alpha" loaded but body is empty');
  });

  it("returns error when loadSkillFromPath fails and body is empty", async () => {
    loadSkills.mockResolvedValue({
      skills: [
        {
          body: "",
          metadata: { name: "Alpha", path: "/path", scope: "global" },
        },
      ],
    });
    loadSkillFromPath.mockRejectedValue(new Error("missing"));
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      'Skill "Alpha" loaded but body is empty. Ensure SKILL.md is accessible in this environment.'
    );
  });

  it("returns error when skill body is whitespace", async () => {
    loadSkills.mockResolvedValue({
      skills: [{ body: "   ", metadata: { name: "Alpha" } }],
    });
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Skill "Alpha" loaded but body is empty');
  });

  it("returns error when loadSkills throws", async () => {
    loadSkills.mockRejectedValue(new Error("boom"));
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result).toEqual({
      success: false,
      error: "加载 Skill 失败: boom",
    });
  });

  it("supports numeric string skill names", async () => {
    loadSkills.mockResolvedValue({
      skills: [{ body: "num", metadata: { name: "123" } }],
    });
    const { handler } = await loadModule();

    const result = await handler({ name: "123" }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(true);
    expect(result.skill).toBe("123");
  });

  it.each([
    ["-1", -1],
    ["max safe integer", Number.MAX_SAFE_INTEGER],
    ["empty array", []],
    ["empty object", {}],
  ])("returns error for non-string name %s", async (_label, name) => {
    loadSkills.mockResolvedValue({
      skills: [{ body: "Body", metadata: { name: "Alpha" } }],
    });
    const { handler } = await loadModule();

    const result = await handler({ name }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toContain("toLowerCase");
  });

  it("returns error when skills is not an array", async () => {
    loadSkills.mockResolvedValue({ skills: {} });
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toContain("find is not a function");
  });

  it("returns error when a skill entry is missing metadata.name (type boundary)", async () => {
    loadSkills.mockResolvedValue({
      skills: [{ body: "Body", metadata: {} }],
    });
    const { handler } = await loadModule();

    const result = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(result.success).toBe(false);
    expect(result.error).toContain("toLowerCase");
  });

  it("handles concurrent calls", async () => {
    const { handler } = await loadModule();
    const skill = { body: "Body", metadata: { name: "Alpha" } };
    const resolvers = [];

    loadSkills.mockImplementation(
      () => new Promise(resolve => resolvers.push(resolve))
    );

    const callA = handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });
    const callB = handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(loadSkills).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);

    resolvers.forEach(resolve => resolve({ skills: [skill] }));

    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
  });

  it("reuses cached skills for rapid consecutive calls", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    loadSkills.mockResolvedValue({
      skills: [{ body: "Body", metadata: { name: "Alpha" } }],
    });
    const { handler } = await loadModule();

    const first = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });
    const second = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(loadSkills).toHaveBeenCalledTimes(1);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it("refreshes cached skills after TTL expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(60001);
    loadSkills.mockResolvedValue({
      skills: [{ body: "Body", metadata: { name: "Alpha" } }],
    });
    const { handler } = await loadModule();

    const first = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });
    const second = await handler({ name: "Alpha" }, { stageApi: { cwd: "/tmp" } });

    expect(loadSkills).toHaveBeenCalledTimes(2);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });
});

describe("default", () => {
  it("exports definition and handler", async () => {
    const module = await loadModule();

    expect(module.default.definition).toBe(module.definition);
    expect(module.default.handler).toBe(module.handler);
  });
});
