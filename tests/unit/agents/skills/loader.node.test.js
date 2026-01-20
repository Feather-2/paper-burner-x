import { beforeEach, describe, expect, it, vi } from "vitest";

import { SkillScope } from "../../../../js/agents/skills/model.js";

const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
}));

const cryptoMock = vi.hoisted(() => ({
  createHash: vi.fn(),
}));

const pathMock = vi.hoisted(() => ({
  join: vi.fn(),
  resolve: vi.fn(),
  sep: "/",
}));

vi.mock("node:fs/promises", () => fsMock);
vi.mock("node:crypto", () => cryptoMock);
vi.mock("node:path", () => pathMock);

const joinPaths = (...parts) => parts.join("/").replace(/\/+/g, "/");

function setupHashMock() {
  cryptoMock.createHash.mockImplementation(() => {
    let data = "";
    const hash = {
      update: (input) => {
        data += String(input ?? "");
        return hash;
      },
      digest: () => String(data.length).padStart(16, "0"),
    };
    return hash;
  });
}

function setupPathMock() {
  pathMock.sep = "/";
  pathMock.join.mockImplementation(joinPaths);
  pathMock.resolve.mockImplementation((p) => p);
}

function setupFsDefaults() {
  fsMock.readFile.mockImplementation(() => {
    throw new Error("readFile not mocked");
  });
  fsMock.stat.mockImplementation(() => {
    throw new Error("stat not mocked");
  });
  fsMock.readdir.mockImplementation(() => {
    throw new Error("readdir not mocked");
  });
}

function createDirent(name, type) {
  return {
    name,
    isDirectory: () => type === "dir",
    isFile: () => type === "file",
  };
}

function setupFsMock({ dirs = {}, files = {} } = {}) {
  fsMock.stat.mockImplementation(async (target) => {
    if (Object.prototype.hasOwnProperty.call(dirs, target)) {
      return { isDirectory: () => true };
    }
    if (Object.prototype.hasOwnProperty.call(files, target)) {
      return { isDirectory: () => false };
    }
    const err = new Error(`ENOENT: ${target}`);
    err.code = "ENOENT";
    throw err;
  });

  fsMock.readdir.mockImplementation(async (dir) => {
    if (!Object.prototype.hasOwnProperty.call(dirs, dir)) {
      const err = new Error(`ENOENT: ${dir}`);
      err.code = "ENOENT";
      throw err;
    }
    return dirs[dir].map((entry) => createDirent(entry.name, entry.type));
  });

  fsMock.readFile.mockImplementation(async (filePath) => {
    if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
      const err = new Error(`ENOENT: ${filePath}`);
      err.code = "ENOENT";
      throw err;
    }
    return files[filePath];
  });
}

function makeSkillContents({
  name = "Example",
  description = "Example description",
  shortDescription,
  keywords,
  keywordsAll,
  allowedTools,
  tags,
  traits,
  priority,
  body = "Body",
} = {}) {
  const lines = ["---", `name: ${name}`, `description: ${description}`];
  if (shortDescription !== undefined) lines.push(`short-description: ${shortDescription}`);
  if (keywords !== undefined) lines.push(`keywords: ${keywords}`);
  if (keywordsAll !== undefined) lines.push(`keywords-all: ${keywordsAll}`);
  if (allowedTools !== undefined) lines.push(`allowed-tools: ${allowedTools}`);
  if (tags !== undefined) lines.push(`tags: ${tags}`);
  if (traits !== undefined) lines.push(`traits: ${traits}`);
  if (priority !== undefined) lines.push(`priority: ${priority}`);
  lines.push("---", body);
  return lines.join("\n");
}

async function importLoader() {
  return import("../../../../js/agents/skills/loader.node.js");
}

beforeEach(() => {
  vi.resetModules();
  fsMock.readFile.mockReset();
  fsMock.stat.mockReset();
  fsMock.readdir.mockReset();
  cryptoMock.createHash.mockReset();
  pathMock.join.mockReset();
  pathMock.resolve.mockReset();
  setupHashMock();
  setupPathMock();
  setupFsDefaults();
});

