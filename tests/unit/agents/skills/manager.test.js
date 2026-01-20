import { describe, it, expect, vi, beforeEach } from "vitest";

const loaderMock = vi.hoisted(() => ({
  loadSkills: vi.fn(),
}));

const renderMock = vi.hoisted(() => ({
  renderSkillsList: vi.fn(),
}));

vi.mock("../../../../js/agents/skills/loader.js", () => loaderMock);
vi.mock("../../../../js/agents/skills/render.js", () => renderMock);

import { SkillsManager } from "../../../../js/agents/skills/manager.js";
import DefaultSkillsManager from "../../../../js/agents/skills/manager.js";
import { loadSkills } from "../../../../js/agents/skills/loader.js";
import { renderSkillsList } from "../../../../js/agents/skills/render.js";

const mockedLoadSkills = vi.mocked(loadSkills);
const mockedRenderSkillsList = vi.mocked(renderSkillsList);

const makeOutcome = (skills = [], errors = []) => ({ skills, errors });

beforeEach(() => {
  vi.clearAllMocks();
  mockedLoadSkills.mockResolvedValue(makeOutcome());
  mockedRenderSkillsList.mockReturnValue("");
});

describe("SkillsManager", () => {
  it("normalizes manifestUrl and numeric string options", () => {
    const manager = new SkillsManager({
      manifestUrl: " https://example.com/manifest.json ",
      cacheTtlMs: "1200",
      cacheMaxEntries: "4",
    });

    expect(manager.manifestUrl).toBe("https://example.com/manifest.json");
    expect(manager.cacheTtlMs).toBe(1200);
    expect(manager.cacheMaxEntries).toBe(4);
  });

  it("clamps negative and zero boundaries and preserves MAX_SAFE_INTEGER", () => {
    const negative = new SkillsManager({
      manifestUrl: "   ",
      cacheTtlMs: -1,
      cacheMaxEntries: 0,
    });

    expect(negative.manifestUrl).toBeNull();
    expect(negative.cacheTtlMs).toBe(0);
    expect(negative.cacheMaxEntries).toBe(1);

    const zero = new SkillsManager({ cacheTtlMs: 0, cacheMaxEntries: 0 });
    expect(zero.cacheTtlMs).toBe(0);
    expect(zero.cacheMaxEntries).toBe(1);

    const maxed = new SkillsManager({
      cacheTtlMs: Number.MAX_SAFE_INTEGER,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
    });
    expect(maxed.cacheTtlMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(maxed.cacheMaxEntries).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("loads skills and caches until TTL expires", async () => {
    const manager = new SkillsManager({
      homeDir: "/home/test",
      manifestUrl: "http://example.com/manifest.json",
      cacheTtlMs: 1000,
    });
    const outcome1 = makeOutcome([{ metadata: { name: "Alpha" }, body: "body" }], []);
    const outcome2 = makeOutcome([{ metadata: { name: "Beta" }, body: "body2" }], []);
    mockedLoadSkills.mockResolvedValueOnce(outcome1).mockResolvedValueOnce(outcome2);

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1500).mockReturnValueOnce(2501);

    try {
      const first = await manager.getSkillsForCwd("/repo");
      const second = await manager.getSkillsForCwd("/repo");
      const third = await manager.getSkillsForCwd("/repo");

      expect(first).toBe(outcome1);
      expect(second).toBe(outcome1);
      expect(third).toBe(outcome2);
      expect(mockedLoadSkills).toHaveBeenCalledTimes(2);
      expect(mockedLoadSkills.mock.calls[0][0]).toMatchObject({
        cwd: "/repo",
        homeDir: "/home/test",
        manifestUrl: "http://example.com/manifest.json",
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("bypasses cache when forceReload is true", async () => {
    const manager = new SkillsManager({ cacheTtlMs: 5000 });
    const outcome1 = makeOutcome([{ metadata: { name: "First" } }], []);
    const outcome2 = makeOutcome([{ metadata: { name: "Second" } }], []);
    mockedLoadSkills.mockResolvedValueOnce(outcome1).mockResolvedValueOnce(outcome2);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      const first = await manager.getSkillsForCwd("/repo");
      const second = await manager.getSkillsForCwd("/repo", true);

      expect(first).toBe(outcome1);
      expect(second).toBe(outcome2);
      expect(mockedLoadSkills).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("uses default cache key for nullish/non-string cwd and preserves whitespace cwd", async () => {
    const manager = new SkillsManager({ cacheTtlMs: 10_000 });
    const defaultOutcome = makeOutcome([{ metadata: { name: "Default" } }], []);
    const whitespaceOutcome = makeOutcome([{ metadata: { name: "Whitespace" } }], []);
    mockedLoadSkills.mockResolvedValueOnce(defaultOutcome).mockResolvedValueOnce(whitespaceOutcome);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      const first = await manager.getSkillsForCwd(null);
      const second = await manager.getSkillsForCwd(undefined);
      const third = await manager.getSkillsForCwd("");
      const fourth = await manager.getSkillsForCwd([]);
      const fifth = await manager.getSkillsForCwd({});

      expect(first).toBe(defaultOutcome);
      expect(second).toBe(defaultOutcome);
      expect(third).toBe(defaultOutcome);
      expect(fourth).toBe(defaultOutcome);
      expect(fifth).toBe(defaultOutcome);

      const whitespace = await manager.getSkillsForCwd("   ");
      expect(whitespace).toBe(whitespaceOutcome);

      expect(mockedLoadSkills).toHaveBeenCalledTimes(2);
      expect(manager.cacheByDir.has("__default__")).toBe(true);
      expect(manager.cacheByDir.has("   ")).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("omits manifestUrl when blank", async () => {
    const manager = new SkillsManager({ manifestUrl: "   ", homeDir: "/home" });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      await manager.getSkillsForCwd("/repo");
      const args = mockedLoadSkills.mock.calls[0][0];

      expect(Object.prototype.hasOwnProperty.call(args, "manifestUrl")).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("merges remote skills with lowest priority and avoids overriding local", async () => {
    const remoteProvider = {
      listSkills: vi.fn().mockResolvedValue([
        { name: "Local", description: "remote local", priority: 5 },
        { name: "Remote", description: "remote desc", priority: 0, keywords: "" },
      ]),
    };
    const manager = new SkillsManager({ remoteProvider });

    const outcome = makeOutcome(
      [{ metadata: { name: "Local", description: "local", path: "local.md" }, body: "local" }],
      [],
    );
    mockedLoadSkills.mockResolvedValue(outcome);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      const result = await manager.getSkillsForCwd("/repo");
      expect(remoteProvider.listSkills).toHaveBeenCalledTimes(1);

      const names = result.skills.map((skill) => skill.metadata.name);
      expect(names).toEqual(["Local", "Remote"]);

      const remote = result.skills.find((skill) => skill.metadata.name === "Remote");
      expect(remote.body).toBeNull();
      expect(remote.metadata).toMatchObject({
        name: "Remote",
        description: "remote desc",
        path: "remote:Remote",
        scope: "remote",
        keywords: [],
        priority: 200,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("records remote provider errors without failing", async () => {
    const remoteProvider = {
      listSkills: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const manager = new SkillsManager({ remoteProvider });

    const outcome = makeOutcome([], []);
    mockedLoadSkills.mockResolvedValue(outcome);

    const result = await manager.getSkillsForCwd("/repo");

    expect(remoteProvider.listSkills).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({ path: "remote://", message: "boom" });
  });

  it("captures non-iterable remote skill results (object as array boundary)", async () => {
    const remoteProvider = {
      listSkills: vi.fn().mockResolvedValue({}),
    };
    const manager = new SkillsManager({ remoteProvider });

    const outcome = makeOutcome([], []);
    mockedLoadSkills.mockResolvedValue(outcome);

    const result = await manager.getSkillsForCwd("/repo");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe("remote://");
    expect(typeof result.errors[0].message).toBe("string");
    expect(result.errors[0].message.length).toBeGreaterThan(0);
  });

  it("evicts oldest cache entries beyond cacheMaxEntries", async () => {
    const manager = new SkillsManager({ cacheMaxEntries: 2, cacheTtlMs: 10_000 });
    mockedLoadSkills.mockResolvedValue(makeOutcome([], []));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      await manager.getSkillsForCwd("a");
      await manager.getSkillsForCwd("b");
      await manager.getSkillsForCwd("c");

      expect(manager.cacheByDir.size).toBe(2);
      expect(manager.cacheByDir.has("a")).toBe(false);
      expect(manager.cacheByDir.has("b")).toBe(true);
      expect(manager.cacheByDir.has("c")).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("is stable under concurrent calls once cached", async () => {
    const manager = new SkillsManager({ cacheTtlMs: 10_000 });
    const outcome = makeOutcome([{ metadata: { name: "Fast" } }], []);
    mockedLoadSkills.mockResolvedValue(outcome);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      await manager.getSkillsForCwd("/repo");

      const results = await Promise.all(
        Array.from({ length: 5 }, () => manager.getSkillsForCwd("/repo")),
      );

      expect(results.every((result) => result === outcome)).toBe(true);
      expect(mockedLoadSkills).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("handles rapid successive calls without reloading", async () => {
    const manager = new SkillsManager({ cacheTtlMs: 10_000 });
    const outcome = makeOutcome([{ metadata: { name: "Rapid" } }], []);
    mockedLoadSkills.mockResolvedValue(outcome);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      const first = await manager.getSkillsForCwd("/repo");

      for (let i = 0; i < 20; i += 1) {
        const result = await manager.getSkillsForCwd("/repo");
        expect(result).toBe(first);
      }

      expect(mockedLoadSkills).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("builds catalog prompt with header and respects header flag", async () => {
    const manager = new SkillsManager({});
    const outcome = makeOutcome([{ metadata: { name: "One" } }], []);
    mockedLoadSkills.mockResolvedValue(outcome);
    mockedRenderSkillsList.mockReturnValue("Available skills:\n- $One: desc");

    const headered = await manager.getCatalogPrompt("/repo");
    const noHeader = await manager.getCatalogPrompt("/repo", { header: false });

    expect(headered).toBe("## Skills Catalog\n\nAvailable skills:\n- $One: desc");
    expect(noHeader).toBe("Available skills:\n- $One: desc");
    expect(mockedRenderSkillsList).toHaveBeenCalledWith(outcome.skills);
  });

  it("returns empty string when rendered list is empty", async () => {
    const manager = new SkillsManager({});
    mockedLoadSkills.mockResolvedValue(makeOutcome([], []));
    mockedRenderSkillsList.mockReturnValue("");

    const result = await manager.getCatalogPrompt("/repo");

    expect(result).toBe("");
  });

  it("clears cache by cwd or entirely for empty values", async () => {
    const manager = new SkillsManager({ cacheTtlMs: 10_000 });
    mockedLoadSkills.mockResolvedValue(makeOutcome([], []));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      await manager.getSkillsForCwd("a");
      await manager.getSkillsForCwd("b");

      expect(manager.cacheByDir.size).toBe(2);

      manager.clearCache("a");
      expect(manager.cacheByDir.has("a")).toBe(false);
      expect(manager.cacheByDir.has("b")).toBe(true);

      manager.clearCache("");
      expect(manager.cacheByDir.size).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("returns metadata list and preserves large/deep content", async () => {
    const manager = new SkillsManager({ cacheTtlMs: 10_000 });
    const longText = "x".repeat(200_000);
    const hugeBody = "y".repeat(300_000);
    const deepNested = { a: { b: { c: { d: { e: "f" } } } } };

    const metadata = { name: "Deep", description: longText, extra: deepNested };
    const outcome = makeOutcome(
      [{ metadata, body: hugeBody, supportFiles: { "deep/file.txt": longText } }],
      [],
    );
    mockedLoadSkills.mockResolvedValue(outcome);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    try {
      const loaded = await manager.getSkillsForCwd("/repo");
      expect(loaded.skills[0].body.length).toBe(hugeBody.length);

      const metadataList = await manager.getAllSkillMetadata("/repo");
      expect(metadataList).toHaveLength(1);
      expect(metadataList[0]).toBe(metadata);
      expect(metadataList[0].description.length).toBe(longText.length);
      expect(metadataList[0].extra).toBe(deepNested);
      expect(mockedLoadSkills).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("default", () => {
  it("exports SkillsManager as default", () => {
    expect(DefaultSkillsManager).toBe(SkillsManager);
  });
});