describe("loadSkillFromPath", () => {
  it("parses metadata, tags, and body", async () => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/alpha/SKILL.md";

    fsMock.readFile.mockResolvedValue(
      makeSkillContents({
        name: "  My   Skill  ",
        description: "\"  A   description  \"",
        shortDescription: "Short desc",
        keywords: "one, two , , three",
        keywordsAll: "alpha, beta",
        allowedTools: "tool1, tool2",
        tags: "kind:test, constructor:bad, empty:",
        traits: "fast, calm",
        priority: "7",
        body: "Body line1\nBody line2",
      }),
    );

    const skill = await loadSkillFromPath(filePath);

    expect(skill.metadata.name).toBe("My Skill");
    expect(skill.metadata.description).toBe("A description");
    expect(skill.metadata.shortDescription).toBe("Short desc");
    expect(skill.metadata.keywords).toEqual(["one", "two", "three"]);
    expect(skill.metadata.keywordsAll).toEqual(["alpha", "beta"]);
    expect(skill.metadata.allowedTools).toBe("tool1, tool2");
    expect(skill.metadata.tags).toEqual(expect.objectContaining({ kind: "test", empty: "" }));
    expect(Object.prototype.hasOwnProperty.call(skill.metadata.tags, "constructor")).toBe(false);
    expect(skill.metadata.traits).toEqual(["fast", "calm"]);
    expect(skill.metadata.priority).toBe(7);
    expect(skill.metadata.path).toBe(filePath);
    expect(skill.metadata.scope).toBe(SkillScope.USER);
    expect(skill.body).toBe("Body line1\nBody line2");
  });

  it("parses multiline descriptions and normalizes whitespace", async () => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/multi/SKILL.md";
    const contents = [
      "---",
      "name: Multi",
      "description: |",
      "  line one",
      "  line two",
      "---",
      "Body",
    ].join("\n");

    fsMock.readFile.mockResolvedValue(contents);

    const skill = await loadSkillFromPath(filePath);
    expect(skill.metadata.description).toBe("line one line two");
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["   "],
    [0],
    [-1],
    [Number.MAX_SAFE_INTEGER],
    [{}],
    [[]],
  ])("rejects invalid filePath %p", async (value) => {
    const { loadSkillFromPath } = await importLoader();
    await expect(loadSkillFromPath(value)).rejects.toThrow("filePath is required");
  });

  it("rejects paths outside the skills root", async () => {
    const { loadSkillFromPath } = await importLoader();
    pathMock.resolve.mockImplementation(() => "/tmp/skill.md");
    await expect(loadSkillFromPath("/tmp/skill.md")).rejects.toThrow(
      "path must be within .paper-burner/skills",
    );
  });

  it.each([
    ["name: Example\ndescription: MissingFrontmatter\n---\nBody"],
    ["---\nname: Example\ndescription: NoClosing"],
  ])("rejects missing frontmatter for contents %p", async (contents) => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/missing/SKILL.md";
    fsMock.readFile.mockResolvedValue(contents);
    await expect(loadSkillFromPath(filePath)).rejects.toThrow("missing YAML frontmatter");
  });

  it.each([
    ["---\ndescription: Has description\n---\nBody"],
    ["---\nname: Has name\n---\nBody"],
  ])("rejects missing required fields", async (contents) => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/invalid/SKILL.md";
    fsMock.readFile.mockResolvedValue(contents);
    await expect(loadSkillFromPath(filePath)).rejects.toThrow(/missing field/);
  });

  it("rejects name length over the maximum", async () => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/longname/SKILL.md";
    const longName = "a".repeat(65);
    fsMock.readFile.mockResolvedValue(
      makeSkillContents({ name: longName, description: "desc" }),
    );
    await expect(loadSkillFromPath(filePath)).rejects.toThrow("name exceeds maximum length");
  });

  it("rejects description length over the maximum", async () => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/longdesc/SKILL.md";
    const longDescription = "d".repeat(1025);
    fsMock.readFile.mockResolvedValue(
      makeSkillContents({ name: "Name", description: longDescription }),
    );
    await expect(loadSkillFromPath(filePath)).rejects.toThrow("description exceeds maximum length");
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ["not-a-number", NaN],
  ])("parses priority boundary value %p", async (priority, expected) => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/priority/SKILL.md";
    fsMock.readFile.mockResolvedValue(
      makeSkillContents({ name: "Priority", description: "desc", priority }),
    );

    const skill = await loadSkillFromPath(filePath);
    if (Number.isNaN(expected)) {
      expect(Number.isNaN(skill.metadata.priority)).toBe(true);
    } else {
      expect(skill.metadata.priority).toBe(expected);
    }
  });

  it("handles large bodies without truncation", async () => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/large/SKILL.md";
    const bigBody = "x".repeat(10000);
    fsMock.readFile.mockResolvedValue(
      makeSkillContents({ name: "Large", description: "desc", body: bigBody }),
    );

    const skill = await loadSkillFromPath(filePath);
    expect(skill.body.length).toBe(bigBody.length);
    expect(skill.body).toBe(bigBody);
  });

  it("returns cached skill for quick successive calls", async () => {
    const { loadSkillFromPath } = await importLoader();
    const filePath = "/repo/.paper-burner/skills/cache/SKILL.md";
    fsMock.readFile.mockResolvedValue(
      makeSkillContents({ name: "Cached", description: "desc" }),
    );

    const first = await loadSkillFromPath(filePath);
    const second = await loadSkillFromPath(filePath);

    expect(second).toBe(first);
  });
});

describe("loadSkills", () => {
  it("returns empty outcome when no roots are provided", async () => {
    const { loadSkills } = await importLoader();
    const outcome = await loadSkills();
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });

  it("loads, dedupes, and sorts skills from repo and user roots", async () => {
    const { loadSkills } = await importLoader();
    const cwd = "/repo";
    const homeDir = "/home";
    const repoRoot = joinPaths(cwd, ".paper-burner", "skills");
    const userRoot = joinPaths(homeDir, ".paper-burner", "skills");

    const repoCommonDir = joinPaths(repoRoot, "common");
    const repoZedDir = joinPaths(repoRoot, "zed");
    const repoNestedDir = joinPaths(repoRoot, "nested");
    const repoNestedLevel1 = joinPaths(repoNestedDir, "level1");
    const repoNestedLevel2 = joinPaths(repoNestedLevel1, "level2");
    const userCommonDir = joinPaths(userRoot, "common");
    const userAlphaDir = joinPaths(userRoot, "alpha");
    const hiddenDir = joinPaths(repoRoot, ".ignored");

    const dirs = {
      [repoRoot]: [
        { name: "common", type: "dir" },
        { name: "zed", type: "dir" },
        { name: "nested", type: "dir" },
        { name: ".ignored", type: "dir" },
      ],
      [repoCommonDir]: [{ name: "SKILL.md", type: "file" }],
      [repoZedDir]: [{ name: "SKILL.md", type: "file" }],
      [repoNestedDir]: [{ name: "level1", type: "dir" }],
      [repoNestedLevel1]: [{ name: "level2", type: "dir" }],
      [repoNestedLevel2]: [{ name: "SKILL.md", type: "file" }],
      [userRoot]: [
        { name: "common", type: "dir" },
        { name: "alpha", type: "dir" },
      ],
      [userCommonDir]: [{ name: "SKILL.md", type: "file" }],
      [userAlphaDir]: [{ name: "SKILL.md", type: "file" }],
      [hiddenDir]: [{ name: "SKILL.md", type: "file" }],
    };

    const files = {
      [joinPaths(repoCommonDir, "SKILL.md")]: makeSkillContents({
        name: "Common",
        description: "repo common",
      }),
      [joinPaths(repoZedDir, "SKILL.md")]: makeSkillContents({
        name: "Zed",
        description: "repo zed",
      }),
      [joinPaths(repoNestedLevel2, "SKILL.md")]: makeSkillContents({
        name: "Deep",
        description: "repo deep",
      }),
      [joinPaths(userCommonDir, "SKILL.md")]: makeSkillContents({
        name: "Common",
        description: "user common",
      }),
      [joinPaths(userAlphaDir, "SKILL.md")]: makeSkillContents({
        name: "Alpha",
        description: "user alpha",
      }),
      [joinPaths(hiddenDir, "SKILL.md")]: makeSkillContents({
        name: "Hidden",
        description: "hidden",
      }),
    };

    setupFsMock({ dirs, files });

    const outcome = await loadSkills({ cwd, homeDir });
    const names = outcome.skills.map((skill) => skill.metadata.name);
    expect(names).toEqual(["Alpha", "Common", "Deep", "Zed"]);
    expect(outcome.skills.some((skill) => skill.metadata.name === "Hidden")).toBe(false);

    const common = outcome.skills.find((skill) => skill.metadata.name === "Common");
    expect(common.metadata.description).toBe("repo common");
    expect(common.metadata.scope).toBe(SkillScope.REPO);

    const alpha = outcome.skills.find((skill) => skill.metadata.name === "Alpha");
    expect(alpha.metadata.scope).toBe(SkillScope.USER);
    expect(outcome.errors).toEqual([]);
  });

  it("reports parse errors for invalid skills", async () => {
    const { loadSkills } = await importLoader();
    const cwd = "/repo";
    const repoRoot = joinPaths(cwd, ".paper-burner", "skills");
    const goodDir = joinPaths(repoRoot, "good");
    const badDir = joinPaths(repoRoot, "bad");

    const dirs = {
      [repoRoot]: [
        { name: "good", type: "dir" },
        { name: "bad", type: "dir" },
      ],
      [goodDir]: [{ name: "SKILL.md", type: "file" }],
      [badDir]: [{ name: "SKILL.md", type: "file" }],
    };

    const files = {
      [joinPaths(goodDir, "SKILL.md")]: makeSkillContents({
        name: "Good",
        description: "valid",
      }),
      [joinPaths(badDir, "SKILL.md")]: "---\nname: Bad\n---\nBody",
    };

    setupFsMock({ dirs, files });

    const outcome = await loadSkills({ cwd });
    expect(outcome.skills.map((skill) => skill.metadata.name)).toEqual(["Good"]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].path).toBe(joinPaths(badDir, "SKILL.md"));
    expect(outcome.errors[0].message).toMatch("missing field `description`");
  });

  it("reports readdir errors for non-system scopes", async () => {
    const { loadSkills } = await importLoader();
    const cwd = "/repo";
    const repoRoot = joinPaths(cwd, ".paper-burner", "skills");

    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockRejectedValue(new Error("boom"));

    const outcome = await loadSkills({ cwd });
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toEqual({
      path: repoRoot,
      message: "Failed to read dir: boom",
    });
  });

  it("handles empty root values", async () => {
    const { loadSkills } = await importLoader();
    const outcome = await loadSkills({ cwd: "", homeDir: "" });
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });

  it("supports concurrent calls", async () => {
    const { loadSkills } = await importLoader();
    const cwd = "/repo";
    const repoRoot = joinPaths(cwd, ".paper-burner", "skills");
    const skillDir = joinPaths(repoRoot, "solo");

    const dirs = {
      [repoRoot]: [{ name: "solo", type: "dir" }],
      [skillDir]: [{ name: "SKILL.md", type: "file" }],
    };
    const files = {
      [joinPaths(skillDir, "SKILL.md")]: makeSkillContents({
        name: "Solo",
        description: "desc",
      }),
    };

    setupFsMock({ dirs, files });

    const [first, second] = await Promise.all([loadSkills({ cwd }), loadSkills({ cwd })]);
    expect(first.skills.map((skill) => skill.metadata.name)).toEqual(["Solo"]);
    expect(second.skills.map((skill) => skill.metadata.name)).toEqual(["Solo"]);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  });
});

describe("loadSkillsFromNexus", () => {
  it("returns empty outcome for null provider", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const outcome = await loadSkillsFromNexus(null);
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });

  it("returns empty outcome when nexus is unavailable", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(false),
      listSkills: vi.fn(),
      getSkillContent: vi.fn(),
    };

    const outcome = await loadSkillsFromNexus(nexusProvider);
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toEqual([]);
    expect(nexusProvider.listSkills).not.toHaveBeenCalled();
  });

  it("handles empty remote skill lists", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([]),
      getSkillContent: vi.fn(),
    };

    const outcome = await loadSkillsFromNexus(nexusProvider);
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toEqual([]);
  });

  it("loads remote skills with support files and defaults", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([
        {
          name: "RemoteA",
          description: "desc a",
          allowedTools: ["toolA", "toolB"],
          priority: 10,
        },
        {
          name: "RemoteB",
          description: "desc b",
        },
      ]),
      getSkillContent: vi.fn((name) => {
        if (name === "RemoteA") {
          return Promise.resolve({
            body: "Body A",
            supportFiles: { "a.txt": "1" },
          });
        }
        return Promise.resolve({ body: "Body B", supportFiles: {} });
      }),
    };

    const outcome = await loadSkillsFromNexus(nexusProvider);
    expect(outcome.errors).toEqual([]);
    expect(outcome.skills).toHaveLength(2);

    const remoteA = outcome.skills.find((skill) => skill.metadata.name === "RemoteA");
    expect(remoteA.metadata.scope).toBe(SkillScope.REMOTE);
    expect(remoteA.metadata.path).toBe("nexus://RemoteA");
    expect(remoteA.metadata.allowedTools).toBe("toolA,toolB");
    expect(remoteA.metadata.priority).toBe(10);
    expect(remoteA.supportFiles).toEqual({ "a.txt": "1" });

    const remoteB = outcome.skills.find((skill) => skill.metadata.name === "RemoteB");
    expect(remoteB.metadata.priority).toBe(200);
    expect(remoteB.supportFiles).toEqual({});
  });

  it("records per-skill errors without stopping other skills", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([
        { name: "Good", description: "ok" },
        { name: "Bad", description: "bad" },
      ]),
      getSkillContent: vi.fn((name) => {
        if (name === "Bad") {
          return Promise.reject(new Error("content failed"));
        }
        return Promise.resolve({ body: "Good body", supportFiles: null });
      }),
    };

    const outcome = await loadSkillsFromNexus(nexusProvider);
    expect(outcome.skills.map((skill) => skill.metadata.name)).toEqual(["Good"]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]).toEqual({
      path: "nexus://Bad",
      message: "content failed",
    });
  });

  it("handles type boundary for allowedTools when not an array", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([
        { name: "Weird", description: "oops", allowedTools: {} },
      ]),
      getSkillContent: vi.fn().mockResolvedValue({ body: "Body", supportFiles: null }),
    };

    const outcome = await loadSkillsFromNexus(nexusProvider);
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].path).toBe("nexus://Weird");
  });

  it("captures connection errors", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockRejectedValue(new Error("down")),
      listSkills: vi.fn(),
      getSkillContent: vi.fn(),
    };

    const outcome = await loadSkillsFromNexus(nexusProvider);
    expect(outcome.skills).toEqual([]);
    expect(outcome.errors).toEqual([
      { path: "nexus://", message: "Failed to connect to Nexus: down" },
    ]);
  });

  it("supports concurrent calls", async () => {
    const { loadSkillsFromNexus } = await importLoader();
    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([{ name: "One", description: "desc" }]),
      getSkillContent: vi.fn().mockResolvedValue({ body: "Body", supportFiles: null }),
    };

    const [first, second] = await Promise.all([
      loadSkillsFromNexus(nexusProvider),
      loadSkillsFromNexus(nexusProvider),
    ]);
    expect(first.skills.map((skill) => skill.metadata.name)).toEqual(["One"]);
    expect(second.skills.map((skill) => skill.metadata.name)).toEqual(["One"]);
  });
});

describe("loadAllSkills", () => {
  it("merges local and remote skills with local priority", async () => {
    const { loadAllSkills } = await importLoader();
    const cwd = "/repo";
    const repoRoot = joinPaths(cwd, ".paper-burner", "skills");
    const localDir = joinPaths(repoRoot, "local");
    const sharedDir = joinPaths(repoRoot, "shared");

    const dirs = {
      [repoRoot]: [
        { name: "local", type: "dir" },
        { name: "shared", type: "dir" },
      ],
      [localDir]: [{ name: "SKILL.md", type: "file" }],
      [sharedDir]: [{ name: "SKILL.md", type: "file" }],
    };
    const files = {
      [joinPaths(localDir, "SKILL.md")]: makeSkillContents({
        name: "Local",
        description: "local",
      }),
      [joinPaths(sharedDir, "SKILL.md")]: makeSkillContents({
        name: "Shared",
        description: "local shared",
      }),
    };
    setupFsMock({ dirs, files });

    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([
        { name: "Shared", description: "remote shared" },
        { name: "Remote", description: "remote only" },
      ]),
      getSkillContent: vi.fn((name) => Promise.resolve({ body: `${name} body`, supportFiles: null })),
    };

    const outcome = await loadAllSkills({ cwd, nexusProvider });
    const names = outcome.skills.map((skill) => skill.metadata.name);
    expect(names).toEqual(["Local", "Shared", "Remote"]);

    const shared = outcome.skills.find((skill) => skill.metadata.name === "Shared");
    expect(shared.metadata.path).toBe(joinPaths(sharedDir, "SKILL.md"));
    expect(shared.metadata.scope).toBe(SkillScope.REPO);
    expect(outcome.errors).toEqual([]);
  });

  it("combines remote errors with local results", async () => {
    const { loadAllSkills } = await importLoader();
    const cwd = "/repo";
    const repoRoot = joinPaths(cwd, ".paper-burner", "skills");
    const localDir = joinPaths(repoRoot, "local");
    const dirs = {
      [repoRoot]: [{ name: "local", type: "dir" }],
      [localDir]: [{ name: "SKILL.md", type: "file" }],
    };
    const files = {
      [joinPaths(localDir, "SKILL.md")]: makeSkillContents({
        name: "Local",
        description: "local",
      }),
    };
    setupFsMock({ dirs, files });

    const nexusProvider = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listSkills: vi.fn().mockResolvedValue([{ name: "Broken", description: "bad" }]),
      getSkillContent: vi.fn().mockRejectedValue(new Error("remote fail")),
    };

    const outcome = await loadAllSkills({ cwd, nexusProvider });
    expect(outcome.skills.map((skill) => skill.metadata.name)).toEqual(["Local"]);
    expect(outcome.errors).toEqual([
      { path: "nexus://Broken", message: "remote fail" },
    ]);
  });
});

describe("default export", () => {
  it("exposes the named loaders", async () => {
    const mod = await importLoader();
    expect(mod.default.loadSkills).toBe(mod.loadSkills);
    expect(mod.default.loadSkillFromPath).toBe(mod.loadSkillFromPath);
    expect(mod.default.loadSkillsFromNexus).toBe(mod.loadSkillsFromNexus);
    expect(mod.default.loadAllSkills).toBe(mod.loadAllSkills);
  });
});
